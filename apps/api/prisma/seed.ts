import {
  AppointmentSource,
  AppointmentStatus,
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
  const staffEmail = "staff.demo@fastaibooking.local";
  const staffPassword = "Staff123!";
  const callCenterEmail = "agent.demo@fastaibooking.local";
  const callCenterPassword = "Agent123!";

  const adminPasswordHash = await hashPassword(adminPassword);
  const ownerPasswordHash = await hashPassword(ownerPassword);
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
      fullName: "Demo Salon Owner",
      role: Role.SALON_OWNER,
      passwordHash: ownerPasswordHash,
      phone: "+12125550100",
      isActive: true
    },
    create: {
      email: ownerEmail,
      fullName: "Demo Salon Owner",
      role: Role.SALON_OWNER,
      passwordHash: ownerPasswordHash,
      phone: "+12125550100",
      isActive: true
    }
  });

  const callCenterUser = await prisma.user.upsert({
    where: { email: callCenterEmail },
    update: {
      fullName: "Demo Call Center Agent",
      role: Role.CALL_CENTER_AGENT,
      passwordHash: callCenterPasswordHash,
      phone: "+12125550190",
      isActive: true
    },
    create: {
      email: callCenterEmail,
      fullName: "Demo Call Center Agent",
      role: Role.CALL_CENTER_AGENT,
      passwordHash: callCenterPasswordHash,
      phone: "+12125550190",
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
        name: "Demo Nail Studio",
        timezone: "America/New_York",
        status: SalonStatus.ACTIVE,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        contactEmail: ownerEmail,
        contactPhone: "+12125550100",
        originalPhoneNumber: "+12125550100",
        customerIncomingPhoneNumber: "+12125550110",
        notificationPhoneNumber: "+12125550100",
        addressLine1: "100 Main St",
        city: "New York",
        state: "NY",
        postalCode: "10001",
        country: "US"
      }
    });
  } else {
    salon = await prisma.salon.update({
      where: { id: salon.id },
      data: {
        name: "Demo Nail Studio",
        timezone: "America/New_York",
        status: SalonStatus.ACTIVE,
        subscriptionStatus: SubscriptionStatus.ACTIVE,
        contactEmail: ownerEmail,
        contactPhone: "+12125550100",
        originalPhoneNumber: "+12125550100",
        customerIncomingPhoneNumber: "+12125550110",
        notificationPhoneNumber: "+12125550100",
        addressLine1: "100 Main St",
        city: "New York",
        state: "NY",
        postalCode: "10001",
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
      locale: "vi-VN",
      bookingLeadTimeMinutes: 30,
      aiForwardingEnabled: true,
      aiTransferRingCount: 3,
      callCenterRoutingNumber: "+12125550190"
    },
    create: {
      salonId: salon.id,
      currency: "USD",
      locale: "vi-VN",
      bookingLeadTimeMinutes: 30,
      aiForwardingEnabled: true,
      aiTransferRingCount: 3,
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
        fullName: "Emma Kim",
        email: "emma.demo@fastaibooking.local",
        phone: "+12125550101",
        title: "Senior Technician",
        status: StaffStatus.ACTIVE
      },
      {
        salonId: salon.id,
        fullName: "Ava Park",
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
        title: "Nail Technician",
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
        title: "Part-time Technician",
        status: StaffStatus.ACTIVE
      },
      {
        salonId: salon.id,
        fullName: "Charlotte Ng",
        email: "charlotte.demo@fastaibooking.local",
        phone: "+12125550107",
        title: "Part-time Technician",
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
        durationMinutes: 45,
        priceCents: 3500,
        isActive: true
      },
      {
        salonId: salon.id,
        name: "Gel Manicure",
        durationMinutes: 60,
        priceCents: 5000,
        isActive: true
      },
      {
        salonId: salon.id,
        name: "Deluxe Pedicure",
        durationMinutes: 75,
        priceCents: 7000,
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
        firstName: "Lily",
        lastName: "Johnson",
        phone: "+12125550201",
        email: "lily.johnson@example.com"
      },
      {
        salonId: salon.id,
        firstName: "Chloe",
        lastName: "Wilson",
        phone: "+12125550202",
        email: "chloe.wilson@example.com"
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
        notes: "Seed appointment",
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
        notes: "AI booked sample",
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
      }
    ],
    skipDuplicates: true
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
