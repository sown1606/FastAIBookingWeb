import { Router } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler";
import { requireRoles } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { sendSuccess } from "../../utils/response";
import { isValidUsPhone } from "../../utils/phone";
import {
  createStaff,
  deactivateStaff,
  getStaffSelfProfile,
  listStaffSelfReminders,
  listStaff,
  reactivateStaff,
  resetStaffAccess,
  updateStaff,
  updateStaffSelfProfile
} from "./staff.service";

const staffQuerySchema = z.object({
  includeInactive: z
    .string()
    .optional()
    .transform((value) => value === "true")
});

const staffIdSchema = z.object({
  id: z.string().uuid()
});

const usPhoneSchema = z
  .string()
  .min(10)
  .max(25)
  .refine((value) => isValidUsPhone(value), "Phone must be a valid US phone number.");

const avatarUrlSchema = z
  .preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.union([z.string().max(2048).url(), z.literal(""), z.null()])
  )
  .optional();

const createStaffSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  phone: usPhoneSchema,
  title: z.string().max(120).optional(),
  avatarUrl: avatarUrlSchema,
  isBookable: z.boolean().optional(),
  createLogin: z.boolean().optional(),
  password: z.string().min(8).max(128).optional()
});

const updateStaffSchema = z.object({
  fullName: z.string().min(2).max(120).optional(),
  email: z.string().email().optional(),
  phone: usPhoneSchema.optional(),
  title: z.string().max(120).nullable().optional(),
  avatarUrl: avatarUrlSchema,
  isBookable: z.boolean().optional()
});

const resetStaffAccessSchema = z.object({
  newPassword: z.string().min(8).max(128)
});

const updateStaffSelfSchema = z.object({
  fullName: z.string().min(2).max(120).optional(),
  phone: usPhoneSchema.optional(),
  avatarUrl: avatarUrlSchema
});

export const staffRouter = Router();

staffRouter.get(
  "/me/profile",
  requireRoles(Role.STAFF),
  asyncHandler(async (req, res) => {
    const profile = await getStaffSelfProfile(
      req.auth!.salonId!,
      req.auth!.userId,
      req.auth!.staffId!
    );
    return sendSuccess(res, {
      data: profile
    });
  })
);

staffRouter.get(
  "/me/reminders",
  requireRoles(Role.STAFF),
  asyncHandler(async (req, res) => {
    const reminders = await listStaffSelfReminders(req.auth!.salonId!, req.auth!.staffId!);
    return sendSuccess(res, {
      data: reminders
    });
  })
);

staffRouter.put(
  "/me/profile",
  requireRoles(Role.STAFF),
  validate(updateStaffSelfSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof updateStaffSelfSchema>;
    const profile = await updateStaffSelfProfile(
      req.auth!.salonId!,
      req.auth!.userId,
      req.auth!.staffId!,
      payload
    );
    return sendSuccess(res, {
      message: "Profile updated.",
      data: profile
    });
  })
);

staffRouter.get(
  "/",
  requireRoles(Role.SALON_OWNER),
  validate(staffQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const { includeInactive } = req.query as unknown as z.infer<typeof staffQuerySchema>;
    const staff = await listStaff(req.auth!.salonId!, includeInactive);
    return sendSuccess(res, {
      data: staff
    });
  })
);

staffRouter.post(
  "/",
  requireRoles(Role.SALON_OWNER),
  validate(createStaffSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof createStaffSchema>;
    const result = await createStaff(req.auth!.salonId!, req.auth!.userId, payload);
    return sendSuccess(res, {
      statusCode: 201,
      message: "Staff created.",
      data: result
    });
  })
);

staffRouter.patch(
  "/:id",
  requireRoles(Role.SALON_OWNER),
  validate(staffIdSchema, "params"),
  validate(updateStaffSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof staffIdSchema>;
    const payload = req.body as z.infer<typeof updateStaffSchema>;
    const staff = await updateStaff(req.auth!.salonId!, id, req.auth!.userId, payload);
    return sendSuccess(res, {
      message: "Staff updated.",
      data: staff
    });
  })
);

staffRouter.post(
  "/:id/deactivate",
  requireRoles(Role.SALON_OWNER),
  validate(staffIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof staffIdSchema>;
    const result = await deactivateStaff(req.auth!.salonId!, id, req.auth!.userId);
    return sendSuccess(res, {
      message: "Staff deactivated.",
      data: result
    });
  })
);

staffRouter.post(
  "/:id/reactivate",
  requireRoles(Role.SALON_OWNER),
  validate(staffIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof staffIdSchema>;
    const result = await reactivateStaff(req.auth!.salonId!, id, req.auth!.userId);
    return sendSuccess(res, {
      message: "Staff reactivated.",
      data: result
    });
  })
);

staffRouter.post(
  "/:id/reset-access",
  requireRoles(Role.SALON_OWNER),
  validate(staffIdSchema, "params"),
  validate(resetStaffAccessSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof staffIdSchema>;
    const { newPassword } = req.body as z.infer<typeof resetStaffAccessSchema>;
    const staff = await resetStaffAccess(req.auth!.salonId!, id, req.auth!.userId, newPassword);
    return sendSuccess(res, {
      message: "Staff access reset.",
      data: staff
    });
  })
);
