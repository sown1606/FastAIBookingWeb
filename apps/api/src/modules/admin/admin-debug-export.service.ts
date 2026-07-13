import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { logger } from "../../lib/logger";
import { buildAdminDebugTimelineItems } from "../ai/ai.service";

export type DebugExportMode = "compact" | "full" | "gpt";
export type DebugExportSourcePage = "call_logs" | "ai_logs";

const SENSITIVE_DEBUG_KEY_PARTS = [
  "authorization",
  "cookie",
  "setcookie",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "secret",
  "password",
  "sessiontoken",
  "privatekey",
  "clientsecret"
];

export const OMITTED_DUPLICATE_FIELDS = [
  "turnHistories[].requestPayload",
  "turnHistories[].responsePayload",
  "responsePayload.turnHistory",
  "responsePayload.timeline",
  "appointmentReferences",
  "duplicate aiCallDebug/fullCallDebug"
];

const GPT_OMITTED_DUPLICATE_FIELDS = [
  "heavy AI exchange payloads",
  "full session attribute snapshots",
  "raw booking input payloads",
  "repeated appointment relation trees",
  "repeated Lex diagnostic trees",
  "duplicate adjacent transcript rows"
];

const normalizeDebugKey = (key: string) => key.replace(/[^a-z0-9]/gi, "").toLowerCase();

const isSensitiveDebugKey = (key: string): boolean => {
  const normalized = normalizeDebugKey(key);
  return SENSITIVE_DEBUG_KEY_PARTS.some((part) => normalized.includes(part));
};

export const sanitizeDebugJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDebugJsonValue(item));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      key,
      isSensitiveDebugKey(key) ? "[REDACTED]" : sanitizeDebugJsonValue(nestedValue)
    ])
  );
};

const uniqueInOrder = (ids: string[]): string[] => Array.from(new Set(ids));

const elapsedMs = (startedAt: bigint) => Number(process.hrtime.bigint() - startedAt) / 1_000_000;

const roundMs = (value: number) => Math.round(value * 100) / 100;

const toPlainJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const readRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const writeIfPresent = (
  output: Record<string, unknown>,
  key: string,
  value: unknown
) => {
  if (value !== undefined && value !== null) {
    output[key] = value;
  }
};

const writeRecordIfPresent = (
  output: Record<string, unknown>,
  key: string,
  value: unknown
) => {
  const record = readRecord(value);
  output[key] = Object.keys(record).length ? record : null;
};

const omitDeepKeys = (value: unknown, keysToOmit: Set<string>): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => omitDeepKeys(item, keysToOmit));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !keysToOmit.has(normalizeDebugKey(key)))
      .map(([key, nestedValue]) => [key, omitDeepKeys(nestedValue, keysToOmit)])
  );
};

const pruneResponsePayloadForExport = (value: unknown, mode: DebugExportMode) => {
  const omittedKeys = new Set(["turnhistory", "timeline"]);
  if (mode === "compact") {
    omittedKeys.add("sessionattributesbefore");
    omittedKeys.add("sessionattributesafter");
  }
  return omitDeepKeys(value, omittedKeys);
};

const pruneRequestPayloadForExport = (value: unknown, mode: DebugExportMode) => {
  if (mode === "full") {
    return value;
  }
  return omitDeepKeys(value, new Set(["lexturndebug"]));
};

const pruneBookingRawInputForExport = (value: unknown, mode: DebugExportMode) => {
  if (mode === "full") {
    return value;
  }
  return omitDeepKeys(value, new Set(["lexturndebug"]));
};

