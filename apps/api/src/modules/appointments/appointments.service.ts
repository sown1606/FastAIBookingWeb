import { randomBytes } from "crypto";
import {
  AppointmentSource,
  AppointmentStatus,
  Prisma,
  StaffWorkStatus
} from "@prisma/client";
import { DateTime } from "luxon";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import {
  sendAppointmentCancellationEmail,
  sendAppointmentConfirmationEmail,
  sendAppointmentUpdateEmail
} from "../../lib/mailer";
import { sendSms } from "../../lib/sms";
import { validateAppointmentSlot } from "../availability/availability.service";
import { createSalonAlert } from "../alerts/alerts.service";
import {
  sendPushToSalonOwnerAndAssignedStaff,
  type PushPayload
} from "../notifications/notifications.service";

interface CreateAppointmentInput {
  customerId: string;
  staffId: string;
  serviceId: string;
  serviceIds?: string[];
  startTime: Date;
  source?: AppointmentSource;
  notes?: string;
  status?: AppointmentStatus;
}

interface UpdateAppointmentInput {
  customerId?: string;
  staffId?: string;
  serviceId?: string;
  serviceIds?: string[];
  startTime?: Date;
  source?: AppointmentSource;
  notes?: string | null;
  status?: AppointmentStatus;
}

interface ListAppointmentsInput {
  page: number;
  limit: number;
  staffId?: string;
  customerId?: string;
  status?: AppointmentStatus;
  dateFrom?: Date;
  dateTo?: Date;
}

interface RescheduleAppointmentInput {
  staffId?: string;
  startTime: Date;
}

interface AppointmentStartTimeInput {
  startTime?: string;
  startTimeLocal?: string;
}

interface AppointmentServiceForWrite {
  id: string;
  durationMinutes: number;
  priceCents: number;
}

const terminalStatuses = new Set<AppointmentStatus>([
  AppointmentStatus.COMPLETED,
  AppointmentStatus.CANCELED,
  AppointmentStatus.NO_SHOW
]);

const createAllowedStatuses = new Set<AppointmentStatus>([
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED
]);

const manualUpdateAllowedStatuses = new Set<AppointmentStatus>([
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.NO_SHOW
]);

const TECHNICAL_NOTE_LINE_PATTERNS = [
  /^Created by Amazon Connect AI Booking\.$/i,
  /^Source:\s*amazon_connect_ai$/i,
  /^Amazon Connect contact:\s*.+$/i
];

const invalidAppointmentStartTime = () =>
  new AppError("Invalid appointment start time.", 400, "INVALID_START_TIME");

export const parseAppointmentStartTime = async (
  salonId: string,
  input: AppointmentStartTimeInput
): Promise<Date> => {
  const salon = await prisma.salon.findUnique({
    where: {
      id: salonId
    },
    select: {
      timezone: true
    }
  });

  if (!salon) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }

  if (input.startTimeLocal !== undefined) {
    const parsed = DateTime.fromFormat(input.startTimeLocal, "yyyy-MM-dd'T'HH:mm", {
      zone: salon.timezone,
      setZone: true
    });

    if (
      !parsed.isValid ||
      parsed.toFormat("yyyy-MM-dd'T'HH:mm") !== input.startTimeLocal
    ) {
      throw invalidAppointmentStartTime();
    }

    return parsed.toUTC().toJSDate();
  }

  if (input.startTime !== undefined) {
    const parsed = new Date(input.startTime);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  throw invalidAppointmentStartTime();
};

const assertCreateStatusAllowed = (status: AppointmentStatus): void => {
  if (!createAllowedStatuses.has(status)) {
    throw new AppError(
      "Appointments can only be created as scheduled or confirmed.",
      400,
      "INVALID_STATUS"
    );
  }
};

const assertManualUpdateStatusAllowed = (status?: AppointmentStatus): void => {
  if (status === AppointmentStatus.CANCELED) {
    throw new AppError(
      "Use the dedicated cancel endpoint to cancel appointments.",
      400,
      "USE_CANCEL_ENDPOINT"
    );
  }
  if (status && !manualUpdateAllowedStatuses.has(status)) {
    throw new AppError(
      "Use the work start and confirmed done actions for this status.",
      400,
      "INVALID_STATUS_TRANSITION"
    );
  }
};

export const removeTechnicalAppointmentNoteLines = (notes: string | null | undefined): string | null => {
  if (!notes) {
    return notes ?? null;
  }

  const businessLines = notes
    .split(/\r?\n/)
    .filter((line) => !TECHNICAL_NOTE_LINE_PATTERNS.some((pattern) => pattern.test(line.trim())));
  const cleaned = businessLines.join("\n").trim();
  return cleaned || null;
};

