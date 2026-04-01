import { Role, StaffStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";
import { generateSecureToken } from "../../lib/crypto";
import { AppError } from "../../lib/errors";
import { sendStaffInvitationEmail } from "../../lib/mailer";
import { hashPassword } from "../../lib/password";
import { requireUsPhone } from "../../utils/phone";
import { refreshBillingUsageForSalon } from "../billing/billing.service";

interface CreateStaffInput {
  fullName: string;
  email?: string;
  phone?: string;
  title?: string;
  isBookable?: boolean;
  createLogin?: boolean;
  password?: string;
}

interface UpdateStaffInput {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  isBookable?: boolean;
}

interface UpdateOwnStaffProfileInput {
  fullName?: string;
  phone?: string | null;
}

const staffWithUserInclude = {
  user: {
    select: {
      id: true,
      email: true,
      isActive: true,
      role: true
    }
  }
} as const;

const normalizeEmail = (email?: string | null): string | null => {
  if (email === undefined || email === null) {
    return null;
  }
  const trimmed = email.trim().toLowerCase();
  return trimmed.length ? trimmed : null;
};

export const listStaff = async (salonId: string, includeInactive = false) => {
  return prisma.staff.findMany({
    where: {
      salonId,
      ...(includeInactive ? {} : { status: StaffStatus.ACTIVE })
    },
    include: staffWithUserInclude,
    orderBy: {
      createdAt: "asc"
    }
  });
};

export const createStaff = async (
  salonId: string,
  actorUserId: string,
  input: CreateStaffInput
) => {
  const normalizedEmail = normalizeEmail(input.email);
  if (!normalizedEmail) {
    throw new AppError("Staff email is required.", 400, "STAFF_EMAIL_REQUIRED");
  }
  const normalizedPhone = requireUsPhone(input.phone, "Staff phone");
  const shouldCreateLogin = input.createLogin ?? true;
  const temporaryPassword = input.password ?? generateSecureToken(6);

  const result = await prisma.$transaction(async (tx) => {
    if (shouldCreateLogin && normalizedEmail) {
      const existingUser = await tx.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true }
      });
      if (existingUser) {
        throw new AppError("Email is already registered.", 409, "EMAIL_ALREADY_EXISTS");
      }
    }

    const staff = await tx.staff.create({
      data: {
        salonId,
        fullName: input.fullName,
        email: normalizedEmail,
        phone: normalizedPhone,
        title: input.title,
        isBookable: input.isBookable ?? true
      }
    });

    if (shouldCreateLogin && normalizedEmail) {
      const passwordHash = await hashPassword(temporaryPassword);
      await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          fullName: input.fullName,
          phone: normalizedPhone,
          role: Role.STAFF,
          salonId,
          staffId: staff.id,
          isActive: staff.status === StaffStatus.ACTIVE
        }
      });
    }

    const usage = await refreshBillingUsageForSalon(salonId, tx);

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: "STAFF_CREATED",
        entityType: "Staff",
        entityId: staff.id,
        metadata: {
          fullName: staff.fullName
        }
      },
      tx
    );

    const staffWithUser = await tx.staff.findUniqueOrThrow({
      where: { id: staff.id },
      include: staffWithUserInclude
    });

    return {
      staff: staffWithUser,
      billingUsage: usage,
      invitation: {
        email: normalizedEmail,
        temporaryPassword: shouldCreateLogin ? temporaryPassword : undefined
      }
    };
  });

  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { name: true }
  });

  await sendStaffInvitationEmail({
    toEmail: normalizedEmail,
    recipientName: input.fullName,
    salonName: salon?.name ?? "Your salon",
    temporaryPassword: shouldCreateLogin ? temporaryPassword : undefined
  });

  return result;
};

export const updateStaff = async (
  salonId: string,
  staffId: string,
  actorUserId: string,
  input: UpdateStaffInput
) => {
  const existing = await prisma.staff.findFirst({
    where: {
      id: staffId,
      salonId
    },
    include: staffWithUserInclude
  });
  if (!existing) {
    throw new AppError("Staff not found.", 404, "STAFF_NOT_FOUND");
  }

  const normalizedEmail = input.email === undefined ? undefined : normalizeEmail(input.email);
  const normalizedPhone =
    input.phone === undefined
      ? undefined
      : input.phone === null
        ? null
        : requireUsPhone(input.phone, "Staff phone");

  if (input.email !== undefined && !normalizedEmail) {
    throw new AppError("Staff email is required.", 400, "STAFF_EMAIL_REQUIRED");
  }
  if (input.phone !== undefined && !normalizedPhone) {
    throw new AppError("Staff phone is required.", 400, "STAFF_PHONE_REQUIRED");
  }

  if (normalizedEmail && existing.user && normalizedEmail !== existing.user.email) {
    const duplicated = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true }
    });
    if (duplicated) {
      throw new AppError("Email is already registered.", 409, "EMAIL_ALREADY_EXISTS");
    }
  }

  return prisma.$transaction(async (tx) => {
    const staff = await tx.staff.update({
      where: {
        id: existing.id
      },
      data: {
        fullName: input.fullName ?? existing.fullName,
        email:
          input.email === undefined ? existing.email : normalizedEmail === null ? null : normalizedEmail,
        phone: input.phone === undefined ? existing.phone : normalizedPhone,
        title: input.title === undefined ? existing.title : input.title ?? null,
        isBookable: input.isBookable ?? existing.isBookable
      }
    });

    if (existing.user) {
      await tx.user.update({
        where: { id: existing.user.id },
        data: {
          fullName: input.fullName ?? existing.fullName,
          phone: input.phone === undefined ? existing.phone : normalizedPhone,
          ...(normalizedEmail ? { email: normalizedEmail } : {})
        }
      });
    }

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: "STAFF_UPDATED",
        entityType: "Staff",
        entityId: staff.id,
        metadata: input
      },
      tx
    );

    return tx.staff.findUniqueOrThrow({
      where: { id: staff.id },
      include: staffWithUserInclude
    });
  });
};

