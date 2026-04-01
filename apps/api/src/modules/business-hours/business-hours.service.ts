import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";

interface BusinessHourInput {
  dayOfWeek: number;
  isOpen: boolean;
  openTime?: string | null;
  closeTime?: string | null;
}

const defaultBusinessHours: BusinessHourInput[] = [
  { dayOfWeek: 0, isOpen: false, openTime: null, closeTime: null },
  { dayOfWeek: 1, isOpen: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 2, isOpen: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 3, isOpen: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 4, isOpen: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 5, isOpen: true, openTime: "09:00", closeTime: "18:00" },
  { dayOfWeek: 6, isOpen: true, openTime: "09:00", closeTime: "16:00" }
];

export const getBusinessHours = async (salonId: string) => {
  const existing = await prisma.businessHour.findMany({
    where: { salonId },
    orderBy: { dayOfWeek: "asc" }
  });

  if (existing.length === 7) {
    return existing;
  }

  await prisma.businessHour.createMany({
    data: defaultBusinessHours.map((hour) => ({
      salonId,
      ...hour
    })),
    skipDuplicates: true
  });

  return prisma.businessHour.findMany({
    where: { salonId },
    orderBy: { dayOfWeek: "asc" }
  });
};

export const updateBusinessHours = async (
  salonId: string,
  actorUserId: string,
  hours: BusinessHourInput[]
) => {
  const result = await prisma.$transaction(async (tx) => {
    await tx.businessHour.deleteMany({
      where: {
        salonId
      }
    });

    await tx.businessHour.createMany({
      data: hours.map((hour) => ({
        salonId,
        dayOfWeek: hour.dayOfWeek,
        isOpen: hour.isOpen,
        openTime: hour.isOpen ? hour.openTime : null,
        closeTime: hour.isOpen ? hour.closeTime : null
      }))
    });

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: "BUSINESS_HOURS_UPDATED",
        entityType: "BusinessHour",
        metadata: hours
      },
      tx
    );

    return tx.businessHour.findMany({
      where: { salonId },
      orderBy: { dayOfWeek: "asc" }
    });
  });

  return result;
};
