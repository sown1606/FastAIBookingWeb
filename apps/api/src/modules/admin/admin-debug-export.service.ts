import {
  ConnectClient,
  DescribeContactCommand,
  DescribeContactFlowCommand,
  GetContactAttributesCommand,
  ListFlowAssociationsCommand,
  SearchContactsCommand
} from "@aws-sdk/client-connect";
import { ExternalProvider, Prisma } from "@prisma/client";
import { env } from "../../config/env";
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

type ProviderContactSummary = {
  contactId: string;
  applicationSessionFound: boolean;
  initialContactId?: string | null;
  relatedContactIds?: string[];
  initiatedAt?: string | null;
  disconnectedAt?: string | null;
  disconnectReason?: string | null;
  initiationMethod?: string | null;
  queue?: Record<string, unknown> | null;
  agent?: Record<string, unknown> | null;
  contactAttributes?: Record<string, unknown> | null;
  associatedFlowId?: string | null;
  associatedFlowArn?: string | null;
  flowVersion?: number | null;
  flowStatus?: string | null;
  flowState?: string | null;
  lexAliasArn?: string | null;
  lexBotId?: string | null;
  lexAliasId?: string | null;
  lexVersion?: string | null;
  lambdaInvoked?: boolean;
  providerTraceUnavailableReason?: string | null;
};

type ProviderTraceEnrichment = {
  contacts: ProviderContactSummary[];
  providerOnlyContacts: ProviderContactSummary[];
  providerTraceUnavailableReason?: string | null;
  limitations?: string[];
};

type ProviderTraceRecordInput = {
  contactIds: string[];
  applicationContactIds: Set<string>;
  callerPhone?: string | null;
  calledNumbers: string[];
  startedAt?: unknown;
  endedAt?: unknown;
};

type ProviderTraceEnricher = (
  records: ProviderTraceRecordInput[]
) => Promise<ProviderTraceEnrichment>;

let providerTraceEnricherForTest: ProviderTraceEnricher | null = null;

export const setAdminDebugProviderTraceEnricherForTest = (
  enricher: ProviderTraceEnricher | null
) => {
  providerTraceEnricherForTest = enricher;
};

const compactValues = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
    )
  );

const normalizePhoneDigits = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\D/g, "") : "";

const valuesOverlapByPhoneDigits = (left: unknown[], right: unknown[]): boolean => {
  const rightDigits = new Set(right.map(normalizePhoneDigits).filter(Boolean));
  return left.map(normalizePhoneDigits).filter(Boolean).some((value) => rightDigits.has(value));
};

const jsonStringToRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return readRecord(parsed);
  } catch {
    return {};
  }
};

const maybeParseJsonValue = (value: unknown): unknown => {
  if (typeof value !== "string" || !value.trim()) {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const toIsoOrNull = (value: unknown): string | null => {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
};

const withTimeout = async <T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>
): Promise<R[]> => {
  const results: R[] = [];
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  });
  await Promise.all(workers);
  return results;
};

const readCompactContactAttributes = (
  attributes: Record<string, string> | undefined
): Record<string, unknown> | null => {
  const source = attributes ?? {};
  const keys = [
    "connectRecoveryStage",
    "connectLastErrorBranch",
    "connectFlowSourceVersion",
    "outerRecoveryAttempt",
    "conversationState",
    "conversationOutcome",
    "conversationComplete",
    "transferToQueue",
    "callSessionId",
    "amazonConnectContactId",
    "AmazonConnectContactId",
    "InitialContactId",
    "CallerId",
    "CustomerEndpointAddress",
    "SystemEndpointAddress",
    "CalledNumber",
    "calledNumber"
  ];
  const compact = Object.fromEntries(
    keys
      .map((key) => [key, source[key]] as const)
      .filter(([, value]) => value !== undefined && value !== "")
  );
  return Object.keys(compact).length ? compact : null;
};

