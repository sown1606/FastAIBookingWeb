import { Router } from "express";
import {
  AppointmentSource,
  AppointmentStatus,
  CallSessionStatus,
  ExternalProvider,
  Role,
  SalonStatus,
  SubscriptionStatus
} from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler";
import { authenticate, requireRoles } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { isValidUsPhone } from "../../utils/phone";
import { sendSuccess } from "../../utils/response";
import {
  getAiReceptionConfigForSalon,
  listAiReceptionCallLogsForSalon
} from "../ai-reception/ai-reception.service";
import {
  exportAIInteractionsForAdmin,
  getAIInteractionCallDebugForAdmin,
  getAIInteractionByIdForAdmin,
  listAIInteractionsForAdmin
} from "../ai/ai.service";
import {
  cancelAppointment,
  createAppointment,
  getAppointmentDetail,
  listAppointments,
  rescheduleAppointment,
  updateAppointment
} from "../appointments/appointments.service";
import { loginWithEmailPassword } from "../auth/auth.service";
import {
  getBillingUsageHistoryForSalon,
  getCurrentBillingUsageForSalon
} from "../billing/billing.service";
import { getBusinessHours, updateBusinessHours } from "../business-hours/business-hours.service";
import { getCallByIdForAdmin, listCallsForAdmin } from "../calls/calls.service";
import {
  createCustomer,
  getCustomerAppointmentHistory,
  getCustomerDetail,
  searchCustomers
} from "../customers/customers.service";
import {
  createService,
  listServices,
  setServiceActiveState,
  setServiceStaffMapping,
  updateService
} from "../services/services.service";
import {
  createStaff,
  deactivateStaff,
  listStaff,
  reactivateStaff,
  resetStaffAccess,
  updateStaff
} from "../staff/staff.service";
import {
  createSalonForAdmin,
  createCallCenterAgentForAdmin,
  getAdminOverviewMetrics,
  getOwnerDetailForAdmin,
  getSalonDeletePreviewForAdmin,
  getSalonDetailForAdmin,
  listCallCenterAgentsForAdmin,
  listSalonCallCenterAssignmentsForAdmin,
  listSalonIntegrationsForAdmin,
  listSalonsForAdmin,
  permanentlyDeleteSalonForAdmin,
  replaceSalonCallCenterAssignmentsForAdmin,
  replaceSalonIntegrationsForAdmin,
  setSalonStatusForAdmin,
  updateSalonForAdmin,
  updateSalonSettingsForAdmin
} from "./admin.service";
import {
  buildDebugExportDownloadFilename,
  getAIInteractionsDebugExportForAdmin,
  getCallsDebugExportForAdmin
} from "./admin-debug-export.service";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128)
});

const salonListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.nativeEnum(SalonStatus).optional(),
  subscriptionStatus: z.nativeEnum(SubscriptionStatus).optional()
});

const idSchema = z.object({
  id: z.string().uuid()
});

const salonIdSchema = z.object({
  salonId: z.string().uuid()
});

const salonAndIdSchema = z.object({
  salonId: z.string().uuid(),
  id: z.string().uuid()
});

const usPhoneSchema = z
  .string()
  .min(10)
  .max(25)
  .refine((value) => isValidUsPhone(value), "Phone must be a valid US phone number.");

const optionalUsPhoneSchema = usPhoneSchema.nullable().optional();