export const toOwnerAppointmentResponse = <T extends { notes?: string | null; source?: AppointmentSource }>(
  appointment: T
): Omit<T, "source"> & { notes: string | null; bookingChannel?: "assistant" | "dashboard" | "manual" | "call_center" } => {
  const { source, ...rest } = appointment;
  const bookingChannel =
    source === AppointmentSource.AI
      ? "assistant"
      : source === AppointmentSource.CALL_CENTER
        ? "call_center"
        : source === AppointmentSource.MANUAL
          ? "manual"
          : source === AppointmentSource.DASHBOARD
            ? "dashboard"
            : undefined;

  return {
    ...rest,
    notes: removeTechnicalAppointmentNoteLines(appointment.notes),
    ...(bookingChannel ? { bookingChannel } : {})
  };
};

const ensureCustomerBelongsToSalon = async (salonId: string, customerId: string): Promise<void> => {
  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      salonId
    },
    select: {
      id: true
    }
  });
  if (!customer) {
    throw new AppError("Customer not found for this salon.", 404, "CUSTOMER_NOT_FOUND");
  }
};

const normalizeAppointmentServiceIds = (serviceId?: string, serviceIds?: string[]): string[] => {
  const ordered = serviceIds?.length ? [...serviceIds] : serviceId ? [serviceId] : [];
  if (serviceId && !ordered.includes(serviceId)) {
    ordered.unshift(serviceId);
  }
  return Array.from(new Set(ordered));
};

const getAppointmentServicesForWrite = async (
  salonId: string,
  serviceIds: string[]
): Promise<AppointmentServiceForWrite[]> => {
  if (!serviceIds.length) {
    throw new AppError("At least one service is required.", 400, "SERVICE_REQUIRED");
  }

  const services = await prisma.service.findMany({
    where: {
      salonId,
      id: {
        in: serviceIds
      },
      isActive: true
    },
    select: {
      id: true,
      durationMinutes: true,
      priceCents: true
    }
  });

  if (services.length !== serviceIds.length) {
    throw new AppError("One or more services are not available.", 400, "SERVICE_UNAVAILABLE");
  }

  const byId = new Map(services.map((service) => [service.id, service]));
  return serviceIds.map((id) => byId.get(id)!);
};

const buildAppointmentInclude = () => ({
  salon: {
    select: {
      name: true,
      timezone: true
    }
  },
  customer: true,
  staff: true,
  service: true,
  appointmentServices: {
    include: {
      service: true
    },
    orderBy: {
      createdAt: "asc" as const
    }
  },
  workSessions: {
    orderBy: {
      startedAt: "desc" as const
    },
    take: 1
  },
  reminders: {
    orderBy: {
      remindAt: "asc" as const
    }
  },
  feedback: true,
  statusHistory: {
    orderBy: {
      changedAt: "desc" as const
    }
  }
});

const replaceAppointmentServices = async (
  tx: Prisma.TransactionClient,
  salonId: string,
  appointmentId: string,
  services: AppointmentServiceForWrite[]
) => {
  await tx.appointmentService.deleteMany({
    where: {
      appointmentId
    }
  });

  await tx.appointmentService.createMany({
    data: services.map((service) => ({
      salonId,
      appointmentId,
      serviceId: service.id,
      durationMinutes: service.durationMinutes,
      priceCents: service.priceCents
    }))
  });
};

const replaceStaffReminders = async (
  tx: Prisma.TransactionClient,
  input: {
    salonId: string;
    staffId: string;
    appointmentId: string;
    startTime: Date;
    endTime: Date;
  }
) => {
  await tx.staffReminder.deleteMany({
    where: {
      appointmentId: input.appointmentId
    }
  });

  await tx.staffReminder.createMany({
    data: [
      {
        salonId: input.salonId,
        staffId: input.staffId,
        appointmentId: input.appointmentId,
        reminderType: "BEFORE_BOOKING",
        remindAt: new Date(input.startTime.getTime() - 15 * 60 * 1000),
        message: "Lich hen cua ban sap bat dau trong 15 phut."
      },
      {
        salonId: input.salonId,
        staffId: input.staffId,
        appointmentId: input.appointmentId,
        reminderType: "NEAR_END",
        remindAt: new Date(input.endTime.getTime() - 5 * 60 * 1000),
        message: "Thoi gian lam dich vu sap ket thuc."
      }
    ]
  });
};

