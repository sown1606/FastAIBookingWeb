import Stripe from "stripe";
import { Role, SubscriptionStatus } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import {
  BillingPlanCode,
  BILLING_TRIAL_DAYS,
  getBillingPlan,
  getBillingPlans,
  hasOperatorTransferEntitlement,
  requireStripePriceId
} from "./billing.plans";
import {
  isAmazonConnectProvisioningConfigured,
  requireAmazonConnectProvisioningConfig
} from "./phone-provisioning.service";

let stripeClient: Stripe | null = null;

const getStripeClient = (): Stripe => {
  if (!env.STRIPE_SECRET_KEY) {
    throw new AppError(
      "Registration billing is not configured yet.",
      503,
      "STRIPE_REGISTRATION_NOT_CONFIGURED"
    );
  }
  stripeClient ??= new Stripe(env.STRIPE_SECRET_KEY);
  return stripeClient;
};

export const isStripeRegistrationConfigured = (): boolean =>
  env.integrationStatuses.stripe.registrationConfigured;

const hasActiveHumanReceptionStaff = async (): Promise<boolean> =>
  (await prisma.user.count({
    where: {
      role: Role.CALL_CENTER_AGENT,
      isActive: true
    }
  })) > 0;

const assertPlanOperationallyReady = async (planCode: BillingPlanCode): Promise<void> => {
  if (
    getBillingPlan(planCode).operatorTransferIncluded &&
    !(await hasActiveHumanReceptionStaff())
  ) {
    throw new AppError(
      "Real Person Reception is not staffed yet.",
      503,
      "HUMAN_RECEPTION_NOT_STAFFED"
    );
  }
};

export const getPublicRegistrationBillingConfig = async () => {
  const stripeReady = isStripeRegistrationConfigured();
  const humanReceptionStaffed = await hasActiveHumanReceptionStaff();
  const plans = getBillingPlans().map(
    ({ code, name, monthlyPriceCents, trialDays, operatorTransferIncluded }) => ({
      code,
      name,
      monthlyPriceCents,
      trialDays,
      operatorTransferIncluded,
      ready:
        stripeReady &&
        isAmazonConnectProvisioningConfigured(code) &&
        (!operatorTransferIncluded || humanReceptionStaffed)
    })
  );
  return {
    ready: plans.some((plan) => plan.ready),
    publishableKey: stripeReady ? env.STRIPE_PUBLISHABLE_KEY ?? null : null,
    trialDays: BILLING_TRIAL_DAYS,
    requiredCardBrand: "visa" as const,
    plans
  };
};

const assertStripeRegistrationConfigured = (): void => {
  if (!isStripeRegistrationConfigured()) {
    throw new AppError(
      "Registration billing is not configured yet.",
      503,
      "STRIPE_REGISTRATION_NOT_CONFIGURED"
    );
  }
};

export const createRegistrationSetupIntent = async (input: {
  email: string;
  planCode: BillingPlanCode;
}): Promise<{ setupIntentId: string; clientSecret: string }> => {
  assertStripeRegistrationConfigured();
  requireAmazonConnectProvisioningConfig(input.planCode);
  await assertPlanOperationallyReady(input.planCode);
  requireStripePriceId(input.planCode);
  const normalizedEmail = input.email.trim().toLowerCase();
  const setupIntent = await getStripeClient().setupIntents.create({
    usage: "off_session",
    payment_method_types: ["card"],
    metadata: {
      registration_email: normalizedEmail,
      plan_code: input.planCode
    }
  });

  if (!setupIntent.client_secret) {
    throw new AppError(
      "Unable to initialize secure card verification.",
      502,
      "STRIPE_SETUP_INTENT_FAILED"
    );
  }

  return {
    setupIntentId: setupIntent.id,
    clientSecret: setupIntent.client_secret
  };
};

export interface VerifiedRegistrationPayment {
  setupIntentId: string;
  paymentMethodId: string;
  cardBrand: string;
  cardLast4: string;
}