const createSalonSchema = z
  .object({
    name: z.string().min(2).max(160),
    contactEmail: z.string().email().optional(),
    contactPhone: usPhoneSchema.optional(),
    originalPhoneNumber: usPhoneSchema.optional(),
    customerIncomingPhoneNumber: usPhoneSchema.optional(),
    notificationPhoneNumber: usPhoneSchema.optional(),
    timezone: z.string().min(2).max(64),
    status: z.nativeEnum(SalonStatus).optional(),
    subscriptionStatus: z.nativeEnum(SubscriptionStatus).optional(),
    addressLine1: z.string().max(200).optional(),
    addressLine2: z.string().max(200).optional(),
    city: z.string().max(120).optional(),
    state: z.string().max(120).optional(),
    postalCode: z.string().max(20).optional(),
    country: z.string().max(2).optional(),
    ownerUserId: z.string().uuid().optional(),
    owner: z
      .object({
        fullName: z.string().min(2).max(120),
        email: z.string().email(),
        phone: usPhoneSchema.optional(),
        password: z.string().min(8).max(128)
      })
      .optional()
  })
  .superRefine((value, ctx) => {
    if (!value.ownerUserId && !value.owner) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either ownerUserId or owner object is required."
      });
    }
  });

const updateSalonSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  contactEmail: z.string().email().nullable().optional(),
  contactPhone: optionalUsPhoneSchema,
  originalPhoneNumber: optionalUsPhoneSchema,
  customerIncomingPhoneNumber: optionalUsPhoneSchema,
  notificationPhoneNumber: optionalUsPhoneSchema,
  timezone: z.string().min(2).max(64).optional(),
  status: z.nativeEnum(SalonStatus).optional(),
  subscriptionStatus: z.nativeEnum(SubscriptionStatus).optional(),
  addressLine1: z.string().max(200).nullable().optional(),
  addressLine2: z.string().max(200).nullable().optional(),
  city: z.string().max(120).nullable().optional(),
  state: z.string().max(120).nullable().optional(),
  postalCode: z.string().max(20).nullable().optional(),
  country: z.string().max(2).optional()
});

const salonSettingsSchema = z.object({
  currency: z.string().min(3).max(3).optional(),
  locale: z.string().min(2).max(16).optional(),
  bookingLeadTimeMinutes: z.coerce.number().int().nonnegative().optional(),
  cancellationPolicy: z.string().max(1000).nullable().optional(),
  aiReceptionEnabled: z.boolean().optional(),
  aiForwardingEnabled: z.boolean().optional(),
  aiTransferRingCount: z.coerce.number().int().min(1).max(10).optional(),
  callCenterEnabled: z.boolean().optional(),
  voicemailEnabled: z.boolean().optional(),
  callbackRequestEnabled: z.boolean().optional(),
  smsFallbackEnabled: z.boolean().optional(),
  aiGreetingPrompt: z.string().max(2000).nullable().optional(),
  callerLanguage: z.string().min(2).max(16).optional(),
  callLogVisibility: z.enum(["OWNER_ONLY", "OWNER_AND_STAFF", "OWNER_STAFF_OPERATOR"]).optional(),
  notificationRecipients: z.array(z.string().min(3).max(160)).max(20).optional(),
  callCenterRoutingNumber: optionalUsPhoneSchema,
  callCenterRoutingNote: z.string().max(1000).nullable().optional()
});

const salonStatusSchema = z.object({
  status: z.nativeEnum(SalonStatus)
});

const deleteSalonSchema = z.object({
  confirmPermanentDelete: z.literal(true),
  confirmationName: z.string().min(1).max(160)
});

const integrationConfigSchema = z.object({
  provider: z.nativeEnum(ExternalProvider),
  configKey: z.string().min(1).max(120),
  configValue: z.string().min(1).max(400),
  metadata: z.unknown().optional(),
  isActive: z.boolean().optional()
});

const replaceIntegrationsSchema = z.object({
  items: z.array(integrationConfigSchema).default([])
});

const staffQuerySchema = z.object({
  includeInactive: z
    .string()
    .optional()
    .transform((value) => value === "true")
});

const createStaffSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  phone: usPhoneSchema,
  title: z.string().max(120).optional(),
  isBookable: z.boolean().optional(),
  createLogin: z.boolean().optional(),
  password: z.string().min(8).max(128).optional()
});

const updateStaffSchema = z.object({
  fullName: z.string().min(2).max(120).optional(),
  email: z.string().email().optional(),
  phone: usPhoneSchema.optional(),
  title: z.string().max(120).nullable().optional(),
  isBookable: z.boolean().optional()
});