const readLexAliasSummaryFromFlowContent = (
  content: string | undefined
): Pick<ProviderContactSummary, "lexAliasArn" | "lexBotId" | "lexAliasId" | "lexVersion"> => {
  if (!content) {
    return {};
  }
  try {
    const flow = JSON.parse(content);
    const action = Array.isArray(flow.Actions)
      ? flow.Actions.find((item: Record<string, unknown>) => item.Type === "ConnectParticipantWithLexBot")
      : null;
    const aliasArn = readNestedValue(action, ["Parameters", "LexV2Bot", "AliasArn"]);
    if (typeof aliasArn !== "string" || !aliasArn.trim()) {
      return {};
    }
    const match = aliasArn.match(/bot-alias\/([^/]+)\/([^/]+)$/);
    return {
      lexAliasArn: aliasArn,
      lexBotId: match?.[1] ?? null,
      lexAliasId: match?.[2] ?? null,
      lexVersion: null
    };
  } catch {
    return {};
  }
};

const compactQueueInfo = (value: unknown): Record<string, unknown> | null => {
  const record = readRecord(value);
  const compact = {
    id: record.Id,
    enqueueTimestamp: toIsoOrNull(record.EnqueueTimestamp)
  };
  return Object.values(compact).some((item) => item !== undefined && item !== null) ? compact : null;
};

const compactAgentInfo = (value: unknown): Record<string, unknown> | null => {
  const record = readRecord(value);
  const compact = {
    id: record.Id,
    connectedToAgentTimestamp: toIsoOrNull(record.ConnectedToAgentTimestamp)
  };
  return Object.values(compact).some((item) => item !== undefined && item !== null) ? compact : null;
};

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

const getConfiguredProviderFlowSummary = async (
  client: ConnectClient,
  instanceId: string
) => {
  const flowId = env.AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION ?? env.AMAZON_CONNECT_CONTACT_FLOW_ID;
  const phoneNumberId = env.AMAZON_CONNECT_PHONE_NUMBER_ID;
  const summary: Pick<
    ProviderContactSummary,
    "associatedFlowId" | "associatedFlowArn" | "flowVersion" | "flowStatus" | "flowState" | "lexAliasArn" | "lexBotId" | "lexAliasId" | "lexVersion"
  > = {
    associatedFlowId: flowId ?? null,
    associatedFlowArn: flowId
      ? `arn:aws:connect:${env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? "us-east-1"}:*:instance/${instanceId}/contact-flow/${flowId}`
      : null
  };

  try {
    if (phoneNumberId) {
      const association = await withTimeout(
        client.send(
          new ListFlowAssociationsCommand({
            InstanceId: instanceId,
            ResourceType: "VOICE_PHONE_NUMBER"
          })
        ),
        3_000,
        "ListFlowAssociations"
      );
      const resourceIdSuffix = `phone-number/${phoneNumberId}`;
      const activeAssociation = association.FlowAssociationSummaryList?.find((item) =>
        item.ResourceId?.endsWith(resourceIdSuffix)
      );
      if (activeAssociation?.FlowId) {
        summary.associatedFlowArn = activeAssociation.FlowId;
        summary.associatedFlowId = activeAssociation.FlowId.split("/").pop() ?? activeAssociation.FlowId;
      }
    }
  } catch {
    // Flow association is best-effort for debug export.
  }

  const associatedFlowId = summary.associatedFlowId ?? flowId;
  if (associatedFlowId) {
    try {
      const flow = await withTimeout(
        client.send(
          new DescribeContactFlowCommand({
            InstanceId: instanceId,
            ContactFlowId: associatedFlowId
          })
        ),
        3_000,
        "DescribeContactFlow"
      );
      summary.associatedFlowId = flow.ContactFlow?.Id ?? summary.associatedFlowId ?? null;
      summary.associatedFlowArn = flow.ContactFlow?.Arn ?? summary.associatedFlowArn ?? null;
      summary.flowVersion = flow.ContactFlow?.Version ?? null;
      summary.flowStatus = flow.ContactFlow?.Status ?? null;
      summary.flowState = flow.ContactFlow?.State ?? null;
      Object.assign(summary, readLexAliasSummaryFromFlowContent(flow.ContactFlow?.Content));
    } catch {
      // Keep the association values when flow content is unavailable.
    }
  }

  return summary;
};

