import { Router } from "express";
import { Role } from "@prisma/client";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { AppError } from "../../lib/errors";
import { asyncHandler } from "../../middleware/async-handler";
import { requireRoles } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { sendSuccess } from "../../utils/response";
import { BILLING_PLAN_CODES } from "./billing.plans";
import {
  getBillingUsageHistoryForSalon,
  getCurrentBillingUsageForSalon,
  getSubscriptionBillingForSalon
} from "./billing.service";
import {
  getPhoneProvisioningForSalon,
  provisionPhoneNumberForSalon
} from "./phone-provisioning.service";
import {
  activateDeferredBilling,
  createDeferredBillingSetupIntent
} from "./deferred-billing.service";
import {
  constructStripeWebhookEvent,
  createRegistrationSetupIntent,
  getPublicRegistrationBillingConfig,
  handleStripeWebhookEvent
} from "./stripe-billing.service";

const querySchema = z.object({
  historyLimit: z.coerce.number().int().positive().max(24).default(6)
});

const setupIntentSchema = z.object({
  email: z.string().email(),
  planCode: z.enum(BILLING_PLAN_CODES)
});

const activateDeferredBillingSchema = z.object({
  setupIntentId: z.string().regex(/^seti_[A-Za-z0-9_]+$/)
});

const registrationSetupIntentRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: (_req, _res, next) => {
    next(
      new AppError(
        "Too many card verification attempts. Please try again later.",
        429,
        "REGISTRATION_RATE_LIMITED"
      )
    );
  }
});

export const billingRouter = Router();
export const billingPublicRouter = Router();
export const stripeWebhookRouter = Router();

billingPublicRouter.get(
  "/registration-config",
  asyncHandler(async (_req, res) => {
    return sendSuccess(res, {
      data: await getPublicRegistrationBillingConfig()
    });
  })
);

billingPublicRouter.post(
  "/registration/setup-intent",
  registrationSetupIntentRateLimit,
  validate(setupIntentSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof setupIntentSchema>;
    const setupIntent = await createRegistrationSetupIntent(payload);
    return sendSuccess(res, {
      statusCode: 201,
      message: "Secure Visa verification initialized.",
      data: setupIntent
    });
  })
);

stripeWebhookRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const signature = req.header("stripe-signature");
    if (!signature) {
      throw new AppError("Stripe signature is required.", 400, "STRIPE_SIGNATURE_REQUIRED");
    }
    if (!Buffer.isBuffer(req.body)) {
      throw new AppError("Stripe webhook body is invalid.", 400, "STRIPE_WEBHOOK_BODY_INVALID");
    }
    const event = constructStripeWebhookEvent(req.body, signature);
    await handleStripeWebhookEvent(event);
    return sendSuccess(res, {
      data: { received: true }
    });
  })
);

billingRouter.use(requireRoles(Role.SALON_OWNER));

billingRouter.get(
  "/usage",
  validate(querySchema, "query"),
  asyncHandler(async (req, res) => {
    const salonId = req.auth!.salonId!;
    const { historyLimit } = req.query as unknown as z.infer<typeof querySchema>;

    const currentUsage = await getCurrentBillingUsageForSalon(salonId);
    const history = await getBillingUsageHistoryForSalon(salonId, historyLimit);

    return sendSuccess(res, {
      data: {
        currentUsage,
        history
      }
    });
  })
);

billingRouter.post(
  "/payment-method/setup-intent",
  registrationSetupIntentRateLimit,
  asyncHandler(async (req, res) => {
    const setupIntent = await createDeferredBillingSetupIntent(
      req.auth!.salonId!,
      req.auth!.userId
    );
    return sendSuccess(res, {
      statusCode: 201,
      message: "Secure Visa verification initialized.",
      data: setupIntent
    });
  })
);

billingRouter.post(
  "/payment-method/activate",
  registrationSetupIntentRateLimit,
  validate(activateDeferredBillingSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof activateDeferredBillingSchema>;
    const result = await activateDeferredBilling(
      req.auth!.salonId!,
      req.auth!.userId,
      payload.setupIntentId
    );
    return sendSuccess(res, {
      message: "Payment method added and trial started.",
      data: result
    });
  })
);

billingRouter.get(
  "/subscription",
  asyncHandler(async (req, res) => {
    const salonId = req.auth!.salonId!;
    const subscription = await getSubscriptionBillingForSalon(salonId);
    const phoneProvisioning = await getPhoneProvisioningForSalon(salonId, true);
    return sendSuccess(res, {
      data: {
        subscription,
        phoneProvisioning
      }
    });
  })
);

billingRouter.get(
  "/phone-provisioning",
  asyncHandler(async (req, res) => {
    const salonId = req.auth!.salonId!;
    const reconcile = req.query.reconcile === "true";
    const phoneProvisioning = await getPhoneProvisioningForSalon(salonId, reconcile);
    return sendSuccess(res, {
      data: phoneProvisioning
    });
  })
);

billingRouter.post(
  "/phone-provisioning/retry",
  asyncHandler(async (req, res) => {
    const salonId = req.auth!.salonId!;
    const phoneProvisioning = await provisionPhoneNumberForSalon(salonId, req.auth!.userId);
    return sendSuccess(res, {
      data: phoneProvisioning
    });
  })
);
