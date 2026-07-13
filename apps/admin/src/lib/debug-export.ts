import { sanitizeJsonExport, stringifyJsonExport } from "./download-json";

export interface CallDebugSource {
  id: string;
  provider: string;
  providerCallId: string;
  status: string;
  routingOutcome: string | null;
  callerPhone: string | null;
  dialedPhone: string | null;
  trackingNumber: string | null;
  sourceName: string | null;
  campaignName: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  recordingUrl: string | null;
  transcriptSummary: string | null;
  aiSummary: unknown;
  failureReason: string | null;
  finalResolution: string | null;
  salon: {
    id: string;
    name: string;
  } | null;
  events: Array<{
    id: string;
    eventType: string;
    statusBefore: string | null;
    statusAfter: string | null;
    receivedAt: string;
  }>;
  transcripts: Array<{
    id: string;
    transcriptSource: string;
    transcriptText: string;
    transcriptSummary: string | null;
    createdAt: string;
  }>;
  bookingAttempts: Array<{
    id: string;
    status: string;
    requestedService: string | null;
    requestedStaff: string | null;
    failureReason: string | null;
    createdAt: string;
    appointment: {
      id: string;
    } | null;
  }>;
  aiInteractions: Array<{
    id: string;
    taskType: string;
    model: string | null;
    createdAt: string;
    requestText?: string | null;
    responseText?: string | null;
    requestPayload?: unknown;
    responsePayload?: unknown;
  }>;
  callEscalations: Array<{
    id: string;
    status: string;
    routingOutcome: string | null;
    requestedAt: string;
    connectedAt: string | null;
    closedAt: string | null;
    resolution: string | null;
    operatorNotes: string | null;
    qaNotes: string | null;
    voicemailRecordingUrl: string | null;
    callbackPhone: string | null;
    smsRecipientPhone: string | null;
  }>;
}

export interface BulkDebugExportResponse {
  schemaVersion: number;
  exportedAt: string;
  exportType: string;
  exportMode?: "compact" | "full" | "gpt";
  requestedCount: number;
  recordCount: number;
  deduplicatedCount?: number;
  notFoundIds: string[];
  approximateJsonBytes?: number;
  omittedDuplicateFields?: string[];
  records: unknown[];
}

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const readNestedRecord = (value: unknown, key: string): Record<string, unknown> => asRecord(asRecord(value)[key]);

export const sanitizeDebugJsonValue = sanitizeJsonExport;
export const stringifyDebugJson = stringifyJsonExport;

export const buildAiTurnDebug = (item: CallDebugSource["aiInteractions"][number]) => {
  const requestPayload = asRecord(item.requestPayload);
  const responsePayload = asRecord(item.responsePayload);
  const requestAttributes = readNestedRecord(requestPayload, "attributes");
  const requestDebug = asRecord(requestAttributes.lexTurnDebug);
  const responseDebug = readNestedRecord(responsePayload, "lexTurnDebug");
  const debug = Object.keys(responseDebug).length ? responseDebug : requestDebug;
  return {
    currentTurnTranscript:
      responsePayload.currentTurnTranscript ??
      debug.currentTurnTranscript ??
      requestPayload.currentTurnTranscript ??
      item.requestText,
    aggregatedTranscript:
      responsePayload.aggregatedBookingTranscript ??
      requestPayload.aggregatedBookingTranscript ??
      requestPayload.transcript,
    contactId:
      debug.contactId ??
      requestPayload.amazonConnectContactId ??
      requestPayload.contactId ??
      requestAttributes.AmazonConnectContactId,
    lastAskedSlotBefore: debug.lastAskedSlotBefore,
    lastAskedSlotAfter: debug.lastAskedSlotAfter ?? asRecord(debug.sessionAttributesAfter).lastAskedSlot,
    activeDtmfMenuBefore: debug.activeDtmfMenuBefore,
    activeDtmfMenuAfter: debug.activeDtmfMenuAfter ?? asRecord(debug.sessionAttributesAfter).activeDtmfMenu,
    dtmfDiagnostics: debug.dtmfDiagnostics,
    dtmfRouting: debug.dtmfRouting,
    slotDecisions: debug.slotDecisions,
    trustedSlotsBefore: debug.trustedSlotsBefore,
    trustedSlotsAfter: debug.trustedSlotsAfter
  };
};

export const buildCallDebugPayload = (call: CallDebugSource, exportedAt: string) =>
  sanitizeDebugJsonValue({
    schemaVersion: 1,
    exportedAt,
    exportType: "call_debug",
    callSession: {
      id: call.id,
      provider: call.provider,
      providerCallId: call.providerCallId,
      status: call.status,
      routingOutcome: call.routingOutcome,
      callerPhone: call.callerPhone,
      dialedPhone: call.dialedPhone,
      trackingNumber: call.trackingNumber,
      sourceName: call.sourceName,
      campaignName: call.campaignName,
      startedAt: call.startedAt,
      endedAt: call.endedAt,
      durationSeconds: call.durationSeconds,
      recordingUrl: call.recordingUrl,
      transcriptSummary: call.transcriptSummary,
      aiSummary: call.aiSummary,
      failureReason: call.failureReason,
      finalResolution: call.finalResolution,
      salon: call.salon
    },
    events: call.events,
    transcripts: call.transcripts,
    bookingAttempts: call.bookingAttempts,
    aiInteractions: call.aiInteractions,
    turnHistories: call.aiInteractions.map((item, index) => ({
      aiInteractionId: item.id,
      index: index + 1,
      ...buildAiTurnDebug(item)
    })),
    escalationRecords: call.callEscalations,
    finalResolution: call.finalResolution
  });

export const buildBulkDebugBundle = (
  response: BulkDebugExportResponse,
  options: {
    sourcePage: "call_logs" | "ai_logs";
    selection: Record<string, unknown>;
  }
) =>
  ({
    ...response,
    sourcePage: options.sourcePage,
    selection: options.selection
  });

export const stringifyServerDebugBundle = (payload: unknown) =>
  JSON.stringify(payload, null, asRecord(payload).exportMode === "gpt" ? 0 : 2);

export const getJsonByteSize = (json: string) => new Blob([json]).size;

export const formatDebugByteSize = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kib = bytes / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(kib >= 10 ? 0 : 1)} KB`;
  }
  const mib = kib / 1024;
  return `${mib.toFixed(mib >= 10 ? 1 : 2)} MB`;
};
