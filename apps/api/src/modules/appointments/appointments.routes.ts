import { Router } from "express";
import { AppointmentSource, AppointmentStatus, Role } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler";
import { requireRoles } from "../../middleware/auth";
import { AppError } from "../../lib/errors";
import { validate } from "../../middleware/validate";
import { sendSuccess } from "../../utils/response";
import {
  cancelAppointment,
  completeAppointmentWork,
  createAppointment,
  createAppointmentFromAI,
  extendAppointmentWork,
  getAppointmentDetail,
  listAppointments,
  rescheduleAppointment,
  startAppointmentWork,
  updateAppointment
} from "./appointments.service";

const appointmentIdSchema = z.object({
  id: z.string().uuid()
});

const createAppointmentSchema = z.object({
  customerId: z.string().uuid(),
  staffId: z.string().uuid(),
  serviceId: z.string().uuid(),
  serviceIds: z.array(z.string().uuid()).optional(),
  startTime: z.string().datetime({ offset: true }),
  source: z.nativeEnum(AppointmentSource).optional(),
  notes: z.string().max(1000).optional(),
  status: z.nativeEnum(AppointmentStatus).optional()
});

const updateAppointmentSchema = z.object({
  customerId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  serviceIds: z.array(z.string().uuid()).optional(),
  startTime: z.string().datetime({ offset: true }).optional(),
  source: z.nativeEnum(AppointmentSource).optional(),
  notes: z.string().max(1000).nullable().optional(),
  status: z.nativeEnum(AppointmentStatus).optional()
});

const cancelAppointmentSchema = z.object({
  reason: z.string().max(500).optional()
});

const rescheduleSchema = z.object({
  staffId: z.string().uuid().optional(),
  startTime: z.string().datetime({ offset: true })
});

const extendWorkSchema = z.object({
  minutes: z.coerce.number().int().positive().max(180)
});

const doneWorkSchema = z.object({
  confirm: z.boolean()
});

const listAppointmentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  staffId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  status: z.nativeEnum(AppointmentStatus).optional(),
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional()
});

export const appointmentsRouter = Router();

const staffEditableStatuses: AppointmentStatus[] = [
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.CANCELED,
  AppointmentStatus.NO_SHOW
];

const assertStaffOwnsAppointment = async (
  salonId: string,
  appointmentId: string,
  staffId: string | null
) => {
  if (!staffId) {
    throw new AppError("Staff profile is required.", 403, "FORBIDDEN");
  }
  const appointment = await getAppointmentDetail(salonId, appointmentId);
  if (appointment.staffId !== staffId) {
    throw new AppError("Forbidden appointment access.", 403, "FORBIDDEN");
  }
  return appointment;
};

appointmentsRouter.get(
  "/",
  validate(listAppointmentsQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const payload = req.query as unknown as z.infer<typeof listAppointmentsQuerySchema>;
    const restrictedStaffId = req.auth!.role === Role.STAFF ? req.auth!.staffId ?? undefined : undefined;
    const result = await listAppointments(req.auth!.salonId!, {
      page: payload.page,
      limit: payload.limit,
      staffId: restrictedStaffId ?? payload.staffId,
      customerId: req.auth!.role === Role.STAFF ? undefined : payload.customerId,
      status: payload.status,
      dateFrom: payload.dateFrom ? new Date(payload.dateFrom) : undefined,
      dateTo: payload.dateTo ? new Date(payload.dateTo) : undefined
    });
    return sendSuccess(res, {
      data: result
    });
  })
);

appointmentsRouter.post(
  "/",
  requireRoles(Role.SALON_OWNER),
  validate(createAppointmentSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof createAppointmentSchema>;
    const appointment = await createAppointment(req.auth!.salonId!, req.auth!.userId, {
      customerId: payload.customerId,
      staffId: payload.staffId,
      serviceId: payload.serviceId,
      serviceIds: payload.serviceIds,
      startTime: new Date(payload.startTime),
      source: payload.source,
      notes: payload.notes,
      status: payload.status
    });
    return sendSuccess(res, {
      statusCode: 201,
      message: "Appointment created.",
      data: appointment
    });
  })
);

appointmentsRouter.post(
  "/from-ai",
  requireRoles(Role.SALON_OWNER),
  validate(createAppointmentSchema.omit({ source: true })),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof createAppointmentSchema>;
    const appointment = await createAppointmentFromAI(req.auth!.salonId!, req.auth!.userId, {
      customerId: payload.customerId,
      staffId: payload.staffId,
      serviceId: payload.serviceId,
      serviceIds: payload.serviceIds,
      startTime: new Date(payload.startTime),
      notes: payload.notes,
      status: payload.status
    });
    return sendSuccess(res, {
      statusCode: 201,
      message: "AI appointment created.",
      data: appointment
    });
  })
);

