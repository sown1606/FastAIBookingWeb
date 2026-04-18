import {
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
  SubscriptionStatus
} from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

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

const run = async (): Promise<void> => {
  const adminEmail = "admin@fastaibooking.local";
  const adminPassword = "Admin123!";
  const ownerEmail = "owner.demo@fastaibooking.local";
  const ownerPassword = "Owner123!";
  const callCenterOwnerEmail = "owner.callcenter.demo@fastaibooking.local";
  const callCenterOwnerPassword = "Owner123!";
  const staffEmail = "staff.demo@fastaibooking.local";
  const staffPassword = "Staff123!";
  const callCenterEmail = "agent.demo@fastaibooking.local";
  const callCenterPassword = "Agent123!";

  const adminPasswordHash = await hashPassword(adminPassword);
  const ownerPasswordHash = await hashPassword(ownerPassword);
  const callCenterOwnerPasswordHash = await hashPassword(callCenterOwnerPassword);
  const staffPasswordHash = await hashPassword(staffPassword);
  const callCenterPasswordHash = await hashPassword(callCenterPassword);

  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      fullName: "Platform Admin",
      role: Role.PLATFORM_ADMIN,
      passwordHash: adminPasswordHash,
      isActive: true
    },
    create: {
      email: adminEmail,
      fullName: "Platform Admin",
      role: Role.PLATFORM_ADMIN,
      passwordHash: adminPasswordHash,
      isActive: true
    }
  });

  const ownerUser = await prisma.user.upsert({
    where: { email: ownerEmail },
    update: {
      fullName: "Linh Nguyen",
      role: Role.SALON_OWNER,
      passwordHash: ownerPasswordHash,
      phone: "+12125550100",
      isActive: true
    },
    create: {
      email: ownerEmail,
      fullName: "Linh Nguyen",
      role: Role.SALON_OWNER,
      passwordHash: ownerPasswordHash,
      phone: "+12125550100",
      isActive: true
    }
  });

  const callCenterUser = await prisma.user.upsert({
    where: { email: callCenterEmail },
    update: {
      fullName: "Anna Vo",
      role: Role.CALL_CENTER_AGENT,
      passwordHash: callCenterPasswordHash,
      phone: "+12125550190",
      isActive: true
    },
    create: {
      email: callCenterEmail,
      fullName: "Anna Vo",
      role: Role.CALL_CENTER_AGENT,
      passwordHash: callCenterPasswordHash,
      phone: "+12125550190",
      isActive: true
    }
  });

  const callCenterOwnerUser = await prisma.user.upsert({
    where: { email: callCenterOwnerEmail },
    update: {
      fullName: "Maya Tran",
      role: Role.SALON_OWNER,
      passwordHash: callCenterOwnerPasswordHash,
      phone: "+12125550120",
      isActive: true
    },
    create: {
      email: callCenterOwnerEmail,
      fullName: "Maya Tran",
      role: Role.SALON_OWNER,
      passwordHash: callCenterOwnerPasswordHash,
      phone: "+12125550120",
      isActive: true
    }
  });

  let salon = await prisma.salon.findUnique({
    where: {
      ownerId: ownerUser.id
    }
  });

  if (!salon) {
    salon = await prisma.salon.create({
      data: {
        ownerId: ownerUser.id,
        name: "Luxe Nails & Beauty",
        timezone: "America/New_York",
        status: SalonStatus.ACTIVE,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        contactEmail: ownerEmail,
        contactPhone: "+12125550100",
        originalPhoneNumber: "+12125550100",
        customerIncomingPhoneNumber: "+12125550110",
        notificationPhoneNumber: "+12125550100",
        addressLine1: "128 Spring Street",
        city: "New York",
        state: "NY",
        postalCode: "10012",
        country: "US"
      }
    });
  } else {
    salon = await prisma.salon.update({
      where: { id: salon.id },
      data: {
        name: "Luxe Nails & Beauty",
        timezone: "America/New_York",
        status: SalonStatus.ACTIVE,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        contactEmail: ownerEmail,
        contactPhone: "+12125550100",
        originalPhoneNumber: "+12125550100",
        customerIncomingPhoneNumber: "+12125550110",
        notificationPhoneNumber: "+12125550100",
        addressLine1: "128 Spring Street",
        city: "New York",
        state: "NY",
        postalCode: "10012",
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

  await prisma.salonSetting.upsert({
    where: { salonId: salon.id },
    update: {
      currency: "USD",
      locale: "en-US",
      bookingLeadTimeMinutes: 30,
      aiForwardingEnabled: true,
      aiReceptionEnabled: true,
      aiTransferRingCount: 3,
      callCenterEnabled: true,
      voicemailEnabled: true,
      callbackRequestEnabled: true,
      smsFallbackEnabled: true,
      aiGreetingPrompt:
        "Thank you for calling Luxe Nails & Beauty. I can help with appointments or connect you to a human operator.",
      callerLanguage: "en",
      callLogVisibility: "OWNER_STAFF_OPERATOR",
      notificationRecipients: [ownerEmail, "+12125550100"],
      callCenterRoutingNumber: "+12125550190"
    },
    create: {
      salonId: salon.id,
      currency: "USD",
      locale: "en-US",
      bookingLeadTimeMinutes: 30,
      aiForwardingEnabled: true,
      aiReceptionEnabled: true,
      aiTransferRingCount: 3,
      callCenterEnabled: true,
      voicemailEnabled: true,
      callbackRequestEnabled: true,
      smsFallbackEnabled: true,
      aiGreetingPrompt:
        "Thank you for calling Luxe Nails & Beauty. I can help with appointments or connect you to a human operator.",
      callerLanguage: "en",
      callLogVisibility: "OWNER_STAFF_OPERATOR",
      notificationRecipients: [ownerEmail, "+12125550100"],
      callCenterRoutingNumber: "+12125550190"
    }
  });

  await prisma.callCenterSalonAssignment.upsert({
    where: {
      salonId_agentUserId: {
        salonId: salon.id,
        agentUserId: callCenterUser.id
      }
    },
    update: {},
    create: {
      salonId: salon.id,
      agentUserId: callCenterUser.id,
      assignedByUserId: adminUser.id
    }
  });

  const { periodStart, periodEnd } = getCurrentBillingPeriod();

  let callCenterOnlySalon = await prisma.salon.findUnique({
    where: {
      ownerId: callCenterOwnerUser.id
    }
  });

  if (!callCenterOnlySalon) {
    callCenterOnlySalon = await prisma.salon.create({
      data: {
        ownerId: callCenterOwnerUser.id,
        name: "Concierge Nails Demo",
        timezone: "America/Los_Angeles",
        status: SalonStatus.ACTIVE,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        contactEmail: callCenterOwnerEmail,
        contactPhone: "+12125550120",
        originalPhoneNumber: "+12125550120",
        customerIncomingPhoneNumber: "+12125550121",
        notificationPhoneNumber: "+12125550120",
        addressLine1: "510 Market Street",
        city: "San Francisco",
        state: "CA",
        postalCode: "94105",
        country: "US"
      }
    });
  } else {
    callCenterOnlySalon = await prisma.salon.update({
      where: { id: callCenterOnlySalon.id },
      data: {
        name: "Concierge Nails Demo",
        timezone: "America/Los_Angeles",
        status: SalonStatus.ACTIVE,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        contactEmail: callCenterOwnerEmail,
        contactPhone: "+12125550120",
        originalPhoneNumber: "+12125550120",
        customerIncomingPhoneNumber: "+12125550121",
        notificationPhoneNumber: "+12125550120",
        addressLine1: "510 Market Street",
        city: "San Francisco",
        state: "CA",
        postalCode: "94105",
        country: "US"
      }
    });
  }

  await prisma.user.update({
    where: { id: callCenterOwnerUser.id },
    data: {
      salonId: callCenterOnlySalon.id
    }
  });

  await prisma.salonSetting.upsert({
    where: { salonId: callCenterOnlySalon.id },
    update: {
      currency: "USD",
      locale: "en-US",
      bookingLeadTimeMinutes: 15,
      aiForwardingEnabled: false,
      aiReceptionEnabled: false,
      aiTransferRingCount: 2,
      callCenterEnabled: true,
      voicemailEnabled: false,
      callbackRequestEnabled: true,
      smsFallbackEnabled: true,
      aiGreetingPrompt: "Please wait while I connect you to our operator team.",
      callerLanguage: "en",
      callLogVisibility: "OWNER_STAFF_OPERATOR",
      notificationRecipients: [callCenterOwnerEmail, "+12125550120"],
      callCenterRoutingNumber: "+12125550190",
      callCenterRoutingNote: "Call center first routing demo."
    },
    create: {
      salonId: callCenterOnlySalon.id,
      currency: "USD",
      locale: "en-US",
      bookingLeadTimeMinutes: 15,
      aiForwardingEnabled: false,
      aiReceptionEnabled: false,
      aiTransferRingCount: 2,
      callCenterEnabled: true,
      voicemailEnabled: false,
      callbackRequestEnabled: true,
      smsFallbackEnabled: true,
      aiGreetingPrompt: "Please wait while I connect you to our operator team.",
      callerLanguage: "en",
      callLogVisibility: "OWNER_STAFF_OPERATOR",
      notificationRecipients: [callCenterOwnerEmail, "+12125550120"],
      callCenterRoutingNumber: "+12125550190",
      callCenterRoutingNote: "Call center first routing demo."
    }
  });

  await prisma.subscription.upsert({
    where: { salonId: callCenterOnlySalon.id },
    update: {
      planCode: "starter",
      status: SubscriptionStatus.ACTIVE,
      basePriceCents: 9900,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd
    },
    create: {
      salonId: callCenterOnlySalon.id,
      planCode: "starter",
      status: SubscriptionStatus.ACTIVE,
      basePriceCents: 9900,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd
    }
  });

  await prisma.businessHour.deleteMany({
    where: {
      salonId: callCenterOnlySalon.id
    }
  });

  await prisma.businessHour.createMany({
    data: [
      { salonId: callCenterOnlySalon.id, dayOfWeek: 0, isOpen: false, openTime: null, closeTime: null },
      { salonId: callCenterOnlySalon.id, dayOfWeek: 1, isOpen: true, openTime: "09:00", closeTime: "18:00" },
      { salonId: callCenterOnlySalon.id, dayOfWeek: 2, isOpen: true, openTime: "09:00", closeTime: "18:00" },
      { salonId: callCenterOnlySalon.id, dayOfWeek: 3, isOpen: true, openTime: "09:00", closeTime: "18:00" },
      { salonId: callCenterOnlySalon.id, dayOfWeek: 4, isOpen: true, openTime: "09:00", closeTime: "18:00" },
      { salonId: callCenterOnlySalon.id, dayOfWeek: 5, isOpen: true, openTime: "09:00", closeTime: "18:00" },
      { salonId: callCenterOnlySalon.id, dayOfWeek: 6, isOpen: true, openTime: "09:00", closeTime: "16:00" }
    ]
  });

  await prisma.callCenterSalonAssignment.upsert({
    where: {
      salonId_agentUserId: {
        salonId: callCenterOnlySalon.id,
        agentUserId: callCenterUser.id
      }
    },
    update: {},
    create: {
      salonId: callCenterOnlySalon.id,
      agentUserId: callCenterUser.id,
      assignedByUserId: adminUser.id
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

  await prisma.businessHour.deleteMany({
    where: { salonId: salon.id }
  });

  await prisma.businessHour.createMany({
    data: [
      { salonId: salon.id, dayOfWeek: 0, isOpen: false, openTime: null, closeTime: null },
      { salonId: salon.id, dayOfWeek: 1, isOpen: true, openTime: "09:00", closeTime: "18:00" },
      { salonId: salon.id, dayOfWeek: 2, isOpen: true, openTime: "09:00", closeTime: "18:00" },
      { salonId: salon.id, dayOfWeek: 3, isOpen: true, openTime: "09:00", closeTime: "18:00" },
      { salonId: salon.id, dayOfWeek: 4, isOpen: true, openTime: "09:00", closeTime: "18:00" },
      { salonId: salon.id, dayOfWeek: 5, isOpen: true, openTime: "09:00", closeTime: "18:00" },
      { salonId: salon.id, dayOfWeek: 6, isOpen: true, openTime: "09:00", closeTime: "16:00" }
    ]
  });

  await prisma.appointmentStatusHistory.deleteMany({
    where: {
      appointment: {
        salonId: salon.id
      }
    }
  });

  await prisma.appointment.deleteMany({
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

  const staffMembers = await prisma.staff.createManyAndReturn({
    data: [
      {
        salonId: salon.id,
        fullName: "Mai Tran",
        email: "emma.demo@fastaibooking.local",
        phone: "+12125550101",
        title: "Senior Nail Technician",
        status: StaffStatus.ACTIVE
      },
      {
        salonId: salon.id,
        fullName: "Vy Pham",
        email: "ava.demo@fastaibooking.local",
        phone: "+12125550102",
        title: "Nail Technician",
        status: StaffStatus.ACTIVE
      },
      {
        salonId: salon.id,
        fullName: "Olivia Chen",
        email: "olivia.demo@fastaibooking.local",
        phone: "+12125550103",
        title: "Pedicure Specialist",
        status: StaffStatus.ACTIVE
      },
      {
        salonId: salon.id,
        fullName: "Sophia Lee",
        email: "sophia.demo@fastaibooking.local",
        phone: "+12125550104",
        title: "Nail Technician",
        status: StaffStatus.ACTIVE
      },
      {
        salonId: salon.id,
        fullName: "Mia Davis",
        email: "mia.demo@fastaibooking.local",
        phone: "+12125550105",
        title: "Nail Technician",
        status: StaffStatus.ACTIVE
      },
      {
        salonId: salon.id,
        fullName: "Isabella Tran",
        email: "isabella.demo@fastaibooking.local",
        phone: "+12125550106",
        title: "Nail Technician",
        status: StaffStatus.ACTIVE
      },
      {
        salonId: salon.id,
        fullName: "Charlotte Ng",
        email: "charlotte.demo@fastaibooking.local",
        phone: "+12125550107",
        title: "Receptionist",
        status: StaffStatus.ACTIVE
      }
    ]
  });

  await prisma.user.upsert({
    where: { email: staffEmail },
    update: {
      fullName: staffMembers[0]!.fullName,
      role: Role.STAFF,
      passwordHash: staffPasswordHash,
      phone: staffMembers[0]!.phone,
      salonId: salon.id,
      staffId: staffMembers[0]!.id,
      isActive: true
    },
    create: {
      email: staffEmail,
      fullName: staffMembers[0]!.fullName,
      role: Role.STAFF,
      passwordHash: staffPasswordHash,
      phone: staffMembers[0]!.phone,
      salonId: salon.id,
      staffId: staffMembers[0]!.id,
      isActive: true
    }
  });

  await prisma.service.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  const services = await prisma.service.createManyAndReturn({
    data: [
      {
        salonId: salon.id,
        name: "Classic Manicure",
        description: "Shape, cuticle care, massage, and regular polish.",
        durationMinutes: 45,
        priceCents: 3500,
        isActive: true
      },
      {
        salonId: salon.id,
        name: "Gel Manicure",
        description: "Long-lasting gel color with cuticle care and hand massage.",
        durationMinutes: 60,
        priceCents: 5000,
        isActive: true
      },
      {
        salonId: salon.id,
        name: "Deluxe Pedicure",
        description: "Soak, scrub, callus care, hot towel, massage, and polish.",
        durationMinutes: 75,
        priceCents: 7000,
        isActive: true
      },
      {
        salonId: salon.id,
        name: "Acrylic Full Set",
        description: "Full acrylic extension set with gel polish.",
        durationMinutes: 95,
        priceCents: 8500,
        isActive: true
      },
      {
        salonId: salon.id,
        name: "Nail Art Add-on",
        description: "Simple designs, chrome, gems, or accent nails.",
        durationMinutes: 20,
        priceCents: 2000,
        isActive: true
      }
    ]
  });

  await prisma.staffService.createMany({
    data: services.flatMap((service) =>
      staffMembers.slice(0, 5).map((staff) => ({
        salonId: salon.id,
        serviceId: service.id,
        staffId: staff.id
      }))
    ),
    skipDuplicates: true
  });

  await prisma.customer.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  const customers = await prisma.customer.createManyAndReturn({
    data: [
      {
        salonId: salon.id,
        firstName: "Thao",
        lastName: "Nguyen",
        phone: "+12125550201",
        email: "thao.nguyen@example.com"
      },
      {
        salonId: salon.id,
        firstName: "Chloe",
        lastName: "Wilson",
        phone: "+12125550202",
        email: "chloe.wilson@example.com"
      },
      {
        salonId: salon.id,
        firstName: "Mia",
        lastName: "Garcia",
        phone: "+12125550203",
        email: "mia.garcia@example.com"
      },
      {
        salonId: salon.id,
        firstName: "Sarah",
        lastName: "Kim",
        phone: "+12125550204",
        email: "sarah.kim@example.com"
      },
      {
        salonId: salon.id,
        firstName: "Emily",
        lastName: "Tran",
        phone: "+12125550205",
        email: "emily.tran@example.com"
      }
    ]
  });

  const now = new Date();
  const appointmentStart1 = new Date(now.getTime() + 1000 * 60 * 60 * 24);
  appointmentStart1.setUTCHours(15, 0, 0, 0);
  const appointmentEnd1 = new Date(appointmentStart1.getTime() + services[0]!.durationMinutes * 60000);

  const appointmentStart2 = new Date(now.getTime() + 1000 * 60 * 60 * 24);
  appointmentStart2.setUTCHours(17, 0, 0, 0);
  const appointmentEnd2 = new Date(appointmentStart2.getTime() + services[1]!.durationMinutes * 60000);

  const appointmentStart3 = new Date(now.getTime() + 1000 * 60 * 60 * 48);
  appointmentStart3.setUTCHours(16, 30, 0, 0);
  const appointmentEnd3 = new Date(appointmentStart3.getTime() + services[3]!.durationMinutes * 60000);

  const appointmentStart4 = new Date(now.getTime() + 1000 * 60 * 60 * 72);
  appointmentStart4.setUTCHours(18, 0, 0, 0);
  const appointmentEnd4 = new Date(appointmentStart4.getTime() + services[2]!.durationMinutes * 60000);

  const appointments = await prisma.appointment.createManyAndReturn({
    data: [
      {
        salonId: salon.id,
        customerId: customers[0]!.id,
        staffId: staffMembers[0]!.id,
        serviceId: services[0]!.id,
        startTime: appointmentStart1,
        endTime: appointmentEnd1,
        durationMinutes: services[0]!.durationMinutes,
        status: AppointmentStatus.SCHEDULED,
        source: AppointmentSource.DASHBOARD,
        notes: "Regular client prefers neutral colors.",
        createdByUserId: ownerUser.id
      },
      {
        salonId: salon.id,
        customerId: customers[1]!.id,
        staffId: staffMembers[1]!.id,
        serviceId: services[1]!.id,
        startTime: appointmentStart2,
        endTime: appointmentEnd2,
        durationMinutes: services[1]!.durationMinutes,
        status: AppointmentStatus.CONFIRMED,
        source: AppointmentSource.AI,
        notes: "AI booked gel manicure after missed call.",
        createdByUserId: ownerUser.id
      },
      {
        salonId: salon.id,
        customerId: customers[2]!.id,
        staffId: staffMembers[2]!.id,
        serviceId: services[3]!.id,
        startTime: appointmentStart3,
        endTime: appointmentEnd3,
        durationMinutes: services[3]!.durationMinutes,
        status: AppointmentStatus.SCHEDULED,
        source: AppointmentSource.DASHBOARD,
        notes: "First acrylic full set consultation.",
        createdByUserId: ownerUser.id
      },
      {
        salonId: salon.id,
        customerId: customers[3]!.id,
        staffId: staffMembers[3]!.id,
        serviceId: services[2]!.id,
        startTime: appointmentStart4,
        endTime: appointmentEnd4,
        durationMinutes: services[2]!.durationMinutes,
        status: AppointmentStatus.CONFIRMED,
        source: AppointmentSource.AI,
        notes: "Customer asked for deluxe pedicure and hot towel.",
        createdByUserId: ownerUser.id
      }
    ]
  });

  await prisma.appointmentStatusHistory.createMany({
    data: appointments.map((appointment) => ({
      appointmentId: appointment.id,
      previousStatus: null,
      newStatus: appointment.status,
      reason: "Seeded data",
      changedByUserId: ownerUser.id
    }))
  });

  await prisma.appointmentService.createMany({
    data: [
      {
        salonId: salon.id,
        appointmentId: appointments[0]!.id,
        serviceId: services[0]!.id,
        durationMinutes: services[0]!.durationMinutes,
        priceCents: services[0]!.priceCents
      },
      {
        salonId: salon.id,
        appointmentId: appointments[1]!.id,
        serviceId: services[1]!.id,
        durationMinutes: services[1]!.durationMinutes,
        priceCents: services[1]!.priceCents
      },
      {
        salonId: salon.id,
        appointmentId: appointments[2]!.id,
        serviceId: services[3]!.id,
        durationMinutes: services[3]!.durationMinutes,
        priceCents: services[3]!.priceCents
      },
      {
        salonId: salon.id,
        appointmentId: appointments[3]!.id,
        serviceId: services[2]!.id,
        durationMinutes: services[2]!.durationMinutes,
        priceCents: services[2]!.priceCents
      }
    ],
    skipDuplicates: true
  });

  await prisma.integrationConfig.deleteMany({
    where: {
      salonId: {
        in: [salon.id, callCenterOnlySalon.id]
      }
    }
  });

  await prisma.integrationConfig.createMany({
    data: [
      {
        salonId: salon.id,
        provider: ExternalProvider.CALLRAIL,
        configKey: "tracking_number",
        configValue: "12125550110"
      },
      {
        salonId: salon.id,
        provider: ExternalProvider.VERTEX,
        configKey: "project_id",
        configValue: "demo-vertex-project"
      },
      {
        salonId: salon.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        configKey: "queue_id",
        configValue: "demo-shared-queue"
      },
      {
        salonId: callCenterOnlySalon.id,
        provider: ExternalProvider.CALLRAIL,
        configKey: "tracking_number",
        configValue: "12125550121"
      },
      {
        salonId: callCenterOnlySalon.id,
        provider: ExternalProvider.AMAZON_CONNECT,
        configKey: "queue_id",
        configValue: "demo-shared-queue"
      }
    ]
  });

  await prisma.callEscalation.deleteMany({
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
  await prisma.callSession.deleteMany({
    where: {
      salonId: salon.id
    }
  });

  const aiBookingCall = await prisma.callSession.create({
    data: {
      salonId: salon.id,
      provider: ExternalProvider.CALLRAIL,
      providerCallId: "demo-call-booking-1",
      callerPhone: customers[4]!.phone,
      dialedPhone: salon.customerIncomingPhoneNumber,
      trackingNumber: salon.customerIncomingPhoneNumber,
      status: CallSessionStatus.COMPLETED,
      startedAt: new Date(now.getTime() - 1000 * 60 * 90),
      endedAt: new Date(now.getTime() - 1000 * 60 * 86),
      durationSeconds: 240,
      recordingUrl: "https://example.com/recordings/demo-call-booking-1.mp3",
      transcriptSummary: "Customer requested a gel manicure for tomorrow at 1 PM.",
      routingOutcome: CallRoutingOutcome.AI_RECEPTION,
      finalResolution: "Appointment created successfully.",
      aiSummary: {
        intentType: "BOOK_APPOINTMENT",
        bookingStatus: "SUCCESS",
        appointmentId: appointments[1]!.id,
        sourceTranscriptId: "seed-demo-call-booking-1",
        summaryText: "Customer booked a gel manicure through AI Reception."
      }
    }
  });

  const aiBookingTranscript = await prisma.callTranscript.create({
    data: {
      salonId: salon.id,
      callSessionId: aiBookingCall.id,
      transcriptSource: "callrail_webhook",
      transcriptText:
        "Hi, this is Emily Tran. I want to book a gel manicure tomorrow at 1 PM. My phone number is +1 212 555 0205.",
      transcriptSummary: "Customer asked for a gel manicure tomorrow at 1 PM."
    }
  });

  const aiBookingAttempt = await prisma.bookingAttempt.create({
    data: {
      salonId: salon.id,
      callSessionId: aiBookingCall.id,
      transcriptId: aiBookingTranscript.id,
      appointmentId: appointments[1]!.id,
      status: BookingAttemptStatus.SUCCESS,
      source: "AI_TRANSCRIPT",
      customerName: "Emily Tran",
      customerPhone: customers[4]!.phone,
      requestedService: services[1]!.name,
      requestedStaff: staffMembers[1]!.fullName,
      requestedDateTimeText: appointments[1]!.startTime.toISOString(),
      normalizedRequest: {
        customerName: "Emily Tran",
        customerPhone: customers[4]!.phone,
        serviceName: services[1]!.name,
        staffName: staffMembers[1]!.fullName,
        startTimeIso: appointments[1]!.startTime.toISOString(),
        timezone: "America/New_York"
      },
      createdByUserId: ownerUser.id
    }
  });

  await prisma.aiInteractionLog.create({
    data: {
      salonId: salon.id,
      provider: ExternalProvider.VERTEX,
      model: "gemini-1.5-flash-002",
      taskType: "parse_booking",
      requestText: aiBookingTranscript.transcriptText,
      requestPayload: { source: "seed" },
      responseText: JSON.stringify({
        intentType: "BOOK_APPOINTMENT",
        confidence: 0.94
      }),
      responsePayload: { source: "seed" },
      parsedOutput: {
        intentType: "BOOK_APPOINTMENT",
        customer: {
          name: "Emily Tran",
          phone: customers[4]!.phone
        },
        requestedService: services[1]!.name
      },
      isValid: true,
      confidence: 0.94,
      callSessionId: aiBookingCall.id,
      transcriptId: aiBookingTranscript.id,
      bookingAttemptId: aiBookingAttempt.id,
      createdByUserId: ownerUser.id
    }
  });

  const escalationCall = await prisma.callSession.create({
    data: {
      salonId: salon.id,
      provider: ExternalProvider.CALLRAIL,
      providerCallId: "demo-call-escalation-1",
      callerPhone: "+12125550301",
      dialedPhone: salon.customerIncomingPhoneNumber,
      trackingNumber: salon.customerIncomingPhoneNumber,
      status: CallSessionStatus.COMPLETED,
      startedAt: new Date(now.getTime() - 1000 * 60 * 60),
      endedAt: new Date(now.getTime() - 1000 * 60 * 56),
      durationSeconds: 260,
      recordingUrl: "https://example.com/recordings/demo-call-escalation-1.mp3",
      transcriptSummary: "Caller asked for a human after checking appointment availability.",
      routingOutcome: CallRoutingOutcome.CALL_CENTER_ESCALATION,
      finalResolution: "Connected to a human operator.",
      aiSummary: {
        intentType: "LIVE_PERSON_REQUEST",
        bookingStatus: "NEEDS_INPUT",
        summaryText: "Caller asked for a human operator."
      }
    }
  });

  await prisma.callTranscript.create({
    data: {
      salonId: salon.id,
      callSessionId: escalationCall.id,
      transcriptSource: "callrail_webhook",
      transcriptText:
        "I need a real person. Please wait while I connect you. I want to talk to someone about rescheduling.",
      transcriptSummary: "Caller requested a human operator."
    }
  });

  await prisma.callEscalation.create({
    data: {
      salonId: salon.id,
      callSessionId: escalationCall.id,
      status: CallEscalationStatus.CONNECTED,
      routingOutcome: CallRoutingOutcome.CALL_CENTER_ESCALATION,
      escalationReason: "Caller requested a human operator.",
      requestedBy: "AI_RECEPTION",
      customerPhone: "+12125550301",
      queueId: "demo-shared-queue",
      queueName: "Amazon Connect Shared Queue",
      assignedAgentUserId: callCenterUser.id,
      messageToCaller: "Please wait while I connect you.",
      operatorNotes: "Handled as a reschedule inquiry.",
      resolution: "Connected to a human operator.",
      qaNotes: "Warm transfer completed.",
      requestedAt: new Date(now.getTime() - 1000 * 60 * 59),
      queuedAt: new Date(now.getTime() - 1000 * 60 * 58),
      connectedAt: new Date(now.getTime() - 1000 * 60 * 57),
      closedAt: new Date(now.getTime() - 1000 * 60 * 55)
    }
  });

  await prisma.callEvent.createMany({
    data: [
      {
        salonId: salon.id,
        callSessionId: aiBookingCall.id,
        provider: ExternalProvider.CALLRAIL,
        providerEventId: "demo-booking-pre-call",
        eventType: "pre-call",
        statusAfter: CallSessionStatus.RINGING,
        payload: { eventType: "pre-call" },
        payloadHash: "demo-booking-pre-call-hash"
      },
      {
        salonId: salon.id,
        callSessionId: aiBookingCall.id,
        provider: ExternalProvider.CALLRAIL,
        providerEventId: "demo-booking-post-call",
        eventType: "post-call",
        statusBefore: CallSessionStatus.IN_PROGRESS,
        statusAfter: CallSessionStatus.COMPLETED,
        payload: { eventType: "post-call" },
        payloadHash: "demo-booking-post-call-hash"
      },
      {
        salonId: salon.id,
        callSessionId: escalationCall.id,
        provider: ExternalProvider.CALLRAIL,
        providerEventId: "demo-escalation-routing-complete",
        eventType: "call-routing-complete",
        statusAfter: CallSessionStatus.IN_PROGRESS,
        payload: { eventType: "call-routing-complete" },
        payloadHash: "demo-escalation-routing-complete-hash"
      },
      {
        salonId: salon.id,
        callSessionId: escalationCall.id,
        provider: ExternalProvider.CALLRAIL,
        providerEventId: "demo-escalation-call-modified",
        eventType: "call-modified",
        statusBefore: CallSessionStatus.IN_PROGRESS,
        statusAfter: CallSessionStatus.COMPLETED,
        payload: { eventType: "call-modified" },
        payloadHash: "demo-escalation-call-modified-hash"
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

  console.log("Seed completed successfully.");
  console.log(`Admin login: ${adminEmail} / ${adminPassword}`);
  console.log(`Owner login: ${ownerEmail} / ${ownerPassword}`);
  console.log(`Staff login: ${staffEmail} / ${staffPassword}`);
  console.log(`Call center login: ${callCenterEmail} / ${callCenterPassword}`);
  console.log(`Admin user id: ${adminUser.id}`);
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
