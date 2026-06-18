import { Prisma, Role, StaffStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";
import { generateSecureToken } from "../../lib/crypto";
import { AppError } from "../../lib/errors";
import { sendStaffInvitationEmail, sendStaffPasswordChangedEmail } from "../../lib/mailer";
import { hashPassword } from "../../lib/password";
import { requireUsPhone } from "../../utils/phone";
import { refreshBillingUsageForSalon } from "../billing/billing.service";

interface CreateStaffInput {
  fullName: string;
  email?: string;
  phone?: string;
  title?: string;
  avatarUrl?: string | null;
  isBookable?: boolean;
  createLogin?: boolean;
  password?: string;
  serviceIds?: string[];
}

interface UpdateStaffInput {
  fullName?: string;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  avatarUrl?: string | null;
  isBookable?: boolean;
  serviceIds?: string[];
}

interface UpdateOwnStaffProfileInput {
  fullName?: string;
  phone?: string | null;
  avatarUrl?: string | null;
}

type PrismaExecutor = typeof prisma | Prisma.TransactionClient;

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

const staffServiceSelect = {
  id: true,
  name: true,
  description: true,
  durationMinutes: true,
  priceCents: true,
  isActive: true
} as const;

const staffWithUserAndServicesInclude = {
  ...staffWithUserInclude,
  staffServices: {
    include: {
      service: {
        select: staffServiceSelect
      }
    },
    orderBy: {
      createdAt: "asc"
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

const normalizeAvatarUrl = (value: string | null | undefined): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > 2048) {
    throw new AppError("Avatar URL must be 2048 characters or fewer.", 400, "INVALID_AVATAR_URL");
  }

  try {
    new URL(trimmed);
  } catch {
    throw new AppError("Avatar URL must be a valid URL.", 400, "INVALID_AVATAR_URL");
  }

  return trimmed;
};

const normalizeServiceIds = (serviceIds: string[] | undefined): string[] | undefined => {
  return serviceIds === undefined ? undefined : Array.from(new Set(serviceIds));
};

const addStaffServiceSummary = <T extends { staffServices?: Array<{ serviceId: string; service: unknown }> }>(
  staff: T
) => ({
  ...staff,
  serviceIds: staff.staffServices?.map((row) => row.serviceId) ?? [],
  assignedServices: staff.staffServices?.map((row) => row.service) ?? []
});

const validateServiceIdsBelongToSalon = async (
  salonId: string,
  serviceIds: string[],
  tx: PrismaExecutor = prisma
): Promise<void> => {
  if (!serviceIds.length) {
    return;
  }
  const count = await tx.service.count({
    where: {
      salonId,
      id: {
        in: serviceIds
      }
    }
  });
  if (count !== serviceIds.length) {
    throw new AppError("One or more service IDs are invalid for this salon.", 400, "INVALID_SERVICE");
  }
};

const replaceStaffServiceMapping = async (
  tx: PrismaExecutor,
  salonId: string,
  staffId: string,
  serviceIds: string[]
) => {
  await tx.staffService.deleteMany({
    where: {
      salonId,
      staffId
    }
  });

  if (serviceIds.length) {
    await tx.staffService.createMany({
      data: serviceIds.map((serviceId) => ({
        salonId,
        staffId,
        serviceId
      })),
      skipDuplicates: true
    });
  }
};

export const listStaff = async (salonId: string, includeInactive = false) => {
  const isDemoSalon = Boolean(
    await prisma.salon.findFirst({
      where: {
        id: salonId,
        owner: {
          email: "owner.demo@fastaibooking.local"
        }
      },
      select: {
        id: true
      }
    })
  );
  const staff = await prisma.staff.findMany({
    where: {
      salonId,
      ...(includeInactive ? {} : { status: StaffStatus.ACTIVE }),
      ...(isDemoSalon
        ? {
            OR: ["Trang", "Amy", "Kelly"].map((fullName) => ({
              fullName: {
                equals: fullName,
                mode: Prisma.QueryMode.insensitive
              }
            }))
          }
        : {})
    },
    include: staffWithUserAndServicesInclude,
    orderBy: {
      createdAt: "asc"
    }
  });
  return staff.map(addStaffServiceSummary);
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
  const normalizedAvatarUrl = normalizeAvatarUrl(input.avatarUrl);
  const shouldCreateLogin = input.createLogin ?? true;
  const temporaryPassword = input.password ?? generateSecureToken(6);
  const serviceIds = normalizeServiceIds(input.serviceIds);
  await validateServiceIdsBelongToSalon(salonId, serviceIds ?? []);

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
        avatarUrl: normalizedAvatarUrl ?? null,
        isBookable: input.isBookable ?? true
      }
    });

    if (serviceIds !== undefined) {
      await replaceStaffServiceMapping(tx, salonId, staff.id, serviceIds);
    } else if (staff.isBookable && staff.status === StaffStatus.ACTIVE) {
      const activeServices = await tx.service.findMany({
        where: {
          salonId,
          isActive: true
        },
        select: {
          id: true
        }
      });

      if (activeServices.length) {
        await tx.staffService.createMany({
          data: activeServices.map((service) => ({
            salonId,
            staffId: staff.id,
            serviceId: service.id
          })),
          skipDuplicates: true
        });
      }
    }

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
      include: staffWithUserAndServicesInclude
    });

    return {
      staff: addStaffServiceSummary(staffWithUser),
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
  const normalizedAvatarUrl = normalizeAvatarUrl(input.avatarUrl);
  const serviceIds = normalizeServiceIds(input.serviceIds);
  await validateServiceIdsBelongToSalon(salonId, serviceIds ?? []);

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
        avatarUrl: input.avatarUrl === undefined ? existing.avatarUrl : normalizedAvatarUrl ?? null,
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

    if (serviceIds !== undefined) {
      await replaceStaffServiceMapping(tx, salonId, staff.id, serviceIds);
      await createAuditLog(
        {
          salonId,
          actorUserId,
          action: "STAFF_SERVICE_MAPPING_UPDATED",
          entityType: "Staff",
          entityId: staff.id,
          metadata: { serviceIds }
        },
        tx
      );
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
      include: staffWithUserAndServicesInclude
    }).then(addStaffServiceSummary);
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
      include: staffWithUserAndServicesInclude
    });

    return {
      staff: addStaffServiceSummary(staffWithUser),
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
  const result = await prisma.$transaction(async (tx) => {
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

    const staffWithUser = await tx.staff.findUniqueOrThrow({
      where: { id: existing.id },
      include: staffWithUserAndServicesInclude
    });

    return {
      staff: addStaffServiceSummary(staffWithUser),
      invitation: {
        email: staffWithUser.user?.email ?? normalizeEmail(staffWithUser.email),
        temporaryPassword: newPassword
      }
    };
  });

  if (!result.invitation.email) {
    throw new AppError("Staff email is required to send the new password.", 400, "STAFF_EMAIL_REQUIRED");
  }

  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { name: true }
  });
  const emailSent = await sendStaffPasswordChangedEmail({
    toEmail: result.invitation.email,
    recipientName: result.staff.fullName,
    salonName: salon?.name ?? "Your salon",
    newPassword
  });

  return {
    ...result,
    emailSent
  };
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
      staffProfile: {
        include: {
          salon: {
            select: {
              id: true,
              name: true,
              timezone: true
            }
          },
          staffServices: {
            where: {
              service: {
                isActive: true
              }
            },
            include: {
              service: {
                select: staffServiceSelect
              }
            },
            orderBy: {
              createdAt: "asc"
            }
          }
        }
      }
    }
  });
  if (!user || !user.staffProfile) {
    throw new AppError("Staff profile not found.", 404, "STAFF_PROFILE_NOT_FOUND");
  }

  const { salon, ...staff } = user.staffProfile;
  const staffWithServices = addStaffServiceSummary(staff);

  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      phone: user.phone,
      isActive: user.isActive
    },
    staff: staffWithServices,
    salon,
    serviceIds: staffWithServices.serviceIds,
    assignedServices: staffWithServices.assignedServices
  };
};

