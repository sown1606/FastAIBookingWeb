import { StaffStatus } from "@prisma/client";
import { DateTime } from "luxon";
import { env } from "../src/config/env";
import { prisma } from "../src/db/prisma";
import { getAvailableSlots } from "../src/modules/availability/availability.service";
import { runCallAutomationForSession } from "../src/modules/calls/call-automation.service";
import { processCallRailWebhook } from "../src/modules/calls/calls.service";

type CallRailPayload = Record<string, unknown>;

interface BookingScenario {
  salon: {
    id: string;
    name: string;
    timezone: string;
    contactPhone: string | null;
    originalPhoneNumber: string | null;
    customerIncomingPhoneNumber: string | null;
  };
  service: {
    id: string;
    name: string;
  };
  staff: {
    id: string;
    fullName: string;
  };
  slot: {
    startTime: string;
    endTime: string;
  };
}

interface EscalationScenario {
  salon: {
    id: string;
    name: string;
    timezone: string;
    contactPhone: string | null;
    originalPhoneNumber: string | null;
    customerIncomingPhoneNumber: string | null;
  };
}

const buildHeaders = (): Record<string, string> => {
  return env.CALLRAIL_WEBHOOK_SECRET
    ? {
        "x-callrail-webhook-secret": env.CALLRAIL_WEBHOOK_SECRET
      }
    : {};
};

const buildBasePayload = (input: {
  callId: string;
  eventId: string;
  eventType: string;
  callerPhone: string;
  trackingNumber: string;
  originalPhoneNumber: string;
  startedAt: Date;
  answeredAt?: Date;
  endedAt?: Date;
  durationSeconds?: number;
  transcript?: string;
  transcriptSummary?: string;
  callSummary?: string;
  recordingUrl?: string;
  tags?: string[];
  answered?: boolean;
  wentToVoicemail?: boolean;
}): CallRailPayload => {
  return {
    event_type: input.eventType,
    event_id: input.eventId,
    call_id: input.callId,
    account_id: env.CALLRAIL_ACCOUNT_ID ?? "demo-account",
    company_id: env.CALLRAIL_COMPANY_ID ?? "demo-company",
    caller_number: input.callerPhone,
    customer_phone_number: input.callerPhone,
    tracking_phone_number: input.trackingNumber,
    tracking_number: input.trackingNumber,
    business_phone_number: input.originalPhoneNumber,
    direction: "inbound",
    status:
      input.eventType === "pre-call"
        ? "received"
        : input.eventType === "call-routing-complete"
          ? "connected"
          : input.eventType === "post-call"
            ? "completed"
            : undefined,
    start_time: input.startedAt.toISOString(),
    started_at: input.startedAt.toISOString(),
    answered_at: input.answeredAt?.toISOString(),
    ended_at: input.endedAt?.toISOString(),
    duration_seconds: input.durationSeconds,
    answered: input.answered,
    went_to_voicemail: input.wentToVoicemail,
    transcript: input.transcript,
    transcript_summary: input.transcriptSummary,
    call_summary: input.callSummary,
    recording_url: input.recordingUrl,
    tags: input.tags ?? [],
    call: {
      id: input.callId,
      account_id: env.CALLRAIL_ACCOUNT_ID ?? "demo-account",
      company_id: env.CALLRAIL_COMPANY_ID ?? "demo-company",
      customer_phone_number: input.callerPhone,
      tracking_phone_number: input.trackingNumber,
      business_phone_number: input.originalPhoneNumber,
      start_time: input.startedAt.toISOString(),
      answered_at: input.answeredAt?.toISOString(),
      ended_at: input.endedAt?.toISOString(),
      duration_seconds: input.durationSeconds,
      answered: input.answered,
      went_to_voicemail: input.wentToVoicemail,
      transcript: input.transcript,
      transcript_summary: input.transcriptSummary,
      call_summary: input.callSummary,
      recording_url: input.recordingUrl
    }
  };
};

