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
  q: z.string().trim().min(1).max(160).optional()
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

const safeEscalationResponse = (reason: "backend_error" | "backend_timeout") => ({
  outcome: "HUMAN_ESCALATION" as const,
  message: "Please wait while I connect you.",
  data: {
    outcome: "HUMAN_ESCALATION",
    lexResponse: {
      fulfillmentState: "Fulfilled",
      message: "Please wait while I connect you.",
      messageContentType: "PlainText",
      sessionAttributes: {
        forceHumanEscalation: "true",
        transferToQueue: "true",
        escalationReason: reason,
        fallbackMode: "operator_queue",
        ...(env.AMAZON_CONNECT_QUEUE_ID_DEFAULT
          ? { queueId: env.AMAZON_CONNECT_QUEUE_ID_DEFAULT }
          : {})
      }
    },
    appointment: null,
    bookingAttemptId: null,
    callSessionId: null,
    transcriptId: null,
    aiInteractionId: null,
    escalationId: null,
    missingFields: [],
    alternatives: [],
    salonResolutionSource: null
  }
});

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
    const logWaitCoverage = (input: {
      success: boolean;
      outcome?: string;
      reason?: string;
    }) => {
      logger.info(
        {
          requestId: req.requestId,
          operationName: waitOperation ?? payload.intentName ?? "internal_ai_appointment",
          waitPrompt: waitPrompt ?? null,
          apiDurationMs: Date.now() - startedAt,
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
      logWaitCoverage({
        success: false,
        outcome: "HUMAN_ESCALATION",
        reason
      });
      logger.error(
        {
          requestId: req.requestId,
          reason,
          errorName: error instanceof Error ? error.name : typeof error
        },
        "Internal AI appointment flow failed. Returning caller-safe human escalation."
      );
      return sendSuccess(res, {
        statusCode: 200,
        ...safeEscalationResponse(reason)
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
        bookingAttemptId: result.bookingAttempt.id,
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
      q: true
    }),
    "query"
  ),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as Pick<
      z.infer<typeof interactionsQuerySchema>,
      "taskType" | "callSessionId" | "contactId" | "callerPhone" | "q"
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