const describeProviderContact = async (input: {
  client: ConnectClient;
  instanceId: string;
  contactId: string;
  applicationSessionFound: boolean;
  lambdaInvoked: boolean;
  flowSummary: Partial<ProviderContactSummary>;
}): Promise<ProviderContactSummary> => {
  try {
    const [contactResult, attributesResult] = await Promise.all([
      withTimeout(
        input.client.send(
          new DescribeContactCommand({
            InstanceId: input.instanceId,
            ContactId: input.contactId
          })
        ),
        3_000,
        "DescribeContact"
      ),
      withTimeout(
        input.client.send(
          new GetContactAttributesCommand({
            InstanceId: input.instanceId,
            InitialContactId: input.contactId
          })
        ),
        3_000,
        "GetContactAttributes"
      ).catch(() => ({ Attributes: undefined }))
    ]);
    const contact = contactResult.Contact;
    const relatedContactIds = compactValues([
      contact?.PreviousContactId,
      contact?.ContactAssociationId
    ]);
    return {
      contactId: contact?.Id ?? input.contactId,
      applicationSessionFound: input.applicationSessionFound,
      initialContactId: contact?.InitialContactId ?? null,
      relatedContactIds,
      initiatedAt: toIsoOrNull(contact?.InitiationTimestamp),
      disconnectedAt: toIsoOrNull(contact?.DisconnectTimestamp),
      disconnectReason: contact?.DisconnectReason ?? null,
      initiationMethod: contact?.InitiationMethod ?? null,
      queue: compactQueueInfo(contact?.QueueInfo),
      agent: compactAgentInfo(contact?.AgentInfo),
      contactAttributes: readCompactContactAttributes(attributesResult.Attributes),
      associatedFlowId: input.flowSummary.associatedFlowId ?? null,
      associatedFlowArn: input.flowSummary.associatedFlowArn ?? null,
      flowVersion: input.flowSummary.flowVersion ?? null,
      flowStatus: input.flowSummary.flowStatus ?? null,
      flowState: input.flowSummary.flowState ?? null,
      lexAliasArn: input.flowSummary.lexAliasArn ?? null,
      lexBotId: input.flowSummary.lexBotId ?? null,
      lexAliasId: input.flowSummary.lexAliasId ?? null,
      lexVersion: input.flowSummary.lexVersion ?? null,
      lambdaInvoked: input.lambdaInvoked
    };
  } catch (error) {
    return {
      contactId: input.contactId,
      applicationSessionFound: input.applicationSessionFound,
      providerTraceUnavailableReason: error instanceof Error ? error.message : String(error),
      lambdaInvoked: input.lambdaInvoked
    };
  }
};