const updateStaffOperationalState = async (
  tx: Prisma.TransactionClient,
  input: {
    oldStaffId?: string;
    nextStaffId: string;
    appointmentId: string;
    status: AppointmentStatus;
  }
) => {
  if (input.oldStaffId && input.oldStaffId !== input.nextStaffId) {
    await tx.staff.updateMany({
      where: {
        id: input.oldStaffId,
        activeAppointmentId: input.appointmentId
      },
      data: {
        currentWorkStatus: StaffWorkStatus.AVAILABLE,
        activeAppointmentId: null
      }
    });
  }

  if (terminalStatuses.has(input.status)) {
    await tx.staff.updateMany({
      where: {
        id: input.nextStaffId,
        activeAppointmentId: input.appointmentId
      },
      data: {
        currentWorkStatus: StaffWorkStatus.AVAILABLE,
        activeAppointmentId: null
      }
    });
    return;
  }

  await tx.staff.update({
    where: {
      id: input.nextStaffId
    },
    data: {
      currentWorkStatus:
        input.status === AppointmentStatus.IN_PROGRESS
          ? StaffWorkStatus.IN_PROGRESS
          : StaffWorkStatus.ASSIGNED,
      activeAppointmentId: input.appointmentId
    }
  });
};

const createBookingAlert = async (appointment: Awaited<ReturnType<typeof getAppointmentDetail>>) => {
  await createSalonAlert({
    salonId: appointment.salonId,
    alertType: "BOOKING_CREATED",
    title: "Lich hen moi",
    message: `Lich hen moi cho ${appointment.customer.firstName} ${appointment.customer.lastName} luc ${appointment.startTime.toISOString()}.`,
    metadata: {
      appointmentId: appointment.id,
      customerPhone: appointment.customer.phone,
      source: appointment.source
    },
    sendSms: false
  });
};

const formatNotificationTime = (startTime: Date, timezone: string): string => {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone
  }).format(startTime);
};

const getNotificationServiceLabel = (appointment: Awaited<ReturnType<typeof getAppointmentDetail>>) => {
  const serviceNames = appointment.appointmentServices
    .map((item) => item.service.name)
    .filter(Boolean);
  return serviceNames.length ? serviceNames.join(", ") : appointment.service.name;
};

const getNotificationStaffLabel = (fullName: string): string => {
  return fullName.trim().split(/\s+/)[0] || "Staff";
};

const buildAppointmentPushPayload = (
  appointment: Awaited<ReturnType<typeof getAppointmentDetail>>,
  eventType: "created" | "updated" | "rescheduled" | "canceled"
): PushPayload => {
  const serviceName = getNotificationServiceLabel(appointment);
  const appointmentTime = formatNotificationTime(
    appointment.startTime,
    appointment.salon.timezone
  );
  const customerName = `${appointment.customer.firstName} ${appointment.customer.lastName}`.trim();
  const title =
    eventType === "created"
      ? "New appointment"
      : eventType === "rescheduled"
        ? "Appointment rescheduled"
        : eventType === "canceled"
          ? "Appointment canceled"
          : "Appointment updated";
  const type = `appointment_${eventType}`;
  const url = `/appointments?appointmentId=${encodeURIComponent(appointment.id)}`;

  return {
    title,
    body: `${customerName || "Customer"} - ${serviceName} with ${getNotificationStaffLabel(appointment.staff.fullName)} at ${appointmentTime}.`,
    type,
    salonId: appointment.salonId,
    url,
    data: {
      type,
      appointmentId: appointment.id,
      salonId: appointment.salonId,
      staffId: appointment.staffId,
      url
    }
  };
};

const sendAppointmentCustomerNotifications = async (
  appointment: Awaited<ReturnType<typeof getAppointmentDetail>>,
  eventType: "created" | "updated" | "canceled"
): Promise<void> => {
  try {
    const serviceName = getNotificationServiceLabel(appointment);
    const appointmentTime = formatNotificationTime(appointment.startTime, appointment.salon.timezone);
    const actionText =
      eventType === "created" ? "booked" : eventType === "updated" ? "updated" : "canceled";

    const emailPromise =
      eventType === "created"
        ? sendAppointmentConfirmationEmail(appointment)
        : eventType === "updated"
          ? sendAppointmentUpdateEmail(appointment)
          : sendAppointmentCancellationEmail(appointment);

    const smsPromise = sendSms({
      to: appointment.customer.phone,
      body: `${appointment.salon.name}: your ${serviceName} appointment with ${appointment.staff.fullName} was ${actionText} for ${appointmentTime}.`,
      reason:
        eventType === "created"
          ? "APPOINTMENT_CONFIRMATION"
          : eventType === "updated"
            ? "APPOINTMENT_UPDATE"
            : "APPOINTMENT_CANCELLATION"
    });

    await Promise.allSettled([emailPromise, smsPromise]);
  } catch (error) {
    logger.warn(
      {
        appointmentId: appointment.id,
        eventType,
        error: error instanceof Error ? error.message : String(error)
      },
      "Appointment notification failed. Continuing without blocking appointment workflow."
    );
  }
};

