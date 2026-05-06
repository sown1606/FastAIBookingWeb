import { DateTime } from "luxon";
import {
  BookingAttemptStatus,
  CallRoutingOutcome,
  CallSessionStatus,
  ExternalProvider,
  Prisma,
  StaffStatus
} from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";
import { AppError } from "../../lib/errors";
import { createAppointmentFromAI } from "../appointments/appointments.service";
import { getAvailableSlots, validateAppointmentSlot } from "../availability/availability.service";
import { createOrUpdateCallEscalation } from "../call-center/call-center.service";
import {
  createTranscriptForSession,
  markBookingAttemptResultOnCall,
  updateCallAIState
} from "../calls/calls.service";
import { normalizePhoneForMatching } from "../calls/providers/callrail.provider";
import { createCustomer } from "../customers/customers.service";
import { bookingIntentResultSchema, BookingIntentResult } from "./ai.schemas";
import { buildBookingIntentPrompt } from "./ai.prompts";
import { VertexAIProvider } from "./providers/vertex-ai.provider";

interface ParseBookingInput {
  salonId: string;
  actorUserId?: string;
  text: string;
  callSessionId?: string;
  transcriptId?: string;
}

interface BookingFromTextInput extends ParseBookingInput {
  createCustomerIfMissing: boolean;
}

interface SuggestSlotsInput {
  salonId: string;
  serviceName: string;
  staffName?: string;
  preferredStartTime?: Date;
  daysAhead: number;
  maxSlots: number;
}

interface CreateAmazonConnectAIAppointmentInput {
  salonId?: string;
  customerName: string;
  customerPhone: string;
  serviceName: string;
  requestedDate: string;
  requestedTime?: string;
  staffPreference?: string;
  source?: string;
  amazonConnectContactId?: string;
  amazonConnectPhoneNumber?: string;
  calledNumber?: string;
}

type SalonResolutionSource =
  | "explicit_salon_id"
  | "amazon_connect_integration_config"
  | "amazon_connect_reception_setup"
  | "salon_phone_number"
  | "default_salon_demo_fallback";

const toJson = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
};

const extractJsonObject = (rawText: string): unknown => {
  const withoutFences = rawText
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  const firstBrace = withoutFences.indexOf("{");
  const lastBrace = withoutFences.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error("No JSON object found in AI response.");
  }
  const jsonCandidate = withoutFences.slice(firstBrace, lastBrace + 1);
  return JSON.parse(jsonCandidate);
};

const parseDateTimeFromText = (text: string, timezone: string): string | undefined => {
  const isoMatch = text.match(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/i
  );
  if (isoMatch?.[0]) {
    const date = DateTime.fromISO(isoMatch[0], { setZone: true });
    if (date.isValid) {
      return date.toUTC().toISO() ?? undefined;
    }
  }

  const localMatch = text.match(
    /(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?:\s?(am|pm))?/i
  );
  if (localMatch) {
    const [_, datePart, hourPart, minutePart, periodPart] = localMatch;
    let hour = Number(hourPart);
    if (periodPart?.toLowerCase() === "pm" && hour < 12) {
      hour += 12;
    }
    if (periodPart?.toLowerCase() === "am" && hour === 12) {
      hour = 0;
    }

    const local = DateTime.fromISO(`${datePart}T00:00:00`, { zone: timezone }).set({
      hour,
      minute: Number(minutePart),
      second: 0,
      millisecond: 0
    });
    if (local.isValid) {
      return local.toUTC().toISO() ?? undefined;
    }
  }

  const tomorrowMatch = text.match(/tomorrow\s+at\s+(\d{1,2})(?::(\d{2}))?\s?(am|pm)?/i);
  if (tomorrowMatch) {
    let hour = Number(tomorrowMatch[1]);
    const minute = Number(tomorrowMatch[2] ?? 0);
    const period = tomorrowMatch[3]?.toLowerCase();
    if (period === "pm" && hour < 12) {
      hour += 12;
    }
    if (period === "am" && hour === 12) {
      hour = 0;
    }

    const local = DateTime.now().setZone(timezone).plus({ days: 1 }).set({
      hour,
      minute,
      second: 0,
      millisecond: 0
    });
    if (local.isValid) {
      return local.toUTC().toISO() ?? undefined;
    }
  }

  return undefined;
};