const loadCandidateSalons = async () => {
  return prisma.salon.findMany({
    select: {
      id: true,
      name: true,
      timezone: true,
      contactPhone: true,
      originalPhoneNumber: true,
      customerIncomingPhoneNumber: true,
      settings: true,
      services: {
        where: {
          isActive: true
        },
        select: {
          id: true,
          name: true
        },
        orderBy: {
          createdAt: "asc"
        }
      },
      staff: {
        where: {
          status: StaffStatus.ACTIVE,
          isBookable: true
        },
        select: {
          id: true,
          fullName: true
        },
        orderBy: {
          createdAt: "asc"
        }
      },
      callCenterAssignments: {
        select: {
          agentUserId: true
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });
};

export const findBookingScenario = async (): Promise<BookingScenario> => {
  const salons = await loadCandidateSalons();

  for (const salon of salons) {
    if (!salon.settings?.aiReceptionEnabled || !salon.customerIncomingPhoneNumber) {
      continue;
    }

    for (let dayOffset = 1; dayOffset <= 7; dayOffset += 1) {
      const date = DateTime.now().setZone(salon.timezone).plus({ days: dayOffset }).toFormat("yyyy-MM-dd");

      for (const service of salon.services) {
        for (const staff of salon.staff) {
          try {
            const availability = await getAvailableSlots({
              salonId: salon.id,
              serviceId: service.id,
              staffId: staff.id,
              date,
              intervalMinutes: 15
            });
            const slot = availability.slots[0];
            if (slot) {
              return {
                salon: {
                  id: salon.id,
                  name: salon.name,
                  timezone: salon.timezone,
                  contactPhone: salon.contactPhone,
                  originalPhoneNumber: salon.originalPhoneNumber,
                  customerIncomingPhoneNumber: salon.customerIncomingPhoneNumber
                },
                service,
                staff,
                slot
              };
            }
          } catch {
            continue;
          }
        }
      }
    }
  }

  throw new Error("No AI-enabled salon with an available staff/service slot was found.");
};

export const findEscalationScenario = async (): Promise<EscalationScenario> => {
  const salons = await loadCandidateSalons();
  const scenario = salons.find(
    (salon) =>
      Boolean(salon.settings?.aiReceptionEnabled) &&
      Boolean(salon.settings?.callCenterEnabled) &&
      salon.callCenterAssignments.length > 0 &&
      Boolean(salon.customerIncomingPhoneNumber) &&
      Boolean(salon.originalPhoneNumber ?? salon.contactPhone)
  );

  if (!scenario || !scenario.customerIncomingPhoneNumber || !(scenario.originalPhoneNumber ?? scenario.contactPhone)) {
    throw new Error("No AI-enabled salon with assigned call center agents was found.");
  }

  return {
    salon: {
      id: scenario.id,
      name: scenario.name,
      timezone: scenario.timezone,
      contactPhone: scenario.contactPhone,
      originalPhoneNumber: scenario.originalPhoneNumber,
      customerIncomingPhoneNumber: scenario.customerIncomingPhoneNumber
    }
  };
};

export const ingestCallRailEvent = async (payload: CallRailPayload) => {
  const rawBody = JSON.stringify(payload);
  const result = await processCallRailWebhook(payload, rawBody, buildHeaders());

  if (result.callSessionId && !result.isDuplicateEvent) {
    await runCallAutomationForSession(result.callSessionId);
  }

  return result;
};

export const simulateCallLifecycle = async (events: Array<CallRailPayload>) => {
  const results = [];
  for (const payload of events) {
    results.push(await ingestCallRailEvent(payload));
  }
  return results;
};

export const loadCallSessionState = async (callSessionId: string) => {
  return prisma.callSession.findUniqueOrThrow({
    where: {
      id: callSessionId
    },
    include: {
      salon: {
        select: {
          id: true,
          name: true
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
      callEscalations: {
        orderBy: {
          createdAt: "desc"
        }
      },
      transcripts: {
        orderBy: {
          createdAt: "desc"
        }
      },
      aiInteractions: {
        orderBy: {
          createdAt: "desc"
        }
      }
    }
  });
};

export const buildCallRailEvent = buildBasePayload;
export { prisma };
