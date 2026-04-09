import { Router } from "express";
import { CallSessionStatus, Role } from "@prisma/client";
import { z } from "zod";
import { asyncHandler } from "../../middleware/async-handler";
import { requireRoles } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { sendSuccess } from "../../utils/response";
import {
  addCallTranscript,
  getCallById,
  listCallBookingAttempts,
  listCallEvents,
  listCalls,
  listCallTranscripts
} from "./calls.service";

const listCallsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.nativeEnum(CallSessionStatus).optional()
});

const callIdSchema = z.object({
  id: z.string().uuid()
});

const addTranscriptSchema = z.object({
  transcriptSource: z.string().min(2).max(80).optional(),
  transcriptText: z.string().min(1).max(10000),
  transcriptSummary: z.string().max(2000).optional(),
  startedAt: z.string().datetime({ offset: true }).optional(),
  endedAt: z.string().datetime({ offset: true }).optional(),
  rawPayload: z.unknown().optional()
});

export const callsRouter = Router();

callsRouter.use(requireRoles(Role.SALON_OWNER));

callsRouter.get(
  "/",
  validate(listCallsQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const query = req.query as unknown as z.infer<typeof listCallsQuerySchema>;
    const result = await listCalls(req.auth!.salonId!, query);
    return sendSuccess(res, {
      data: result
    });
  })
);

callsRouter.get(
  "/:id",
  validate(callIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof callIdSchema>;
    const callSession = await getCallById(req.auth!.salonId!, id);
    return sendSuccess(res, {
      data: callSession
    });
  })
);

callsRouter.get(
  "/:id/events",
  validate(callIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof callIdSchema>;
    const events = await listCallEvents(req.auth!.salonId!, id);
    return sendSuccess(res, {
      data: events
    });
  })
);

callsRouter.get(
  "/:id/transcripts",
  validate(callIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof callIdSchema>;
    const transcripts = await listCallTranscripts(req.auth!.salonId!, id);
    return sendSuccess(res, {
      data: transcripts
    });
  })
);

callsRouter.post(
  "/:id/transcripts",
  validate(callIdSchema, "params"),
  validate(addTranscriptSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof callIdSchema>;
    const payload = req.body as z.infer<typeof addTranscriptSchema>;
    const transcript = await addCallTranscript(req.auth!.salonId!, id, {
      transcriptSource: payload.transcriptSource,
      transcriptText: payload.transcriptText,
      transcriptSummary: payload.transcriptSummary,
      startedAt: payload.startedAt ? new Date(payload.startedAt) : undefined,
      endedAt: payload.endedAt ? new Date(payload.endedAt) : undefined,
      rawPayload: payload.rawPayload
    });
    return sendSuccess(res, {
      statusCode: 201,
      message: "Transcript stored.",
      data: transcript
    });
  })
);

callsRouter.get(
  "/:id/booking-attempts",
  validate(callIdSchema, "params"),
  asyncHandler(async (req, res) => {
    const { id } = req.params as z.infer<typeof callIdSchema>;
    const attempts = await listCallBookingAttempts(req.auth!.salonId!, id);
    return sendSuccess(res, {
      data: attempts
    });
  })
);
