import { Router } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler";
import { requireRoles } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { sendSuccess } from "../../utils/response";
import { getBusinessHours, updateBusinessHours } from "./business-hours.service";

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;

const businessHourSchema = z
  .object({
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    isOpen: z.boolean(),
    openTime: z.string().regex(timeRegex).nullable().optional(),
    closeTime: z.string().regex(timeRegex).nullable().optional()
  })
  .superRefine((value, ctx) => {
    if (!value.isOpen) {
      return;
    }
    if (!value.openTime || !value.closeTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Open days require both openTime and closeTime."
      });
      return;
    }
    if (value.openTime >= value.closeTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "closeTime must be later than openTime."
      });
    }
  });

const updateBusinessHoursSchema = z
  .object({
    hours: z.array(businessHourSchema).length(7)
  })
  .superRefine((value, ctx) => {
    const daySet = new Set(value.hours.map((item) => item.dayOfWeek));
    if (daySet.size !== 7) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Hours must include exactly one entry for each dayOfWeek (0-6)."
      });
    }
  });

export const businessHoursRouter = Router();

businessHoursRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const hours = await getBusinessHours(req.auth!.salonId!);
    return sendSuccess(res, {
      data: hours
    });
  })
);

businessHoursRouter.put(
  "/",
  requireRoles(Role.SALON_OWNER),
  validate(updateBusinessHoursSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof updateBusinessHoursSchema>;
    const hours = await updateBusinessHours(req.auth!.salonId!, req.auth!.userId, payload.hours);
    return sendSuccess(res, {
      message: "Business hours updated.",
      data: hours
    });
  })
);
