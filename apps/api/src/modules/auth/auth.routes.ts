import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler";
import { authenticate } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { sendSuccess } from "../../utils/response";
import { isValidUsPhone } from "../../utils/phone";
import {
  changePassword,
  forgotPassword,
  getAuthenticatedUserProfile,
  loginWithEmailPassword,
  logoutByRefreshToken,
  refreshAuthTokens,
  registerSalonOwner,
  resetPassword
} from "./auth.service";

const usPhoneSchema = z
  .string()
  .min(10)
  .max(25)
  .refine((value) => isValidUsPhone(value), "Phone must be a valid US phone number.");

const registerOwnerSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  phone: usPhoneSchema.optional(),
  password: z.string().min(8).max(128),
  salon: z.object({
    name: z.string().min(2).max(160),
    contactEmail: z.string().email().optional(),
    contactPhone: usPhoneSchema.optional(),
    timezone: z.string().min(2).max(64),
    addressLine1: z.string().max(200).optional(),
    addressLine2: z.string().max(200).optional(),
    city: z.string().max(120).optional(),
    state: z.string().max(120).optional(),
    postalCode: z.string().max(20).optional(),
    country: z.string().max(2).optional()
  })
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20)
});

const forgotPasswordSchema = z.object({
  email: z.string().email()
});

const resetPasswordSchema = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(8).max(128)
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z.string().min(8).max(128)
});

export const authRouter = Router();

authRouter.post(
  "/register-owner",
  validate(registerOwnerSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof registerOwnerSchema>;
    const result = await registerSalonOwner(payload);
    return sendSuccess(res, {
      statusCode: 201,
      message: "Salon owner registered successfully.",
      data: result
    });
  })
);

authRouter.post(
  "/login",
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof loginSchema>;
    const result = await loginWithEmailPassword(payload);
    return sendSuccess(res, {
      message: "Login successful.",
      data: result
    });
  })
);

authRouter.post(
  "/login-owner",
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof loginSchema>;
    const result = await loginWithEmailPassword(payload, Role.SALON_OWNER);
    return sendSuccess(res, {
      message: "Owner login successful.",
      data: result
    });
  })
);

authRouter.post(
  "/login-staff",
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof loginSchema>;
    const result = await loginWithEmailPassword(payload, Role.STAFF);
    return sendSuccess(res, {
      message: "Staff login successful.",
      data: result
    });
  })
);

authRouter.post(
  "/login-call-center",
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof loginSchema>;
    const result = await loginWithEmailPassword(payload, Role.CALL_CENTER_AGENT);
    return sendSuccess(res, {
      message: "Call center login successful.",
      data: result
    });
  })
);

authRouter.post(
  "/refresh",
  validate(refreshSchema),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as z.infer<typeof refreshSchema>;
    const result = await refreshAuthTokens(refreshToken);
    return sendSuccess(res, {
      message: "Token refreshed successfully.",
      data: result
    });
  })
);

authRouter.post(
  "/logout",
  validate(refreshSchema),
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body as z.infer<typeof refreshSchema>;
    await logoutByRefreshToken(refreshToken);
    return sendSuccess(res, {
      message: "Logout successful.",
      data: null
    });
  })
);

authRouter.post(
  "/forgot-password",
  validate(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    const { email } = req.body as z.infer<typeof forgotPasswordSchema>;
    await forgotPassword(email);
    return sendSuccess(res, {
      message: "If this email exists, a reset instruction has been sent.",
      data: null
    });
  })
);

authRouter.post(
  "/reset-password",
  validate(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const { token, newPassword } = req.body as z.infer<typeof resetPasswordSchema>;
    await resetPassword(token, newPassword);
    return sendSuccess(res, {
      message: "Password reset successful.",
      data: null
    });
  })
);

authRouter.post(
  "/change-password",
  authenticate,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;
    await changePassword(req.auth!.userId, currentPassword, newPassword);
    return sendSuccess(res, {
      message: "Password changed successfully.",
      data: null
    });
  })
);

authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const profile = await getAuthenticatedUserProfile(req.auth!.userId);
    return sendSuccess(res, {
      data: profile
    });
  })
);