const updateStaffStatus = async (
  salonId: string,
  staffId: string,
  actorUserId: string,
  status: StaffStatus
) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.staff.findFirst({
      where: {
        id: staffId,
        salonId
      },
      include: staffWithUserInclude
    });
    if (!existing) {
      throw new AppError("Staff not found.", 404, "STAFF_NOT_FOUND");
    }

    const staff = await tx.staff.update({
      where: {
        id: existing.id
      },
      data: {
        status
      }
    });

    if (existing.user) {
      await tx.user.update({
        where: { id: existing.user.id },
        data: {
          isActive: status === StaffStatus.ACTIVE
        }
      });
    }

    const usage = await refreshBillingUsageForSalon(salonId, tx);

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: status === StaffStatus.ACTIVE ? "STAFF_REACTIVATED" : "STAFF_DEACTIVATED",
        entityType: "Staff",
        entityId: staff.id
      },
      tx
    );

    const staffWithUser = await tx.staff.findUniqueOrThrow({
      where: { id: staff.id },
      include: staffWithUserInclude
    });

    return {
      staff: staffWithUser,
      billingUsage: usage
    };
  });
};

export const deactivateStaff = async (
  salonId: string,
  staffId: string,
  actorUserId: string
) => {
  return updateStaffStatus(salonId, staffId, actorUserId, StaffStatus.INACTIVE);
};

export const reactivateStaff = async (
  salonId: string,
  staffId: string,
  actorUserId: string
) => {
  return updateStaffStatus(salonId, staffId, actorUserId, StaffStatus.ACTIVE);
};

export const resetStaffAccess = async (
  salonId: string,
  staffId: string,
  actorUserId: string,
  newPassword: string
) => {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.staff.findFirst({
      where: {
        id: staffId,
        salonId
      },
      include: staffWithUserInclude
    });
    if (!existing) {
      throw new AppError("Staff not found.", 404, "STAFF_NOT_FOUND");
    }

    const passwordHash = await hashPassword(newPassword);

    if (existing.user) {
      await tx.user.update({
        where: { id: existing.user.id },
        data: {
          passwordHash,
          isActive: existing.status === StaffStatus.ACTIVE
        }
      });
    } else {
      const normalizedEmail = normalizeEmail(existing.email);
      if (!normalizedEmail) {
        throw new AppError(
          "Staff email is required before creating login access.",
          400,
          "STAFF_EMAIL_REQUIRED"
        );
      }

      const duplicated = await tx.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true }
      });
      if (duplicated) {
        throw new AppError("Email is already registered.", 409, "EMAIL_ALREADY_EXISTS");
      }

      await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          fullName: existing.fullName,
          phone: existing.phone,
          role: Role.STAFF,
          salonId,
          staffId: existing.id,
          isActive: existing.status === StaffStatus.ACTIVE
        }
      });
    }

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: "STAFF_ACCESS_RESET",
        entityType: "Staff",
        entityId: existing.id
      },
      tx
    );

    return tx.staff.findUniqueOrThrow({
      where: { id: existing.id },
      include: staffWithUserInclude
    });
  });
};

export const getStaffSelfProfile = async (salonId: string, userId: string, staffId: string) => {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      salonId,
      role: Role.STAFF,
      staffId
    },
    include: {
      staffProfile: true
    }
  });
  if (!user || !user.staffProfile) {
    throw new AppError("Staff profile not found.", 404, "STAFF_PROFILE_NOT_FOUND");
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      isActive: user.isActive
    },
    staff: user.staffProfile
  };
};

export const updateStaffSelfProfile = async (
  salonId: string,
  userId: string,
  staffId: string,
  input: UpdateOwnStaffProfileInput
) => {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: {
        id: userId,
        salonId,
        role: Role.STAFF,
        staffId
      },
      include: {
        staffProfile: true
      }
    });
    if (!user || !user.staffProfile) {
      throw new AppError("Staff profile not found.", 404, "STAFF_PROFILE_NOT_FOUND");
    }

    const nextFullName = input.fullName ?? user.fullName;
    const nextPhone =
      input.phone === undefined
        ? user.phone
        : input.phone === null
          ? null
          : requireUsPhone(input.phone, "Staff phone");

    await tx.user.update({
      where: { id: user.id },
      data: {
        fullName: nextFullName,
        phone: nextPhone
      }
    });

    const staff = await tx.staff.update({
      where: { id: user.staffProfile.id },
      data: {
        fullName: nextFullName,
        phone: nextPhone
      }
    });

    await createAuditLog(
      {
        salonId,
        actorUserId: user.id,
        action: "STAFF_SELF_PROFILE_UPDATED",
        entityType: "Staff",
        entityId: staff.id
      },
      tx
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        fullName: nextFullName,
        phone: nextPhone,
        isActive: user.isActive
      },
      staff
    };
  });
};

export const listStaffSelfReminders = async (salonId: string, staffId: string) => {
  return prisma.staffReminder.findMany({
    where: {
      salonId,
      staffId
    },
    orderBy: {
      remindAt: "asc"
    },
    include: {
      appointment: {
        include: {
          customer: true,
          service: true
        }
      }
    }
  });
};
