import { timingSafeEqual } from "crypto";
import { Router } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { env } from "../../config/env";
import { asyncHandler } from "../../middleware/async-handler";
import { requireRoles } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { sendSuccess } from "../../utils/response";
import { recordOperatorQueueOutcome } from "../call-center/call-center.service";
import {
  bookingFromTextRequestSchema,
  bookingFromTranscriptRequestSchema,
  parseBookingRequestSchema,
  suggestSlotsRequestSchema
} from "./ai.schemas";
import {
	  bookingFromText,
	  bookingFromTranscript,
	  createAmazonConnectAIAppointment,
	  createAmazonConnectAIRecoverableFailure,
	  exportAIInteractions,
  getAIInteractionById,
  listAIInteractions,
  parseBookingText,
  suggestSlotsFromAIInput
} from "./ai.service";

const interactionIdSchema = z.object({
  id: z.string().uuid()
});

const interactionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  taskType: z.string().max(80).optional(),
  callSessionId: z.string().trim().min(1).max(160).optional(),
  contactId: z.string().trim().min(1).max(160).optional(),
  callerPhone: z.string().trim().min(3).max(40).optional(),
  q: z.string().trim().min(1).max(160).optional(),
  includeSynthetic: z.coerce.boolean().default(false)
});

const createAIAppointmentSchema = z
  .object({
    salonId: z.string().trim().min(1).optional(),
    intentName: z.string().trim().min(1).max(160).optional(),
    text: z.string().trim().min(1).max(15000).optional(),
    transcript: z.string().trim().min(1).max(15000).optional(),
    customer: z
      .object({
        name: z.string().trim().min(1).max(160).optional(),
        phone: z.string().trim().min(3).max(40).optional()
      })
      .optional(),
    customerName: z.string().trim().min(1).max(160).optional(),
    customerPhone: z.string().trim().min(3).max(40).optional(),
    callerPhone: z.string().trim().min(3).max(40).optional(),
    service: z.string().trim().min(1).max(160).optional(),
    serviceName: z.string().trim().min(1).max(160).optional(),
    preferredDateTime: z.string().trim().min(1).max(120).optional(),
    requestedDate: z.string().trim().min(1).max(120).optional(),
    requestedTime: z.string().trim().min(1).max(40).optional(),
    staffPreference: z.string().trim().min(1).max(160).optional(),
    staffId: z.string().trim().min(1).max(160).optional(),
    selectedStaffId: z.string().trim().min(1).max(160).optional(),
    confirmationState: z.string().trim().min(1).max(40).optional(),
    source: z.string().trim().min(1).max(80).optional(),
    provider: z.string().trim().min(1).max(80).optional(),
    contactId: z.string().trim().min(1).max(160).optional(),
    callSessionId: z.string().trim().min(1).max(160).optional(),
    amazonConnectContactId: z.string().trim().min(1).max(160).optional(),
    amazonConnectPhoneNumber: z.string().trim().min(1).max(40).optional(),
    calledNumber: z.string().trim().min(1).max(40).optional(),
    attributes: z.record(z.unknown()).optional()
  })
  .passthrough();

const operatorQueueOutcomeSchema = z.object({
  salonId: z.string().trim().min(1).optional(),
  callSessionId: z.string().trim().min(1).max(160).optional(),
  amazonConnectContactId: z.string().trim().min(1).max(160).optional(),
  contactId: z.string().trim().min(1).max(160).optional(),
  callerPhone: z.string().trim().min(3).max(40).optional(),
  outcome: z.enum(["AGENTS_UNAVAILABLE", "AGENTS_BUSY", "QUEUE_WAIT_TIMEOUT", "CONNECT_FLOW_ERROR"])
});

const extractInternalToken = (authorizationHeader?: string, internalHeader?: string | string[]) => {
  const headerToken = Array.isArray(internalHeader) ? internalHeader[0] : internalHeader;
  if (headerToken?.trim()) {
    return headerToken.trim();
  }

  const [scheme, token] = authorizationHeader?.split(" ") ?? [];
  if (scheme === "Bearer" && token) {
    return token.trim();
  }

  return undefined;
};

const tokensMatch = (actual: string, expected: string): boolean => {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
};