const callDebugSelect = {
  id: true,
  salonId: true,
  provider: true,
  providerCallId: true,
  providerAccountId: true,
  providerCompanyId: true,
  status: true,
  routingOutcome: true,
  callerPhone: true,
  originalPhoneNumber: true,
  dialedPhone: true,
  trackingNumber: true,
  direction: true,
  sourceName: true,
  campaignName: true,
  startedAt: true,
  answeredAt: true,
  endedAt: true,
  durationSeconds: true,
  recordingUrl: true,
  transcriptSummary: true,
  aiSummary: true,
  bookingResult: true,
  language: true,
  failureReason: true,
  finalResolution: true,
  rawPayload: true,
  createdAt: true,
  updatedAt: true,
  salon: {
    select: {
      id: true,
      name: true,
      timezone: true,
      status: true
    }
  },
  events: {
    orderBy: {
      receivedAt: "asc"
    },
    select: {
      id: true,
      salonId: true,
      callSessionId: true,
      provider: true,
      providerEventId: true,
      eventType: true,
      eventTimestamp: true,
      statusBefore: true,
      statusAfter: true,
      payload: true,
      payloadHash: true,
      receivedAt: true,
      processedAt: true,
      processError: true
    }
  },
  transcripts: {
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true,
      salonId: true,
      callSessionId: true,
      transcriptSource: true,
      transcriptText: true,
      transcriptSummary: true,
      speakerMap: true,
      startedAt: true,
      endedAt: true,
      rawPayload: true,
      createdAt: true
    }
  },
  bookingAttempts: {
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true,
      salonId: true,
      callSessionId: true,
      transcriptId: true,
      appointmentId: true,
      status: true,
      source: true,
      customerName: true,
      customerPhone: true,
      requestedService: true,
      requestedStaff: true,
      requestedDateTimeText: true,
      normalizedRequest: true,
      alternativeSlots: true,
      failureReason: true,
      rawInput: true,
      createdByUserId: true,
      createdAt: true,
      updatedAt: true,
      appointment: {
        select: {
          id: true,
          salonId: true,
          customerId: true,
          staffId: true,
          serviceId: true,
          startTime: true,
          endTime: true,
          durationMinutes: true,
          status: true,
          source: true,
          notes: true,
          canceledReason: true,
          createdByUserId: true,
          createdAt: true,
          updatedAt: true,
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true
            }
          },
          staff: {
            select: {
              id: true,
              fullName: true
            }
          },
          service: {
            select: {
              id: true,
              name: true,
              durationMinutes: true,
              priceCents: true
            }
          },
          appointmentServices: {
            select: {
              id: true,
              serviceId: true,
              durationMinutes: true,
              priceCents: true,
              service: {
                select: {
                  id: true,
                  name: true,
                  durationMinutes: true,
                  priceCents: true
                }
              }
            }
          }
        }
      }
    }
  },
  aiInteractions: {
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true,
      salonId: true,
      provider: true,
      model: true,
      taskType: true,
      requestText: true,
      requestPayload: true,
      responseText: true,
      responsePayload: true,
      parsedOutput: true,
      isValid: true,
      validationErrors: true,
      confidence: true,
      interactionKey: true,
      isSynthetic: true,
      callSessionId: true,
      transcriptId: true,
      bookingAttemptId: true,
      createdByUserId: true,
      createdAt: true
    }
  },
  callEscalations: {
    orderBy: {
      createdAt: "asc"
    },
    select: {
      id: true,
      salonId: true,
      callSessionId: true,
      status: true,
      routingOutcome: true,
      escalationReason: true,
      requestedBy: true,
      customerPhone: true,
      queueId: true,
      queueName: true,
      amazonConnectContactId: true,
      assignedAgentUserId: true,
      messageToCaller: true,
      callbackPhone: true,
      smsRecipientPhone: true,
      voicemailRecordingUrl: true,
      operatorNotes: true,
      resolution: true,
      qaNotes: true,
      metadata: true,
      requestedAt: true,
      queuedAt: true,
      connectedAt: true,
      closedAt: true,
      createdAt: true,
      updatedAt: true
    }
  }
} satisfies Prisma.CallSessionSelect;

type CallDebugSession = Prisma.CallSessionGetPayload<{ select: typeof callDebugSelect }>;
type CallAiInteraction = CallDebugSession["aiInteractions"][number];
type CallBookingAttempt = CallDebugSession["bookingAttempts"][number];

const aiInteractionDebugSelect = {
  id: true,
  salonId: true,
  provider: true,
  model: true,
  taskType: true,
  requestText: true,
  requestPayload: true,
  responseText: true,
  responsePayload: true,
  parsedOutput: true,
  isValid: true,
  validationErrors: true,
  confidence: true,
  interactionKey: true,
  isSynthetic: true,
  callSessionId: true,
  transcriptId: true,
  bookingAttemptId: true,
  createdByUserId: true,
  createdAt: true,
  callSession: {
    select: {
      id: true,
      providerCallId: true,
      callerPhone: true
    }
  },
  bookingAttempt: {
    select: {
      id: true,
      salonId: true,
      callSessionId: true,
      transcriptId: true,
      appointmentId: true,
      status: true,
      source: true,
      customerName: true,
      customerPhone: true,
      requestedService: true,
      requestedStaff: true,
      requestedDateTimeText: true,
      normalizedRequest: true,
      alternativeSlots: true,
      failureReason: true,
      rawInput: true,
      createdByUserId: true,
      createdAt: true,
      updatedAt: true,
      appointment: {
        select: {
          id: true,
          salonId: true,
          customerId: true,
          staffId: true,
          serviceId: true,
          startTime: true,
          endTime: true,
          durationMinutes: true,
          status: true,
          source: true,
          notes: true,
          canceledReason: true,
          createdByUserId: true,
          createdAt: true,
          updatedAt: true,
          customer: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              phone: true
            }
          },
          staff: {
            select: {
              id: true,
              fullName: true
            }
          },
          service: {
            select: {
              id: true,
              name: true,
              durationMinutes: true,
              priceCents: true
            }
          },
          appointmentServices: {
            select: {
              id: true,
              serviceId: true,
              durationMinutes: true,
              priceCents: true,
              service: {
                select: {
                  id: true,
                  name: true,
                  durationMinutes: true,
                  priceCents: true
                }
              }
            }
          }
        }
      }
    }
  },
  transcript: {
    select: {
      id: true,
      salonId: true,
      callSessionId: true,
      transcriptSource: true,
      transcriptText: true,
      transcriptSummary: true,
      speakerMap: true,
      startedAt: true,
      endedAt: true,
      rawPayload: true,
      createdAt: true
    }
  },
  salon: {
    select: {
      id: true,
      name: true,
      timezone: true,
      status: true
    }
  }
} satisfies Prisma.AiInteractionLogSelect;

