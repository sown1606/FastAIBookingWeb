import { Router } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler";
import { requireRoles } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { sendSuccess } from "../../utils/response";
import { createMessage, listMessagesForStaff, listOwnerStaffThreads } from "./messages.service";

const staffIdSchema = z.object({
  staffId: z.string().uuid()
});

const messageSchema = z.object({
  body: z.string().trim().min(1).max(2000)
});

export const messagesRouter = Router();

messagesRouter.get(
  "/threads",
  requireRoles(Role.SALON_OWNER),
  asyncHandler(async (req, res) => {
    const threads = await listOwnerStaffThreads(req.auth!.salonId!);
    return sendSuccess(res, {
      data: threads
    });
  })
);

messagesRouter.get(
  "/staff/:staffId",
  requireRoles(Role.SALON_OWNER),
  validate(staffIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { staffId } = req.params as z.infer<typeof staffIdSchema>;
    const messages = await listMessagesForStaff(req.auth!.salonId!, staffId);
    return sendSuccess(res, {
      data: messages
    });
  })
);

messagesRouter.post(
  "/staff/:staffId",
  requireRoles(Role.SALON_OWNER),
  validate(staffIdSchema, "params"),
  validate(messageSchema),
  asyncHandler(async (req, res) => {
    const { staffId } = req.params as z.infer<typeof staffIdSchema>;
    const payload = req.body as z.infer<typeof messageSchema>;
    const message = await createMessage({
      salonId: req.auth!.salonId!,
      senderUserId: req.auth!.userId,
      senderRole: req.auth!.role,
      staffId,
      body: payload.body
    });
    return sendSuccess(res, {
      statusCode: 201,
      message: "Message sent.",
      data: message
    });
  })
);

messagesRouter.get(
  "/me",
  requireRoles(Role.STAFF),
  asyncHandler(async (req, res) => {
    const messages = await listMessagesForStaff(req.auth!.salonId!, req.auth!.staffId!);
    return sendSuccess(res, {
      data: messages
    });
  })
);

messagesRouter.post(
  "/me",
  requireRoles(Role.STAFF),
  validate(messageSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof messageSchema>;
    const message = await createMessage({
      salonId: req.auth!.salonId!,
      senderUserId: req.auth!.userId,
      senderRole: req.auth!.role,
      staffId: req.auth!.staffId!,
      body: payload.body
    });
    return sendSuccess(res, {
      statusCode: 201,
      message: "Message sent.",
      data: message
    });
  })
);
