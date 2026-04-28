import { createHmac, timingSafeEqual } from "crypto";
import { CallSessionStatus, ExternalProvider } from "@prisma/client";
import { env } from "../../../config/env";
import { AppError } from "../../../lib/errors";
import { CallProviderAdapter, NormalizedCallWebhook } from "./call-provider";

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
};

const asString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return undefined;
};

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const asBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }

  const text = asString(value)?.toLowerCase();
  if (!text) {
    return undefined;
  }

  if (["true", "yes", "y", "1"].includes(text)) {
    return true;
  }
  if (["false", "no", "n", "0"].includes(text)) {
    return false;
  }

  return undefined;
};

const asDate = (value: unknown): Date | undefined => {
  const asDateValue = value instanceof Date ? value : undefined;
  if (asDateValue) {
    return Number.isNaN(asDateValue.getTime()) ? undefined : asDateValue;
  }

  const text = asString(value);
  if (!text) {
    return undefined;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  const unixSeconds = Number(text);
  if (Number.isFinite(unixSeconds)) {
    const fromUnix = new Date(unixSeconds * 1000);
    if (!Number.isNaN(fromUnix.getTime())) {
      return fromUnix;
    }
  }

  return undefined;
};

const asUuid = (value: unknown): string | undefined => {
  const text = asString(value);
  if (!text) {
    return undefined;
  }
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    text
  )
    ? text
    : undefined;
};

const pullNested = (root: Record<string, unknown>, path: string[]): unknown => {
  let cursor: unknown = root;
  for (const key of path) {
    const record = asRecord(cursor);
    if (!record || !(key in record)) {
      return undefined;
    }
    cursor = record[key];
  }
  return cursor;
};

export const normalizePhoneForMatching = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const hasPlus = value.trim().startsWith("+");
  const digits = value.replace(/[^\d]/g, "");
  if (!digits) {
    return undefined;
  }
  return hasPlus ? `+${digits}` : digits;
};

const pickHeaderValue = (
  headers: Record<string, string | string[] | undefined>,
  headerName: string
): string | undefined => {
  const value = headers[headerName];
  if (Array.isArray(value)) {
    const first = value.find((item) => item.trim().length > 0);
    return first?.trim();
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return undefined;
};

const findWebhookSignature = (
  headers: Record<string, string | string[] | undefined>
): string | undefined => {
  const candidates = [
    "x-callrail-signature",
    "x-callrail-signature-hmac-sha256",
    "x-webhook-signature",
    "x-signature"
  ];

  for (const header of candidates) {
    const value = pickHeaderValue(headers, header);
    if (value) {
      return value;
    }
  }

  return undefined;
};

const findWebhookSharedSecret = (
  headers: Record<string, string | string[] | undefined>
): string | undefined => {
  const candidates = [
    "x-callrail-webhook-secret",
    "x-webhook-secret",
    "x-callrail-secret",
    "x-integration-secret"
  ];

  for (const header of candidates) {
    const value = pickHeaderValue(headers, header);
    if (value) {
      return value;
    }
  }

  return undefined;
};

const secureCompare = (valueA: string, valueB: string): boolean => {
  const a = Buffer.from(valueA);
  const b = Buffer.from(valueB);
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
};

const verifyWebhookSignature = (
  rawBody: string,
  headers: Record<string, string | string[] | undefined>
): boolean => {
  const secret = env.CALLRAIL_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return true;
  }

  const sharedSecret = findWebhookSharedSecret(headers);
  if (sharedSecret) {
    return secureCompare(sharedSecret, secret);
  }

  const signature = findWebhookSignature(headers);
  if (!signature) {
    return false;
  }

  const received = signature.replace(/^sha256=/i, "").trim();
  const expectedHex = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBase64 = createHmac("sha256", secret).update(rawBody).digest("base64");
  const expectedBase64Url = expectedBase64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return (
    secureCompare(received, expectedHex) ||
    secureCompare(received, expectedBase64) ||
    secureCompare(received, expectedBase64Url)
  );
};