type AIInteractionDebugSource = Prisma.AiInteractionLogGetPayload<{
  select: typeof aiInteractionDebugSelect;
}>;

interface SelectedFrom {
  sourcePage: DebugExportSourcePage;
  selectedCallSessionIds?: string[];
  selectedAiInteractionIds?: string[];
}

export interface AdminDebugExportTimings {
  selectedAIQueryDurationMs?: number;
  callSessionQueryDurationMs: number;
  databaseDurationMs: number;
  buildDurationMs: number;
  serializationDurationMs: number;
  responseBytes: number;
}

export interface AdminDebugExportResult {
  bundle: Record<string, unknown>;
  json: string;
  responseBytes: number;
  timings: AdminDebugExportTimings;
}

const compactValues = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
    )
  );

const readNestedRecord = (value: unknown, key: string): Record<string, unknown> =>
  readRecord(readRecord(value)[key]);

const readNestedValue = (value: unknown, path: string[]): unknown =>
  path.reduce<unknown>((current, key) => readRecord(current)[key], value);

const readAIInteractionContactIds = (interaction: Pick<
  AIInteractionDebugSource,
  "requestPayload" | "responsePayload" | "callSession"
>): string[] => {
  const requestPayload = readRecord(interaction.requestPayload);
  const responsePayload = readRecord(interaction.responsePayload);
  const requestAttributes = readNestedRecord(requestPayload, "attributes");
  return compactValues([
    interaction.callSession?.providerCallId,
    requestPayload.amazonConnectContactId,
    requestPayload.contactId,
    requestAttributes.amazonConnectContactId,
    requestAttributes.AmazonConnectContactId,
    requestAttributes.contactId,
    readNestedValue(responsePayload, ["lexTurnDebug", "contactId"])
  ]);
};

const getAIInteractionCallSessionId = (interaction: AIInteractionDebugSource): string | null =>
  interaction.callSessionId ?? interaction.bookingAttempt?.callSessionId ?? null;

const normalizeAIInteractionForExport = (
  interaction: CallAiInteraction | AIInteractionDebugSource,
  mode: DebugExportMode
) => {
  const item: Record<string, unknown> = {
    id: interaction.id,
    salonId: interaction.salonId,
    taskType: interaction.taskType,
    provider: interaction.provider,
    model: interaction.model,
    requestText: interaction.requestText,
    responseText: interaction.responseText,
    createdAt: interaction.createdAt,
    parsedOutput: interaction.parsedOutput,
    requestPayload: pruneRequestPayloadForExport(interaction.requestPayload, mode),
    responsePayload: pruneResponsePayloadForExport(interaction.responsePayload, mode),
    isValid: interaction.isValid,
    validationErrors: interaction.validationErrors,
    confidence: interaction.confidence,
    interactionKey: interaction.interactionKey,
    isSynthetic: interaction.isSynthetic,
    callSessionId: interaction.callSessionId,
    transcriptId: interaction.transcriptId,
    bookingAttemptId: interaction.bookingAttemptId
  };
  if (mode === "full") {
    item.createdByUserId = interaction.createdByUserId;
  }
  return item;
};

const normalizeBookingAttemptForExport = (
  attempt: CallBookingAttempt | NonNullable<AIInteractionDebugSource["bookingAttempt"]>,
  mode: DebugExportMode
) => {
  const item: Record<string, unknown> = {
    id: attempt.id,
    salonId: attempt.salonId,
    callSessionId: attempt.callSessionId,
    transcriptId: attempt.transcriptId,
    appointmentId: attempt.appointmentId,
    status: attempt.status,
    source: attempt.source,
    customerName: attempt.customerName,
    customerPhone: attempt.customerPhone,
    requestedService: attempt.requestedService,
    requestedStaff: attempt.requestedStaff,
    requestedDateTimeText: attempt.requestedDateTimeText,
    normalizedRequest: attempt.normalizedRequest,
    alternativeSlots: attempt.alternativeSlots,
    failureReason: attempt.failureReason,
    rawInput: pruneBookingRawInputForExport(attempt.rawInput, mode),
    appointment: attempt.appointment,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt
  };
  if (mode === "full") {
    item.createdByUserId = attempt.createdByUserId;
  }
  return item;
};

const normalizeCallSessionForExport = (call: CallDebugSession, mode: DebugExportMode) => {
  const item: Record<string, unknown> = {
    id: call.id,
    salonId: call.salonId,
    provider: call.provider,
    providerCallId: call.providerCallId,
    providerAccountId: call.providerAccountId,
    providerCompanyId: call.providerCompanyId,
    status: call.status,
    routingOutcome: call.routingOutcome,
    callerPhone: call.callerPhone,
    originalPhoneNumber: call.originalPhoneNumber,
    dialedPhone: call.dialedPhone,
    trackingNumber: call.trackingNumber,
    direction: call.direction,
    sourceName: call.sourceName,
    campaignName: call.campaignName,
    startedAt: call.startedAt,
    answeredAt: call.answeredAt,
    endedAt: call.endedAt,
    durationSeconds: call.durationSeconds,
    recordingUrl: call.recordingUrl,
    transcriptSummary: call.transcriptSummary,
    aiSummary: call.aiSummary,
    bookingResult: call.bookingResult,
    language: call.language,
    failureReason: call.failureReason,
    finalResolution: call.finalResolution,
    createdAt: call.createdAt,
    updatedAt: call.updatedAt
  };
  if (mode === "full") {
    item.rawPayload = call.rawPayload;
  }
  return item;
};