const resetStaffAccessSchema = z.object({
  password: z.string().min(8).max(128).optional(),
  newPassword: z.string().min(8).max(128).optional(),
  sendEmail: z.boolean().optional()
});

const servicesQuerySchema = z.object({
  includeInactive: z
    .string()
    .optional()
    .transform((value) => value === "true")
});

const createServiceSchema = z.object({
  name: z.string().min(2).max(160),
  description: z.string().max(500).optional(),
  durationMinutes: z.coerce.number().int().positive().max(600),
  priceCents: z.coerce.number().int().nonnegative(),
  staffIds: z.array(z.string().uuid()).optional()
});

const updateServiceSchema = z.object({
  name: z.string().min(2).max(160).optional(),
  description: z.string().max(500).nullable().optional(),
  durationMinutes: z.coerce.number().int().positive().max(600).optional(),
  priceCents: z.coerce.number().int().nonnegative().optional()
});

const serviceStaffSchema = z.object({
  staffIds: z.array(z.string().uuid()).default([])
});

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
const businessHourSchema = z
  .object({
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    isOpen: z.boolean(),
    openTime: z.string().regex(timeRegex).nullable().optional(),
    closeTime: z.string().regex(timeRegex).nullable().optional()
  })
  .superRefine((value, ctx) => {
    if (!value.isOpen) {
      return;
    }
    if (!value.openTime || !value.closeTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Open days require both openTime and closeTime."
      });
      return;
    }
    if (value.openTime >= value.closeTime) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "closeTime must be later than openTime."
      });
    }
  });

const updateBusinessHoursSchema = z
  .object({
    hours: z.array(businessHourSchema).length(7)
  })
  .superRefine((value, ctx) => {
    const daySet = new Set(value.hours.map((item) => item.dayOfWeek));
    if (daySet.size !== 7) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Hours must include exactly one entry for each dayOfWeek (0-6)."
      });
    }
  });

const createCustomerSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().max(80).optional(),
  email: z.string().email().optional(),
  phone: usPhoneSchema,
  notes: z.string().max(1000).optional()
});

const listCustomerQuerySchema = z.object({
  q: z.string().max(120).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20)
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

const listAppointmentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  staffId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  status: z.nativeEnum(AppointmentStatus).optional(),
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional()
});

const cancelAppointmentSchema = z.object({
  reason: z.string().max(500).optional()
});

const rescheduleSchema = z.object({
  staffId: z.string().uuid().optional(),
  startTime: z.string().datetime({ offset: true })
});

const usageQuerySchema = z.object({
  historyLimit: z.coerce.number().int().positive().max(24).default(6)
});

const adminCallsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.nativeEnum(CallSessionStatus).optional(),
  salonId: z.string().uuid().optional()
});

const adminAiQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  salonId: z.string().uuid().optional(),
  taskType: z.string().max(80).optional(),
  callSessionId: z.string().trim().min(1).max(160).optional(),
  contactId: z.string().trim().min(1).max(160).optional(),
  callerPhone: z.string().trim().min(3).max(40).optional(),
  q: z.string().trim().min(1).max(160).optional(),
  includeSynthetic: z.coerce.boolean().default(false)
});

const adminAiReceptionCallLogsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20)
});

const adminDebugExportSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
  mode: z.enum(["compact", "full"]).default("compact")
});

const createCallCenterAgentSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  phone: usPhoneSchema,
  password: z.string().min(8).max(128).optional()
});

const replaceCallCenterAssignmentsSchema = z.object({
  agentUserIds: z.array(z.string().uuid()).default([])
});

export const adminRouter = Router();

adminRouter.post(
  "/auth/login",
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof loginSchema>;
    const result = await loginWithEmailPassword(payload, Role.PLATFORM_ADMIN);
    return sendSuccess(res, {
      message: "Admin login successful.",
      data: result
    });
  })
);

