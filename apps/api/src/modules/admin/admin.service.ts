import {
  CallEscalationStatus,
  CallSessionStatus,
  CallRoutingOutcome,
  ExternalProvider,
  Prisma,
  Role,
  SalonStatus,
  StaffStatus,
  SubscriptionStatus
} from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";
import { generateSecureToken } from "../../lib/crypto";
import { AppError } from "../../lib/errors";
import { hashPassword } from "../../lib/password";
import { requireUsPhone } from "../../utils/phone";
import { getCurrentBillingPeriod } from "../../utils/date";
import { calculateStaffBillingUsage, refreshBillingUsageForSalon } from "../billing/billing.service";
import { buildSalonRoutingSummary } from "../salon/routing-summary";

interface ListSalonsInput {
  page: number;
  limit: number;
  status?: SalonStatus;
  subscriptionStatus?: SubscriptionStatus;
}

interface CreateSalonInputForAdmin {
  name: string;
  contactEmail?: string;
  contactPhone?: string;
  originalPhoneNumber?: string;
  customerIncomingPhoneNumber?: string;
  notificationPhoneNumber?: string;
  timezone: string;
  status?: SalonStatus;
  subscriptionStatus?: SubscriptionStatus;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  ownerUserId?: string;
  owner?: {
    fullName: string;
    email: string;
    phone?: string;
    password: string;
  };
}

interface UpdateSalonInputForAdmin {
  name?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  originalPhoneNumber?: string | null;
  customerIncomingPhoneNumber?: string | null;
  notificationPhoneNumber?: string | null;
  timezone?: string;
  status?: SalonStatus;
  subscriptionStatus?: SubscriptionStatus;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string;
}

interface UpdateSalonSettingsInputForAdmin {
  currency?: string;
  locale?: string;
  bookingLeadTimeMinutes?: number;
  cancellationPolicy?: string | null;
  aiReceptionEnabled?: boolean;
  aiTransferRingCount?: number;
  callCenterEnabled?: boolean;
  voicemailEnabled?: boolean;
  callbackRequestEnabled?: boolean;
  smsFallbackEnabled?: boolean;
  aiGreetingPrompt?: string | null;
  callerLanguage?: string;
  callLogVisibility?: "OWNER_ONLY" | "OWNER_AND_STAFF" | "OWNER_STAFF_OPERATOR";
  notificationRecipients?: string[];
  callCenterRoutingNumber?: string | null;
  callCenterRoutingNote?: string | null;
}

interface UpsertIntegrationConfigInput {
  provider: ExternalProvider;
  configKey: string;
  configValue: string;
  metadata?: unknown;
  isActive?: boolean;
}

interface CreateCallCenterAgentInput {
  fullName: string;
  email: string;
  phone: string;
  password?: string;
}

const normalizeOptionalPhone = (
  value: string | null | undefined,
  label: string
): string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value.trim().length === 0) {
    return null;
  }
  return requireUsPhone(value, label);
};

const normalizeNotificationRecipients = (
  value: string[] | undefined
): string[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return Array.from(
    new Set(
      value
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    )
  );
};

export const listSalonsForAdmin = async (input: ListSalonsInput) => {
  const skip = (input.page - 1) * input.limit;

  const where = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.subscriptionStatus ? { subscriptionStatus: input.subscriptionStatus } : {})
  };

  const [salons, total] = await Promise.all([
    prisma.salon.findMany({
      where,
      skip,
      take: input.limit,
      orderBy: {
        createdAt: "desc"
      },
      include: {
        owner: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            isActive: true
          }
        },
        subscription: true
      }
    }),
    prisma.salon.count({ where })
  ]);

  const salonIds = salons.map((salon) => salon.id);
  const staffGroup = salonIds.length
    ? await prisma.staff.groupBy({
        by: ["salonId"],
        where: {
          salonId: { in: salonIds },
          status: StaffStatus.ACTIVE
        },
        _count: {
          _all: true
        }
      })
    : [];

  const staffCountBySalon = new Map<string, number>();
  staffGroup.forEach((group) => {
    staffCountBySalon.set(group.salonId, group._count._all);
  });

  const items = salons.map((salon) => {
    const activeStaffCount = staffCountBySalon.get(salon.id) ?? 0;
    const usage = calculateStaffBillingUsage(activeStaffCount);

    return {
      ...salon,
      staffUsage: usage,
      pricing: {
        freeStaffLimit: env.FREE_STAFF_LIMIT,
        extraStaffPrice: env.EXTRA_STAFF_PRICE
      }
    };
  });

  return {
    items,
    pagination: {
      page: input.page,
      limit: input.limit,
      total
    }
  };
};

