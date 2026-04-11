import { Router } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler";
import { requireRoles } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { sendSuccess } from "../../utils/response";
import { listSalonAlerts, markAlertRead } from "./alerts.service";

const listAlertsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(30),
  unreadOnly: z
    .string()
    .optional()
    .transform((value) => value === "true")
});

const alertIdSchema = z.object({
  id: z.string().uuid()
});

export const alertsRouter = Router();

alertsRouter.use(requireRoles(Role.SALON_OWNER));

alertsRouter.get(
  "/",
  validate(listAlertsQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const payload = req.query as unknown as z.infer<typeof listAlertsQuerySchema>;
    const result = await listSalonAlerts({
      salonId: req.auth!.salonId!,
      page: payload.page,
      limit: payload.limit,
      unreadOnly: payload.unreadOnly
    });
    return sendSuccess(res, {
      data: result
    });
  })
);

alertsRouter.post(
  "/:id/read",
  validate(alertIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof alertIdSchema>;
    const alert = await markAlertRead(req.auth!.salonId!, id);
    return sendSuccess(res, {
      message: "Alert marked as read.",
      data: alert
    });
  })
);
