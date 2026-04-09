import { z } from "zod";

export const bookingIntentTypeSchema = z.enum([
  "BOOK_APPOINTMENT",
  "RESCHEDULE_APPOINTMENT",
  "CANCEL_APPOINTMENT",
  "LIVE_PERSON_REQUEST",
  "GENERAL_INQUIRY",
  "UNKNOWN"
]);

export const bookingIntentResultSchema = z.object({
  intentType: bookingIntentTypeSchema,
  customer: z
    .object({
      name: z.string().min(1).max(160).optional(),
      phone: z.string().min(3).max(30).optional()
    })
    .default({}),
  requestedService: z.string().min(1).max(200).optional(),
  requestedStaff: z.string().min(1).max(200).optional(),
  requestedDateTime: z.string().min(1).max(200).optional(),
  notes: z.string().max(4000).optional(),
  confidence: z.number().min(0).max(1),
  isReadyToBook: z.boolean(),
  missingFields: z.array(z.string().min(1)).default([]),
  normalizedBookingRequest: z.object({
    customerName: z.string().min(1).max(160).optional(),
    customerPhone: z.string().min(3).max(30).optional(),
    serviceName: z.string().min(1).max(200).optional(),
    staffName: z.string().min(1).max(200).optional(),
    startTimeIso: z.string().datetime({ offset: true }).optional(),
    timezone: z.string().min(2).max(64).optional(),
    notes: z.string().max(4000).optional()
  })
});

export type BookingIntentResult = z.infer<typeof bookingIntentResultSchema>;

export const parseBookingRequestSchema = z.object({
  text: z.string().min(1).max(10000),
  callSessionId: z.string().uuid().optional()
});

export const bookingFromTextRequestSchema = z.object({
  text: z.string().min(1).max(10000),
  callSessionId: z.string().uuid().optional(),
  createCustomerIfMissing: z.boolean().default(true)
});

export const bookingFromTranscriptRequestSchema = z.object({
  transcriptText: z.string().min(1).max(15000),
  callSessionId: z.string().uuid().optional(),
  transcriptSource: z.string().min(2).max(80).default("manual_transcript"),
  createCustomerIfMissing: z.boolean().default(true)
});

export const suggestSlotsRequestSchema = z.object({
  serviceName: z.string().min(1).max(200),
  staffName: z.string().min(1).max(200).optional(),
  preferredStartTime: z.string().datetime({ offset: true }).optional(),
  daysAhead: z.coerce.number().int().positive().max(14).default(7),
  maxSlots: z.coerce.number().int().positive().max(20).default(5)
});
