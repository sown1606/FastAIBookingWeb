import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler";
import { validate } from "../../middleware/validate";
import { sendSuccess } from "../../utils/response";
import { buildCallRoutingPlan, processCallRailWebhook } from "./calls.service";

const routingPlanSchema = z.object({
  salonId: z.string().uuid().optional(),
  customerIncomingPhoneNumber: z.string().min(7).max(25).optional(),
  digits: z.string().max(12).optional(),
  spokenText: z.string().max(2000).optional(),
  callerPhone: z.string().max(25).optional()
});

export const callrailWebhookRouter = Router();

callrailWebhookRouter.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
    const result = await processCallRailWebhook(req.body, rawBody, req.headers);
    return sendSuccess(res, {
      statusCode: 202,
      message: "CallRail webhook accepted.",
      data: result
    });
  })
);

callrailWebhookRouter.post(
  "/route",
  validate(routingPlanSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof routingPlanSchema>;
    const result = await buildCallRoutingPlan(payload);
    return sendSuccess(res, {
      data: result
    });
  })
);