export const getSalonDetailForAdmin = async (salonId: string) => {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    include: {
      owner: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          isActive: true
        }
      },
      settings: true,
      subscription: true,
      callCenterAssignments: {
        select: {
          id: true
        }
      }
    }
  });

  if (!salon) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }

  const [
    staffCount,
    serviceCount,
    customerCount,
    appointmentCount,
    billingUsage,
    integrations,
    recentEscalations,
    recentCallFailures
  ] = await Promise.all([
    prisma.staff.count({
      where: {
        salonId,
        status: StaffStatus.ACTIVE
      }
    }),
    prisma.service.count({
      where: {
        salonId,
        isActive: true
      }
    }),
    prisma.customer.count({ where: { salonId } }),
    prisma.appointment.count({ where: { salonId } }),
    refreshBillingUsageForSalon(salonId),
    prisma.integrationConfig.findMany({
      where: { salonId, isActive: true },
      orderBy: [{ provider: "asc" }, { configKey: "asc" }]
    }),
    prisma.callEscalation.findMany({
      where: { salonId },
      orderBy: {
        requestedAt: "desc"
      },
      take: 8,
      include: {
        callSession: {
          select: {
            id: true,
            callerPhone: true,
            routingOutcome: true
          }
        }
      }
    }),
    prisma.callSession.findMany({
      where: {
        salonId,
        OR: [
          {
            status: {
              in: [
                CallSessionStatus.FAILED,
                CallSessionStatus.MISSED,
                CallSessionStatus.VOICEMAIL
              ]
            }
          },
          {
            routingOutcome: {
              in: [
                CallRoutingOutcome.VOICEMAIL,
                CallRoutingOutcome.CALLBACK_REQUEST,
                CallRoutingOutcome.SMS_FALLBACK
              ]
            }
          }
        ]
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 8,
      select: {
        id: true,
        providerCallId: true,
        status: true,
        routingOutcome: true,
        finalResolution: true,
        callerPhone: true,
        createdAt: true
      }
    })
  ]);

  const activeCallRailConfigs = integrations.filter((item) => item.provider === ExternalProvider.CALLRAIL);
  const activeVertexConfigs = integrations.filter((item) => item.provider === ExternalProvider.VERTEX);
  const activeAmazonConnectConfigs = integrations.filter(
    (item) => item.provider === ExternalProvider.AMAZON_CONNECT
  );

  return {
    ...salon,
    settings: salon.settings
      ? {
          ...salon.settings,
          routingSummary: buildSalonRoutingSummary(salon.settings)
        }
      : null,
    metrics: {
      activeStaffCount: staffCount,
      activeServiceCount: serviceCount,
      customerCount,
      appointmentCount
    },
    staffUsage: billingUsage,
    integrationStatuses: {
      callRail: {
        configured: env.integrationStatuses.callRail.configured && activeCallRailConfigs.length > 0,
        missing: [
          ...env.integrationStatuses.callRail.missing,
          activeCallRailConfigs.length === 0 ? "Active CALLRAIL IntegrationConfig" : null
        ].filter((value): value is string => Boolean(value)),
        activeConfigCount: activeCallRailConfigs.length
      },
      vertex: {
        configured: env.integrationStatuses.vertex.configured,
        missing: env.integrationStatuses.vertex.missing,
        activeConfigCount: activeVertexConfigs.length
      },
      amazonConnect: {
        configured:
          env.integrationStatuses.amazonConnect.configured && activeAmazonConnectConfigs.length > 0,
        missing: [
          ...env.integrationStatuses.amazonConnect.missing,
          activeAmazonConnectConfigs.length === 0
            ? "Active AMAZON_CONNECT IntegrationConfig"
            : null
        ].filter((value): value is string => Boolean(value)),
        activeConfigCount: activeAmazonConnectConfigs.length
      }
    },
    callCenterAssignmentStatus: {
      assignedAgentCount: salon.callCenterAssignments.length,
      hasAssignedAgents: salon.callCenterAssignments.length > 0
    },
    recentEscalations,
    recentCallFailures
  };
};

