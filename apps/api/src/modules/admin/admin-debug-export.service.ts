import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import {
  buildAdminDebugTimelineItems,
  buildAIInteractionCallDebugForAdminPayload
} from "../ai/ai.service";

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
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      key,
      isSensitiveDebugKey(key) ? "[REDACTED]" : sanitizeDebugJsonValue(nestedValue)
    ])
  );
};

const uniqueInOrder = (ids: string[]): string[] => Array.from(new Set(ids));

const callDebugInclude = {
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
    }
  },
  transcripts: {
    orderBy: {
      createdAt: "asc"
    }
  },
  bookingAttempts: {
    orderBy: {
      createdAt: "asc"
    },
    include: {
      appointment: {
        include: {
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
            include: {
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
    }
  },
  callEscalations: {
    orderBy: {
      createdAt: "asc"
    }
  }
} satisfies Prisma.CallSessionInclude;

type CallDebugSession = Prisma.CallSessionGetPayload<{ include: typeof callDebugInclude }>;

const buildCallDebugRecord = (call: CallDebugSession, exportedAt: string) =>
  sanitizeDebugJsonValue({
    schemaVersion: 1,
    exportedAt,
    exportType: "call_debug",
    callSession: {
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
      rawPayload: call.rawPayload,
      createdAt: call.createdAt,
      updatedAt: call.updatedAt,
      salon: call.salon
    },
    salonSummary: call.salon,
    events: call.events,
    transcripts: call.transcripts,
    bookingAttempts: call.bookingAttempts,
    appointmentReferences: call.bookingAttempts
      .map((attempt) => attempt.appointment)
      .filter((appointment): appointment is NonNullable<typeof appointment> => Boolean(appointment)),
    aiInteractions: call.aiInteractions,
    turnHistories: call.aiInteractions.flatMap((interaction, index) =>
      buildAdminDebugTimelineItems(interaction, index)
    ),
    escalationRecords: call.callEscalations,
    finalResolution: call.finalResolution
  });

export const getCallsDebugExportForAdmin = async (ids: string[]) => {
  const exportedAt = new Date().toISOString();
  const requestedIds = uniqueInOrder(ids);
  const calls = requestedIds.length
    ? await prisma.callSession.findMany({
        where: {
          id: {
            in: requestedIds
          }
        },
        include: callDebugInclude
      })
    : [];
  const byId = new Map(calls.map((call) => [call.id, call]));
  const records = requestedIds
    .map((id) => byId.get(id))
    .filter((call): call is CallDebugSession => Boolean(call))
    .map((call) => buildCallDebugRecord(call, exportedAt));

  return sanitizeDebugJsonValue({
    schemaVersion: 1,
    exportedAt,
    exportType: "multi_call_debug",
    requestedCount: ids.length,
    recordCount: records.length,
    notFoundIds: requestedIds.filter((id) => !byId.has(id)),
    records
  });
};

const aiInteractionDebugInclude = {
  callSession: true,
  bookingAttempt: true,
  transcript: true,
  salon: {
    select: {
      id: true,
      name: true
    }
  }
} satisfies Prisma.AiInteractionLogInclude;

const readRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const readNestedRecord = (value: unknown, key: string): Record<string, unknown> =>
  readRecord(readRecord(value)[key]);

const readNestedValue = (value: unknown, path: string[]): unknown =>
  path.reduce<unknown>((current, key) => readRecord(current)[key], value);

const compactValues = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
    )
  );

type AIInteractionDebugSource = Prisma.AiInteractionLogGetPayload<{
  include: typeof aiInteractionDebugInclude;
}>;

const readAIInteractionContactIds = (interaction: AIInteractionDebugSource): string[] => {
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

const getAIInteractionDedupKey = (interaction: AIInteractionDebugSource): string => {
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

export const getAIInteractionsDebugExportForAdmin = async (ids: string[]) => {
  const exportedAt = new Date().toISOString();
  const requestedIds = uniqueInOrder(ids);
  const selectedInteractions = requestedIds.length
    ? await prisma.aiInteractionLog.findMany({
        where: {
          id: {
            in: requestedIds
          }
        },
        include: aiInteractionDebugInclude
      })
    : [];
  const selectedById = new Map(selectedInteractions.map((interaction) => [interaction.id, interaction]));
  const foundInRequestedOrder = requestedIds
    .map((id) => selectedById.get(id))
    .filter((interaction): interaction is AIInteractionDebugSource => Boolean(interaction));

  const callSessionIds = uniqueInOrder(
    foundInRequestedOrder
      .map(getAIInteractionCallSessionId)
      .filter((id): id is string => Boolean(id))
  );
  const callSessions = callSessionIds.length
    ? await prisma.callSession.findMany({
        where: {
          id: {
            in: callSessionIds
          }
        },
        include: callDebugInclude
      })
    : [];
  const callSessionById = new Map(callSessions.map((call) => [call.id, call]));
  const records: unknown[] = [];
  const seenKeys = new Set<string>();
  let deduplicatedCount = 0;

  for (const interaction of foundInRequestedOrder) {
    const baseKey = getAIInteractionDedupKey(interaction);
    const callSessionId = getAIInteractionCallSessionId(interaction);
    const callSession = callSessionId ? callSessionById.get(callSessionId) ?? null : null;
    const contactIds = readAIInteractionContactIds(interaction);
    const identityKeys = [
      ...compactValues([callSession?.id ?? callSessionId]).map((value) => `callSessionId:${value}`),
      ...compactValues([callSession?.providerCallId, interaction.callSession?.providerCallId]).map(
        (value) => `providerCallId:${value}`
      ),
      ...compactValues([callSession?.callEscalations?.[0]?.amazonConnectContactId, ...contactIds]).map(
        (value) => `contactId:${value}`
      )
    ];
    const dedupKeys = identityKeys.length ? identityKeys : [baseKey];
    const dedupKey = dedupKeys.join("|");

    if (dedupKeys.some((key) => seenKeys.has(key))) {
      deduplicatedCount += 1;
      continue;
    }

    dedupKeys.forEach((key) => seenKeys.add(key));
    const aiCallDebug = buildAIInteractionCallDebugForAdminPayload(interaction, callSession);
    const fullCallDebug = callSession ? buildCallDebugRecord(callSession, exportedAt) : null;
    records.push(
      sanitizeDebugJsonValue({
        schemaVersion: 1,
        exportedAt,
        exportType: "ai_call_debug",
        selectedAiInteractionId: interaction.id,
        deduplicationKey: dedupKey,
        callSessionId: callSession?.id ?? callSessionId,
        providerCallId: callSession?.providerCallId ?? interaction.callSession?.providerCallId ?? null,
        contactIds: aiCallDebug.contactIds,
        callerPhone: aiCallDebug.callerPhone,
        calledNumber: aiCallDebug.calledNumber,
        aiCallDebug,
        fullCallDebug: fullCallDebug ?? undefined
      })
    );
  }

  return sanitizeDebugJsonValue({
    schemaVersion: 1,
    exportedAt,
    exportType: "multi_ai_call_debug",
    requestedCount: ids.length,
    recordCount: records.length,
    deduplicatedCount,
    notFoundIds: requestedIds.filter((id) => !selectedById.has(id)),
    records
  });
};
