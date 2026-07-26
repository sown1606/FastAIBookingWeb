import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import {
  OwnerRegistrationStatus,
  PhoneProvisioningStatus,
  Prisma,
  Role,
  SalonStatus,
  SubscriptionStatus
} from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";
import { generateSecureToken, hashToken } from "../../lib/crypto";
import { AppError } from "../../lib/errors";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../lib/jwt";
import { logger } from "../../lib/logger";
import { sendPasswordResetEmail } from "../../lib/mailer";
import { hashPassword, verifyPassword } from "../../lib/password";
import { DEFAULT_LANGUAGE, resolveUserLanguage, SupportedLanguage } from "../../utils/language";
import { requireUsPhone } from "../../utils/phone";
import { BillingPlanCode, getBillingPlan } from "../billing/billing.plans";
import {
  getPhoneProvisioningForSalon,
  PhoneProvisioningResult,
  provisionPhoneNumberForSalon
} from "../billing/phone-provisioning.service";
import {
  createStripeTrialRegistration,
  retrieveStripeTrialRegistration,
  verifyRegistrationSetupIntent
} from "../billing/stripe-billing.service";

interface RegisterOwnerInput {
  fullName: string;
  email: string;
  password: string;
  planCode: BillingPlanCode;
  setupIntentId: string;
  billingConsentAccepted: true;
  phone?: string;
  salon: {
    name: string;
    contactEmail?: string;
    contactPhone?: string;
    timezone: string;
    addressLine1?: string;
    addressLine2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
}

interface LoginInput {
  email: string;
  password: string;
}

const createDefaultBusinessHours = async (
  salonId: string,
  executor: Prisma.TransactionClient
): Promise<void> => {
  const defaultHours = [
    { dayOfWeek: 0, isOpen: false, openTime: null, closeTime: null },
    { dayOfWeek: 1, isOpen: true, openTime: "09:00", closeTime: "18:00" },
    { dayOfWeek: 2, isOpen: true, openTime: "09:00", closeTime: "18:00" },
    { dayOfWeek: 3, isOpen: true, openTime: "09:00", closeTime: "18:00" },
    { dayOfWeek: 4, isOpen: true, openTime: "09:00", closeTime: "18:00" },
    { dayOfWeek: 5, isOpen: true, openTime: "09:00", closeTime: "18:00" },
    { dayOfWeek: 6, isOpen: true, openTime: "09:00", closeTime: "16:00" }
  ];

  await executor.businessHour.createMany({
    data: defaultHours.map((item) => ({
      ...item,
      salonId
    }))
  });
};

const DEFAULT_REGISTRATION_SERVICES = [
  {
    name: "Manicure",
    description: "Cuticle care, shaping, polish, and hand massage.",
    durationMinutes: 40,
    priceCents: 3_500
  },
  {
    name: "Pedicure",
    description: "Soak, scrub, callus care, massage, and polish.",
    durationMinutes: 45,
    priceCents: 4_500
  },
  {
    name: "Gel Manicure",
    description: "Cuticle care, shaping, gel color, and hand massage.",
    durationMinutes: 60,
    priceCents: 5_000
  },
  {
    name: "Full Set",
    description: "Full acrylic set with shaping and gel finish.",
    durationMinutes: 100,
    priceCents: 8_500
  },
  {
    name: "Dip Powder",
    description: "Prep, dip color layers, shaping, and glossy top coat.",
    durationMinutes: 70,
    priceCents: 5_800
  },
  {
    name: "Other Services",
    description: "Custom service or add-on. Staff confirms details before the appointment.",
    durationMinutes: 60,
    priceCents: 0
  }
] as const;

const createDefaultServices = async (
  salonId: string,
  executor: Prisma.TransactionClient
): Promise<void> => {
  await executor.service.createMany({
    data: DEFAULT_REGISTRATION_SERVICES.map((service) => ({
      salonId,
      ...service
    }))
  });
};

const issueTokens = async (user: {
  id: string;
  email: string;
  role: Role;
  salonId: string | null;
  staffId: string | null;
}): Promise<{ accessToken: string; refreshToken: string }> => {
  const accessToken = signAccessToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    salonId: user.salonId,
    staffId: user.staffId
  });

  const jti = randomUUID();
  const refreshToken = signRefreshToken({
    userId: user.id,
    email: user.email,
    role: user.role,
    salonId: user.salonId,
    staffId: user.staffId,
    jti
  });
  const refreshPayload = jwt.decode(refreshToken) as jwt.JwtPayload | null;
  if (!refreshPayload?.exp) {
    throw new AppError("Failed to create refresh token.", 500, "TOKEN_ERROR");
  }
  const refreshTokenExpiresAt = new Date(refreshPayload.exp * 1000);

  await prisma.refreshToken.create({
    data: {
      jti,
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: refreshTokenExpiresAt
    }
  });

  return {
    accessToken,
    refreshToken
  };
};

