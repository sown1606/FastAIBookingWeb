import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { Role } from "@prisma/client";
import { asyncHandler } from "../../middleware/async-handler";
import { authenticate } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { sendSuccess } from "../../utils/response";
import { isValidUsPhone } from "../../utils/phone";
import { resolveRequestLanguage, SupportedLanguage } from "../../utils/language";
import { BILLING_PLAN_CODES } from "../billing/billing.plans";
import {
  createRegistrationLead,
  getRegistrationAssistantReply
} from "../registration/registration.service";
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

const registerOwnerSchema = z
  .object({
    fullName: z.string().min(2).max(120),
    email: z.string().email(),
    phone: usPhoneSchema.optional(),
    password: z.string().min(8).max(128),
    planCode: z.enum(BILLING_PLAN_CODES),
    setupIntentId: z.string().regex(/^seti_[A-Za-z0-9_]+$/).optional(),
    billingConsentAccepted: z.literal(true).optional(),
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
  })
  .superRefine((value, ctx) => {
    if (Boolean(value.setupIntentId) !== Boolean(value.billingConsentAccepted)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Card verification and billing consent must be provided together."
      });
    }
  });

const callbackRequestSchema = z.object({
  phone: usPhoneSchema,
  fullName: z.string().trim().min(2).max(120).optional(),
  email: z.string().email().optional(),
  note: z.string().trim().max(500).optional()
});

const registrationAssistantSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["assistant", "user"]),
        text: z.string().trim().min(1).max(1000)
      })
    )
    .min(1)
    .max(10)
});

const publicRegistrationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false
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

const authMessages = {
  registerOwner: {
    "vi-VN": "Đăng ký chủ salon thành công.",
    "en-US": "Salon owner registered successfully."
  },
  login: {
    "vi-VN": "Đăng nhập thành công.",
    "en-US": "Login successful."
  },
  loginOwner: {
    "vi-VN": "Đăng nhập chủ salon thành công.",
    "en-US": "Owner login successful."
  },
  loginStaff: {
    "vi-VN": "Đăng nhập nhân viên thành công.",
    "en-US": "Staff login successful."
  },
  loginCallCenter: {
    "vi-VN": "Đăng nhập tổng đài thành công.",
    "en-US": "Call center login successful."
  }
} satisfies Record<string, Record<SupportedLanguage, string>>;

authRouter.post(
  "/registration-callback",
  publicRegistrationRateLimit,
  validate(callbackRequestSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof callbackRequestSchema>;
    const lead = await createRegistrationLead(payload);
    return sendSuccess(res, {
      statusCode: 201,
      message: "Callback request saved.",
      data: {
        id: lead.id,
        status: lead.status,
        createdAt: lead.createdAt
      }
    });
  })
);

authRouter.post(
  "/registration-assistant",
  publicRegistrationRateLimit,
  validate(registrationAssistantSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof registrationAssistantSchema>;
    const reply = await getRegistrationAssistantReply({
      language: resolveRequestLanguage(req),
      messages: payload.messages
    });
    return sendSuccess(res, {
      data: reply
    });
  })
);

authRouter.post(
  "/register-owner",
  validate(registerOwnerSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof registerOwnerSchema>;
    const requestLanguage = resolveRequestLanguage(req);
    const result = await registerSalonOwner(payload, requestLanguage);
    return sendSuccess(res, {
      statusCode: 201,
      message: authMessages.registerOwner[result.user.language],
      data: result
    });
  })
);

authRouter.post(
  "/login",
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof loginSchema>;
    const requestLanguage = resolveRequestLanguage(req);
    const result = await loginWithEmailPassword(payload, undefined, requestLanguage);
    return sendSuccess(res, {
      message: authMessages.login[result.user.language],
      data: result
    });
  })
);

authRouter.post(
  "/login-owner",
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof loginSchema>;
    const requestLanguage = resolveRequestLanguage(req);
    const result = await loginWithEmailPassword(payload, Role.SALON_OWNER, requestLanguage);
    return sendSuccess(res, {
      message: authMessages.loginOwner[result.user.language],
      data: result
    });
  })
);

authRouter.post(
  "/login-staff",
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof loginSchema>;
    const requestLanguage = resolveRequestLanguage(req);
    const result = await loginWithEmailPassword(payload, Role.STAFF, requestLanguage);
    return sendSuccess(res, {
      message: authMessages.loginStaff[result.user.language],
      data: result
    });
  })
);

authRouter.post(
  "/login-call-center",
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof loginSchema>;
    const requestLanguage = resolveRequestLanguage(req);
    const result = await loginWithEmailPassword(payload, Role.CALL_CENTER_AGENT, requestLanguage);
    return sendSuccess(res, {
      message: authMessages.loginCallCenter[result.user.language],
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
