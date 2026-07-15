import { createHash } from "crypto";
import { ConnectClient, DescribeContactCommand } from "@aws-sdk/client-connect";
import {
  BookingAttemptStatus,
  CallRoutingOutcome,
  CallSessionStatus,
  ExternalProvider,
  Prisma
} from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";
import { AppError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { markAiReceptionWebhookVerifiedForSalon } from "../ai-reception/ai-reception.service";
import { createSalonAlert } from "../alerts/alerts.service";
import { buildSalonRoutingSummary } from "../salon/routing-summary";
import { CallRailProviderAdapter, normalizePhoneForMatching } from "./providers/callrail.provider";

interface ListCallsInput {
  page: number;
  limit: number;
  status?: CallSessionStatus;
}

interface ListAdminCallsInput {
  page: number;
  limit: number;
  status?: CallSessionStatus;
  salonId?: string;
  includeSynthetic?: boolean;
}

interface AddTranscriptInput {
  transcriptSource?: string;
  transcriptText: string;
  transcriptSummary?: string;
  startedAt?: Date;
  endedAt?: Date;
  rawPayload?: unknown;
}

const toJson = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
};

const payloadHash = (value: unknown): string => {
  const text = JSON.stringify(value ?? {});
  return createHash("sha256").update(text).digest("hex");
};

const callrailAdapter = new CallRailProviderAdapter();

const AMAZON_CONNECT_RECONCILE_TIMEOUT_MS = 2500;

const terminalCallStatuses = new Set<CallSessionStatus>([
  CallSessionStatus.COMPLETED,
  CallSessionStatus.MISSED,
  CallSessionStatus.FAILED,
  CallSessionStatus.CANCELED,
  CallSessionStatus.VOICEMAIL
]);

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Amazon Connect reconciliation timed out")), timeoutMs);
      })
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
};

const reconcileAmazonConnectCallSessions = async <T extends {
  id: string;
  provider: ExternalProvider;
  providerCallId: string;
  status: CallSessionStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  rawPayload?: Prisma.JsonValue | null;
}>(items: T[]): Promise<T[]> => {
  const instanceId = env.AMAZON_CONNECT_INSTANCE_ID;
  if (!instanceId || process.env.NODE_ENV === "test") {
    return items;
  }
  const candidates = items
    .filter(
      (item) =>
        item.provider === ExternalProvider.AMAZON_CONNECT &&
        !/^codex-/i.test(item.providerCallId)
    )
    .slice(0, 8);
  if (!candidates.length) {
    return items;
  }

  const client = new ConnectClient({
    region: env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? "us-east-1"
  });
  const reconciledById = new Map<string, Partial<T>>();
  await Promise.all(
    candidates.map(async (item) => {
      try {
        const response = await withTimeout(
          client.send(
            new DescribeContactCommand({
              InstanceId: instanceId,
              ContactId: item.providerCallId
            })
          ),
          AMAZON_CONNECT_RECONCILE_TIMEOUT_MS
        );
        const contact = response.Contact as
          | {
              InitiationTimestamp?: Date;
              DisconnectTimestamp?: Date;
            }
          | undefined;
        if (!contact?.DisconnectTimestamp) {
          return;
        }
        const startedAt = contact.InitiationTimestamp ?? item.startedAt ?? null;
        const endedAt = contact.DisconnectTimestamp;
        const durationSeconds = startedAt
          ? Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
          : item.durationSeconds;
        const existingRawPayload =
          item.rawPayload && typeof item.rawPayload === "object" && !Array.isArray(item.rawPayload)
            ? (item.rawPayload as Record<string, unknown>)
            : {};
        const rawPayload = toJson({
          ...existingRawPayload,
          providerTiming: {
            source: "amazon_connect_describe_contact",
            providerInitiatedAt: contact.InitiationTimestamp?.toISOString() ?? null,
            providerDisconnectedAt: contact.DisconnectTimestamp.toISOString(),
            applicationFirstSeenAt: item.startedAt?.toISOString() ?? null,
            answeredAt: null,
            limitations: ["answeredAt_unavailable_from_describe_contact"]
          }
        });
        const update: {
          status: CallSessionStatus;
          startedAt?: Date;
          endedAt: Date;
          durationSeconds: number | null;
          rawPayload: Prisma.InputJsonValue;
        } = {
          status: terminalCallStatuses.has(item.status) ? item.status : CallSessionStatus.COMPLETED,
          endedAt,
          durationSeconds,
          rawPayload
        };
        if (startedAt) {
          update.startedAt = startedAt;
        }
        await prisma.callSession.update({
          where: {
            id: item.id
          },
          data: update
        });
        reconciledById.set(item.id, update as Partial<T>);
      } catch (error) {
        logger.debug(
          {
            callSessionId: item.id,
            providerCallId: item.providerCallId,
            error: error instanceof Error ? error.message : String(error)
          },
          "Amazon Connect call reconciliation skipped."
        );
      }
    })
  );

  return items.map((item) => ({
    ...item,
    ...(reconciledById.get(item.id) ?? {})
  }));
};