const normalizeOptionalPhone = (value: string | undefined, label: string): string | undefined => {
  return value ? requireUsPhone(value, label) : undefined;
};

interface RegisteredOwnerResult {
  user: {
    id: string;
    fullName: string;
    email: string;
    role: Role;
    salonId: string | null;
    staffId: string | null;
    language: SupportedLanguage;
  };
  salon: {
    id: string;
    name: string;
    timezone: string;
    status: SalonStatus;
    subscriptionStatus: SubscriptionStatus;
  };
  phoneProvisioning: PhoneProvisioningResult | null;
  accessToken: string;
  refreshToken: string;
}

const provisionRegisteredSalon = async (
  salonId: string,
  actorUserId: string
): Promise<PhoneProvisioningResult | null> => {
  try {
    return await provisionPhoneNumberForSalon(salonId, actorUserId);
  } catch (error) {
    logger.error(
      {
        salonId,
        errorCode: error instanceof AppError ? error.code : "PHONE_PROVISIONING_START_FAILED"
      },
      "Unable to start phone provisioning after owner registration"
    );
    return getPhoneProvisioningForSalon(salonId);
  }
};

const completeExistingRegistration = async (
  input: RegisterOwnerInput,
  requestLanguage: SupportedLanguage
): Promise<RegisteredOwnerResult | null> => {
  const existing = await prisma.user.findUnique({
    where: { email: input.email.trim().toLowerCase() },
    include: {
      salon: {
        include: {
          subscription: true
        }
      }
    }
  });
  if (!existing) {
    return null;
  }
  if (
    existing.role !== Role.SALON_OWNER ||
    !existing.salon ||
    existing.salon.subscription?.stripeSetupIntentId !== input.setupIntentId
  ) {
    throw new AppError("Email is already registered.", 409, "EMAIL_ALREADY_EXISTS");
  }
  if (!(await verifyPassword(input.password, existing.passwordHash))) {
    throw new AppError("Email is already registered.", 409, "EMAIL_ALREADY_EXISTS");
  }

  const tokens = await issueTokens({
    id: existing.id,
    email: existing.email,
    role: existing.role,
    salonId: existing.salonId,
    staffId: existing.staffId
  });
  const phoneProvisioning = await provisionRegisteredSalon(existing.salon.id, existing.id);

  return {
    user: {
      id: existing.id,
      fullName: existing.fullName,
      email: existing.email,
      role: existing.role,
      salonId: existing.salonId,
      staffId: existing.staffId,
      language: resolveUserLanguage(existing.language, requestLanguage)
    },
    salon: {
      id: existing.salon.id,
      name: existing.salon.name,
      timezone: existing.salon.timezone,
      status: existing.salon.status,
      subscriptionStatus: existing.salon.subscriptionStatus
    },
    phoneProvisioning,
    ...tokens
  };
};

