import { Router } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler";
import { sendSuccess } from "../../utils/response";
import { validate } from "../../middleware/validate";
import { requireRoles } from "../../middleware/auth";
import { isValidUsPhone } from "../../utils/phone";
import {
  getSalonOperatorNote,
  getSalonProfile,
  getSalonSettings,
  updateSalonProfile,
  updateSalonSettings
} from "./salon.service";

const optionalUsPhoneSchema = z
  .string()
  .min(10)
  .max(25)
  .refine((value) => isValidUsPhone(value), "Phone must be a valid US phone number.")
  .nullable()
  .optional();

const profileUpdateSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  contactEmail: z.string().email().nullable().optional(),
  contactPhone: optionalUsPhoneSchema,
  originalPhoneNumber: optionalUsPhoneSchema,
  customerIncomingPhoneNumber: optionalUsPhoneSchema,
  notificationPhoneNumber: optionalUsPhoneSchema,
  timezone: z.string().min(2).max(64).optional(),
  addressLine1: z.string().max(200).nullable().optional(),
  addressLine2: z.string().max(200).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  state: z.string().max(120).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  country: z.string().max(2).optional()
});

const settingsUpdateSchema = z.object({
  currency: z.string().min(3).max(3).optional(),
  locale: z.string().min(2).max(16).optional(),
  bookingLeadTimeMinutes: z.coerce.number().int().nonnegative().optional(),
  cancellationPolicy: z.string().max(1000).nullable().optional(),
  aiReceptionEnabled: z.boolean().optional(),
  aiForwardingEnabled: z.boolean().optional(),
  aiTransferRingCount: z.coerce.number().int().min(1).max(10).optional(),
  callCenterEnabled: z.boolean().optional(),
  voicemailEnabled: z.boolean().optional(),
  callbackRequestEnabled: z.boolean().optional(),
  smsFallbackEnabled: z.boolean().optional(),
  aiGreetingPrompt: z.string().max(2000).nullable().optional(),
  callerLanguage: z.string().min(2).max(16).optional(),
  callLogVisibility: z.enum(["OWNER_ONLY", "OWNER_AND_STAFF", "OWNER_STAFF_OPERATOR"]).optional(),
  notificationRecipients: z.array(z.string().min(3).max(160)).max(20).optional(),
  callCenterRoutingNumber: optionalUsPhoneSchema,
  callCenterRoutingNote: z.string().max(1000).nullable().optional()
});

export const salonRouter = Router();

salonRouter.get(
  "/staff-note",
  requireRoles(Role.SALON_OWNER, Role.STAFF),
  asyncHandler(async (req, res) => {
    const note = await getSalonOperatorNote(req.auth!.salonId!);
    return sendSuccess(res, {
      data: note
    });
  })
);

salonRouter.get(
  "/operator-note",
  requireRoles(Role.SALON_OWNER, Role.STAFF),
  asyncHandler(async (req, res) => {
    const note = await getSalonOperatorNote(req.auth!.salonId!);
    return sendSuccess(res, {
      data: note
    });
  })
);

salonRouter.use(requireRoles(Role.SALON_OWNER));

salonRouter.get(
  "/profile",
  asyncHandler(async (req, res) => {
    const salon = await getSalonProfile(req.auth!.salonId!);
    return sendSuccess(res, {
      data: salon
    });
  })
);

salonRouter.put(
  "/profile",
  validate(profileUpdateSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof profileUpdateSchema>;
    const salon = await updateSalonProfile(req.auth!.salonId!, req.auth!.userId, payload);
    return sendSuccess(res, {
      message: "Salon profile updated.",
      data: salon
    });
  })
);

salonRouter.get(
  "/settings",
  asyncHandler(async (req, res) => {
    const settings = await getSalonSettings(req.auth!.salonId!);
    return sendSuccess(res, {
      data: settings
    });
  })
);

salonRouter.put(
  "/settings",
  validate(settingsUpdateSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof settingsUpdateSchema>;
    const settings = await updateSalonSettings(req.auth!.salonId!, req.auth!.userId, {
      ...payload,
      aiReceptionEnabled: payload.aiReceptionEnabled ?? payload.aiForwardingEnabled
    });
    return sendSuccess(res, {
      message: "Salon settings updated.",
      data: settings
    });
  })
);
