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
import { logger } from "../../lib/logger";
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
  intentName?: string;
  text?: string;
  transcript?: string;
  customer?: {
    name?: string;
    phone?: string;
  };
  customerName?: string;
  customerPhone?: string;
  callerPhone?: string;
  service?: string;
  serviceName?: string;
  preferredDateTime?: string;
  requestedDate?: string;
  requestedTime?: string;
  staffPreference?: string;
  confirmationState?: string;
  source?: string;
  contactId?: string;
  callSessionId?: string;
  amazonConnectContactId?: string;
  amazonConnectPhoneNumber?: string;
  calledNumber?: string;
  provider?: string;
  attributes?: Record<string, unknown>;
}

type AmazonConnectAIAppointmentOutcome =
  | "BOOKED"
  | "MISSING_INFO"
  | "NO_AVAILABILITY"
  | "HUMAN_ESCALATION"
  | "FAILED";

type SuggestedSlot = {
  staffId: string;
  staffName: string;
  startTime: string;
  endTime: string;
};

type StaffCandidate = {
  id: string;
  fullName: string;
};

type StaffPreferenceResolution =
  | {
      status: "all";
      candidates: StaffCandidate[];
      allStaff: StaffCandidate[];
      rawStaffPreference?: string;
      invalidReason?: "explicit_any" | "invalid_format" | "no_match" | "missing";
    }
  | {
      status: "matched";
      candidates: StaffCandidate[];
      allStaff: StaffCandidate[];
      rawStaffPreference: string;
      matchedStaff: StaffCandidate;
    }
  | {
      status: "ambiguous";
      candidates: StaffCandidate[];
      allStaff: StaffCandidate[];
      rawStaffPreference: string;
      ambiguousStaffNames: string[];
    };

type ServiceMatch = {
  service: {
    id: string;
    name: string;
    durationMinutes: number;
    priceCents: number;
  };
  confidence: number;
  exact: boolean;
  matchedBy: "exact" | "alias" | "fuzzy";
};

type SalonResolutionSource =
  | "explicit_salon_id"
  | "amazon_connect_integration_config"
  | "amazon_connect_reception_setup"
  | "salon_phone_number"
  | "default_salon_demo_fallback";

const toJson = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12
};

const WEEKDAY_INDEXES: Record<string, number> = {
  sunday: 7,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

const SERVICE_ALIASES: Record<string, string[]> = {
  pedicure: ["bettercure", "pedic care", "petty cure", "pedi cure", "peddy cure", "pedicure"],
  manicure: ["many cure", "manny cure", "mani cure", "manicure"],
  "gel manicure": ["gel many cure", "gel manny cure", "gel mani cure", "gel manicure"],
  "acrylic full set": ["acrilic", "acyclic", "acrylic", "acrylic set", "acrylic full set"],
  "dip powder": ["dip", "deep powder", "dip power", "dip powder"]
};

const ANY_STAFF_PHRASES = new Set([
  "any",
  "anyone",
  "any one",
  "any available staff",
  "any staff",
  "any technician",
  "any tech",
  "no preference",
  "no staff preference",
  "no specific staff",
  "first available",
  "someone available",
  "whoever",
  "whoever is available",
  "whoever's available",
  "who is available",
  "anybody"
]);

const DEMO_STAFF_NAMES = ["Mia Carter", "Olivia Brooks", "Nora Evans"];
const DEMO_SERVICE_NAMES = ["Manicure", "Pedicure", "Gel Manicure", "Acrylic Full Set", "Dip Powder"];

const normalizeForMatch = (value?: string | null): string => {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
};

const compactForMatch = (value?: string | null): string => normalizeForMatch(value).replace(/\s/g, "");

const levenshteinDistance = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }
  if (!left.length) {
    return right.length;
  }
  if (!right.length) {
    return left.length;
  }

  const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    current[0] = leftIndex + 1;
    for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex] === right[rightIndex] ? 0 : 1;
      current[rightIndex + 1] = Math.min(
        current[rightIndex] + 1,
        previous[rightIndex + 1] + 1,
        previous[rightIndex] + substitutionCost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length] ?? Math.max(left.length, right.length);
};

const similarityScore = (left: string, right: string): number => {
  const normalizedLeft = compactForMatch(left);
  const normalizedRight = compactForMatch(right);
  const longest = Math.max(normalizedLeft.length, normalizedRight.length);
  if (!longest) {
    return 0;
  }
  return 1 - levenshteinDistance(normalizedLeft, normalizedRight) / longest;
};

const isAffirmative = (value?: string | null): boolean => {
  return /^(yes|yeah|yep|correct|right|that is right|that's right|sure|ok|okay)$/i.test(
    normalizeForMatch(value)
  );
};

const isNegative = (value?: string | null): boolean => {
  return /^(no|nope|not that|wrong)$/i.test(normalizeForMatch(value));
};

const isAnyStaffPreference = (value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  return Boolean(normalized && ANY_STAFF_PHRASES.has(normalized));
};

const isClearlyInvalidStaffPreference = (value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  const compact = compactForMatch(value);
  if (!normalized || isAnyStaffPreference(normalized)) {
    return false;
  }
  if (compact.length < 3) {
    return true;
  }
  if (!/[a-z]/.test(normalized)) {
    return true;
  }
  return /\d/.test(compact);
};

const isConfirmationAccepted = (value?: string | null): boolean => {
  return normalizeForMatch(value) === "confirmed";
};

const isConfirmationDenied = (value?: string | null): boolean => {
  return normalizeForMatch(value) === "denied";
};

const stripLeadingCountryCode = (value?: string | null): string => {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
};

