import { CallSessionStatus, ExternalProvider } from "@prisma/client";

export interface NormalizedCallEvent {
  provider: ExternalProvider;
  providerCallId: string;
  providerEventId?: string;
  providerAccountId?: string;
  providerCompanyId?: string;
  salonIdHint?: string;
  eventType: string;
  eventTimestamp?: Date;
  status?: CallSessionStatus;
  callerPhone?: string;
  dialedPhone?: string;
  trackingNumber?: string;
  sourceName?: string;
  campaignName?: string;
  startedAt?: Date;
  endedAt?: Date;
  durationSeconds?: number;
  transcriptText?: string;
  transcriptSummary?: string;
  failureReason?: string;
  bookingResult?: unknown;
  rawPayload: Record<string, unknown>;
}

export interface NormalizedCallWebhook {
  event: NormalizedCallEvent;
  signatureVerified: boolean;
}

export interface CallProviderAdapter {
  provider: ExternalProvider;
  normalizeWebhook(
    payload: unknown,
    rawBody: string,
    headers: Record<string, string | string[] | undefined>
  ): NormalizedCallWebhook;
}