const normalizePhoneDigits = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }

  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return undefined;
  }

  if (digits.length === 10) {
    return `1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return digits;
  }

  return digits;
};

const buildPhoneLookupValues = (value: string | undefined): string[] => {
  return Array.from(
    new Set(
      [normalizePhoneForMatching(value), normalizePhoneDigits(value)].filter(
        (candidate): candidate is string => Boolean(candidate)
      )
    )
  );
};

const isAiReceptionEnabled = (settings: {
  aiReceptionEnabled?: boolean | null;
  aiForwardingEnabled?: boolean | null;
} | null | undefined) => {
  return settings?.aiReceptionEnabled ?? settings?.aiForwardingEnabled ?? false;
};

const inferRoutingOutcomeFromStatus = (
  status: CallSessionStatus,
  current?: CallRoutingOutcome | null
): CallRoutingOutcome | undefined => {
  if (status === CallSessionStatus.VOICEMAIL) {
    return CallRoutingOutcome.VOICEMAIL;
  }
  if (status === CallSessionStatus.RINGING || status === CallSessionStatus.RECEIVED) {
    return current ?? CallRoutingOutcome.SALON_RING;
  }
  if (status === CallSessionStatus.IN_PROGRESS) {
    return current ?? undefined;
  }
  return current ?? undefined;
};

const resolveSalonIdForCallEvent = async (event: {
  salonIdHint?: string;
  trackingNumber?: string;
  dialedPhone?: string;
  providerCompanyId?: string;
}): Promise<string | undefined> => {
  if (event.salonIdHint) {
    const hintedSalon = await prisma.salon.findUnique({
      where: { id: event.salonIdHint },
      select: { id: true }
    });
    if (hintedSalon?.id) {
      return hintedSalon.id;
    }
  }

  const forwardingPhoneCandidates = Array.from(
    new Set(
      [normalizePhoneDigits(event.trackingNumber), normalizePhoneDigits(event.dialedPhone)].filter(
        (value): value is string => Boolean(value)
      )
    )
  );

  if (forwardingPhoneCandidates.length > 0) {
    const setup = await prisma.salonAiReceptionSetup.findFirst({
      where: {
        provider: ExternalProvider.CALLRAIL,
        forwardingPhoneNumber: {
          in: forwardingPhoneCandidates
        }
      },
      select: {
        salonId: true
      }
    });

    if (setup?.salonId) {
      return setup.salonId;
    }
  }

  const lookupCandidates: Array<{ configKey: string; configValues: string[] }> = [
    {
      configKey: "tracking_number",
      configValues: buildPhoneLookupValues(event.trackingNumber)
    },
    {
      configKey: "forwarding_phone_number",
      configValues: buildPhoneLookupValues(event.trackingNumber)
    },
    {
      configKey: "dialed_number",
      configValues: buildPhoneLookupValues(event.dialedPhone)
    },
    {
      configKey: "company_id",
      configValues: event.providerCompanyId?.trim() ? [event.providerCompanyId.trim()] : []
    }
  ];

  for (const candidate of lookupCandidates) {
    if (!candidate.configValues.length) {
      continue;
    }

    const integration = await prisma.integrationConfig.findFirst({
      where: {
        provider: ExternalProvider.CALLRAIL,
        configKey: candidate.configKey,
        configValue: {
          in: candidate.configValues
        },
        isActive: true
      },
      select: {
        salonId: true
      }
    });

    if (integration?.salonId) {
      return integration.salonId;
    }
  }

  const defaultSalonId = env.CALLRAIL_DEFAULT_SALON_ID?.trim();
  if (!defaultSalonId) {
    return undefined;
  }

  const defaultSalon = await prisma.salon.findUnique({
    where: { id: defaultSalonId },
    select: { id: true }
  });
  return defaultSalon?.id;
};

const ensureCallSessionBelongsToSalon = async (salonId: string, callSessionId: string) => {
  const session = await prisma.callSession.findFirst({
    where: {
      id: callSessionId,
      salonId
    }
  });
  if (!session) {
    throw new AppError("Call session not found.", 404, "CALL_SESSION_NOT_FOUND");
  }
  return session;
};

export const processCallRailWebhook = async (
  payload: unknown,
  rawBody: string,
  headers: Record<string, string | string[] | undefined>
) => {
  const normalized = callrailAdapter.normalizeWebhook(payload, rawBody, headers);
  const salonId = await resolveSalonIdForCallEvent(normalized.event);
  const rawPayloadHash = payloadHash(normalized.event.rawPayload);

  const result = await prisma.$transaction(async (tx) => {
    const existingSession = await tx.callSession.findUnique({
      where: {
        provider_providerCallId: {
          provider: ExternalProvider.CALLRAIL,
          providerCallId: normalized.event.providerCallId
        }
      }
    });

    const nextStatus = normalized.event.status ?? existingSession?.status ?? CallSessionStatus.RECEIVED;
    const routingOutcome =
      inferRoutingOutcomeFromStatus(nextStatus, existingSession?.routingOutcome) ??
      existingSession?.routingOutcome;

    const callSession = await tx.callSession.upsert({
      where: {
        provider_providerCallId: {
          provider: ExternalProvider.CALLRAIL,
          providerCallId: normalized.event.providerCallId
        }
      },
      create: {
        provider: ExternalProvider.CALLRAIL,
        providerCallId: normalized.event.providerCallId,
        providerAccountId: normalized.event.providerAccountId,
        providerCompanyId: normalized.event.providerCompanyId,
        callerPhone: normalized.event.callerPhone,
        originalPhoneNumber: normalized.event.originalPhoneNumber,
        dialedPhone: normalized.event.dialedPhone,
        trackingNumber: normalized.event.trackingNumber,
        direction: normalized.event.direction,
        sourceName: normalized.event.sourceName,
        campaignName: normalized.event.campaignName,
        status: nextStatus,
        startedAt: normalized.event.startedAt,
        answeredAt: normalized.event.answeredAt,
        endedAt: normalized.event.endedAt,
        durationSeconds: normalized.event.durationSeconds,
        recordingUrl: normalized.event.recordingUrl,
        transcriptSummary: normalized.event.transcriptSummary,
        bookingResult: normalized.event.bookingResult
          ? toJson(normalized.event.bookingResult)
          : undefined,
        routingOutcome,
        failureReason: normalized.event.failureReason,
        rawPayload: toJson(normalized.event.rawPayload),
        salonId
      },
      update: {
        providerAccountId: normalized.event.providerAccountId ?? undefined,
        providerCompanyId: normalized.event.providerCompanyId ?? undefined,
        callerPhone: normalized.event.callerPhone ?? undefined,
        originalPhoneNumber: normalized.event.originalPhoneNumber ?? undefined,
        dialedPhone: normalized.event.dialedPhone ?? undefined,
        trackingNumber: normalized.event.trackingNumber ?? undefined,
        direction: normalized.event.direction ?? undefined,
        sourceName: normalized.event.sourceName ?? undefined,
        campaignName: normalized.event.campaignName ?? undefined,
        status: nextStatus,
        startedAt: normalized.event.startedAt ?? undefined,
        answeredAt: normalized.event.answeredAt ?? undefined,
        endedAt: normalized.event.endedAt ?? undefined,
        durationSeconds: normalized.event.durationSeconds ?? undefined,
        recordingUrl: normalized.event.recordingUrl ?? undefined,
        transcriptSummary: normalized.event.transcriptSummary ?? undefined,
        bookingResult: normalized.event.bookingResult
          ? toJson(normalized.event.bookingResult)
          : undefined,
        routingOutcome: routingOutcome ?? undefined,
        failureReason: normalized.event.failureReason ?? undefined,
        rawPayload: toJson(normalized.event.rawPayload),
        salonId: existingSession?.salonId ?? salonId
      }
    });

    let isDuplicateEvent = false;
    if (normalized.event.providerEventId) {
      const existingByProviderEvent = await tx.callEvent.findFirst({
        where: {
          provider: ExternalProvider.CALLRAIL,
          providerEventId: normalized.event.providerEventId
        },
        select: { id: true }
      });
      if (existingByProviderEvent) {
        isDuplicateEvent = true;
      }
    }

    if (!isDuplicateEvent) {
      const existingByPayloadHash = await tx.callEvent.findFirst({
        where: {
          callSessionId: callSession.id,
          payloadHash: rawPayloadHash
        },
        select: { id: true }
      });
      if (existingByPayloadHash) {
        isDuplicateEvent = true;
      }
    }

    if (!isDuplicateEvent) {
      await tx.callEvent.create({
        data: {
          salonId: callSession.salonId,
          callSessionId: callSession.id,
          provider: ExternalProvider.CALLRAIL,
          providerEventId: normalized.event.providerEventId,
          eventType: normalized.event.eventType,
          eventTimestamp: normalized.event.eventTimestamp,
          statusBefore: existingSession?.status,
          statusAfter: nextStatus,
          payload: toJson(normalized.event.rawPayload),
          payloadHash: rawPayloadHash,
          processedAt: new Date()
        }
      });
    }

    if (normalized.event.transcriptText && !isDuplicateEvent) {
      const existingTranscript = await tx.callTranscript.findFirst({
        where: {
          callSessionId: callSession.id,
          transcriptText: normalized.event.transcriptText
        },
        select: { id: true }
      });

      if (!existingTranscript) {
        await tx.callTranscript.create({
          data: {
            salonId: callSession.salonId,
            callSessionId: callSession.id,
            transcriptSource: "callrail_webhook",
            transcriptText: normalized.event.transcriptText,
            transcriptSummary: normalized.event.transcriptSummary,
            startedAt: normalized.event.startedAt,
            endedAt: normalized.event.endedAt,
            rawPayload: toJson(normalized.event.rawPayload)
          }
        });
      }
    }

    if (callSession.salonId) {
      await createAuditLog(
        {
          salonId: callSession.salonId,
          action: "CALLRAIL_WEBHOOK_PROCESSED",
          entityType: "CallSession",
          entityId: callSession.id,
          metadata: {
            eventType: normalized.event.eventType,
            providerEventId: normalized.event.providerEventId,
            duplicate: isDuplicateEvent
          }
        },
        tx
      );
    }

    return {
      callSession,
      isDuplicateEvent
    };
  });

  if (!result.callSession.salonId) {
    logger.warn(
      {
        providerCallId: normalized.event.providerCallId,
        trackingNumber: normalized.event.trackingNumber,
        dialedPhone: normalized.event.dialedPhone,
        providerCompanyId: normalized.event.providerCompanyId
      },
      "Unmapped optional attribution webhook call received"
    );
  }

  if (result.callSession.salonId) {
    await markAiReceptionWebhookVerifiedForSalon(
      result.callSession.salonId,
      normalized.event.answeredAt ??
        normalized.event.endedAt ??
        normalized.event.startedAt ??
        normalized.event.eventTimestamp ??
        new Date()
    );
  }

  if (
    result.callSession.salonId &&
    result.callSession.status === CallSessionStatus.MISSED &&
    !result.isDuplicateEvent
  ) {
    await createSalonAlert({
      salonId: result.callSession.salonId,
      alertType: "MISSED_CALL",
      title: "Missed call",
      message: `Missed call from ${result.callSession.callerPhone ?? "unknown caller"}.`,
      metadata: {
        callSessionId: result.callSession.id,
        callerPhone: result.callSession.callerPhone
      },
      sendSms: true
    });
  }

  return {
    signatureVerified: normalized.signatureVerified,
    callSessionId: result.callSession.id,
    salonId: result.callSession.salonId ?? null,
    providerCallId: result.callSession.providerCallId,
    status: result.callSession.status,
    isDuplicateEvent: result.isDuplicateEvent
  };
};

const isLivePersonRequest = (input: { digits?: string; spokenText?: string }): boolean => {
  if (input.digits?.trim() === "0") {
    return true;
  }
  const spoken = input.spokenText?.toLowerCase() ?? "";
  return [
    "live person",
    "real person",
    "operator",
    "representative",
    "agent",
    "call center",
    "nguoi that",
    "nhan vien",
    "gap nguoi"
  ].some((phrase) => spoken.includes(phrase));
};

const findSalonForRouting = async (input: {
  salonId?: string;
  customerIncomingPhoneNumber?: string;
}) => {
  if (input.salonId) {
    return prisma.salon.findUnique({
      where: { id: input.salonId },
      include: {
        settings: true,
        callCenterAssignments: {
          include: {
            agent: {
              select: {
                id: true,
                fullName: true,
                phone: true
              }
            }
          },
          orderBy: {
            createdAt: "asc"
          }
        }
      }
    });
  }

  const normalizedPhone = normalizePhoneForMatching(input.customerIncomingPhoneNumber);
  if (!normalizedPhone) {
    return null;
  }

  return prisma.salon.findFirst({
    where: {
      OR: [
        { customerIncomingPhoneNumber: normalizedPhone },
        { contactPhone: normalizedPhone },
        { originalPhoneNumber: normalizedPhone }
      ]
    },
    include: {
      settings: true,
      callCenterAssignments: {
        include: {
          agent: {
            select: {
              id: true,
              fullName: true,
              phone: true
            }
          }
        },
        orderBy: {
          createdAt: "asc"
        }
      }
    }
  });
};

export const buildCallRoutingPlan = async (input: {
  salonId?: string;
  customerIncomingPhoneNumber?: string;
  digits?: string;
  spokenText?: string;
  callerPhone?: string;
}) => {
  const salon = await findSalonForRouting(input);
  if (!salon) {
    throw new AppError("Salon routing profile not found.", 404, "SALON_ROUTING_NOT_FOUND");
  }

  const settings = salon.settings;
  const livePersonRequested = isLivePersonRequest(input);
  const callCenterEnabled = settings?.callCenterEnabled ?? false;
  const aiReceptionEnabled = isAiReceptionEnabled(settings);
  const routingSummary = buildSalonRoutingSummary(settings);

  if (livePersonRequested && callCenterEnabled) {
    const assignedAgent = salon.callCenterAssignments.find((assignment) => assignment.agent.phone);
    const transferNumber =
      settings?.callCenterRoutingNumber ?? assignedAgent?.agent.phone ?? env.CALL_CENTER_DEFAULT_PHONE ?? null;

    await createSalonAlert({
      salonId: salon.id,
      alertType: "CALL_CENTER_ESCALATION",
      title: "Caller requested a human operator",
      message: `Caller ${input.callerPhone ?? "unknown"} requested a live agent.`,
      priority: "URGENT",
      metadata: {
        callerPhone: input.callerPhone,
        digits: input.digits,
        spokenText: input.spokenText
      },
      sendSms: true
    });

    return {
      salonId: salon.id,
      routeType: "AMAZON_CONNECT_QUEUE",
      routingOutcome: "CALL_CENTER_ESCALATION" as const,
      queueId: env.AMAZON_CONNECT_QUEUE_ID_DEFAULT ?? null,
      queueRoutingProfileId: env.AMAZON_CONNECT_ROUTING_PROFILE_ID ?? null,
      transferNumber,
      contactFlowId: env.AMAZON_CONNECT_CONTACT_FLOW_ID_HUMAN_ESCALATION ?? null,
      assignedAgent: assignedAgent?.agent ?? null,
      reason: "LIVE_PERSON_REQUEST",
      routingSummary
    };
  }

  if (livePersonRequested) {
    return {
      salonId: salon.id,
      routeType: "SALON_ORIGINAL_PHONE",
      routingOutcome: "SALON_RING" as const,
      transferNumber: salon.originalPhoneNumber ?? salon.contactPhone ?? null,
      reason: "LIVE_PERSON_REQUEST_CALL_CENTER_DISABLED",
      routingSummary
    };
  }

  if (aiReceptionEnabled) {
    return {
      salonId: salon.id,
      routeType: "AMAZON_CONNECT_AI_RECEPTION",
      routingOutcome: "AI_RECEPTION" as const,
      transferAfterRings: settings?.aiTransferRingCount ?? 3,
      contactFlowId:
        env.AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION ?? env.AMAZON_CONNECT_CONTACT_FLOW_ID ?? null,
      trackingNumber: env.AMAZON_CONNECT_PHONE_NUMBER ?? salon.customerIncomingPhoneNumber ?? null,
      reason: "AI_RECEPTION_ENABLED",
      routingSummary
    };
  }

  return {
    salonId: salon.id,
    routeType: "SALON_ORIGINAL_PHONE",
    routingOutcome: "SALON_RING" as const,
    transferNumber: salon.originalPhoneNumber ?? salon.contactPhone ?? null,
    reason: "AI_RECEPTION_DISABLED",
    routingSummary
  };
};

export const listCalls = async (salonId: string, input: ListCallsInput) => {
  const skip = (input.page - 1) * input.limit;
  const where = {
    salonId,
    ...(input.status ? { status: input.status } : {})
  };

  const [items, total] = await Promise.all([
    prisma.callSession.findMany({
      where,
      orderBy: {
        createdAt: "desc"
      },
      skip,
      take: input.limit,
      include: {
        _count: {
          select: {
            events: true,
            transcripts: true,
            bookingAttempts: true,
            callEscalations: true
          }
        }
      }
    }),
    prisma.callSession.count({ where })
  ]);

  return {
    items,
    pagination: {
      page: input.page,
      limit: input.limit,
      total
    }
  };
};

export const getCallById = async (salonId: string, callSessionId: string) => {
  const callSession = await prisma.callSession.findFirst({
    where: {
      id: callSessionId,
      salonId
    },
    include: {
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
          createdAt: "desc"
        },
        include: {
          appointment: true,
          aiInteractions: {
            orderBy: {
              createdAt: "desc"
            }
          }
        }
      },
      aiInteractions: {
        orderBy: {
          createdAt: "desc"
        }
      },
      callEscalations: {
        orderBy: {
          createdAt: "desc"
        }
      }
    }
  });

  if (!callSession) {
    throw new AppError("Call session not found.", 404, "CALL_SESSION_NOT_FOUND");
  }
  return callSession;
};

export const listCallEvents = async (salonId: string, callSessionId: string) => {
  await ensureCallSessionBelongsToSalon(salonId, callSessionId);
  return prisma.callEvent.findMany({
    where: {
      callSessionId,
      salonId
    },
    orderBy: {
      receivedAt: "asc"
    }
  });
};

export const listCallTranscripts = async (salonId: string, callSessionId: string) => {
  await ensureCallSessionBelongsToSalon(salonId, callSessionId);
  return prisma.callTranscript.findMany({
    where: {
      callSessionId,
      salonId
    },
    orderBy: {
      createdAt: "asc"
    }
  });
};

export const listCallBookingAttempts = async (salonId: string, callSessionId: string) => {
  await ensureCallSessionBelongsToSalon(salonId, callSessionId);
  return prisma.bookingAttempt.findMany({
    where: {
      callSessionId,
      salonId
    },
    orderBy: {
      createdAt: "desc"
    },
    include: {
      appointment: true,
      aiInteractions: {
        orderBy: {
          createdAt: "desc"
        }
      }
    }
  });
};

export const addCallTranscript = async (
  salonId: string,
  callSessionId: string,
  input: AddTranscriptInput
) => {
  const callSession = await ensureCallSessionBelongsToSalon(salonId, callSessionId);
  const transcript = await prisma.callTranscript.create({
    data: {
      salonId,
      callSessionId: callSession.id,
      transcriptSource: input.transcriptSource ?? "manual_upload",
      transcriptText: input.transcriptText,
      transcriptSummary: input.transcriptSummary,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      rawPayload: input.rawPayload === undefined ? undefined : toJson(input.rawPayload)
    }
  });

  await createAuditLog({
    salonId,
    action: "CALL_TRANSCRIPT_ADDED",
    entityType: "CallTranscript",
    entityId: transcript.id
  });

  return transcript;
};

export const createTranscriptForSession = async (
  callSessionId: string,
  input: AddTranscriptInput
) => {
  const callSession = await prisma.callSession.findUnique({
    where: { id: callSessionId }
  });
  if (!callSession) {
    throw new AppError("Call session not found.", 404, "CALL_SESSION_NOT_FOUND");
  }

  return prisma.callTranscript.create({
    data: {
      salonId: callSession.salonId,
      callSessionId: callSession.id,
      transcriptSource: input.transcriptSource ?? "ai_ingestion",
      transcriptText: input.transcriptText,
      transcriptSummary: input.transcriptSummary,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      rawPayload: input.rawPayload === undefined ? undefined : toJson(input.rawPayload)
    }
  });
};

export const listCallsForAdmin = async (input: ListAdminCallsInput) => {
  const skip = (input.page - 1) * input.limit;
  const where: Prisma.CallSessionWhereInput = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.salonId ? { salonId: input.salonId } : {}),
    ...(input.includeSynthetic === false
      ? {
          NOT: [
            {
              providerCallId: {
                startsWith: "codex-",
                mode: "insensitive" as const
              }
            },
            {
              rawPayload: {
                path: ["isSynthetic"],
                equals: true
              }
            },
            {
              rawPayload: {
                path: ["metadata", "isSynthetic"],
                equals: true
              }
            }
          ]
        }
      : {})
  };

  const [rawItems, total] = await Promise.all([
    prisma.callSession.findMany({
      where,
      skip,
      take: input.limit,
      orderBy: {
        createdAt: "desc"
      },
      include: {
        salon: {
          select: {
            id: true,
            name: true
          }
        },
        _count: {
          select: {
            events: true,
            transcripts: true,
            bookingAttempts: true,
            callEscalations: true
          }
        }
      }
    }),
    prisma.callSession.count({ where })
  ]);
  const items = await reconcileAmazonConnectCallSessions(rawItems);

  return {
    items: items.map((item) => ({
      ...item,
      isSynthetic:
        /^codex-/i.test(item.providerCallId) ||
        (typeof item.rawPayload === "object" &&
          item.rawPayload !== null &&
          !Array.isArray(item.rawPayload) &&
          ((item.rawPayload as Record<string, unknown>).isSynthetic === true ||
            ((item.rawPayload as Record<string, unknown>).metadata &&
              typeof (item.rawPayload as Record<string, unknown>).metadata === "object" &&
              !Array.isArray((item.rawPayload as Record<string, unknown>).metadata) &&
              ((item.rawPayload as Record<string, unknown>).metadata as Record<string, unknown>).isSynthetic === true)))
    })),
    pagination: {
      page: input.page,
      limit: input.limit,
      total
    }
  };
};

export const getCallByIdForAdmin = async (callSessionId: string) => {
  let callSession = await prisma.callSession.findUnique({
    where: { id: callSessionId },
    include: {
      salon: {
        select: {
          id: true,
          name: true
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
          createdAt: "desc"
        },
        include: {
          appointment: true
        }
      },
      aiInteractions: {
        orderBy: {
          createdAt: "desc"
        }
      },
      callEscalations: {
        orderBy: {
          createdAt: "desc"
        }
      }
    }
  });

  if (!callSession) {
    throw new AppError("Call session not found.", 404, "CALL_SESSION_NOT_FOUND");
  }
  const [reconciled] = await reconcileAmazonConnectCallSessions([callSession]);
  if (reconciled && reconciled !== callSession) {
    callSession = {
      ...callSession,
      status: reconciled.status,
      startedAt: reconciled.startedAt ?? callSession.startedAt,
      endedAt: reconciled.endedAt ?? callSession.endedAt,
      durationSeconds: reconciled.durationSeconds ?? callSession.durationSeconds
    };
  }
  return callSession;
};

export const markBookingAttemptResultOnCall = async (
  callSessionId: string,
  status: BookingAttemptStatus,
  payload: {
    bookingAttemptId: string;
    appointmentId?: string;
    failureReason?: string;
  }
) => {
  const callSession = await prisma.callSession.findUnique({
    where: { id: callSessionId }
  });
  if (!callSession) {
    return;
  }

  const failureReason =
    status === BookingAttemptStatus.SUCCESS && payload.appointmentId
      ? null
      : payload.failureReason ?? callSession.failureReason;

  await prisma.callSession.update({
    where: { id: callSessionId },
    data: {
      bookingResult: toJson({
        status,
        bookingAttemptId: payload.bookingAttemptId,
        appointmentId: payload.appointmentId,
        failureReason: payload.failureReason,
        updatedAt: new Date().toISOString()
      }),
      failureReason
    }
  });
};

export const updateCallAIState = async (
  callSessionId: string,
  input: {
    aiSummary: unknown;
    routingOutcome?: CallRoutingOutcome;
    finalResolution?: string;
    language?: string;
  }
) => {
  const callSession = await prisma.callSession.findUnique({
    where: { id: callSessionId }
  });
  if (!callSession) {
    throw new AppError("Call session not found.", 404, "CALL_SESSION_NOT_FOUND");
  }

  await prisma.callSession.update({
    where: { id: callSessionId },
    data: {
      aiSummary: toJson(input.aiSummary),
      routingOutcome: input.routingOutcome ?? undefined,
      finalResolution: terminalCallStatuses.has(callSession.status)
        ? undefined
        : input.finalResolution ?? undefined,
      language: input.language ?? undefined
    }
  });
};
