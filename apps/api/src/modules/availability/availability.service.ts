import { AppointmentStatus, StaffStatus } from "@prisma/client";
import { DateTime } from "luxon";
import { BLOCKING_APPOINTMENT_STATUSES } from "../../config/constants";
import { prisma } from "../../db/prisma";
import { AppError } from "../../lib/errors";

interface SlotValidationInput {
  salonId: string;
  staffId: string;
  serviceId?: string;
  serviceIds?: string[];
  startTime: Date;
  excludeAppointmentId?: string;
}

interface SlotValidationResult {
  valid: boolean;
  reason?: string;
  endTime: Date;
  durationMinutes: number;
}

interface SlotsInput {
  salonId: string;
  staffId: string;
  serviceId: string;
  date: string;
  intervalMinutes: number;
}

const mapLuxonWeekdayToModel = (weekday: number): number => {
  return weekday % 7;
};

const getBusinessHourForDate = async (salonId: string, timezone: string, date: Date) => {
  const local = DateTime.fromJSDate(date, { zone: "utc" }).setZone(timezone);
  const dayOfWeek = mapLuxonWeekdayToModel(local.weekday);

  return prisma.businessHour.findUnique({
    where: {
      salonId_dayOfWeek: {
        salonId,
        dayOfWeek
      }
    }
  });
};

const ensureStaffCanPerformService = async (
  salonId: string,
  staffId: string,
  serviceId: string
): Promise<void> => {
  const mappingCount = await prisma.staffService.count({
    where: {
      salonId,
      serviceId
    }
  });

  if (mappingCount === 0) {
    return;
  }

  const canPerform = await prisma.staffService.findFirst({
    where: {
      salonId,
      serviceId,
      staffId
    }
  });

  if (!canPerform) {
    throw new AppError("Selected staff is not assigned to this service.", 400, "STAFF_NOT_MAPPED");
  }
};

export const validateAppointmentSlot = async (
  input: SlotValidationInput
): Promise<SlotValidationResult> => {
  const requestedServiceIds = Array.from(
    new Set(input.serviceIds?.length ? input.serviceIds : input.serviceId ? [input.serviceId] : [])
  );
  if (!requestedServiceIds.length) {
    throw new AppError("At least one service is required.", 400, "SERVICE_REQUIRED");
  }

  const [salon, services, staff] = await Promise.all([
    prisma.salon.findUnique({
      where: { id: input.salonId },
      select: { id: true, timezone: true }
    }),
    prisma.service.findMany({
      where: {
        id: {
          in: requestedServiceIds
        },
        salonId: input.salonId,
        isActive: true
      },
      select: { id: true, durationMinutes: true }
    }),
    prisma.staff.findFirst({
      where: {
        id: input.staffId,
        salonId: input.salonId,
        status: StaffStatus.ACTIVE,
        isBookable: true
      },
      select: { id: true }
    })
  ]);

  if (!salon) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }
  if (services.length !== requestedServiceIds.length) {
    throw new AppError("Service not found or inactive.", 400, "SERVICE_UNAVAILABLE");
  }
  if (!staff) {
    throw new AppError("Staff not found or not bookable.", 400, "STAFF_UNAVAILABLE");
  }

  for (const serviceId of requestedServiceIds) {
    await ensureStaffCanPerformService(input.salonId, input.staffId, serviceId);
  }

  const durationMinutes = services.reduce((sum, service) => sum + service.durationMinutes, 0);
  const endTime = new Date(input.startTime.getTime() + durationMinutes * 60 * 1000);

  const businessHour = await getBusinessHourForDate(input.salonId, salon.timezone, input.startTime);
  if (!businessHour || !businessHour.isOpen || !businessHour.openTime || !businessHour.closeTime) {
    return {
      valid: false,
      reason: "Salon is closed for the selected time.",
      endTime,
      durationMinutes
    };
  }

  const localStart = DateTime.fromJSDate(input.startTime, { zone: "utc" }).setZone(salon.timezone);
  const localEnd = DateTime.fromJSDate(endTime, { zone: "utc" }).setZone(salon.timezone);

  const [openHour, openMinute] = businessHour.openTime.split(":").map(Number);
  const [closeHour, closeMinute] = businessHour.closeTime.split(":").map(Number);

  const openDateTime = localStart.set({
    hour: openHour,
    minute: openMinute,
    second: 0,
    millisecond: 0
  });
  const closeDateTime = localStart.set({
    hour: closeHour,
    minute: closeMinute,
    second: 0,
    millisecond: 0
  });

  if (localStart < openDateTime || localEnd > closeDateTime) {
    return {
      valid: false,
      reason: "Requested slot is outside business hours.",
      endTime,
      durationMinutes
    };
  }

  const overlapping = await prisma.appointment.findFirst({
    where: {
      salonId: input.salonId,
      staffId: input.staffId,
      id: input.excludeAppointmentId ? { not: input.excludeAppointmentId } : undefined,
      status: {
        in: BLOCKING_APPOINTMENT_STATUSES
      },
      startTime: {
        lt: endTime
      },
      endTime: {
        gt: input.startTime
      }
    },
    select: {
      id: true
    }
  });

  if (overlapping) {
    return {
      valid: false,
      reason: "Requested slot overlaps with an existing booking.",
      endTime,
      durationMinutes
    };
  }

  return {
    valid: true,
    endTime,
    durationMinutes
  };
};