const normalizeEventForExport = (event: CallDebugSession["events"][number], mode: DebugExportMode) => {
  const item: Record<string, unknown> = {
    id: event.id,
    salonId: event.salonId,
    callSessionId: event.callSessionId,
    provider: event.provider,
    providerEventId: event.providerEventId,
    eventType: event.eventType,
    eventTimestamp: event.eventTimestamp,
    statusBefore: event.statusBefore,
    statusAfter: event.statusAfter,
    payloadHash: event.payloadHash,
    receivedAt: event.receivedAt,
    processedAt: event.processedAt,
    processError: event.processError
  };
  if (mode === "full") {
    item.payload = event.payload;
  }
  return item;
};

const normalizeTranscriptForExport = (
  transcript: CallDebugSession["transcripts"][number] | NonNullable<AIInteractionDebugSource["transcript"]>,
  mode: DebugExportMode
) => {
  const item: Record<string, unknown> = {
    id: transcript.id,
    salonId: transcript.salonId,
    callSessionId: transcript.callSessionId,
    transcriptSource: transcript.transcriptSource,
    transcriptText: transcript.transcriptText,
    transcriptSummary: transcript.transcriptSummary,
    speakerMap: transcript.speakerMap,
    startedAt: transcript.startedAt,
    endedAt: transcript.endedAt,
    createdAt: transcript.createdAt
  };
  if (mode === "full") {
    item.rawPayload = transcript.rawPayload;
  }
  return item;
};

const normalizeEscalationForExport = (record: CallDebugSession["callEscalations"][number]) => ({
  id: record.id,
  salonId: record.salonId,
  callSessionId: record.callSessionId,
  status: record.status,
  routingOutcome: record.routingOutcome,
  escalationReason: record.escalationReason,
  requestedBy: record.requestedBy,
  customerPhone: record.customerPhone,
  queueId: record.queueId,
  queueName: record.queueName,
  amazonConnectContactId: record.amazonConnectContactId,
  assignedAgentUserId: record.assignedAgentUserId,
  messageToCaller: record.messageToCaller,
  callbackPhone: record.callbackPhone,
  smsRecipientPhone: record.smsRecipientPhone,
  voicemailRecordingUrl: record.voicemailRecordingUrl,
  operatorNotes: record.operatorNotes,
  resolution: record.resolution,
  qaNotes: record.qaNotes,
  metadata: record.metadata,
  requestedAt: record.requestedAt,
  queuedAt: record.queuedAt,
  connectedAt: record.connectedAt,
  closedAt: record.closedAt,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt
});

const isoStringOrNull = (value: unknown): string | null => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  return null;
};

const transcriptDedupeText = (value: unknown): string =>
  typeof value === "string"
    ? value
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .replace(/\s+/g, " ")
    : "";

const readTranscriptTimeMs = (transcript: {
  createdAt?: unknown;
  startedAt?: unknown;
  endedAt?: unknown;
}) => {
  const timestamp =
    isoStringOrNull(transcript.createdAt) ??
    isoStringOrNull(transcript.startedAt) ??
    isoStringOrNull(transcript.endedAt);
  return timestamp ? new Date(timestamp).getTime() : 0;
};

const normalizeTranscriptForGpt = (
  transcript: CallDebugSession["transcripts"][number] | NonNullable<AIInteractionDebugSource["transcript"]>
) => ({
  id: transcript.id,
  source: transcript.transcriptSource,
  timestamp: isoStringOrNull(transcript.createdAt) ?? isoStringOrNull(transcript.startedAt),
  startedAt: transcript.startedAt,
  endedAt: transcript.endedAt,
  text: transcript.transcriptText,
  summary: transcript.transcriptSummary
});

const dedupeAdjacentTranscriptsForGpt = <
  T extends CallDebugSession["transcripts"][number] | NonNullable<AIInteractionDebugSource["transcript"]>
>(
  transcripts: T[]
) => {
  const sorted = [...transcripts].sort((left, right) => readTranscriptTimeMs(left) - readTranscriptTimeMs(right));
  const result: T[] = [];
  for (const transcript of sorted) {
    const previous = result[result.length - 1];
    const normalized = transcriptDedupeText(transcript.transcriptText);
    const previousNormalized = previous ? transcriptDedupeText(previous.transcriptText) : "";
    const closeInTime =
      previous &&
      normalized &&
      normalized === previousNormalized &&
      Math.abs(readTranscriptTimeMs(transcript) - readTranscriptTimeMs(previous)) <= 2_000;
    if (!closeInTime) {
      result.push(transcript);
    }
  }
  return result.map(normalizeTranscriptForGpt);
};