const mapStatus = (input: {
  statusInput?: string;
  eventTypeInput?: string;
  answered?: boolean;
  wentToVoicemail?: boolean;
  durationSeconds?: number;
  endedAt?: Date;
  failureReason?: string;
}): CallSessionStatus | undefined => {
  const status = input.statusInput?.toLowerCase();
  const eventType = input.eventTypeInput?.toLowerCase();
  const combined = `${status ?? ""} ${eventType ?? ""}`.trim();

  if (!combined && input.answered === undefined && !input.wentToVoicemail && !input.endedAt) {
    return undefined;
  }
  if (combined.includes("ring")) {
    return CallSessionStatus.RINGING;
  }
  if (combined.includes("answer") || combined.includes("connect") || combined.includes("in_progress")) {
    return CallSessionStatus.IN_PROGRESS;
  }
  if (
    combined.includes("complete") ||
    combined.includes("ended") ||
    combined.includes("end") ||
    combined.includes("finished")
  ) {
    return CallSessionStatus.COMPLETED;
  }
  if (combined.includes("miss")) {
    return CallSessionStatus.MISSED;
  }
  if (combined.includes("voice")) {
    return CallSessionStatus.VOICEMAIL;
  }
  if (combined.includes("cancel")) {
    return CallSessionStatus.CANCELED;
  }
  if (combined.includes("fail") || combined.includes("error")) {
    return CallSessionStatus.FAILED;
  }
  if (combined.includes("start") || combined.includes("receive")) {
    return CallSessionStatus.RECEIVED;
  }

  if (input.wentToVoicemail) {
    return CallSessionStatus.VOICEMAIL;
  }
  if (input.failureReason) {
    return CallSessionStatus.FAILED;
  }

  switch (eventType) {
    case "pre-call":
      return CallSessionStatus.RECEIVED;
    case "call-routing-complete":
      return input.answered === false ? CallSessionStatus.RINGING : CallSessionStatus.IN_PROGRESS;
    case "post-call":
      if (input.answered === false && !input.durationSeconds) {
        return CallSessionStatus.MISSED;
      }
      return CallSessionStatus.COMPLETED;
    case "call-modified":
      if (input.answered === false && !input.durationSeconds && !input.endedAt) {
        return CallSessionStatus.MISSED;
      }
      if (input.endedAt || input.durationSeconds !== undefined || input.answered === true) {
        return CallSessionStatus.COMPLETED;
      }
      return undefined;
    default:
      return combined ? CallSessionStatus.UNKNOWN : undefined;
  }
};

const parseTranscriptText = (payload: Record<string, unknown>): string | undefined => {
  const candidates = [
    payload.transcript,
    payload.call_transcript,
    pullNested(payload, ["call", "transcript"]),
    pullNested(payload, ["recording", "transcript"]),
    pullNested(payload, ["transcription", "text"])
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
    const candidateRecord = asRecord(candidate);
    const text = candidateRecord ? asString(candidateRecord.text) : undefined;
    if (text) {
      return text;
    }
  }

  return undefined;
};

const parseDirection = (payload: Record<string, unknown>): string | undefined => {
  const candidates = [
    payload.direction,
    payload.call_direction,
    pullNested(payload, ["call", "direction"]),
    pullNested(payload, ["call", "call_direction"])
  ];

  for (const candidate of candidates) {
    const value = asString(candidate);
    if (value) {
      return value.toLowerCase();
    }
  }

  return undefined;
};

const parseRecordingUrl = (payload: Record<string, unknown>): string | undefined => {
  const candidates = [
    payload.recording_url,
    payload.recordingUrl,
    pullNested(payload, ["call", "recording_url"]),
    pullNested(payload, ["call", "recordingUrl"]),
    pullNested(payload, ["recording", "url"])
  ];

  for (const candidate of candidates) {
    const value = asString(candidate);
    if (value) {
      return value;
    }
  }

  return undefined;
};

