import { Router } from "express";
import { AppointmentStatus } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler";
import { validate } from "../../middleware/validate";
import { sendSuccess } from "../../utils/response";
import { isValidUsPhone } from "../../utils/phone";
import {
  cancelAssignedSalonAppointment,
  createAssignedSalonAppointment,
  createAssignedSalonCustomer,
  getAssignedSalonDetail,
  listAssignedSalonAppointments,
  listAssignedSalonCustomers,
  listAssignedSalonServices,
  listAssignedSalons,
  listAssignedSalonStaff,
  rescheduleAssignedSalonAppointment,
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

export const callCenterRouter = Router();

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