const sendAppointmentPushNotifications = async (
  appointment: Awaited<ReturnType<typeof getAppointmentDetail>>,
  eventType: "created" | "updated" | "rescheduled" | "canceled",
  affectedStaffIds: string[] = [appointment.staffId]
): Promise<void> => {
  try {
    const payload = buildAppointmentPushPayload(appointment, eventType);

    const result = await sendPushToSalonOwnerAndAssignedStaff(
      appointment.salonId,
      affectedStaffIds,
      payload
    );
    for (const missingStaffId of result.missingStaffIds) {
      logger.warn(
        {
          appointmentId: appointment.id,
          staffId: missingStaffId,
          salonId: appointment.salonId
        },
        "appointment push skipped assigned staff because no active user is linked to staffId"
      );
    }
    logger.info(
      {
        appointmentId: appointment.id,
        staffId: appointment.staffId,
        salonId: appointment.salonId,
        eventType: payload.type,
        targetUserIds: result.targetUserIds,
        tokenCount: result.tokenCount,
        attempted: result.attempted,
        successCount: result.successCount,
        failureCount: result.failureCount,
        invalidTokenCount: result.invalidTokenCount,
        disabled: result.disabled
      },
      "Appointment push notification send result."
    );
  } catch (error) {
    logger.warn(
      {
        appointmentId: appointment.id,
        eventType,
        error: error instanceof Error ? error.message : String(error)
      },
      "Appointment push notification failed. Continuing without blocking appointment workflow."
    );
  }
};

export const createAppointment = async (
  salonId: string,
  actorUserId: string,
  input: CreateAppointmentInput
) => {
  await ensureCustomerBelongsToSalon(salonId, input.customerId);

  const serviceIds = normalizeAppointmentServiceIds(input.serviceId, input.serviceIds);
  const services = await getAppointmentServicesForWrite(salonId, serviceIds);

  const slotValidation = await validateAppointmentSlot({
    salonId,
    staffId: input.staffId,
    serviceIds,
    startTime: input.startTime
  });

  if (!slotValidation.valid) {
    throw new AppError(slotValidation.reason ?? "Invalid appointment slot.", 400, "INVALID_SLOT");
  }

  const appointmentStatus = input.status ?? AppointmentStatus.SCHEDULED;
  assertCreateStatusAllowed(appointmentStatus);

  const created = await prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.create({
      data: {
        salonId,
        customerId: input.customerId,
        staffId: input.staffId,
        serviceId: services[0]!.id,
        startTime: input.startTime,
        endTime: slotValidation.endTime,
        durationMinutes: slotValidation.durationMinutes,
        source: input.source ?? AppointmentSource.DASHBOARD,
        notes: input.notes,
        status: appointmentStatus,
        createdByUserId: actorUserId
      }
    });

    await replaceAppointmentServices(tx, salonId, appointment.id, services);
    if (terminalStatuses.has(appointment.status)) {
      await tx.staffReminder.deleteMany({
        where: {
          appointmentId: appointment.id,
          deliveredAt: null
        }
      });
    } else {
      await replaceStaffReminders(tx, {
        salonId,
        staffId: appointment.staffId,
        appointmentId: appointment.id,
        startTime: appointment.startTime,
        endTime: appointment.endTime
      });
    }
    await updateStaffOperationalState(tx, {
      nextStaffId: appointment.staffId,
      appointmentId: appointment.id,
      status: appointment.status
    });

    await tx.appointmentStatusHistory.create({
      data: {
        appointmentId: appointment.id,
        previousStatus: null,
        newStatus: appointment.status,
        reason: "Appointment created",
        changedByUserId: actorUserId
      }
    });

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: "APPOINTMENT_CREATED",
        entityType: "Appointment",
        entityId: appointment.id,
        metadata: {
          source: appointment.source,
          serviceIds
        }
      },
      tx
    );

    return tx.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
      include: buildAppointmentInclude()
    });
  });

  await createBookingAlert(created);
  if (created.source !== AppointmentSource.AI) {
    await sendAppointmentCustomerNotifications(created, "created");
  }
  await sendAppointmentPushNotifications(created, "created");
  return created;
};

export const createAppointmentFromAI = async (
  salonId: string,
  actorUserId: string,
  input: Omit<CreateAppointmentInput, "source">
) => {
  return createAppointment(salonId, actorUserId, {
    ...input,
    source: AppointmentSource.AI
  });
};

export const getAppointmentDetail = async (salonId: string, appointmentId: string) => {
  const appointment = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      salonId
    },
    include: buildAppointmentInclude()
  });

  if (!appointment) {
    throw new AppError("Appointment not found.", 404, "APPOINTMENT_NOT_FOUND");
  }
  return appointment;
};

