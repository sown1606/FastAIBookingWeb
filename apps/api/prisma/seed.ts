import {
  AiReceptionForwardingType,
  AiReceptionSetupStatus,
  ExternalProvider,
  PrismaClient,
  Role,
  SalonStatus,
  StaffStatus,
  StaffWorkStatus,
  SubscriptionStatus
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

const ADMIN_EMAIL = "admin@fastaibooking.local";
const ADMIN_PASSWORD = "Admin123!";
const OWNER_EMAIL = "owner.demo@fastaibooking.local";
const OWNER_PASSWORD = "Owner123!";
const EXTRA_OWNER_EMAIL = "owner.callcenter.demo@fastaibooking.local";
const EXTRA_OWNER_PASSWORD = "Owner123!";
const STAFF_EMAIL = "staff.demo@fastaibooking.local";
const STAFF_PASSWORD = "Staff123!";
const CALL_CENTER_EMAIL = "agent.demo@fastaibooking.local";
const CALL_CENTER_PASSWORD = "Agent123!";

const normalizePhoneDigits = (value: string): string => value.replace(/\D/g, "");

const toDemoPhone = (value: string, fallbackDigits: string): string => {
  const digits = normalizePhoneDigits(value) || fallbackDigits;
  return digits.startsWith("1") ? `+${digits}` : `+1${digits}`;
};

const DEMO_SALON_NAME = process.env.DEMO_SALON_NAME?.trim() || "Kiet Nails & Beauty";
const DEMO_SALON_ID = process.env.DEMO_SALON_ID?.trim() || process.env.DEFAULT_SALON_ID?.trim();
const DEMO_TIMEZONE = "America/New_York";
const DEMO_ORIGINAL_PHONE = toDemoPhone(process.env.DEMO_ORIGINAL_PHONE_NUMBER ?? "8487029493", "18487029493");
const DEMO_TRACKING_PHONE = toDemoPhone(
  process.env.AMAZON_CONNECT_PHONE_NUMBER ??
    process.env.DEMO_FORWARDING_PHONE_NUMBER ??
    "18485550100",
  "18485550100"
);
const DEMO_ORIGINAL_PHONE_DIGITS = normalizePhoneDigits(DEMO_ORIGINAL_PHONE);
const DEMO_TRACKING_PHONE_DIGITS = normalizePhoneDigits(DEMO_TRACKING_PHONE);
const DEMO_CALL_FLOW_NAME = process.env.AMAZON_CONNECT_CALL_FLOW_NAME ?? "AI Booking Reception";
const DEMO_CONNECT_INSTANCE_ID =
  process.env.AMAZON_CONNECT_INSTANCE_ID ?? "demo-amazon-connect-instance";
const DEMO_CONNECT_QUEUE_ID = process.env.AMAZON_CONNECT_QUEUE_ID_DEFAULT ?? "demo-shared-queue";
const DEMO_CONNECT_ROUTING_PROFILE_ID =
  process.env.AMAZON_CONNECT_ROUTING_PROFILE_ID ?? "demo-routing-profile";
const DEMO_LEX_BOT_ID =
  process.env.AMAZON_LEX_BOT_ID ?? process.env.LEX_BOT_ID ?? "demo-lex-booking-bot";
const DEMO_LEX_BOT_ALIAS_ID =
  process.env.AMAZON_LEX_BOT_ALIAS_ID ??
  process.env.LEX_BOT_ALIAS_ID ??
  "demo-lex-booking-bot-alias";
const DEMO_FORWARDING_ACTIVATION_CODE =
  process.env.DEMO_FORWARDING_ACTIVATION_CODE?.trim() || `**61*${DEMO_TRACKING_PHONE_DIGITS}**10#`;
const DEMO_FORWARDING_FALLBACK_CODE = `**61*${DEMO_TRACKING_PHONE_DIGITS}#`;
const DEMO_FORWARDING_DEACTIVATION_CODE =
  process.env.DEMO_FORWARDING_DEACTIVATION_CODE?.trim() || "##61#";
const DEMO_FORWARDING_STATUS_CODE = process.env.DEMO_FORWARDING_STATUS_CODE?.trim() || "*#61#";

const hashPassword = async (plainPassword: string): Promise<string> => {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
};

const getCurrentBillingPeriod = (date = new Date()) => {
  const periodStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
  const periodEnd = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999)
  );
  return { periodStart, periodEnd };
};

