import { createHash } from "crypto";
import {
  BookingAttemptStatus,
  CallSessionStatus,
  ExternalProvider,
  Prisma
} from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";
import { AppError } from "../../lib/errors";
import { createSalonAlert } from "../alerts/alerts.service";
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

  const lookupCandidates: Array<{ configKey: string; configValue: string | undefined }> = [
    {
      configKey: "tracking_number",
      configValue: normalizePhoneForMatching(event.trackingNumber)
    },
    {
      configKey: "dialed_number",
      configValue: normalizePhoneForMatching(event.dialedPhone)
    },
    {
      configKey: "company_id",
      configValue: event.providerCompanyId?.trim()
    }
  ];

  for (const candidate of lookupCandidates) {
    if (!candidate.configValue) {
      continue;
    }

    const integration = await prisma.integrationConfig.findFirst({
      where: {
        provider: ExternalProvider.CALLRAIL,
        configKey: candidate.configKey,
        configValue: candidate.configValue,
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
        dialedPhone: normalized.event.dialedPhone,
        trackingNumber: normalized.event.trackingNumber,
        sourceName: normalized.event.sourceName,
        campaignName: normalized.event.campaignName,
        status: nextStatus,
        startedAt: normalized.event.startedAt,
        endedAt: normalized.event.endedAt,
        durationSeconds: normalized.event.durationSeconds,
        transcriptSummary: normalized.event.transcriptSummary,
        bookingResult: normalized.event.bookingResult
          ? toJson(normalized.event.bookingResult)
          : undefined,
        failureReason: normalized.event.failureReason,
        rawPayload: toJson(normalized.event.rawPayload),
        salonId
      },
      update: {
        providerAccountId: normalized.event.providerAccountId ?? undefined,
        providerCompanyId: normalized.event.providerCompanyId ?? undefined,
        callerPhone: normalized.event.callerPhone ?? undefined,
        dialedPhone: normalized.event.dialedPhone ?? undefined,
        trackingNumber: normalized.event.trackingNumber ?? undefined,
        sourceName: normalized.event.sourceName ?? undefined,
        campaignName: normalized.event.campaignName ?? undefined,
        status: nextStatus,
        startedAt: normalized.event.startedAt ?? undefined,
        endedAt: normalized.event.endedAt ?? undefined,
        durationSeconds: normalized.event.durationSeconds ?? undefined,
        transcriptSummary: normalized.event.transcriptSummary ?? undefined,
        bookingResult: normalized.event.bookingResult
          ? toJson(normalized.event.bookingResult)
          : undefined,
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

  if (
    result.callSession.salonId &&
    result.callSession.status === CallSessionStatus.MISSED &&
    !result.isDuplicateEvent
  ) {
    await createSalonAlert({
      salonId: result.callSession.salonId,
      alertType: "MISSED_CALL",
      title: "Cuoc goi nho",
      message: `Cuoc goi nho tu ${result.callSession.callerPhone ?? "khach hang"}.`,
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
  if (livePersonRequested) {
    const assignedAgent = salon.callCenterAssignments.find((assignment) => assignment.agent.phone);
    const transferNumber =
      settings?.callCenterRoutingNumber ?? assignedAgent?.agent.phone ?? env.CALL_CENTER_DEFAULT_PHONE ?? null;

    await createSalonAlert({
      salonId: salon.id,
      alertType: "CALL_CENTER_ESCALATION",
      title: "Khach muon gap nguoi that",
      message: `Khach ${input.callerPhone ?? "khong ro so"} yeu cau gap nhan vien truc tiep.`,
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
      routeType: "CALL_CENTER",
      transferNumber,
      callRailFlowId: env.CALLRAIL_LIVE_PERSON_FLOW_ID ?? null,
      assignedAgent: assignedAgent?.agent ?? null,
      reason: "LIVE_PERSON_REQUEST"
    };
  }

  if (settings?.aiForwardingEnabled) {
    return {
      salonId: salon.id,
      routeType: "CALLRAIL_AI",
      transferAfterRings: settings.aiTransferRingCount,
      callRailFlowId: env.CALLRAIL_AI_FLOW_ID ?? null,
      trackingNumber: salon.customerIncomingPhoneNumber ?? env.CALLRAIL_TRACKING_NUMBER ?? null,
      reason: "AI_FORWARDING_ON"
    };
  }

  return {
    salonId: salon.id,
    routeType: "SALON_ORIGINAL_PHONE",
    transferNumber: salon.originalPhoneNumber ?? salon.contactPhone ?? env.CALLRAIL_TARGET_NUMBER ?? null,
    reason: "AI_FORWARDING_OFF"
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
            bookingAttempts: true
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
      _count: {
        select: {
          events: true,
          transcripts: true,
          bookingAttempts: true,
          aiInteractions: true
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
  const where = {
    ...(input.status ? { status: input.status } : {}),
    ...(input.salonId ? { salonId: input.salonId } : {})
  };

  const [items, total] = await Promise.all([
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
            bookingAttempts: true
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

export const getCallByIdForAdmin = async (callSessionId: string) => {
  const callSession = await prisma.callSession.findUnique({
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
      }
    }
  });

  if (!callSession) {
    throw new AppError("Call session not found.", 404, "CALL_SESSION_NOT_FOUND");
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
      failureReason: payload.failureReason ?? callSession.failureReason
    }
  });
};