export const getAppointmentCreatedPushTestPayload = async (
  salonId: string,
  appointmentId: string
) => {
  const appointment = await getAppointmentDetail(salonId, appointmentId);
  return {
    appointment,
    payload: buildAppointmentPushPayload(appointment, "created")
  };
};

export const listAppointments = async (salonId: string, input: ListAppointmentsInput) => {
  const skip = (input.page - 1) * input.limit;
  const where = {
    salonId,
    ...(input.staffId ? { staffId: input.staffId } : {}),
    ...(input.customerId ? { customerId: input.customerId } : {}),
    ...(input.status ? { status: input.status } : {}),
    ...(input.dateFrom || input.dateTo
      ? {
          startTime: {
            ...(input.dateFrom ? { gte: input.dateFrom } : {}),
            ...(input.dateTo ? { lte: input.dateTo } : {})
          }
        }
      : {})
  };

  const [items, total] = await Promise.all([
    prisma.appointment.findMany({
      where,
      include: buildAppointmentInclude(),
      orderBy: {
        startTime: "asc"
      },
      skip,
      take: input.limit
    }),
    prisma.appointment.count({ where })
  ]);

  return {
    items,
    pagination: {
      page: input.page,
      limit: input.limit,
      total
    }
  };
};

export const updateAppointment = async (
  salonId: string,
  appointmentId: string,
  actorUserId: string,
  input: UpdateAppointmentInput
) => {
  const existing = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      salonId
    },
    include: {
      appointmentServices: true
    }
  });
  if (!existing) {
    throw new AppError("Appointment not found.", 404, "APPOINTMENT_NOT_FOUND");
  }

  const existingServiceIds = existing.appointmentServices.length
    ? existing.appointmentServices.map((item) => item.serviceId)
    : [existing.serviceId];
  const nextServiceIds =
    input.serviceIds || input.serviceId
      ? normalizeAppointmentServiceIds(input.serviceId ?? existing.serviceId, input.serviceIds)
      : existingServiceIds;
  const services = await getAppointmentServicesForWrite(salonId, nextServiceIds);

  const nextCustomerId = input.customerId ?? existing.customerId;
  const nextStaffId = input.staffId ?? existing.staffId;
  const nextStartTime = input.startTime ?? existing.startTime;
  assertManualUpdateStatusAllowed(input.status);

  const nextStatus = input.status ?? existing.status;

  await ensureCustomerBelongsToSalon(salonId, nextCustomerId);

  const slotValidation = await validateAppointmentSlot({
    salonId,
    staffId: nextStaffId,
    serviceIds: nextServiceIds,
    startTime: nextStartTime,
    excludeAppointmentId: existing.id
  });

  if (!slotValidation.valid) {
    throw new AppError(slotValidation.reason ?? "Invalid appointment slot.", 400, "INVALID_SLOT");
  }

  const updatedAppointment = await prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.update({
      where: { id: existing.id },
      data: {
        customerId: nextCustomerId,
        staffId: nextStaffId,
        serviceId: services[0]!.id,
        startTime: nextStartTime,
        endTime: slotValidation.endTime,
        durationMinutes: slotValidation.durationMinutes,
        status: nextStatus,
        source: input.source ?? existing.source,
        notes: input.notes === undefined ? existing.notes : input.notes
      }
    });

    await replaceAppointmentServices(tx, salonId, appointment.id, services);
    await replaceStaffReminders(tx, {
      salonId,
      staffId: appointment.staffId,
      appointmentId: appointment.id,
      startTime: appointment.startTime,
      endTime: appointment.endTime
    });
    await updateStaffOperationalState(tx, {
      oldStaffId: existing.staffId,
      nextStaffId: appointment.staffId,
      appointmentId: appointment.id,
      status: appointment.status
    });

    if (existing.status !== nextStatus) {
      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId: appointment.id,
          previousStatus: existing.status,
          newStatus: nextStatus,
          reason: "Appointment updated",
          changedByUserId: actorUserId
        }
      });
    }

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: "APPOINTMENT_UPDATED",
        entityType: "Appointment",
        entityId: appointment.id,
        metadata: {
          ...input,
          serviceIds: nextServiceIds
        }
      },
      tx
    );

    return tx.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
      include: buildAppointmentInclude()
    });
  });

  await sendAppointmentCustomerNotifications(updatedAppointment, "updated");
  await sendAppointmentPushNotifications(updatedAppointment, "updated", [
    existing.staffId,
    updatedAppointment.staffId
  ]);
  return updatedAppointment;
};

