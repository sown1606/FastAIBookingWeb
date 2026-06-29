import {
  Prisma,
  PrismaClient,
  Role,
  SalonStatus,
  StaffStatus,
  StaffWorkStatus,
  SubscriptionStatus
} from "@prisma/client";
import bcrypt from "bcryptjs";

if (process.env.ALLOW_DEMO_LOGIN_REPAIR !== "true") {
  throw new Error(
    "Demo login repair is disabled. Set ALLOW_DEMO_LOGIN_REPAIR=true to run this script."
  );
}

const prisma = new PrismaClient();
const SALT_ROUNDS = 12;

const OWNER_EMAIL = "owner.demo@fastaibooking.local";
const OWNER_PASSWORD = "Owner123!";
const STAFF_EMAIL = "staff.demo@fastaibooking.local";
const STAFF_PASSWORD = "Staff123!";
const CALL_CENTER_EMAIL = "agent.demo@fastaibooking.local";
const CALL_CENTER_PASSWORD = "Agent123!";

const DEMO_SALON_NAME = process.env.DEMO_SALON_NAME?.trim() || "Kiet Nails & Beauty";
const DEMO_SALON_ID = process.env.DEMO_SALON_ID?.trim() || process.env.DEFAULT_SALON_ID?.trim();
const DEMO_TIMEZONE = "America/New_York";
const DEMO_ORIGINAL_PHONE = "+18487029493";
const STAFF_PHONE = "+17325550101";
const CALL_CENTER_PHONE = "+17325550190";

const hashPassword = async (plainPassword: string): Promise<string> => {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
};

const ensureSalonSettings = async (
  tx: Prisma.TransactionClient,
  salonId: string
): Promise<void> => {
  const existing = await tx.salonSetting.findUnique({
    where: { salonId },
    select: { id: true }
  });

  if (existing) {
    return;
  }

  await tx.salonSetting.create({
    data: {
      salonId,
      currency: "USD",
      locale: "vi-VN",
      callCenterEnabled: true,
      callLogVisibility: "OWNER_STAFF_OPERATOR"
    }
  });
};