export const registerSalonOwner = async (
  input: RegisterOwnerInput,
  requestLanguage: SupportedLanguage = DEFAULT_LANGUAGE
): Promise<RegisteredOwnerResult> => {
  const normalizedEmail = input.email.trim().toLowerCase();
  const completedRegistration = await completeExistingRegistration(input, requestLanguage);
  if (completedRegistration) {
    return completedRegistration;
  }

  const verifiedPayment = await verifyRegistrationSetupIntent({
    setupIntentId: input.setupIntentId,
    email: normalizedEmail,
    planCode: input.planCode
  });
  const plan = getBillingPlan(input.planCode);
  const expiresAt = new Date(
    Date.now() + env.REGISTRATION_ATTEMPT_TTL_MINUTES * 60 * 1000
  );
  const attempt = await prisma.ownerRegistrationAttempt.upsert({
    where: { setupIntentId: input.setupIntentId },
    create: {
      email: normalizedEmail,
      setupIntentId: input.setupIntentId,
      planCode: input.planCode,
      expiresAt
    },
    update: {},
    select: {
      id: true,
      email: true,
      planCode: true,
      status: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      expiresAt: true
    }
  });
  if (attempt.email !== normalizedEmail || attempt.planCode !== input.planCode) {
    throw new AppError(
      "Card verification does not match this registration.",
      409,
      "REGISTRATION_ATTEMPT_MISMATCH"
    );
  }
  if (
    attempt.expiresAt.getTime() < Date.now() &&
    attempt.status !== OwnerRegistrationStatus.BILLING_READY
  ) {
    throw new AppError(
      "Card verification has expired. Please verify the card again.",
      410,
      "REGISTRATION_ATTEMPT_EXPIRED"
    );
  }

  const passwordHash = await hashPassword(input.password);
  const ownerPhone = normalizeOptionalPhone(input.phone, "Owner phone");
  const salonContactPhone = normalizeOptionalPhone(input.salon.contactPhone ?? input.phone, "Salon phone");
  let stripeRegistration;
  if (attempt.stripeCustomerId && attempt.stripeSubscriptionId) {
    stripeRegistration = await retrieveStripeTrialRegistration({
      customerId: attempt.stripeCustomerId,
      subscriptionId: attempt.stripeSubscriptionId,
      planCode: input.planCode
    });
  } else {
    try {
      stripeRegistration = await createStripeTrialRegistration({
        registrationAttemptId: attempt.id,
        setupIntentId: input.setupIntentId,
        paymentMethodId: verifiedPayment.paymentMethodId,
        planCode: input.planCode,
        email: normalizedEmail,
        fullName: input.fullName,
        phone: ownerPhone
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

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: normalizedEmail,
        fullName: input.fullName,
        passwordHash,
        phone: ownerPhone,
        language: requestLanguage,
        role: Role.SALON_OWNER
      }
    });

    const salon = await tx.salon.create({
      data: {
        name: input.salon.name,
        contactEmail: input.salon.contactEmail ?? input.email.toLowerCase(),
        contactPhone: salonContactPhone,
        originalPhoneNumber: salonContactPhone,
        notificationPhoneNumber: salonContactPhone ?? ownerPhone,
        timezone: input.salon.timezone,
        status: SalonStatus.PENDING,
        ownerId: user.id,
        addressLine1: input.salon.addressLine1,
        addressLine2: input.salon.addressLine2,
        city: input.salon.city,
        state: input.salon.state,
        postalCode: input.salon.postalCode,
        country: input.salon.country ?? "US",
        planName: input.planCode,
        subscriptionStatus: stripeRegistration.status
      }
    });

    await tx.user.update({
      where: { id: user.id },
      data: { salonId: salon.id }
    });

    await tx.salonSetting.create({
      data: {
        salonId: salon.id
      }
    });

    await tx.subscription.create({
      data: {
        salonId: salon.id,
        planCode: input.planCode,
        status: stripeRegistration.status,
        basePriceCents: plan.monthlyPriceCents,
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

    await tx.phoneProvisioning.create({
      data: {
        salonId: salon.id,
        status: PhoneProvisioningStatus.PENDING,
        claimClientToken: randomUUID()
      }
    });

    let assignedHumanAgentCount = 0;
    if (plan.operatorTransferIncluded) {
      const activeAgents = await tx.user.findMany({
        where: {
          role: Role.CALL_CENTER_AGENT,
          isActive: true
        },
        select: {
          id: true
        }
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
          salonId: salon.id,
          agentUserId: agent.id,
          assignedByUserId: user.id
        }))
      });
      assignedHumanAgentCount = activeAgents.length;
    }

    await createDefaultServices(salon.id, tx);
    await createDefaultBusinessHours(salon.id, tx);

    await createAuditLog(
      {
        salonId: salon.id,
        actorUserId: user.id,
        action: "OWNER_REGISTERED",
        entityType: "User",
        entityId: user.id
      },
      tx
    );

    await createAuditLog(
      {
        salonId: salon.id,
        actorUserId: user.id,
        action: "SALON_CREATED",
        entityType: "Salon",
        entityId: salon.id
      },
      tx
    );

    await createAuditLog(
      {
        salonId: salon.id,
        actorUserId: user.id,
        action: "TRIAL_SUBSCRIPTION_STARTED",
        entityType: "Subscription",
        entityId: stripeRegistration.subscriptionId,
        metadata: {
          planCode: input.planCode,
          monthlyPriceCents: plan.monthlyPriceCents,
          trialDays: plan.trialDays,
          paymentMethodBrand: verifiedPayment.cardBrand,
          paymentMethodLast4: verifiedPayment.cardLast4,
          billingConsentAccepted: input.billingConsentAccepted,
          billingTermsVersion: "trial_30d_monthly_v1",
          assignedHumanAgentCount
        }
      },
      tx
    );

    await tx.ownerRegistrationAttempt.update({
      where: { id: attempt.id },
      data: {
        status: OwnerRegistrationStatus.COMPLETED,
        completedAt: new Date(),
        lastErrorCode: null
      }
    });

    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        salonId: salon.id,
        staffId: null,
        language: requestLanguage
      },
      salon: {
        id: salon.id,
        name: salon.name,
        timezone: salon.timezone,
        status: salon.status,
        subscriptionStatus: salon.subscriptionStatus
      }
    };
  });

  const tokens = await issueTokens({
    id: result.user.id,
    email: result.user.email,
    role: result.user.role,
    salonId: result.user.salonId,
    staffId: result.user.staffId
  });
  const phoneProvisioning = await provisionRegisteredSalon(result.salon.id, result.user.id);

  return {
    ...result,
    phoneProvisioning,
    ...tokens
  };
};