export const cancelAppointment = async (
  salonId: string,
  appointmentId: string,
  actorUserId: string,
  reason?: string
) => {
  const existing = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      salonId
    }
  });
  if (!existing) {
    throw new AppError("Appointment not found.", 404, "APPOINTMENT_NOT_FOUND");
  }
  if (existing.status === AppointmentStatus.CANCELED) {
    return getAppointmentDetail(salonId, existing.id);
  }

  const canceledAppointment = await prisma.$transaction(async (tx) => {
    const updated = await tx.appointment.update({
      where: { id: existing.id },
      data: {
        status: AppointmentStatus.CANCELED,
        canceledReason: reason ?? "Canceled by user"
      }
    });

    await tx.staff.updateMany({
      where: {
        id: existing.staffId,
        activeAppointmentId: existing.id
      },
      data: {
        currentWorkStatus: StaffWorkStatus.AVAILABLE,
        activeAppointmentId: null
      }
    });

    await tx.staffWorkSession.updateMany({
      where: {
        appointmentId: existing.id,
        status: StaffWorkStatus.IN_PROGRESS
      },
      data: {
        status: StaffWorkStatus.DONE,
        endedAt: new Date()
      }
    });

    await tx.staffReminder.deleteMany({
      where: {
        appointmentId: existing.id,
        deliveredAt: null
      }
    });

    await tx.appointmentStatusHistory.create({
      data: {
        appointmentId: updated.id,
        previousStatus: existing.status,
        newStatus: AppointmentStatus.CANCELED,
        reason: reason ?? "Canceled",
        changedByUserId: actorUserId
      }
    });

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: "APPOINTMENT_CANCELED",
        entityType: "Appointment",
        entityId: updated.id,
        metadata: {
          reason
        }
      },
      tx
    );

    return tx.appointment.findUniqueOrThrow({
      where: { id: updated.id },
      include: buildAppointmentInclude()
    });
  });

  await sendAppointmentCustomerNotifications(canceledAppointment, "canceled");
  await sendAppointmentPushNotifications(canceledAppointment, "canceled", [existing.staffId]);
  return canceledAppointment;
};

export const permanentlyDeleteAppointment = async (
  salonId: string,
  appointmentId: string,
  actorUserId: string
) => {
  const existing = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      salonId
    },
    include: buildAppointmentInclude()
  });
  if (!existing) {
    throw new AppError("Appointment not found.", 404, "APPOINTMENT_NOT_FOUND");
  }
  if (!terminalStatuses.has(existing.status)) {
    throw new AppError(
      "Active appointments must be canceled or completed before permanent deletion.",
      409,
      "APPOINTMENT_NOT_TERMINAL"
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.staff.updateMany({
      where: {
        id: existing.staffId,
        activeAppointmentId: existing.id
      },
      data: {
        currentWorkStatus: StaffWorkStatus.AVAILABLE,
        activeAppointmentId: null
      }
    });

    await tx.staffWorkSession.updateMany({
      where: {
        appointmentId: existing.id,
        status: StaffWorkStatus.IN_PROGRESS
      },
      data: {
        status: StaffWorkStatus.DONE,
        endedAt: new Date()
      }
    });

    const bookingAttemptUpdate = await tx.bookingAttempt.updateMany({
      where: {
        appointmentId: existing.id
      },
      data: {
        appointmentId: null
      }
    });

    await tx.staffReminder.deleteMany({
      where: {
        appointmentId: existing.id
      }
    });

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: "APPOINTMENT_DELETED_PERMANENTLY",
        entityType: "Appointment",
        entityId: existing.id,
        metadata: {
          appointmentSnapshot: {
            id: existing.id,
            salonId: existing.salonId,
            customerId: existing.customerId,
            staffId: existing.staffId,
            staffName: existing.staff.fullName,
            serviceId: existing.serviceId,
            serviceName: existing.service.name,
            startTime: existing.startTime.toISOString(),
            endTime: existing.endTime.toISOString(),
            status: existing.status,
            canceledReason: existing.canceledReason,
            notes: removeTechnicalAppointmentNoteLines(existing.notes),
            statusHistory: existing.statusHistory.map((history) => ({
              previousStatus: history.previousStatus,
              newStatus: history.newStatus,
              reason: history.reason,
              changedAt: history.changedAt.toISOString()
            }))
          },
          bookingAttemptsDetached: bookingAttemptUpdate.count
        }
      },
      tx
    );

    await tx.appointment.delete({
      where: {
        id: existing.id
      }
    });

    return {
      id: existing.id,
      status: existing.status,
      bookingAttemptsDetached: bookingAttemptUpdate.count,
      deleted: true
    };
  });

  return result;
};