const readPayloadAttribute = (
  payload: z.infer<typeof createAIAppointmentSchema>,
  name: string
): string | undefined => {
  const value = payload.attributes?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const firstString = (...values: Array<unknown>): string | undefined => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

const primitiveStringAttributes = (attributes: Record<string, unknown> | undefined): Record<string, string> =>
  Object.fromEntries(
    Object.entries(attributes ?? {})
      .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
      .map(([key, value]) => [key, String(value)])
      .filter(([, value]) => value.trim() !== "")
  );

const fallbackSlotForPayload = (payload: z.infer<typeof createAIAppointmentSchema>): string | undefined => {
  if (!firstString(payload.serviceName, payload.service, readPayloadAttribute(payload, "serviceName"))) {
    return "serviceName";
  }
  if (!firstString(payload.requestedDate, readPayloadAttribute(payload, "requestedDate"))) {
    return "requestedDate";
  }
  if (!firstString(payload.requestedTime, readPayloadAttribute(payload, "requestedTime"))) {
    return "requestedTime";
  }
  if (!firstString(payload.staffPreference, readPayloadAttribute(payload, "staffPreference"))) {
    return "staffPreference";
  }
  if (!firstString(payload.customerName, payload.customer?.name, readPayloadAttribute(payload, "customerName"))) {
    return "customerName";
  }
  if (!firstString(payload.customerPhone, payload.callerPhone, payload.customer?.phone, readPayloadAttribute(payload, "customerPhone"))) {
    return "customerPhone";
  }
  return undefined;
};

const safeRecoverableResponse = (
  reason: "backend_error" | "backend_timeout",
  payload: z.infer<typeof createAIAppointmentSchema>
) => {
  const slotToElicit = fallbackSlotForPayload(payload);
  const preservedLastAskedSlot = slotToElicit ?? firstString(readPayloadAttribute(payload, "lastAskedSlot")) ?? "customerName";
  const serviceName = firstString(payload.serviceName, payload.service, readPayloadAttribute(payload, "serviceName"));
  const requestedDate = firstString(payload.requestedDate, readPayloadAttribute(payload, "requestedDate"));
  const requestedTime = firstString(payload.requestedTime, readPayloadAttribute(payload, "requestedTime"));
  const staffPreference = firstString(payload.staffPreference, readPayloadAttribute(payload, "staffPreference"));
  const customerName = firstString(payload.customerName, payload.customer?.name, readPayloadAttribute(payload, "customerName"));
  const appointmentSummary = [serviceName, requestedDate, requestedTime ? `at ${requestedTime}` : undefined]
    .filter(Boolean)
    .join(" ");
  const staffSummary = staffPreference ? ` with ${staffPreference}` : "";
  const nameSummary = customerName ? ` under ${customerName}` : "";
  const sessionAttributes = Object.fromEntries(
    Object.entries({
      ...primitiveStringAttributes(payload.attributes as Record<string, unknown> | undefined),
      customerName,
      customerPhone: firstString(
        payload.customerPhone,
        payload.callerPhone,
        payload.customer?.phone,
        readPayloadAttribute(payload, "customerPhone")
      ),
      serviceName,
      requestedDate,
      requestedTime,
      staffPreference,
      callSessionId: payload.callSessionId,
      amazonConnectContactId: firstString(
        payload.amazonConnectContactId,
        payload.contactId,
        readPayloadAttribute(payload, "AmazonConnectContactId")
      ),
      lastAskedSlot: preservedLastAskedSlot,
      forceHumanEscalation: "false",
      transferToQueue: "false",
      recoverableErrorReason: reason
    }).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
  );
  const message =
    slotToElicit === undefined
      ? `I'm sorry, I couldn't save the appointment just yet. I still have ${appointmentSummary}${staffSummary}${nameSummary}. Would you like me to try once more? You can press 0 to speak with an operator.`
      : slotToElicit === "customerName"
      ? "I'm sorry, I couldn't save the appointment just yet. What name should I put on the appointment?"
      : "I'm sorry, I couldn't save the appointment just yet. Please repeat that detail so I can keep the booking moving.";
  const dialogAction =
    slotToElicit === undefined
      ? {
          type: "ConfirmIntent"
        }
      : {
          type: "ElicitSlot",
          slotToElicit
        };
  return {
		  outcome: "MISSING_INFO" as const,
		  message,
	  data: {
	    outcome: "MISSING_INFO",
	    lexResponse: {
	      fulfillmentState: "InProgress",
		      message,
		      messageContentType: "PlainText",
		      dialogAction,
		      sessionAttributes
		    },
	    appointment: null,
	    bookingAttemptId: null,
	    callSessionId: payload.callSessionId ?? null,
	    transcriptId: null,
	    aiInteractionId: null,
    escalationId: null,
	    missingFields: slotToElicit ? [slotToElicit] : [],
    alternatives: [],
    salonResolutionSource: null
	  }
	};
};

const classifyInternalAIError = (error: unknown): "backend_error" | "backend_timeout" => {
  if (
    error instanceof Error &&
    (error.name === "AbortError" || /timeout|timed out|etimedout/i.test(error.message))
  ) {
    return "backend_timeout";
  }
  return "backend_error";
};

const requireInternalApiToken = asyncHandler(async (req, _res, next) => {
  const configuredToken = env.FASTAIBOOKING_API_INTERNAL_TOKEN?.trim();
  if (!configuredToken) {
    throw new AppError("AI appointment endpoint is not configured.", 503, "AI_INTERNAL_TOKEN_MISSING");
  }

  const requestToken = extractInternalToken(
    req.headers.authorization,
    req.headers["x-fastaibooking-internal-token"]
  );
  if (!requestToken || !tokensMatch(requestToken, configuredToken)) {
    throw new AppError("Invalid internal token.", 401, "UNAUTHORIZED");
  }

  next();
});

export const aiInternalRouter = Router();
export const aiRouter = Router();

aiInternalRouter.post(
  "/appointments",
  requireInternalApiToken,
  validate(createAIAppointmentSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof createAIAppointmentSchema>;
    const startedAt = Date.now();
    const waitOperationHeader = req.headers["x-fastaibooking-wait-operation"];
    const waitPromptHeader = req.headers["x-fastaibooking-wait-prompt"];
    const waitOperation = Array.isArray(waitOperationHeader)
      ? waitOperationHeader[0]
      : waitOperationHeader;
    const waitPrompt = Array.isArray(waitPromptHeader) ? waitPromptHeader[0] : waitPromptHeader;
    const amazonConnectContactIdAttribute =
      typeof payload.attributes?.["AmazonConnectContactId"] === "string"
        ? payload.attributes["AmazonConnectContactId"]
        : undefined;
    const lastAskedSlot =
      typeof payload.attributes?.["lastAskedSlot"] === "string"
        ? payload.attributes["lastAskedSlot"]
        : null;
    const logWaitCoverage = (input: {
      success: boolean;
      outcome?: string;
      reason?: string;
    }) => {
      const durationMs = Date.now() - startedAt;
      logger.info(
        {
          requestId: req.requestId,
          operationName: waitOperation ?? payload.intentName ?? "internal_ai_appointment",
          waitPrompt: waitPrompt ?? null,
          durationMs,
          apiDurationMs: durationMs,
          contactId:
            payload.amazonConnectContactId ??
            payload.contactId ??
            amazonConnectContactIdAttribute ??
            null,
          sessionId: payload.callSessionId ?? null,
          salonId: payload.salonId ?? null,
          serviceName: payload.serviceName ?? payload.service ?? null,
          lastAskedSlot,
          success: input.success,
          outcome: input.outcome,
          failureReason: input.reason,
          callOrSessionId:
            payload.amazonConnectContactId ??
            payload.callSessionId ??
            payload.contactId ??
            amazonConnectContactIdAttribute ??
            null
        },
        "Internal AI wait prompt coverage."
      );
    };
    let result: Awaited<ReturnType<typeof createAmazonConnectAIAppointment>>;
	    try {
	      result = await createAmazonConnectAIAppointment(payload);
	    } catch (error) {
	      const reason = classifyInternalAIError(error);
	      try {
	        const recoveryResult = await createAmazonConnectAIRecoverableFailure(payload, {
	          reason,
	          error
	        });
	        logWaitCoverage({
	          success: false,
	          outcome: recoveryResult.outcome,
	          reason
	        });
	        return sendSuccess(res, {
	          statusCode: 200,
	          message: recoveryResult.message,
	          data: {
	            outcome: recoveryResult.outcome,
	            lexResponse: recoveryResult.lexResponse,
	            appointment: recoveryResult.appointment,
	            bookingAttemptId: recoveryResult.bookingAttempt.id,
	            callSessionId: recoveryResult.callSession?.id ?? null,
		            transcriptId: null,
		            aiInteractionId: recoveryResult.aiInteraction?.id ?? null,
		            escalationId: null,
	            missingFields: recoveryResult.missingFields,
	            alternatives: recoveryResult.alternatives,
	            salonResolutionSource: recoveryResult.salonResolutionSource
	          }
	        });
	      } catch (recoveryError) {
	        logger.error(
	          {
	            requestId: req.requestId,
	            reason,
	            errorName: recoveryError instanceof Error ? recoveryError.name : typeof recoveryError
	          },
	          "Internal AI recoverable failure logging failed. Returning preserved caller-safe prompt."
	        );
	      }
	      logWaitCoverage({
	        success: false,
	        outcome: "MISSING_INFO",
        reason
      });
      logger.error(
        {
          requestId: req.requestId,
          reason,
          errorName: error instanceof Error ? error.name : typeof error
        },
        "Internal AI appointment flow failed. Returning recoverable caller-safe prompt."
	      );
	      return sendSuccess(res, {
	        statusCode: 200,
	        ...safeRecoverableResponse(reason, payload)
	      });
	    }
    logWaitCoverage({
      success: true,
      outcome: result.outcome
    });
    return sendSuccess(res, {
      statusCode: result.outcome === "BOOKED" ? 201 : 200,
      message: result.message,
      data: {
        outcome: result.outcome,
        lexResponse: result.lexResponse,
        appointment: result.appointment,
        bookingAttemptId: result.bookingAttempt?.id ?? null,
        callSessionId: result.callSession?.id ?? null,
        transcriptId: result.transcript?.id ?? null,
        aiInteractionId: result.aiInteraction?.id ?? null,
        escalationId: result.escalation?.id ?? null,
        missingFields: result.missingFields,
        alternatives: result.alternatives,
        salonResolutionSource: result.salonResolutionSource
      }
    });
  })
);