export const verifyRegistrationSetupIntent = async (input: {
  setupIntentId: string;
  email: string;
  planCode: BillingPlanCode;
}): Promise<VerifiedRegistrationPayment> => {
  assertStripeRegistrationConfigured();
  requireAmazonConnectProvisioningConfig(input.planCode);
  await assertPlanOperationallyReady(input.planCode);
  const stripe = getStripeClient();
  const setupIntent = await stripe.setupIntents.retrieve(input.setupIntentId, {
    expand: ["payment_method"]
  });
  const normalizedEmail = input.email.trim().toLowerCase();

  if (
    setupIntent.status !== "succeeded" ||
    setupIntent.metadata?.registration_email !== normalizedEmail ||
    setupIntent.metadata?.plan_code !== input.planCode
  ) {
    throw new AppError(
      "Card verification is incomplete or does not match this registration.",
      400,
      "STRIPE_SETUP_INTENT_INVALID"
    );
  }

  const paymentMethod =
    typeof setupIntent.payment_method === "string"
      ? await stripe.paymentMethods.retrieve(setupIntent.payment_method)
      : setupIntent.payment_method;

  if (!paymentMethod || paymentMethod.type !== "card" || !paymentMethod.card) {
    throw new AppError("A Visa card is required for the trial.", 400, "VISA_CARD_REQUIRED");
  }
  if (paymentMethod.card.brand !== "visa") {
    throw new AppError("A Visa card is required for the trial.", 400, "VISA_CARD_REQUIRED");
  }

  return {
    setupIntentId: setupIntent.id,
    paymentMethodId: paymentMethod.id,
    cardBrand: paymentMethod.card.brand,
    cardLast4: paymentMethod.card.last4
  };
};

const subscriptionPeriod = (subscription: Stripe.Subscription) => {
  const item = subscription.items.data[0];
  const periodStartUnix = item?.current_period_start ?? subscription.created;
  const periodEndUnix =
    subscription.trial_end ?? item?.current_period_end ?? periodStartUnix + 30 * 24 * 60 * 60;
  return {
    periodStart: new Date(periodStartUnix * 1000),
    periodEnd: new Date(periodEndUnix * 1000),
    trialEndsAt: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null
  };
};

export interface StripeTrialRegistration {
  customerId: string;
  subscriptionId: string;
  stripePriceId: string;
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt: Date | null;
}

export const mapStripeSubscriptionStatus = (
  status: Stripe.Subscription.Status
): SubscriptionStatus => {
  switch (status) {
    case "trialing":
      return SubscriptionStatus.TRIAL;
    case "active":
      return SubscriptionStatus.ACTIVE;
    case "past_due":
    case "unpaid":
    case "incomplete":
    case "incomplete_expired":
      return SubscriptionStatus.PAST_DUE;
    case "canceled":
    case "paused":
    default:
      return SubscriptionStatus.CANCELED;
  }
};

export const createStripeTrialRegistration = async (input: {
  registrationAttemptId: string;
  setupIntentId: string;
  paymentMethodId: string;
  planCode: BillingPlanCode;
  email: string;
  fullName: string;
  phone?: string;
}): Promise<StripeTrialRegistration> => {
  assertStripeRegistrationConfigured();
  const stripe = getStripeClient();
  const plan = getBillingPlan(input.planCode);
  const stripePriceId = requireStripePriceId(input.planCode);
  const idempotencyBase = `owner-registration-${input.registrationAttemptId}`;
  const stripePrice = await stripe.prices.retrieve(stripePriceId);
  if (
    !stripePrice.active ||
    stripePrice.currency !== "usd" ||
    stripePrice.unit_amount !== plan.monthlyPriceCents ||
    stripePrice.recurring?.interval !== "month" ||
    stripePrice.recurring.interval_count !== 1
  ) {
    throw new AppError(
      `Stripe Price configuration does not match the ${plan.name} monthly price.`,
      503,
      "STRIPE_PRICE_CONFIG_MISMATCH"
    );
  }

  const customer = await stripe.customers.create(
    {
      email: input.email.trim().toLowerCase(),
      name: input.fullName,
      phone: input.phone,
      metadata: {
        registration_attempt_id: input.registrationAttemptId,
        plan_code: input.planCode
      }
    },
    { idempotencyKey: `${idempotencyBase}-customer` }
  );

  await stripe.paymentMethods.attach(
    input.paymentMethodId,
    { customer: customer.id },
    { idempotencyKey: `${idempotencyBase}-attach-card` }
  );
  await stripe.customers.update(customer.id, {
    invoice_settings: {
      default_payment_method: input.paymentMethodId
    }
  });

  const subscription = await stripe.subscriptions.create(
    {
      customer: customer.id,
      items: [{ price: stripePriceId }],
      collection_method: "charge_automatically",
      default_payment_method: input.paymentMethodId,
      trial_period_days: plan.trialDays,
      trial_settings: {
        end_behavior: {
          missing_payment_method: "cancel"
        }
      },
      metadata: {
        registration_attempt_id: input.registrationAttemptId,
        plan_code: input.planCode
      }
    },
    { idempotencyKey: `${idempotencyBase}-subscription` }
  );
  const period = subscriptionPeriod(subscription);

  return {
    customerId: customer.id,
    subscriptionId: subscription.id,
    stripePriceId,
    status: mapStripeSubscriptionStatus(subscription.status),
    currentPeriodStart: period.periodStart,
    currentPeriodEnd: period.periodEnd,
    trialEndsAt: period.trialEndsAt
  };
};