const defaultProviderTraceEnricher: ProviderTraceEnricher = async (records) => {
  const instanceId = env.AMAZON_CONNECT_INSTANCE_ID;
  if (!instanceId) {
    return {
      contacts: [],
      providerOnlyContacts: [],
      providerTraceUnavailableReason: "AMAZON_CONNECT_INSTANCE_ID is not configured",
      limitations: ["Amazon Connect enrichment skipped"]
    };
  }
  if (process.env.NODE_ENV === "test") {
    return {
      contacts: [],
      providerOnlyContacts: [],
      providerTraceUnavailableReason: "Amazon Connect enrichment disabled in tests",
      limitations: ["Use setAdminDebugProviderTraceEnricherForTest for provider trace tests"]
    };
  }

  try {
    const client = new ConnectClient({
      region: env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? "us-east-1"
    });
    const flowSummary = await getConfiguredProviderFlowSummary(client, instanceId);
    const appContactIds = new Set(records.flatMap((record) => Array.from(record.applicationContactIds)));
    const selectedContactIds = compactValues(records.flatMap((record) => record.contactIds)).slice(0, 20);

    const described = await mapWithConcurrency(selectedContactIds, 4, (contactId) =>
      describeProviderContact({
        client,
        instanceId,
        contactId,
        applicationSessionFound: appContactIds.has(contactId),
        lambdaInvoked: appContactIds.has(contactId),
        flowSummary
      })
    );

    const startTimes = records.map((record) => toIsoOrNull(record.startedAt)).filter((value): value is string => Boolean(value));
    const endTimes = records
      .map((record) => toIsoOrNull(record.endedAt) ?? toIsoOrNull(record.startedAt))
      .filter((value): value is string => Boolean(value));
    const providerOnlyContacts: ProviderContactSummary[] = [];
    if (startTimes.length && endTimes.length) {
      const startMs = Math.min(...startTimes.map((value) => new Date(value).getTime())) - 2 * 60_000;
      const endMs = Math.max(...endTimes.map((value) => new Date(value).getTime())) + 2 * 60_000;
      const boundedEndMs = Math.min(endMs, startMs + 35 * 60_000);
      const search = await withTimeout(
        client.send(
          new SearchContactsCommand({
            InstanceId: instanceId,
            TimeRange: {
              Type: "INITIATION_TIMESTAMP",
              StartTime: new Date(startMs),
              EndTime: new Date(boundedEndMs)
            },
            SearchCriteria: {
              Channels: ["VOICE"],
              InitiationMethods: ["INBOUND"]
            },
            MaxResults: 50
          })
        ),
        5_000,
        "SearchContacts"
      );
      const searchedContactIds = compactValues((search.Contacts ?? []).map((contact) => contact.Id));
      const unseenContactIds = searchedContactIds.filter((contactId) => !appContactIds.has(contactId));
      const candidates = await mapWithConcurrency(unseenContactIds.slice(0, 20), 4, (contactId) =>
        describeProviderContact({
          client,
          instanceId,
          contactId,
          applicationSessionFound: false,
          lambdaInvoked: false,
          flowSummary
        })
      );
      for (const candidate of candidates) {
        const attrs = readRecord(candidate.contactAttributes);
        const callerValues = [attrs.CallerId, attrs.CustomerEndpointAddress];
        const calledValues = [attrs.SystemEndpointAddress, attrs.CalledNumber, attrs.calledNumber];
        const matchingRecord = records.find(
          (record) =>
            valuesOverlapByPhoneDigits(callerValues, [record.callerPhone]) &&
            valuesOverlapByPhoneDigits(calledValues, record.calledNumbers)
        );
        if (matchingRecord) {
          providerOnlyContacts.push(candidate);
        }
      }
    }

    return {
      contacts: described,
      providerOnlyContacts,
      limitations: []
    };
  } catch (error) {
    return {
      contacts: [],
      providerOnlyContacts: [],
      providerTraceUnavailableReason: error instanceof Error ? error.message : String(error),
      limitations: ["Amazon Connect trace enrichment failed"]
    };
  }
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

const compactAsrDiagnosticsForGpt = (value: unknown) => {
  const parsed = maybeParseJsonValue(value);
  const record = readRecord(parsed);
  const alternatives = Array.isArray(record.nBestAlternatives)
    ? record.nBestAlternatives
        .map((item) => {
          const itemRecord = readRecord(item);
          const transcript =
            typeof item === "string"
              ? item
              : typeof itemRecord.transcript === "string"
                ? itemRecord.transcript
                : typeof itemRecord.transcription === "string"
                  ? itemRecord.transcription
                  : null;
          if (!transcript) {
            return null;
          }
          const confidence = itemRecord.confidence ?? itemRecord.score;
          return {
            transcript,
            confidence: typeof confidence === "number" ? confidence : undefined
          };
        })
        .filter(Boolean)
        .slice(0, 5)
    : undefined;
  const compact = {
    topTranscript: record.topTranscript,
    nBestAlternatives: alternatives,
    confidence: record.confidence,
    inputMode: record.inputMode
  };
  return Object.values(compact).some((item) => item !== undefined) ? compact : null;
};

const compactProviderTimingForGpt = (rawPayload: unknown) => {
  const timing = readRecord(readRecord(rawPayload).providerTiming);
  const compact = {
    source: timing.source,
    providerInitiatedAt: timing.providerInitiatedAt,
    providerDisconnectedAt: timing.providerDisconnectedAt,
    applicationFirstSeenAt: timing.applicationFirstSeenAt,
    answeredAt: timing.answeredAt ?? null,
    limitations: Array.isArray(timing.limitations) ? timing.limitations : undefined
  };
  return Object.values(compact).some((item) => item !== undefined && item !== null)
    ? compact
    : {
        source: "application_session",
        providerInitiatedAt: null,
        providerDisconnectedAt: null,
        applicationFirstSeenAt: null,
        answeredAt: null,
        limitations: ["Provider timing reconciliation has not populated this call session."]
      };
};

const readStateValue = (
  diagnostics: Record<string, unknown>,
  sessionAttributes: Record<string, unknown>,
  key: string
) => diagnostics[key] ?? sessionAttributes[key];

const buildCompactTurnStateSnapshot = (turn: Record<string, unknown>) => {
  const diagnostics = readRecord(turn.turnStateDiagnostics);
  const sessionAttributes = readRecord(turn.sessionAttributesAfter);
  const activeOptions = readStateValue(diagnostics, sessionAttributes, "activeDtmfOptionsJson");
  const snapshot = {
    lastAskedSlot: turn.lastAskedSlotAfter ?? sessionAttributes.lastAskedSlot,
    slotToElicit: turn.slotToElicit,
    dialogAction: turn.dialogAction,
    activeDtmfMenu: turn.activeDtmfMenuAfter ?? sessionAttributes.activeDtmfMenu,
    activeDtmfOptionsJson:
      typeof activeOptions === "string" ? activeOptions : undefined,
    serviceRecognitionFailureCount: readStateValue(diagnostics, sessionAttributes, "serviceRecognitionFailureCount"),
    staffRecognitionFailureCount: readStateValue(diagnostics, sessionAttributes, "staffRecognitionFailureCount"),
    excludedStaffIds: readStateValue(diagnostics, sessionAttributes, "excludedStaffIds"),
    excludedStaffNames: readStateValue(diagnostics, sessionAttributes, "excludedStaffNames"),
	    awaitingFinalBookingConfirmation: readStateValue(diagnostics, sessionAttributes, "awaitingFinalBookingConfirmation"),
    awaitingRejectedBookingChoice: readStateValue(diagnostics, sessionAttributes, "awaitingRejectedBookingChoice"),
	    conversationState: readStateValue(diagnostics, sessionAttributes, "conversationState"),
    conversationOutcome: readStateValue(diagnostics, sessionAttributes, "conversationOutcome"),
    conversationComplete: readStateValue(diagnostics, sessionAttributes, "conversationComplete"),
    transferToQueue: readStateValue(diagnostics, sessionAttributes, "transferToQueue"),
    outerRecoveryAttempt: readStateValue(diagnostics, sessionAttributes, "outerRecoveryAttempt"),
    connectRecoveryStage: readStateValue(diagnostics, sessionAttributes, "connectRecoveryStage")
  };
  return Object.fromEntries(
    Object.entries(snapshot).filter(([, value]) => value !== undefined && value !== null)
  );
};

const normalizeTurnForGpt = (turn: Record<string, unknown>) => {
  const diagnostics = readRecord(turn.turnStateDiagnostics);
  const turnStateSnapshot = buildCompactTurnStateSnapshot(turn);
  const asrDiagnostics = compactAsrDiagnosticsForGpt(
    diagnostics.asrDiagnostics ??
      readRecord(turn.sessionAttributesAfter).asrDiagnostics
  );
  const latencyMetrics = {
    providerTranscriptTimestamp: turn.providerTranscriptTimestamp ?? diagnostics.providerTranscriptTimestamp,
    lambdaReceivedAt: turn.lambdaReceivedAt ?? diagnostics.lambdaReceivedAt,
    apiStartedAt: turn.apiStartedAt ?? diagnostics.apiStartedAt,
    apiCompletedAt: turn.apiCompletedAt ?? diagnostics.apiCompletedAt,
    lambdaRespondedAt: turn.lambdaRespondedAt ?? diagnostics.lambdaRespondedAt,
    lambdaProcessingMs: turn.lambdaProcessingMs ?? diagnostics.lambdaProcessingMs,
    apiProcessingMs: turn.apiProcessingMs ?? diagnostics.apiProcessingMs,
	    connectBranch: turn.connectBranch ?? diagnostics.connectBranch,
	    promptText: turn.promptText ?? diagnostics.promptText,
	    promptExpectedToPlay: turn.promptExpectedToPlay ?? diagnostics.promptExpectedToPlay,
	    promptPlaybackConfirmed: turn.promptPlaybackConfirmed ?? diagnostics.promptPlaybackConfirmed,
	    playbackEvidenceStage: turn.playbackEvidenceStage ?? diagnostics.playbackEvidenceStage,
	    lambdaResponseFingerprint: turn.lambdaResponseFingerprint ?? diagnostics.lambdaResponseFingerprint,
	    dialogActionType: turn.dialogActionType ?? diagnostics.dialogActionType,
	    messageContentType: turn.messageContentType ?? diagnostics.messageContentType,
	    ssmlValidation: turn.ssmlValidation ?? diagnostics.ssmlValidation,
	    providerDisconnectedAt: turn.providerDisconnectedAt ?? diagnostics.providerDisconnectedAt,
    providerContactInitiatedAt: diagnostics.providerContactInitiatedAt,
    providerInputStartedAt: diagnostics.providerInputStartedAt,
    providerInputEndedAt: diagnostics.providerInputEndedAt,
    lexRequestReceivedAt: diagnostics.lexRequestReceivedAt,
    lambdaHandlerStartedAt: diagnostics.lambdaHandlerStartedAt,
    internalApiStartedAt: diagnostics.internalApiStartedAt,
    internalApiCompletedAt: diagnostics.internalApiCompletedAt,
    availabilityQueryDurationMs: diagnostics.availabilityQueryDurationMs,
    lambdaDurationMs: diagnostics.lambdaDurationMs,
    unavailable: diagnostics.latencyUnavailableReason
  };
  const item: Record<string, unknown> = {
    index: turn.index,
	    providerTurnId: diagnostics.providerTurnId ?? null,
    humanTurnId: diagnostics.humanTurnId ?? null,
    providerRequestId: diagnostics.providerRequestId ?? null,
	    lexRequestId: diagnostics.lexRequestId ?? null,
    lexPhase: diagnostics.lexPhase ?? null,
    transcriptFingerprint: diagnostics.transcriptFingerprint ?? turn.transcriptFingerprint ?? null,
    turnSequence: {
      before: diagnostics.turnSequenceBefore ?? null,
      after: diagnostics.turnSequenceAfter ?? null
    },
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
    missingFields: turn.missingFields ?? null,
    turnStateSnapshot: Object.keys(turnStateSnapshot).length ? turnStateSnapshot : null,
    asrDiagnostics,
    latencyMetrics: Object.values(latencyMetrics).some((value) => value !== undefined)
      ? latencyMetrics
      : {
          unavailable: "Provider speech endpointing and prompt playback timestamps are not present in current Lex events."
        },
    finalConnectBranch: diagnostics.finalConnectBranch ?? diagnostics.connectLastErrorBranch ?? null,
    lexDiagnostics: {
      noInput: diagnostics.lexNoInputReason ?? null,
      noMatch: diagnostics.lexNoMatchReason ?? null,
      error: diagnostics.lexErrorReason ?? null
    },
    stateVersion: {
      before: diagnostics.stateVersionBefore ?? diagnostics.turnSequenceBefore ?? null,
      after: diagnostics.stateVersionAfter ?? diagnostics.turnSequenceAfter ?? null
    },
	    staleOrDuplicateRejectionReason: diagnostics.staleOrDuplicateRejectionReason ?? null,
    duplicateDisposition: diagnostics.duplicateDisposition ?? turn.duplicateDisposition ?? null,
    providerRequestIdReuseDetected: diagnostics.providerRequestIdReuseDetected ?? null,
    dateDecision: diagnostics.dateDecision ?? null
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
  providerTiming: compactProviderTimingForGpt(call.rawPayload),
  bookingResult: call.bookingResult,
  failureReason: call.failureReason,
  finalResolution: call.finalResolution
});

const getCalledNumbersForCall = (call: CallDebugSession): string[] =>
  compactValues([
    call.dialedPhone,
    call.trackingNumber,
    call.originalPhoneNumber
  ]);

const buildProviderTraceRecordInputsForCalls = (
  calls: CallDebugSession[]
): ProviderTraceRecordInput[] =>
  calls
    .filter((call) => call.provider === ExternalProvider.AMAZON_CONNECT)
    .map((call) => {
      const contactIds = readCallContactIds(call);
      return {
        contactIds,
        applicationContactIds: new Set(contactIds),
        callerPhone: call.callerPhone,
        calledNumbers: getCalledNumbersForCall(call),
        startedAt: call.startedAt,
        endedAt: call.endedAt
      };
    });

const summarizeProviderCoverage = (input: {
  records: Record<string, unknown>[];
  providerTrace?: ProviderTraceEnrichment;
}) => {
  const providerContacts = input.providerTrace?.contacts ?? [];
  const providerOnlyContacts = input.providerTrace?.providerOnlyContacts ?? [];
  const limitations = [
    ...(input.providerTrace?.limitations ?? []),
    ...(input.providerTrace?.providerTraceUnavailableReason
      ? [input.providerTrace.providerTraceUnavailableReason]
      : [])
  ];
  return {
    applicationSessionFound: input.records.some((record) => Boolean(record.call)),
    providerContactFound: providerContacts.length > 0 || providerOnlyContacts.length > 0,
    providerTraceFound: !input.providerTrace?.providerTraceUnavailableReason,
    limitations
  };
};

const applyProviderTraceToGptRecords = async (
  records: Record<string, unknown>[],
  calls: CallDebugSession[]
): Promise<ProviderTraceEnrichment> => {
  if (!records.length) {
    return {
      contacts: [],
      providerOnlyContacts: [],
      limitations: ["No records selected"]
    };
  }
  const inputs = buildProviderTraceRecordInputsForCalls(calls);
  if (!inputs.length) {
    return {
      contacts: [],
      providerOnlyContacts: [],
      limitations: ["No Amazon Connect call sessions selected"]
    };
  }
  const enrichment = await (providerTraceEnricherForTest ?? defaultProviderTraceEnricher)(inputs);
  const providerContactsById = new Map(enrichment.contacts.map((contact) => [contact.contactId, contact]));

  for (const record of records) {
    const contactIds = Array.isArray(record.contactIds)
      ? record.contactIds.filter((value): value is string => typeof value === "string")
      : [];
    const providerContacts = contactIds
      .map((contactId) => providerContactsById.get(contactId))
      .filter((contact): contact is ProviderContactSummary => Boolean(contact));
    const call = readRecord(record.call);
    const warnings = [
      ...(Array.isArray(record.warnings) ? record.warnings : []),
      ...(call.status === "IN_PROGRESS" || !call.endedAt
        ? ["Application call session is not finalized; provider timestamps are authoritative when present."]
        : [])
    ];
    Object.assign(record, {
      coverage: {
        applicationSessionFound: Boolean(record.call),
        providerContactFound: providerContacts.length > 0,
        providerTraceFound: providerContacts.length > 0 && !enrichment.providerTraceUnavailableReason,
        limitations: enrichment.providerTraceUnavailableReason ? [enrichment.providerTraceUnavailableReason] : []
      },
      providerContacts,
      providerTraceUnavailableReason: enrichment.providerTraceUnavailableReason ?? undefined,
      warnings
    });
  }

  return enrichment;
};

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
  const records = (requestedIds
    .map((id) => byId.get(id))
    .filter((call): call is CallDebugSession => Boolean(call))
    .map((call) =>
      buildCanonicalCallDebugRecord(call, exportedAt, mode, {
        sourcePage: "call_logs",
        selectedCallSessionIds: [call.id]
      })
    ) as Record<string, unknown>[]);
  const providerTrace =
    mode === "gpt"
      ? await applyProviderTraceToGptRecords(records, calls)
      : undefined;
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
	    canonicalDeduplicationNote:
	      "Call Logs and AI Logs debug exports use one canonical call record when selections resolve to the same calls.",
	    coverage: mode === "gpt" ? summarizeProviderCoverage({ records, providerTrace }) : undefined,
	    providerOnlyContacts: mode === "gpt" ? providerTrace?.providerOnlyContacts ?? [] : undefined,
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

  const records = (plans.map((plan) =>
    plan.callSession
      ? buildCanonicalCallDebugRecord(plan.callSession, exportedAt, mode, {
          sourcePage: "ai_logs",
          selectedAiInteractionIds: plan.selectedAiInteractionIds
        })
      : buildDetachedAIRecord(plan.interactions, exportedAt, mode, {
          sourcePage: "ai_logs",
          selectedAiInteractionIds: plan.selectedAiInteractionIds
        })
  ) as Record<string, unknown>[]);
  const providerTrace =
    mode === "gpt"
      ? await applyProviderTraceToGptRecords(
          records,
          plans.map((plan) => plan.callSession).filter((call): call is CallDebugSession => Boolean(call))
        )
      : undefined;
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
	    canonicalDeduplicationNote:
	      "Call Logs and AI Logs debug exports use one canonical call record when selections resolve to the same calls.",
	    coverage: mode === "gpt" ? summarizeProviderCoverage({ records, providerTrace }) : undefined,
	    providerOnlyContacts: mode === "gpt" ? providerTrace?.providerOnlyContacts ?? [] : undefined,
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