aiInternalRouter.post(
  "/operator-queue-outcome",
  requireInternalApiToken,
  validate(operatorQueueOutcomeSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof operatorQueueOutcomeSchema>;
    const escalation = await recordOperatorQueueOutcome({
      salonId: payload.salonId,
      callSessionId: payload.callSessionId,
      amazonConnectContactId: payload.amazonConnectContactId ?? payload.contactId,
      callerPhone: payload.callerPhone,
      operatorQueueOutcome: payload.outcome
    });
    return sendSuccess(res, {
      data: {
        escalationId: escalation.id,
        status: escalation.status,
        routingOutcome: escalation.routingOutcome,
        operatorQueueOutcome:
          escalation.metadata &&
          typeof escalation.metadata === "object" &&
          !Array.isArray(escalation.metadata)
            ? (escalation.metadata as Record<string, unknown>).operatorQueueOutcome
            : payload.outcome
      }
    });
  })
);

aiRouter.use(requireRoles(Role.SALON_OWNER));

aiRouter.get(
  "/interactions",
  validate(interactionsQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof interactionsQuerySchema>;
    const result = await listAIInteractions(req.auth!.salonId!, query);
    return sendSuccess(res, {
      data: result
    });
  })
);

aiRouter.get(
  "/interactions/export",
  validate(
    interactionsQuerySchema.pick({
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
      z.infer<typeof interactionsQuerySchema>,
      "taskType" | "callSessionId" | "contactId" | "callerPhone" | "q" | "includeSynthetic"
    >;
    const result = await exportAIInteractions(req.auth!.salonId!, query);
    return sendSuccess(res, {
      data: result
    });
  })
);

aiRouter.post(
  "/parse-booking",
  validate(parseBookingRequestSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof parseBookingRequestSchema>;
    const result = await parseBookingText({
      salonId: req.auth!.salonId!,
      actorUserId: req.auth!.userId,
      text: payload.text,
      callSessionId: payload.callSessionId
    });
    return sendSuccess(res, {
      data: result
    });
  })
);