export const getStaffServiceAssignments = async (salonId: string, staffId: string) => {
  const staff = await prisma.staff.findFirst({
    where: {
      id: staffId,
      salonId
    },
    select: {
      id: true,
      fullName: true,
      isBookable: true,
      status: true,
      staffServices: {
        select: {
          serviceId: true
        }
      }
    }
  });
  if (!staff) {
    throw new AppError("Staff not found.", 404, "STAFF_NOT_FOUND");
  }

  const assignedIds = new Set(staff.staffServices.map((row) => row.serviceId));
  const services = await prisma.service.findMany({
    where: { salonId },
    select: staffServiceSelect,
    orderBy: { name: "asc" }
  });

  return {
    staff: {
      id: staff.id,
      fullName: staff.fullName,
      isBookable: staff.isBookable,
      status: staff.status
    },
    services: services.map((service) => ({
      ...service,
      assigned: assignedIds.has(service.id)
    }))
  };
};

export const setStaffServiceAssignments = async (
  salonId: string,
  staffId: string,
  actorUserId: string,
  serviceIdsInput: string[]
) => {
  const serviceIds = normalizeServiceIds(serviceIdsInput) ?? [];
  await validateServiceIdsBelongToSalon(salonId, serviceIds);

  return prisma.$transaction(async (tx) => {
    const staff = await tx.staff.findFirst({
      where: {
        id: staffId,
        salonId
      },
      select: { id: true }
    });
    if (!staff) {
      throw new AppError("Staff not found.", 404, "STAFF_NOT_FOUND");
    }

    await replaceStaffServiceMapping(tx, salonId, staff.id, serviceIds);

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: "STAFF_SERVICE_MAPPING_UPDATED",
        entityType: "Staff",
        entityId: staff.id,
        metadata: { serviceIds }
      },
      tx
    );
  }).then(() => getStaffServiceAssignments(salonId, staffId));
};

export const listStaffSelfServices = async (salonId: string, staffId: string) => {
  const staff = await prisma.staff.findFirst({
    where: {
      id: staffId,
      salonId
    },
    select: {
      id: true,
      fullName: true,
      isBookable: true,
      status: true,
      staffServices: {
        where: {
          service: {
            isActive: true
          }
        },
        include: {
          service: {
            select: staffServiceSelect
          }
        },
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });
  if (!staff) {
    throw new AppError("Staff not found.", 404, "STAFF_NOT_FOUND");
  }

  return {
    staff: {
      id: staff.id,
      fullName: staff.fullName,
      isBookable: staff.isBookable,
      status: staff.status
    },
    services: staff.staffServices.map((row) => ({
      serviceId: row.service.id,
      ...row.service
    }))
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
    const nextAvatarUrl =
      input.avatarUrl === undefined
        ? user.staffProfile.avatarUrl
        : normalizeAvatarUrl(input.avatarUrl) ?? null;

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
        phone: nextPhone,
        avatarUrl: nextAvatarUrl
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
