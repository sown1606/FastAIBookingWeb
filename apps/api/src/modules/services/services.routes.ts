import { Router } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler";
import { requireRoles } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { sendSuccess } from "../../utils/response";
import {
  createService,
  listServices,
  setServiceActiveState,
  setServiceStaffMapping,
  updateService
} from "./services.service";

const servicesQuerySchema = z.object({
  includeInactive: z
    .string()
    .optional()
    .transform((value) => value === "true")
});

const serviceIdSchema = z.object({
  id: z.string().uuid()
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

const setServiceStaffSchema = z.object({
  staffIds: z.array(z.string().uuid()).default([])
});

export const servicesRouter = Router();

servicesRouter.get(
  "/",
  validate(servicesQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const { includeInactive } = req.query as unknown as z.infer<typeof servicesQuerySchema>;
    const services = await listServices(req.auth!.salonId!, includeInactive);
    return sendSuccess(res, {
      data: services
    });
  })
);

servicesRouter.post(
  "/",
  requireRoles(Role.SALON_OWNER),
  validate(createServiceSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof createServiceSchema>;
    const service = await createService(req.auth!.salonId!, req.auth!.userId, payload);
    return sendSuccess(res, {
      statusCode: 201,
      message: "Service created.",
      data: service
    });
  })
);

servicesRouter.patch(
  "/:id",
  requireRoles(Role.SALON_OWNER),
  validate(serviceIdSchema, "params"),
  validate(updateServiceSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof serviceIdSchema>;
    const payload = req.body as z.infer<typeof updateServiceSchema>;
    const service = await updateService(req.auth!.salonId!, id, req.auth!.userId, payload);
    return sendSuccess(res, {
      message: "Service updated.",
      data: service
    });
  })
);

servicesRouter.post(
  "/:id/deactivate",
  requireRoles(Role.SALON_OWNER),
  validate(serviceIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof serviceIdSchema>;
    const service = await setServiceActiveState(req.auth!.salonId!, id, req.auth!.userId, false);
    return sendSuccess(res, {
      message: "Service deactivated.",
      data: service
    });
  })
);

servicesRouter.post(
  "/:id/activate",
  requireRoles(Role.SALON_OWNER),
  validate(serviceIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof serviceIdSchema>;
    const service = await setServiceActiveState(req.auth!.salonId!, id, req.auth!.userId, true);
    return sendSuccess(res, {
      message: "Service activated.",
      data: service
    });
  })
);

servicesRouter.put(
  "/:id/staff",
  requireRoles(Role.SALON_OWNER),
  validate(serviceIdSchema, "params"),
  validate(setServiceStaffSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof serviceIdSchema>;
    const { staffIds } = req.body as z.infer<typeof setServiceStaffSchema>;
    const service = await setServiceStaffMapping(req.auth!.salonId!, id, req.auth!.userId, staffIds);
    return sendSuccess(res, {
      message: "Service staff mapping updated.",
      data: service
    });
  })
);
