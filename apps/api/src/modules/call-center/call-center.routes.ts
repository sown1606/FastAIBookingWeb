import { Router } from "express";
import { AppointmentStatus, CallEscalationStatus } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler";
import { validate } from "../../middleware/validate";
import { sendSuccess } from "../../utils/response";
import { isValidUsPhone } from "../../utils/phone";
import {
  cancelAssignedSalonAppointment,
  captureVoicemailForEscalation,
  completeEscalation,
  createCallbackRequestForEscalation,
  createAssignedSalonAppointment,
  createAssignedSalonCustomer,
  getCallCenterRuntime,
  getAssignedSalonDetail,
  getEscalationDetail,
  listEscalationQueue,
  listAssignedSalonAppointments,
  listAssignedSalonCustomers,
  listAssignedSalonServices,
  listAssignedSalons,
  listAssignedSalonStaff,
  rescheduleAssignedSalonAppointment,
  sendSmsFallbackForEscalation,
  acceptEscalation,
  updateEscalation,
  updateAssignedSalonAppointment
} from "./call-center.service";

const salonIdSchema = z.object({
  salonId: z.string().uuid()
});

const salonAppointmentSchema = z.object({
  salonId: z.string().uuid(),
  id: z.string().uuid()
});

const usPhoneSchema = z
  .string()
  .min(10)
  .max(25)
  .refine((value) => isValidUsPhone(value), "Phone must be a valid US phone number.");

const createCustomerSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  email: z.string().email().optional(),
  phone: usPhoneSchema,
  notes: z.string().max(1000).optional()
});

const listCustomerQuerySchema = z.object({
  q: z.string().max(120).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50)
});

const createAppointmentSchema = z.object({
  customerId: z.string().uuid(),
  staffId: z.string().uuid(),
  serviceId: z.string().uuid(),
  serviceIds: z.array(z.string().uuid()).optional(),
  startTime: z.string().datetime({ offset: true }),
  notes: z.string().max(1000).optional(),
  status: z.nativeEnum(AppointmentStatus).optional()
});

const updateAppointmentSchema = z.object({
  customerId: z.string().uuid().optional(),
  staffId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  serviceIds: z.array(z.string().uuid()).optional(),
  startTime: z.string().datetime({ offset: true }).optional(),
  notes: z.string().max(1000).nullable().optional(),
  status: z.nativeEnum(AppointmentStatus).optional()
});

const listAppointmentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  staffId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  status: z.nativeEnum(AppointmentStatus).optional(),
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional()
});

const rescheduleSchema = z.object({
  staffId: z.string().uuid().optional(),
  startTime: z.string().datetime({ offset: true })
});

const cancelSchema = z.object({
  reason: z.string().max(500).optional()
});

const listQueueQuerySchema = z.object({
  status: z.nativeEnum(CallEscalationStatus).optional(),
  limit: z.coerce.number().int().positive().max(100).default(50)
});

const escalationIdSchema = z.object({
  id: z.string().uuid()
});

const acceptEscalationSchema = z.object({
  amazonConnectContactId: z.string().max(160).optional()
});

const updateEscalationSchema = z.object({
  operatorNotes: z.string().max(4000).nullable().optional(),
  qaNotes: z.string().max(4000).nullable().optional(),
  resolution: z.string().max(4000).nullable().optional()
});

const completeEscalationSchema = z.object({
  resolution: z.string().min(1).max(4000),
  operatorNotes: z.string().max(4000).nullable().optional(),
  qaNotes: z.string().max(4000).nullable().optional()
});

const callbackRequestSchema = z.object({
  callbackPhone: usPhoneSchema.nullable().optional(),
  notes: z.string().max(4000).nullable().optional()
});

const voicemailSchema = z.object({
  voicemailRecordingUrl: z.string().url().nullable().optional(),
  notes: z.string().max(4000).nullable().optional()
});

const smsFallbackSchema = z.object({
  recipientPhone: usPhoneSchema.nullable().optional(),
  message: z.string().min(1).max(1000)
});

export const callCenterRouter = Router();