export const getAvailableSlots = async (input: SlotsInput) => {
  const [salon, service, staff] = await Promise.all([
    prisma.salon.findUnique({
      where: { id: input.salonId },
      select: { id: true, timezone: true }
    }),
    prisma.service.findFirst({
      where: {
        id: input.serviceId,
        salonId: input.salonId,
        isActive: true
      },
      select: {
        id: true,
        durationMinutes: true
      }
    }),
    prisma.staff.findFirst({
      where: {
        id: input.staffId,
        salonId: input.salonId,
        status: StaffStatus.ACTIVE,
        isBookable: true
      },
      select: {
        id: true
      }
    })
  ]);

  if (!salon) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }
  if (!service) {
    throw new AppError("Service not found or inactive.", 400, "SERVICE_UNAVAILABLE");
  }
  if (!staff) {
    throw new AppError("Staff not found or not bookable.", 400, "STAFF_UNAVAILABLE");
  }

  await ensureStaffCanPerformService(input.salonId, input.staffId, input.serviceId);

  const localDate = DateTime.fromFormat(input.date, "yyyy-MM-dd", { zone: salon.timezone });
  if (!localDate.isValid) {
    throw new AppError("Invalid date format. Expected YYYY-MM-DD.", 400, "INVALID_DATE");
  }

  const dayOfWeek = mapLuxonWeekdayToModel(localDate.weekday);
  const businessHour = await prisma.businessHour.findUnique({
    where: {
      salonId_dayOfWeek: {
        salonId: input.salonId,
        dayOfWeek
      }
    }
  });

  if (!businessHour || !businessHour.isOpen || !businessHour.openTime || !businessHour.closeTime) {
    return {
      date: input.date,
      slots: []
    };
  }

  const [openHour, openMinute] = businessHour.openTime.split(":").map(Number);
  const [closeHour, closeMinute] = businessHour.closeTime.split(":").map(Number);

  const openLocal = localDate.set({
    hour: openHour,
    minute: openMinute,
    second: 0,
    millisecond: 0
  });
  const closeLocal = localDate.set({
    hour: closeHour,
    minute: closeMinute,
    second: 0,
    millisecond: 0
  });

  const dayStartUtc = openLocal.startOf("day").toUTC().toJSDate();
  const dayEndUtc = openLocal.endOf("day").toUTC().toJSDate();

  const existingAppointments = await prisma.appointment.findMany({
    where: {
      salonId: input.salonId,
      staffId: input.staffId,
      status: {
        in: BLOCKING_APPOINTMENT_STATUSES
      },
      startTime: {
        lt: dayEndUtc
      },
      endTime: {
        gt: dayStartUtc
      }
    },
    select: {
      startTime: true,
      endTime: true
    }
  });

  const slots: Array<{ startTime: string; endTime: string }> = [];
  let cursor = openLocal;
  const latestStart = closeLocal.minus({ minutes: service.durationMinutes });

  while (cursor <= latestStart) {
    const slotEnd = cursor.plus({ minutes: service.durationMinutes });
    const slotStartUtc = cursor.toUTC();
    const slotEndUtc = slotEnd.toUTC();

    const overlaps = existingAppointments.some((appointment) => {
      const appointmentStart = DateTime.fromJSDate(appointment.startTime, { zone: "utc" });
      const appointmentEnd = DateTime.fromJSDate(appointment.endTime, { zone: "utc" });
      return slotStartUtc < appointmentEnd && slotEndUtc > appointmentStart;
    });

    if (!overlaps) {
      slots.push({
        startTime: slotStartUtc.toISO() ?? "",
        endTime: slotEndUtc.toISO() ?? ""
      });
    }

    cursor = cursor.plus({ minutes: input.intervalMinutes });
  }

  return {
    date: input.date,
    slots
  };
};