const parseTranscriptSummary = (payload: Record<string, unknown>): string | undefined => {
  const candidates = [
    payload.transcript_summary,
    payload.call_summary,
    payload.summary,
    pullNested(payload, ["call", "transcript_summary"]),
    pullNested(payload, ["call", "call_summary"]),
    pullNested(payload, ["transcription", "summary"])
  ];

  for (const candidate of candidates) {
    const value = asString(candidate);
    if (value) {
      return value;
    }
  }

  return undefined;
};

export class CallRailProviderAdapter implements CallProviderAdapter {
  public readonly provider = ExternalProvider.CALLRAIL;

  public normalizeWebhook(
    payload: unknown,
    rawBody: string,
    headers: Record<string, string | string[] | undefined>
  ): NormalizedCallWebhook {
    const payloadRecord = asRecord(payload);
    if (!payloadRecord) {
      throw new AppError("Invalid CallRail payload.", 400, "CALLRAIL_INVALID_PAYLOAD");
    }

    const eventType =
      asString(payloadRecord.event_type) ??
      asString(payloadRecord.event) ??
      asString(payloadRecord.type) ??
      asString(payloadRecord.action) ??
      "unknown_event";

    const callRecord = asRecord(payloadRecord.call);
    const providerCallId =
      asString(payloadRecord.call_id) ??
      asString(payloadRecord.lead_id) ??
      asString(payloadRecord.session_id) ??
      (callRecord ? asString(callRecord.id) : undefined) ??
      asString(payloadRecord.id);

    if (!providerCallId) {
      throw new AppError("Missing provider call ID in CallRail payload.", 400, "CALLRAIL_INVALID_PAYLOAD");
    }

    const callerPhone = normalizePhoneForMatching(
      asString(payloadRecord.customer_phone_number) ??
        asString(payloadRecord.caller_number) ??
        asString(payloadRecord.caller_phone_number) ??
        asString(payloadRecord.from) ??
        (callRecord
          ? asString(callRecord.customer_phone_number) ??
            asString(callRecord.caller_number) ??
            asString(callRecord.from)
          : undefined)
    );
    const dialedPhone = normalizePhoneForMatching(
      asString(payloadRecord.tracking_phone_number) ??
        asString(payloadRecord.called_number) ??
        asString(payloadRecord.to) ??
        (callRecord
          ? asString(callRecord.tracking_phone_number) ??
            asString(callRecord.called_number) ??
            asString(callRecord.to)
          : undefined)
    );
    const trackingNumber = normalizePhoneForMatching(
      asString(payloadRecord.tracking_number) ??
        asString(payloadRecord.tracking_phone_number) ??
        (callRecord
          ? asString(callRecord.tracking_number) ?? asString(callRecord.tracking_phone_number)
          : undefined)
    );
    const originalPhoneNumber = normalizePhoneForMatching(
      asString(payloadRecord.original_phone_number) ??
        asString(payloadRecord.business_phone_number) ??
        asString(payloadRecord.business_number) ??
        (callRecord
          ? asString(callRecord.original_phone_number) ??
            asString(callRecord.business_phone_number) ??
            asString(callRecord.business_number)
          : undefined)
    );
    const answered =
      asBoolean(payloadRecord.answered) ??
      asBoolean(payloadRecord.was_answered) ??
      asBoolean(payloadRecord.connected) ??
      (callRecord
        ? asBoolean(callRecord.answered) ??
          asBoolean(callRecord.was_answered) ??
          asBoolean(callRecord.connected)
        : undefined);
    const wentToVoicemail =
      asBoolean(payloadRecord.voicemail) ??
      asBoolean(payloadRecord.went_to_voicemail) ??
      asBoolean(payloadRecord.left_voicemail) ??
      (callRecord
        ? asBoolean(callRecord.voicemail) ??
          asBoolean(callRecord.went_to_voicemail) ??
          asBoolean(callRecord.left_voicemail)
        : undefined);
    const endedAt =
      asDate(payloadRecord.ended_at) ??
      asDate(payloadRecord.end_time) ??
      (callRecord ? asDate(callRecord.ended_at) ?? asDate(callRecord.end_time) : undefined);
    const durationSeconds =
      asNumber(payloadRecord.duration_seconds) ??
      asNumber(payloadRecord.duration) ??
      (callRecord ? asNumber(callRecord.duration_seconds) ?? asNumber(callRecord.duration) : undefined);
    const failureReason =
      asString(payloadRecord.failure_reason) ??
      asString(payloadRecord.error_message) ??
      (callRecord ? asString(callRecord.failure_reason) ?? asString(callRecord.error_message) : undefined);

    const status = mapStatus({
      statusInput:
        asString(payloadRecord.status) ??
        asString(payloadRecord.call_status) ??
        (callRecord ? asString(callRecord.status) ?? asString(callRecord.call_status) : undefined),
      eventTypeInput: eventType,
      answered,
      wentToVoicemail,
      durationSeconds,
      endedAt,
      failureReason
    });

    const signatureVerified = verifyWebhookSignature(rawBody, headers);
    if (env.CALLRAIL_WEBHOOK_SECRET?.trim() && !signatureVerified) {
      throw new AppError("CallRail webhook signature verification failed.", 401, "CALLRAIL_INVALID_SIGNATURE");
    }

    const transcriptText = parseTranscriptText(payloadRecord);
    const recordingUrl = parseRecordingUrl(payloadRecord);

    return {
      signatureVerified,
      event: {
        provider: ExternalProvider.CALLRAIL,
        providerCallId,
        providerEventId:
          asString(payloadRecord.event_id) ??
          asString(payloadRecord.webhook_event_id) ??
          asString(payloadRecord.eventId),
        providerAccountId:
          asString(payloadRecord.account_id) ??
          (callRecord ? asString(callRecord.account_id) : undefined),
        providerCompanyId:
          asString(payloadRecord.company_id) ??
          (callRecord ? asString(callRecord.company_id) : undefined),
        salonIdHint:
          asUuid(payloadRecord.salon_id) ??
          asUuid(payloadRecord.salonId) ??
          (callRecord ? asUuid(callRecord.salon_id) ?? asUuid(callRecord.salonId) : undefined),
        eventType,
        eventTimestamp:
          asDate(payloadRecord.event_time) ??
          asDate(payloadRecord.event_timestamp) ??
          asDate(payloadRecord.timestamp) ??
          (callRecord
            ? asDate(callRecord.updated_at) ?? asDate(callRecord.created_at) ?? asDate(callRecord.start_time)
            : undefined),
        status,
        callerPhone,
        originalPhoneNumber,
        dialedPhone,
        trackingNumber,
        direction: parseDirection(payloadRecord) ?? "inbound",
        sourceName:
          asString(payloadRecord.source) ??
          asString(payloadRecord.source_name) ??
          (callRecord ? asString(callRecord.source) : undefined),
        campaignName:
          asString(payloadRecord.campaign) ??
          asString(payloadRecord.campaign_name) ??
          (callRecord ? asString(callRecord.campaign_name) : undefined),
        startedAt:
          asDate(payloadRecord.started_at) ??
          asDate(payloadRecord.start_time) ??
          (callRecord ? asDate(callRecord.started_at) ?? asDate(callRecord.start_time) : undefined),
        answeredAt:
          asDate(payloadRecord.answered_at) ??
          asDate(payloadRecord.answer_time) ??
          (callRecord ? asDate(callRecord.answered_at) ?? asDate(callRecord.answer_time) : undefined),
        endedAt,
        durationSeconds,
        recordingUrl,
        transcriptText,
        transcriptSummary:
          parseTranscriptSummary(payloadRecord) ??
          (callRecord ? parseTranscriptSummary(callRecord) : undefined),
        failureReason,
        bookingResult:
          payloadRecord.booking_result ??
          pullNested(payloadRecord, ["call", "booking_result"]) ??
          undefined,
        rawPayload: payloadRecord
      }
    };
  }
}
