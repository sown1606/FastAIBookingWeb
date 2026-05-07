import {
  AiReceptionForwardingType,
  AiReceptionSetupStatus,
  AppointmentSource,
  AppointmentStatus,
  BookingAttemptStatus,
  CallEscalationStatus,
  CallRoutingOutcome,
  CallSessionStatus,
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

const DEMO_SALON_NAME = "Inails Demo Salon";
const DEMO_ORIGINAL_PHONE = "+18487029493";
const DEMO_TRACKING_PHONE = "+18485550100";
const DEMO_ORIGINAL_PHONE_DIGITS = "18487029493";
const DEMO_TRACKING_PHONE_DIGITS = "18485550100";
const DEMO_CALL_FLOW_NAME = "AI Booking Reception";
const DEMO_FORWARDING_ACTIVATION_CODE = "**61*18485550100**10#";
const DEMO_FORWARDING_FALLBACK_CODE = "**61*18485550100#";
const DEMO_FORWARDING_DEACTIVATION_CODE = "##61#";
const DEMO_FORWARDING_STATUS_CODE = "*#61#";

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

const createFutureUtcDate = (dayOffset: number, hourUtc: number, minuteUtc = 0) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + dayOffset);
  date.setUTCHours(hourUtc, minuteUtc, 0, 0);
  return date;
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
    fullName: "Linh Nguyen",
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
        ownerId: ownerUser.id,
        name: DEMO_SALON_NAME,
        timezone: "America/New_York",
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
        timezone: "America/New_York",
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
        "Thank you for calling Inails Demo Salon. I can help with bookings, service changes, or connect you with our call center team.",
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
        "Thank you for calling Inails Demo Salon. I can help with bookings, service changes, or connect you with our call center team.",
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

  await prisma.businessHour.deleteMany({
    where: { salonId: salon.id }
  });

  await prisma.businessHour.createMany({
    data: [
      { salonId: salon.id, dayOfWeek: 0, isOpen: false, openTime: null, closeTime: null },
      { salonId: salon.id, dayOfWeek: 1, isOpen: true, openTime: "09:30", closeTime: "19:00" },
      { salonId: salon.id, dayOfWeek: 2, isOpen: true, openTime: "09:30", closeTime: "19:00" },
      { salonId: salon.id, dayOfWeek: 3, isOpen: true, openTime: "09:30", closeTime: "19:00" },
      { salonId: salon.id, dayOfWeek: 4, isOpen: true, openTime: "09:30", closeTime: "19:00" },
      { salonId: salon.id, dayOfWeek: 5, isOpen: true, openTime: "09:30", closeTime: "19:00" },
      { salonId: salon.id, dayOfWeek: 6, isOpen: true, openTime: "09:00", closeTime: "17:00" }
    ]
  });

  await prisma.appointmentStatusHistory.deleteMany({
    where: {
      appointment: {
        salonId: salon.id
      }
    }
  });

  await prisma.staffReminder.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  await prisma.staffWorkSession.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  await prisma.customerFeedback.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  await prisma.chatMessage.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  await prisma.alert.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  await prisma.aiInteractionLog.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  await prisma.bookingAttempt.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  await prisma.callTranscript.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  await prisma.callEvent.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  await prisma.callEscalation.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  await prisma.callSession.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  await prisma.appointment.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  await prisma.appointmentService.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  await prisma.staffService.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  await prisma.staff.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  await prisma.customer.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  await prisma.service.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  const staffMembers = await prisma.staff.createManyAndReturn({
    data: [
      {
        salonId: salon.id,
        fullName: "Mai Tran",
        email: "mai.demo@fastaibooking.local",
        phone: "+17325550101",
        title: "Senior Nail Technician",
        status: StaffStatus.ACTIVE,
        isBookable: true
      },
      {
        salonId: salon.id,
        fullName: "Vy Pham",
        email: "vy.demo@fastaibooking.local",
        phone: "+17325550102",
        title: "Nail Technician",
        status: StaffStatus.ACTIVE,
        isBookable: true
      },
      {
        salonId: salon.id,
        fullName: "Olivia Chen",
        email: "olivia.demo@fastaibooking.local",
        phone: "+17325550103",
        title: "Pedicure Specialist",
        status: StaffStatus.ACTIVE,
        isBookable: true
      },
      {
        salonId: salon.id,
        fullName: "Jasmine Le",
        email: "jasmine.demo@fastaibooking.local",
        phone: "+17325550104",
        title: "Senior Technician",
        status: StaffStatus.ACTIVE,
        isBookable: true
      },
      {
        salonId: salon.id,
        fullName: "Nora Martinez",
        email: "nora.demo@fastaibooking.local",
        phone: "+17325550105",
        title: "Receptionist",
        status: StaffStatus.ACTIVE,
        isBookable: false
      },
      {
        salonId: salon.id,
        fullName: "Camila Diaz",
        email: "camila.demo@fastaibooking.local",
        phone: "+17325550106",
        title: "Part-time Nail Technician",
        status: StaffStatus.ACTIVE,
        isBookable: true
      },
      {
        salonId: salon.id,
        fullName: "Hannah Bui",
        email: "hannah.demo@fastaibooking.local",
        phone: "+17325550107",
        title: "Nail Technician",
        status: StaffStatus.INACTIVE,
        isBookable: false
      }
    ]
  });

  const staffUser = await upsertUser({
    email: STAFF_EMAIL,
    fullName: staffMembers[0]!.fullName,
    passwordHash: staffPasswordHash,
    role: Role.STAFF,
    phone: staffMembers[0]!.phone,
    salonId: salon.id,
    staffId: staffMembers[0]!.id
  });

  const services = await prisma.service.createManyAndReturn({
    data: [
      {
        salonId: salon.id,
        name: "Gel Manicure",
        description: "Cuticle care, shaping, gel color, and hand massage.",
        durationMinutes: 60,
        priceCents: 4500,
        isActive: true
      },
      {
        salonId: salon.id,
        name: "Organic Spa Pedicure",
        description: "Soak, scrub, callus care, mask, massage, and polish.",
        durationMinutes: 75,
        priceCents: 6500,
        isActive: true
      },
      {
        salonId: salon.id,
        name: "Acrylic Full Set",
        description: "Full acrylic set with shaping and gel finish.",
        durationMinutes: 100,
        priceCents: 8500,
        isActive: true
      },
      {
        salonId: salon.id,
        name: "Gel X Full Set",
        description: "Soft gel extensions with a clean natural finish.",
        durationMinutes: 90,
        priceCents: 7800,
        isActive: true
      },
      {
        salonId: salon.id,
        name: "Dipping Powder Manicure",
        description: "Prep, dip color layers, shaping, and glossy top coat.",
        durationMinutes: 70,
        priceCents: 5800,
        isActive: true
      },
      {
        salonId: salon.id,
        name: "Nail Art Add-on",
        description: "Chrome, cat eye, gems, or accent designs.",
        durationMinutes: 20,
        priceCents: 1800,
        isActive: true
      }
    ]
  });

  const serviceByName = Object.fromEntries(services.map((service) => [service.name, service])) as Record<
    string,
    (typeof services)[number]
  >;
  const staffByName = Object.fromEntries(staffMembers.map((staff) => [staff.fullName, staff])) as Record<
    string,
    (typeof staffMembers)[number]
  >;

  await prisma.staffService.createMany({
    data: [
      ["Mai Tran", "Gel Manicure"],
      ["Mai Tran", "Acrylic Full Set"],
      ["Mai Tran", "Dipping Powder Manicure"],
      ["Mai Tran", "Nail Art Add-on"],
      ["Vy Pham", "Gel Manicure"],
      ["Vy Pham", "Organic Spa Pedicure"],
      ["Vy Pham", "Dipping Powder Manicure"],
      ["Olivia Chen", "Organic Spa Pedicure"],
      ["Olivia Chen", "Gel Manicure"],
      ["Jasmine Le", "Gel X Full Set"],
      ["Jasmine Le", "Acrylic Full Set"],
      ["Jasmine Le", "Nail Art Add-on"],
      ["Camila Diaz", "Gel Manicure"],
      ["Camila Diaz", "Organic Spa Pedicure"],
      ["Camila Diaz", "Dipping Powder Manicure"]
    ].map(([staffName, serviceName]) => ({
      salonId: salon.id,
      serviceId: serviceByName[serviceName]!.id,
      staffId: staffByName[staffName]!.id
    })),
    skipDuplicates: true
  });

  const customers = await prisma.customer.createManyAndReturn({
    data: [
      {
        salonId: salon.id,
        firstName: "Thao",
        lastName: "Nguyen",
        phone: "+18485550201",
        email: "thao.nguyen@example.com",
        notes: "Prefers short almond shape and neutral tones."
      },
      {
        salonId: salon.id,
        firstName: "Jessica",
        lastName: "Lopez",
        phone: "+18485550202",
        email: "jessica.lopez@example.com",
        notes: "Usually books pedicure on weekends."
      },
      {
        salonId: salon.id,
        firstName: "Emily",
        lastName: "Tran",
        phone: "+18485550203",
        email: "emily.tran@example.com",
        notes: "Likes gel x and detailed nail art."
      },
      {
        salonId: salon.id,
        firstName: "Sophie",
        lastName: "Kim",
        phone: "+18485550204",
        email: "sophie.kim@example.com",
        notes: "Requests late afternoon slots."
      },
      {
        salonId: salon.id,
        firstName: "Rachel",
        lastName: "Park",
        phone: "+18485550205",
        email: "rachel.park@example.com",
        notes: "Returning customer from local referral."
      },
      {
        salonId: salon.id,
        firstName: "Linda",
        lastName: "Ho",
        phone: "+18485550206",
        email: "linda.ho@example.com",
        notes: "Asks for dip powder and shorter lunch-break appointments."
      },
      {
        salonId: salon.id,
        firstName: "Megan",
        lastName: "Patel",
        phone: "+18485550207",
        email: "megan.patel@example.com",
        notes: "Prefers Friday afternoon visits and warm neutral colors."
      },
      {
        salonId: salon.id,
        firstName: "Ava",
        lastName: "Johnson",
        phone: "+18485550208",
        email: "ava.johnson@example.com",
        notes: "VIP guest who often needs last-minute reschedules."
      }
    ]
  });

  const appointments = await prisma.appointment.createManyAndReturn({
    data: [
      {
        salonId: salon.id,
        customerId: customers[0]!.id,
        staffId: staffByName["Olivia Chen"]!.id,
        serviceId: serviceByName["Organic Spa Pedicure"]!.id,
        startTime: createFutureUtcDate(0, 14, 0),
        endTime: createFutureUtcDate(0, 15, 15),
        durationMinutes: serviceByName["Organic Spa Pedicure"]!.durationMinutes,
        status: AppointmentStatus.COMPLETED,
        source: AppointmentSource.DASHBOARD,
        notes: "Completed lunch-break pedicure for a returning guest.",
        feedbackToken: "feedback-thao-completed-001",
        createdByUserId: ownerUser.id
      },
      {
        salonId: salon.id,
        customerId: customers[1]!.id,
        staffId: staffByName["Mai Tran"]!.id,
        serviceId: serviceByName["Gel Manicure"]!.id,
        startTime: createFutureUtcDate(0, 16, 0),
        endTime: createFutureUtcDate(0, 17, 0),
        durationMinutes: serviceByName["Gel Manicure"]!.durationMinutes,
        status: AppointmentStatus.IN_PROGRESS,
        source: AppointmentSource.DASHBOARD,
        notes: "Walk-in upgrade to gel finish while team monitors inbound calls.",
        createdByUserId: ownerUser.id
      },
      {
        salonId: salon.id,
        customerId: customers[7]!.id,
        staffId: staffByName["Jasmine Le"]!.id,
        serviceId: serviceByName["Gel X Full Set"]!.id,
        startTime: createFutureUtcDate(0, 19, 0),
        endTime: createFutureUtcDate(0, 20, 30),
        durationMinutes: serviceByName["Gel X Full Set"]!.durationMinutes,
        status: AppointmentStatus.CONFIRMED,
        source: AppointmentSource.CALL_CENTER,
        notes: "Operator confirmed same-day VIP reschedule.",
        createdByUserId: callCenterUser.id
      },
      {
        salonId: salon.id,
        customerId: customers[4]!.id,
        staffId: staffByName["Mai Tran"]!.id,
        serviceId: serviceByName["Gel Manicure"]!.id,
        startTime: createFutureUtcDate(1, 15, 0),
        endTime: createFutureUtcDate(1, 16, 0),
        durationMinutes: serviceByName["Gel Manicure"]!.durationMinutes,
        status: AppointmentStatus.CONFIRMED,
        source: AppointmentSource.AI,
        notes: "Booked after no-answer forwarding test call.",
        createdByUserId: ownerUser.id
      },
      {
        salonId: salon.id,
        customerId: customers[3]!.id,
        staffId: staffByName["Olivia Chen"]!.id,
        serviceId: serviceByName["Organic Spa Pedicure"]!.id,
        startTime: createFutureUtcDate(1, 17, 30),
        endTime: createFutureUtcDate(1, 18, 45),
        durationMinutes: serviceByName["Organic Spa Pedicure"]!.durationMinutes,
        status: AppointmentStatus.SCHEDULED,
        source: AppointmentSource.DASHBOARD,
        notes: "Requested late afternoon spa pedicure slot.",
        createdByUserId: ownerUser.id
      },
      {
        salonId: salon.id,
        customerId: customers[2]!.id,
        staffId: staffByName["Jasmine Le"]!.id,
        serviceId: serviceByName["Gel X Full Set"]!.id,
        startTime: createFutureUtcDate(2, 16, 0),
        endTime: createFutureUtcDate(2, 17, 30),
        durationMinutes: serviceByName["Gel X Full Set"]!.durationMinutes,
        status: AppointmentStatus.CONFIRMED,
        source: AppointmentSource.AI,
        notes: "Returning guest asked for Gel X full set.",
        createdByUserId: ownerUser.id
      },
      {
        salonId: salon.id,
        customerId: customers[5]!.id,
        staffId: staffByName["Vy Pham"]!.id,
        serviceId: serviceByName["Dipping Powder Manicure"]!.id,
        startTime: createFutureUtcDate(2, 18, 30),
        endTime: createFutureUtcDate(2, 19, 40),
        durationMinutes: serviceByName["Dipping Powder Manicure"]!.durationMinutes,
        status: AppointmentStatus.CONFIRMED,
        source: AppointmentSource.AI,
        notes: "AI booked a lunch-break dip powder service.",
        createdByUserId: ownerUser.id
      },
      {
        salonId: salon.id,
        customerId: customers[6]!.id,
        staffId: staffByName["Camila Diaz"]!.id,
        serviceId: serviceByName["Gel Manicure"]!.id,
        startTime: createFutureUtcDate(3, 18, 0),
        endTime: createFutureUtcDate(3, 19, 0),
        durationMinutes: serviceByName["Gel Manicure"]!.durationMinutes,
        status: AppointmentStatus.SCHEDULED,
        source: AppointmentSource.DASHBOARD,
        notes: "Friday appointment held for a frequent after-work guest.",
        createdByUserId: ownerUser.id
      },
      {
        salonId: salon.id,
        customerId: customers[7]!.id,
        staffId: staffByName["Mai Tran"]!.id,
        serviceId: serviceByName["Acrylic Full Set"]!.id,
        startTime: createFutureUtcDate(4, 17, 0),
        endTime: createFutureUtcDate(4, 18, 40),
        durationMinutes: serviceByName["Acrylic Full Set"]!.durationMinutes,
        status: AppointmentStatus.CONFIRMED,
        source: AppointmentSource.CALL_CENTER,
        notes: "Operator confirmed a reschedule for a full acrylic set.",
        createdByUserId: ownerUser.id
      }
    ]
  });

  await prisma.appointmentStatusHistory.createMany({
    data: appointments.map((appointment) => ({
      appointmentId: appointment.id,
      previousStatus: null,
      newStatus: appointment.status,
      reason: "Seeded demo data",
      changedByUserId: ownerUser.id
    }))
  });

  await prisma.appointmentService.createMany({
    data: appointments.map((appointment) => ({
      salonId: salon.id,
      appointmentId: appointment.id,
      serviceId: appointment.serviceId,
      durationMinutes: appointment.durationMinutes,
      priceCents: services.find((service) => service.id === appointment.serviceId)!.priceCents
    })),
    skipDuplicates: true
  });

  await prisma.appointmentStatusHistory.createMany({
    data: [
      {
        appointmentId: appointments[0]!.id,
        previousStatus: AppointmentStatus.CONFIRMED,
        newStatus: AppointmentStatus.COMPLETED,
        reason: "Service completed and feedback requested.",
        changedByUserId: ownerUser.id
      },
      {
        appointmentId: appointments[1]!.id,
        previousStatus: AppointmentStatus.CONFIRMED,
        newStatus: AppointmentStatus.IN_PROGRESS,
        reason: "Technician started the service.",
        changedByUserId: staffUser.id
      }
    ]
  });

  await prisma.staffWorkSession.createMany({
    data: [
      {
        salonId: salon.id,
        staffId: appointments[0]!.staffId,
        appointmentId: appointments[0]!.id,
        status: StaffWorkStatus.DONE,
        startedAt: new Date(new Date(appointments[0]!.startTime).getTime() - 5 * 60 * 1000),
        expectedEndAt: appointments[0]!.endTime,
        endedAt: appointments[0]!.endTime
      },
      {
        salonId: salon.id,
        staffId: appointments[1]!.staffId,
        appointmentId: appointments[1]!.id,
        status: StaffWorkStatus.IN_PROGRESS,
        startedAt: new Date(new Date(appointments[1]!.startTime).getTime() - 5 * 60 * 1000),
        expectedEndAt: appointments[1]!.endTime
      }
    ]
  });

  await prisma.staffReminder.createMany({
    data: [
      {
        salonId: salon.id,
        staffId: appointments[3]!.staffId,
        appointmentId: appointments[3]!.id,
        reminderType: "APPOINTMENT_PREP",
        remindAt: new Date(new Date(appointments[3]!.startTime).getTime() - 2 * 60 * 60 * 1000),
        message: "Prepare gel manicure station for tomorrow's AI booking."
      },
      {
        salonId: salon.id,
        staffId: appointments[8]!.staffId,
        appointmentId: appointments[8]!.id,
        reminderType: "VIP_RESCHEDULE",
        remindAt: new Date(new Date(appointments[8]!.startTime).getTime() - 24 * 60 * 60 * 1000),
        message: "Confirm acrylic colors and extra soak-off time for the VIP reschedule."
      }
    ]
  });

  await prisma.customerFeedback.create({
    data: {
      salonId: salon.id,
      appointmentId: appointments[0]!.id,
      customerPhone: customers[0]!.phone,
      rating: 5,
      reason: "Loved the massage and the clean finish."
    }
  });

  await prisma.staff.update({
    where: { id: appointments[1]!.staffId },
    data: {
      currentWorkStatus: StaffWorkStatus.IN_PROGRESS,
      activeAppointmentId: appointments[1]!.id
    }
  });

  await prisma.chatMessage.createMany({
    data: [
      {
        salonId: salon.id,
        staffId: staffUser.staffId!,
        senderUserId: ownerUser.id,
        body: "Please confirm tomorrow's AI manicure booking and hold a chrome sample set."
      },
      {
        salonId: salon.id,
        staffId: staffUser.staffId!,
        senderUserId: staffUser.id,
        body: "Confirmed. I blocked an extra 15 minutes for nail art options."
      }
    ]
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
        configValue: "demo-amazon-connect-instance"
      },
      {
        salonId: salon.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        configKey: "lex_bot_id",
        configValue: "demo-lex-booking-bot"
      },
      {
        salonId: salon.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        configKey: "queue_id",
        configValue: "demo-shared-queue"
      },
      {
        salonId: salon.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        configKey: "routing_profile_id",
        configValue: "demo-routing-profile"
      }
    ]
  });

  const nowMs = Date.now();
  const directInboundStartedAt = new Date(nowMs - 1000 * 60 * 60 * 8);
  const directInboundAnsweredAt = new Date(directInboundStartedAt.getTime() + 8_000);
  const directInboundEndedAt = new Date(directInboundAnsweredAt.getTime() + 6 * 60 * 1000);

  const directInboundCall = await prisma.callSession.create({
    data: {
      salonId: salon.id,
      provider: ExternalProvider.AMAZON_CONNECT,
      providerCallId: "demo-salon-ring-1",
      providerCompanyId: "demo-amazon-connect-instance",
      callerPhone: customers[6]!.phone,
      originalPhoneNumber: DEMO_ORIGINAL_PHONE,
      dialedPhone: DEMO_ORIGINAL_PHONE,
      trackingNumber: DEMO_TRACKING_PHONE,
      direction: "inbound",
      sourceName: "Main Salon Line",
      campaignName: DEMO_CALL_FLOW_NAME,
      status: CallSessionStatus.COMPLETED,
      startedAt: directInboundStartedAt,
      answeredAt: directInboundAnsweredAt,
      endedAt: directInboundEndedAt,
      durationSeconds: 360,
      routingOutcome: CallRoutingOutcome.SALON_RING,
      finalResolution: "Salon front desk answered directly and confirmed the existing appointment.",
      rawPayload: {
        seed: true,
        route: "SALON_RING"
      }
    }
  });

  const aiBookingStartedAt = new Date(nowMs - 1000 * 60 * 90);
  const aiBookingAnsweredAt = new Date(aiBookingStartedAt.getTime() + 12_000);
  const aiBookingEndedAt = new Date(aiBookingAnsweredAt.getTime() + 4 * 60 * 1000);

  const aiBookingCall = await prisma.callSession.create({
    data: {
      salonId: salon.id,
      provider: ExternalProvider.AMAZON_CONNECT,
      providerCallId: "demo-forwarding-call-1",
      providerCompanyId: "demo-amazon-connect-instance",
      callerPhone: customers[4]!.phone,
      originalPhoneNumber: DEMO_ORIGINAL_PHONE,
      dialedPhone: DEMO_TRACKING_PHONE,
      trackingNumber: DEMO_TRACKING_PHONE,
      direction: "inbound",
      sourceName: "Forwarding Demo",
      campaignName: DEMO_CALL_FLOW_NAME,
      status: CallSessionStatus.COMPLETED,
      startedAt: aiBookingStartedAt,
      answeredAt: aiBookingAnsweredAt,
      endedAt: aiBookingEndedAt,
      durationSeconds: 240,
      recordingUrl: "https://example.com/recordings/demo-forwarding-call-1.mp3",
      transcriptSummary:
        "Caller asked for a gel manicure after the salon number rang and forwarded to the AI line.",
      aiSummary: {
        intentType: "BOOK_APPOINTMENT",
        customerName: `${customers[4]!.firstName} ${customers[4]!.lastName}`,
        requestedService: "Gel Manicure",
        result: "BOOKED"
      },
      routingOutcome: CallRoutingOutcome.AI_RECEPTION,
      finalResolution: "Appointment created successfully for the demo salon.",
      rawPayload: {
        seed: true,
        callFlowName: DEMO_CALL_FLOW_NAME,
        originalPhoneNumber: DEMO_ORIGINAL_PHONE,
        forwardingPhoneNumber: DEMO_TRACKING_PHONE
      }
    }
  });

  const aiBookingTranscript = await prisma.callTranscript.create({
    data: {
      salonId: salon.id,
      callSessionId: aiBookingCall.id,
      transcriptSource: "amazon_connect_contact_flow",
      transcriptText:
        "Hi, I called the salon line and it forwarded me here. I need a gel manicure tomorrow afternoon. My phone number is 848-555-0205.",
      transcriptSummary:
        "Caller requested a gel manicure after the no-answer forwarding flow sent the call to AI."
    }
  });

  const aiBookingAttempt = await prisma.bookingAttempt.create({
    data: {
      salonId: salon.id,
      callSessionId: aiBookingCall.id,
      transcriptId: aiBookingTranscript.id,
      appointmentId: appointments[3]!.id,
      status: BookingAttemptStatus.SUCCESS,
      source: "AI_TRANSCRIPT",
      customerName: `${customers[4]!.firstName} ${customers[4]!.lastName}`,
      customerPhone: customers[4]!.phone,
      requestedService: services[0]!.name,
      requestedStaff: staffMembers[0]!.fullName,
      requestedDateTimeText: appointments[3]!.startTime.toISOString(),
      normalizedRequest: {
        customerName: `${customers[4]!.firstName} ${customers[4]!.lastName}`,
        customerPhone: customers[4]!.phone,
        serviceName: services[0]!.name,
        staffName: staffMembers[0]!.fullName,
        startTimeIso: appointments[3]!.startTime.toISOString(),
        forwardingType: "no_answer"
      },
      rawInput: {
        originalPhoneNumber: DEMO_ORIGINAL_PHONE,
        forwardingPhoneNumber: DEMO_TRACKING_PHONE,
        callFlowName: DEMO_CALL_FLOW_NAME
      },
      createdByUserId: ownerUser.id
    }
  });

  await prisma.aiInteractionLog.create({
    data: {
      salonId: salon.id,
      provider: ExternalProvider.AMAZON_CONNECT,
      model: "amazon-lex-booking-bot",
      taskType: "parse_booking",
      requestText: aiBookingTranscript.transcriptText,
      requestPayload: {
        seed: true,
        callFlowName: DEMO_CALL_FLOW_NAME
      },
      responseText: JSON.stringify({
        intentType: "BOOK_APPOINTMENT",
        confidence: 0.95
      }),
      responsePayload: {
        seed: true
      },
      parsedOutput: {
        intentType: "BOOK_APPOINTMENT",
        serviceName: services[0]!.name,
        staffName: staffMembers[0]!.fullName,
        appointmentId: appointments[3]!.id
      },
      isValid: true,
      confidence: 0.95,
      callSessionId: aiBookingCall.id,
      transcriptId: aiBookingTranscript.id,
      bookingAttemptId: aiBookingAttempt.id,
      createdByUserId: ownerUser.id
    }
  });

  const openEscalationStartedAt = new Date(nowMs - 1000 * 60 * 32);
  const openEscalationEndedAt = new Date(openEscalationStartedAt.getTime() + 2 * 60 * 1000);
  const openEscalationCall = await prisma.callSession.create({
    data: {
      salonId: salon.id,
      provider: ExternalProvider.AMAZON_CONNECT,
      providerCallId: "demo-escalation-open-1",
      providerCompanyId: "demo-amazon-connect-instance",
      callerPhone: customers[7]!.phone,
      originalPhoneNumber: DEMO_ORIGINAL_PHONE,
      dialedPhone: DEMO_TRACKING_PHONE,
      trackingNumber: DEMO_TRACKING_PHONE,
      direction: "inbound",
      sourceName: "Forwarding Demo",
      campaignName: DEMO_CALL_FLOW_NAME,
      status: CallSessionStatus.COMPLETED,
      startedAt: openEscalationStartedAt,
      answeredAt: new Date(openEscalationStartedAt.getTime() + 10_000),
      endedAt: openEscalationEndedAt,
      durationSeconds: 120,
      transcriptSummary:
        "Caller wants to move an existing acrylic appointment and asked to speak to a real person.",
      aiSummary: {
        intentType: "RESCHEDULE_APPOINTMENT",
        escalationRequested: true,
        customerName: `${customers[7]!.firstName} ${customers[7]!.lastName}`
      },
      routingOutcome: CallRoutingOutcome.QUEUED,
      finalResolution: "Waiting in the human operator queue.",
      rawPayload: {
        seed: true,
        route: "QUEUED"
      }
    }
  });

  const openEscalationTranscript = await prisma.callTranscript.create({
    data: {
      salonId: salon.id,
      callSessionId: openEscalationCall.id,
      transcriptSource: "amazon_connect_contact_flow",
      transcriptText:
        "Hi, I need to move my acrylic full set. Friday works, but I need to talk to a real person because I have a bridal party schedule.",
      transcriptSummary:
        "Caller asked for a human operator to reschedule a VIP acrylic appointment."
    }
  });

  const openEscalationAttempt = await prisma.bookingAttempt.create({
    data: {
      salonId: salon.id,
      callSessionId: openEscalationCall.id,
      transcriptId: openEscalationTranscript.id,
      status: BookingAttemptStatus.NEEDS_INPUT,
      source: "AI_TRANSCRIPT",
      customerName: `${customers[7]!.firstName} ${customers[7]!.lastName}`,
      customerPhone: customers[7]!.phone,
      requestedService: serviceByName["Acrylic Full Set"]!.name,
      requestedStaff: staffByName["Mai Tran"]!.fullName,
      requestedDateTimeText: "Friday afternoon",
      failureReason: "Caller requested a real person before finalizing the reschedule.",
      normalizedRequest: {
        serviceName: "Acrylic Full Set",
        requestedChange: "reschedule",
        priority: "vip"
      },
      createdByUserId: ownerUser.id
    }
  });

  await prisma.aiInteractionLog.create({
    data: {
      salonId: salon.id,
      provider: ExternalProvider.AMAZON_CONNECT,
      model: "amazon-lex-booking-bot",
      taskType: "route_live_person_request",
      requestText: openEscalationTranscript.transcriptText,
      responseText: JSON.stringify({
        intentType: "LIVE_PERSON_REQUEST",
        confidence: 0.98
      }),
      parsedOutput: {
        intentType: "LIVE_PERSON_REQUEST",
        routingOutcome: "QUEUED"
      },
      isValid: true,
      confidence: 0.98,
      callSessionId: openEscalationCall.id,
      transcriptId: openEscalationTranscript.id,
      bookingAttemptId: openEscalationAttempt.id,
      createdByUserId: ownerUser.id
    }
  });

  const openEscalation = await prisma.callEscalation.create({
    data: {
      salonId: salon.id,
      callSessionId: openEscalationCall.id,
      status: CallEscalationStatus.QUEUED,
      routingOutcome: CallRoutingOutcome.QUEUED,
      escalationReason: "VIP reschedule requires a human operator.",
      requestedBy: "AI_RECEPTION",
      customerPhone: customers[7]!.phone,
      queueId: "demo-shared-queue",
      queueName: "Amazon Connect Shared Queue",
      messageToCaller: "Please hold while I place you into our operator queue.",
      requestedAt: new Date(nowMs - 1000 * 60 * 28),
      queuedAt: new Date(nowMs - 1000 * 60 * 27),
      metadata: {
        source: "seed",
        priority: "vip"
      }
    }
  });

  const resolvedEscalationStartedAt = new Date(nowMs - 1000 * 60 * 60 * 3);
  const resolvedEscalationEndedAt = new Date(resolvedEscalationStartedAt.getTime() + 5 * 60 * 1000);
  const resolvedEscalationCall = await prisma.callSession.create({
    data: {
      salonId: salon.id,
      provider: ExternalProvider.AMAZON_CONNECT,
      providerCallId: "demo-escalation-closed-1",
      providerCompanyId: "demo-amazon-connect-instance",
      callerPhone: customers[6]!.phone,
      originalPhoneNumber: DEMO_ORIGINAL_PHONE,
      dialedPhone: DEMO_TRACKING_PHONE,
      trackingNumber: DEMO_TRACKING_PHONE,
      direction: "inbound",
      sourceName: "Forwarding Demo",
      campaignName: DEMO_CALL_FLOW_NAME,
      status: CallSessionStatus.COMPLETED,
      startedAt: resolvedEscalationStartedAt,
      answeredAt: new Date(resolvedEscalationStartedAt.getTime() + 11_000),
      endedAt: resolvedEscalationEndedAt,
      durationSeconds: 300,
      transcriptSummary:
        "Caller requested a human operator to reschedule Friday's gel manicure and the operator completed the change.",
      aiSummary: {
        intentType: "LIVE_PERSON_REQUEST",
        escalationRequested: true,
        operatorResolution: "RESCHEDULED"
      },
      routingOutcome: CallRoutingOutcome.CALL_CENTER_ESCALATION,
      finalResolution: "Anna Vo rescheduled the booking and confirmed the new Friday 6:00 PM slot.",
      rawPayload: {
        seed: true,
        route: "CALL_CENTER_ESCALATION"
      }
    }
  });

  const resolvedEscalationTranscript = await prisma.callTranscript.create({
    data: {
      salonId: salon.id,
      callSessionId: resolvedEscalationCall.id,
      transcriptSource: "amazon_connect_contact_flow",
      transcriptText:
        "Can I talk to someone? I need to move my Friday manicure to a later time because of work.",
      transcriptSummary: "Operator-assisted reschedule request."
    }
  });

  await prisma.aiInteractionLog.create({
    data: {
      salonId: salon.id,
      provider: ExternalProvider.AMAZON_CONNECT,
      model: "amazon-lex-booking-bot",
      taskType: "route_live_person_request",
      requestText: resolvedEscalationTranscript.transcriptText,
      responseText: JSON.stringify({
        intentType: "LIVE_PERSON_REQUEST",
        confidence: 0.94
      }),
      parsedOutput: {
        intentType: "LIVE_PERSON_REQUEST",
        route: "CALL_CENTER_ESCALATION"
      },
      isValid: true,
      confidence: 0.94,
      callSessionId: resolvedEscalationCall.id,
      transcriptId: resolvedEscalationTranscript.id,
      createdByUserId: ownerUser.id
    }
  });

  await prisma.callEscalation.create({
    data: {
      salonId: salon.id,
      callSessionId: resolvedEscalationCall.id,
      status: CallEscalationStatus.CLOSED,
      routingOutcome: CallRoutingOutcome.CALL_CENTER_ESCALATION,
      escalationReason: "Caller requested help from a live operator.",
      requestedBy: "AI_RECEPTION",
      customerPhone: customers[6]!.phone,
      queueId: "demo-shared-queue",
      queueName: "Amazon Connect Shared Queue",
      assignedAgentUserId: callCenterUser.id,
      messageToCaller: "Please stay on the line while I connect you.",
      operatorNotes: "Moved the appointment to match the customer's after-work availability.",
      resolution: "Operator rescheduled the booking and confirmed SMS follow-up.",
      qaNotes: "Demo-ready closed escalation with live operator handling.",
      requestedAt: new Date(nowMs - 1000 * 60 * 60 * 3 + 60 * 1000),
      queuedAt: new Date(nowMs - 1000 * 60 * 60 * 3 + 2 * 60 * 1000),
      connectedAt: new Date(nowMs - 1000 * 60 * 60 * 3 + 4 * 60 * 1000),
      closedAt: new Date(nowMs - 1000 * 60 * 60 * 3 + 18 * 60 * 1000),
      metadata: {
        source: "seed",
        operator: callCenterUser.fullName
      }
    }
  });

  const callbackStartedAt = new Date(nowMs - 1000 * 60 * 60 * 26);
  const callbackEndedAt = new Date(callbackStartedAt.getTime() + 75_000);
  const callbackCall = await prisma.callSession.create({
    data: {
      salonId: salon.id,
      provider: ExternalProvider.AMAZON_CONNECT,
      providerCallId: "demo-callback-fallback-1",
      providerCompanyId: "demo-amazon-connect-instance",
      callerPhone: customers[5]!.phone,
      originalPhoneNumber: DEMO_ORIGINAL_PHONE,
      dialedPhone: DEMO_TRACKING_PHONE,
      trackingNumber: DEMO_TRACKING_PHONE,
      direction: "inbound",
      sourceName: "Forwarding Demo",
      campaignName: DEMO_CALL_FLOW_NAME,
      status: CallSessionStatus.MISSED,
      startedAt: callbackStartedAt,
      endedAt: callbackEndedAt,
      durationSeconds: 75,
      transcriptSummary: "Caller asked for the next available dip powder slot and requested a callback.",
      routingOutcome: CallRoutingOutcome.CALLBACK_REQUEST,
      finalResolution: "Callback request created because the caller preferred a manual follow-up.",
      rawPayload: {
        seed: true,
        route: "CALLBACK_REQUEST"
      }
    }
  });

  await prisma.callEscalation.create({
    data: {
      salonId: salon.id,
      callSessionId: callbackCall.id,
      status: CallEscalationStatus.CALLBACK_REQUESTED,
      routingOutcome: CallRoutingOutcome.CALLBACK_REQUEST,
      escalationReason: "Customer requested a callback for the next available dip powder slot.",
      requestedBy: "AI_RECEPTION",
      customerPhone: customers[5]!.phone,
      callbackPhone: customers[5]!.phone,
      requestedAt: new Date(nowMs - 1000 * 60 * 60 * 26 + 90_000),
      operatorNotes: "Hold callback after lunch rush."
    }
  });

  const voicemailStartedAt = new Date(nowMs - 1000 * 60 * 60 * 18);
  const voicemailEndedAt = new Date(voicemailStartedAt.getTime() + 95_000);
  const voicemailCall = await prisma.callSession.create({
    data: {
      salonId: salon.id,
      provider: ExternalProvider.AMAZON_CONNECT,
      providerCallId: "demo-voicemail-fallback-1",
      providerCompanyId: "demo-amazon-connect-instance",
      callerPhone: customers[2]!.phone,
      originalPhoneNumber: DEMO_ORIGINAL_PHONE,
      dialedPhone: DEMO_TRACKING_PHONE,
      trackingNumber: DEMO_TRACKING_PHONE,
      direction: "inbound",
      sourceName: "Forwarding Demo",
      campaignName: DEMO_CALL_FLOW_NAME,
      status: CallSessionStatus.VOICEMAIL,
      startedAt: voicemailStartedAt,
      endedAt: voicemailEndedAt,
      durationSeconds: 95,
      transcriptSummary: "Caller left a voicemail asking about a nail art add-on for an existing Gel X booking.",
      routingOutcome: CallRoutingOutcome.VOICEMAIL,
      finalResolution: "Voicemail fallback captured for manual review.",
      rawPayload: {
        seed: true,
        route: "VOICEMAIL"
      }
    }
  });

  await prisma.callEscalation.create({
    data: {
      salonId: salon.id,
      callSessionId: voicemailCall.id,
      status: CallEscalationStatus.VOICEMAIL_LEFT,
      routingOutcome: CallRoutingOutcome.VOICEMAIL,
      escalationReason: "Caller left a voicemail for a nail art add-on question.",
      requestedBy: "AI_RECEPTION",
      customerPhone: customers[2]!.phone,
      voicemailRecordingUrl: "https://example.com/recordings/demo-voicemail-fallback-1.mp3",
      requestedAt: new Date(nowMs - 1000 * 60 * 60 * 18 + 90_000),
      resolution: "Voicemail stored for owner review."
    }
  });

  const smsStartedAt = new Date(nowMs - 1000 * 60 * 60 * 12);
  const smsEndedAt = new Date(smsStartedAt.getTime() + 80_000);
  const smsCall = await prisma.callSession.create({
    data: {
      salonId: salon.id,
      provider: ExternalProvider.AMAZON_CONNECT,
      providerCallId: "demo-sms-fallback-1",
      providerCompanyId: "demo-amazon-connect-instance",
      callerPhone: customers[3]!.phone,
      originalPhoneNumber: DEMO_ORIGINAL_PHONE,
      dialedPhone: DEMO_TRACKING_PHONE,
      trackingNumber: DEMO_TRACKING_PHONE,
      direction: "inbound",
      sourceName: "Forwarding Demo",
      campaignName: DEMO_CALL_FLOW_NAME,
      status: CallSessionStatus.FAILED,
      startedAt: smsStartedAt,
      endedAt: smsEndedAt,
      durationSeconds: 80,
      transcriptSummary: "Caller needed a quick reply and accepted an SMS follow-up instead of waiting.",
      routingOutcome: CallRoutingOutcome.SMS_FALLBACK,
      finalResolution: "SMS fallback sent with callback instructions.",
      rawPayload: {
        seed: true,
        route: "SMS_FALLBACK"
      }
    }
  });

  await prisma.callEscalation.create({
    data: {
      salonId: salon.id,
      callSessionId: smsCall.id,
      status: CallEscalationStatus.SMS_SENT,
      routingOutcome: CallRoutingOutcome.SMS_FALLBACK,
      escalationReason: "Customer requested a text instead of waiting in queue.",
      requestedBy: "AI_RECEPTION",
      customerPhone: customers[3]!.phone,
      smsRecipientPhone: customers[3]!.phone,
      requestedAt: new Date(nowMs - 1000 * 60 * 60 * 12 + 70_000),
      resolution: "SMS follow-up sent with a callback link."
    }
  });

  await prisma.callEvent.createMany({
    data: [
      {
        salonId: salon.id,
        callSessionId: directInboundCall.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        providerEventId: "demo-salon-ring-1-pre-call",
        eventType: "pre-call",
        statusAfter: CallSessionStatus.RINGING,
        eventTimestamp: directInboundStartedAt,
        payload: {
          eventType: "pre-call",
          trackingNumber: DEMO_TRACKING_PHONE,
          originalPhoneNumber: DEMO_ORIGINAL_PHONE
        },
        payloadHash: "demo-salon-ring-1-pre-call"
      },
      {
        salonId: salon.id,
        callSessionId: directInboundCall.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        providerEventId: "demo-salon-ring-1-post-call",
        eventType: "post-call",
        statusBefore: CallSessionStatus.IN_PROGRESS,
        statusAfter: CallSessionStatus.COMPLETED,
        eventTimestamp: directInboundEndedAt,
        payload: {
          eventType: "post-call",
          trackingNumber: DEMO_TRACKING_PHONE,
          originalPhoneNumber: DEMO_ORIGINAL_PHONE
        },
        payloadHash: "demo-salon-ring-1-post-call"
      },
      {
        salonId: salon.id,
        callSessionId: aiBookingCall.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        providerEventId: "demo-forwarding-call-1-pre-call",
        eventType: "pre-call",
        statusAfter: CallSessionStatus.RINGING,
        eventTimestamp: aiBookingStartedAt,
        payload: {
          eventType: "pre-call",
          trackingNumber: DEMO_TRACKING_PHONE,
          originalPhoneNumber: DEMO_ORIGINAL_PHONE
        },
        payloadHash: "demo-forwarding-call-1-pre-call"
      },
      {
        salonId: salon.id,
        callSessionId: aiBookingCall.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        providerEventId: "demo-forwarding-call-1-post-call",
        eventType: "post-call",
        statusBefore: CallSessionStatus.IN_PROGRESS,
        statusAfter: CallSessionStatus.COMPLETED,
        eventTimestamp: aiBookingEndedAt,
        payload: {
          eventType: "post-call",
          trackingNumber: DEMO_TRACKING_PHONE,
          originalPhoneNumber: DEMO_ORIGINAL_PHONE
        },
        payloadHash: "demo-forwarding-call-1-post-call"
      },
      {
        salonId: salon.id,
        callSessionId: openEscalationCall.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        providerEventId: "demo-escalation-open-1-post-call",
        eventType: "post-call",
        statusBefore: CallSessionStatus.IN_PROGRESS,
        statusAfter: CallSessionStatus.COMPLETED,
        eventTimestamp: openEscalationEndedAt,
        payload: {
          eventType: "post-call",
          route: "QUEUED"
        },
        payloadHash: "demo-escalation-open-1-post-call"
      },
      {
        salonId: salon.id,
        callSessionId: resolvedEscalationCall.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        providerEventId: "demo-escalation-closed-1-post-call",
        eventType: "post-call",
        statusBefore: CallSessionStatus.IN_PROGRESS,
        statusAfter: CallSessionStatus.COMPLETED,
        eventTimestamp: resolvedEscalationEndedAt,
        payload: {
          eventType: "post-call",
          route: "CALL_CENTER_ESCALATION"
        },
        payloadHash: "demo-escalation-closed-1-post-call"
      },
      {
        salonId: salon.id,
        callSessionId: callbackCall.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        providerEventId: "demo-callback-fallback-1-post-call",
        eventType: "post-call",
        statusBefore: CallSessionStatus.RINGING,
        statusAfter: CallSessionStatus.MISSED,
        eventTimestamp: callbackEndedAt,
        payload: {
          eventType: "post-call",
          route: "CALLBACK_REQUEST"
        },
        payloadHash: "demo-callback-fallback-1-post-call"
      },
      {
        salonId: salon.id,
        callSessionId: voicemailCall.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        providerEventId: "demo-voicemail-fallback-1-post-call",
        eventType: "post-call",
        statusBefore: CallSessionStatus.IN_PROGRESS,
        statusAfter: CallSessionStatus.VOICEMAIL,
        eventTimestamp: voicemailEndedAt,
        payload: {
          eventType: "post-call",
          route: "VOICEMAIL"
        },
        payloadHash: "demo-voicemail-fallback-1-post-call"
      },
      {
        salonId: salon.id,
        callSessionId: smsCall.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        providerEventId: "demo-sms-fallback-1-post-call",
        eventType: "post-call",
        statusBefore: CallSessionStatus.RINGING,
        statusAfter: CallSessionStatus.FAILED,
        eventTimestamp: smsEndedAt,
        payload: {
          eventType: "post-call",
          route: "SMS_FALLBACK"
        },
        payloadHash: "demo-sms-fallback-1-post-call"
      }
    ]
  });

  await prisma.alert.createMany({
    data: [
      {
        salonId: salon.id,
        alertType: "CALL_ESCALATION_CREATED",
        title: "Escalation waiting for operator",
        message: `VIP reschedule from ${customers[7]!.firstName} ${customers[7]!.lastName} is waiting in the operator queue.`,
        priority: "URGENT",
        metadata: {
          escalationId: openEscalation.id,
          callSessionId: openEscalationCall.id
        }
      },
      {
        salonId: salon.id,
        alertType: "CALLBACK_REQUEST",
        title: "Callback requested",
        message: `${customers[5]!.firstName} ${customers[5]!.lastName} asked for a manual callback about dip powder availability.`,
        priority: "HIGH",
        metadata: {
          callSessionId: callbackCall.id
        }
      },
      {
        salonId: salon.id,
        alertType: "SMS_FALLBACK",
        title: "SMS fallback sent",
        message: `A text follow-up was sent to ${customers[3]!.firstName} ${customers[3]!.lastName}.`,
        priority: "NORMAL",
        metadata: {
          callSessionId: smsCall.id
        }
      }
    ]
  });

  const freeStaffLimit = Number(process.env.FREE_STAFF_LIMIT ?? 5);
  const extraStaffPrice = Number(process.env.EXTRA_STAFF_PRICE ?? 0);
  const activeStaffCount = staffMembers.filter((staff) => staff.status === StaffStatus.ACTIVE).length;
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