const upsertUser = async (input: {
  email: string;
  fullName: string;
  passwordHash: string;
  role: Role;
  phone?: string | null;
  salonId?: string | null;
  staffId?: string | null;
}) => {
  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      fullName: input.fullName,
      passwordHash: input.passwordHash,
      role: input.role,
      phone: input.phone ?? null,
      salonId: input.salonId,
      staffId: input.staffId,
      isActive: true
    },
    create: {
      email: input.email,
      fullName: input.fullName,
      passwordHash: input.passwordHash,
      role: input.role,
      phone: input.phone ?? null,
      salonId: input.salonId,
      staffId: input.staffId,
      isActive: true
    }
  });
};

const run = async (): Promise<void> => {
  const [
    adminPasswordHash,
    ownerPasswordHash,
    extraOwnerPasswordHash,
    staffPasswordHash,
    callCenterPasswordHash
  ] = await Promise.all([
    hashPassword(ADMIN_PASSWORD),
    hashPassword(OWNER_PASSWORD),
    hashPassword(EXTRA_OWNER_PASSWORD),
    hashPassword(STAFF_PASSWORD),
    hashPassword(CALL_CENTER_PASSWORD)
  ]);

  const adminUser = await upsertUser({
    email: ADMIN_EMAIL,
    fullName: "Platform Admin",
    passwordHash: adminPasswordHash,
    role: Role.PLATFORM_ADMIN
  });

  const ownerUser = await upsertUser({
    email: OWNER_EMAIL,
    fullName: "Kiet Nguyen",
    passwordHash: ownerPasswordHash,
    role: Role.SALON_OWNER,
    phone: DEMO_ORIGINAL_PHONE
  });

  const extraOwnerUser = await upsertUser({
    email: EXTRA_OWNER_EMAIL,
    fullName: "Maya Tran",
    passwordHash: extraOwnerPasswordHash,
    role: Role.SALON_OWNER,
    phone: "+17325550120"
  });

  const callCenterUser = await upsertUser({
    email: CALL_CENTER_EMAIL,
    fullName: "Anna Vo",
    passwordHash: callCenterPasswordHash,
    role: Role.CALL_CENTER_AGENT,
    phone: "+17325550190"
  });

  const { periodStart, periodEnd } = getCurrentBillingPeriod();

  let salon = await prisma.salon.findUnique({
    where: {
      ownerId: ownerUser.id
    }
  });

  if (!salon) {
    salon = await prisma.salon.create({
      data: {
        ...(DEMO_SALON_ID ? { id: DEMO_SALON_ID } : {}),
        ownerId: ownerUser.id,
        name: DEMO_SALON_NAME,
        timezone: DEMO_TIMEZONE,
        status: SalonStatus.ACTIVE,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        planName: "starter",
        contactEmail: OWNER_EMAIL,
        contactPhone: DEMO_ORIGINAL_PHONE,
        originalPhoneNumber: DEMO_ORIGINAL_PHONE,
        customerIncomingPhoneNumber: DEMO_TRACKING_PHONE,
        notificationPhoneNumber: DEMO_ORIGINAL_PHONE,
        addressLine1: "235 Broad Street",
        city: "Red Bank",
        state: "NJ",
        postalCode: "07701",
        country: "US"
      }
    });
  } else {
    salon = await prisma.salon.update({
      where: { id: salon.id },
      data: {
        name: DEMO_SALON_NAME,
        timezone: DEMO_TIMEZONE,
        status: SalonStatus.ACTIVE,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        planName: "starter",
        contactEmail: OWNER_EMAIL,
        contactPhone: DEMO_ORIGINAL_PHONE,
        originalPhoneNumber: DEMO_ORIGINAL_PHONE,
        customerIncomingPhoneNumber: DEMO_TRACKING_PHONE,
        notificationPhoneNumber: DEMO_ORIGINAL_PHONE,
        addressLine1: "235 Broad Street",
        addressLine2: null,
        city: "Red Bank",
        state: "NJ",
        postalCode: "07701",
        country: "US"
      }
    });
  }

  await prisma.user.update({
    where: { id: ownerUser.id },
    data: {
      salonId: salon.id
    }
  });

  const extraOwnedSalon = await prisma.salon.findUnique({
    where: {
      ownerId: extraOwnerUser.id
    },
    select: {
      id: true
    }
  });

  if (extraOwnedSalon?.id) {
    await prisma.user.update({
      where: { id: extraOwnerUser.id },
      data: {
        salonId: null
      }
    });

    await prisma.salon.delete({
      where: {
        id: extraOwnedSalon.id
      }
    });
  }

  await prisma.user.update({
    where: { id: extraOwnerUser.id },
    data: {
      salonId: null
    }
  });

  await prisma.subscription.upsert({
    where: { salonId: salon.id },
    update: {
      planCode: "starter",
      status: SubscriptionStatus.ACTIVE,
      basePriceCents: 9900,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd
    },
    create: {
      salonId: salon.id,
      planCode: "starter",
      status: SubscriptionStatus.ACTIVE,
      basePriceCents: 9900,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd
    }
  });

  await prisma.salonSetting.upsert({
    where: { salonId: salon.id },
    update: {
      currency: "USD",
      locale: "vi-VN",
      bookingLeadTimeMinutes: 30,
      aiForwardingEnabled: true,
      aiReceptionEnabled: true,
      aiTransferRingCount: 3,
      callCenterEnabled: true,
      voicemailEnabled: true,
      callbackRequestEnabled: true,
      smsFallbackEnabled: true,
      aiGreetingPrompt:
        `Thank you for calling ${DEMO_SALON_NAME}. How can I help you today?`,
      callerLanguage: "en",
      callLogVisibility: "OWNER_STAFF_OPERATOR",
      notificationRecipients: [OWNER_EMAIL, DEMO_ORIGINAL_PHONE, CALL_CENTER_EMAIL],
      callCenterRoutingNumber: callCenterUser.phone,
      callCenterRoutingNote:
        "Escalate VIP callers, reschedules, and fully booked requests to Anna Vo in the shared queue."
    },
    create: {
      salonId: salon.id,
      currency: "USD",
      locale: "vi-VN",
      bookingLeadTimeMinutes: 30,
      aiForwardingEnabled: true,
      aiReceptionEnabled: true,
      aiTransferRingCount: 3,
      callCenterEnabled: true,
      voicemailEnabled: true,
      callbackRequestEnabled: true,
      smsFallbackEnabled: true,
      aiGreetingPrompt:
        `Thank you for calling ${DEMO_SALON_NAME}. How can I help you today?`,
      callerLanguage: "en",
      callLogVisibility: "OWNER_STAFF_OPERATOR",
      notificationRecipients: [OWNER_EMAIL, DEMO_ORIGINAL_PHONE, CALL_CENTER_EMAIL],
      callCenterRoutingNumber: callCenterUser.phone,
      callCenterRoutingNote:
        "Escalate VIP callers, reschedules, and fully booked requests to Anna Vo in the shared queue."
    }
  });

  const aiSetupTimestamp = new Date(Date.now() - 1000 * 60 * 45);
  await prisma.salonAiReceptionSetup.upsert({
    where: { salonId: salon.id },
    update: {
      provider: ExternalProvider.AMAZON_CONNECT,
      carrier: "tmobile",
      originalPhoneNumber: DEMO_ORIGINAL_PHONE_DIGITS,
      forwardingPhoneNumber: DEMO_TRACKING_PHONE_DIGITS,
      forwardingType: AiReceptionForwardingType.NO_ANSWER,
      activationCode: DEMO_FORWARDING_ACTIVATION_CODE,
      deactivationCode: DEMO_FORWARDING_DEACTIVATION_CODE,
      status: AiReceptionSetupStatus.ACTIVE,
      lastTestedAt: aiSetupTimestamp,
      lastVerifiedAt: aiSetupTimestamp
    },
    create: {
      salonId: salon.id,
      provider: ExternalProvider.AMAZON_CONNECT,
      carrier: "tmobile",
      originalPhoneNumber: DEMO_ORIGINAL_PHONE_DIGITS,
      forwardingPhoneNumber: DEMO_TRACKING_PHONE_DIGITS,
      forwardingType: AiReceptionForwardingType.NO_ANSWER,
      activationCode: DEMO_FORWARDING_ACTIVATION_CODE,
      deactivationCode: DEMO_FORWARDING_DEACTIVATION_CODE,
      status: AiReceptionSetupStatus.ACTIVE,
      lastTestedAt: aiSetupTimestamp,
      lastVerifiedAt: aiSetupTimestamp
    }
  });

  await prisma.callCenterSalonAssignment.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  await prisma.callCenterSalonAssignment.create({
    data: {
      salonId: salon.id,
      agentUserId: callCenterUser.id,
      assignedByUserId: adminUser.id
    }
  });

  await prisma.appointmentStatusHistory.deleteMany({
    where: {
      appointment: {
        salonId: salon.id
      }
    }
  });

  await prisma.staffReminder.deleteMany({ where: { salonId: salon.id } });
  await prisma.staffWorkSession.deleteMany({ where: { salonId: salon.id } });
  await prisma.customerFeedback.deleteMany({ where: { salonId: salon.id } });
  await prisma.chatMessage.deleteMany({ where: { salonId: salon.id } });
  await prisma.alert.deleteMany({ where: { salonId: salon.id } });
  await prisma.aiInteractionLog.deleteMany({ where: { salonId: salon.id } });
  await prisma.bookingAttempt.deleteMany({ where: { salonId: salon.id } });
  await prisma.callEvent.deleteMany({ where: { salonId: salon.id } });
  await prisma.callTranscript.deleteMany({ where: { salonId: salon.id } });
  await prisma.callEscalation.deleteMany({ where: { salonId: salon.id } });
  await prisma.callSession.deleteMany({ where: { salonId: salon.id } });
  await prisma.appointmentService.deleteMany({ where: { salonId: salon.id } });
  await prisma.appointment.deleteMany({ where: { salonId: salon.id } });
  await prisma.staffService.deleteMany({ where: { salonId: salon.id } });
  await prisma.customer.deleteMany({ where: { salonId: salon.id } });

  const businessHours = [
    { dayOfWeek: 0, isOpen: false, openTime: null, closeTime: null },
    { dayOfWeek: 1, isOpen: true, openTime: "09:30", closeTime: "19:00" },
    { dayOfWeek: 2, isOpen: true, openTime: "09:30", closeTime: "19:00" },
    { dayOfWeek: 3, isOpen: true, openTime: "09:30", closeTime: "19:00" },
    { dayOfWeek: 4, isOpen: true, openTime: "09:30", closeTime: "19:00" },
    { dayOfWeek: 5, isOpen: true, openTime: "09:30", closeTime: "19:00" },
    { dayOfWeek: 6, isOpen: true, openTime: "09:00", closeTime: "17:00" }
  ];

  await Promise.all(
    businessHours.map((hours) =>
      prisma.businessHour.upsert({
        where: {
          salonId_dayOfWeek: {
            salonId: salon.id,
            dayOfWeek: hours.dayOfWeek
          }
        },
        update: {
          isOpen: hours.isOpen,
          openTime: hours.openTime,
          closeTime: hours.closeTime
        },
        create: {
          salonId: salon.id,
          ...hours
        }
      })
    )
  );

  const existingTrangStaff = await prisma.staff.findMany({
    where: {
      salonId: salon.id,
      fullName: {
        equals: "Trang",
        mode: "insensitive"
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  const trang = existingTrangStaff[0]
    ? await prisma.staff.update({
        where: { id: existingTrangStaff[0].id },
        data: {
          fullName: "Trang",
          email: STAFF_EMAIL,
          phone: "+17325550101",
          title: "Pedicure Specialist",
          status: StaffStatus.ACTIVE,
          currentWorkStatus: StaffWorkStatus.AVAILABLE,
          activeAppointmentId: null,
          isBookable: true
        }
      })
    : await prisma.staff.create({
        data: {
          salonId: salon.id,
          fullName: "Trang",
          email: STAFF_EMAIL,
          phone: "+17325550101",
          title: "Pedicure Specialist",
          status: StaffStatus.ACTIVE,
          currentWorkStatus: StaffWorkStatus.AVAILABLE,
          isBookable: true
        }
      });

  await prisma.staff.deleteMany({
    where: {
      salonId: salon.id,
      id: { not: trang.id }
    }
  });

  const staffUser = await upsertUser({
    email: STAFF_EMAIL,
    fullName: "Trang",
    passwordHash: staffPasswordHash,
    role: Role.STAFF,
    phone: trang.phone,
    salonId: salon.id,
    staffId: trang.id
  });

  const demoServices = [
    {
      name: "Manicure",
      description: "Cuticle care, shaping, polish, and hand massage.",
      durationMinutes: 40,
      priceCents: 3500
    },
    {
      name: "Pedicure",
      description: "Soak, scrub, callus care, massage, and polish.",
      durationMinutes: 45,
      priceCents: 4500
    },
    {
      name: "Gel Manicure",
      description: "Cuticle care, shaping, gel color, and hand massage.",
      durationMinutes: 60,
      priceCents: 5000
    },
    {
      name: "Acrylic Full Set",
      description: "Full acrylic set with shaping and gel finish.",
      durationMinutes: 100,
      priceCents: 8500
    },
    {
      name: "Dip Powder",
      description: "Prep, dip color layers, shaping, and glossy top coat.",
      durationMinutes: 70,
      priceCents: 5800
    }
  ];

  const services: Array<{ id: string }> = [];
  for (const serviceInput of demoServices) {
    const existingService = await prisma.service.findFirst({
      where: {
        salonId: salon.id,
        name: {
          equals: serviceInput.name,
          mode: "insensitive"
        }
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    const service = existingService
      ? await prisma.service.update({
          where: { id: existingService.id },
          data: {
            name: serviceInput.name,
            description: serviceInput.description,
            durationMinutes: serviceInput.durationMinutes,
            priceCents: serviceInput.priceCents,
            isActive: true
          }
        })
      : await prisma.service.create({
          data: {
            salonId: salon.id,
            ...serviceInput,
            isActive: true
          }
        });
    services.push(service);
  }

  await prisma.service.deleteMany({
    where: {
      salonId: salon.id,
      id: {
        notIn: services.map((service) => service.id)
      }
    }
  });

  await prisma.staffService.createMany({
    data: services.map((service) => ({
      salonId: salon.id,
      serviceId: service.id,
      staffId: trang.id
    })),
    skipDuplicates: true
  });

  await prisma.integrationConfig.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  await prisma.integrationConfig.createMany({
    data: [
      {
        salonId: salon.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        configKey: "phone_number",
        configValue: DEMO_TRACKING_PHONE_DIGITS
      },
      {
        salonId: salon.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        configKey: "forwarding_phone_number",
        configValue: DEMO_TRACKING_PHONE_DIGITS
      },
      {
        salonId: salon.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        configKey: "contact_flow_name_ai_reception",
        configValue: DEMO_CALL_FLOW_NAME
      },
      {
        salonId: salon.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        configKey: "salon_original_number",
        configValue: DEMO_ORIGINAL_PHONE_DIGITS
      },
      {
        salonId: salon.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        configKey: "instance_id",
        configValue: DEMO_CONNECT_INSTANCE_ID
      },
      {
        salonId: salon.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        configKey: "lex_bot_id",
        configValue: DEMO_LEX_BOT_ID
      },
      {
        salonId: salon.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        configKey: "lex_bot_alias_id",
        configValue: DEMO_LEX_BOT_ALIAS_ID
      },
      {
        salonId: salon.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        configKey: "contact_flow_id_ai_reception",
        configValue:
          process.env.AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION ??
          "demo-ai-reception-contact-flow"
      },
      {
        salonId: salon.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        configKey: "contact_flow_id_human_escalation",
        configValue:
          process.env.AMAZON_CONNECT_CONTACT_FLOW_ID_HUMAN_ESCALATION ??
          "demo-human-escalation-contact-flow"
      },
      {
        salonId: salon.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        configKey: "queue_id",
        configValue: DEMO_CONNECT_QUEUE_ID
      },
      {
        salonId: salon.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        configKey: "routing_profile_id",
        configValue: DEMO_CONNECT_ROUTING_PROFILE_ID
      },
      {
        salonId: salon.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        configKey: "booking_lambda_function_name",
        configValue:
          process.env.BOOKING_LAMBDA_FUNCTION_NAME ??
          process.env.LAMBDA_BOOKING_HANDLER_NAME ??
          "demo-booking-handler"
      }
    ]
  });

  const activeStaffCount = 1;

  const freeStaffLimit = Number(process.env.FREE_STAFF_LIMIT ?? 5);
  const extraStaffPrice = Number(process.env.EXTRA_STAFF_PRICE ?? 0);
  const includedStaffCount = Math.min(activeStaffCount, freeStaffLimit);
  const billableExtraStaffCount = Math.max(activeStaffCount - freeStaffLimit, 0);
  const extraStaffUnitPriceCents = Math.round(extraStaffPrice * 100);
  const estimatedExtraCostCents = billableExtraStaffCount * extraStaffUnitPriceCents;

  await prisma.billingUsage.upsert({
    where: {
      salonId_periodStart_periodEnd: {
        salonId: salon.id,
        periodStart,
        periodEnd
      }
    },
    update: {
      freeStaffLimit,
      activeStaffCount,
      includedStaffCount,
      billableExtraStaffCount,
      extraStaffUnitPriceCents,
      estimatedExtraCostCents
    },
    create: {
      salonId: salon.id,
      periodStart,
      periodEnd,
      freeStaffLimit,
      activeStaffCount,
      includedStaffCount,
      billableExtraStaffCount,
      extraStaffUnitPriceCents,
      estimatedExtraCostCents
    }
  });

  const historicalBillingSnapshots = [
    { monthOffset: -1, activeCount: 5 },
    { monthOffset: -2, activeCount: 6 }
  ];

  await Promise.all(
    historicalBillingSnapshots.map(async (snapshot) => {
      const periodDate = new Date();
      periodDate.setUTCMonth(periodDate.getUTCMonth() + snapshot.monthOffset);
      const historicalPeriodStart = new Date(
        Date.UTC(periodDate.getUTCFullYear(), periodDate.getUTCMonth(), 1, 0, 0, 0, 0)
      );
      const historicalPeriodEnd = new Date(
        Date.UTC(periodDate.getUTCFullYear(), periodDate.getUTCMonth() + 1, 0, 23, 59, 59, 999)
      );
      const historicalIncluded = Math.min(snapshot.activeCount, freeStaffLimit);
      const historicalBillable = Math.max(snapshot.activeCount - freeStaffLimit, 0);

      await prisma.billingUsage.upsert({
        where: {
          salonId_periodStart_periodEnd: {
            salonId: salon.id,
            periodStart: historicalPeriodStart,
            periodEnd: historicalPeriodEnd
          }
        },
        update: {
          freeStaffLimit,
          activeStaffCount: snapshot.activeCount,
          includedStaffCount: historicalIncluded,
          billableExtraStaffCount: historicalBillable,
          extraStaffUnitPriceCents,
          estimatedExtraCostCents: historicalBillable * extraStaffUnitPriceCents
        },
        create: {
          salonId: salon.id,
          periodStart: historicalPeriodStart,
          periodEnd: historicalPeriodEnd,
          freeStaffLimit,
          activeStaffCount: snapshot.activeCount,
          includedStaffCount: historicalIncluded,
          billableExtraStaffCount: historicalBillable,
          extraStaffUnitPriceCents,
          estimatedExtraCostCents: historicalBillable * extraStaffUnitPriceCents
        }
      });
    })
  );

  console.log("Seed completed successfully.");
  console.log(`Admin login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  console.log(`Owner login: ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
  console.log(`Staff login: ${STAFF_EMAIL} / ${STAFF_PASSWORD}`);
  console.log(`Call center login: ${CALL_CENTER_EMAIL} / ${CALL_CENTER_PASSWORD}`);
  console.log(`Preserved extra owner login: ${EXTRA_OWNER_EMAIL} / ${EXTRA_OWNER_PASSWORD}`);
  console.log(`Seeded salon: ${DEMO_SALON_NAME}`);
  console.log(`Original phone number: ${DEMO_ORIGINAL_PHONE}`);
  console.log(`Forward-to Amazon Connect number: ${DEMO_TRACKING_PHONE}`);
  console.log(`Amazon Connect Contact Flow name: ${DEMO_CALL_FLOW_NAME}`);
  console.log(`Forwarding activation code: ${DEMO_FORWARDING_ACTIVATION_CODE}`);
  console.log(`Forwarding fallback code: ${DEMO_FORWARDING_FALLBACK_CODE}`);
  console.log(`Forwarding deactivation code: ${DEMO_FORWARDING_DEACTIVATION_CODE}`);
  console.log(`Forwarding status check code: ${DEMO_FORWARDING_STATUS_CODE}`);
  console.log(`Active staff in current billing period: ${activeStaffCount}`);
  console.log(`Billable extra staff in current billing period: ${billableExtraStaffCount}`);
  console.log(`Admin user id: ${adminUser.id}`);
  console.log(`Owner user id: ${ownerUser.id}`);
  console.log(`Staff user id: ${staffUser.id}`);
  console.log(`Call center user id: ${callCenterUser.id}`);
  console.log(`Salon id: ${salon.id}`);
};

run()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