callCenterRouter.get(
  "/runtime",
  asyncHandler(async (req, res) => {
    const runtime = await getCallCenterRuntime(req.auth!.userId);
    return sendSuccess(res, {
      data: runtime
    });
  })
);

callCenterRouter.get(
  "/queue",
  validate(listQueueQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listQueueQuerySchema>;
    const queue = await listEscalationQueue(req.auth!.userId, query);
    return sendSuccess(res, {
      data: queue
    });
  })
);

callCenterRouter.get(
  "/queue/:id",
  validate(escalationIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof escalationIdSchema>;
    const escalation = await getEscalationDetail(req.auth!.userId, id);
    return sendSuccess(res, {
      data: escalation
    });
  })
);

callCenterRouter.post(
  "/queue/:id/accept",
  validate(escalationIdSchema, "params"),
  validate(acceptEscalationSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof escalationIdSchema>;
    const payload = req.body as z.infer<typeof acceptEscalationSchema>;
    const escalation = await acceptEscalation(req.auth!.userId, id, payload);
    return sendSuccess(res, {
      message: "Escalation accepted.",
      data: escalation
    });
  })
);

callCenterRouter.patch(
  "/queue/:id",
  validate(escalationIdSchema, "params"),
  validate(updateEscalationSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof escalationIdSchema>;
    const payload = req.body as z.infer<typeof updateEscalationSchema>;
    const escalation = await updateEscalation(req.auth!.userId, id, payload);
    return sendSuccess(res, {
      message: "Escalation updated.",
      data: escalation
    });
  })
);

callCenterRouter.post(
  "/queue/:id/complete",
  validate(escalationIdSchema, "params"),
  validate(completeEscalationSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof escalationIdSchema>;
    const payload = req.body as z.infer<typeof completeEscalationSchema>;
    const escalation = await completeEscalation(req.auth!.userId, id, payload);
    return sendSuccess(res, {
      message: "Escalation completed.",
      data: escalation
    });
  })
);

callCenterRouter.post(
  "/queue/:id/callback-request",
  validate(escalationIdSchema, "params"),
  validate(callbackRequestSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof escalationIdSchema>;
    const payload = req.body as z.infer<typeof callbackRequestSchema>;
    const escalation = await createCallbackRequestForEscalation(req.auth!.userId, id, payload);
    return sendSuccess(res, {
      message: "Callback request created.",
      data: escalation
    });
  })
);

callCenterRouter.post(
  "/queue/:id/voicemail",
  validate(escalationIdSchema, "params"),
  validate(voicemailSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof escalationIdSchema>;
    const payload = req.body as z.infer<typeof voicemailSchema>;
    const escalation = await captureVoicemailForEscalation(req.auth!.userId, id, payload);
    return sendSuccess(res, {
      message: "Voicemail captured.",
      data: escalation
    });
  })
);

callCenterRouter.post(
  "/queue/:id/sms-fallback",
  validate(escalationIdSchema, "params"),
  validate(smsFallbackSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof escalationIdSchema>;
    const payload = req.body as z.infer<typeof smsFallbackSchema>;
    const escalation = await sendSmsFallbackForEscalation(req.auth!.userId, id, payload);
    return sendSuccess(res, {
      message: "SMS fallback sent.",
      data: escalation
    });
  })
);

callCenterRouter.get(
  "/salons",
  asyncHandler(async (req, res) => {
    const salons = await listAssignedSalons(req.auth!.userId);
    return sendSuccess(res, {
      data: salons
    });
  })
);

callCenterRouter.get(
  "/salons/:salonId",
  validate(salonIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const salon = await getAssignedSalonDetail(req.auth!.userId, salonId);
    return sendSuccess(res, {
      data: salon
    });
  })
);

callCenterRouter.get(
  "/salons/:salonId/staff",
  validate(salonIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const staff = await listAssignedSalonStaff(req.auth!.userId, salonId);
    return sendSuccess(res, {
      data: staff
    });
  })
);

callCenterRouter.get(
  "/salons/:salonId/services",
  validate(salonIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const services = await listAssignedSalonServices(req.auth!.userId, salonId);
    return sendSuccess(res, {
      data: services
    });
  })
);