const summarizeAppointmentForGpt = (
  appointment: CallBookingAttempt["appointment"] | NonNullable<AIInteractionDebugSource["bookingAttempt"]>["appointment"]
) =>
  appointment
    ? {
        id: appointment.id,
        status: appointment.status,
        startTime: appointment.startTime,
        endTime: appointment.endTime,
        staffId: appointment.staffId,
        staffName: appointment.staff?.fullName,
        serviceId: appointment.serviceId,
        serviceName: appointment.service?.name
      }
    : null;

const summarizeBookingAttemptForGpt = (
  attempt: CallBookingAttempt | NonNullable<AIInteractionDebugSource["bookingAttempt"]>
) => ({
  id: attempt.id,
  callSessionId: attempt.callSessionId,
  transcriptId: attempt.transcriptId,
  appointmentId: attempt.appointmentId,
  status: attempt.status,
  source: attempt.source,
  customerName: attempt.customerName,
  customerPhone: attempt.customerPhone,
  requestedService: attempt.requestedService,
  requestedStaff: attempt.requestedStaff,
  requestedDateTimeText: attempt.requestedDateTimeText,
  normalizedRequest: attempt.normalizedRequest,
  alternativeSlots: attempt.alternativeSlots,
  failureReason: attempt.failureReason,
  appointment: summarizeAppointmentForGpt(attempt.appointment),
  createdAt: attempt.createdAt,
  updatedAt: attempt.updatedAt
});

const summarizeEscalationForGpt = (record: CallDebugSession["callEscalations"][number]) => ({
  id: record.id,
  status: record.status,
  routingOutcome: record.routingOutcome,
  escalationReason: record.escalationReason,
  requestedBy: record.requestedBy,
  customerPhone: record.customerPhone,
  queueName: record.queueName,
  amazonConnectContactId: record.amazonConnectContactId,
  messageToCaller: record.messageToCaller,
  callbackPhone: record.callbackPhone,
  smsRecipientPhone: record.smsRecipientPhone,
  voicemailRecordingUrl: record.voicemailRecordingUrl,
  resolution: record.resolution,
  requestedAt: record.requestedAt,
  queuedAt: record.queuedAt,
  connectedAt: record.connectedAt,
  closedAt: record.closedAt
});

const summarizeEscalationsForGpt = (records: CallDebugSession["callEscalations"]) => ({
  count: records.length,
  records: records.map(summarizeEscalationForGpt)
});

const normalizeTurnForGpt = (turn: Record<string, unknown>) => {
  const item: Record<string, unknown> = {
    index: turn.index,
    timestamp: isoStringOrNull(turn.createdAt),
    callerTranscript: turn.currentTurnTranscript ?? null,
    aiResponse: turn.responseText ?? null,
    lastAskedSlot: {
      before: turn.lastAskedSlotBefore ?? null,
      after: turn.lastAskedSlotAfter ?? null
    },
    slotDecisions: null,
    trustedSlotsBefore: null,
    trustedSlotsAfter: null,
    dtmfRoute: readRecord(turn.dtmfRouting).route ?? null,
    missingFields: turn.missingFields ?? null
  };
  writeRecordIfPresent(item, "slotDecisions", turn.slotDecisions);
  writeRecordIfPresent(item, "trustedSlotsBefore", turn.trustedSlotsBefore);
  writeRecordIfPresent(item, "trustedSlotsAfter", turn.trustedSlotsAfter);
  writeIfPresent(item, "slotToElicit", turn.slotToElicit);
  writeIfPresent(item, "promptMissingFields", turn.promptMissingFields);
  writeIfPresent(item, "activeDtmfMenuBefore", turn.activeDtmfMenuBefore);
  writeIfPresent(item, "activeDtmfMenuAfter", turn.activeDtmfMenuAfter);
  return item;
};

const normalizeTurnHistoriesForGpt = (
  interactions: Array<CallAiInteraction | AIInteractionDebugSource>
) =>
  interactions
    .flatMap((interaction, index) => buildAdminDebugTimelineItems(interaction, index))
    .map((turn) => normalizeTurnForGpt(readRecord(turn)))
    .sort((left, right) => {
      const leftTime = isoStringOrNull(left.timestamp);
      const rightTime = isoStringOrNull(right.timestamp);
      return (leftTime ? new Date(leftTime).getTime() : 0) - (rightTime ? new Date(rightTime).getTime() : 0);
    });

const buildGptCallSummary = (call: CallDebugSession) => ({
  id: call.id,
  provider: call.provider,
  providerCallId: call.providerCallId,
  contactId: call.providerCallId,
  status: call.status,
  routingOutcome: call.routingOutcome,
  callerPhone: call.callerPhone,
  originalPhoneNumber: call.originalPhoneNumber,
  dialedPhone: call.dialedPhone,
  trackingNumber: call.trackingNumber,
  direction: call.direction,
  sourceName: call.sourceName,
  startedAt: call.startedAt,
  answeredAt: call.answeredAt,
  endedAt: call.endedAt,
  durationSeconds: call.durationSeconds,
  bookingResult: call.bookingResult,
  failureReason: call.failureReason,
  finalResolution: call.finalResolution
});