export const getOwnerDetailForAdmin = async (ownerId: string) => {
  const owner = await prisma.user.findFirst({
    where: {
      id: ownerId,
      role: Role.SALON_OWNER
    },
    include: {
      ownedSalon: {
        include: {
          subscription: true
        }
      }
    }
  });

  if (!owner) {
    throw new AppError("Owner not found.", 404, "OWNER_NOT_FOUND");
  }

  return owner;
};

export const getAdminOverviewMetrics = async () => {
  const [
    totalSalons,
    activeSalons,
    suspendedSalons,
    totalOwners,
    totalAppointments,
    callCenterAgentCount,
    openEscalationCount,
    activeIntegrationCounts
  ] = await Promise.all([
    prisma.salon.count(),
    prisma.salon.count({ where: { status: SalonStatus.ACTIVE } }),
    prisma.salon.count({ where: { status: SalonStatus.SUSPENDED } }),
    prisma.user.count({ where: { role: Role.SALON_OWNER } }),
    prisma.appointment.count(),
    prisma.user.count({
      where: {
        role: Role.CALL_CENTER_AGENT,
        isActive: true
      }
    }),
    prisma.callEscalation.count({
      where: {
        status: {
          not: CallEscalationStatus.CLOSED
        }
      }
    }),
    prisma.integrationConfig.groupBy({
      by: ["provider"],
      where: {
        isActive: true
      },
      _count: {
        _all: true
      }
    })
  ]);

  const activeConfigCountByProvider = new Map<ExternalProvider, number>();
  activeIntegrationCounts.forEach((item) => {
    activeConfigCountByProvider.set(item.provider, item._count._all);
  });

  const activeCallRailConfigCount = activeConfigCountByProvider.get(ExternalProvider.CALLRAIL) ?? 0;
  const activeVertexConfigCount = activeConfigCountByProvider.get(ExternalProvider.VERTEX) ?? 0;
  const activeAmazonConnectConfigCount =
    activeConfigCountByProvider.get(ExternalProvider.AMAZON_CONNECT) ?? 0;

  return {
    totalSalons,
    activeSalons,
    suspendedSalons,
    totalOwners,
    totalAppointments,
    callCenterAgentCount,
    openEscalationCount,
    integrationSummary: {
      callRail: {
        configured: env.integrationStatuses.callRail.configured && activeCallRailConfigCount > 0,
        missing: [
          ...env.integrationStatuses.callRail.missing,
          activeCallRailConfigCount === 0 ? "Active CALLRAIL IntegrationConfig" : null
        ].filter((value): value is string => Boolean(value)),
        activeConfigCount: activeCallRailConfigCount
      },
      vertex: {
        configured: env.integrationStatuses.vertex.configured,
        missing: env.integrationStatuses.vertex.missing,
        activeConfigCount: activeVertexConfigCount
      },
      amazonConnect: {
        configured:
          env.integrationStatuses.amazonConnect.configured && activeAmazonConnectConfigCount > 0,
        missing: [
          ...env.integrationStatuses.amazonConnect.missing,
          activeAmazonConnectConfigCount === 0 ? "Active AMAZON_CONNECT IntegrationConfig" : null
        ].filter((value): value is string => Boolean(value)),
        activeConfigCount: activeAmazonConnectConfigCount
      }
    },
    generatedAt: new Date().toISOString()
  };
};

const createDefaultBusinessHours = async (
  salonId: string,
  tx: Prisma.TransactionClient
): Promise<void> => {
  await tx.businessHour.createMany({
    data: [
      { salonId, dayOfWeek: 0, isOpen: false, openTime: null, closeTime: null },
      { salonId, dayOfWeek: 1, isOpen: true, openTime: "09:00", closeTime: "18:00" },
      { salonId, dayOfWeek: 2, isOpen: true, openTime: "09:00", closeTime: "18:00" },
      { salonId, dayOfWeek: 3, isOpen: true, openTime: "09:00", closeTime: "18:00" },
      { salonId, dayOfWeek: 4, isOpen: true, openTime: "09:00", closeTime: "18:00" },
      { salonId, dayOfWeek: 5, isOpen: true, openTime: "09:00", closeTime: "18:00" },
      { salonId, dayOfWeek: 6, isOpen: true, openTime: "09:00", closeTime: "16:00" }
    ]
  });
};

