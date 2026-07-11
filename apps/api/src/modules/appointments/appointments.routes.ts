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
  parseAppointmentStartTime,
  permanentlyDeleteAppointment,
  rescheduleAppointment,
  startAppointmentWork,
  summarizeAppointments,
  toOwnerAppointmentResponse,
  updateAppointment
} from "./appointments.service";

const appointmentIdSchema = z.object({
  id: z.string().uuid()
});

const appointmentStartTimeSchema = {
  startTime: z.string().datetime({ offset: true }).optional(),
  startTimeLocal: z.string().min(1).max(16).optional()
};

const createAppointmentObjectSchema = z.object({
  customerId: z.string().uuid(),
  staffId: z.string().uuid(),
  serviceId: z.string().uuid(),
  serviceIds: z.array(z.string().uuid()).optional(),
  ...appointmentStartTimeSchema,
  source: z.nativeEnum(AppointmentSource).optional(),
  notes: z.string().max(1000).optional(),
  status: z.nativeEnum(AppointmentStatus).optional()
});

const requireAppointmentStartTime = (payload: {
  startTime?: string;
  startTimeLocal?: string;
}) => payload.startTime !== undefined || payload.startTimeLocal !== undefined;

const createAppointmentSchema = createAppointmentObjectSchema.refine(requireAppointmentStartTime, {
  message: "Appointment start time is required."
});

const createAiAppointmentSchema = createAppointmentObjectSchema
  .omit({ source: true })
  .refine(requireAppointmentStartTime, {
    message: "Appointment start time is required."
  });

const updateAppointmentSchema = z.object({
  customerId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  serviceIds: z.array(z.string().uuid()).optional(),
  ...appointmentStartTimeSchema,
  source: z.nativeEnum(AppointmentSource).optional(),
  notes: z.string().max(1000).nullable().optional(),
  status: z.nativeEnum(AppointmentStatus).optional()
});

const cancelAppointmentSchema = z.object({
  reason: z.string().max(500).optional()
});

const rescheduleSchema = z
  .object({
    staffId: z.string().uuid().optional(),
    ...appointmentStartTimeSchema
  })
  .refine((payload) => payload.startTime !== undefined || payload.startTimeLocal !== undefined, {
    message: "Appointment start time is required."
  });

const extendWorkSchema = z.object({
  minutes: z.coerce.number().int().positive().max(180)
});

const doneWorkSchema = z.object({
  confirm: z.boolean()
});

const listAppointmentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  staffId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  status: z.nativeEnum(AppointmentStatus).optional(),
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional()
});

type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;

export const buildListAppointmentsInput = (
  payload: ListAppointmentsQuery,
  auth: {
    role: Role;
    staffId?: string | null;
  }
) => {
  const hasClientFilters =
    payload.staffId !== undefined ||
    payload.customerId !== undefined ||
    payload.status !== undefined ||
    payload.dateFrom !== undefined ||
    payload.dateTo !== undefined;
  const hasClientPagination =
    payload.page !== undefined ||
    payload.limit !== undefined;
  const shouldPaginate = hasClientFilters || hasClientPagination;

  return {
    ...(shouldPaginate
      ? {
          page: payload.page ?? 1,
          limit: payload.limit ?? 20
        }
      : {}),
    staffId: auth.role === Role.STAFF ? auth.staffId ?? undefined : payload.staffId,
    customerId: auth.role === Role.STAFF ? undefined : payload.customerId,
    status: payload.status,
    dateFrom: payload.dateFrom ? new Date(payload.dateFrom) : undefined,
    dateTo: payload.dateTo ? new Date(payload.dateTo) : undefined
  };
};

const appointmentSummaryQuerySchema = z.object({
  staffId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional()
});

export const appointmentsRouter = Router();

const staffEditableStatuses: AppointmentStatus[] = [
  AppointmentStatus.CONFIRMED,
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
    const result = await listAppointments(
      req.auth!.salonId!,
      buildListAppointmentsInput(payload, {
        role: req.auth!.role,
        staffId: req.auth!.staffId
      })
    );
    return sendSuccess(res, {
      data: {
        ...result,
        items: result.items.map(toOwnerAppointmentResponse)
      }
    });
  })
);