appointmentsRouter.get(
  "/:id",
  validate(appointmentIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof appointmentIdSchema>;
    if (req.auth!.role === Role.STAFF) {
      await assertStaffOwnsAppointment(req.auth!.salonId!, id, req.auth!.staffId);
    }
    const appointment = await getAppointmentDetail(req.auth!.salonId!, id);
    return sendSuccess(res, {
      data: appointment
    });
  })
);

appointmentsRouter.patch(
  "/:id",
  validate(appointmentIdSchema, "params"),
  validate(updateAppointmentSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof appointmentIdSchema>;
    const payload = req.body as z.infer<typeof updateAppointmentSchema>;

    if (req.auth!.role === Role.STAFF) {
      await assertStaffOwnsAppointment(req.auth!.salonId!, id, req.auth!.staffId);

      if (
        payload.customerId !== undefined ||
        payload.staffId !== undefined ||
        payload.serviceId !== undefined ||
        payload.serviceIds !== undefined ||
        payload.startTime !== undefined ||
        payload.source !== undefined
      ) {
        throw new AppError(
          "Staff can only update status or notes on assigned appointments.",
          403,
          "FORBIDDEN"
        );
      }

      if (payload.status && !staffEditableStatuses.includes(payload.status)) {
        throw new AppError("Appointment status is not allowed for staff.", 403, "FORBIDDEN");
      }
    }

    const appointment = await updateAppointment(req.auth!.salonId!, id, req.auth!.userId, {
      customerId: req.auth!.role === Role.SALON_OWNER ? payload.customerId : undefined,
      staffId: req.auth!.role === Role.SALON_OWNER ? payload.staffId : undefined,
      serviceId: req.auth!.role === Role.SALON_OWNER ? payload.serviceId : undefined,
      serviceIds: req.auth!.role === Role.SALON_OWNER ? payload.serviceIds : undefined,
      startTime:
        req.auth!.role === Role.SALON_OWNER && payload.startTime
          ? new Date(payload.startTime)
          : undefined,
      source: req.auth!.role === Role.SALON_OWNER ? payload.source : undefined,
      notes: payload.notes,
      status: payload.status
    });
    return sendSuccess(res, {
      message: "Appointment updated.",
      data: appointment
    });
  })
);

appointmentsRouter.post(
  "/:id/start",
  validate(appointmentIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof appointmentIdSchema>;
    const appointment = await startAppointmentWork(
      req.auth!.salonId!,
      id,
      req.auth!.userId,
      req.auth!.role === Role.STAFF ? req.auth!.staffId : undefined
    );
    return sendSuccess(res, {
      message: "Work started.",
      data: appointment
    });
  })
);

appointmentsRouter.post(
  "/:id/extend",
  validate(appointmentIdSchema, "params"),
  validate(extendWorkSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof appointmentIdSchema>;
    const payload = req.body as z.infer<typeof extendWorkSchema>;
    const appointment = await extendAppointmentWork(
      req.auth!.salonId!,
      id,
      req.auth!.userId,
      payload.minutes,
      req.auth!.role === Role.STAFF ? req.auth!.staffId : undefined
    );
    return sendSuccess(res, {
      message: "Work time extended.",
      data: appointment
    });
  })
);

appointmentsRouter.post(
  "/:id/done",
  validate(appointmentIdSchema, "params"),
  validate(doneWorkSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof appointmentIdSchema>;
    const payload = req.body as z.infer<typeof doneWorkSchema>;
    const result = await completeAppointmentWork(
      req.auth!.salonId!,
      id,
      req.auth!.userId,
      payload.confirm,
      req.auth!.role === Role.STAFF ? req.auth!.staffId : undefined
    );
    return sendSuccess(res, {
      message: "Work completed.",
      data: result
    });
  })
);

appointmentsRouter.patch(
  "/:id/cancel",
  validate(appointmentIdSchema, "params"),
  validate(cancelAppointmentSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof appointmentIdSchema>;
    const payload = req.body as z.infer<typeof cancelAppointmentSchema>;
    if (req.auth!.role === Role.STAFF) {
      await assertStaffOwnsAppointment(req.auth!.salonId!, id, req.auth!.staffId);
    }
    const appointment = await cancelAppointment(req.auth!.salonId!, id, req.auth!.userId, payload.reason);
    return sendSuccess(res, {
      message: "Appointment canceled.",
      data: appointment
    });
  })
);

appointmentsRouter.patch(
  "/:id/reschedule",
  requireRoles(Role.SALON_OWNER),
  validate(appointmentIdSchema, "params"),
  validate(rescheduleSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof appointmentIdSchema>;
    const payload = req.body as z.infer<typeof rescheduleSchema>;
    const appointment = await rescheduleAppointment(req.auth!.salonId!, id, req.auth!.userId, {
      staffId: payload.staffId,
      startTime: new Date(payload.startTime)
    });
    return sendSuccess(res, {
      message: "Appointment rescheduled.",
      data: appointment
    });
  })
);