adminRouter.use(authenticate, requireRoles(Role.PLATFORM_ADMIN));

adminRouter.get(
  "/call-center/agents",
  asyncHandler(async (_req, res) => {
    const agents = await listCallCenterAgentsForAdmin();
    return sendSuccess(res, {
      data: agents
    });
  })
);

adminRouter.post(
  "/call-center/agents",
  validate(createCallCenterAgentSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof createCallCenterAgentSchema>;
    const agent = await createCallCenterAgentForAdmin(req.auth!.userId, payload);
    return sendSuccess(res, {
      statusCode: 201,
      message: "Call center agent created.",
      data: agent
    });
  })
);

adminRouter.get(
  "/salons",
  validate(salonListQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof salonListQuerySchema>;
    const result = await listSalonsForAdmin(query);
    return sendSuccess(res, {
      data: result
    });
  })
);

adminRouter.get(
  "/salons/:salonId/call-center-assignments",
  validate(salonIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const assignments = await listSalonCallCenterAssignmentsForAdmin(salonId);
    return sendSuccess(res, {
      data: assignments
    });
  })
);

adminRouter.put(
  "/salons/:salonId/call-center-assignments",
  validate(salonIdSchema, "params"),
  validate(replaceCallCenterAssignmentsSchema),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const payload = req.body as z.infer<typeof replaceCallCenterAssignmentsSchema>;
    const assignments = await replaceSalonCallCenterAssignmentsForAdmin(
      salonId,
      req.auth!.userId,
      payload.agentUserIds
    );
    return sendSuccess(res, {
      message: "Call center assignments updated.",
      data: assignments
    });
  })
);

adminRouter.post(
  "/salons",
  validate(createSalonSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof createSalonSchema>;
    const salon = await createSalonForAdmin(req.auth!.userId, payload);
    return sendSuccess(res, {
      statusCode: 201,
      message: "Salon created.",
      data: salon
    });
  })
);

adminRouter.get(
  "/salons/:id/delete-preview",
  validate(idSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof idSchema>;
    const preview = await getSalonDeletePreviewForAdmin(id);
    return sendSuccess(res, {
      data: preview
    });
  })
);

adminRouter.delete(
  "/salons/:id",
  validate(idSchema, "params"),
  validate(deleteSalonSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof idSchema>;
    const payload = req.body as z.infer<typeof deleteSalonSchema>;
    const result = await permanentlyDeleteSalonForAdmin(id, req.auth!.userId, payload);
    return sendSuccess(res, {
      message: "Salon permanently deleted.",
      data: result
    });
  })
);

adminRouter.get(
  "/salons/:id",
  validate(idSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof idSchema>;
    const salon = await getSalonDetailForAdmin(id);
    return sendSuccess(res, {
      data: salon
    });
  })
);

adminRouter.patch(
  "/salons/:id",
  validate(idSchema, "params"),
  validate(updateSalonSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof idSchema>;
    const payload = req.body as z.infer<typeof updateSalonSchema>;
    const salon = await updateSalonForAdmin(id, req.auth!.userId, payload);
    return sendSuccess(res, {
      message: "Salon updated.",
      data: salon
    });
  })
);

adminRouter.post(
  "/salons/:id/status",
  validate(idSchema, "params"),
  validate(salonStatusSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof idSchema>;
    const payload = req.body as z.infer<typeof salonStatusSchema>;
    const salon = await setSalonStatusForAdmin(id, req.auth!.userId, payload.status);
    return sendSuccess(res, {
      message: "Salon status updated.",
      data: salon
    });
  })
);

adminRouter.put(
  "/salons/:salonId/settings",
  validate(salonIdSchema, "params"),
  validate(salonSettingsSchema),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const payload = req.body as z.infer<typeof salonSettingsSchema>;
    const settings = await updateSalonSettingsForAdmin(salonId, req.auth!.userId, {
      ...payload,
      aiReceptionEnabled: payload.aiReceptionEnabled ?? payload.aiForwardingEnabled
    });
    return sendSuccess(res, {
      message: "Salon settings updated.",
      data: settings
    });
  })
);

