import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler";
import { validate } from "../../middleware/validate";
import { AppError } from "../../lib/errors";
import { sendSuccess } from "../../utils/response";
import {
  getUnreadUserNotificationCount,
  listUserNotificationInbox,
  markAllUserNotificationsRead,
  markUserNotificationRead,
  registerPushToken,
  unregisterPushToken
} from "./notifications.service";

const supportedPushRoles = new Set([
  "SALON_OWNER",
  "STAFF",
  "CALL_CENTER_AGENT",
  "OPERATOR"
]);

const pushTokenSchema = z.object({
  token: z.string().trim().min(20).max(4096),
  platform: z.enum(["android", "ios", "web"]).optional().default("web")
});

const inboxQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).default(10)
});

const notificationIdSchema = z.object({
  id: z.string().uuid()
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
    const payload = req.body as z.infer<typeof pushTokenSchema>;
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
    const payload = req.body as z.infer<typeof pushTokenSchema>;
    await unregisterPushToken(req.auth!.userId, payload.token);

    return sendSuccess(res, {
      message: "Push token unregistered.",
      data: {
        unregistered: true
      }
    });
  })
);