const buildGptCallDebugRecord = (
  call: CallDebugSession,
  exportedAt: string,
  selectedFrom: SelectedFrom
) => ({
  schemaVersion: 2,
  exportedAt,
  exportType: "call_debug_gpt",
  exportMode: "gpt",
  selectedFrom,
  contactIds: readCallContactIds(call),
  call: buildGptCallSummary(call),
  callerSummary: {
    callerPhone: call.callerPhone,
    originalPhoneNumber: call.originalPhoneNumber,
    dialedPhone: call.dialedPhone,
    trackingNumber: call.trackingNumber
  },
  salonSummary: call.salon,
  transcripts: dedupeAdjacentTranscriptsForGpt(call.transcripts),
  turnHistories: normalizeTurnHistoriesForGpt(call.aiInteractions),
  bookingAttempts: call.bookingAttempts.map(summarizeBookingAttemptForGpt),
  escalationSummary: summarizeEscalationsForGpt(call.callEscalations),
  finalResolution: call.finalResolution ?? call.failureReason ?? call.bookingResult
});

const buildGptDetachedAIRecord = (
  interactions: AIInteractionDebugSource[],
  exportedAt: string,
  selectedFrom: SelectedFrom
) => {
  const first = interactions[0];
  const transcripts = uniqueById(interactions.map((interaction) => interaction.transcript));
  const bookingAttempts = uniqueById(interactions.map((interaction) => interaction.bookingAttempt));
  return {
    schemaVersion: 2,
    exportedAt,
    exportType: "call_debug_gpt",
    exportMode: "gpt",
    selectedFrom,
    contactIds: compactValues(interactions.flatMap(readAIInteractionContactIds)),
    call: null,
    callerSummary: {
      callerPhone: first?.callSession?.callerPhone ?? null
    },
    salonSummary: first?.salon ?? null,
    transcripts: dedupeAdjacentTranscriptsForGpt(transcripts),
    turnHistories: normalizeTurnHistoriesForGpt(interactions),
    bookingAttempts: bookingAttempts.map(summarizeBookingAttemptForGpt),
    escalationSummary: {
      count: 0,
      records: []
    },
    finalResolution: null
  };
};

const uniqueById = <T extends { id: string }>(items: Array<T | null | undefined>): T[] => {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    if (!item || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    result.push(item);
  }
  return result;
};

const readCallContactIds = (call: CallDebugSession) =>
  compactValues([
    call.providerCallId,
    ...call.callEscalations.map((item) => item.amazonConnectContactId),
    ...call.aiInteractions.flatMap((item) =>
      readAIInteractionContactIds({ ...item, callSession: { id: call.id, providerCallId: call.providerCallId, callerPhone: call.callerPhone } })
    )
  ]);

const buildCanonicalCallDebugRecord = (
  call: CallDebugSession,
  exportedAt: string,
  mode: DebugExportMode,
  selectedFrom: SelectedFrom
) => {
  if (mode === "gpt") {
    return buildGptCallDebugRecord(call, exportedAt, selectedFrom);
  }
  return {
    schemaVersion: 2,
    exportedAt,
    exportType: mode === "compact" ? "call_debug_compact" : "call_debug_full",
    exportMode: mode,
    selectedFrom,
    contactIds: readCallContactIds(call),
    callSession: normalizeCallSessionForExport(call, mode),
    salonSummary: call.salon,
    events: call.events.map((event) => normalizeEventForExport(event, mode)),
    transcripts: call.transcripts.map((transcript) => normalizeTranscriptForExport(transcript, mode)),
    bookingAttempts: call.bookingAttempts.map((attempt) => normalizeBookingAttemptForExport(attempt, mode)),
    aiInteractions: call.aiInteractions.map((interaction) => normalizeAIInteractionForExport(interaction, mode)),
    turnHistories: call.aiInteractions.flatMap((interaction, index) =>
      buildAdminDebugTimelineItems(interaction, index)
    ),
    escalationRecords: call.callEscalations.map(normalizeEscalationForExport),
    finalResolution: call.finalResolution
  };
};

const buildDetachedAIRecord = (
  interactions: AIInteractionDebugSource[],
  exportedAt: string,
  mode: DebugExportMode,
  selectedFrom: SelectedFrom
) => {
  const first = interactions[0];
  const transcripts = uniqueById(interactions.map((interaction) => interaction.transcript));
  const bookingAttempts = uniqueById(interactions.map((interaction) => interaction.bookingAttempt));
  if (mode === "gpt") {
    return buildGptDetachedAIRecord(interactions, exportedAt, selectedFrom);
  }
  return {
    schemaVersion: 2,
    exportedAt,
    exportType: mode === "compact" ? "call_debug_compact" : "call_debug_full",
    exportMode: mode,
    selectedFrom,
    contactIds: compactValues(interactions.flatMap(readAIInteractionContactIds)),
    callSession: null,
    salonSummary: first?.salon ?? null,
    events: [],
    transcripts: transcripts.map((transcript) => normalizeTranscriptForExport(transcript, mode)),
    bookingAttempts: bookingAttempts.map((attempt) => normalizeBookingAttemptForExport(attempt, mode)),
    aiInteractions: interactions.map((interaction) => normalizeAIInteractionForExport(interaction, mode)),
    turnHistories: interactions.flatMap((interaction, index) => buildAdminDebugTimelineItems(interaction, index)),
    escalationRecords: [],
    finalResolution: null
  };
};

