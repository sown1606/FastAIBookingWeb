import { Router } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../middleware/async-handler";
import { validate } from "../../middleware/validate";
import { AppError } from "../../lib/errors";
import { isFirebaseMessagingConfigured } from "../../lib/firebase-admin";
import { sendSuccess } from "../../utils/response";
import { getAppointmentCreatedPushTestPayload } from "../appointments/appointments.service";
import {
  countUserPushTokens,
  getSalonNotificationDebug,
  getUnreadUserNotificationCount,
  getUserNotificationDebug,
  listUserNotificationInbox,
  markAllUserNotificationsRead,
  markUserNotificationRead,
  registerPushToken,
  sendPushToUserIds,
  sendTestPushToToken,
  unregisterPushToken
} from "./notifications.service";
import { pushTokenSchema, type PushTokenPayload } from "./notifications.schemas";

const supportedPushRoles = new Set([
  "SALON_OWNER",
  "STAFF",
  "CALL_CENTER_AGENT",
  "OPERATOR"
]);

const inboxQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).default(10)
});

const notificationIdSchema = z.object({
  id: z.string().uuid()
});

const testPushDataSchema = z.record(
  z.union([z.string(), z.number(), z.boolean(), z.null()])
);

const testTokenSchema = z.object({
  token: z.string().trim().min(1).max(4096),
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(1000).optional(),
  data: testPushDataSchema.optional()
});

const testUserSchema = z.object({
  userId: z.string().uuid().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(1000).optional(),
  data: testPushDataSchema.optional()
});

const testAppointmentSchema = z.object({
  appointmentId: z.string().uuid(),
  userId: z.string().uuid().optional()
});

const assertPushRoleSupported = (role: string): void => {
  if (!supportedPushRoles.has(role)) {
    throw new AppError("Push notifications are not supported for this role.", 403, "FORBIDDEN");
  }
};

export const notificationsRouter = Router();
export const devicesRouter = Router();

const registerTokenHandler = asyncHandler(async (req, res) => {
  assertPushRoleSupported(req.auth!.role);
  const payload = req.body as PushTokenPayload;
  const pushToken = await registerPushToken({
    token: payload.token,
    platform: payload.platform,
    userId: req.auth!.userId,
    role: req.auth!.role,
    salonId: req.auth!.salonId,
    staffId: req.auth!.staffId
  });

  return sendSuccess(res, {
    message: "Push token registered.",
    data: {
      registered: true,
      id: pushToken.id,
      userId: pushToken.userId,
      role: pushToken.role,
      salonId: pushToken.salonId,
      staffId: pushToken.staffId,
      platform: pushToken.platform.toLowerCase()
    }
  });
});

const unregisterTokenHandler = asyncHandler(async (req, res) => {
  assertPushRoleSupported(req.auth!.role);
  const payload = req.body as PushTokenPayload;
  await unregisterPushToken(req.auth!.userId, payload.token);

  return sendSuccess(res, {
    message: "Push token unregistered.",
    data: {
      unregistered: true
    }
  });
});

notificationsRouter.get(
  "/inbox",
  validate(inboxQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    assertPushRoleSupported(req.auth!.role);
    const payload = req.query as unknown as z.infer<typeof inboxQuerySchema>;
    const notifications = await listUserNotificationInbox({
      userId: req.auth!.userId,
      limit: payload.limit
    });

    return sendSuccess(res, {
      data: {
        items: notifications
      }
    });
  })
);

notificationsRouter.get(
  "/unread-count",
  asyncHandler(async (req, res) => {
    assertPushRoleSupported(req.auth!.role);
    const count = await getUnreadUserNotificationCount(req.auth!.userId);

    return sendSuccess(res, {
      data: {
        count
      }
    });
  })
);

notificationsRouter.post(
  ["/register-token", "/register"],
  validate(pushTokenSchema),
  registerTokenHandler
);

devicesRouter.post("/fcm-token", validate(pushTokenSchema), registerTokenHandler);

notificationsRouter.get(
  "/debug-me",
  asyncHandler(async (req, res) => {
    assertPushRoleSupported(req.auth!.role);
    const debug = await getUserNotificationDebug(req.auth!.userId);

    return sendSuccess(res, {
      data: {
        userId: req.auth!.userId,
        role: req.auth!.role,
        salonId: req.auth!.salonId,
        staffId: req.auth!.staffId,
        firebaseConfigured: isFirebaseMessagingConfigured(),
        ...debug
      }
    });
  })
);

notificationsRouter.get(
  "/debug-salon",
  asyncHandler(async (req, res) => {
    if (req.auth!.role !== Role.SALON_OWNER || !req.auth!.salonId) {
      throw new AppError("Salon owner access is required.", 403, "FORBIDDEN");
    }
    const debug = await getSalonNotificationDebug(req.auth!.salonId);

    return sendSuccess(res, {
      data: {
        salonId: req.auth!.salonId,
        firebaseConfigured: isFirebaseMessagingConfigured(),
        ...debug
      }
    });
  })
);

