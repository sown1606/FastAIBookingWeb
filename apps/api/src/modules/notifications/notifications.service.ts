import { Prisma, Role, StaffStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { getFirebaseMessaging } from "../../lib/firebase-admin";
import { logger } from "../../lib/logger";

interface RegisterPushTokenInput {
  token: string;
  userId: string;
  role: Role;
  salonId?: string | null;
  staffId?: string | null;
  platform?: string;
}

export interface PushPayload {
  title: string;
  body: string;
  type?: string;
  priority?: "NORMAL" | "URGENT";
  salonId?: string | null;
  data?: Record<string, boolean | number | string | null | undefined>;
  url?: string | null;
}

export interface PushSendResult {
  attempted: number;
  successCount: number;
  failureCount: number;
  invalidTokenCount: number;
  disabled: boolean;
}

const invalidFcmTokenCodes = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered"
]);

const emptySendResult = (disabled: boolean): PushSendResult => ({
  attempted: 0,
  successCount: 0,
  failureCount: 0,
  invalidTokenCount: 0,
  disabled
});

const unique = (values: string[]): string[] => {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
};

const chunk = <T>(items: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
};

const toFirebaseData = (
  data?: PushPayload["data"]
): Record<string, string> => {
  return Object.fromEntries(
    Object.entries(data ?? {})
      .filter(([, value]) => value !== null && value !== undefined)
      .map(([key, value]) => [key, String(value)])
  );
};

const toJson = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
};

const resolvePayloadType = (payload: PushPayload): string => {
  return payload.type ?? (typeof payload.data?.type === "string" ? payload.data.type : "notification");
};

const resolvePayloadSalonId = (payload: PushPayload): string | null => {
  return payload.salonId ?? (typeof payload.data?.salonId === "string" ? payload.data.salonId : null);
};

const createUserNotifications = async (
  userIds: string[],
  payload: PushPayload
): Promise<Array<{ id: string; userId: string }>> => {
  const targetUserIds = unique(userIds);
  if (!targetUserIds.length) {
    return [];
  }

  return prisma.$transaction(
    targetUserIds.map((userId) =>
      prisma.userNotification.create({
        data: {
          userId,
          salonId: resolvePayloadSalonId(payload),
          title: payload.title,
          body: payload.body,
          type: resolvePayloadType(payload),
          priority: payload.priority ?? "NORMAL",
          url: payload.url ?? null,
          ...(payload.data === undefined ? {} : { data: toJson(payload.data) })
        },
        select: {
          id: true,
          userId: true
        }
      })
    )
  );
};

const getAssignedStaffUserIds = async (staffIds: string[]): Promise<string[]> => {
  const targetStaffIds = unique(staffIds);
  if (!targetStaffIds.length) {
    return [];
  }

  const staffUsers = await prisma.user.findMany({
    where: {
      staffId: {
        in: targetStaffIds
      },
      isActive: true
    },
    select: {
      id: true
    }
  });

  return staffUsers.map((user) => user.id);
};

const getSalonOwnerUserIds = async (salonId: string): Promise<string[]> => {
  const salon = await prisma.salon.findUnique({
    where: {
      id: salonId
    },
    select: {
      ownerId: true
    }
  });

  return salon ? [salon.ownerId] : [];
};

const getActiveSalonStaffUserIds = async (salonId: string): Promise<string[]> => {
  const staffUsers = await prisma.user.findMany({
    where: {
      role: Role.STAFF,
      salonId,
      isActive: true,
      staffProfile: {
        is: {
          salonId,
          status: StaffStatus.ACTIVE
        }
      }
    },
    select: {
      id: true
    }
  });

  return staffUsers.map((user) => user.id);
};

export const registerPushToken = async (input: RegisterPushTokenInput) => {
  const now = new Date();
  return prisma.pushToken.upsert({
    where: {
      token: input.token
    },
    create: {
      token: input.token,
      userId: input.userId,
      role: input.role,
      salonId: input.salonId ?? null,
      staffId: input.staffId ?? null,
      platform: input.platform ?? "web",
      lastSeenAt: now
    },
    update: {
      userId: input.userId,
      role: input.role,
      salonId: input.salonId ?? null,
      staffId: input.staffId ?? null,
      platform: input.platform ?? "web",
      lastSeenAt: now
    }
  });
};

export const unregisterPushToken = async (userId: string, token: string) => {
  return prisma.pushToken.deleteMany({
    where: {
      userId,
      token
    }
  });
};

export const cleanupInvalidPushTokens = async (tokens: string[]) => {
  const invalidTokens = unique(tokens);
  if (!invalidTokens.length) {
    return { count: 0 };
  }

  return prisma.pushToken.deleteMany({
    where: {
      token: {
        in: invalidTokens
      }
    }
  });
};