adminRouter.get(
  "/salons/:salonId/ai-reception",
  validate(salonIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const config = await getAiReceptionConfigForSalon(salonId);
    return sendSuccess(res, {
      data: config
    });
  })
);

adminRouter.get(
  "/salons/:salonId/call-logs",
  validate(salonIdSchema, "params"),
  validate(adminAiReceptionCallLogsQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const query = req.query as unknown as z.infer<typeof adminAiReceptionCallLogsQuerySchema>;
    const result = await listAiReceptionCallLogsForSalon(salonId, query);
    return sendSuccess(res, {
      data: result
    });
  })
);

adminRouter.get(
  "/salons/:salonId/integrations",
  validate(salonIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const items = await listSalonIntegrationsForAdmin(salonId);
    return sendSuccess(res, {
      data: items
    });
  })
);

adminRouter.put(
  "/salons/:salonId/integrations",
  validate(salonIdSchema, "params"),
  validate(replaceIntegrationsSchema),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const payload = req.body as z.infer<typeof replaceIntegrationsSchema>;
    const items = await replaceSalonIntegrationsForAdmin(salonId, req.auth!.userId, payload.items);
    return sendSuccess(res, {
      message: "Salon integrations updated.",
      data: items
    });
  })
);

adminRouter.get(
  "/salons/:salonId/staff",
  validate(salonIdSchema, "params"),
  validate(staffQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const { includeInactive } = req.query as unknown as z.infer<typeof staffQuerySchema>;
    const result = await listStaff(salonId, includeInactive);
    return sendSuccess(res, {
      data: result
    });
  })
);

adminRouter.post(
  "/salons/:salonId/staff",
  validate(salonIdSchema, "params"),
  validate(createStaffSchema),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const payload = req.body as z.infer<typeof createStaffSchema>;
    const result = await createStaff(salonId, req.auth!.userId, payload);
    return sendSuccess(res, {
      statusCode: 201,
      message: "Staff created.",
      data: result
    });
  })
);

adminRouter.patch(
  "/salons/:salonId/staff/:id",
  validate(salonAndIdSchema, "params"),
  validate(updateStaffSchema),
  asyncHandler(async (req, res) => {
    const { salonId, id } = req.params as z.infer<typeof salonAndIdSchema>;
    const payload = req.body as z.infer<typeof updateStaffSchema>;
    const staff = await updateStaff(salonId, id, req.auth!.userId, payload);
    return sendSuccess(res, {
      message: "Staff updated.",
      data: staff
    });
  })
);

adminRouter.post(
  "/salons/:salonId/staff/:id/deactivate",
  validate(salonAndIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { salonId, id } = req.params as z.infer<typeof salonAndIdSchema>;
    const result = await deactivateStaff(salonId, id, req.auth!.userId);
    return sendSuccess(res, {
      message: "Staff deactivated.",
      data: result
    });
  })
);

adminRouter.post(
  "/salons/:salonId/staff/:id/reactivate",
  validate(salonAndIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { salonId, id } = req.params as z.infer<typeof salonAndIdSchema>;
    const result = await reactivateStaff(salonId, id, req.auth!.userId);
    return sendSuccess(res, {
      message: "Staff reactivated.",
      data: result
    });
  })
);

adminRouter.post(
  "/salons/:salonId/staff/:id/reset-access",
  validate(salonAndIdSchema, "params"),
  validate(resetStaffAccessSchema),
  asyncHandler(async (req, res) => {
    const { salonId, id } = req.params as z.infer<typeof salonAndIdSchema>;
    const payload = req.body as z.infer<typeof resetStaffAccessSchema>;
    const result = await resetStaffAccess(salonId, id, req.auth!.userId, payload);
    return sendSuccess(res, {
      message: result.emailSent
        ? "Staff password updated and email sent."
        : "Staff password updated, but email was not sent.",
      data: result
    });
  })
);