export const retrieveStripeTrialRegistration = async (input: {
  customerId: string;
  subscriptionId: string;
  planCode: BillingPlanCode;
}): Promise<StripeTrialRegistration> => {
  const subscription = await getStripeClient().subscriptions.retrieve(input.subscriptionId);
  const period = subscriptionPeriod(subscription);
  return {
    customerId: input.customerId,
    subscriptionId: subscription.id,
    stripePriceId: requireStripePriceId(input.planCode),
    status: mapStripeSubscriptionStatus(subscription.status),
    currentPeriodStart: period.periodStart,
    currentPeriodEnd: period.periodEnd,
    trialEndsAt: period.trialEndsAt
  };
};

const stringId = (value: string | { id: string } | null): string | null => {
  if (!value) {
    return null;
  }
  return typeof value === "string" ? value : value.id;
};

const syncSubscription = async (subscription: Stripe.Subscription): Promise<void> => {
  const period = subscriptionPeriod(subscription);
  const stripeCustomerId = stringId(subscription.customer);
  const existing = await prisma.subscription.findFirst({
    where: {
      OR: [
        { stripeSubscriptionId: subscription.id },
        ...(stripeCustomerId ? [{ stripeCustomerId }] : [])
      ]
    },
    select: {
      salonId: true,
      planCode: true
    }
  });

  if (!existing) {
    logger.warn(
      { stripeSubscriptionId: subscription.id },
      "Ignoring Stripe subscription event without a matching salon"
    );
    return;
  }

  const status = mapStripeSubscriptionStatus(subscription.status);
  const operatorTransferEnabled = hasOperatorTransferEntitlement(existing.planCode, status);
  const subscriptionProvidesService =
    status === SubscriptionStatus.TRIAL || status === SubscriptionStatus.ACTIVE;
  await prisma.$transaction([
    prisma.subscription.update({
      where: { salonId: existing.salonId },
      data: {
        status,
        currentPeriodStart: period.periodStart,
        currentPeriodEnd: period.periodEnd,
        trialEndsAt: period.trialEndsAt,
        cancelAtPeriodEnd: subscription.cancel_at_period_end
      }
    }),
    prisma.salon.update({
      where: { id: existing.salonId },
      data: { subscriptionStatus: status }
    }),
    prisma.salonSetting.update({
      where: { salonId: existing.salonId },
      data: {
        aiForwardingEnabled: subscriptionProvidesService,
        aiReceptionEnabled: subscriptionProvidesService,
        callCenterEnabled: operatorTransferEnabled
      }
    })
  ]);
};

export const constructStripeWebhookEvent = (
  rawBody: Buffer,
  signature: string
): Stripe.Event => {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new AppError(
      "Stripe webhook is not configured.",
      503,
      "STRIPE_WEBHOOK_NOT_CONFIGURED"
    );
  }
  try {
    return getStripeClient().webhooks.constructEvent(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch {
    throw new AppError(
      "Stripe webhook signature is invalid.",
      400,
      "STRIPE_SIGNATURE_INVALID"
    );
  }
};

export const handleStripeWebhookEvent = async (event: Stripe.Event): Promise<void> => {
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object);
      return;
    default:
      return;
  }
};