const finalizeDebugExportBundle = (
  bundle: Record<string, unknown>,
  logContext: {
    adminDebugExportType: "calls" | "ai_logs";
    exportMode: DebugExportMode;
    requestedCount: number;
    recordCount: number;
    databaseDurationMs: number;
    buildDurationMs: number;
    selectedAIQueryDurationMs?: number;
    callSessionQueryDurationMs: number;
  }
): AdminDebugExportResult => {
  const serializationStartedAt = process.hrtime.bigint();
  const json = JSON.stringify(bundle, null, logContext.exportMode === "gpt" ? 0 : 2);
  const serializationDurationMs = roundMs(elapsedMs(serializationStartedAt));
  const responseBytes = Buffer.byteLength(json, "utf8");
  const timings: AdminDebugExportTimings = {
    selectedAIQueryDurationMs: logContext.selectedAIQueryDurationMs,
    callSessionQueryDurationMs: roundMs(logContext.callSessionQueryDurationMs),
    databaseDurationMs: roundMs(logContext.databaseDurationMs),
    buildDurationMs: roundMs(logContext.buildDurationMs),
    serializationDurationMs,
    responseBytes
  };
  Object.assign(bundle, {
    serializationDurationMs,
    approximateJsonBytes: responseBytes,
    timings
  });
  const jsonWithTimings = JSON.stringify(bundle, null, logContext.exportMode === "gpt" ? 0 : 2);
  const finalResponseBytes = Buffer.byteLength(jsonWithTimings, "utf8");
  timings.responseBytes = finalResponseBytes;
  bundle.approximateJsonBytes = finalResponseBytes;
  logger.info(
    {
      adminDebugExportType: logContext.adminDebugExportType,
      exportMode: logContext.exportMode,
      requestedCount: logContext.requestedCount,
      recordCount: logContext.recordCount,
      databaseDurationMs: timings.databaseDurationMs,
      buildDurationMs: timings.buildDurationMs,
      serializationDurationMs: timings.serializationDurationMs,
      responseBytes: finalResponseBytes,
      selectedAIQueryDurationMs: timings.selectedAIQueryDurationMs,
      callSessionQueryDurationMs: timings.callSessionQueryDurationMs
    },
    "Admin debug export prepared"
  );
  return {
    bundle,
    json: jsonWithTimings,
    responseBytes: finalResponseBytes,
    timings
  };
};

export const getCallsDebugExportForAdmin = async (
  ids: string[],
  mode: DebugExportMode = "compact"
): Promise<AdminDebugExportResult> => {
  const exportedAt = new Date().toISOString();
  const requestedIds = uniqueInOrder(ids);
  const databaseStartedAt = process.hrtime.bigint();
  const callQueryStartedAt = process.hrtime.bigint();
  const calls = requestedIds.length
    ? await prisma.callSession.findMany({
        where: {
          id: {
            in: requestedIds
          }
        },
        select: callDebugSelect
      })
    : [];
  const callSessionQueryDurationMs = elapsedMs(callQueryStartedAt);
  const databaseDurationMs = elapsedMs(databaseStartedAt);
  const buildStartedAt = process.hrtime.bigint();
  const byId = new Map(calls.map((call) => [call.id, call]));
  const records = requestedIds
    .map((id) => byId.get(id))
    .filter((call): call is CallDebugSession => Boolean(call))
    .map((call) =>
      buildCanonicalCallDebugRecord(call, exportedAt, mode, {
        sourcePage: "call_logs",
        selectedCallSessionIds: [call.id]
      })
    );
  const buildDurationMs = elapsedMs(buildStartedAt);

  const bundle = sanitizeDebugJsonValue({
    schemaVersion: 2,
    exportedAt,
    exportType: "multi_call_debug",
    exportMode: mode,
    requestedCount: ids.length,
    recordCount: records.length,
	    deduplicatedCount: ids.length - requestedIds.length,
	    notFoundIds: requestedIds.filter((id) => !byId.has(id)),
	    omittedDuplicateFields: mode === "gpt" ? GPT_OMITTED_DUPLICATE_FIELDS : OMITTED_DUPLICATE_FIELDS,
	    records
	  }) as Record<string, unknown>;

  return finalizeDebugExportBundle(bundle, {
    adminDebugExportType: "calls",
    exportMode: mode,
    requestedCount: ids.length,
    recordCount: records.length,
    databaseDurationMs,
    buildDurationMs,
    callSessionQueryDurationMs
  });
};

const getAIInteractionBaseDedupKey = (interaction: AIInteractionDebugSource): string => {
  const callSessionId = getAIInteractionCallSessionId(interaction);
  if (callSessionId) {
    return `callSessionId:${callSessionId}`;
  }
  const contactId = readAIInteractionContactIds(interaction)[0];
  if (contactId) {
    return `contactId:${contactId}`;
  }
  return `aiInteractionId:${interaction.id}`;
};

interface AIRecordPlan {
  interactions: AIInteractionDebugSource[];
  selectedAiInteractionIds: string[];
  callSession: CallDebugSession | null;
}