notificationsRouter.post(
  "/test-token",
  validate(testTokenSchema),
  asyncHandler(async (req, res) => {
    assertPushRoleSupported(req.auth!.role);
    const payload = req.body as z.infer<typeof testTokenSchema>;
    const result = await sendTestPushToToken(payload.token, {
      title: payload.title ?? "FastAIBooking test",
      body: payload.body ?? "This is a test push notification.",
      type: "test_notification",
      salonId: req.auth!.salonId,
      data: payload.data
    });

    return sendSuccess(res, {
      message: "Test push processed.",
      data: result
    });
  })
);

notificationsRouter.post(
  "/test-user",
  validate(testUserSchema),
  asyncHandler(async (req, res) => {
    assertPushRoleSupported(req.auth!.role);
    const payload = req.body as z.infer<typeof testUserSchema>;
    const targetUserId = payload.userId ?? req.auth!.userId;

    if (targetUserId !== req.auth!.userId) {
      if (req.auth!.role !== Role.SALON_OWNER || !req.auth!.salonId) {
        throw new AppError("You can only send a test push to yourself.", 403, "FORBIDDEN");
      }

      const targetUser = await prisma.user.findFirst({
        where: {
          id: targetUserId,
          salonId: req.auth!.salonId,
          isActive: true
        },
        select: {
          id: true
        }
      });
      if (!targetUser) {
        throw new AppError("User is not available for push testing.", 403, "FORBIDDEN");
      }
    }

    const [result, tokenCount] = await Promise.all([
      sendPushToUserIds([targetUserId], {
        title: payload.title ?? "FastAIBooking test",
        body: payload.body ?? "This is a test push notification.",
        type: "test_notification",
        salonId: req.auth!.salonId,
        data: payload.data
      }),
      countUserPushTokens(targetUserId)
    ]);

    return sendSuccess(res, {
      message:
        tokenCount === 0
          ? "No push tokens registered for this user."
          : "User test push processed.",
      data: {
        tokenCount,
        ...result
      }
    });
  })
);

notificationsRouter.post(
  "/test-appointment",
  validate(testAppointmentSchema),
  asyncHandler(async (req, res) => {
    if (
      (req.auth!.role !== Role.SALON_OWNER && req.auth!.role !== Role.STAFF) ||
      !req.auth!.salonId
    ) {
      throw new AppError(
        "Appointment push testing is only available to salon owners and staff.",
        403,
        "FORBIDDEN"
      );
    }

    const input = req.body as z.infer<typeof testAppointmentSchema>;
    const targetUserId = input.userId ?? req.auth!.userId;

    if (req.auth!.role === Role.STAFF && targetUserId !== req.auth!.userId) {
      throw new AppError("Staff can only send an appointment test push to themselves.", 403, "FORBIDDEN");
    }

    if (req.auth!.role === Role.SALON_OWNER && targetUserId !== req.auth!.userId) {
      const targetUser = await prisma.user.findFirst({
        where: {
          id: targetUserId,
          salonId: req.auth!.salonId,
          isActive: true
        },
        select: {
          id: true
        }
      });
      if (!targetUser) {
        throw new AppError("User is not available for appointment push testing.", 403, "FORBIDDEN");
      }
    }

    const { payload } = await getAppointmentCreatedPushTestPayload(
      req.auth!.salonId,
      input.appointmentId
    );
    const tokenCount = await countUserPushTokens(targetUserId);
    const result = await sendPushToUserIds([targetUserId], payload);

    return sendSuccess(res, {
      message:
        tokenCount === 0
          ? "No push tokens registered for this user."
          : "Appointment test push processed.",
      data: {
        tokenCount,
        ...result
      }
    });
  })
);

notificationsRouter.post(
  "/:id/read",
  validate(notificationIdSchema, "params"),
  asyncHandler(async (req, res) => {
    assertPushRoleSupported(req.auth!.role);
    const { id } = req.params as z.infer<typeof notificationIdSchema>;
    const notification = await markUserNotificationRead(req.auth!.userId, id);
    if (!notification) {
      throw new AppError("Notification not found.", 404, "NOTIFICATION_NOT_FOUND");
    }

    return sendSuccess(res, {
      message: "Notification marked as read.",
      data: notification
    });
  })
);

notificationsRouter.post(
  "/read-all",
  asyncHandler(async (req, res) => {
    assertPushRoleSupported(req.auth!.role);
    const result = await markAllUserNotificationsRead(req.auth!.userId);

    return sendSuccess(res, {
      message: "Notifications marked as read.",
      data: {
        count: result.count
      }
    });
  })
);

notificationsRouter.post(
  ["/unregister-token", "/unregister"],
  validate(pushTokenSchema),
  unregisterTokenHandler
);

devicesRouter.post(
  "/fcm-token/unregister",
  validate(pushTokenSchema),
  unregisterTokenHandler
);
