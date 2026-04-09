import { Router } from "express";
import { Role } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler";
import { requireRoles } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
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
  callSessionId: z.string().uuid().optional()
});

export const aiRouter = Router();

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