export const loginWithEmailPassword = async (
  input: LoginInput,
  expectedRole?: Role,
  requestLanguage: SupportedLanguage = DEFAULT_LANGUAGE
): Promise<{
  user: {
    id: string;
    email: string;
    fullName: string;
    role: Role;
    salonId: string | null;
    staffId: string | null;
    language: SupportedLanguage;
  };
  accessToken: string;
  refreshToken: string;
}> => {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() }
  });

  if (!user || !user.isActive) {
    throw new AppError("Invalid login credentials.", 401, "INVALID_CREDENTIALS");
  }

  const passwordMatched = await verifyPassword(input.password, user.passwordHash);
  if (!passwordMatched) {
    throw new AppError("Invalid login credentials.", 401, "INVALID_CREDENTIALS");
  }

  if (expectedRole && user.role !== expectedRole) {
    throw new AppError("Role is not allowed for this login.", 403, "FORBIDDEN");
  }

  if (user.role === Role.STAFF && (!user.salonId || !user.staffId)) {
    throw new AppError("Staff access is not configured.", 403, "FORBIDDEN");
  }

  const tokens = await issueTokens({
    id: user.id,
    email: user.email,
    role: user.role,
    salonId: user.salonId,
    staffId: user.staffId
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      salonId: user.salonId,
      staffId: user.staffId,
      language: resolveUserLanguage(user.language, requestLanguage)
    },
    ...tokens
  };
};

export const refreshAuthTokens = async (
  refreshToken: string
): Promise<{
  accessToken: string;
  refreshToken: string;
}> => {
  const payload = verifyRefreshToken(refreshToken);

  if (payload.type !== "refresh" || !payload.jti) {
    throw new AppError("Invalid refresh token.", 401, "UNAUTHORIZED");
  }

  const stored = await prisma.refreshToken.findUnique({
    where: { jti: payload.jti }
  });

  if (
    !stored ||
    stored.tokenHash !== hashToken(refreshToken) ||
    stored.revokedAt !== null ||
    stored.expiresAt <= new Date()
  ) {
    throw new AppError("Refresh token is expired or revoked.", 401, "UNAUTHORIZED");
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub }
  });
  if (!user || !user.isActive) {
    throw new AppError("Unauthorized user.", 401, "UNAUTHORIZED");
  }

  await prisma.refreshToken.update({
    where: { id: stored.id },
    data: { revokedAt: new Date() }
  });

  return issueTokens({
    id: user.id,
    email: user.email,
    role: user.role,
    salonId: user.salonId,
    staffId: user.staffId
  });
};