adminRouter.get(
  "/salons/:salonId/services",
  validate(salonIdSchema, "params"),
  validate(servicesQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const { includeInactive } = req.query as unknown as z.infer<typeof servicesQuerySchema>;
    const services = await listServices(salonId, includeInactive);
    return sendSuccess(res, {
      data: services
    });
  })
);

adminRouter.post(
  "/salons/:salonId/services",
  validate(salonIdSchema, "params"),
  validate(createServiceSchema),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const payload = req.body as z.infer<typeof createServiceSchema>;
    const service = await createService(salonId, req.auth!.userId, payload);
    return sendSuccess(res, {
      statusCode: 201,
      message: "Service created.",
      data: service
    });
  })
);

adminRouter.patch(
  "/salons/:salonId/services/:id",
  validate(salonAndIdSchema, "params"),
  validate(updateServiceSchema),
  asyncHandler(async (req, res) => {
    const { salonId, id } = req.params as z.infer<typeof salonAndIdSchema>;
    const payload = req.body as z.infer<typeof updateServiceSchema>;
    const service = await updateService(salonId, id, req.auth!.userId, payload);
    return sendSuccess(res, {
      message: "Service updated.",
      data: service
    });
  })
);

adminRouter.post(
  "/salons/:salonId/services/:id/deactivate",
  validate(salonAndIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { salonId, id } = req.params as z.infer<typeof salonAndIdSchema>;
    const service = await setServiceActiveState(salonId, id, req.auth!.userId, false);
    return sendSuccess(res, {
      message: "Service deactivated.",
      data: service
    });
  })
);

adminRouter.post(
  "/salons/:salonId/services/:id/activate",
  validate(salonAndIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { salonId, id } = req.params as z.infer<typeof salonAndIdSchema>;
    const service = await setServiceActiveState(salonId, id, req.auth!.userId, true);
    return sendSuccess(res, {
      message: "Service activated.",
      data: service
    });
  })
);

adminRouter.put(
  "/salons/:salonId/services/:id/staff",
  validate(salonAndIdSchema, "params"),
  validate(serviceStaffSchema),
  asyncHandler(async (req, res) => {
    const { salonId, id } = req.params as z.infer<typeof salonAndIdSchema>;
    const payload = req.body as z.infer<typeof serviceStaffSchema>;
    const service = await setServiceStaffMapping(salonId, id, req.auth!.userId, payload.staffIds);
    return sendSuccess(res, {
      message: "Service staff mapping updated.",
      data: service
    });
  })
);

adminRouter.get(
  "/salons/:salonId/business-hours",
  validate(salonIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const hours = await getBusinessHours(salonId);
    return sendSuccess(res, {
      data: hours
    });
  })
);

adminRouter.put(
  "/salons/:salonId/business-hours",
  validate(salonIdSchema, "params"),
  validate(updateBusinessHoursSchema),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const payload = req.body as z.infer<typeof updateBusinessHoursSchema>;
    const hours = await updateBusinessHours(salonId, req.auth!.userId, payload.hours);
    return sendSuccess(res, {
      message: "Business hours updated.",
      data: hours
    });
  })
);

adminRouter.get(
  "/salons/:salonId/customers",
  validate(salonIdSchema, "params"),
  validate(listCustomerQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const payload = req.query as unknown as z.infer<typeof listCustomerQuerySchema>;
    const customers = await searchCustomers(salonId, payload);
    return sendSuccess(res, {
      data: customers
    });
  })
);

adminRouter.post(
  "/salons/:salonId/customers",
  validate(salonIdSchema, "params"),
  validate(createCustomerSchema),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const payload = req.body as z.infer<typeof createCustomerSchema>;
    const customer = await createCustomer(salonId, req.auth!.userId, payload);
    return sendSuccess(res, {
      statusCode: 201,
      message: "Customer created.",
      data: customer
    });
  })
);