export const getAIInteractionsDebugExportForAdmin = async (
  ids: string[],
  mode: DebugExportMode = "compact"
): Promise<AdminDebugExportResult> => {
  const exportedAt = new Date().toISOString();
  const requestedIds = uniqueInOrder(ids);
  const databaseStartedAt = process.hrtime.bigint();
  const selectedAIQueryStartedAt = process.hrtime.bigint();
  const selectedInteractions = requestedIds.length
    ? await prisma.aiInteractionLog.findMany({
        where: {
          id: {
            in: requestedIds
          }
        },
        select: aiInteractionDebugSelect
      })
    : [];
  const selectedAIQueryDurationMs = elapsedMs(selectedAIQueryStartedAt);
  const selectedById = new Map(selectedInteractions.map((interaction) => [interaction.id, interaction]));
  const foundInRequestedOrder = requestedIds
    .map((id) => selectedById.get(id))
    .filter((interaction): interaction is AIInteractionDebugSource => Boolean(interaction));

  const callSessionIds = uniqueInOrder(
    foundInRequestedOrder
      .map(getAIInteractionCallSessionId)
      .filter((id): id is string => Boolean(id))
  );
  const callSessionQueryStartedAt = process.hrtime.bigint();
  const callSessions = callSessionIds.length
    ? await prisma.callSession.findMany({
        where: {
          id: {
            in: callSessionIds
          }
        },
        select: callDebugSelect
      })
    : [];
  const callSessionQueryDurationMs = elapsedMs(callSessionQueryStartedAt);
  const databaseDurationMs = elapsedMs(databaseStartedAt);
  const callSessionById = new Map(callSessions.map((call) => [call.id, call]));
  const buildStartedAt = process.hrtime.bigint();
  const plans: AIRecordPlan[] = [];
  const planByIdentityKey = new Map<string, AIRecordPlan>();
  let deduplicatedCount = ids.length - requestedIds.length;

  for (const interaction of foundInRequestedOrder) {
    const callSessionId = getAIInteractionCallSessionId(interaction);
    const callSession = callSessionId ? callSessionById.get(callSessionId) ?? null : null;
    const contactIds = readAIInteractionContactIds(interaction);
    const identityKeys = [
      ...compactValues([callSession?.id ?? callSessionId]).map((value) => `callSessionId:${value}`),
      ...compactValues([callSession?.providerCallId, interaction.callSession?.providerCallId]).map(
        (value) => `providerCallId:${value}`
      ),
      ...compactValues([...(callSession?.callEscalations.map((item) => item.amazonConnectContactId) ?? []), ...contactIds]).map(
        (value) => `contactId:${value}`
      )
    ];
    const dedupKeys = identityKeys.length ? identityKeys : [getAIInteractionBaseDedupKey(interaction)];
    const existingPlan = dedupKeys.map((key) => planByIdentityKey.get(key)).find(Boolean);
    if (existingPlan) {
      existingPlan.selectedAiInteractionIds.push(interaction.id);
      existingPlan.interactions.push(interaction);
      deduplicatedCount += 1;
      continue;
    }
    const nextPlan: AIRecordPlan = {
      interactions: [interaction],
      selectedAiInteractionIds: [interaction.id],
      callSession
    };
    plans.push(nextPlan);
    dedupKeys.forEach((key) => planByIdentityKey.set(key, nextPlan));
  }

  const records = plans.map((plan) =>
    plan.callSession
      ? buildCanonicalCallDebugRecord(plan.callSession, exportedAt, mode, {
          sourcePage: "ai_logs",
          selectedAiInteractionIds: plan.selectedAiInteractionIds
        })
      : buildDetachedAIRecord(plan.interactions, exportedAt, mode, {
          sourcePage: "ai_logs",
          selectedAiInteractionIds: plan.selectedAiInteractionIds
        })
  );
  const buildDurationMs = elapsedMs(buildStartedAt);

  const bundle = sanitizeDebugJsonValue({
    schemaVersion: 2,
    exportedAt,
    exportType: "multi_ai_call_debug",
    exportMode: mode,
    requestedCount: ids.length,
	    recordCount: records.length,
	    deduplicatedCount,
	    notFoundIds: requestedIds.filter((id) => !selectedById.has(id)),
	    omittedDuplicateFields: mode === "gpt" ? GPT_OMITTED_DUPLICATE_FIELDS : OMITTED_DUPLICATE_FIELDS,
	    records
	  }) as Record<string, unknown>;

  return finalizeDebugExportBundle(bundle, {
    adminDebugExportType: "ai_logs",
    exportMode: mode,
    requestedCount: ids.length,
    recordCount: records.length,
    selectedAIQueryDurationMs,
    databaseDurationMs,
    buildDurationMs,
    callSessionQueryDurationMs
  });
};

export const buildDebugExportDownloadFilename = (
  sourcePage: DebugExportSourcePage,
  recordCount: number,
  exportedAt: string
) => {
  const timestamp = new Date(exportedAt).toISOString().replace(/[:.]/g, "-");
  return sourcePage === "ai_logs"
    ? `fastaibooking-ai-debug-${recordCount}-calls-${timestamp}.json`
    : `fastaibooking-call-debug-${recordCount}-records-${timestamp}.json`;
};

export const parseServerSanitizedDebugBundle = (bundle: Record<string, unknown>) =>
  toPlainJson(bundle);
