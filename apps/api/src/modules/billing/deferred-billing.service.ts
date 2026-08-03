import { randomUUID } from "crypto";
import {
  OwnerRegistrationStatus,
  PhoneProvisioningStatus,
  Role,
  SubscriptionStatus
} from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { isBillingPlanCode, getBillingPlan } from "./billing.plans";
import {
  getPhoneProvisioningForSalon,
  provisionPhoneNumberForSalon
} from "./phone-provisioning.service";
import {
  createRegistrationSetupIntent,
  createStripeTrialRegistration,
  retrieveStripeTrialRegistration,
  verifyRegistrationSetupIntent
} from "./stripe-billing.service";

const getDeferredBillingContext = async (salonId: string, userId: string) => {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      salonId,
      role: Role.SALON_OWNER,
      isActive: true
    },
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true
    }
  });
  const subscription = await prisma.subscription.findUnique({
    where: { salonId }
  });
  if (!user || !subscription || !isBillingPlanCode(subscription.planCode)) {
    throw new AppError("Pending billing setup was not found.", 404, "PENDING_BILLING_NOT_FOUND");
  }
  return {
    user,
    subscription,
    planCode: subscription.planCode
  };
};

export const createDeferredBillingSetupIntent = async (salonId: string, userId: string) => {
  const context = await getDeferredBillingContext(salonId, userId);
  if (context.subscription.status !== SubscriptionStatus.PENDING_PAYMENT) {
    throw new AppError(
      "This subscription does not require a payment method.",
      409,
      "PAYMENT_METHOD_NOT_REQUIRED"
    );
  }
  return createRegistrationSetupIntent({
    email: context.user.email,
    planCode: context.planCode
  });
};