adminRouter.get(
  "/salons/:salonId/customers/:id",
  validate(salonAndIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { salonId, id } = req.params as z.infer<typeof salonAndIdSchema>;
    const customer = await getCustomerDetail(salonId, id);
    return sendSuccess(res, {
      data: customer
    });
  })
);

adminRouter.get(
  "/salons/:salonId/customers/:id/appointments",
  validate(salonAndIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { salonId, id } = req.params as z.infer<typeof salonAndIdSchema>;
    const history = await getCustomerAppointmentHistory(salonId, id);
    return sendSuccess(res, {
      data: history
    });
  })
);

adminRouter.get(
  "/salons/:salonId/appointments",
  validate(salonIdSchema, "params"),
  validate(listAppointmentsQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const payload = req.query as unknown as z.infer<typeof listAppointmentsQuerySchema>;
    const appointments = await listAppointments(salonId, {
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

adminRouter.post(
  "/salons/:salonId/appointments",
  validate(salonIdSchema, "params"),
  validate(createAppointmentSchema),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const payload = req.body as z.infer<typeof createAppointmentSchema>;
    const appointment = await createAppointment(salonId, req.auth!.userId, {
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

adminRouter.get(
  "/salons/:salonId/appointments/:id",
  validate(salonAndIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { salonId, id } = req.params as z.infer<typeof salonAndIdSchema>;
    const appointment = await getAppointmentDetail(salonId, id);
    return sendSuccess(res, {
      data: appointment
    });
  })
);

adminRouter.patch(
  "/salons/:salonId/appointments/:id",
  validate(salonAndIdSchema, "params"),
  validate(updateAppointmentSchema),
  asyncHandler(async (req, res) => {
    const { salonId, id } = req.params as z.infer<typeof salonAndIdSchema>;
    const payload = req.body as z.infer<typeof updateAppointmentSchema>;
    const appointment = await updateAppointment(salonId, id, req.auth!.userId, {
      customerId: payload.customerId,
      staffId: payload.staffId,
      serviceId: payload.serviceId,
      serviceIds: payload.serviceIds,
      startTime: payload.startTime ? new Date(payload.startTime) : undefined,
      source: payload.source,
      notes: payload.notes,
      status: payload.status
    });
    return sendSuccess(res, {
      message: "Appointment updated.",
      data: appointment
    });
  })
);

adminRouter.patch(
  "/salons/:salonId/appointments/:id/cancel",
  validate(salonAndIdSchema, "params"),
  validate(cancelAppointmentSchema),
  asyncHandler(async (req, res) => {
    const { salonId, id } = req.params as z.infer<typeof salonAndIdSchema>;
    const payload = req.body as z.infer<typeof cancelAppointmentSchema>;
    const appointment = await cancelAppointment(salonId, id, req.auth!.userId, payload.reason);
    return sendSuccess(res, {
      message: "Appointment canceled.",
      data: appointment
    });
  })
);

adminRouter.patch(
  "/salons/:salonId/appointments/:id/reschedule",
  validate(salonAndIdSchema, "params"),
  validate(rescheduleSchema),
  asyncHandler(async (req, res) => {
    const { salonId, id } = req.params as z.infer<typeof salonAndIdSchema>;
    const payload = req.body as z.infer<typeof rescheduleSchema>;
    const appointment = await rescheduleAppointment(salonId, id, req.auth!.userId, {
      staffId: payload.staffId,
      startTime: new Date(payload.startTime)
    });
    return sendSuccess(res, {
      message: "Appointment rescheduled.",
      data: appointment
    });
  })
);

adminRouter.get(
  "/salons/:salonId/billing/usage",
  validate(salonIdSchema, "params"),
  validate(usageQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const { salonId } = req.params as z.infer<typeof salonIdSchema>;
    const query = req.query as unknown as z.infer<typeof usageQuerySchema>;
    const [currentUsage, history] = await Promise.all([
      getCurrentBillingUsageForSalon(salonId),
      getBillingUsageHistoryForSalon(salonId, query.historyLimit)
    ]);
    return sendSuccess(res, {
      data: {
        currentUsage,
        history
      }
    });
  })
);

adminRouter.get(
  "/owners/:id",
  validate(idSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof idSchema>;
    const owner = await getOwnerDetailForAdmin(id);
    return sendSuccess(res, {
      data: owner
    });
  })
);

adminRouter.get(
  "/metrics/overview",
  asyncHandler(async (_req, res) => {
    const metrics = await getAdminOverviewMetrics();
    return sendSuccess(res, {
      data: metrics
    });
  })
);

adminRouter.get(
  "/calls",
  validate(adminCallsQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof adminCallsQuerySchema>;
    const result = await listCallsForAdmin(query);
    return sendSuccess(res, {
      data: result
    });
  })
);

adminRouter.post(
  "/calls/debug-export",
  validate(adminDebugExportSchema),
  asyncHandler(async (req, res) => {
    const { ids, mode } = req.body as z.infer<typeof adminDebugExportSchema>;
    const result = await getCallsDebugExportForAdmin(ids, mode);
    if (req.query.download === "true") {
      const filename = buildDebugExportDownloadFilename(
        "call_logs",
        Number(result.bundle.recordCount ?? 0),
        String(result.bundle.exportedAt)
      );
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("X-Debug-Export-Mode", mode);
      res.setHeader("X-Debug-Export-Records", String(result.bundle.recordCount ?? 0));
      return res.status(200).send(result.json);
    }
    return sendSuccess(res, {
      data: result.bundle
    });
  })
);

adminRouter.get(
  "/calls/:id",
  validate(idSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof idSchema>;
    const result = await getCallByIdForAdmin(id);
    return sendSuccess(res, {
      data: result
    });
  })
);

adminRouter.get(
  "/ai-logs",
  validate(adminAiQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof adminAiQuerySchema>;
    const result = await listAIInteractionsForAdmin(query);
    return sendSuccess(res, {
      data: result
    });
  })
);

adminRouter.get(
  "/ai-logs/export",
  validate(
    adminAiQuerySchema.pick({
      salonId: true,
      taskType: true,
      callSessionId: true,
      contactId: true,
      callerPhone: true,
      q: true,
      includeSynthetic: true
    }),
    "query"
  ),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as Pick<
      z.infer<typeof adminAiQuerySchema>,
      "salonId" | "taskType" | "callSessionId" | "contactId" | "callerPhone" | "q" | "includeSynthetic"
    >;
    const result = await exportAIInteractionsForAdmin(query);
    return sendSuccess(res, {
      data: result
    });
  })
);

adminRouter.post(
  "/ai-logs/debug-export",
  validate(adminDebugExportSchema),
  asyncHandler(async (req, res) => {
    const { ids, mode } = req.body as z.infer<typeof adminDebugExportSchema>;
    const result = await getAIInteractionsDebugExportForAdmin(ids, mode);
    if (req.query.download === "true") {
      const filename = buildDebugExportDownloadFilename(
        "ai_logs",
        Number(result.bundle.recordCount ?? 0),
        String(result.bundle.exportedAt)
      );
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("X-Debug-Export-Mode", mode);
      res.setHeader("X-Debug-Export-Records", String(result.bundle.recordCount ?? 0));
      return res.status(200).send(result.json);
    }
    return sendSuccess(res, {
      data: result.bundle
    });
  })
);

adminRouter.get(
  "/ai-logs/:id/debug",
  validate(idSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof idSchema>;
    const result = await getAIInteractionCallDebugForAdmin(id);
    return sendSuccess(res, {
      data: result
    });
  })
);

adminRouter.get(
  "/ai-logs/:id",
  validate(idSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof idSchema>;
    const result = await getAIInteractionByIdForAdmin(id);
    return sendSuccess(res, {
      data: result
    });
  })
);