const run = async (): Promise<void> => {
  const [ownerPasswordHash, staffPasswordHash, callCenterPasswordHash] = await Promise.all([
    hashPassword(OWNER_PASSWORD),
    hashPassword(STAFF_PASSWORD),
    hashPassword(CALL_CENTER_PASSWORD)
  ]);

  const result = await prisma.$transaction(async (tx) => {
    const ownerUser = await tx.user.upsert({
      where: { email: OWNER_EMAIL },
      update: {
        fullName: "Kiet Nguyen",
        passwordHash: ownerPasswordHash,
        role: Role.SALON_OWNER,
        phone: DEMO_ORIGINAL_PHONE,
        staffId: null,
        isActive: true
      },
      create: {
        email: OWNER_EMAIL,
        fullName: "Kiet Nguyen",
        passwordHash: ownerPasswordHash,
        role: Role.SALON_OWNER,
        phone: DEMO_ORIGINAL_PHONE,
        isActive: true
      }
    });

    const callCenterUser = await tx.user.upsert({
      where: { email: CALL_CENTER_EMAIL },
      update: {
        fullName: "Anna Vo",
        passwordHash: callCenterPasswordHash,
        role: Role.CALL_CENTER_AGENT,
        phone: CALL_CENTER_PHONE,
        salonId: null,
        staffId: null,
        isActive: true
      },
      create: {
        email: CALL_CENTER_EMAIL,
        fullName: "Anna Vo",
        passwordHash: callCenterPasswordHash,
        role: Role.CALL_CENTER_AGENT,
        phone: CALL_CENTER_PHONE,
        isActive: true
      }
    });

    let salon = await tx.salon.findUnique({
      where: { ownerId: ownerUser.id }
    });

    if (!salon && DEMO_SALON_ID) {
      const configuredSalon = await tx.salon.findUnique({
        where: { id: DEMO_SALON_ID }
      });

      if (configuredSalon) {
        const isDemoSalon =
          configuredSalon.contactEmail?.toLowerCase() === OWNER_EMAIL ||
          configuredSalon.ownerId === ownerUser.id;

        if (!isDemoSalon) {
          throw new Error(
            `Configured demo salon ${DEMO_SALON_ID} is owned by another user and does not use the demo owner email.`
          );
        }

        salon = await tx.salon.update({
          where: { id: configuredSalon.id },
          data: {
            ownerId: ownerUser.id,
            name: DEMO_SALON_NAME,
            timezone: DEMO_TIMEZONE,
            status: SalonStatus.ACTIVE,
            subscriptionStatus: SubscriptionStatus.ACTIVE,
            contactEmail: OWNER_EMAIL,
            contactPhone: DEMO_ORIGINAL_PHONE,
            originalPhoneNumber: DEMO_ORIGINAL_PHONE,
            notificationPhoneNumber: DEMO_ORIGINAL_PHONE
          }
        });
      }
    }

    if (!salon) {
      const salonByDemoEmail = await tx.salon.findFirst({
        where: {
          contactEmail: {
            equals: OWNER_EMAIL,
            mode: "insensitive"
          }
        },
        orderBy: { createdAt: "asc" }
      });

      if (salonByDemoEmail) {
        salon = await tx.salon.update({
          where: { id: salonByDemoEmail.id },
          data: {
            ownerId: ownerUser.id,
            name: DEMO_SALON_NAME,
            timezone: DEMO_TIMEZONE,
            status: SalonStatus.ACTIVE,
            subscriptionStatus: SubscriptionStatus.ACTIVE,
            contactEmail: OWNER_EMAIL,
            contactPhone: DEMO_ORIGINAL_PHONE,
            originalPhoneNumber: DEMO_ORIGINAL_PHONE,
            notificationPhoneNumber: DEMO_ORIGINAL_PHONE
          }
        });
      }
    }

    if (!salon) {
      salon = await tx.salon.create({
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
          notificationPhoneNumber: DEMO_ORIGINAL_PHONE,
          country: "US"
        }
      });
    } else {
      salon = await tx.salon.update({
        where: { id: salon.id },
        data: {
          name: DEMO_SALON_NAME,
          timezone: DEMO_TIMEZONE,
          status: SalonStatus.ACTIVE,
          subscriptionStatus: SubscriptionStatus.ACTIVE,
          contactEmail: OWNER_EMAIL,
          contactPhone: DEMO_ORIGINAL_PHONE,
          originalPhoneNumber: DEMO_ORIGINAL_PHONE,
          notificationPhoneNumber: DEMO_ORIGINAL_PHONE
        }
      });
    }

    await ensureSalonSettings(tx, salon.id);

    await tx.user.update({
      where: { id: ownerUser.id },
      data: {
        salonId: salon.id,
        staffId: null,
        role: Role.SALON_OWNER,
        isActive: true
      }
    });

    const staffCandidates = await tx.staff.findMany({
      where: {
        salonId: salon.id,
        OR: [
          {
            email: {
              equals: STAFF_EMAIL,
              mode: "insensitive"
            }
          },
          {
            fullName: {
              equals: "Trang",
              mode: "insensitive"
            }
          }
        ]
      },
      include: {
        user: {
          select: {
            email: true
          }
        }
      },
      orderBy: { createdAt: "asc" }
    });

    const trangCandidate =
      staffCandidates.find(
        (staff) =>
          staff.email?.toLowerCase() === STAFF_EMAIL &&
          (!staff.user || staff.user.email.toLowerCase() === STAFF_EMAIL)
      ) ??
      staffCandidates.find(
        (staff) =>
          staff.fullName.trim().toLowerCase() === "trang" &&
          (!staff.user || staff.user.email.toLowerCase() === STAFF_EMAIL)
      );

    const trangStaff = trangCandidate
      ? await tx.staff.update({
          where: { id: trangCandidate.id },
          data: {
            fullName: "Trang",
            email: STAFF_EMAIL,
            phone: STAFF_PHONE,
            title: "Pedicure Specialist",
            status: StaffStatus.ACTIVE,
            currentWorkStatus: StaffWorkStatus.AVAILABLE,
            activeAppointmentId: null,
            isBookable: true
          }
        })
      : await tx.staff.create({
          data: {
            salonId: salon.id,
            fullName: "Trang",
            email: STAFF_EMAIL,
            phone: STAFF_PHONE,
            title: "Pedicure Specialist",
            status: StaffStatus.ACTIVE,
            currentWorkStatus: StaffWorkStatus.AVAILABLE,
            isBookable: true
          }
        });

    const staffUser = await tx.user.upsert({
      where: { email: STAFF_EMAIL },
      update: {
        fullName: "Trang",
        passwordHash: staffPasswordHash,
        role: Role.STAFF,
        phone: STAFF_PHONE,
        salonId: salon.id,
        staffId: trangStaff.id,
        isActive: true
      },
      create: {
        email: STAFF_EMAIL,
        fullName: "Trang",
        passwordHash: staffPasswordHash,
        role: Role.STAFF,
        phone: STAFF_PHONE,
        salonId: salon.id,
        staffId: trangStaff.id,
        isActive: true
      }
    });

    await tx.refreshToken.updateMany({
      where: {
        userId: {
          in: [ownerUser.id, staffUser.id, callCenterUser.id]
        },
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });

    return {
      salonId: salon.id,
      ownerUserId: ownerUser.id,
      staffUserId: staffUser.id,
      callCenterUserId: callCenterUser.id,
      trangStaffId: trangStaff.id
    };
  });

  console.log(
    JSON.stringify(
      {
        repaired: true,
        ownerEmail: OWNER_EMAIL,
        staffEmail: STAFF_EMAIL,
        callCenterEmail: CALL_CENTER_EMAIL,
        ...result
      },
      null,
      2
    )
  );
};

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
