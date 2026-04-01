import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { Prisma, Role, SalonStatus, SubscriptionStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";
import { generateSecureToken, hashToken } from "../../lib/crypto";
import { AppError } from "../../lib/errors";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../lib/jwt";
import { sendPasswordResetEmail } from "../../lib/mailer";
import { hashPassword, verifyPassword } from "../../lib/password";
import { getCurrentBillingPeriod } from "../../utils/date";
import { requireUsPhone } from "../../utils/phone";

interface RegisterOwnerInput {
  fullName: string;
  email: string;
  password: string;
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

export const registerSalonOwner = async (
  input: RegisterOwnerInput
): Promise<{
  user: {
    id: string;
    fullName: string;
    email: string;
    role: Role;
    salonId: string | null;
    staffId: string | null;
  };
  salon: {
    id: string;
    name: string;
    timezone: string;
    status: SalonStatus;
    subscriptionStatus: SubscriptionStatus;
  };
  accessToken: string;
  refreshToken: string;
}> => {
  const existing = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() }
  });
  if (existing) {
    throw new AppError("Email is already registered.", 409, "EMAIL_ALREADY_EXISTS");
  }

  const passwordHash = await hashPassword(input.password);
  const { periodStart, periodEnd } = getCurrentBillingPeriod();
  const ownerPhone = normalizeOptionalPhone(input.phone, "Owner phone");
  const salonContactPhone = normalizeOptionalPhone(input.salon.contactPhone ?? input.phone, "Salon phone");

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: input.email.toLowerCase(),
        fullName: input.fullName,
        passwordHash,
        phone: ownerPhone,
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
        status: SalonStatus.ACTIVE,
        ownerId: user.id,
        addressLine1: input.salon.addressLine1,
        addressLine2: input.salon.addressLine2,
        city: input.salon.city,
        state: input.salon.state,
        postalCode: input.salon.postalCode,
        country: input.salon.country ?? "US",
        subscriptionStatus: SubscriptionStatus.TRIAL
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
        planCode: "starter",
        status: SubscriptionStatus.TRIAL,
        basePriceCents: 0,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd
      }
    });

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

    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        salonId: salon.id,
        staffId: null
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

  return {
    ...result,
    ...tokens
  };
};

export const loginWithEmailPassword = async (
  input: LoginInput,
  expectedRole?: Role
): Promise<{
  user: {
    id: string;
    email: string;
    fullName: string;
    role: Role;
    salonId: string | null;
    staffId: string | null;
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
      staffId: user.staffId
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
    salon: user.salon,
    staff: user.staffProfile
  };
};