export const createSalonForAdmin = async (
  actorUserId: string,
  input: CreateSalonInputForAdmin
) => {
  if (!input.ownerUserId && !input.owner) {
    throw new AppError("Either ownerUserId or owner payload is required.", 400, "OWNER_REQUIRED");
  }

  const { periodStart, periodEnd } = getCurrentBillingPeriod();
  const contactPhone = normalizeOptionalPhone(input.contactPhone, "Salon contact phone");
  const originalPhoneNumber = normalizeOptionalPhone(
    input.originalPhoneNumber ?? input.contactPhone,
    "Original salon phone"
  );
  const customerIncomingPhoneNumber = normalizeOptionalPhone(
    input.customerIncomingPhoneNumber,
    "Customer incoming phone"
  );
  const notificationPhoneNumber = normalizeOptionalPhone(
    input.notificationPhoneNumber ?? input.contactPhone,
    "Notification phone"
  );
  const ownerPhone = normalizeOptionalPhone(input.owner?.phone, "Owner phone");

  const salon = await prisma.$transaction(async (tx) => {
    let ownerUserId = input.ownerUserId;
    let ownerForAuditName = "";

    if (input.owner) {
      const normalizedEmail = input.owner.email.toLowerCase().trim();
      const existedUser = await tx.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true }
      });
      if (existedUser) {
        throw new AppError("Owner email is already registered.", 409, "EMAIL_ALREADY_EXISTS");
      }

      const passwordHash = await hashPassword(input.owner.password);
      const owner = await tx.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
          fullName: input.owner.fullName,
          phone: ownerPhone,
          role: Role.SALON_OWNER,
          isActive: true
        }
      });
      ownerUserId = owner.id;
      ownerForAuditName = owner.fullName;
    }

    if (!ownerUserId) {
      throw new AppError("Owner is required.", 400, "OWNER_REQUIRED");
    }

    const owner = await tx.user.findFirst({
      where: {
        id: ownerUserId,
        role: Role.SALON_OWNER
      },
      include: {
        ownedSalon: {
          select: {
            id: true
          }
        }
      }
    });
    if (!owner) {
      throw new AppError("Owner user not found.", 404, "OWNER_NOT_FOUND");
    }
    if (owner.ownedSalon?.id) {
      throw new AppError("Owner already has a salon assigned.", 409, "OWNER_ALREADY_ASSIGNED");
    }

    const createdSalon = await tx.salon.create({
      data: {
        name: input.name,
        contactEmail: input.contactEmail ?? owner.email,
        contactPhone: contactPhone ?? owner.phone,
        originalPhoneNumber: originalPhoneNumber ?? contactPhone ?? owner.phone,
        customerIncomingPhoneNumber,
        notificationPhoneNumber: notificationPhoneNumber ?? owner.phone,
        timezone: input.timezone,
        status: input.status ?? SalonStatus.ACTIVE,
        subscriptionStatus: input.subscriptionStatus ?? SubscriptionStatus.TRIAL,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        country: input.country ?? "US",
        ownerId: owner.id
      }
    });

    await tx.user.update({
      where: { id: owner.id },
      data: {
        salonId: createdSalon.id
      }
    });

    await tx.salonSetting.create({
      data: {
        salonId: createdSalon.id
      }
    });

    await tx.subscription.create({
      data: {
        salonId: createdSalon.id,
        planCode: "starter",
        status: createdSalon.subscriptionStatus,
        basePriceCents: 0,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd
      }
    });

    await createDefaultBusinessHours(createdSalon.id, tx);

    await createAuditLog(
      {
        salonId: createdSalon.id,
        actorUserId,
        action: "ADMIN_CREATED_SALON",
        entityType: "Salon",
        entityId: createdSalon.id,
        metadata: {
          ownerUserId: owner.id,
          ownerName: ownerForAuditName || owner.fullName
        }
      },
      tx
    );

    return createdSalon;
  });

  return getSalonDetailForAdmin(salon.id);
};

