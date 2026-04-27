import { Router } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler";
import { requireRoles } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { isValidUsPhone } from "../../utils/phone";
import { sendSuccess } from "../../utils/response";
import {
  assertOwnerSalonAccess,
  generateAiReceptionForwardingCodeForSalon,
  getAiReceptionConfigForSalon,
  listAiReceptionCallLogsForSalon,
  markAiReceptionForwardingTestedForSalon,
  updateAiReceptionConfigForSalon
} from "../ai-reception/ai-reception.service";

const salonIdSchema = z.object({
  salonId: z.string().uuid()
});

const optionalUsPhoneSchema = z
  .string()
  .min(10)
  .max(25)
  .refine((value) => isValidUsPhone(value), "Phone must be a valid US phone number.")
  .nullable()
  .optional();

const aiReceptionStatusSchema = z.enum(["not_configured", "pending", "active", "failed"]);

const updateAiReceptionSchema = z.object({
  carrier: z.enum(["tmobile"]).optional(),
  originalPhoneNumber: optionalUsPhoneSchema,
  forwardingPhoneNumber: optionalUsPhoneSchema,
  status: aiReceptionStatusSchema.optional()
});

const listCallLogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20)
});

export const ownerRouter = Router();

ownerRouter.use(requireRoles(Role.SALON_OWNER));

ownerRouter.get(
  "/salons/:salonId/ai-reception",
  validate(salonIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    assertOwnerSalonAccess(req.auth?.salonId, salonId);
    const config = await getAiReceptionConfigForSalon(salonId);
    return sendSuccess(res, {
      data: config
    });
  })
);

ownerRouter.put(
  "/salons/:salonId/ai-reception",
  validate(salonIdSchema, "params"),
  validate(updateAiReceptionSchema),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const payload = req.body as z.infer<typeof updateAiReceptionSchema>;
    assertOwnerSalonAccess(req.auth?.salonId, salonId);
    const config = await updateAiReceptionConfigForSalon(salonId, req.auth!.userId, payload);
    return sendSuccess(res, {
      message: "AI Reception settings updated.",
      data: config
    });
  })
);

ownerRouter.post(
  "/salons/:salonId/ai-reception/generate-forwarding-code",
  validate(salonIdSchema, "params"),
  validate(updateAiReceptionSchema.partial()),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const payload = req.body as z.infer<typeof updateAiReceptionSchema>;
    assertOwnerSalonAccess(req.auth?.salonId, salonId);
    const config = await generateAiReceptionForwardingCodeForSalon(salonId, req.auth!.userId, payload);
    return sendSuccess(res, {
      message: "AI Reception forwarding code generated.",
      data: config
    });
  })
);

ownerRouter.post(
  "/salons/:salonId/ai-reception/mark-forwarding-tested",
  validate(salonIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    assertOwnerSalonAccess(req.auth?.salonId, salonId);
    const config = await markAiReceptionForwardingTestedForSalon(salonId, req.auth!.userId);
    return sendSuccess(res, {
      message: "AI Reception forwarding test recorded.",
      data: config
    });
  })
);

ownerRouter.get(
  "/salons/:salonId/call-logs",
  validate(salonIdSchema, "params"),
  validate(listCallLogsQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const query = req.query as unknown as z.infer<typeof listCallLogsQuerySchema>;
    assertOwnerSalonAccess(req.auth?.salonId, salonId);
    const result = await listAiReceptionCallLogsForSalon(salonId, query);
    return sendSuccess(res, {
      data: result
    });
  })
);