export const logoutByRefreshToken = async (refreshToken: string): Promise<void> => {
  const payload = verifyRefreshToken(refreshToken);
  if (payload.type !== "refresh" || !payload.jti) {
    throw new AppError("Invalid refresh token.", 401, "UNAUTHORIZED");
  }

  await prisma.refreshToken.updateMany({
    where: {
      jti: payload.jti,
      tokenHash: hashToken(refreshToken),
      revokedAt: null
    },
    data: {
      revokedAt: new Date()
    }
  });
};

export const forgotPassword = async (email: string): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() }
  });

  if (!user) {
    return;
  }

  const rawToken = generateSecureToken(32);
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 1000 * 60 * 30);

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt
    }
  });

  await sendPasswordResetEmail(user.email, user.fullName, rawToken);

  await createAuditLog({
    salonId: user.salonId,
    actorUserId: user.id,
    action: "PASSWORD_RESET_REQUESTED",
    entityType: "User",
    entityId: user.id
  });
};

export const resetPassword = async (token: string, newPassword: string): Promise<void> => {
  const tokenHash = hashToken(token);
  const record = await prisma.passwordResetToken.findUnique({
    where: { tokenHash }
  });

  if (!record || record.usedAt || record.expiresAt <= new Date()) {
    throw new AppError("Reset token is invalid or expired.", 400, "INVALID_RESET_TOKEN");
  }

  const newPasswordHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash: newPasswordHash }
    });

    await tx.passwordResetToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() }
    });

    await tx.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() }
    });

    const user = await tx.user.findUnique({
      where: { id: record.userId },
      select: {
        salonId: true
      }
    });

    await createAuditLog(
      {
        salonId: user?.salonId ?? null,
        actorUserId: record.userId,
        action: "PASSWORD_RESET_COMPLETED",
        entityType: "User",
        entityId: record.userId
      },
      tx
    );
  });
};

export const changePassword = async (
  userId: string,
  currentPassword: string,
  newPassword: string
): Promise<void> => {
  const user = await prisma.user.findUnique({
    where: { id: userId }
  });

  if (!user) {
    throw new AppError("User not found.", 404, "USER_NOT_FOUND");
  }

  const isValid = await verifyPassword(currentPassword, user.passwordHash);
  if (!isValid) {
    throw new AppError("Current password is incorrect.", 400, "INVALID_CURRENT_PASSWORD");
  }

  const newHash = await hashPassword(newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash }
    });

    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() }
    });

    await createAuditLog(
      {
        salonId: user.salonId,
        actorUserId: user.id,
        action: "PASSWORD_CHANGED",
        entityType: "User",
        entityId: user.id
      },
      tx
    );
  });
};

export const getAuthenticatedUserProfile = async (
  userId: string
): Promise<{
  id: string;
  email: string;
  fullName: string;
  role: Role;
  salonId: string | null;
  staffId: string | null;
  language: SupportedLanguage;
  salon: {
    id: string;
    name: string;
    timezone: string;
    status: SalonStatus;
    subscriptionStatus: SubscriptionStatus;
  } | null;
  staff: {
    id: string;
    fullName: string;
    email: string | null;
    phone: string | null;
    status: string;
    isBookable: boolean;
  } | null;
}> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      salon: {
        select: {
          id: true,
          name: true,
          timezone: true,
          status: true,
          subscriptionStatus: true
        }
      },
      staffProfile: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          status: true,
          isBookable: true
        }
      }
    }
  });

  if (!user) {
    throw new AppError("User not found.", 404, "USER_NOT_FOUND");
  }

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    salonId: user.salonId,
    staffId: user.staffId,
    language: resolveUserLanguage(user.language, DEFAULT_LANGUAGE),
    salon: user.salon,
    staff: user.staffProfile
  };
};