export const updateSalonForAdmin = async (
  salonId: string,
  actorUserId: string,
  input: UpdateSalonInputForAdmin
) => {
  const existing = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { id: true }
  });
  if (!existing) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }

  await prisma.$transaction(async (tx) => {
    await tx.salon.update({
      where: { id: salonId },
      data: {
        name: input.name,
        contactEmail: input.contactEmail,
        contactPhone: normalizeOptionalPhone(input.contactPhone, "Salon contact phone"),
        originalPhoneNumber: normalizeOptionalPhone(
          input.originalPhoneNumber,
          "Original salon phone"
        ),
        customerIncomingPhoneNumber: normalizeOptionalPhone(
          input.customerIncomingPhoneNumber,
          "Customer incoming phone"
        ),
        notificationPhoneNumber: normalizeOptionalPhone(
          input.notificationPhoneNumber,
          "Notification phone"
        ),
        timezone: input.timezone,
        status: input.status,
        subscriptionStatus: input.subscriptionStatus,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2,
        city: input.city,
        state: input.state,
        postalCode: input.postalCode,
        country: input.country
      }
    });

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: "ADMIN_UPDATED_SALON",
        entityType: "Salon",
        entityId: salonId,
        metadata: input
      },
      tx
    );
  });

  return getSalonDetailForAdmin(salonId);
};

export const updateSalonSettingsForAdmin = async (
  salonId: string,
  actorUserId: string,
  input: UpdateSalonSettingsInputForAdmin
) => {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { id: true }
  });
  if (!salon) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }

  const data = {
    ...input,
    aiForwardingEnabled: input.aiReceptionEnabled,
    aiReceptionEnabled: input.aiReceptionEnabled,
    notificationRecipients: normalizeNotificationRecipients(input.notificationRecipients),
    callCenterRoutingNumber: normalizeOptionalPhone(
      input.callCenterRoutingNumber,
      "Call center routing phone"
    )
  };

  const settings = await prisma.salonSetting.upsert({
    where: { salonId },
    create: {
      salonId,
      currency: data.currency,
      locale: data.locale,
      bookingLeadTimeMinutes: data.bookingLeadTimeMinutes ?? 0,
      cancellationPolicy: data.cancellationPolicy,
      aiForwardingEnabled: data.aiReceptionEnabled ?? false,
      aiReceptionEnabled: data.aiReceptionEnabled ?? false,
      aiTransferRingCount: data.aiTransferRingCount ?? 3,
      callCenterEnabled: data.callCenterEnabled ?? false,
      voicemailEnabled: data.voicemailEnabled ?? true,
      callbackRequestEnabled: data.callbackRequestEnabled ?? true,
      smsFallbackEnabled: data.smsFallbackEnabled ?? false,
      aiGreetingPrompt: data.aiGreetingPrompt,
      callerLanguage: data.callerLanguage ?? "en",
      callLogVisibility: data.callLogVisibility ?? "OWNER_STAFF_OPERATOR",
      notificationRecipients: data.notificationRecipients,
      callCenterRoutingNumber: data.callCenterRoutingNumber,
      callCenterRoutingNote: data.callCenterRoutingNote
    },
    update: data
  });

  await createAuditLog({
    salonId,
    actorUserId,
    action: "ADMIN_UPDATED_SALON_SETTINGS",
    entityType: "SalonSetting",
    entityId: settings.id,
    metadata: data
  });

  return {
    ...settings,
    routingSummary: buildSalonRoutingSummary(settings)
  };
};

export const setSalonStatusForAdmin = async (
  salonId: string,
  actorUserId: string,
  status: SalonStatus
) => {
  return updateSalonForAdmin(salonId, actorUserId, { status });
};

export const listSalonIntegrationsForAdmin = async (salonId: string) => {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { id: true }
  });
  if (!salon) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }

  return prisma.integrationConfig.findMany({
    where: { salonId },
    orderBy: [{ provider: "asc" }, { configKey: "asc" }, { createdAt: "asc" }]
  });
};

