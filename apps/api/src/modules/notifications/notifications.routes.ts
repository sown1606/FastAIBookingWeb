import { Router } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../db/prisma";
import { asyncHandler } from "../../middleware/async-handler";
import { validate } from "../../middleware/validate";
import { AppError } from "../../lib/errors";
import { sendSuccess } from "../../utils/response";
import {
  countUserPushTokens,
  getUnreadUserNotificationCount,
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

const assertPushRoleSupported = (role: string): void => {
  if (!supportedPushRoles.has(role)) {
    throw new AppError("Push notifications are not supported for this role.", 403, "FORBIDDEN");
  }
};

export const notificationsRouter = Router();

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
  "/register-token",
  validate(pushTokenSchema),
  asyncHandler(async (req, res) => {
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
        id: pushToken.id,
        registered: true
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
      message: "User test push processed.",
      data: {
        ...result,
        tokenCount
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
  "/unregister-token",
  validate(pushTokenSchema),
  asyncHandler(async (req, res) => {
    assertPushRoleSupported(req.auth!.role);
    const payload = req.body as PushTokenPayload;
    await unregisterPushToken(req.auth!.userId, payload.token);

    return sendSuccess(res, {
      message: "Push token unregistered.",
      data: {
        unregistered: true
      }
    });
  })
);