appointmentsRouter.get(
  "/summary",
  validate(appointmentSummaryQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const payload = req.query as unknown as z.infer<typeof appointmentSummaryQuerySchema>;
    const restrictedStaffId = req.auth!.role === Role.STAFF ? req.auth!.staffId ?? undefined : undefined;
    const summary = await summarizeAppointments(req.auth!.salonId!, {
      staffId: restrictedStaffId ?? payload.staffId,
      customerId: req.auth!.role === Role.STAFF ? undefined : payload.customerId,
      dateFrom: payload.dateFrom ? new Date(payload.dateFrom) : undefined,
      dateTo: payload.dateTo ? new Date(payload.dateTo) : undefined
    });
    return sendSuccess(res, {
      data: summary
    });
  })
);

appointmentsRouter.post(
  "/",
  requireRoles(Role.SALON_OWNER),
  validate(createAppointmentSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof createAppointmentSchema>;
    const startTime = await parseAppointmentStartTime(req.auth!.salonId!, payload);
    const appointment = await createAppointment(req.auth!.salonId!, req.auth!.userId, {
      customerId: payload.customerId,
      staffId: payload.staffId,
      serviceId: payload.serviceId,
      serviceIds: payload.serviceIds,
      startTime,
      notes: payload.notes,
      status: payload.status
    });
    return sendSuccess(res, {
      statusCode: 201,
      message: "Appointment created.",
      data: toOwnerAppointmentResponse(appointment)
    });
  })
);

appointmentsRouter.post(
  "/from-ai",
  requireRoles(Role.SALON_OWNER),
  validate(createAiAppointmentSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof createAppointmentSchema>;
    const startTime = await parseAppointmentStartTime(req.auth!.salonId!, payload);
    const appointment = await createAppointmentFromAI(req.auth!.salonId!, req.auth!.userId, {
      customerId: payload.customerId,
      staffId: payload.staffId,
      serviceId: payload.serviceId,
      serviceIds: payload.serviceIds,
      startTime,
      notes: payload.notes,
      status: payload.status
    });
    return sendSuccess(res, {
      statusCode: 201,
      message: "AI appointment created.",
      data: toOwnerAppointmentResponse(appointment)
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
      data: toOwnerAppointmentResponse(appointment)
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
        payload.startTimeLocal !== undefined ||
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

    const startTime =
      req.auth!.role === Role.SALON_OWNER &&
      (payload.startTime !== undefined || payload.startTimeLocal !== undefined)
        ? await parseAppointmentStartTime(req.auth!.salonId!, payload)
        : undefined;
    const appointment = await updateAppointment(req.auth!.salonId!, id, req.auth!.userId, {
      customerId: req.auth!.role === Role.SALON_OWNER ? payload.customerId : undefined,
      staffId: req.auth!.role === Role.SALON_OWNER ? payload.staffId : undefined,
      serviceId: req.auth!.role === Role.SALON_OWNER ? payload.serviceId : undefined,
      serviceIds: req.auth!.role === Role.SALON_OWNER ? payload.serviceIds : undefined,
      startTime,
      notes: payload.notes,
      status: payload.status
    });
    return sendSuccess(res, {
      message: "Appointment updated.",
      data: toOwnerAppointmentResponse(appointment)
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
      data: toOwnerAppointmentResponse(appointment)
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
      data: toOwnerAppointmentResponse(appointment)
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
      data: {
        ...result,
        appointment: toOwnerAppointmentResponse(result.appointment)
      }
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
      data: toOwnerAppointmentResponse(appointment)
    });
  })
);

appointmentsRouter.delete(
  "/:id",
  requireRoles(Role.SALON_OWNER),
  validate(appointmentIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof appointmentIdSchema>;
    const result = await permanentlyDeleteAppointment(req.auth!.salonId!, id, req.auth!.userId);
    return sendSuccess(res, {
      message: "Appointment permanently deleted.",
      data: result
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
    const startTime = await parseAppointmentStartTime(req.auth!.salonId!, payload);
    const appointment = await rescheduleAppointment(req.auth!.salonId!, id, req.auth!.userId, {
      staffId: payload.staffId,
      startTime
    });
    return sendSuccess(res, {
      message: "Appointment rescheduled.",
      data: toOwnerAppointmentResponse(appointment)
    });
  })
);
