import { Router } from "express";
import { z } from "zod";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { asyncHandler } from "../../middleware/async-handler";
import { validate } from "../../middleware/validate";
import { sendSuccess } from "../../utils/response";
import { getCallRailHealthStatus } from "../ai-reception/ai-reception.service";
import { runCallAutomationForSession } from "./call-automation.service";
import { buildCallRoutingPlan, processCallRailWebhook } from "./calls.service";

const routingPlanSchema = z.object({
  salonId: z.string().uuid().optional(),
  customerIncomingPhoneNumber: z.string().min(7).max(25).optional(),
  digits: z.string().max(12).optional(),
  spokenText: z.string().max(2000).optional(),
  callerPhone: z.string().max(25).optional()
});

export const callrailWebhookRouter = Router();

callrailWebhookRouter.get(
  "/health",
  asyncHandler(async (_req, res) => {
    const health = await getCallRailHealthStatus();
    return sendSuccess(res, {
      data: health
    });
  })
);

callrailWebhookRouter.post(
  "/webhook",
  asyncHandler(async (req, res) => {
    const rawBody = req.rawBody ?? JSON.stringify(req.body ?? {});
    const querySecret =
      typeof req.query.secret === "string"
        ? req.query.secret
        : typeof req.query.webhook_secret === "string"
          ? req.query.webhook_secret
          : undefined;
    const headers = {
      ...req.headers,
      ...(querySecret ? { "x-callrail-webhook-secret": querySecret } : {})
    };

    try {
      const result = await processCallRailWebhook(req.body, rawBody, headers);
      if (result.callSessionId && !result.isDuplicateEvent) {
        void runCallAutomationForSession(result.callSessionId).catch((error) => {
          logger.error(
            {
              callSessionId: result.callSessionId,
              error
            },
            "Call automation failed after CallRail webhook ingestion"
          );
        });
      }

      return sendSuccess(res, {
        message: "CallRail webhook accepted.",
        data: result
      });
    } catch (error) {
      if (error instanceof AppError && error.code === "CALLRAIL_INVALID_PAYLOAD") {
        logger.warn(
          {
            message: error.message,
            body: req.body
          },
          "Ignoring CallRail webhook with unsupported payload shape"
        );
        return sendSuccess(res, {
          message: "CallRail webhook accepted.",
          data: {
            signatureVerified: true,
            callSessionId: null,
            salonId: null,
            providerCallId: null,
            status: null,
            isDuplicateEvent: false,
            ignored: true,
            warningCode: error.code
          }
        });
      }

      throw error;
    }
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