const sendPushToTokens = async (
  tokens: string[],
  payload: PushPayload
): Promise<PushSendResult> => {
  const messaging = getFirebaseMessaging();
  if (!messaging) {
    return emptySendResult(true);
  }

  const uniqueTokens = unique(tokens);
  if (!uniqueTokens.length) {
    return emptySendResult(false);
  }

  const salonId = resolvePayloadSalonId(payload);
  const data = toFirebaseData({
    ...payload.data,
    type: resolvePayloadType(payload),
    ...(payload.url ? { url: payload.url } : {}),
    ...(salonId ? { salonId } : {})
  });
  const result: PushSendResult = {
    attempted: uniqueTokens.length,
    successCount: 0,
    failureCount: 0,
    invalidTokenCount: 0,
    disabled: false
  };
  const invalidTokens: string[] = [];

  for (const tokenChunk of chunk(uniqueTokens, 500)) {
    try {
      const response = await messaging.sendEachForMulticast({
        tokens: tokenChunk,
        notification: {
          title: payload.title,
          body: payload.body
        },
        data,
        android: {
          priority: "high"
        },
        webpush: {
          notification: {
            title: payload.title,
            body: payload.body,
            icon: "/assets/brand/fastaibooking-mark.svg"
          }
        }
      });

      result.successCount += response.successCount;
      result.failureCount += response.failureCount;
      response.responses.forEach((sendResponse, index) => {
        const code = sendResponse.error?.code;
        if (code && invalidFcmTokenCodes.has(code)) {
          invalidTokens.push(tokenChunk[index]!);
        }
      });
    } catch (error) {
      result.failureCount += tokenChunk.length;
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error)
        },
        "FCM push send failed. Continuing without blocking workflow."
      );
    }
  }

  const cleanup = await cleanupInvalidPushTokens(invalidTokens);
  result.invalidTokenCount = cleanup.count;
  return result;
};

export const sendPushToUserIds = async (
  userIds: string[],
  payload: PushPayload
): Promise<PushSendResult> => {
  const targetUserIds = unique(userIds);
  if (!targetUserIds.length) {
    return emptySendResult(false);
  }

  const notifications = await createUserNotifications(targetUserIds, payload);

  const tokens = await prisma.pushToken.findMany({
    where: {
      userId: {
        in: targetUserIds
      }
    },
    select: {
      userId: true,
      token: true
    }
  });

  const tokensByUserId = new Map<string, string[]>();
  for (const item of tokens) {
    const userTokens = tokensByUserId.get(item.userId) ?? [];
    userTokens.push(item.token);
    tokensByUserId.set(item.userId, userTokens);
  }

  const sendResults = await Promise.all(
    notifications.map((notification) =>
      sendPushToTokens(tokensByUserId.get(notification.userId) ?? [], {
        ...payload,
        data: {
          ...payload.data,
          notificationId: notification.id
        }
      })
    )
  );

  return sendResults.reduce<PushSendResult>(
    (total, result) => ({
      attempted: total.attempted + result.attempted,
      successCount: total.successCount + result.successCount,
      failureCount: total.failureCount + result.failureCount,
      invalidTokenCount: total.invalidTokenCount + result.invalidTokenCount,
      disabled: total.disabled || result.disabled
    }),
    emptySendResult(false)
  );
};

export const sendTestPushToToken = async (
  token: string,
  payload: PushPayload
): Promise<PushSendResult> => {
  return sendPushToTokens([token], payload);
};

export const countUserPushTokens = async (userId: string): Promise<number> => {
  return prisma.pushToken.count({
    where: {
      userId
    }
  });
};

export const sendPushToAssignedStaff = async (
  staffIds: string | string[],
  payload: PushPayload
): Promise<PushSendResult> => {
  const targetStaffIds = unique(Array.isArray(staffIds) ? staffIds : [staffIds]);
  if (!targetStaffIds.length) {
    return emptySendResult(false);
  }

  return sendPushToUserIds(await getAssignedStaffUserIds(targetStaffIds), payload);
};

export const sendPushToSalonOwner = async (
  salonId: string,
  payload: PushPayload
): Promise<PushSendResult> => {
  return sendPushToUserIds(await getSalonOwnerUserIds(salonId), payload);
};

export const sendPushToActiveSalonStaff = async (
  salonId: string,
  payload: PushPayload
): Promise<PushSendResult> => {
  return sendPushToUserIds(await getActiveSalonStaffUserIds(salonId), payload);
};

export const sendPushToSalonOwnerAndAssignedStaff = async (
  salonId: string,
  staffIds: string | string[],
  payload: PushPayload
): Promise<PushSendResult> => {
  const targetStaffIds = Array.isArray(staffIds) ? staffIds : [staffIds];
  const [ownerUserIds, staffUserIds] = await Promise.all([
    getSalonOwnerUserIds(salonId),
    getAssignedStaffUserIds(targetStaffIds)
  ]);

  return sendPushToUserIds([...ownerUserIds, ...staffUserIds], payload);
};

export const sendPushToAssignedCallCenterAgentsOrOperators = async (
  salonId: string,
  payload: PushPayload
): Promise<PushSendResult> => {
  const assignments = await prisma.callCenterSalonAssignment.findMany({
    where: {
      salonId,
      agent: {
        is: {
          isActive: true
        }
      }
    },
    select: {
      agentUserId: true
    }
  });

  return sendPushToUserIds(
    assignments.map((assignment) => assignment.agentUserId),
    payload
  );
};

export const listUserNotificationInbox = async (input: {
  userId: string;
  limit: number;
}) => {
  return prisma.userNotification.findMany({
    where: {
      userId: input.userId
    },
    orderBy: {
      createdAt: "desc"
    },
    take: input.limit
  });
};

export const getUnreadUserNotificationCount = async (userId: string) => {
  return prisma.userNotification.count({
    where: {
      userId,
      readAt: null
    }
  });
};

export const markUserNotificationRead = async (
  userId: string,
  notificationId: string
) => {
  const notification = await prisma.userNotification.findFirst({
    where: {
      id: notificationId,
      userId
    }
  });
  if (!notification) {
    return null;
  }

  return prisma.userNotification.update({
    where: {
      id: notification.id
    },
    data: {
      readAt: notification.readAt ?? new Date()
    }
  });
};

export const markAllUserNotificationsRead = async (userId: string) => {
  return prisma.userNotification.updateMany({
    where: {
      userId,
      readAt: null
    },
    data: {
      readAt: new Date()
    }
  });
};