export const rescheduleAppointment = async (
  salonId: string,
  appointmentId: string,
  actorUserId: string,
  input: RescheduleAppointmentInput
) => {
  const existing = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      salonId
    },
    include: {
      appointmentServices: true
    }
  });
  if (!existing) {
    throw new AppError("Appointment not found.", 404, "APPOINTMENT_NOT_FOUND");
  }
  if (existing.status === AppointmentStatus.CANCELED) {
    throw new AppError("Canceled appointments cannot be rescheduled.", 400, "INVALID_STATUS");
  }

  const nextStaffId = input.staffId ?? existing.staffId;
  const serviceIds = existing.appointmentServices.length
    ? existing.appointmentServices.map((item) => item.serviceId)
    : [existing.serviceId];

  const slotValidation = await validateAppointmentSlot({
    salonId,
    staffId: nextStaffId,
    serviceIds,
    startTime: input.startTime,
    excludeAppointmentId: existing.id
  });

  if (!slotValidation.valid) {
    throw new AppError(slotValidation.reason ?? "Invalid appointment slot.", 400, "INVALID_SLOT");
  }

  const rescheduledAppointment = await prisma.$transaction(async (tx) => {
    const updated = await tx.appointment.update({
      where: { id: existing.id },
      data: {
        staffId: nextStaffId,
        startTime: input.startTime,
        endTime: slotValidation.endTime,
        durationMinutes: slotValidation.durationMinutes
      }
    });

    await replaceStaffReminders(tx, {
      salonId,
      staffId: updated.staffId,
      appointmentId: updated.id,
      startTime: updated.startTime,
      endTime: updated.endTime
    });
    await updateStaffOperationalState(tx, {
      oldStaffId: existing.staffId,
      nextStaffId,
      appointmentId: updated.id,
      status: updated.status
    });

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: "APPOINTMENT_RESCHEDULED",
        entityType: "Appointment",
        entityId: updated.id
      },
      tx
    );

    return tx.appointment.findUniqueOrThrow({
      where: { id: updated.id },
      include: buildAppointmentInclude()
    });
  });

  await sendAppointmentCustomerNotifications(rescheduledAppointment, "updated");
  await sendAppointmentPushNotifications(rescheduledAppointment, "rescheduled", [
    existing.staffId,
    rescheduledAppointment.staffId
  ]);
  return rescheduledAppointment;
};

const assertStaffCanOperateAppointment = (
  appointment: { staffId: string },
  actorStaffId?: string | null
) => {
  if (actorStaffId && appointment.staffId !== actorStaffId) {
    throw new AppError("Forbidden appointment access.", 403, "FORBIDDEN");
  }
};

export const startAppointmentWork = async (
  salonId: string,
  appointmentId: string,
  actorUserId: string,
  actorStaffId?: string | null
) => {
  const existing = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      salonId
    }
  });
  if (!existing) {
    throw new AppError("Appointment not found.", 404, "APPOINTMENT_NOT_FOUND");
  }
  assertStaffCanOperateAppointment(existing, actorStaffId);
  if (terminalStatuses.has(existing.status)) {
    throw new AppError("This appointment cannot be started.", 400, "INVALID_STATUS");
  }
  if (existing.status === AppointmentStatus.IN_PROGRESS) {
    throw new AppError("Work has already started for this appointment.", 409, "WORK_ALREADY_STARTED");
  }

  return prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.update({
      where: {
        id: existing.id
      },
      data: {
        status: AppointmentStatus.IN_PROGRESS
      }
    });

    await tx.staffWorkSession.create({
      data: {
        salonId,
        staffId: appointment.staffId,
        appointmentId: appointment.id,
        status: StaffWorkStatus.IN_PROGRESS,
        expectedEndAt: appointment.endTime
      }
    });

    await tx.staff.update({
      where: {
        id: appointment.staffId
      },
      data: {
        currentWorkStatus: StaffWorkStatus.IN_PROGRESS,
        activeAppointmentId: appointment.id
      }
    });

    if (existing.status !== AppointmentStatus.IN_PROGRESS) {
      await tx.appointmentStatusHistory.create({
        data: {
          appointmentId: appointment.id,
          previousStatus: existing.status,
          newStatus: AppointmentStatus.IN_PROGRESS,
          reason: "Staff started work",
          changedByUserId: actorUserId
        }
      });
    }

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: "APPOINTMENT_WORK_STARTED",
        entityType: "Appointment",
        entityId: appointment.id
      },
      tx
    );

    return tx.appointment.findUniqueOrThrow({
      where: {
        id: appointment.id
      },
      include: buildAppointmentInclude()
    });
  });
};