export const replaceSalonIntegrationsForAdmin = async (
  salonId: string,
  actorUserId: string,
  items: UpsertIntegrationConfigInput[]
) => {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { id: true }
  });
  if (!salon) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }

  return prisma.$transaction(async (tx) => {
    await tx.integrationConfig.deleteMany({
      where: { salonId }
    });

    for (const item of items) {
      await tx.integrationConfig.create({
        data: {
          salonId,
          provider: item.provider,
          configKey: item.configKey,
          configValue: item.configValue,
          metadata: item.metadata as Prisma.InputJsonValue | undefined,
          isActive: item.isActive ?? true
        }
      });
    }

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: "ADMIN_UPDATED_INTEGRATIONS",
        entityType: "IntegrationConfig",
        metadata: {
          count: items.length
        }
      },
      tx
    );

    return tx.integrationConfig.findMany({
      where: { salonId },
      orderBy: [{ provider: "asc" }, { configKey: "asc" }, { createdAt: "asc" }]
    });
  });
};

export const listCallCenterAgentsForAdmin = async () => {
  return prisma.user.findMany({
    where: {
      role: Role.CALL_CENTER_AGENT
    },
    orderBy: {
      fullName: "asc"
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      isActive: true,
      callCenterAssignments: {
        select: {
          salonId: true,
          salon: {
            select: {
              id: true,
              name: true
            }
          }
        }
      }
    }
  });
};

export const createCallCenterAgentForAdmin = async (
  actorUserId: string,
  input: CreateCallCenterAgentInput
) => {
  const normalizedEmail = input.email.toLowerCase().trim();
  const normalizedPhone = requireUsPhone(input.phone, "Call center agent phone");
  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true }
  });
  if (existing) {
    throw new AppError("Email is already registered.", 409, "EMAIL_ALREADY_EXISTS");
  }

  const temporaryPassword = input.password ?? generateSecureToken(6);
  const passwordHash = await hashPassword(temporaryPassword);

  const user = await prisma.user.create({
    data: {
      email: normalizedEmail,
      fullName: input.fullName,
      phone: normalizedPhone,
      passwordHash,
      role: Role.CALL_CENTER_AGENT,
      isActive: true
    },
    select: {
      id: true,
      email: true,
      fullName: true,
      phone: true,
      role: true,
      isActive: true
    }
  });

  await createAuditLog({
    actorUserId,
    action: "ADMIN_CREATED_CALL_CENTER_AGENT",
    entityType: "User",
    entityId: user.id,
    metadata: {
      email: user.email
    }
  });

  return {
    user,
    temporaryPassword
  };
};

export const listSalonCallCenterAssignmentsForAdmin = async (salonId: string) => {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { id: true }
  });
  if (!salon) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }

  return prisma.callCenterSalonAssignment.findMany({
    where: {
      salonId
    },
    orderBy: {
      createdAt: "asc"
    },
    include: {
      agent: {
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          isActive: true
        }
      }
    }
  });
};

export const replaceSalonCallCenterAssignmentsForAdmin = async (
  salonId: string,
  actorUserId: string,
  agentUserIds: string[]
) => {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { id: true }
  });
  if (!salon) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }

  const uniqueAgentIds = Array.from(new Set(agentUserIds));
  const agents = uniqueAgentIds.length
    ? await prisma.user.findMany({
        where: {
          id: {
            in: uniqueAgentIds
          },
          role: Role.CALL_CENTER_AGENT,
          isActive: true
        },
        select: {
          id: true
        }
      })
    : [];

  if (agents.length !== uniqueAgentIds.length) {
    throw new AppError("One or more call center agents are invalid.", 400, "INVALID_CALL_CENTER_AGENT");
  }

  return prisma.$transaction(async (tx) => {
    await tx.callCenterSalonAssignment.deleteMany({
      where: {
        salonId
      }
    });

    if (uniqueAgentIds.length) {
      await tx.callCenterSalonAssignment.createMany({
        data: uniqueAgentIds.map((agentUserId) => ({
          salonId,
          agentUserId,
          assignedByUserId: actorUserId
        }))
      });
    }

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: "ADMIN_UPDATED_CALL_CENTER_ASSIGNMENTS",
        entityType: "CallCenterSalonAssignment",
        metadata: {
          agentUserIds: uniqueAgentIds
        }
      },
      tx
    );

    return tx.callCenterSalonAssignment.findMany({
      where: {
        salonId
      },
      orderBy: {
        createdAt: "asc"
      },
      include: {
        agent: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            isActive: true
          }
        }
      }
    });
  });
};