aiRouter.post(
  "/booking-from-text",
  validate(bookingFromTextRequestSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof bookingFromTextRequestSchema>;
    const result = await bookingFromText({
      salonId: req.auth!.salonId!,
      actorUserId: req.auth!.userId,
      text: payload.text,
      callSessionId: payload.callSessionId,
      createCustomerIfMissing: payload.createCustomerIfMissing
    });
    return sendSuccess(res, {
      data: result
    });
  })
);

aiRouter.post(
  "/booking-from-transcript",
  validate(bookingFromTranscriptRequestSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof bookingFromTranscriptRequestSchema>;
    const result = await bookingFromTranscript({
      salonId: req.auth!.salonId!,
      actorUserId: req.auth!.userId,
      transcriptText: payload.transcriptText,
      callSessionId: payload.callSessionId,
      transcriptSource: payload.transcriptSource,
      createCustomerIfMissing: payload.createCustomerIfMissing
    });
    return sendSuccess(res, {
      data: result
    });
  })
);

aiRouter.post(
  "/suggest-slots",
  validate(suggestSlotsRequestSchema),
  asyncHandler(async (req, res) => {
    const payload = req.body as z.infer<typeof suggestSlotsRequestSchema>;
    const result = await suggestSlotsFromAIInput({
      salonId: req.auth!.salonId!,
      serviceName: payload.serviceName,
      staffName: payload.staffName,
      preferredStartTime: payload.preferredStartTime
        ? new Date(payload.preferredStartTime)
        : undefined,
      daysAhead: payload.daysAhead,
      maxSlots: payload.maxSlots
    });
    return sendSuccess(res, {
      data: result
    });
  })
);

aiRouter.get(
  "/interactions/:id",
  validate(interactionIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof interactionIdSchema>;
    const result = await getAIInteractionById(req.auth!.salonId!, id);
    return sendSuccess(res, {
      data: result
    });
  })
);