const inferFallbackIntent = (input: {
  text: string;
  timezone: string;
  serviceNames: string[];
  staffNames: string[];
}): BookingIntentResult => {
  const lower = input.text.toLowerCase();
  const matchedService = input.serviceNames.find((service) =>
    lower.includes(service.toLowerCase())
  );
  const matchedStaff = input.staffNames.find((staff) => lower.includes(staff.toLowerCase()));

  const explicitPhoneMatch = input.text.match(
    /(?:phone number is|phone is|call me at|reach me at)\s*(\+?1?[\s\-()]*[2-9]\d{2}[\s\-()]*[2-9]\d{2}[\s\-()]?\d{4})/i
  );
  const fallbackPhoneMatch = input.text.match(
    /(\+?1?[\s\-()]*[2-9]\d{2}[\s\-()]*[2-9]\d{2}[\s\-()]?\d{4})/
  );
  const phone = normalizePhoneForMatching(explicitPhoneMatch?.[1] ?? fallbackPhoneMatch?.[1]);

  const nameMatch = input.text.match(
    /(?:name is|this is|i am|i'm)\s+([a-zA-Z][a-zA-Z.'-]*(?:\s+[a-zA-Z][a-zA-Z.'-]*){0,4})/i
  );
  const customerName = nameMatch?.[1]?.trim();
  const startTimeIso = parseDateTimeFromText(input.text, input.timezone);

  const missingFields: string[] = [];
  if (!customerName) {
    missingFields.push("customerName");
  }
  if (!phone) {
    missingFields.push("customerPhone");
  }
  if (!matchedService) {
    missingFields.push("serviceName");
  }
  if (!startTimeIso) {
    missingFields.push("startTime");
  }

  return {
    intentType:
      lower.includes("live person") ||
      lower.includes("real person") ||
      lower.includes("operator") ||
      lower.includes("representative") ||
      lower.includes("agent")
        ? "LIVE_PERSON_REQUEST"
        : lower.includes("cancel")
          ? "CANCEL_APPOINTMENT"
          : lower.includes("reschedule")
            ? "RESCHEDULE_APPOINTMENT"
            : lower.includes("book")
              ? "BOOK_APPOINTMENT"
              : "UNKNOWN",
    customer: {
      name: customerName,
      phone: phone
    },
    requestedService: matchedService,
    requestedStaff: matchedStaff,
    requestedDateTime: startTimeIso,
    notes: undefined,
    confidence: 0.35,
    isReadyToBook: missingFields.length === 0,
    missingFields,
    normalizedBookingRequest: {
      customerName,
      customerPhone: phone,
      serviceName: matchedService,
      staffName: matchedStaff,
      startTimeIso: startTimeIso ?? undefined,
      timezone: input.timezone
    }
  };
};

const normalizeIntentResult = (intent: BookingIntentResult): BookingIntentResult => {
  const normalizedBookingRequest = {
    ...intent.normalizedBookingRequest,
    customerName: intent.normalizedBookingRequest.customerName ?? intent.customer.name,
    customerPhone: intent.normalizedBookingRequest.customerPhone ?? intent.customer.phone,
    serviceName: intent.normalizedBookingRequest.serviceName ?? intent.requestedService,
    staffName: intent.normalizedBookingRequest.staffName ?? intent.requestedStaff,
    startTimeIso: intent.normalizedBookingRequest.startTimeIso ?? intent.requestedDateTime
  };

  const missing = new Set<string>(intent.missingFields);
  if (!normalizedBookingRequest.customerName) {
    missing.add("customerName");
  }
  if (!normalizedBookingRequest.customerPhone) {
    missing.add("customerPhone");
  }
  if (!normalizedBookingRequest.serviceName) {
    missing.add("serviceName");
  }
  if (!normalizedBookingRequest.startTimeIso) {
    missing.add("startTime");
  }

  const isReadyToBook = intent.intentType === "BOOK_APPOINTMENT" && missing.size === 0;

  return {
    ...intent,
    isReadyToBook,
    missingFields: Array.from(missing.values()),
    normalizedBookingRequest
  };
};

const ensureCallSessionForSalon = async (
  salonId: string,
  callSessionId: string
): Promise<void> => {
  const callSession = await prisma.callSession.findFirst({
    where: {
      id: callSessionId,
      salonId
    },
    select: { id: true }
  });
  if (!callSession) {
    throw new AppError("Call session not found for this salon.", 404, "CALL_SESSION_NOT_FOUND");
  }
};

const vertexProvider = new VertexAIProvider();

const getSalonAIContext = async (salonId: string) => {
  const [salon, services, staff] = await Promise.all([
    prisma.salon.findUnique({
      where: { id: salonId },
      select: { id: true, timezone: true }
    }),
    prisma.service.findMany({
      where: {
        salonId,
        isActive: true
      },
      select: {
        id: true,
        name: true
      },
      orderBy: {
        createdAt: "asc"
      }
    }),
    prisma.staff.findMany({
      where: {
        salonId,
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
    })
  ]);

  if (!salon) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }

  return {
    timezone: salon.timezone,
    services,
    staff
  };
};

const createAIInteractionLog = async (input: {
  salonId: string;
  actorUserId?: string;
  callSessionId?: string;
  transcriptId?: string;
  model: string;
  taskType: string;
  requestText: string;
  requestPayload: unknown;
  responseText: string;
  responsePayload: unknown;
  parsedOutput: unknown;
  isValid: boolean;
  validationErrors?: unknown;
  confidence?: number;
}) => {
  return prisma.aiInteractionLog.create({
    data: {
      salonId: input.salonId,
      provider: ExternalProvider.VERTEX,
      model: input.model,
      taskType: input.taskType,
      requestText: input.requestText,
      requestPayload: toJson(input.requestPayload),
      responseText: input.responseText,
      responsePayload: toJson(input.responsePayload),
      parsedOutput: toJson(input.parsedOutput),
      isValid: input.isValid,
      validationErrors:
        input.validationErrors === undefined ? undefined : toJson(input.validationErrors),
      confidence: input.confidence,
      callSessionId: input.callSessionId,
      transcriptId: input.transcriptId,
      createdByUserId: input.actorUserId
    }
  });
};

const parseBookingIntentInternal = async (input: ParseBookingInput) => {
  if (input.callSessionId) {
    await ensureCallSessionForSalon(input.salonId, input.callSessionId);
  }

  const context = await getSalonAIContext(input.salonId);
  const prompt = buildBookingIntentPrompt({
    text: input.text,
    salonTimezone: context.timezone,
    serviceNames: context.services.map((service) => service.name),
    staffNames: context.staff.map((member) => member.fullName)
  });

  let model = "fallback-rules";
  let responseText = "";
  let responsePayload: unknown = {};
  let parsedIntent: BookingIntentResult;
  let isModelOutputValid = false;
  let validationErrors: unknown;

  try {
    const aiOutput = await vertexProvider.parse({
      prompt,
      taskType: "parse_booking"
    });

    model = aiOutput.model;
    responseText = aiOutput.responseText;
    responsePayload = aiOutput.rawResponse;
    parsedIntent = bookingIntentResultSchema.parse(extractJsonObject(aiOutput.responseText));
    isModelOutputValid = true;
  } catch (error) {
    validationErrors = {
      message: error instanceof Error ? error.message : "Unknown AI parse error"
    };
    parsedIntent = inferFallbackIntent({
      text: input.text,
      timezone: context.timezone,
      serviceNames: context.services.map((service) => service.name),
      staffNames: context.staff.map((member) => member.fullName)
    });
    responseText = JSON.stringify(parsedIntent);
    responsePayload = {
      fallbackUsed: true,
      error: validationErrors
    };
  }

  const normalized = normalizeIntentResult(parsedIntent);
  const interaction = await createAIInteractionLog({
    salonId: input.salonId,
    actorUserId: input.actorUserId,
    callSessionId: input.callSessionId,
    transcriptId: input.transcriptId,
    model,
    taskType: "parse_booking",
    requestText: input.text,
    requestPayload: {
      prompt
    },
    responseText,
    responsePayload,
    parsedOutput: normalized,
    isValid: isModelOutputValid,
    validationErrors,
    confidence: normalized.confidence
  });

  return {
    parsedIntent: normalized,
    interaction
  };
};

const resolveService = async (salonId: string, serviceName: string) => {
  const service = await prisma.service.findFirst({
    where: {
      salonId,
      isActive: true,
      name: {
        contains: serviceName,
        mode: "insensitive"
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });
  return service;
};

const resolveCustomer = async (input: {
  salonId: string;
  actorUserId: string;
  customerName?: string;
  customerPhone?: string;
  createCustomerIfMissing: boolean;
}) => {
  const normalizedPhone = normalizePhoneForMatching(input.customerPhone);
  if (normalizedPhone) {
    const candidates = [input.customerPhone, normalizedPhone].filter(
      (value): value is string => Boolean(value)
    );
    const existingByPhone = await prisma.customer.findFirst({
      where: {
        salonId: input.salonId,
        phone: {
          in: candidates
        }
      }
    });
    if (existingByPhone) {
      return existingByPhone;
    }
  }

  if (input.customerName) {
    const [firstNamePart, ...lastNameParts] = input.customerName.trim().split(/\s+/);
    const lastNamePart = lastNameParts.join(" ").trim();

    const existingByName = await prisma.customer.findFirst({
      where: {
        salonId: input.salonId,
        firstName: {
          contains: firstNamePart,
          mode: "insensitive"
        },
        ...(lastNamePart
          ? {
              lastName: {
                contains: lastNamePart,
                mode: "insensitive" as const
              }
            }
          : {})
      }
    });
    if (existingByName) {
      return existingByName;
    }
  }

  if (!input.createCustomerIfMissing) {
    return null;
  }
  if (!normalizedPhone || !input.customerName) {
    return null;
  }

  const [firstNamePart, ...lastNameParts] = input.customerName.trim().split(/\s+/);
  const firstName = firstNamePart?.trim();
  const lastName = lastNameParts.join(" ").trim() || "Unknown";
  if (!firstName) {
    return null;
  }

  return createCustomer(input.salonId, input.actorUserId, {
    firstName,
    lastName,
    phone: normalizedPhone
  });
};

const getStaffCandidates = async (input: {
  salonId: string;
  requestedStaffName?: string;
}) => {
  const staff = await prisma.staff.findMany({
    where: {
      salonId: input.salonId,
      status: StaffStatus.ACTIVE,
      isBookable: true,
      ...(input.requestedStaffName
        ? {
            fullName: {
              contains: input.requestedStaffName,
              mode: "insensitive"
            }
          }
        : {})
    },
    select: {
      id: true,
      fullName: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });
  return staff;
};

const normalizePhoneDigitsForLookup = (value?: string | null): string | undefined => {
  if (!value) {
    return undefined;
  }

  const digits = value.replace(/\D/g, "");
  if (!digits) {
    return undefined;
  }
  return digits;
};

const buildPhoneLookupValues = (value?: string | null): string[] => {
  const digits = normalizePhoneDigitsForLookup(value);
  const normalized = normalizePhoneForMatching(value ?? undefined);
  const values = new Set<string>();

  [value?.trim(), normalized, digits].forEach((candidate) => {
    if (candidate) {
      values.add(candidate);
    }
  });

  if (digits?.length === 10) {
    values.add(`1${digits}`);
    values.add(`+1${digits}`);
  }
  if (digits?.length === 11 && digits.startsWith("1")) {
    values.add(digits.slice(1));
    values.add(`+${digits}`);
  }

  return Array.from(values.values());
};

const parseRequestedStartTime = (input: {
  requestedDate: string;
  requestedTime?: string;
  timezone: string;
}): Date => {
  const requestedDate = input.requestedDate.trim();
  const requestedTime = input.requestedTime?.trim();

  if (!requestedTime) {
    const iso = DateTime.fromISO(requestedDate, { zone: input.timezone });
    if (iso.isValid) {
      return iso.toUTC().toJSDate();
    }
    throw new AppError("requestedDate must be a valid ISO date or datetime.", 400, "INVALID_REQUESTED_DATE");
  }

  const combined = `${requestedDate} ${requestedTime}`;
  const formats = [
    "yyyy-MM-dd HH:mm",
    "yyyy-MM-dd H:mm",
    "yyyy-MM-dd h:mm a",
    "yyyy-MM-dd h a",
    "M/d/yyyy HH:mm",
    "M/d/yyyy H:mm",
    "M/d/yyyy h:mm a",
    "M/d/yyyy h a"
  ];

  for (const format of formats) {
    const parsed = DateTime.fromFormat(combined, format, { zone: input.timezone });
    if (parsed.isValid) {
      return parsed.toUTC().toJSDate();
    }
  }

  throw new AppError("requestedDate and requestedTime do not form a valid appointment time.", 400, "INVALID_REQUESTED_TIME");
};

const salonSelect = {
  id: true,
  timezone: true,
  ownerId: true
} as const;

const resolveAmazonConnectSalon = async (input: {
  salonId?: string;
  amazonConnectPhoneNumber?: string;
  calledNumber?: string;
}): Promise<{
  salon: { id: string; timezone: string; ownerId: string };
  resolutionSource: SalonResolutionSource;
}> => {
  const explicitSalonId = input.salonId?.trim();
  if (explicitSalonId) {
    const salon = await prisma.salon.findUnique({
      where: { id: explicitSalonId },
      select: salonSelect
    });
    if (!salon) {
      throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
    }
    return { salon, resolutionSource: "explicit_salon_id" };
  }

  const phoneLookupValues = Array.from(
    new Set([
      ...buildPhoneLookupValues(input.amazonConnectPhoneNumber),
      ...buildPhoneLookupValues(input.calledNumber)
    ])
  );

  if (phoneLookupValues.length) {
    const integration = await prisma.integrationConfig.findFirst({
      where: {
        provider: ExternalProvider.AMAZON_CONNECT,
        isActive: true,
        configKey: {
          in: [
            "phone_number",
            "amazon_connect_phone_number",
            "forwarding_phone_number",
            "called_number",
            "dialed_number",
            "tracking_number",
            "salon_original_number"
          ]
        },
        configValue: {
          in: phoneLookupValues
        }
      },
      select: {
        salon: {
          select: salonSelect
        }
      }
    });
    if (integration?.salon) {
      return {
        salon: integration.salon,
        resolutionSource: "amazon_connect_integration_config"
      };
    }

    const receptionSetup = await prisma.salonAiReceptionSetup.findFirst({
      where: {
        provider: ExternalProvider.AMAZON_CONNECT,
        forwardingPhoneNumber: {
          in: phoneLookupValues
        }
      },
      select: {
        salon: {
          select: salonSelect
        }
      }
    });
    if (receptionSetup?.salon) {
      return {
        salon: receptionSetup.salon,
        resolutionSource: "amazon_connect_reception_setup"
      };
    }

    const salon = await prisma.salon.findFirst({
      where: {
        OR: [
          {
            customerIncomingPhoneNumber: {
              in: phoneLookupValues
            }
          },
          {
            originalPhoneNumber: {
              in: phoneLookupValues
            }
          },
          {
            contactPhone: {
              in: phoneLookupValues
            }
          }
        ]
      },
      select: salonSelect
    });
    if (salon) {
      return { salon, resolutionSource: "salon_phone_number" };
    }
  }

  const defaultSalonId = env.DEFAULT_SALON_ID?.trim();
  if (defaultSalonId) {
    const salon = await prisma.salon.findUnique({
      where: { id: defaultSalonId },
      select: salonSelect
    });
    if (!salon) {
      throw new AppError("DEFAULT_SALON_ID does not match an existing salon.", 500, "DEFAULT_SALON_NOT_FOUND");
    }
    return { salon, resolutionSource: "default_salon_demo_fallback" };
  }

  throw new AppError(
    "Unable to resolve salon from Amazon Connect phone attributes.",
    422,
    "SALON_RESOLUTION_FAILED"
  );
};

const selectStaffForAIAppointment = async (input: {
  salonId: string;
  serviceId: string;
  requestedStartTime: Date;
  staffPreference?: string;
}) => {
  const staffCandidates = await getStaffCandidates({
    salonId: input.salonId,
    requestedStaffName: input.staffPreference
  });

  if (!staffCandidates.length) {
    throw new AppError("No matching bookable staff found.", 400, "STAFF_UNAVAILABLE");
  }

  const rejectedReasons: string[] = [];
  for (const staff of staffCandidates) {
    try {
      const slotValidation = await validateAppointmentSlot({
        salonId: input.salonId,
        staffId: staff.id,
        serviceIds: [input.serviceId],
        startTime: input.requestedStartTime
      });
      if (slotValidation.valid) {
        return staff;
      }
      rejectedReasons.push(slotValidation.reason ?? `Staff ${staff.fullName} is unavailable.`);
    } catch (error) {
      if (error instanceof AppError && error.statusCode < 500) {
        rejectedReasons.push(error.message);
        continue;
      }
      throw error;
    }
  }

  throw new AppError(
    input.staffPreference
      ? "Requested staff is not available for this appointment."
      : "No bookable staff is available for this appointment.",
    409,
    "NO_AVAILABLE_STAFF",
    {
      reasons: Array.from(new Set(rejectedReasons)).slice(0, 5)
    }
  );
};

const upsertAmazonConnectCallSession = async (input: {
  salonId: string;
  contactId?: string;
  customerPhone: string;
  amazonConnectPhoneNumber?: string;
  calledNumber?: string;
}) => {
  const contactId = input.contactId?.trim();
  if (!contactId) {
    return null;
  }

  return prisma.callSession.upsert({
    where: {
      provider_providerCallId: {
        provider: ExternalProvider.AMAZON_CONNECT,
        providerCallId: contactId
      }
    },
    update: {
      salonId: input.salonId,
      providerCompanyId: env.AMAZON_CONNECT_INSTANCE_ID,
      callerPhone: normalizePhoneForMatching(input.customerPhone),
      trackingNumber: normalizePhoneForMatching(input.amazonConnectPhoneNumber),
      dialedPhone: normalizePhoneForMatching(input.calledNumber),
      status: CallSessionStatus.IN_PROGRESS,
      routingOutcome: CallRoutingOutcome.AI_RECEPTION,
      finalResolution: "AI appointment created."
    },
    create: {
      salonId: input.salonId,
      provider: ExternalProvider.AMAZON_CONNECT,
      providerCallId: contactId,
      providerCompanyId: env.AMAZON_CONNECT_INSTANCE_ID,
      callerPhone: normalizePhoneForMatching(input.customerPhone),
      trackingNumber: normalizePhoneForMatching(input.amazonConnectPhoneNumber),
      dialedPhone: normalizePhoneForMatching(input.calledNumber),
      direction: "inbound",
      sourceName: "amazon_connect_lex",
      status: CallSessionStatus.IN_PROGRESS,
      routingOutcome: CallRoutingOutcome.AI_RECEPTION,
      startedAt: new Date(),
      finalResolution: "AI appointment created."
    }
  });
};

const getSuggestedSlotsForService = async (input: {
  salonId: string;
  serviceId: string;
  staffCandidates: Array<{ id: string; fullName: string }>;
  timezone: string;
  preferredStartTime?: Date;
  daysAhead: number;
  maxSlots: number;
}) => {
  const suggestions: Array<{
    staffId: string;
    staffName: string;
    startTime: string;
    endTime: string;
  }> = [];

  const localStart = input.preferredStartTime
    ? DateTime.fromJSDate(input.preferredStartTime, { zone: "utc" }).setZone(input.timezone)
    : DateTime.now().setZone(input.timezone);

  for (let offset = 0; offset < input.daysAhead; offset += 1) {
    const localDate = localStart.plus({ days: offset }).toFormat("yyyy-MM-dd");

    for (const staff of input.staffCandidates) {
      const available = await getAvailableSlots({
        salonId: input.salonId,
        serviceId: input.serviceId,
        staffId: staff.id,
        date: localDate,
        intervalMinutes: 15
      });

      for (const slot of available.slots) {
        const slotStart = DateTime.fromISO(slot.startTime, { zone: "utc" });
        if (
          offset === 0 &&
          input.preferredStartTime &&
          slotStart.toMillis() <
            DateTime.fromJSDate(input.preferredStartTime, { zone: "utc" }).toMillis()
        ) {
          continue;
        }

        suggestions.push({
          staffId: staff.id,
          staffName: staff.fullName,
          startTime: slot.startTime,
          endTime: slot.endTime
        });
        if (suggestions.length >= input.maxSlots) {
          return suggestions;
        }
      }
    }
  }

  return suggestions;
};

const attachBookingAttemptToInteraction = async (
  interactionId: string,
  bookingAttemptId: string
): Promise<void> => {
  await prisma.aiInteractionLog.update({
    where: {
      id: interactionId
    },
    data: {
      bookingAttemptId
    }
  });
};

const resolveActionActorUserId = async (
  salonId: string,
  actorUserId?: string
): Promise<string> => {
  if (actorUserId) {
    return actorUserId;
  }

  const salon = await prisma.salon.findUnique({
    where: {
      id: salonId
    },
    select: {
      ownerId: true
    }
  });

  if (!salon?.ownerId) {
    throw new AppError("Salon owner not found.", 404, "SALON_OWNER_NOT_FOUND");
  }

  return salon.ownerId;
};

const buildStructuredCallSummary = (input: {
  transcriptId?: string;
  parsed: BookingIntentResult;
  bookingAttemptId?: string;
  bookingStatus?: BookingAttemptStatus;
  appointmentId?: string | null;
  alternatives?: Array<{
    staffId: string;
    staffName: string;
    startTime: string;
    endTime: string;
  }>;
  escalation?: {
    id: string;
    status: string;
    routingOutcome?: string | null;
    messageToCaller?: string | null;
  } | null;
  resolution: string;
}) => {
  return {
    sourceTranscriptId: input.transcriptId,
    intentType: input.parsed.intentType,
    confidence: input.parsed.confidence,
    customer: input.parsed.customer,
    requestedService: input.parsed.requestedService ?? null,
    requestedStaff: input.parsed.requestedStaff ?? null,
    requestedDateTime: input.parsed.requestedDateTime ?? null,
    missingFields: input.parsed.missingFields,
    bookingAttemptId: input.bookingAttemptId ?? null,
    bookingStatus: input.bookingStatus ?? null,
    appointmentId: input.appointmentId ?? null,
    escalation: input.escalation
      ? {
          id: input.escalation.id,
          status: input.escalation.status,
          routingOutcome: input.escalation.routingOutcome ?? null,
          messageToCaller: input.escalation.messageToCaller ?? null
        }
      : null,
    alternatives: input.alternatives ?? [],
    resolution: input.resolution,
    summaryText:
      input.parsed.intentType === "LIVE_PERSON_REQUEST"
        ? input.escalation?.messageToCaller ?? "Please wait while I connect you."
        : input.resolution,
    updatedAt: new Date().toISOString()
  };
};

export const createAmazonConnectAIAppointment = async (
  input: CreateAmazonConnectAIAppointmentInput
) => {
  const { salon, resolutionSource } = await resolveAmazonConnectSalon({
    salonId: input.salonId,
    amazonConnectPhoneNumber: input.amazonConnectPhoneNumber,
    calledNumber: input.calledNumber
  });
  const actorUserId = await resolveActionActorUserId(salon.id);
  const requestedStartTime = parseRequestedStartTime({
    requestedDate: input.requestedDate,
    requestedTime: input.requestedTime,
    timezone: salon.timezone
  });

  const service = await resolveService(salon.id, input.serviceName);
  if (!service) {
    throw new AppError("Service not found or inactive.", 400, "SERVICE_UNAVAILABLE");
  }

  const customer = await resolveCustomer({
    salonId: salon.id,
    actorUserId,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    createCustomerIfMissing: true
  });
  if (!customer) {
    throw new AppError("Customer name and a valid phone are required.", 400, "CUSTOMER_REQUIRED");
  }

  const staff = await selectStaffForAIAppointment({
    salonId: salon.id,
    serviceId: service.id,
    requestedStartTime,
    staffPreference: input.staffPreference
  });

  const callSession = await upsertAmazonConnectCallSession({
    salonId: salon.id,
    contactId: input.amazonConnectContactId,
    customerPhone: input.customerPhone,
    amazonConnectPhoneNumber: input.amazonConnectPhoneNumber,
    calledNumber: input.calledNumber
  });

  const appointment = await createAppointmentFromAI(salon.id, actorUserId, {
    customerId: customer.id,
    staffId: staff.id,
    serviceId: service.id,
    startTime: requestedStartTime,
    notes: [
      "Created by Amazon Connect AI Booking.",
      input.source ? `Source: ${input.source}` : null,
      input.amazonConnectContactId ? `Amazon Connect contact: ${input.amazonConnectContactId}` : null
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n")
  });

  const bookingAttempt = await prisma.bookingAttempt.create({
    data: {
      salonId: salon.id,
      callSessionId: callSession?.id,
      appointmentId: appointment.id,
      status: BookingAttemptStatus.SUCCESS,
      source: input.source?.trim() || "AMAZON_CONNECT_LEX",
      customerName: input.customerName,
      customerPhone: normalizePhoneForMatching(input.customerPhone),
      requestedService: input.serviceName,
      requestedStaff: input.staffPreference,
      requestedDateTimeText: requestedStartTime.toISOString(),
      normalizedRequest: toJson({
        salonId: salon.id,
        salonResolutionSource: resolutionSource,
        serviceId: service.id,
        staffId: staff.id,
        customerId: customer.id,
        startTimeIso: requestedStartTime.toISOString(),
        timezone: salon.timezone
      }),
      rawInput: toJson({
        source: input.source,
        amazonConnectContactId: input.amazonConnectContactId,
        amazonConnectPhoneNumber: input.amazonConnectPhoneNumber,
        calledNumber: input.calledNumber
      }),
      createdByUserId: actorUserId
    }
  });

  if (callSession) {
    await prisma.callSession.update({
      where: { id: callSession.id },
      data: {
        bookingResult: toJson({
          bookingAttemptId: bookingAttempt.id,
          appointmentId: appointment.id,
          status: BookingAttemptStatus.SUCCESS
        }),
        finalResolution: "AI appointment created."
      }
    });
  }

  return {
    appointment,
    bookingAttempt,
    callSession,
    salonResolutionSource: resolutionSource
  };
};

export const parseBookingText = async (input: ParseBookingInput) => {
  const parsed = await parseBookingIntentInternal(input);
  return {
    interactionId: parsed.interaction.id,
    parsed: parsed.parsedIntent
  };
};

export const bookingFromText = async (input: BookingFromTextInput) => {
  const parsed = await parseBookingIntentInternal(input);
  const normalized = parsed.parsedIntent.normalizedBookingRequest;
  const actionActorUserId = await resolveActionActorUserId(input.salonId, input.actorUserId);

  const bookingAttempt = await prisma.bookingAttempt.create({
    data: {
      salonId: input.salonId,
      callSessionId: input.callSessionId,
      transcriptId: input.transcriptId,
      status: BookingAttemptStatus.PENDING,
      source: input.transcriptId ? "AI_TRANSCRIPT" : "AI_TEXT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      requestedService: normalized.serviceName,
      requestedStaff: normalized.staffName,
      requestedDateTimeText: normalized.startTimeIso ?? parsed.parsedIntent.requestedDateTime,
      normalizedRequest: toJson(normalized),
      rawInput: toJson({
        text: input.text
      }),
      createdByUserId: actionActorUserId
    }
  });

  await attachBookingAttemptToInteraction(parsed.interaction.id, bookingAttempt.id);

  if (parsed.parsedIntent.intentType === "LIVE_PERSON_REQUEST" && input.callSessionId) {
    const escalation = await createOrUpdateCallEscalation({
      salonId: input.salonId,
      callSessionId: input.callSessionId,
      requestedBy: "AI_RECEPTION",
      escalationReason: "Caller requested a human operator.",
      customerPhone: normalized.customerPhone ?? parsed.parsedIntent.customer.phone ?? null,
      messageToCaller: "Please wait while I connect you.",
      metadata: {
        transcriptId: input.transcriptId,
        interactionId: parsed.interaction.id
      }
    });

    const updated = await prisma.bookingAttempt.update({
      where: {
        id: bookingAttempt.id
      },
      data: {
        status: BookingAttemptStatus.NEEDS_INPUT,
        failureReason: "Caller requested a human operator."
      }
    });

    await markBookingAttemptResultOnCall(input.callSessionId, updated.status, {
      bookingAttemptId: updated.id,
      failureReason: updated.failureReason ?? undefined
    });

    await updateCallAIState(input.callSessionId, {
      aiSummary: buildStructuredCallSummary({
        transcriptId: input.transcriptId,
        parsed: parsed.parsedIntent,
        bookingAttemptId: updated.id,
        bookingStatus: updated.status,
        escalation,
        resolution: "Caller requested a human operator."
      }),
      routingOutcome:
        escalation.routingOutcome === "QUEUED"
          ? CallRoutingOutcome.QUEUED
          : (escalation.routingOutcome as CallRoutingOutcome | null) ??
            CallRoutingOutcome.CALL_CENTER_ESCALATION,
      finalResolution:
        escalation.routingOutcome === "QUEUED"
          ? "Waiting in the human operator queue."
          : "Caller requested a human operator.",
      language: "en"
    });

    return {
      bookingAttempt: updated,
      parsed: parsed.parsedIntent,
      appointment: null,
      alternatives: [],
      escalation
    };
  }

  if (!parsed.parsedIntent.isReadyToBook || parsed.parsedIntent.intentType !== "BOOK_APPOINTMENT") {
    const updated = await prisma.bookingAttempt.update({
      where: {
        id: bookingAttempt.id
      },
      data: {
        status: BookingAttemptStatus.NEEDS_INPUT,
        failureReason:
          parsed.parsedIntent.intentType !== "BOOK_APPOINTMENT"
            ? "Intent is not a booking request."
            : `Missing fields: ${parsed.parsedIntent.missingFields.join(", ")}`
      }
    });

    if (input.callSessionId) {
      await markBookingAttemptResultOnCall(input.callSessionId, updated.status, {
        bookingAttemptId: updated.id,
        failureReason: updated.failureReason ?? undefined
      });
      await updateCallAIState(input.callSessionId, {
        aiSummary: buildStructuredCallSummary({
          transcriptId: input.transcriptId,
          parsed: parsed.parsedIntent,
          bookingAttemptId: updated.id,
          bookingStatus: updated.status,
          resolution: updated.failureReason ?? "Intent is not a booking request."
        }),
        routingOutcome: CallRoutingOutcome.AI_RECEPTION,
        finalResolution: updated.failureReason ?? "Intent is not a booking request.",
        language: "en"
      });
    }

    return {
      bookingAttempt: updated,
      parsed: parsed.parsedIntent,
      appointment: null,
      alternatives: []
    };
  }

  if (!normalized.serviceName || !normalized.startTimeIso) {
    throw new AppError("Normalized booking request is incomplete.", 422, "AI_OUTPUT_INCOMPLETE");
  }

  const service = await resolveService(input.salonId, normalized.serviceName);
  if (!service) {
    const updated = await prisma.bookingAttempt.update({
      where: { id: bookingAttempt.id },
      data: {
        status: BookingAttemptStatus.FAILED,
        failureReason: `Service not found: ${normalized.serviceName}`
      }
    });
    if (input.callSessionId) {
      await markBookingAttemptResultOnCall(input.callSessionId, updated.status, {
        bookingAttemptId: updated.id,
        failureReason: updated.failureReason ?? undefined
      });
      await updateCallAIState(input.callSessionId, {
        aiSummary: buildStructuredCallSummary({
          transcriptId: input.transcriptId,
          parsed: parsed.parsedIntent,
          bookingAttemptId: updated.id,
          bookingStatus: updated.status,
          resolution: updated.failureReason ?? `Service not found: ${normalized.serviceName}`
        }),
        routingOutcome: CallRoutingOutcome.AI_RECEPTION,
        finalResolution: updated.failureReason ?? `Service not found: ${normalized.serviceName}`,
        language: "en"
      });
    }
    return {
      bookingAttempt: updated,
      parsed: parsed.parsedIntent,
      appointment: null,
      alternatives: []
    };
  }

  const startTime = new Date(normalized.startTimeIso);
  if (Number.isNaN(startTime.getTime())) {
    throw new AppError("Invalid startTime in AI output.", 422, "AI_INVALID_START_TIME");
  }

  const [salon, staffCandidates] = await Promise.all([
    prisma.salon.findUnique({
      where: { id: input.salonId },
      select: { timezone: true }
    }),
    getStaffCandidates({
      salonId: input.salonId,
      requestedStaffName: normalized.staffName
    })
  ]);

  if (!salon) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }

  if (!staffCandidates.length) {
    const updated = await prisma.bookingAttempt.update({
      where: { id: bookingAttempt.id },
      data: {
        status: BookingAttemptStatus.FAILED,
        failureReason: normalized.staffName
          ? `Requested staff not found: ${normalized.staffName}`
          : "No bookable staff found."
      }
    });
    if (input.callSessionId) {
      await markBookingAttemptResultOnCall(input.callSessionId, updated.status, {
        bookingAttemptId: updated.id,
        failureReason: updated.failureReason ?? undefined
      });
      await updateCallAIState(input.callSessionId, {
        aiSummary: buildStructuredCallSummary({
          transcriptId: input.transcriptId,
          parsed: parsed.parsedIntent,
          bookingAttemptId: updated.id,
          bookingStatus: updated.status,
          resolution: updated.failureReason ?? "No bookable staff found."
        }),
        routingOutcome: CallRoutingOutcome.AI_RECEPTION,
        finalResolution: updated.failureReason ?? "No bookable staff found.",
        language: "en"
      });
    }
    return {
      bookingAttempt: updated,
      parsed: parsed.parsedIntent,
      appointment: null,
      alternatives: []
    };
  }

  let chosenStaff: { id: string; fullName: string } | null = null;
  let validationResult:
    | {
        valid: boolean;
        reason?: string;
        endTime: Date;
        durationMinutes: number;
      }
    | null = null;

  for (const staff of staffCandidates) {
    const candidate = await validateAppointmentSlot({
      salonId: input.salonId,
      staffId: staff.id,
      serviceId: service.id,
      startTime
    });
    if (candidate.valid) {
      chosenStaff = staff;
      validationResult = candidate;
      break;
    }
    validationResult = candidate;
  }

  if (!chosenStaff || !validationResult?.valid) {
    const alternatives = await getSuggestedSlotsForService({
      salonId: input.salonId,
      serviceId: service.id,
      staffCandidates,
      timezone: salon.timezone,
      preferredStartTime: startTime,
      daysAhead: 7,
      maxSlots: 5
    });

    const updated = await prisma.bookingAttempt.update({
      where: { id: bookingAttempt.id },
      data: {
        status: BookingAttemptStatus.NO_AVAILABILITY,
        failureReason: validationResult?.reason ?? "No available slot for the requested time.",
        alternativeSlots: toJson(alternatives)
      }
    });
    if (input.callSessionId) {
      await markBookingAttemptResultOnCall(input.callSessionId, updated.status, {
        bookingAttemptId: updated.id,
        failureReason: updated.failureReason ?? undefined
      });
      await updateCallAIState(input.callSessionId, {
        aiSummary: buildStructuredCallSummary({
          transcriptId: input.transcriptId,
          parsed: parsed.parsedIntent,
          bookingAttemptId: updated.id,
          bookingStatus: updated.status,
          alternatives,
          resolution:
            updated.failureReason ?? "Requested time unavailable. Suggested alternatives returned."
        }),
        routingOutcome: CallRoutingOutcome.AI_RECEPTION,
        finalResolution:
          updated.failureReason ?? "Requested time unavailable. Suggested alternatives returned.",
        language: "en"
      });
    }
    return {
      bookingAttempt: updated,
      parsed: parsed.parsedIntent,
      appointment: null,
      alternatives
    };
  }

  const customer = await resolveCustomer({
    salonId: input.salonId,
    actorUserId: actionActorUserId,
    customerName: normalized.customerName,
    customerPhone: normalized.customerPhone,
    createCustomerIfMissing: input.createCustomerIfMissing
  });

  if (!customer) {
    const updated = await prisma.bookingAttempt.update({
      where: { id: bookingAttempt.id },
      data: {
        status: BookingAttemptStatus.NEEDS_INPUT,
        failureReason: "Customer could not be resolved. Provide customer name and phone."
      }
    });
    if (input.callSessionId) {
      await markBookingAttemptResultOnCall(input.callSessionId, updated.status, {
        bookingAttemptId: updated.id,
        failureReason: updated.failureReason ?? undefined
      });
      await updateCallAIState(input.callSessionId, {
        aiSummary: buildStructuredCallSummary({
          transcriptId: input.transcriptId,
          parsed: parsed.parsedIntent,
          bookingAttemptId: updated.id,
          bookingStatus: updated.status,
          resolution: updated.failureReason ?? "Customer could not be resolved."
        }),
        routingOutcome: CallRoutingOutcome.AI_RECEPTION,
        finalResolution: updated.failureReason ?? "Customer could not be resolved.",
        language: "en"
      });
    }
    return {
      bookingAttempt: updated,
      parsed: parsed.parsedIntent,
      appointment: null,
      alternatives: []
    };
  }

  const appointment = await createAppointmentFromAI(input.salonId, actionActorUserId, {
    customerId: customer.id,
    staffId: chosenStaff.id,
    serviceId: service.id,
    startTime,
    notes: normalized.notes ?? parsed.parsedIntent.notes
  });

  const updated = await prisma.bookingAttempt.update({
    where: { id: bookingAttempt.id },
    data: {
      status: BookingAttemptStatus.SUCCESS,
      appointmentId: appointment.id
    },
    include: {
      appointment: true
    }
  });

  await createAuditLog({
    salonId: input.salonId,
    actorUserId: actionActorUserId,
    action: "AI_BOOKING_ATTEMPT_SUCCESS",
    entityType: "BookingAttempt",
    entityId: updated.id,
    metadata: {
      appointmentId: appointment.id
    }
  });

  if (input.callSessionId) {
    await markBookingAttemptResultOnCall(input.callSessionId, updated.status, {
      bookingAttemptId: updated.id,
      appointmentId: appointment.id
    });
    await updateCallAIState(input.callSessionId, {
      aiSummary: buildStructuredCallSummary({
        transcriptId: input.transcriptId,
        parsed: parsed.parsedIntent,
        bookingAttemptId: updated.id,
        bookingStatus: updated.status,
        appointmentId: appointment.id,
        resolution: "Appointment created successfully."
      }),
      routingOutcome: CallRoutingOutcome.AI_RECEPTION,
      finalResolution: "Appointment created successfully.",
      language: "en"
    });
  }

  return {
    bookingAttempt: updated,
    parsed: parsed.parsedIntent,
    appointment,
    alternatives: [],
    escalation: null
  };
};

export const bookingFromTranscript = async (input: {
  salonId: string;
  actorUserId?: string;
  transcriptText: string;
  callSessionId?: string;
  transcriptSource: string;
  createCustomerIfMissing: boolean;
}) => {
  let transcriptId: string | undefined;
  if (input.callSessionId) {
    await ensureCallSessionForSalon(input.salonId, input.callSessionId);
    const transcript = await createTranscriptForSession(input.callSessionId, {
      transcriptSource: input.transcriptSource,
      transcriptText: input.transcriptText
    });
    transcriptId = transcript.id;
  }

  return bookingFromText({
    salonId: input.salonId,
    actorUserId: input.actorUserId,
    text: input.transcriptText,
    callSessionId: input.callSessionId,
    transcriptId,
    createCustomerIfMissing: input.createCustomerIfMissing
  });
};

export const suggestSlotsFromAIInput = async (input: SuggestSlotsInput) => {
  const service = await resolveService(input.salonId, input.serviceName);
  if (!service) {
    throw new AppError(`Service not found: ${input.serviceName}`, 404, "SERVICE_NOT_FOUND");
  }

  const salon = await prisma.salon.findUnique({
    where: {
      id: input.salonId
    },
    select: {
      timezone: true
    }
  });
  if (!salon) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }

  const staffCandidates = await getStaffCandidates({
    salonId: input.salonId,
    requestedStaffName: input.staffName
  });
  if (!staffCandidates.length) {
    return {
      service,
      suggestions: []
    };
  }

  const suggestions = await getSuggestedSlotsForService({
    salonId: input.salonId,
    serviceId: service.id,
    staffCandidates,
    timezone: salon.timezone,
    preferredStartTime: input.preferredStartTime,
    daysAhead: input.daysAhead,
    maxSlots: input.maxSlots
  });

  return {
    service,
    suggestions
  };
};

export const getAIInteractionById = async (salonId: string, interactionId: string) => {
  const interaction = await prisma.aiInteractionLog.findFirst({
    where: {
      id: interactionId,
      salonId
    },
    include: {
      bookingAttempt: true,
      transcript: true,
      callSession: true
    }
  });
  if (!interaction) {
    throw new AppError("AI interaction log not found.", 404, "AI_INTERACTION_NOT_FOUND");
  }
  return interaction;
};

export const listAIInteractions = async (
  salonId: string,
  input: { page: number; limit: number; taskType?: string; callSessionId?: string }
) => {
  const skip = (input.page - 1) * input.limit;
  const where = {
    salonId,
    ...(input.taskType ? { taskType: input.taskType } : {}),
    ...(input.callSessionId ? { callSessionId: input.callSessionId } : {})
  };

  const [items, total] = await Promise.all([
    prisma.aiInteractionLog.findMany({
      where,
      skip,
      take: input.limit,
      orderBy: { createdAt: "desc" },
      include: {
        bookingAttempt: true,
        transcript: true
      }
    }),
    prisma.aiInteractionLog.count({ where })
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

export const getAIInteractionByIdForAdmin = async (interactionId: string) => {
  const interaction = await prisma.aiInteractionLog.findUnique({
    where: {
      id: interactionId
    },
    include: {
      salon: {
        select: {
          id: true,
          name: true
        }
      },
      bookingAttempt: true,
      transcript: true,
      callSession: true
    }
  });
  if (!interaction) {
    throw new AppError("AI interaction log not found.", 404, "AI_INTERACTION_NOT_FOUND");
  }
  return interaction;
};

export const listAIInteractionsForAdmin = async (input: {
  page: number;
  limit: number;
  salonId?: string;
  taskType?: string;
}) => {
  const skip = (input.page - 1) * input.limit;
  const where = {
    ...(input.salonId ? { salonId: input.salonId } : {}),
    ...(input.taskType ? { taskType: input.taskType } : {})
  };

  const [items, total] = await Promise.all([
    prisma.aiInteractionLog.findMany({
      where,
      skip,
      take: input.limit,
      orderBy: { createdAt: "desc" },
      include: {
        salon: {
          select: {
            id: true,
            name: true
          }
        },
        bookingAttempt: true,
        callSession: true
      }
    }),
    prisma.aiInteractionLog.count({ where })
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
