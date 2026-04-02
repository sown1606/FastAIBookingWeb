import { Router } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler";
import { requireRoles } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { sendSuccess } from "../../utils/response";
import {
  getBillingUsageHistoryForSalon,
  getCurrentBillingUsageForSalon
} from "./billing.service";

const querySchema = z.object({
  historyLimit: z.coerce.number().int().positive().max(24).default(6)
});

export const billingRouter = Router();

billingRouter.use(requireRoles(Role.SALON_OWNER));

billingRouter.get(
  "/usage",
  validate(querySchema, "query"),
  asyncHandler(async (req, res) => {
    const salonId = req.auth!.salonId!;
    const { historyLimit } = req.query as unknown as z.infer<typeof querySchema>;

    const currentUsage = await getCurrentBillingUsageForSalon(salonId);
    const history = await getBillingUsageHistoryForSalon(salonId, historyLimit);

    return sendSuccess(res, {
      data: {
        currentUsage,
        history
      }
    });
  })
);