export const extendAppointmentWork = async (
  salonId: string,
  appointmentId: string,
  actorUserId: string,
  minutes: number,
  actorStaffId?: string | null
) => {
  if (minutes <= 0 || minutes > 180) {
    throw new AppError("Extension minutes must be between 1 and 180.", 400, "INVALID_EXTENSION");
  }

  const existing = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      salonId
    }
  });
  if (!existing) {
    throw new AppError("Appointment not found.", 404, "APPOINTMENT_NOT_FOUND");
  }
  assertStaffCanOperateAppointment(existing, actorStaffId);

  const activeSession = await prisma.staffWorkSession.findFirst({
    where: {
      appointmentId: existing.id,
      status: StaffWorkStatus.IN_PROGRESS
    },
    orderBy: {
      startedAt: "desc"
    }
  });
  if (!activeSession) {
    throw new AppError("Work has not started for this appointment.", 400, "WORK_NOT_STARTED");
  }

  return prisma.$transaction(async (tx) => {
    const nextExpectedEndAt = new Date(activeSession.expectedEndAt.getTime() + minutes * 60 * 1000);
    await tx.staffWorkSession.update({
      where: {
        id: activeSession.id
      },
      data: {
        expectedEndAt: nextExpectedEndAt,
        extendedMinutes: activeSession.extendedMinutes + minutes
      }
    });

    const appointment = await tx.appointment.update({
      where: {
        id: existing.id
      },
      data: {
        endTime: nextExpectedEndAt > existing.endTime ? nextExpectedEndAt : existing.endTime,
        durationMinutes: existing.durationMinutes + minutes
      }
    });

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: "APPOINTMENT_WORK_EXTENDED",
        entityType: "Appointment",
        entityId: appointment.id,
        metadata: {
          minutes
        }
      },
      tx
    );

    return tx.appointment.findUniqueOrThrow({
      where: {
        id: appointment.id
      },
      include: buildAppointmentInclude()
    });
  });
};

export const completeAppointmentWork = async (
  salonId: string,
  appointmentId: string,
  actorUserId: string,
  confirmed: boolean,
  actorStaffId?: string | null
) => {
  if (!confirmed) {
    throw new AppError("Done confirmation is required.", 400, "DONE_CONFIRMATION_REQUIRED");
  }

  const existing = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      salonId
    },
    include: {
      customer: true,
      salon: true
    }
  });
  if (!existing) {
    throw new AppError("Appointment not found.", 404, "APPOINTMENT_NOT_FOUND");
  }
  assertStaffCanOperateAppointment(existing, actorStaffId);
  if (existing.status === AppointmentStatus.CANCELED || existing.status === AppointmentStatus.NO_SHOW) {
    throw new AppError("This appointment cannot be completed.", 400, "INVALID_STATUS");
  }
  if (existing.status !== AppointmentStatus.IN_PROGRESS) {
    throw new AppError("Work must be started before it can be completed.", 400, "WORK_NOT_STARTED");
  }

  const feedbackToken = existing.feedbackToken ?? randomBytes(24).toString("hex");

  const completed = await prisma.$transaction(async (tx) => {
    const appointment = await tx.appointment.update({
      where: {
        id: existing.id
      },
      data: {
        status: AppointmentStatus.COMPLETED,
        feedbackToken
      }
    });

    await tx.staffWorkSession.updateMany({
      where: {
        appointmentId: appointment.id,
        status: StaffWorkStatus.IN_PROGRESS
      },
      data: {
        status: StaffWorkStatus.DONE,
        endedAt: new Date()
      }
    });

    await tx.staff.update({
      where: {
        id: appointment.staffId
      },
      data: {
        currentWorkStatus: StaffWorkStatus.AVAILABLE,
        activeAppointmentId: null
      }
    });

    await tx.appointmentStatusHistory.create({
      data: {
        appointmentId: appointment.id,
        previousStatus: existing.status,
        newStatus: AppointmentStatus.COMPLETED,
        reason: "Staff confirmed done",
        changedByUserId: actorUserId
      }
    });

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: "APPOINTMENT_WORK_COMPLETED",
        entityType: "Appointment",
        entityId: appointment.id
      },
      tx
    );

    return tx.appointment.findUniqueOrThrow({
      where: {
        id: appointment.id
      },
      include: buildAppointmentInclude()
    });
  });

  const baseFeedbackUrl = env.FEEDBACK_PUBLIC_URL.replace(/\/$/, "");
  const feedbackUrl = `${baseFeedbackUrl}/${encodeURIComponent(feedbackToken)}`;
  await sendSms({
    to: completed.customer.phone,
    reason: "FEEDBACK_REQUEST",
    body: `Cam on quy khach da ghe ${existing.salon.name}. Vui long danh gia dich vu tai: ${feedbackUrl}`
  });

  return {
    appointment: completed,
    feedbackUrl
  };
};