callCenterRouter.get(
  "/salons/:salonId/customers",
  validate(salonIdSchema, "params"),
  validate(listCustomerQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const payload = req.query as unknown as z.infer<typeof listCustomerQuerySchema>;
    const customers = await listAssignedSalonCustomers(req.auth!.userId, salonId, payload);
    return sendSuccess(res, {
      data: customers
    });
  })
);

callCenterRouter.post(
  "/salons/:salonId/customers",
  validate(salonIdSchema, "params"),
  validate(createCustomerSchema),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const payload = req.body as z.infer<typeof createCustomerSchema>;
    const customer = await createAssignedSalonCustomer(req.auth!.userId, salonId, payload);
    return sendSuccess(res, {
      statusCode: 201,
      message: "Customer created.",
      data: customer
    });
  })
);

callCenterRouter.get(
  "/salons/:salonId/appointments",
  validate(salonIdSchema, "params"),
  validate(listAppointmentsQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const payload = req.query as unknown as z.infer<typeof listAppointmentsQuerySchema>;
    const appointments = await listAssignedSalonAppointments(req.auth!.userId, salonId, {
      page: payload.page,
      limit: payload.limit,
      staffId: payload.staffId,
      customerId: payload.customerId,
      status: payload.status,
      dateFrom: payload.dateFrom ? new Date(payload.dateFrom) : undefined,
      dateTo: payload.dateTo ? new Date(payload.dateTo) : undefined
    });
    return sendSuccess(res, {
      data: appointments
    });
  })
);

callCenterRouter.post(
  "/salons/:salonId/appointments",
  validate(salonIdSchema, "params"),
  validate(createAppointmentSchema),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const payload = req.body as z.infer<typeof createAppointmentSchema>;
    const appointment = await createAssignedSalonAppointment(req.auth!.userId, salonId, {
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
      message: "Appointment created.",
      data: appointment
    });
  })
);

callCenterRouter.patch(
  "/salons/:salonId/appointments/:id",
  validate(salonAppointmentSchema, "params"),
  validate(updateAppointmentSchema),
  asyncHandler(async (req, res) => {
    const { salonId, id } = req.params as z.infer<typeof salonAppointmentSchema>;
    const payload = req.body as z.infer<typeof updateAppointmentSchema>;
    const appointment = await updateAssignedSalonAppointment(req.auth!.userId, salonId, id, {
      customerId: payload.customerId,
      staffId: payload.staffId,
      serviceId: payload.serviceId,
      serviceIds: payload.serviceIds,
      startTime: payload.startTime ? new Date(payload.startTime) : undefined,
      notes: payload.notes,
      status: payload.status
    });
    return sendSuccess(res, {
      message: "Appointment updated.",
      data: appointment
    });
  })
);

callCenterRouter.patch(
  "/salons/:salonId/appointments/:id/reschedule",
  validate(salonAppointmentSchema, "params"),
  validate(rescheduleSchema),
  asyncHandler(async (req, res) => {
    const { salonId, id } = req.params as z.infer<typeof salonAppointmentSchema>;
    const payload = req.body as z.infer<typeof rescheduleSchema>;
    const appointment = await rescheduleAssignedSalonAppointment(req.auth!.userId, salonId, id, {
      staffId: payload.staffId,
      startTime: new Date(payload.startTime)
    });
    return sendSuccess(res, {
      message: "Appointment rescheduled.",
      data: appointment
    });
  })
);

callCenterRouter.patch(
  "/salons/:salonId/appointments/:id/cancel",
  validate(salonAppointmentSchema, "params"),
  validate(cancelSchema),
  asyncHandler(async (req, res) => {
    const { salonId, id } = req.params as z.infer<typeof salonAppointmentSchema>;
    const payload = req.body as z.infer<typeof cancelSchema>;
    const appointment = await cancelAssignedSalonAppointment(req.auth!.userId, salonId, id, payload.reason);
    return sendSuccess(res, {
      message: "Appointment canceled.",
      data: appointment
    });
  })
);