const readStringAttribute = (
  attributes: Record<string, unknown> | undefined,
  names: string[]
): string | undefined => {
  for (const name of names) {
    const value = attributes?.[name];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
};

const parseAttemptCount = (value?: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const MAX_SLOT_RETRY_COUNT = 3;

const BOOKING_ATTRIBUTE_NAMES = {
  customerName: ["customerName", "CustomerName"],
  customerPhone: ["customerPhone", "CustomerPhone", "callerPhone", "CallerId", "ANI"],
  serviceName: ["serviceName", "ServiceName", "service", "Service"],
  requestedDate: ["requestedDate", "RequestedDate", "preferredDate", "preferredDateTime"],
  requestedTime: ["requestedTime", "RequestedTime", "preferredTime"],
  staffPreference: ["staffPreference", "StaffPreference"],
  contactId: ["contactId", "amazonConnectContactId", "AmazonConnectContactId", "callSessionId"],
  amazonConnectPhoneNumber: [
    "amazonConnectPhoneNumber",
    "AmazonConnectPhoneNumber",
    "CalledNumber",
    "DialedNumber"
  ],
  calledNumber: ["calledNumber", "CalledNumber", "DialedNumber"],
  source: ["source", "Source"],
  provider: ["provider", "Provider"]
};

const readBookingFieldAttribute = (
  attributes: Record<string, unknown> | undefined,
  fieldName: keyof typeof BOOKING_ATTRIBUTE_NAMES
): string | undefined => {
  return readStringAttribute(attributes, BOOKING_ATTRIBUTE_NAMES[fieldName]);
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

const normalizeSpokenNumbers = (value: string): string => {
  return value.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi,
    (match) => String(NUMBER_WORDS[match.toLowerCase()] ?? match)
  );
};

const parseLocalDateText = (value: string, timezone: string): DateTime | null => {
  const cleaned = normalizeForMatch(value);
  const now = DateTime.now().setZone(timezone);

  if (cleaned === "today") {
    return now.startOf("day");
  }
  if (cleaned === "tomorrow") {
    return now.plus({ days: 1 }).startOf("day");
  }

  const weekday = WEEKDAY_INDEXES[cleaned];
  if (weekday) {
    let daysUntil = weekday - now.weekday;
    if (daysUntil <= 0) {
      daysUntil += 7;
    }
    return now.plus({ days: daysUntil }).startOf("day");
  }

  const isoDate = DateTime.fromISO(value.trim(), { zone: timezone });
  if (isoDate.isValid) {
    return isoDate.startOf("day");
  }

  const formats = ["M/d/yyyy", "M-d-yyyy", "LLLL d yyyy", "LLL d yyyy", "LLLL d", "LLL d"];
  for (const format of formats) {
    const parsed = DateTime.fromFormat(value.trim(), format, { zone: timezone });
    if (parsed.isValid) {
      const withYear = parsed.year === now.year ? parsed : parsed.set({ year: now.year });
      return withYear.startOf("day");
    }
  }

  return null;
};

const parseLocalTimeText = (value: string): { hour: number; minute: number; ambiguous: boolean } | null => {
  const normalized = normalizeSpokenNumbers(value)
    .replace(/\ba\.?m\.?\b/gi, "am")
    .replace(/\bp\.?m\.?\b/gi, "pm")
    .trim();

  const periodMatch = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (periodMatch) {
    let hour = Number(periodMatch[1]);
    const minute = Number(periodMatch[2] ?? 0);
    const period = periodMatch[3]?.toLowerCase();
    if (hour < 1 || hour > 12 || minute > 59) {
      return null;
    }
    if (period === "pm" && hour < 12) {
      hour += 12;
    }
    if (period === "am" && hour === 12) {
      hour = 0;
    }
    return { hour, minute, ambiguous: false };
  }

  const twentyFourHourMatch = normalized.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (twentyFourHourMatch) {
    const hour = Number(twentyFourHourMatch[1]);
    const minute = Number(twentyFourHourMatch[2]);
    return { hour, minute, ambiguous: hour > 0 && hour < 12 };
  }

  const bareHourMatch = normalized.match(/\b(\d{1,2})\b/);
  if (bareHourMatch) {
    const hour = Number(bareHourMatch[1]);
    if (hour >= 1 && hour <= 12) {
      return { hour, minute: 0, ambiguous: true };
    }
    if (hour >= 13 && hour <= 23) {
      return { hour, minute: 0, ambiguous: false };
    }
  }

  return null;
};

const parseDateTimeText = (
  text: string,
  timezone: string
): { local: DateTime; sourceText: string; ambiguousTime: boolean } | null => {
  const raw = text.trim();
  const isoDateTimeMatch = raw.match(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/i
  );
  if (isoDateTimeMatch?.[0]) {
    const parsed = DateTime.fromISO(isoDateTimeMatch[0], { setZone: true });
    if (parsed.isValid) {
      return {
        local: parsed.setZone(timezone),
        sourceText: isoDateTimeMatch[0],
        ambiguousTime: false
      };
    }
  }

  const explicitLocalMatch = raw.match(
    /(\d{4}-\d{2}-\d{2}|[01]?\d\/[0-3]?\d\/\d{4}|today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:\s+|.*?\s+at\s+)([a-z0-9:.\s]+?(?:am|pm)?)(?:$|[,.])/i
  );
  if (explicitLocalMatch) {
    const localDate = parseLocalDateText(explicitLocalMatch[1] ?? "", timezone);
    const localTime = parseLocalTimeText(explicitLocalMatch[2] ?? "");
    if (localDate && localTime && !localTime.ambiguous) {
      return {
        local: localDate.set({
          hour: localTime.hour,
          minute: localTime.minute,
          second: 0,
          millisecond: 0
        }),
        sourceText: explicitLocalMatch[0],
        ambiguousTime: false
      };
    }
    if (localDate && localTime?.ambiguous) {
      return {
        local: localDate.set({
          hour: localTime.hour,
          minute: localTime.minute,
          second: 0,
          millisecond: 0
        }),
        sourceText: explicitLocalMatch[0],
        ambiguousTime: true
      };
    }
  }

  const tomorrowMatch = raw.match(/tomorrow(?:\s+at)?\s+([a-z0-9:.\s]+?(?:am|pm)?)(?:$|[,.])/i);
  if (tomorrowMatch) {
    const localDate = parseLocalDateText("tomorrow", timezone);
    const localTime = parseLocalTimeText(tomorrowMatch[1] ?? "");
    if (localDate && localTime) {
      return {
        local: localDate.set({
          hour: localTime.hour,
          minute: localTime.minute,
          second: 0,
          millisecond: 0
        }),
        sourceText: tomorrowMatch[0],
        ambiguousTime: localTime.ambiguous
      };
    }
  }

  return null;
};

const parseDateTimeFromText = (text: string, timezone: string): string | undefined => {
  const parsed = parseDateTimeText(text, timezone);
  if (!parsed || parsed.ambiguousTime || !parsed.local.isValid) {
    return undefined;
  }
  return parsed.local.toUTC().toISO() ?? undefined;
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

  const missing = new Set<string>(
    intent.missingFields.filter((field) => field !== "staffPreference")
  );
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

const sanitizeParsedIntentForConfiguredData = async (
  salonId: string,
  intent: BookingIntentResult,
  staff: StaffCandidate[]
): Promise<BookingIntentResult> => {
  const staffValue = intent.normalizedBookingRequest.staffName ?? intent.requestedStaff;
  const staffResolution = resolveStaffPreferenceFromCandidates(staff, staffValue);
  const nextNormalizedRequest = {
    ...intent.normalizedBookingRequest
  };
  let requestedStaff = intent.requestedStaff;

  if (staffValue) {
    if (staffResolution.status === "matched") {
      requestedStaff = staffResolution.matchedStaff.fullName;
      nextNormalizedRequest.staffName = staffResolution.matchedStaff.fullName;
    } else if (staffResolution.status === "ambiguous") {
      requestedStaff = staffResolution.rawStaffPreference;
      nextNormalizedRequest.staffName = staffResolution.rawStaffPreference;
    } else {
      requestedStaff = undefined;
      nextNormalizedRequest.staffName = undefined;
    }
  }

  const serviceValue = nextNormalizedRequest.serviceName ?? intent.requestedService;
  let requestedService = intent.requestedService;
  if (serviceValue) {
    const serviceMatch = await resolveServiceMatch(salonId, serviceValue);
    if (serviceMatch && (serviceMatch.exact || serviceMatch.matchedBy === "alias")) {
      requestedService = serviceMatch.service.name;
      nextNormalizedRequest.serviceName = serviceMatch.service.name;
    }
  }

  return normalizeIntentResult({
    ...intent,
    requestedService,
    requestedStaff,
    missingFields: intent.missingFields.filter((field) => field !== "staffPreference"),
    normalizedBookingRequest: nextNormalizedRequest
  });
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
  bookingAttemptId?: string;
  provider?: ExternalProvider;
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
      provider: input.provider ?? ExternalProvider.VERTEX,
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
      bookingAttemptId: input.bookingAttemptId,
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

  const normalized = await sanitizeParsedIntentForConfiguredData(
    input.salonId,
    normalizeIntentResult(parsedIntent),
    context.staff
  );
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

const getServiceAliasPhrases = (serviceName: string): string[] => {
  const normalized = normalizeForMatch(serviceName);
  const aliases = new Set<string>([serviceName, normalized]);
  Object.entries(SERVICE_ALIASES).forEach(([canonical, phrases]) => {
    const normalizedCanonical = normalizeForMatch(canonical);
    if (normalized === normalizedCanonical || normalized.includes(normalizedCanonical)) {
      phrases.forEach((phrase) => aliases.add(phrase));
    }
  });
  return Array.from(aliases.values());
};

const rankServiceMatch = (
  service: ServiceMatch["service"],
  requestedServiceName: string
): ServiceMatch | null => {
  const requested = normalizeForMatch(requestedServiceName);
  if (!requested) {
    return null;
  }

  const serviceName = normalizeForMatch(service.name);
  const requestedCompact = compactForMatch(requested);
  const serviceCompact = compactForMatch(serviceName);

  if (requestedCompact === serviceCompact) {
    return { service, confidence: 1, exact: true, matchedBy: "exact" };
  }

  if (
    requestedCompact.length >= 4 &&
    (serviceCompact.includes(requestedCompact) || requestedCompact.includes(serviceCompact))
  ) {
    return { service, confidence: 0.94, exact: true, matchedBy: "exact" };
  }

  const aliasScore = getServiceAliasPhrases(service.name).reduce((best, phrase) => {
    const alias = compactForMatch(phrase);
    if (!alias) {
      return best;
    }
    if (alias === requestedCompact) {
      return Math.max(best, 0.96);
    }
    return Math.max(best, similarityScore(alias, requestedCompact));
  }, 0);

  if (aliasScore >= 0.88) {
    return { service, confidence: aliasScore, exact: false, matchedBy: "alias" };
  }

  const fuzzyScore = similarityScore(serviceName, requested);
  if (fuzzyScore >= 0.74) {
    return { service, confidence: fuzzyScore, exact: false, matchedBy: "fuzzy" };
  }

  return null;
};

const resolveServiceMatch = async (
  salonId: string,
  serviceName: string
): Promise<ServiceMatch | null> => {
  const services = await prisma.service.findMany({
    where: {
      salonId,
      isActive: true
    },
    select: {
      id: true,
      name: true,
      durationMinutes: true,
      priceCents: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  return services
    .map((service) => rankServiceMatch(service, serviceName))
    .filter((match): match is ServiceMatch => Boolean(match))
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        Number(right.exact) - Number(left.exact) ||
        left.service.name.length - right.service.name.length
    )[0] ?? null;
};

const resolveService = async (salonId: string, serviceName: string) => {
  return (await resolveServiceMatch(salonId, serviceName))?.service ?? null;
};

const findServiceMentionInText = async (
  salonId: string,
  text?: string
): Promise<ServiceMatch | null> => {
  const normalizedText = compactForMatch(text);
  if (!normalizedText) {
    return null;
  }

  const services = await prisma.service.findMany({
    where: {
      salonId,
      isActive: true
    },
    select: {
      id: true,
      name: true,
      durationMinutes: true,
      priceCents: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  const matches = services
    .map<ServiceMatch | null>((service) => {
      const phrases = getServiceAliasPhrases(service.name);
      const phrase = phrases.find((candidate) => {
        const compact = compactForMatch(candidate);
        return compact.length >= 3 && normalizedText.includes(compact);
      });
      return phrase
        ? ({
            service,
            confidence: compactForMatch(phrase) === compactForMatch(service.name) ? 1 : 0.94,
            exact: compactForMatch(phrase) === compactForMatch(service.name),
            matchedBy: compactForMatch(phrase) === compactForMatch(service.name) ? "exact" : "alias"
          })
        : null;
    })
    .filter((match): match is ServiceMatch => Boolean(match));

  return (
    matches.sort(
      (left, right) =>
        right.confidence - left.confidence ||
        Number(right.exact) - Number(left.exact) ||
        left.service.name.length - right.service.name.length
    )[0] ?? null
  );
};

const findStaffMentionInText = async (
  salonId: string,
  text?: string
): Promise<string | undefined> => {
  const normalizedText = normalizeForMatch(text);
  if (!normalizedText) {
    return undefined;
  }

  const staff = await getStaffCandidates({ salonId });
  return staff.find((member) => {
    const fullName = normalizeForMatch(member.fullName);
    const firstName = normalizeForMatch(member.fullName.split(/\s+/)[0]);
    return normalizedText.includes(fullName) || normalizedText.includes(firstName);
  })?.fullName;
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

const dedupeStaffById = (staff: StaffCandidate[]): StaffCandidate[] => {
  const seen = new Set<string>();
  return staff.filter((member) => {
    if (seen.has(member.id)) {
      return false;
    }
    seen.add(member.id);
    return true;
  });
};

const getActiveBookableStaff = async (salonId: string): Promise<StaffCandidate[]> => {
  return orderStaffForDemo(await prisma.staff.findMany({
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
  }));
};

const resolveStaffPreferenceFromCandidates = (
  staff: StaffCandidate[],
  requestedStaffName?: string
): StaffPreferenceResolution => {
  const allStaff = orderStaffForDemo(dedupeStaffById(staff));
  const rawStaffPreference = requestedStaffName?.trim();
  const requested = normalizeForMatch(rawStaffPreference);

  if (!requested) {
    return {
      status: "all",
      candidates: allStaff,
      allStaff,
      invalidReason: "missing"
    };
  }
  if (isAnyStaffPreference(requested)) {
    return {
      status: "all",
      candidates: allStaff,
      allStaff,
      rawStaffPreference,
      invalidReason: "explicit_any"
    };
  }
  if (isClearlyInvalidStaffPreference(requested)) {
    return {
      status: "all",
      candidates: allStaff,
      allStaff,
      rawStaffPreference,
      invalidReason: "invalid_format"
    };
  }

  const exactMatches = allStaff.filter((member) => {
    const fullName = normalizeForMatch(member.fullName);
    const firstName = normalizeForMatch(member.fullName.split(/\s+/)[0]);
    return fullName === requested || firstName === requested;
  });

  if (exactMatches.length === 1) {
    return {
      status: "matched",
      candidates: exactMatches,
      allStaff,
      rawStaffPreference: rawStaffPreference!,
      matchedStaff: exactMatches[0]!
    };
  }
  if (exactMatches.length > 1) {
    return {
      status: "ambiguous",
      candidates: exactMatches,
      allStaff,
      rawStaffPreference: rawStaffPreference!,
      ambiguousStaffNames: Array.from(new Set(exactMatches.map((member) => member.fullName)))
    };
  }

  const containsMatches = allStaff.filter((member) => {
    const fullName = normalizeForMatch(member.fullName);
    const firstName = normalizeForMatch(member.fullName.split(/\s+/)[0]);
    return (
      requested.length >= 3 &&
      (fullName.includes(requested) ||
        requested.includes(fullName) ||
        (firstName.length >= 3 && (firstName.includes(requested) || requested.includes(firstName))))
    );
  });

  if (containsMatches.length === 1) {
    return {
      status: "matched",
      candidates: containsMatches,
      allStaff,
      rawStaffPreference: rawStaffPreference!,
      matchedStaff: containsMatches[0]!
    };
  }
  if (containsMatches.length > 1) {
    return {
      status: "ambiguous",
      candidates: containsMatches,
      allStaff,
      rawStaffPreference: rawStaffPreference!,
      ambiguousStaffNames: Array.from(new Set(containsMatches.map((member) => member.fullName)))
    };
  }

  const fuzzyMatches = allStaff
    .map((member) => {
      const fullName = normalizeForMatch(member.fullName);
      const firstName = normalizeForMatch(member.fullName.split(/\s+/)[0]);
      const score = Math.max(similarityScore(fullName, requested), similarityScore(firstName, requested));
      return { member, score };
    })
    .filter((item) => item.score >= 0.84)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.member);

  if (fuzzyMatches.length === 1) {
    return {
      status: "matched",
      candidates: fuzzyMatches,
      allStaff,
      rawStaffPreference: rawStaffPreference!,
      matchedStaff: fuzzyMatches[0]!
    };
  }
  if (fuzzyMatches.length > 1) {
    return {
      status: "ambiguous",
      candidates: fuzzyMatches,
      allStaff,
      rawStaffPreference: rawStaffPreference!,
      ambiguousStaffNames: Array.from(new Set(fuzzyMatches.map((member) => member.fullName)))
    };
  }

  return {
    status: "all",
    candidates: allStaff,
    allStaff,
    rawStaffPreference,
    invalidReason: "no_match"
  };
};

const resolveStaffCandidates = async (input: {
  salonId: string;
  requestedStaffName?: string;
}): Promise<StaffPreferenceResolution> => {
  return resolveStaffPreferenceFromCandidates(
    await getActiveBookableStaff(input.salonId),
    input.requestedStaffName
  );
};

const getStaffCandidates = async (input: {
  salonId: string;
  requestedStaffName?: string;
}) => {
  const resolution = await resolveStaffCandidates(input);
  return resolution.status === "ambiguous" ? [] : resolution.candidates;
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

const parseRequestedStartTimeDetailed = (input: {
  requestedDate: string;
  requestedTime?: string;
  timezone: string;
}): { utcDate: Date; localDateTime: DateTime; originalText: string } => {
  const requestedDate = input.requestedDate.trim();
  const requestedTime = input.requestedTime?.trim();
  const originalText = [requestedDate, requestedTime].filter(Boolean).join(" ");

  if (!requestedTime) {
    const parsedDateTime = parseDateTimeText(requestedDate, input.timezone);
    if (parsedDateTime?.ambiguousTime) {
      throw new AppError("Did you mean 5 PM?", 400, "AMBIGUOUS_REQUESTED_TIME");
    }
    if (parsedDateTime?.local.isValid) {
      return {
        utcDate: parsedDateTime.local.toUTC().toJSDate(),
        localDateTime: parsedDateTime.local,
        originalText
      };
    }

    const iso = DateTime.fromISO(requestedDate, { setZone: true });
    if (iso.isValid && /T\d{2}:\d{2}/.test(requestedDate)) {
      const localDateTime = iso.setZone(input.timezone);
      return {
        utcDate: localDateTime.toUTC().toJSDate(),
        localDateTime,
        originalText
      };
    }
    throw new AppError("requestedDate must be a valid ISO date or datetime.", 400, "INVALID_REQUESTED_DATE");
  }

  const localDate = parseLocalDateText(requestedDate, input.timezone);
  const localTime = parseLocalTimeText(requestedTime);
  if (!localDate) {
    throw new AppError("requestedDate must be a valid date.", 400, "INVALID_REQUESTED_DATE");
  }
  if (!localTime) {
    throw new AppError("requestedTime must be a valid appointment time.", 400, "INVALID_REQUESTED_TIME");
  }
  if (localTime.ambiguous) {
    throw new AppError(`Did you mean ${localTime.hour} PM?`, 400, "AMBIGUOUS_REQUESTED_TIME");
  }

  const localDateTime = localDate.set({
    hour: localTime.hour,
    minute: localTime.minute,
    second: 0,
    millisecond: 0
  });
  if (!localDateTime.isValid) {
    throw new AppError("requestedDate and requestedTime do not form a valid appointment time.", 400, "INVALID_REQUESTED_TIME");
  }

  return {
    utcDate: localDateTime.toUTC().toJSDate(),
    localDateTime,
    originalText
  };
};

const parseRequestedStartTime = (input: {
  requestedDate: string;
  requestedTime?: string;
  timezone: string;
}): Date => {
  return parseRequestedStartTimeDetailed(input).utcDate;
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
  customerPhone?: string;
  amazonConnectPhoneNumber?: string;
  calledNumber?: string;
  routingOutcome?: CallRoutingOutcome;
  finalResolution?: string;
}) => {
  const contactId = input.contactId?.trim();
  if (!contactId) {
    return null;
  }

  const routingOutcome = input.routingOutcome ?? CallRoutingOutcome.AI_RECEPTION;
  const finalResolution = input.finalResolution ?? "Amazon Connect AI reception in progress.";

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
      routingOutcome,
      finalResolution
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
      routingOutcome,
      startedAt: new Date(),
      finalResolution
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
        const deduped = dedupeSuggestedSlots(suggestions);
        if (deduped.length >= input.maxSlots) {
          return deduped;
        }
      }
    }
  }

  return dedupeSuggestedSlots(suggestions);
};

const getRequestedStaffBusyAlternatives = async (input: {
  salonId: string;
  serviceId: string;
  requestedStaff: { id: string; fullName: string };
  allStaffCandidates: Array<{ id: string; fullName: string }>;
  timezone: string;
  preferredStartTime: Date;
}): Promise<SuggestedSlot[]> => {
  const suggestions: SuggestedSlot[] = [];

  for (const staff of input.allStaffCandidates) {
    if (staff.id === input.requestedStaff.id) {
      continue;
    }
    try {
      const slotValidation = await validateAppointmentSlot({
        salonId: input.salonId,
        staffId: staff.id,
        serviceIds: [input.serviceId],
        startTime: input.preferredStartTime
      });
      if (slotValidation.valid) {
        suggestions.push({
          staffId: staff.id,
          staffName: staff.fullName,
          startTime: input.preferredStartTime.toISOString(),
          endTime: slotValidation.endTime.toISOString()
        });
        break;
      }
    } catch (error) {
      if (error instanceof AppError && error.statusCode < 500) {
        continue;
      }
      throw error;
    }
  }

  const preferredUtc = DateTime.fromJSDate(input.preferredStartTime, { zone: "utc" });
  const localStart = preferredUtc.setZone(input.timezone);
  for (let offset = 0; offset < 7; offset += 1) {
    const localDate = localStart.plus({ days: offset }).toFormat("yyyy-MM-dd");
    const available = await getAvailableSlots({
      salonId: input.salonId,
      serviceId: input.serviceId,
      staffId: input.requestedStaff.id,
      date: localDate,
      intervalMinutes: 15
    });
    const nextSlot = available.slots.find((slot) => {
      const slotStart = DateTime.fromISO(slot.startTime, { zone: "utc" });
      return slotStart.toMillis() > preferredUtc.toMillis();
    });
    if (nextSlot) {
      suggestions.push({
        staffId: input.requestedStaff.id,
        staffName: input.requestedStaff.fullName,
        startTime: nextSlot.startTime,
        endTime: nextSlot.endTime
      });
      break;
    }
  }

  return dedupeSuggestedSlots(suggestions).slice(0, 2);
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

const asTrimmedString = (value?: string | null): string | undefined => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const hasTimeComponent = (value?: string): boolean => {
  if (!value) {
    return false;
  }
  return /T\d{1,2}:\d{2}|[^\d]\d{1,2}:\d{2}|\b\d{1,2}\s?(am|pm)\b|\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s?(am|pm)\b/i.test(
    value
  );
};

const normalizeAmazonConnectAppointmentInput = (input: CreateAmazonConnectAIAppointmentInput) => {
  const attributes = input.attributes ?? {};
  const suggestedServiceName = readStringAttribute(attributes, [
    "serviceSuggestionName",
    "aiSuggestedServiceName"
  ]);
  const customerName =
    asTrimmedString(input.customerName) ??
    asTrimmedString(input.customer?.name) ??
    readBookingFieldAttribute(attributes, "customerName");
  const customerPhone =
    asTrimmedString(input.customerPhone) ??
    asTrimmedString(input.customer?.phone) ??
    asTrimmedString(input.callerPhone) ??
    readBookingFieldAttribute(attributes, "customerPhone");
  const rawServiceName =
    asTrimmedString(input.serviceName) ??
    asTrimmedString(input.service) ??
    readBookingFieldAttribute(attributes, "serviceName");
  const serviceName =
    rawServiceName && isAffirmative(rawServiceName) && suggestedServiceName
      ? suggestedServiceName
      : rawServiceName;
  const requestedDate =
    asTrimmedString(input.requestedDate) ??
    asTrimmedString(input.preferredDateTime) ??
    readBookingFieldAttribute(attributes, "requestedDate");
  const requestedTime =
    asTrimmedString(input.requestedTime) ?? readBookingFieldAttribute(attributes, "requestedTime");
  const contactId =
    asTrimmedString(input.amazonConnectContactId) ??
    asTrimmedString(input.contactId) ??
    asTrimmedString(input.callSessionId) ??
    readBookingFieldAttribute(attributes, "contactId");
  const transcriptText = asTrimmedString(input.transcript) ?? asTrimmedString(input.text);
  const intentName = asTrimmedString(input.intentName);
  const source = asTrimmedString(input.source) ?? readBookingFieldAttribute(attributes, "source") ?? "AMAZON_CONNECT_LEX";

  return {
    intentName,
    customerName,
    customerPhone,
    serviceName,
    requestedDate,
    requestedTime,
    staffPreference:
      asTrimmedString(input.staffPreference) ??
      readBookingFieldAttribute(attributes, "staffPreference"),
    confirmationState: asTrimmedString(input.confirmationState),
    source,
    contactId,
    transcriptText,
    amazonConnectPhoneNumber:
      asTrimmedString(input.amazonConnectPhoneNumber) ??
      readBookingFieldAttribute(attributes, "amazonConnectPhoneNumber"),
    calledNumber:
      asTrimmedString(input.calledNumber) ?? readBookingFieldAttribute(attributes, "calledNumber"),
    provider:
      asTrimmedString(input.provider) ??
      readBookingFieldAttribute(attributes, "provider") ??
      "AMAZON_CONNECT",
    attributes
  };
};

const shouldEscalateToHuman = (input: {
  intentName?: string;
  transcriptText?: string;
  serviceName?: string;
  attributes?: Record<string, unknown>;
}): boolean => {
  const intent = input.intentName?.toLowerCase();
  if (
    readStringAttribute(input.attributes, ["forceHumanEscalation"]) === "true" ||
    readStringAttribute(input.attributes, ["transferToQueue"]) === "true"
  ) {
    return true;
  }

  if (
    intent === "humanescalationintent" ||
    intent === "cancelappointmentintent" ||
    intent === "rescheduleappointmentintent"
  ) {
    return true;
  }

  if (
    readStringAttribute(input.attributes, ["humanEscalationOffer"]) &&
    (isAffirmative(input.transcriptText) || isAffirmative(input.serviceName))
  ) {
    return true;
  }

  const text = input.transcriptText?.toLowerCase() ?? "";
  return /\b(real person|live person|human|operator|representative|agent|cancel|reschedule)\b/.test(
    text
  );
};

const buildInternalParsedIntent = (input: {
  intentType: BookingIntentResult["intentType"];
  customerName?: string;
  customerPhone?: string;
  serviceName?: string;
  staffPreference?: string;
  requestedDateTime?: string;
  missingFields: string[];
  isReadyToBook: boolean;
}): BookingIntentResult => ({
  intentType: input.intentType,
  customer: {
    name: input.customerName,
    phone: input.customerPhone
  },
  requestedService: input.serviceName,
  requestedStaff: input.staffPreference,
  requestedDateTime: input.requestedDateTime,
  confidence: 1,
  isReadyToBook: input.isReadyToBook,
  missingFields: input.missingFields,
  normalizedBookingRequest: {
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    serviceName: input.serviceName,
    staffName: input.staffPreference,
    startTimeIso: input.requestedDateTime,
    timezone: undefined
  }
});

const formatNameList = (values: string[]): string => {
  if (values.length <= 2) {
    return values.join(" and ");
  }
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
};

const orderStaffForDemo = <T extends { fullName: string }>(staff: T[]): T[] => {
  return [...staff].sort((left, right) => {
    const leftPriority = DEMO_STAFF_NAMES.findIndex(
      (name) => normalizeForMatch(name) === normalizeForMatch(left.fullName)
    );
    const rightPriority = DEMO_STAFF_NAMES.findIndex(
      (name) => normalizeForMatch(name) === normalizeForMatch(right.fullName)
    );
    const normalizedLeftPriority = leftPriority === -1 ? Number.MAX_SAFE_INTEGER : leftPriority;
    const normalizedRightPriority = rightPriority === -1 ? Number.MAX_SAFE_INTEGER : rightPriority;
    return normalizedLeftPriority - normalizedRightPriority;
  });
};

const getStaffPromptNames = (staffNames: string[]): string[] => {
  const available = new Set(staffNames.map((name) => normalizeForMatch(name)));
  const demoNames = DEMO_STAFF_NAMES.filter((name) => available.has(normalizeForMatch(name)));
  return demoNames.length === DEMO_STAFF_NAMES.length ? demoNames : staffNames.slice(0, 5);
};

const getServicePromptNames = (serviceNames: string[]): string[] => {
  const available = new Set(serviceNames.map((name) => normalizeForMatch(name)));
  const demoNames = DEMO_SERVICE_NAMES.filter((name) => available.has(normalizeForMatch(name)));
  return demoNames.length === DEMO_SERVICE_NAMES.length ? demoNames : serviceNames.slice(0, 5);
};

const formatLocalTimeForSpeech = (value: Date | string, timezone: string): string => {
  const dateTime =
    value instanceof Date
      ? DateTime.fromJSDate(value, { zone: "utc" }).setZone(timezone)
      : DateTime.fromISO(value, { zone: "utc" }).setZone(timezone);
  return dateTime.minute === 0 ? dateTime.toFormat("h a") : dateTime.toFormat("h:mm a");
};

const formatLocalDateTimeForSpeech = (value: Date, timezone: string): string => {
  const local = DateTime.fromJSDate(value, { zone: "utc" }).setZone(timezone);
  const now = DateTime.now().setZone(timezone);
  const date =
    local.hasSame(now, "day")
      ? "today"
      : local.hasSame(now.plus({ days: 1 }), "day")
        ? "tomorrow"
        : local.toFormat("cccc, LLL d");
  return `${date} at ${formatLocalTimeForSpeech(value, timezone)}`;
};

const dedupeSuggestedSlots = (slots: SuggestedSlot[]): SuggestedSlot[] => {
  const seenNameTime = new Set<string>();
  const seenStaffNames = new Set<string>();
  return slots.filter((slot) => {
    const staffName = normalizeForMatch(slot.staffName);
    const slotKey = `${staffName}|${DateTime.fromISO(slot.startTime, { zone: "utc" }).toISO() ?? slot.startTime}`;
    if (seenNameTime.has(slotKey) || seenStaffNames.has(staffName)) {
      return false;
    }
    seenNameTime.add(slotKey);
    seenStaffNames.add(staffName);
    return true;
  });
};

const formatAlternativeSentence = (alternatives: SuggestedSlot[], timezone: string): string => {
  const readable = dedupeSuggestedSlots(alternatives).slice(0, 2).map((slot) => {
    const time = formatLocalTimeForSpeech(slot.startTime, timezone);
    return `${slot.staffName} is available at ${time}`;
  });
  if (readable.length === 2) {
    return `${readable[0]}, or ${readable[1]}.`;
  }
  if (readable.length === 1) {
    return `${readable[0]}.`;
  }
  return "";
};

const escapeSsml = (value?: string | null): string => {
  return (value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
};

const speak = (content: string): string => `<speak>${content}</speak>`;

const buildBookingConfirmationMessage = (input: {
  serviceName: string;
  appointmentStartTime: Date;
  salonTimezone: string;
  staffName: string;
  customerName: string;
  customerPhone?: string;
}): string => {
  const service = input.serviceName.toLowerCase();
  const appointmentTime = formatLocalDateTimeForSpeech(
    input.appointmentStartTime,
    input.salonTimezone
  );
  const phone = stripLeadingCountryCode(input.customerPhone);
  const phoneText = phone ? `, phone number ${phone}` : "";
  return speak(
    `Just to confirm, you want to book a ${escapeSsml(service)} ${escapeSsml(appointmentTime)} with ${escapeSsml(input.staffName)}, under ${escapeSsml(input.customerName)}${escapeSsml(phoneText)}. <break time="300ms"/> Is that correct?`
  );
};

const buildLexMessage = (input: {
  outcome: AmazonConnectAIAppointmentOutcome;
  missingFields?: string[];
  appointmentStartTime?: Date;
  salonTimezone?: string;
  serviceName?: string;
  staffName?: string;
  staffNames?: string[];
  requestedStaffName?: string;
  alternatives?: SuggestedSlot[];
  failureReason?: string;
  knownFields?: {
    customerName?: string;
    customerPhone?: string;
    serviceName?: string;
    requestedDate?: string;
    requestedTime?: string;
    staffPreference?: string;
  };
  attemptCount?: number;
}): string => {
  if (input.outcome === "BOOKED") {
    const appointmentTime = input.appointmentStartTime
      ? formatLocalDateTimeForSpeech(
          input.appointmentStartTime,
          input.salonTimezone ?? "America/New_York"
        )
      : "the requested time";
    const service = input.serviceName ? input.serviceName.toLowerCase() : "appointment";
    const staff = input.staffName ? ` with ${input.staffName}` : "";
    return speak(
      `You're all set. <break time="300ms"/> Your ${escapeSsml(service)} is booked for ${escapeSsml(appointmentTime)}${escapeSsml(staff)}. Thank you for calling.`
    );
  }

  if (input.outcome === "HUMAN_ESCALATION") {
    return speak(
      `I'm having trouble getting that clearly. <break time="300ms"/> Please hold while I connect you with our team.`
    );
  }

  if (input.outcome === "MISSING_INFO") {
    const isRetry = (input.attemptCount ?? 1) > 1;
    const intro = isRetry ? "Sorry, I did not catch that." : "Got it.";
    if (input.missingFields?.includes("staffPreference")) {
      const staffList = formatNameList(getStaffPromptNames(input.staffNames ?? []));
      return staffList
        ? speak(
            `${intro} <break time="300ms"/> Do you prefer a specific staff member? We have ${escapeSsml(staffList)} available, or I can check anyone.`
          )
        : speak(
            `${intro} <break time="300ms"/> Do you prefer a specific staff member, or is anyone okay?`
          );
    }
    if (input.missingFields?.includes("customerName")) {
      return speak(
        `${intro} <break time="300ms"/> What's the best name for this booking?`
      );
    }
    if (input.missingFields?.includes("customerPhone")) {
      const name = input.knownFields?.customerName;
      return speak(
        `${name ? `Thanks, ${escapeSsml(name)}.` : intro} <break time="300ms"/> What phone number should we keep on the appointment?`
      );
    }
    if (input.missingFields?.includes("serviceName")) {
      return speak(
        `${intro} <break time="300ms"/> What service would you like to book?`
      );
    }
    if (input.missingFields?.includes("preferredDateTime")) {
      return input.knownFields?.requestedDate
        ? speak(
            `${intro} <break time="300ms"/> What time works best?`
          )
        : speak(
            `${intro} <break time="300ms"/> What day and time works best?`
          );
    }
    return speak(
      `${intro} <break time="300ms"/> What appointment detail should I use next?`
    );
  }

  if (input.outcome === "NO_AVAILABILITY") {
    const alternatives = (input.alternatives ?? []).slice(0, 2);
    if (!alternatives.length) {
      return speak(
        `That time is not available. <break time="300ms"/> Would you like another time or a different staff member?`
      );
    }

    const timezone = input.salonTimezone ?? "America/New_York";
    const formattedAlternatives = formatAlternativeSentence(alternatives, timezone);
    if (input.requestedStaffName && input.appointmentStartTime) {
      const requestedTime = formatLocalTimeForSpeech(input.appointmentStartTime, timezone);
      return speak(
        `${escapeSsml(input.requestedStaffName)} is not available at ${escapeSsml(requestedTime)}. <break time="300ms"/> ${escapeSsml(formattedAlternatives)} Which one works better?`
      );
    }
    return speak(
      `That time is not available. <break time="300ms"/> ${escapeSsml(formattedAlternatives)} Which one works better?`
    );
  }

  return speak(
    `${escapeSsml(
      input.failureReason ??
        "I could not confirm the appointment right now."
    )} <break time="300ms"/> Please hold while I connect you with our team.`
  );
};

const getElicitSlotForMissingFields = (
  missingFields: Set<string>,
  normalized: ReturnType<typeof normalizeAmazonConnectAppointmentInput>
): {
  slotToElicit: string;
  promptMissingFields: string[];
  attemptCount: number;
  shouldEscalate: boolean;
  sessionAttributes: Record<string, string>;
} => {
  let slotToElicit = "serviceName";
  if (missingFields.has("serviceName")) {
    slotToElicit = "serviceName";
  } else if (missingFields.has("preferredDateTime")) {
    slotToElicit = normalized.requestedDate ? "requestedTime" : "requestedDate";
  } else if (missingFields.has("customerName")) {
    slotToElicit = "customerName";
  } else if (missingFields.has("customerPhone")) {
    slotToElicit = "customerPhone";
  } else if (missingFields.has("staffPreference")) {
    slotToElicit = "staffPreference";
  }

  const lastAskedSlot = readStringAttribute(normalized.attributes, ["lastAskedSlot"]);
  const previousCount = parseAttemptCount(
    readStringAttribute(normalized.attributes, ["askedSlotsCount", "fallbackCount", "errorCount"])
  );
  const attemptCount = lastAskedSlot === slotToElicit ? previousCount + 1 : 1;
  const promptMissingFields =
    slotToElicit === "requestedDate" || slotToElicit === "requestedTime"
      ? ["preferredDateTime"]
      : [slotToElicit];

  return {
    slotToElicit,
    promptMissingFields,
    attemptCount,
    shouldEscalate: attemptCount >= MAX_SLOT_RETRY_COUNT,
    sessionAttributes: {
      lastAskedSlot: slotToElicit,
      askedSlotsCount: String(attemptCount),
      fallbackCount: String(attemptCount),
      errorCount: String(attemptCount)
    }
  };
};

const buildServiceClarificationMessage = (input: {
  heardServiceName: string;
  suggestedServiceName?: string;
  availableServiceNames: string[];
  attempts: number;
}): string => {
  if (input.attempts >= 2) {
    return speak(
      `I'm having trouble matching that service. <break time="300ms"/> Please hold while I connect you with our team.`
    );
  }
  if (input.suggestedServiceName) {
    return speak(
      `I heard ${escapeSsml(input.heardServiceName)}. <break time="300ms"/> Did you mean ${escapeSsml(input.suggestedServiceName)}?`
    );
  }
  const options = formatNameList(getServicePromptNames(input.availableServiceNames));
  return options
    ? speak(
        `I could not clearly match the service. <break time="300ms"/> We have ${escapeSsml(options)}. Which one would you like?`
      )
    : speak(
        `I heard ${escapeSsml(input.heardServiceName)}. <break time="300ms"/> Which service would you like?`
      );
};

const buildStaffClarificationMessage = (input: {
  availableStaffNames: string[];
}): string => {
  const options = formatNameList(getStaffPromptNames(input.availableStaffNames));
  return options
    ? speak(
        `Which staff member would you like? <break time="300ms"/> We have ${escapeSsml(options)} available, or I can check anyone.`
      )
    : speak("Which staff member would you like, or is anyone okay?");
};

const parseAlternativeSlotsAttribute = (
  attributes: Record<string, unknown> | undefined
): SuggestedSlot[] => {
  const raw = readStringAttribute(attributes, ["aiAlternativeSlots"]);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const slots = parsed
      .map((item) => {
        if (!item || typeof item !== "object") {
          return null;
        }
        const candidate = item as Partial<SuggestedSlot>;
        if (
          !candidate.staffId ||
          !candidate.staffName ||
          !candidate.startTime ||
          !candidate.endTime
        ) {
          return null;
        }
        return {
          staffId: candidate.staffId,
          staffName: candidate.staffName,
          startTime: candidate.startTime,
          endTime: candidate.endTime
        };
      })
      .filter((item): item is SuggestedSlot => Boolean(item));
    return dedupeSuggestedSlots(slots).slice(0, 2);
  } catch {
    return [];
  }
};

const textMentionsSlotTime = (text: string, slot: SuggestedSlot, timezone: string): boolean => {
  const normalizedText = normalizeForMatch(normalizeSpokenNumbers(text));
  const local = DateTime.fromISO(slot.startTime, { zone: "utc" }).setZone(timezone);
  const candidates = [
    local.toFormat("h:mm a"),
    local.toFormat("h:mm"),
    local.toFormat("h a"),
    local.toFormat("H:mm")
  ].map((value) => normalizeForMatch(value));
  return candidates.some((candidate) => normalizedText.includes(candidate));
};

const selectAlternativeSlotFromText = (input: {
  alternatives: SuggestedSlot[];
  transcriptText?: string;
  staffPreference?: string;
  timezone: string;
}): SuggestedSlot | null => {
  if (!input.alternatives.length) {
    return null;
  }

  const selectionText = [input.transcriptText, input.staffPreference].filter(Boolean).join(" ");
  const normalizedText = normalizeForMatch(selectionText);
  if (!normalizedText) {
    return null;
  }

  if (/\b(first|option one|number one)\b/.test(normalizedText)) {
    return input.alternatives[0] ?? null;
  }
  if (/\b(second|option two|number two)\b/.test(normalizedText)) {
    return input.alternatives[1] ?? null;
  }

  const staffMatch = input.alternatives.find((slot) => {
    const fullName = normalizeForMatch(slot.staffName);
    const firstName = normalizeForMatch(slot.staffName.split(/\s+/)[0]);
    return (
      normalizedText.includes(fullName) ||
      normalizedText.includes(firstName)
    );
  });
  if (staffMatch && textMentionsSlotTime(selectionText, staffMatch, input.timezone)) {
    return staffMatch;
  }

  const exactTimeMatch = input.alternatives.find((slot) =>
    textMentionsSlotTime(selectionText, slot, input.timezone)
  );
  if (exactTimeMatch) {
    return exactTimeMatch;
  }

  return staffMatch ?? null;
};

export const createAmazonConnectAIAppointment = async (
  input: CreateAmazonConnectAIAppointmentInput
) => {
  const normalized = normalizeAmazonConnectAppointmentInput(input);
  const { salon, resolutionSource } = await resolveAmazonConnectSalon({
    salonId: input.salonId,
    amazonConnectPhoneNumber: normalized.amazonConnectPhoneNumber,
    calledNumber: normalized.calledNumber
  });
  const actorUserId = await resolveActionActorUserId(salon.id);
  const callSession = await upsertAmazonConnectCallSession({
    salonId: salon.id,
    contactId: normalized.contactId,
    customerPhone: normalized.customerPhone,
    amazonConnectPhoneNumber: normalized.amazonConnectPhoneNumber,
    calledNumber: normalized.calledNumber
  });
  let activeBookingAttempt = callSession
    ? await prisma.bookingAttempt.findFirst({
        where: {
          callSessionId: callSession.id,
          status: BookingAttemptStatus.NEEDS_INPUT
        },
        orderBy: {
          createdAt: "desc"
        }
      })
    : null;
  const activeNormalizedRequest =
    activeBookingAttempt?.normalizedRequest &&
    typeof activeBookingAttempt.normalizedRequest === "object" &&
    !Array.isArray(activeBookingAttempt.normalizedRequest)
      ? (activeBookingAttempt.normalizedRequest as Record<string, unknown>)
      : {};

  normalized.customerName ??=
    asTrimmedString(activeBookingAttempt?.customerName ?? undefined) ??
    readStringAttribute(activeNormalizedRequest, ["customerName"]);
  normalized.customerPhone ??=
    asTrimmedString(activeBookingAttempt?.customerPhone ?? undefined) ??
    readStringAttribute(activeNormalizedRequest, ["customerPhone"]);
  normalized.serviceName ??=
    asTrimmedString(activeBookingAttempt?.requestedService ?? undefined) ??
    readStringAttribute(activeNormalizedRequest, ["serviceName", "suggestedServiceName"]);
  normalized.staffPreference ??=
    asTrimmedString(activeBookingAttempt?.requestedStaff ?? undefined) ??
    readStringAttribute(activeNormalizedRequest, ["staffPreference", "staffName"]);
  normalized.requestedDate ??=
    readStringAttribute(activeNormalizedRequest, [
      "requestedDate",
      "preferredDateTime",
      "requestedDateTimeText",
      "startTimeIso"
    ]) ?? asTrimmedString(activeBookingAttempt?.requestedDateTimeText ?? undefined);
  normalized.requestedTime ??= readStringAttribute(activeNormalizedRequest, ["requestedTime"]);

  const transcript =
    callSession && normalized.transcriptText
      ? await createTranscriptForSession(callSession.id, {
          transcriptSource: "amazon_connect_lex",
          transcriptText: normalized.transcriptText
        })
      : null;

  const transcriptDateTime =
    normalized.transcriptText && (!normalized.requestedDate || !normalized.requestedTime)
      ? parseDateTimeText(normalized.transcriptText, salon.timezone)
      : null;
  if (transcriptDateTime?.local.isValid && !transcriptDateTime.ambiguousTime) {
    normalized.requestedDate ??= transcriptDateTime.local.toFormat("yyyy-MM-dd");
    normalized.requestedTime ??= transcriptDateTime.local.toFormat("HH:mm");
  }

  if (!normalized.serviceName && normalized.transcriptText) {
    const serviceMention = await findServiceMentionInText(salon.id, normalized.transcriptText);
    if (serviceMention) {
      normalized.serviceName = serviceMention.service.name;
    }
  }

  if (!normalized.staffPreference && normalized.transcriptText) {
    normalized.staffPreference = await findStaffMentionInText(salon.id, normalized.transcriptText);
  }

  const selectedAlternative = selectAlternativeSlotFromText({
    alternatives: parseAlternativeSlotsAttribute(normalized.attributes),
    transcriptText: normalized.transcriptText,
    staffPreference: normalized.staffPreference,
    timezone: salon.timezone
  });
  if (selectedAlternative) {
    const selectedLocalStart = DateTime.fromISO(selectedAlternative.startTime, { zone: "utc" }).setZone(
      salon.timezone
    );
    normalized.requestedDate = selectedLocalStart.toFormat("yyyy-MM-dd");
    normalized.requestedTime = selectedLocalStart.toFormat("HH:mm");
    normalized.staffPreference = selectedAlternative.staffName;
  }

  let staffResolution = await resolveStaffCandidates({
    salonId: salon.id,
    requestedStaffName: normalized.staffPreference
  });
  if (staffResolution.status === "matched") {
    normalized.staffPreference = staffResolution.matchedStaff.fullName;
  } else if (staffResolution.status !== "ambiguous") {
    normalized.staffPreference = undefined;
  }

  const createAttempt = async (inputForAttempt: {
    status: BookingAttemptStatus;
    appointmentId?: string;
    requestedStartTime?: Date;
    normalizedRequest?: unknown;
    alternativeSlots?: SuggestedSlot[];
    failureReason?: string;
  }) => {
    const data = {
      salonId: salon.id,
      callSessionId: callSession?.id,
      transcriptId: transcript?.id,
      appointmentId: inputForAttempt.appointmentId,
      status: inputForAttempt.status,
      source: normalized.source,
      customerName: normalized.customerName,
      customerPhone: normalizePhoneForMatching(normalized.customerPhone),
      requestedService: normalized.serviceName,
      requestedStaff: normalized.staffPreference,
      requestedDateTimeText:
        inputForAttempt.requestedStartTime?.toISOString() ?? normalized.requestedDate,
      normalizedRequest: toJson({
        salonId: salon.id,
        salonResolutionSource: resolutionSource,
        customerName: normalized.customerName,
        customerPhone: normalized.customerPhone,
        serviceName: normalized.serviceName,
        requestedDate: normalized.requestedDate,
        requestedTime: normalized.requestedTime,
        staffPreference: normalized.staffPreference,
        ...((inputForAttempt.normalizedRequest as Record<string, unknown> | undefined) ?? {})
      }),
      alternativeSlots:
        inputForAttempt.alternativeSlots === undefined
          ? undefined
          : toJson(inputForAttempt.alternativeSlots),
      failureReason: inputForAttempt.failureReason ?? null,
      rawInput: toJson({
        ...input,
        normalizedProvider: normalized.provider
      }),
      createdByUserId: actorUserId
    };

    if (activeBookingAttempt) {
      const updated = await prisma.bookingAttempt.update({
        where: {
          id: activeBookingAttempt.id
        },
        data
      });
      activeBookingAttempt =
        updated.status === BookingAttemptStatus.NEEDS_INPUT ? updated : null;
      return updated;
    }

    const created = await prisma.bookingAttempt.create({
      data
    });
    activeBookingAttempt =
      created.status === BookingAttemptStatus.NEEDS_INPUT ? created : null;
    return created;
  };

  const finalizeCall = async (inputForCall: {
    outcome: AmazonConnectAIAppointmentOutcome;
    bookingAttemptId: string;
    bookingStatus: BookingAttemptStatus;
    parsed: BookingIntentResult;
    message: string;
    appointmentId?: string | null;
    alternatives?: SuggestedSlot[];
    escalation?: Awaited<ReturnType<typeof createOrUpdateCallEscalation>> | null;
    routingOutcome?: CallRoutingOutcome;
    failureReason?: string;
  }) => {
    if (!callSession) {
      return;
    }

    await markBookingAttemptResultOnCall(callSession.id, inputForCall.bookingStatus, {
      bookingAttemptId: inputForCall.bookingAttemptId,
      appointmentId: inputForCall.appointmentId ?? undefined,
      failureReason: inputForCall.failureReason
    });
    await updateCallAIState(callSession.id, {
      aiSummary: buildStructuredCallSummary({
        transcriptId: transcript?.id,
        parsed: inputForCall.parsed,
        bookingAttemptId: inputForCall.bookingAttemptId,
        bookingStatus: inputForCall.bookingStatus,
        appointmentId: inputForCall.appointmentId,
        alternatives: inputForCall.alternatives,
        escalation: inputForCall.escalation,
        resolution: inputForCall.message
      }),
      routingOutcome: inputForCall.routingOutcome ?? CallRoutingOutcome.AI_RECEPTION,
      finalResolution: inputForCall.message,
      language: "en"
    });
  };

  const createInteraction = async (inputForInteraction: {
    outcome: AmazonConnectAIAppointmentOutcome;
    message: string;
    parsed: BookingIntentResult;
    bookingAttemptId: string;
    responsePayload: unknown;
    isValid: boolean;
  }) => {
    return createAIInteractionLog({
      salonId: salon.id,
      actorUserId,
      callSessionId: callSession?.id,
      transcriptId: transcript?.id,
      bookingAttemptId: inputForInteraction.bookingAttemptId,
      provider: ExternalProvider.AMAZON_CONNECT,
      model: env.AMAZON_LEX_BOT_ID ?? "amazon-lex",
      taskType: "amazon_connect_booking_fulfillment",
      requestText: normalized.transcriptText ?? "",
      requestPayload: input,
      responseText: inputForInteraction.message,
      responsePayload: inputForInteraction.responsePayload,
      parsedOutput: {
        outcome: inputForInteraction.outcome,
        parsed: inputForInteraction.parsed
      },
      isValid: inputForInteraction.isValid,
      confidence: 1
    });
  };

  const buildKnownSessionAttributes = (
    extra: Record<string, string | number | null | undefined> = {}
  ): Record<string, string> => {
    return Object.fromEntries(
      Object.entries({
        customerName: normalized.customerName,
        customerPhone: normalized.customerPhone,
        serviceName: normalized.serviceName,
        requestedDate: normalized.requestedDate,
        requestedTime: normalized.requestedTime,
        staffPreference: normalized.staffPreference,
        callSessionId: callSession?.id,
        amazonConnectContactId: normalized.contactId,
        ...extra
      })
        .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
        .map(([key, value]) => [key, String(value)])
    );
  };

  const buildHumanEscalationSessionAttributes = (
    reason: string,
    escalation?: Awaited<ReturnType<typeof createOrUpdateCallEscalation>> | null,
    extra: Record<string, string | number | null | undefined> = {}
  ): Record<string, string> => {
    return buildKnownSessionAttributes({
      forceHumanEscalation: "true",
      transferToQueue: "true",
      escalationReason: reason,
      fallbackMode: escalation?.routingOutcome ?? "operator_queue",
      queueId: escalation?.queueId,
      ...extra
    });
  };

  const requestedDateTimeText = [normalized.requestedDate, normalized.requestedTime]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  if (shouldEscalateToHuman(normalized)) {
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NEEDS_INPUT,
      failureReason: "Caller requested a human operator.",
      normalizedRequest: {
        intentName: normalized.intentName,
        requestedDateTimeText
      }
    });
    const escalation = callSession
      ? await createOrUpdateCallEscalation({
          salonId: salon.id,
          callSessionId: callSession.id,
          requestedBy: "AMAZON_CONNECT_LEX",
          escalationReason: "Caller requested a human operator.",
          customerPhone: normalized.customerPhone ?? null,
          messageToCaller: "Please wait while I connect you.",
          metadata: {
            bookingAttemptId: bookingAttempt.id,
            transcriptId: transcript?.id,
            intentName: normalized.intentName,
            contactId: normalized.contactId
          }
        })
      : null;
    const message = buildLexMessage({ outcome: "HUMAN_ESCALATION" });
    const parsed = buildInternalParsedIntent({
      intentType: "LIVE_PERSON_REQUEST",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: normalized.serviceName,
      staffPreference: normalized.staffPreference,
      requestedDateTime: normalized.requestedDate,
      missingFields: [],
      isReadyToBook: false
    });
    const aiInteraction = await createInteraction({
      outcome: "HUMAN_ESCALATION",
      message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        escalationId: escalation?.id ?? null
      },
      isValid: true
    });
    await finalizeCall({
      outcome: "HUMAN_ESCALATION",
      bookingAttemptId: bookingAttempt.id,
      bookingStatus: bookingAttempt.status,
      parsed,
      message,
      escalation,
      routingOutcome:
        escalation?.routingOutcome === "QUEUED"
          ? CallRoutingOutcome.QUEUED
          : CallRoutingOutcome.CALL_CENTER_ESCALATION,
      failureReason: bookingAttempt.failureReason ?? undefined
    });

    return {
      outcome: "HUMAN_ESCALATION" as const,
      message,
      lexResponse: {
        fulfillmentState: "Fulfilled",
        message,
        messageContentType: "SSML",
        sessionAttributes: buildHumanEscalationSessionAttributes(
          "caller_requested_human",
          escalation
        )
      },
      appointment: null,
      bookingAttempt,
      callSession,
      transcript,
      aiInteraction,
      escalation,
      alternatives: [],
      missingFields: [],
      salonResolutionSource: resolutionSource
    };
  }

  const missingFields = new Set<string>();
  if (!normalized.customerName) {
    missingFields.add("customerName");
  }
  if (!normalized.customerPhone) {
    missingFields.add("customerPhone");
  }
  if (!normalized.serviceName) {
    missingFields.add("serviceName");
  }
  if (
    !normalized.requestedDate ||
    (!normalized.requestedTime && !hasTimeComponent(normalized.requestedDate))
  ) {
    missingFields.add("preferredDateTime");
  }
  let requestedStartTime: Date | null = null;
  if (!missingFields.has("preferredDateTime") && normalized.requestedDate) {
    try {
      const parsedStartTime = parseRequestedStartTimeDetailed({
        requestedDate: normalized.requestedDate,
        requestedTime: normalized.requestedTime,
        timezone: salon.timezone
      });
      requestedStartTime = parsedStartTime.utcDate;
      logger.info(
        {
          originalText: parsedStartTime.originalText,
          interpretedLocalTime: parsedStartTime.localDateTime.toISO(),
          salonTimezone: salon.timezone,
          utcTime: parsedStartTime.utcDate.toISOString()
        },
        "Amazon Connect AI appointment time interpreted."
      );
    } catch (error) {
      if (error instanceof AppError && error.code === "AMBIGUOUS_REQUESTED_TIME") {
        missingFields.add("preferredDateTime");
      } else {
        missingFields.add("preferredDateTime");
      }
    }
  }

  if (missingFields.size > 0 || !requestedStartTime) {
    const elicitDecision = getElicitSlotForMissingFields(missingFields, normalized);
    const staffNames = elicitDecision.promptMissingFields.includes("staffPreference")
      ? (await getStaffCandidates({ salonId: salon.id })).map((member) => member.fullName)
      : [];
    if (elicitDecision.shouldEscalate) {
      const reason = `Missing ${elicitDecision.slotToElicit} after repeated attempts.`;
      const parsed = buildInternalParsedIntent({
        intentType: "BOOK_APPOINTMENT",
        customerName: normalized.customerName,
        customerPhone: normalized.customerPhone,
        serviceName: normalized.serviceName,
        staffPreference: normalized.staffPreference,
        requestedDateTime: normalized.requestedDate,
        missingFields: Array.from(missingFields.values()),
        isReadyToBook: false
      });
      const bookingAttempt = await createAttempt({
        status: BookingAttemptStatus.NEEDS_INPUT,
        failureReason: reason,
        normalizedRequest: {
          requestedDateTimeText,
          lastAskedSlot: elicitDecision.slotToElicit,
          askedSlotsCount: elicitDecision.attemptCount
        }
      });
      const escalation = callSession
        ? await createOrUpdateCallEscalation({
            salonId: salon.id,
            callSessionId: callSession.id,
            requestedBy: "AMAZON_CONNECT_LEX",
            escalationReason: reason,
            customerPhone: normalized.customerPhone ?? null,
            messageToCaller: "Please hold while I connect you with our team.",
            metadata: {
              bookingAttemptId: bookingAttempt.id,
              transcriptId: transcript?.id,
              intentName: normalized.intentName,
              contactId: normalized.contactId,
              lastAskedSlot: elicitDecision.slotToElicit,
              askedSlotsCount: elicitDecision.attemptCount
            }
          })
        : null;
      const message = buildLexMessage({
        outcome: "HUMAN_ESCALATION",
        knownFields: normalized
      });
      const aiInteraction = await createInteraction({
        outcome: "HUMAN_ESCALATION",
        message,
        parsed,
        bookingAttemptId: bookingAttempt.id,
        responsePayload: {
          escalationId: escalation?.id ?? null,
          reason,
          missingFields: Array.from(missingFields.values())
        },
        isValid: true
      });
      await finalizeCall({
        outcome: "HUMAN_ESCALATION",
        bookingAttemptId: bookingAttempt.id,
        bookingStatus: bookingAttempt.status,
        parsed,
        message,
        escalation,
        routingOutcome:
          escalation?.routingOutcome === "QUEUED"
            ? CallRoutingOutcome.QUEUED
            : CallRoutingOutcome.CALL_CENTER_ESCALATION,
        failureReason: bookingAttempt.failureReason ?? undefined
      });

      return {
        outcome: "HUMAN_ESCALATION" as const,
        message,
        lexResponse: {
          fulfillmentState: "Fulfilled",
          message,
          messageContentType: "SSML",
          sessionAttributes: buildHumanEscalationSessionAttributes(reason, escalation, {
            ...elicitDecision.sessionAttributes
          })
        },
        appointment: null,
        bookingAttempt,
        callSession,
        transcript,
        aiInteraction,
        escalation,
        alternatives: [],
        missingFields: [],
        salonResolutionSource: resolutionSource
      };
    }

    const message = buildLexMessage({
      outcome: "MISSING_INFO",
      missingFields: elicitDecision.promptMissingFields,
      staffNames,
      knownFields: normalized,
      attemptCount: elicitDecision.attemptCount
    });
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: normalized.serviceName,
      staffPreference: normalized.staffPreference,
      requestedDateTime: normalized.requestedDate,
      missingFields: Array.from(missingFields.values()),
      isReadyToBook: false
    });
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NEEDS_INPUT,
      failureReason: `Missing fields: ${Array.from(missingFields.values()).join(", ")}`,
      normalizedRequest: {
        requestedDateTimeText
      }
    });
    const aiInteraction = await createInteraction({
      outcome: "MISSING_INFO",
      message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        missingFields: Array.from(missingFields.values())
      },
      isValid: true
    });
    await finalizeCall({
      outcome: "MISSING_INFO",
      bookingAttemptId: bookingAttempt.id,
      bookingStatus: bookingAttempt.status,
      parsed,
      message,
      failureReason: bookingAttempt.failureReason ?? undefined
    });

    return {
      outcome: "MISSING_INFO" as const,
      message,
      lexResponse: {
        fulfillmentState: "InProgress",
        message,
        messageContentType: "SSML",
        dialogAction: {
          type: "ElicitSlot",
          slotToElicit: elicitDecision.slotToElicit
        },
        sessionAttributes: buildKnownSessionAttributes(elicitDecision.sessionAttributes)
      },
      appointment: null,
      bookingAttempt,
      callSession,
      transcript,
      aiInteraction,
      escalation: null,
      alternatives: [],
      missingFields: Array.from(missingFields.values()),
      salonResolutionSource: resolutionSource
    };
  }

  const serviceMatch = await resolveServiceMatch(salon.id, normalized.serviceName!);
  if (serviceMatch && !serviceMatch.exact && !isAffirmative(normalized.serviceName)) {
    const attempts = parseAttemptCount(
      readStringAttribute(normalized.attributes, ["serviceClarificationAttempts"])
    );
    const services = await prisma.service.findMany({
      where: {
        salonId: salon.id,
        isActive: true
      },
      select: { name: true },
      orderBy: { createdAt: "asc" }
    });
    const message = buildServiceClarificationMessage({
      heardServiceName: normalized.serviceName!,
      suggestedServiceName: serviceMatch.service.name,
      availableServiceNames: services.map((service) => service.name),
      attempts
    });
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: normalized.serviceName,
      staffPreference: normalized.staffPreference,
      requestedDateTime: requestedStartTime.toISOString(),
      missingFields: [],
      isReadyToBook: false
    });
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NEEDS_INPUT,
      requestedStartTime,
      failureReason: "Service confirmation required.",
      normalizedRequest: {
        serviceName: normalized.serviceName,
        suggestedServiceName: serviceMatch.service.name,
        serviceMatchConfidence: serviceMatch.confidence,
        serviceMatchStrategy: serviceMatch.matchedBy,
        startTimeIso: requestedStartTime.toISOString(),
        timezone: salon.timezone
      }
    });
    if (attempts >= 2) {
      const reason = "Service confirmation failed after repeated attempts.";
      const escalation = callSession
        ? await createOrUpdateCallEscalation({
            salonId: salon.id,
            callSessionId: callSession.id,
            requestedBy: "AMAZON_CONNECT_LEX",
            escalationReason: reason,
            customerPhone: normalized.customerPhone ?? null,
            messageToCaller: "Please hold while I connect you with our team.",
            metadata: {
              bookingAttemptId: bookingAttempt.id,
              transcriptId: transcript?.id,
              intentName: normalized.intentName,
              contactId: normalized.contactId,
              heardServiceName: normalized.serviceName,
              suggestedServiceName: serviceMatch.service.name
            }
          })
        : null;
      const aiInteraction = await createInteraction({
        outcome: "HUMAN_ESCALATION",
        message,
        parsed,
        bookingAttemptId: bookingAttempt.id,
        responsePayload: {
          escalationId: escalation?.id ?? null,
          reason,
          suggestedServiceName: serviceMatch.service.name,
          serviceMatchConfidence: serviceMatch.confidence
        },
        isValid: true
      });
      await finalizeCall({
        outcome: "HUMAN_ESCALATION",
        bookingAttemptId: bookingAttempt.id,
        bookingStatus: bookingAttempt.status,
        parsed,
        message,
        escalation,
        routingOutcome:
          escalation?.routingOutcome === "QUEUED"
            ? CallRoutingOutcome.QUEUED
            : CallRoutingOutcome.CALL_CENTER_ESCALATION,
        failureReason: bookingAttempt.failureReason ?? undefined
      });

      return {
        outcome: "HUMAN_ESCALATION" as const,
        message,
        lexResponse: {
          fulfillmentState: "Fulfilled",
          message,
          messageContentType: "SSML",
          sessionAttributes: buildHumanEscalationSessionAttributes(reason, escalation, {
            serviceClarificationAttempts: String(attempts + 1),
            lastAskedSlot: "serviceName",
            askedSlotsCount: String(attempts + 1),
            fallbackCount: String(attempts + 1),
            errorCount: String(attempts + 1)
          })
        },
        appointment: null,
        bookingAttempt,
        callSession,
        transcript,
        aiInteraction,
        escalation,
        alternatives: [],
        missingFields: [],
        salonResolutionSource: resolutionSource
      };
    }
    const aiInteraction = await createInteraction({
      outcome: "MISSING_INFO",
      message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        reason: bookingAttempt.failureReason,
        suggestedServiceName: serviceMatch.service.name,
        serviceMatchConfidence: serviceMatch.confidence
      },
      isValid: true
    });
    await finalizeCall({
      outcome: "MISSING_INFO",
      bookingAttemptId: bookingAttempt.id,
      bookingStatus: bookingAttempt.status,
      parsed,
      message,
      failureReason: bookingAttempt.failureReason ?? undefined
    });

    return {
      outcome: "MISSING_INFO" as const,
      message,
      lexResponse: {
        fulfillmentState: "InProgress",
        message,
        messageContentType: "SSML",
        dialogAction: {
          type: "ElicitSlot",
          slotToElicit: "serviceName"
        },
        sessionAttributes: buildKnownSessionAttributes({
          serviceSuggestionName: serviceMatch.service.name,
          serviceClarificationAttempts: String(attempts + 1),
          lastAskedSlot: "serviceName",
          askedSlotsCount: String(attempts + 1),
          fallbackCount: String(attempts + 1),
          errorCount: String(attempts + 1)
        })
      },
      appointment: null,
      bookingAttempt,
      callSession,
      transcript,
      aiInteraction,
      escalation: null,
      alternatives: [],
      missingFields: [],
      salonResolutionSource: resolutionSource
    };
  }

  if (!serviceMatch) {
    const attempts = parseAttemptCount(
      readStringAttribute(normalized.attributes, ["serviceClarificationAttempts"])
    );
    const services = await prisma.service.findMany({
      where: {
        salonId: salon.id,
        isActive: true
      },
      select: { name: true },
      orderBy: { createdAt: "asc" }
    });
    const message = buildServiceClarificationMessage({
      heardServiceName: normalized.serviceName!,
      availableServiceNames: services.map((service) => service.name),
      attempts
    });
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: normalized.serviceName,
      staffPreference: normalized.staffPreference,
      requestedDateTime: requestedStartTime.toISOString(),
      missingFields: ["serviceName"],
      isReadyToBook: false
    });
    const bookingAttempt = await createAttempt({
      status: attempts >= 2 ? BookingAttemptStatus.FAILED : BookingAttemptStatus.NEEDS_INPUT,
      requestedStartTime,
      failureReason:
        attempts >= 2 ? "Service not found after repeated attempts." : "Service not found or inactive.",
      normalizedRequest: {
        serviceName: normalized.serviceName,
        availableServiceNames: services.map((service) => service.name),
        startTimeIso: requestedStartTime.toISOString(),
        timezone: salon.timezone
      }
    });
    if (attempts >= 2) {
      const reason = "Service not found after repeated attempts.";
      const escalation = callSession
        ? await createOrUpdateCallEscalation({
            salonId: salon.id,
            callSessionId: callSession.id,
            requestedBy: "AMAZON_CONNECT_LEX",
            escalationReason: reason,
            customerPhone: normalized.customerPhone ?? null,
            messageToCaller: "Please hold while I connect you with our team.",
            metadata: {
              bookingAttemptId: bookingAttempt.id,
              transcriptId: transcript?.id,
              intentName: normalized.intentName,
              contactId: normalized.contactId,
              heardServiceName: normalized.serviceName,
              availableServiceNames: services.map((service) => service.name)
            }
          })
        : null;
      const aiInteraction = await createInteraction({
        outcome: "HUMAN_ESCALATION",
        message,
        parsed,
        bookingAttemptId: bookingAttempt.id,
        responsePayload: {
          escalationId: escalation?.id ?? null,
          reason,
          availableServiceNames: services.map((service) => service.name)
        },
        isValid: true
      });
      await finalizeCall({
        outcome: "HUMAN_ESCALATION",
        bookingAttemptId: bookingAttempt.id,
        bookingStatus: bookingAttempt.status,
        parsed,
        message,
        escalation,
        routingOutcome:
          escalation?.routingOutcome === "QUEUED"
            ? CallRoutingOutcome.QUEUED
            : CallRoutingOutcome.CALL_CENTER_ESCALATION,
        failureReason: bookingAttempt.failureReason ?? undefined
      });

      return {
        outcome: "HUMAN_ESCALATION" as const,
        message,
        lexResponse: {
          fulfillmentState: "Fulfilled",
          message,
          messageContentType: "SSML",
          sessionAttributes: buildHumanEscalationSessionAttributes(reason, escalation, {
            serviceClarificationAttempts: String(attempts + 1),
            lastAskedSlot: "serviceName",
            askedSlotsCount: String(attempts + 1),
            fallbackCount: String(attempts + 1),
            errorCount: String(attempts + 1)
          })
        },
        appointment: null,
        bookingAttempt,
        callSession,
        transcript,
        aiInteraction,
        escalation,
        alternatives: [],
        missingFields: [],
        salonResolutionSource: resolutionSource
      };
    }
    const aiInteraction = await createInteraction({
      outcome: "MISSING_INFO",
      message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        reason: bookingAttempt.failureReason,
        availableServiceNames: services.map((service) => service.name)
      },
      isValid: true
    });
    await finalizeCall({
      outcome: "MISSING_INFO",
      bookingAttemptId: bookingAttempt.id,
      bookingStatus: bookingAttempt.status,
      parsed,
      message,
      failureReason: bookingAttempt.failureReason ?? undefined
    });

    return {
      outcome: "MISSING_INFO" as const,
      message,
      lexResponse: {
        fulfillmentState: "InProgress",
        message,
        messageContentType: "SSML",
        dialogAction: {
          type: "ElicitSlot",
          slotToElicit: "serviceName"
        },
        sessionAttributes: buildKnownSessionAttributes({
          serviceClarificationAttempts: String(attempts + 1),
          lastAskedSlot: "serviceName",
          askedSlotsCount: String(attempts + 1),
          fallbackCount: String(attempts + 1),
          errorCount: String(attempts + 1)
        })
      },
      appointment: null,
      bookingAttempt,
      callSession,
      transcript,
      aiInteraction,
      escalation: null,
      alternatives: [],
      missingFields: ["serviceName"],
      salonResolutionSource: resolutionSource
    };
  }

  const service = serviceMatch.service;
  normalized.serviceName = service.name;

  staffResolution =
    staffResolution.rawStaffPreference === normalized.staffPreference
      ? staffResolution
      : await resolveStaffCandidates({
          salonId: salon.id,
          requestedStaffName: normalized.staffPreference
        });

  if (staffResolution.status === "ambiguous") {
    const message = buildStaffClarificationMessage({
      availableStaffNames: staffResolution.allStaff.map((member) => member.fullName)
    });
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: service.name,
      staffPreference: staffResolution.rawStaffPreference,
      requestedDateTime: requestedStartTime.toISOString(),
      missingFields: ["staffPreference"],
      isReadyToBook: false
    });
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NEEDS_INPUT,
      requestedStartTime,
      failureReason: "Staff preference matched multiple active bookable staff.",
      normalizedRequest: {
        serviceId: service.id,
        serviceName: service.name,
        staffPreference: staffResolution.rawStaffPreference,
        ambiguousStaffNames: staffResolution.ambiguousStaffNames,
        startTimeIso: requestedStartTime.toISOString(),
        timezone: salon.timezone
      }
    });
    const aiInteraction = await createInteraction({
      outcome: "MISSING_INFO",
      message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        missingFields: ["staffPreference"],
        ambiguousStaffNames: staffResolution.ambiguousStaffNames
      },
      isValid: true
    });
    await finalizeCall({
      outcome: "MISSING_INFO",
      bookingAttemptId: bookingAttempt.id,
      bookingStatus: bookingAttempt.status,
      parsed,
      message,
      failureReason: bookingAttempt.failureReason ?? undefined
    });

    return {
      outcome: "MISSING_INFO" as const,
      message,
      lexResponse: {
        fulfillmentState: "InProgress",
        message,
        messageContentType: "SSML",
        dialogAction: {
          type: "ElicitSlot",
          slotToElicit: "staffPreference"
        },
        sessionAttributes: buildKnownSessionAttributes({
          lastAskedSlot: "staffPreference",
          askedSlotsCount: "1",
          fallbackCount: "1",
          errorCount: "1"
        })
      },
      appointment: null,
      bookingAttempt,
      callSession,
      transcript,
      aiInteraction,
      escalation: null,
      alternatives: [],
      missingFields: ["staffPreference"],
      salonResolutionSource: resolutionSource
    };
  }

  if (staffResolution.status === "matched") {
    normalized.staffPreference = staffResolution.matchedStaff.fullName;
  }

  const preferredStaffCandidates = staffResolution.candidates;
  const allStaffCandidates = staffResolution.allStaff;

  let chosenStaff: { id: string; fullName: string } | null = null;
  const rejectedReasons: string[] = [];
  for (const staff of preferredStaffCandidates) {
    try {
      const slotValidation = await validateAppointmentSlot({
        salonId: salon.id,
        staffId: staff.id,
        serviceIds: [service.id],
        startTime: requestedStartTime
      });
      if (slotValidation.valid) {
        chosenStaff = staff;
        break;
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

  if (!chosenStaff) {
    const requestedSpecificStaff = Boolean(
      normalized.staffPreference && !isAnyStaffPreference(normalized.staffPreference)
    );
    const alternatives =
      requestedSpecificStaff && preferredStaffCandidates[0]
        ? await getRequestedStaffBusyAlternatives({
            salonId: salon.id,
            serviceId: service.id,
            requestedStaff: preferredStaffCandidates[0],
            allStaffCandidates,
            timezone: salon.timezone,
            preferredStartTime: requestedStartTime
          })
        : await getSuggestedSlotsForService({
            salonId: salon.id,
            serviceId: service.id,
            staffCandidates: allStaffCandidates,
            timezone: salon.timezone,
            preferredStartTime: requestedStartTime,
            daysAhead: 7,
            maxSlots: 2
          });
    const requestedStaffDisplayName = normalized.staffPreference
      ? preferredStaffCandidates[0]?.fullName ?? normalized.staffPreference
      : undefined;
    const message = buildLexMessage({
      outcome: "NO_AVAILABILITY",
      alternatives,
      salonTimezone: salon.timezone,
      appointmentStartTime: requestedStartTime,
      requestedStaffName: requestedStaffDisplayName
    });
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: normalized.serviceName,
      staffPreference: normalized.staffPreference,
      requestedDateTime: requestedStartTime.toISOString(),
      missingFields: [],
      isReadyToBook: false
    });
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NO_AVAILABILITY,
      requestedStartTime,
      alternativeSlots: alternatives,
      failureReason:
        Array.from(new Set(rejectedReasons)).slice(0, 3).join("; ") ||
        "No available slot for the requested time.",
      normalizedRequest: {
        serviceId: service.id,
        serviceName: normalized.serviceName,
        staffPreference: normalized.staffPreference,
        startTimeIso: requestedStartTime.toISOString(),
        timezone: salon.timezone
      }
    });
    const aiInteraction = await createInteraction({
      outcome: "NO_AVAILABILITY",
      message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        alternatives
      },
      isValid: true
    });
    await finalizeCall({
      outcome: "NO_AVAILABILITY",
      bookingAttemptId: bookingAttempt.id,
      bookingStatus: bookingAttempt.status,
      parsed,
      message,
      alternatives,
      failureReason: bookingAttempt.failureReason ?? undefined
    });

    return {
      outcome: "NO_AVAILABILITY" as const,
      message,
      lexResponse: {
        fulfillmentState: "InProgress",
        message,
        messageContentType: "SSML",
        dialogAction: {
          type: "ElicitSlot",
          slotToElicit: "requestedTime"
        },
        sessionAttributes: buildKnownSessionAttributes({
          aiAlternativeSlots: JSON.stringify(alternatives.slice(0, 2)),
          awaitingAlternativeSelection: "true",
          lastAskedSlot: "requestedTime",
          askedSlotsCount: "1",
          fallbackCount: "1",
          errorCount: "1"
        })
      },
      appointment: null,
      bookingAttempt,
      callSession,
      transcript,
      aiInteraction,
      escalation: null,
      alternatives,
      missingFields: [],
      salonResolutionSource: resolutionSource
    };
  }

  if (isConfirmationDenied(normalized.confirmationState)) {
    const message = speak("No problem. <break time=\"300ms\"/> Which detail would you like to change?");
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: service.name,
      staffPreference: chosenStaff.fullName,
      requestedDateTime: requestedStartTime.toISOString(),
      missingFields: [],
      isReadyToBook: false
    });
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NEEDS_INPUT,
      requestedStartTime,
      failureReason: "Caller rejected booking confirmation.",
      normalizedRequest: {
        serviceId: service.id,
        staffId: chosenStaff.id,
        serviceName: service.name,
        staffName: chosenStaff.fullName,
        startTimeIso: requestedStartTime.toISOString(),
        timezone: salon.timezone
      }
    });
    const aiInteraction = await createInteraction({
      outcome: "MISSING_INFO",
      message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        reason: bookingAttempt.failureReason
      },
      isValid: true
    });
    await finalizeCall({
      outcome: "MISSING_INFO",
      bookingAttemptId: bookingAttempt.id,
      bookingStatus: bookingAttempt.status,
      parsed,
      message,
      failureReason: bookingAttempt.failureReason ?? undefined
    });

    return {
      outcome: "MISSING_INFO" as const,
      message,
      lexResponse: {
        fulfillmentState: "InProgress",
        message,
        messageContentType: "SSML",
        dialogAction: {
          type: "ElicitIntent"
        },
        sessionAttributes: buildKnownSessionAttributes()
      },
      appointment: null,
      bookingAttempt,
      callSession,
      transcript,
      aiInteraction,
      escalation: null,
      alternatives: [],
      missingFields: [],
      salonResolutionSource: resolutionSource
    };
  }

  if (!isConfirmationAccepted(normalized.confirmationState)) {
    const message = buildBookingConfirmationMessage({
      serviceName: service.name,
      appointmentStartTime: requestedStartTime,
      salonTimezone: salon.timezone,
      staffName: chosenStaff.fullName,
      customerName: normalized.customerName!,
      customerPhone: normalized.customerPhone
    });
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: service.name,
      staffPreference: chosenStaff.fullName,
      requestedDateTime: requestedStartTime.toISOString(),
      missingFields: [],
      isReadyToBook: false
    });
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NEEDS_INPUT,
      requestedStartTime,
      failureReason: "Booking confirmation required before creating appointment.",
      normalizedRequest: {
        serviceId: service.id,
        staffId: chosenStaff.id,
        serviceName: service.name,
        staffName: chosenStaff.fullName,
        startTimeIso: requestedStartTime.toISOString(),
        timezone: salon.timezone
      }
    });
    const aiInteraction = await createInteraction({
      outcome: "MISSING_INFO",
      message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        reason: bookingAttempt.failureReason
      },
      isValid: true
    });
    await finalizeCall({
      outcome: "MISSING_INFO",
      bookingAttemptId: bookingAttempt.id,
      bookingStatus: bookingAttempt.status,
      parsed,
      message,
      failureReason: bookingAttempt.failureReason ?? undefined
    });

    return {
      outcome: "MISSING_INFO" as const,
      message,
      lexResponse: {
        fulfillmentState: "InProgress",
        message,
        messageContentType: "SSML",
        dialogAction: {
          type: "ConfirmIntent"
        },
        sessionAttributes: buildKnownSessionAttributes()
      },
      appointment: null,
      bookingAttempt,
      callSession,
      transcript,
      aiInteraction,
      escalation: null,
      alternatives: [],
      missingFields: [],
      salonResolutionSource: resolutionSource
    };
  }

  const customer = await resolveCustomer({
    salonId: salon.id,
    actorUserId,
    customerName: normalized.customerName,
    customerPhone: normalized.customerPhone,
    createCustomerIfMissing: true
  });
  if (!customer) {
    const message = buildLexMessage({
      outcome: "MISSING_INFO",
      missingFields: ["customerName", "customerPhone"]
    });
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: normalized.serviceName,
      staffPreference: normalized.staffPreference,
      requestedDateTime: requestedStartTime.toISOString(),
      missingFields: ["customerName", "customerPhone"],
      isReadyToBook: false
    });
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NEEDS_INPUT,
      requestedStartTime,
      failureReason: "Customer name and a valid phone are required.",
      normalizedRequest: {
        serviceId: service.id,
        staffId: chosenStaff.id,
        startTimeIso: requestedStartTime.toISOString(),
        timezone: salon.timezone
      }
    });
    const aiInteraction = await createInteraction({
      outcome: "MISSING_INFO",
      message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        missingFields: ["customerName", "customerPhone"]
      },
      isValid: true
    });
    await finalizeCall({
      outcome: "MISSING_INFO",
      bookingAttemptId: bookingAttempt.id,
      bookingStatus: bookingAttempt.status,
      parsed,
      message,
      failureReason: bookingAttempt.failureReason ?? undefined
    });

    return {
      outcome: "MISSING_INFO" as const,
      message,
      lexResponse: {
        fulfillmentState: "Failed",
        message,
        messageContentType: "SSML",
        sessionAttributes: buildKnownSessionAttributes()
      },
      appointment: null,
      bookingAttempt,
      callSession,
      transcript,
      aiInteraction,
      escalation: null,
      alternatives: [],
      missingFields: ["customerName", "customerPhone"],
      salonResolutionSource: resolutionSource
    };
  }

  const appointment = await createAppointmentFromAI(salon.id, actorUserId, {
    customerId: customer.id,
    staffId: chosenStaff.id,
    serviceId: service.id,
    startTime: requestedStartTime,
    notes: [
      "Created by Amazon Connect AI Booking.",
      normalized.source ? `Source: ${normalized.source}` : null,
      normalized.contactId ? `Amazon Connect contact: ${normalized.contactId}` : null
    ]
      .filter((value): value is string => Boolean(value))
      .join("\n")
  });

  const bookingAttempt = await createAttempt({
    status: BookingAttemptStatus.SUCCESS,
    appointmentId: appointment.id,
    requestedStartTime,
    normalizedRequest: {
      serviceId: service.id,
      staffId: chosenStaff.id,
      customerId: customer.id,
      startTimeIso: requestedStartTime.toISOString(),
      timezone: salon.timezone
    }
  });
  const message = buildLexMessage({
    outcome: "BOOKED",
    appointmentStartTime: requestedStartTime,
    salonTimezone: salon.timezone,
    serviceName: service.name,
    staffName: chosenStaff.fullName
  });
  const parsed = buildInternalParsedIntent({
    intentType: "BOOK_APPOINTMENT",
    customerName: normalized.customerName,
    customerPhone: normalized.customerPhone,
    serviceName: service.name,
    staffPreference: chosenStaff.fullName,
    requestedDateTime: requestedStartTime.toISOString(),
    missingFields: [],
    isReadyToBook: true
  });
  const aiInteraction = await createInteraction({
    outcome: "BOOKED",
    message,
    parsed,
    bookingAttemptId: bookingAttempt.id,
    responsePayload: {
      appointmentId: appointment.id
    },
    isValid: true
  });

  await finalizeCall({
    outcome: "BOOKED",
    bookingAttemptId: bookingAttempt.id,
    bookingStatus: bookingAttempt.status,
    parsed,
    message,
    appointmentId: appointment.id
  });

  return {
    outcome: "BOOKED" as const,
    message,
    lexResponse: {
      fulfillmentState: "Fulfilled",
      message,
      messageContentType: "SSML",
      sessionAttributes: buildKnownSessionAttributes({
        bookingOutcome: "BOOKED"
      })
    },
    appointment,
    bookingAttempt,
    callSession,
    transcript,
    aiInteraction,
    escalation: null,
    alternatives: [],
    missingFields: [],
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

  const [salon, staffResolutionForText] = await Promise.all([
    prisma.salon.findUnique({
      where: { id: input.salonId },
      select: { timezone: true }
    }),
    resolveStaffCandidates({
      salonId: input.salonId,
      requestedStaffName: normalized.staffName
    })
  ]);

  if (!salon) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }

  if (staffResolutionForText.status === "ambiguous") {
    const updated = await prisma.bookingAttempt.update({
      where: { id: bookingAttempt.id },
      data: {
        status: BookingAttemptStatus.NEEDS_INPUT,
        failureReason: "Staff preference matched multiple active bookable staff."
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
          resolution: updated.failureReason ?? "Staff preference needs clarification."
        }),
        routingOutcome: CallRoutingOutcome.AI_RECEPTION,
        finalResolution: updated.failureReason ?? "Staff preference needs clarification.",
        language: "en"
      });
    }
    return {
      bookingAttempt: updated,
      parsed: parsed.parsedIntent,
      appointment: null,
      alternatives: [],
      escalation: null
    };
  }

  const staffCandidates = staffResolutionForText.candidates;

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