export const activateDeferredBilling = async (
  salonId: string,
  userId: string,
  setupIntentId: string
) => {
  const context = await getDeferredBillingContext(salonId, userId);
  if (
    context.subscription.status !== SubscriptionStatus.PENDING_PAYMENT &&
    context.subscription.stripeSetupIntentId === setupIntentId
  ) {
    return {
      subscription: context.subscription,
      phoneProvisioning: await getPhoneProvisioningForSalon(salonId, true)
    };
  }
  if (context.subscription.status !== SubscriptionStatus.PENDING_PAYMENT) {
    throw new AppError(
      "This subscription does not require a payment method.",
      409,
      "PAYMENT_METHOD_NOT_REQUIRED"
    );
  }

  const verifiedPayment = await verifyRegistrationSetupIntent({
    setupIntentId,
    email: context.user.email,
    planCode: context.planCode
  });
  const expiresAt = new Date(
    Date.now() + env.REGISTRATION_ATTEMPT_TTL_MINUTES * 60 * 1000
  );
  const attempt = await prisma.ownerRegistrationAttempt.upsert({
    where: { setupIntentId },
    create: {
      email: context.user.email,
      setupIntentId,
      planCode: context.planCode,
      expiresAt
    },
    update: {},
    select: {
      id: true,
      email: true,
      planCode: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true
    }
  });
  if (attempt.email !== context.user.email || attempt.planCode !== context.planCode) {
    throw new AppError(
      "Card verification does not match this account.",
      409,
      "REGISTRATION_ATTEMPT_MISMATCH"
    );
  }

  let stripeRegistration;
  if (attempt.stripeCustomerId && attempt.stripeSubscriptionId) {
    stripeRegistration = await retrieveStripeTrialRegistration({
      customerId: attempt.stripeCustomerId,
      subscriptionId: attempt.stripeSubscriptionId,
      planCode: context.planCode
    });
  } else {
    try {
      stripeRegistration = await createStripeTrialRegistration({
        registrationAttemptId: attempt.id,
        setupIntentId,
        paymentMethodId: verifiedPayment.paymentMethodId,
        planCode: context.planCode,
        email: context.user.email,
        fullName: context.user.fullName,
        phone: context.user.phone ?? undefined
      });
      await prisma.ownerRegistrationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: OwnerRegistrationStatus.BILLING_READY,
          stripeCustomerId: stripeRegistration.customerId,
          stripeSubscriptionId: stripeRegistration.subscriptionId,
          lastErrorCode: null
        }
      });
    } catch (error) {
      await prisma.ownerRegistrationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: OwnerRegistrationStatus.FAILED,
          lastErrorCode: error instanceof AppError ? error.code : "STRIPE_SUBSCRIPTION_FAILED"
        }
      });
      throw error;
    }
  }

  if (
    stripeRegistration.status !== SubscriptionStatus.TRIAL ||
    !stripeRegistration.trialEndsAt ||
    stripeRegistration.trialEndsAt.getTime() <= Date.now()
  ) {
    throw new AppError(
      "Stripe subscription is not in an active trial.",
      409,
      "STRIPE_SUBSCRIPTION_NOT_TRIALING"
    );
  }

  const plan = getBillingPlan(context.planCode);
  await prisma.$transaction(async (tx) => {
    let assignedHumanAgentCount = 0;
    if (plan.operatorTransferIncluded) {
      const activeAgents = await tx.user.findMany({
        where: {
          role: Role.CALL_CENTER_AGENT,
          isActive: true
        },
        select: { id: true }
      });
      if (!activeAgents.length) {
        throw new AppError(
          "Real Person Reception is not staffed yet.",
          503,
          "HUMAN_RECEPTION_NOT_STAFFED"
        );
      }
      await tx.callCenterSalonAssignment.createMany({
        data: activeAgents.map((agent) => ({
          salonId,
          agentUserId: agent.id,
          assignedByUserId: userId
        })),
        skipDuplicates: true
      });
      assignedHumanAgentCount = activeAgents.length;
    }

    await tx.subscription.update({
      where: { salonId },
      data: {
        status: stripeRegistration.status,
        currentPeriodStart: stripeRegistration.currentPeriodStart,
        currentPeriodEnd: stripeRegistration.currentPeriodEnd,
        trialEndsAt: stripeRegistration.trialEndsAt,
        stripeCustomerId: stripeRegistration.customerId,
        stripeSubscriptionId: stripeRegistration.subscriptionId,
        stripeSetupIntentId: verifiedPayment.setupIntentId,
        stripePriceId: stripeRegistration.stripePriceId,
        paymentMethodBrand: verifiedPayment.cardBrand,
        paymentMethodLast4: verifiedPayment.cardLast4
      }
    });
    await tx.salon.update({
      where: { id: salonId },
      data: {
        planName: context.planCode,
        subscriptionStatus: stripeRegistration.status
      }
    });
    await tx.phoneProvisioning.upsert({
      where: { salonId },
      create: {
        salonId,
        status: PhoneProvisioningStatus.PENDING,
        claimClientToken: randomUUID()
      },
      update: {}
    });
    await tx.ownerRegistrationAttempt.update({
      where: { id: attempt.id },
      data: {
        status: OwnerRegistrationStatus.COMPLETED,
        completedAt: new Date(),
        lastErrorCode: null
      }
    });
    await createAuditLog(
      {
        salonId,
        actorUserId: userId,
        action: "DEFERRED_PAYMENT_COMPLETED",
        entityType: "Subscription",
        entityId: stripeRegistration.subscriptionId,
        metadata: {
          planCode: context.planCode,
          monthlyPriceCents: plan.monthlyPriceCents,
          trialDays: plan.trialDays,
          paymentMethodBrand: verifiedPayment.cardBrand,
          paymentMethodLast4: verifiedPayment.cardLast4,
          assignedHumanAgentCount
        }
      },
      tx
    );
  });

  let phoneProvisioning;
  try {
    phoneProvisioning = await provisionPhoneNumberForSalon(salonId, userId);
  } catch (error) {
    logger.error(
      {
        salonId,
        error: error instanceof Error ? error.message : String(error)
      },
      "Deferred billing completed but phone provisioning needs a retry."
    );
    phoneProvisioning = await getPhoneProvisioningForSalon(salonId);
  }
  const subscription = await prisma.subscription.findUniqueOrThrow({ where: { salonId } });
  return {
    subscription,
    phoneProvisioning
  };
};
