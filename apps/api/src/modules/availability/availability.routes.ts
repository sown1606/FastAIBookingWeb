import { Router } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler";
import { AppError } from "../../lib/errors";
import { validate } from "../../middleware/validate";
import { sendSuccess } from "../../utils/response";
import { getAvailableSlots, validateAppointmentSlot } from "./availability.service";

const slotsQuerySchema = z.object({
  staffId: z.string().uuid(),
  serviceId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  intervalMinutes: z.coerce.number().int().positive().max(120).default(15)
});

const validateSlotSchema = z.object({
  staffId: z.string().uuid(),
  serviceId: z.string().uuid(),
  startTime: z.string().datetime({ offset: true }),
  excludeAppointmentId: z.string().uuid().optional()
});

export const availabilityRouter = Router();

const ensureStaffCanAccessRequestedStaffId = (
  role: Role,
  authStaffId: string | null,
  requestedStaffId: string
): void => {
  if (role !== Role.STAFF) {
    return;
  }
  if (!authStaffId || authStaffId !== requestedStaffId) {
    throw new AppError("Staff can only access their own availability.", 403, "FORBIDDEN");
  }
};

availabilityRouter.get(
  "/slots",
  validate(slotsQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof slotsQuerySchema>;
    ensureStaffCanAccessRequestedStaffId(req.auth!.role, req.auth!.staffId, query.staffId);
    const result = await getAvailableSlots({
      salonId: req.auth!.salonId!,
      staffId: query.staffId,
      serviceId: query.serviceId,
      date: query.date,
      intervalMinutes: query.intervalMinutes
    });

    return sendSuccess(res, {
      data: result
    });
  })
);

availabilityRouter.post(
  "/validate",
  validate(validateSlotSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof validateSlotSchema>;
    ensureStaffCanAccessRequestedStaffId(req.auth!.role, req.auth!.staffId, payload.staffId);
    const result = await validateAppointmentSlot({
      salonId: req.auth!.salonId!,
      staffId: payload.staffId,
      serviceId: payload.serviceId,
      startTime: new Date(payload.startTime),
      excludeAppointmentId: payload.excludeAppointmentId
    });

    return sendSuccess(res, {
      data: result
    });
  })
);
