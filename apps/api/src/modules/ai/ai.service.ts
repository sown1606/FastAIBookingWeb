import { createHash } from "crypto";
import { DateTime } from "luxon";
import {
  AppointmentStatus,
  BookingAttemptStatus,
  CallEscalationStatus,
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
import { formatCustomerName } from "../../utils/customer-name";
import { normalizeCustomerPhone } from "../../utils/phone";
import {
  createAppointmentFromAI,
  getAppointmentDetail,
  rescheduleAppointment
} from "../appointments/appointments.service";
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
  currentTurnTranscript?: string;
  aggregatedBookingTranscript?: string;
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
  staffId?: string;
  selectedStaffId?: string;
  bookingConfirmation?: string;
  confirmationState?: string;
  inputMode?: string;
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
  | "RESCHEDULED"
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

type StaffIntentParseResult = {
  selectionMode: "SPECIFIC" | "ANY" | "CHANGE" | "UNKNOWN";
  requestedStaff?: StaffCandidate;
  excludedStaff: StaffCandidate[];
  hasExplicitExclusion: boolean;
};

type ServiceMenuCandidate = {
  id?: string;
  name: string;
};

type CustomerCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
};

type UpcomingAppointmentCandidate = {
  id: string;
  startTime: Date;
  service: {
    name: string;
  };
  staff: {
    fullName: string;
  };
};

type StaffPreferenceResolution =
  | {
      status: "missing" | "explicit_any" | "invalid_noise" | "unmatched_specific";
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
  tree: 3,
  tri: 3,
  four: 4,
  five: 5,
  fife: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12
};

const DIGIT_SPEECH_LABELS: Record<string, string> = {
  "0": "zero",
  "1": "one",
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine"
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
const WEEKDAY_LABELS: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday"
};

const SERVICE_ALIASES: Record<string, string[]> = {
  pedicure: [
    "pedicure",
    "bedicure",
    "beticure",
    "pedi cure",
    "peddy cure",
    "pay di cure",
    "pay the cure",
    "paydy cure",
    "petty cure",
    "pretty cure",
    "ready cure",
    "reddy cure",
    "betty cure",
    "berry cure",
    "better cure",
    "bettercure",
    "eddie here",
    "pedic care",
    "pedi care",
    "pedicure appointment",
    "toe service",
    "foot service",
    "foot pedicure",
    "toe pedicure",
    "p t q",
    "ptq",
    "picu",
    "edicque",
    "edicure"
  ],
  manicure: [
    "many cure",
    "manny cure",
    "mani cure",
    "nanny cure",
    "mini cure",
    "mini q",
    "manicure",
    "manicure appointment",
    "hand service",
    "finger nail service"
  ],
  "gel manicure": [
    "gel many cure",
    "gel manny cure",
    "gel mani cure",
    "gel manicure",
    "jell manicure",
    "jail manicure",
    "gel nail",
    "gel nails",
    "gel hand service"
  ],
  "full set": [
    "full set",
    "fullset",
    "full-set",
    "full sets",
    "full nail set",
    "nail full set",
    "full nail",
    "nail set",
    "new set",
    "complete set",
    "false set",
    "fall set",
    "four set",
    "fool set",
    "foot set",
    "boom set",
    "book a set",
    "want a set",
    "a nail set",
    "full step",
    "full said",
    "fullsat",
    "full sit",
    "full sat",
    "full sell",
    "full sad",
    "full cet",
    "full send",
    "fuel set",
    "bloomtet",
    "bloom tet",
    "fake nails",
    "extension nails",
    "nail extensions",
    "set of nails",
    "full set appointment"
  ],
  "dip powder": [
    "dip",
    "deep powder",
    "dip power",
    "dip powder",
    "dipping powder",
    "de powder",
    "dep powder",
    "powder dip",
    "dip nails"
  ],
  "other services": [
    "other services",
    "other service",
    "others services",
    "something else",
    "different service",
    "custom service"
  ]
};

const WEEKDAY_WORD_PATTERN = "sunday|monday|tuesday|wednesday|thursday|friday|saturday";
const DATE_PHRASE_PATTERN =
  `\\b(?:tomorrow\\s+(?:morning|afternoon|evening|night)|this\\s+(?:morning|afternoon|evening)|tonight|today|tomorrow|(?:this|next)\\s+(?:${WEEKDAY_WORD_PATTERN})|next[-\\s]?week\\s+(?:${WEEKDAY_WORD_PATTERN})|nextweek\\s+(?:${WEEKDAY_WORD_PATTERN})|(?:the\\s+)?(?:${WEEKDAY_WORD_PATTERN})\\s+next\\s+week|(?:${WEEKDAY_WORD_PATTERN}))\\b`;

const SPOKEN_HOUR_PATTERN =
  "one|two|three|tree|tri|four|five|fife|six|seven|eight|nine|ten|eleven|twelve";
const SPOKEN_MINUTE_PATTERN =
  "[0-5]\\d|zero|oh|o|ten|fifteen|twenty(?:\\s+(?:one|two|three|four|five|six|seven|eight|nine))?|thirty(?:\\s+(?:one|two|three|four|five|six|seven|eight|nine))?|forty(?:\\s+(?:one|two|three|four|five|six|seven|eight|nine))?|fourty(?:\\s+(?:one|two|three|four|five|six|seven|eight|nine))?|fifty(?:\\s+(?:one|two|three|four|five|six|seven|eight|nine))?";
const SPOKEN_MINUTE_BASE: Record<string, number> = {
  zero: 0,
  oh: 0,
  o: 0,
  ten: 10,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50
};

const MONTH_DAY_PATTERN =
  "\\b(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\\.?\\s+(?:\\d{1,2}(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty\\s+first|twenty\\s+second|twenty\\s+third|twenty\\s+fourth|twenty\\s+fifth|twenty\\s+sixth|twenty\\s+seventh|twenty\\s+eighth|twenty\\s+ninth|thirtieth|thirty\\s+first)(?:\\s*,?\\s*\\d{4})?\\b";

const ISO_DATE_PATTERN = "\\b\\d{4}-\\d{2}-\\d{2}\\b";

const MONTH_NUMBERS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12
};

const ORDINAL_DAY_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
  eleventh: 11,
  twelfth: 12,
  thirteenth: 13,
  fourteenth: 14,
  fifteenth: 15,
  sixteenth: 16,
  seventeenth: 17,
  eighteenth: 18,
  nineteenth: 19,
  twentieth: 20,
  "twenty first": 21,
  "twenty second": 22,
  "twenty third": 23,
  "twenty fourth": 24,
  "twenty fifth": 25,
  "twenty sixth": 26,
  "twenty seventh": 27,
  "twenty eighth": 28,
  "twenty ninth": 29,
  thirtieth: 30,
  "thirty first": 31
};

const ANY_STAFF_PHRASES = new Set([
  "anyone",
  "any one",
  "anybody",
  "any body",
  "any available staff",
  "any available",
  "any staff",
  "any staff is fine",
  "any staff is ok",
  "any staff is okay",
  "any stuff is fine",
  "any technician",
  "any tech",
  "no preference",
  "doesn't matter",
  "doesnt matter",
  "no staff preference",
  "no specific staff",
  "first available",
  "the first available",
  "for available",
  "first avaiable",
  "first available one",
  "someone available",
  "anyone is fine",
  "anyone available",
  "whoever is available",
  "whoever s available",
  "whoever's available",
  "who is available"
]);
const CONTEXTUAL_ANY_STAFF_PHRASES = new Set([
  "any stat",
  "and stop",
  "what available",
  "who available",
  "one available",
  "which available",
  "and the staff is fine",
  "and the staff",
  "and staff is fine",
  "and staff",
  "staff is fine",
  "available"
]);

const BOOKING_FRAME_RESET_KEYS = [
  "serviceName",
  "ServiceName",
  "service",
  "Service",
  "confirmedServiceName",
  "serviceId",
  "requestedDate",
  "RequestedDate",
  "preferredDate",
  "PreferredDate",
  "requestedTime",
  "RequestedTime",
  "preferredTime",
  "PreferredTime",
  "staffPreference",
  "StaffPreference",
  "staffId",
  "selectedStaffId",
  "confirmedStaffId",
  "confirmedStaffName",
  "bookingConfirmation",
  "BookingConfirmation",
  "confirmationState",
  "confirmationFingerprint",
  "bookingConfirmationFingerprint",
  "awaitingFinalBookingConfirmation",
  "bookingConfirmationAsked",
  "awaitingRejectedBookingChoice",
  "finalConfirmationChangeRequest",
  "lastAskedSlot",
  "slotToElicit",
  "activeDtmfMenu",
  "activeDtmfOptionsJson",
  "awaitingAlternativeSelection",
  "aiAlternativeSlots",
  "alternativeOfferId",
  "anchorRequestedDate",
  "anchorRequestedTime",
  "anchorRequestedStaff",
  "rejectedOptionKeys",
  "proposedStaffPreference",
  "proposedRequestedDate",
  "proposedRequestedTime",
  "proposedServiceName",
  "staffReplacementPreviousStaff",
  "staffReplacementPreviousStaffId",
  "staffReplacementPreviousSelectedStaffId",
  "staffReplacementPreviousConfirmedStaffId",
  "staffExclusionState",
  "excludedStaffIds",
  "excludedStaffNames",
  "awaitingStaffConfirmation",
  "awaitingServiceConfirmation",
  "awaitingTimeConfirmation",
  "awaitingBookingFrameRepairConfirmation",
  "bookingFrameRepairReason",
  "bookingFrameRepairConfirmed",
  "bookingFrameRepairRejected",
  "serviceClarificationReason",
  "serviceClarificationHeard",
  "serviceSuggestionName",
  "staffClarificationReason",
  "dateClarificationReason",
  "weekdayDateConflict",
  "dateDecisionDiagnostic",
  "businessHoursDecision",
  "availabilityReasonCode",
  "offerAttemptCount",
  "bookingRequestFingerprint",
  "currentTurnSemanticType",
  "voiceSlotDecisions",
  "proposedSlotMutation",
  "acceptedSlotMutations",
  "preventedSlotMutations",
  "asrAlternativesUsed",
  "menuWasSpoken",
  "staffMenuWasSpoken",
  "staffDtmfOptions",
  "staffDtmfStaffIds",
  "staffDtmfPromptText",
  "invalidStaffPreferenceIgnored",
  "unrecognizedStaffUtterance",
  "staffResolutionStatus",
  "staffRecognitionFailureCount",
  "serviceRecognitionFailureCount",
  "serviceClarificationAttempts",
  "serviceFallbackCount",
  "invalidServiceCount",
  "serviceFallbackOffered",
  "scopedServiceDtmfInput",
  "scopedStaffDtmfInput"
];
const FINAL_CONFIRMATION_CLEAR_KEYS = [
  "bookingConfirmation",
  "BookingConfirmation",
  "confirmationState",
  "confirmationFingerprint",
  "bookingConfirmationFingerprint",
  "awaitingFinalBookingConfirmation",
  "bookingConfirmationAsked",
  "finalConfirmationChangeRequest",
  "lastAskedSlot",
  "slotToElicit",
  "activeDtmfMenu",
  "activeDtmfOptionsJson"
];
const OPERATOR_TRANSFER_PROMPT = "Let me check for an available operator.";
const OPERATOR_BUSY_PROMPT = "All of our operators are currently busy. Please call back later. Goodbye.";

const SERVICE_DTMF_OPTIONS: Record<string, string> = {
  "1": "Pedicure",
  "2": "Manicure",
  "3": "Gel Manicure",
  "4": "Full Set",
  "5": "Dip Powder",
  "0": "__operator__"
};
const STAFF_DTMF_OPTIONS: Record<string, string> = {
  "1": "Trang",
  "2": "Amy",
  "3": "Kelly",
  "4": "Any staff"
};
const CUSTOMER_NAME_NOISE = new Set([
  "sorry",
  "ah",
  "uh",
  "um",
  "hi",
  "hello",
  "good",
  "i m good",
  "im good",
  "i am good",
  "it s",
  "its",
  "still here",
  "following",
  "doing well",
  "i m doing well",
  "im doing well",
  "i am doing well",
  "doing well thank you",
  "i m doing well thank you",
  "im doing well thank you",
  "i am doing well thank you",
  "thank you",
  "thanks",
  "yeah",
  "how are you",
  "with",
  "at",
  "on",
  "for",
  "to",
  "by",
  "from",
  "and",
  "the",
  "a",
  "an",
  "please",
  "okay",
  "ok",
  "yes",
  "no",
  "toss",
  "full set",
  "first available",
  "any staff",
  "tomorrow",
  "today",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "am",
  "pm",
  "operator",
  "zero",
  "four",
  "no input",
  "noinput",
  "silence",
  "silent",
  "timeout",
  "timed out"
]);
const CUSTOMER_NAME_SMALL_TALK_PATTERNS = [
  /^(?:i\s*(?:am|'m|m)\s*)?(?:doing\s+well|good|fine|okay|ok)(?:\s+thank\s+you|\s+thanks)?$/,
  /^(?:i\s*(?:am|'m|m)\s*)?(?:still\s+here|here)$/,
  /^(?:it\s+s|its)$/,
  /^(?:thank\s+you|thanks|yes|yeah|yep|okay|ok|hello|hi)$/,
  /^(?:how\s+are\s+you|how\s+you\s+doing|how\s+is\s+it\s+going)$/
];
const SERVICE_DTMF_PROMPT =
  "Hi, I can help book your appointment. Tell me the service, day, time, and staff. You can press 0 for a person.";
const SERVICE_DTMF_OPTIONS_PROMPT =
  "I missed the service. Did you say Pedicure or Manicure?";
const SERVICE_FIRST_RETRY_PROMPT = "Which service would you like to book?";
const STAFF_DTMF_PROMPT =
  "Which staff would you like, Trang, Amy, Kelly, or first available?";
const INVALID_MENU_CHOICE_PROMPT = "Invalid choice. Please select a valid number from the options provided.";

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

const uniqueStrings = (values: unknown[] = []): string[] =>
  Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
    )
  );

const parseSessionAttributeKeysToClear = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return uniqueStrings(value);
  }
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return uniqueStrings(parsed);
    }
  } catch {
    // Fall through to comma-delimited parsing.
  }
  return uniqueStrings(raw.split(","));
};

const getBookingFrameResetKeys = (extraKeys: string[] = []): string[] =>
  uniqueStrings([...BOOKING_FRAME_RESET_KEYS, ...extraKeys]);

const getFinalConfirmationClearKeys = (extraKeys: string[] = []): string[] =>
  uniqueStrings([...FINAL_CONFIRMATION_CLEAR_KEYS, ...extraKeys]);

const applyAttributeClears = <T extends Record<string, unknown>>(attributes: T, keys: string[]): T => {
  for (const key of parseSessionAttributeKeysToClear(keys)) {
    delete attributes[key];
  }
  return attributes;
};

const DEDICATED_FULL_SET_ALIASES = [
  "full set",
  "fullset",
  "full-set"
];

const findDedicatedFullSetAlias = (value?: string | null): string | undefined => {
  const compact = compactForMatch(value);
  if (!compact) {
    return undefined;
  }
  return DEDICATED_FULL_SET_ALIASES.find((alias) => compact.includes(compactForMatch(alias)));
};

const hasUnsafeSunsetWithoutExplicitFullSetAlias = (value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  return Boolean(
    normalized &&
      /\bsun\s*set\b/.test(normalized) &&
      !findDedicatedFullSetAlias(value)
  );
};

const hasFullSetBookingContext = (
  value?: string | null,
  context: { lastAskedSlot?: string; activeDtmfMenu?: string } = {}
): boolean => {
  const normalized = normalizeForMatch(value);
  return Boolean(
    normalized &&
      (context.lastAskedSlot === "serviceName" ||
        context.activeDtmfMenu === "service" ||
        /\b(?:book|booking|schedule|appointment|service|nail|nails|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|with|at|am|pm)\b/.test(
          normalized
        ) ||
        hasGroundedDatePhrase(value) ||
        hasGroundedTimePhrase(value))
  );
};

const recognizeFullSetFromText = (
  value?: string | null,
  context: { lastAskedSlot?: string; activeDtmfMenu?: string } = {}
): "Full Set" | undefined => {
  if (hasUnsafeSunsetWithoutExplicitFullSetAlias(value)) {
    return undefined;
  }
  const alias = findDedicatedFullSetAlias(value);
  if (!alias) {
    return undefined;
  }
  return "Full Set";
};

const INVALID_SERVICE_PLACEHOLDERS = new Set([
  "service",
  "services",
  "a service",
  "the service",
  "some service",
  "any service",
  "nail service",
  "nail services",
  "test service",
  "sample service",
  "unknown service",
  "other service",
  "other services"
]);

const isInvalidServicePlaceholder = (value?: string | null): boolean => {
  return INVALID_SERVICE_PLACEHOLDERS.has(normalizeForMatch(value));
};

const CUSTOMER_NAME_PATTERN = /^\p{L}[\p{L}' -]{0,80}$/u;

const toCustomerNameCase = (value: string): string =>
  value
    .toLocaleLowerCase("en-US")
    .replace(/(^|[\s'-])\p{L}/gu, (match) => match.toLocaleUpperCase("en-US"));

const collapseSpokenNameSpelling = (value?: string | null): string => {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return "";
  }

  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length >= 3 && tokens.every((token) => /^\p{L}$/u.test(token))) {
    return toCustomerNameCase(tokens.join(""));
  }

  return raw.replace(/\s+/g, " ");
};

const getCustomerFacingServiceName = (serviceName?: string | null): string | undefined => {
  const trimmed = serviceName?.trim();
  if (!trimmed) {
    return undefined;
  }
  const compact = compactForMatch(trimmed);
  if (compact === "fullset" || compact.endsWith("fullset")) {
    return "Full Set";
  }
  return trimmed;
};

const getStaticServiceAliasPhrases = (serviceName: string): string[] => {
  const normalized = normalizeForMatch(serviceName);
  const customerFacingName = getCustomerFacingServiceName(serviceName);
  const aliases = new Set<string>([serviceName, normalized]);
  if (customerFacingName) {
    aliases.add(customerFacingName);
    aliases.add(normalizeForMatch(customerFacingName));
  }
  Object.entries(SERVICE_ALIASES).forEach(([canonical, phrases]) => {
    const normalizedCanonical = normalizeForMatch(canonical);
    if (normalized === normalizedCanonical || normalized.includes(normalizedCanonical)) {
      phrases.forEach((phrase) => aliases.add(phrase));
    }
  });
  return Array.from(aliases.values());
};

const findConfiguredServiceNameInText = (
  serviceNames: string[],
  text?: string
): string | undefined => {
  const normalizedText = compactForMatch(text);
  if (!normalizedText) {
    return undefined;
  }

  const matchedServiceName = serviceNames.find((serviceName) =>
    getStaticServiceAliasPhrases(serviceName).some((phrase) => {
      const compact = compactForMatch(phrase);
      return compact.length >= 3 && normalizedText.includes(compact);
    })
  );
  return getCustomerFacingServiceName(matchedServiceName);
};

const serviceNameHasCurrentTurnEvidence = (
  serviceName: string | undefined,
  transcriptText: string | undefined,
  attributes?: Record<string, unknown>
): boolean => {
  const customerFacingName = getCustomerFacingServiceName(serviceName);
  if (!customerFacingName || !transcriptText?.trim()) {
    return true;
  }
  return getAsrDecisionTranscripts(transcriptText, attributes).some((candidate) => {
    const matched = findConfiguredServiceNameInText([customerFacingName], candidate.transcript);
    return Boolean(
      matched &&
        normalizeForMatch(matched) === normalizeForMatch(customerFacingName)
    );
  });
};

const PARTIAL_BOOKING_FRAGMENTS = new Set([
  "i want to",
  "i want to book",
  "i want to book a",
  "want to book",
  "want to book a",
  "book a",
  "book an",
  "with",
  "change it to",
  "full"
]);

const isPartialBookingFragment = (text?: string | null): boolean => {
  const normalized = normalizeForMatch(text).replace(/[.?!,]+$/g, "").trim();
  return PARTIAL_BOOKING_FRAGMENTS.has(normalized);
};

const isServiceSlotConversationalNoise = (text?: string | null): boolean => {
  const normalized = normalizeForMatch(text);
  return Boolean(
    normalized &&
      (/^(?:i\s*(?:am|m)\s*)?(?:following|still here|here)$/.test(normalized) ||
        /^(?:hello|hi|hey)(?:\s+(?:are|r)\s+you\s+there)?$/.test(normalized) ||
        /^(?:are|r)\s+you\s+there$/.test(normalized))
  );
};

const CUSTOMER_NAME_CAPTURE_STOP_WORDS = new Set([
  "i",
  "we",
  "you",
  "doing",
  "well",
  "good",
  "fine",
  "okay",
  "ok",
  "thank",
  "thanks",
  "following",
  "still",
  "here",
  "want",
  "need",
  "book",
  "booking",
  "appointment",
  "service",
  "services",
  "pedicure",
  "manicure",
  "full",
  "set",
  "gel",
  "dip",
  "powder",
  "with",
  "except",
  "tomorrow",
  "today",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "morning",
  "afternoon",
  "evening",
  "night",
  "at",
  "on",
  "for",
  "phone",
  "number",
  "and",
  "please"
]);

const readCustomerNameCandidateTokens = (text?: string | null): string[] => {
  const raw = text ?? "";
  const introPattern =
    /(?:^|[\s,.;!?])(?:my\s+name\s+is|name\s+is|this\s+is|i\s+am|i'm|im|you\s+can\s+call\s+me|call\s+me)\s+/giu;
  const candidates: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = introPattern.exec(raw)) !== null) {
    const afterIntro = raw.slice(introPattern.lastIndex);
    const phrase = afterIntro.split(/[,.!?;]/, 1)[0] || afterIntro;
    const tokens: string[] = [];
    for (const token of phrase.split(/\s+/).filter(Boolean)) {
      const cleaned = token.replace(/^[^\p{L}'-]+|[^\p{L}'-]+$/gu, "");
      const normalized = normalizeForMatch(cleaned);
      if (
        !cleaned ||
        !/^\p{L}[\p{L}'-]*$/u.test(cleaned) ||
        CUSTOMER_NAME_CAPTURE_STOP_WORDS.has(normalized)
      ) {
        break;
      }
      tokens.push(cleaned);
      if (tokens.length >= 4) {
        break;
      }
    }
    if (tokens.length) {
      candidates.push(tokens.join(" "));
    }
  }

  const useForNameMatch = raw.match(
    /\buse\s+(\p{L}[\p{L}'-]*(?:\s+\p{L}[\p{L}'-]*){0,3})\s+for\s+(?:the\s+)?name\b/iu
  );
  if (useForNameMatch?.[1]) {
    candidates.unshift(useForNameMatch[1]);
  }
  return candidates;
};

const extractCustomerNameFromText = (text?: string): string | undefined => {
  for (const candidateText of readCustomerNameCandidateTokens(text)) {
    const name = collapseSpokenNameSpelling(candidateText);
    if (isAcceptableCustomerName(name)) {
      return name;
    }
  }
  return undefined;
};

const extractCustomerPhoneFromText = (text?: string): string | undefined => {
  const explicitPhoneMatch = text?.match(
    /(?:phone number is|phone is|call me at|reach me at)\s*(\+?1?[\s\-()]*[2-9]\d{2}[\s\-()]*[2-9]\d{2}[\s\-()]?\d{4})/i
  );
  const fallbackPhoneMatch = text?.match(
    /(\+?1?[\s\-()]*[2-9]\d{2}[\s\-()]*[2-9]\d{2}[\s\-()]?\d{4})/
  );
  return normalizePhoneForMatching(explicitPhoneMatch?.[1] ?? fallbackPhoneMatch?.[1]);
};

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
  return /^(yes|yeah|yep|correct|right|that is right|that's right|that is correct|sure|ok|okay|confirm|confirmed|go ahead|book it|one|1)$/i.test(
    normalizeForMatch(value)
  );
};

const isNegative = (value?: string | null): boolean => {
  return /^(no|nope|not that|not correct|change it|update it|wrong|two|2)$/i.test(normalizeForMatch(value));
};

const hasExplicitFirstAvailableStaffRejection = (value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return false;
  }
  return Boolean(
    /\bnot\s+(?:any\s+staff|first\s+available|the\s+first\s+available)\b/.test(normalized) ||
      /\b(?:do\s+not|don\s+t|dont)\s+want\s+(?:any\s+staff|first\s+available|the\s+first\s+available)\b/.test(normalized) ||
      /\banother\s+staff\b.*\bnot\s+(?:first\s+available|any\s+staff)\b/.test(normalized)
  );
};

type FinalBookingConfirmationOutcome = "AFFIRMED" | "DENIED" | "CHANGE_REQUEST" | "NEW_BOOKING" | "UNKNOWN";

const FINAL_CONFIRMATION_ONLY_PHRASES = new Set([
  "yes",
  "yeah",
  "yep",
  "correct",
  "that s right",
  "thats right",
  "that is right",
  "that is correct",
  "sounds good",
  "go ahead",
  "please go ahead",
  "book it",
  "please book it",
  "confirm it",
  "confirm",
  "confirmed",
  "sure",
  "ok",
  "okay",
  "one",
  "1",
  "proceed",
  "do it"
]);

const isFinalConfirmationOnlyPhrase = (value?: string | null): boolean => {
  return FINAL_CONFIRMATION_ONLY_PHRASES.has(normalizeForMatch(value));
};

const isBillingLikeServiceCollision = (value?: string | null): boolean =>
  /\bpay\s+the\s+bill\b/.test(normalizeForMatch(value));

const hasStaticServiceAliasInText = (value?: string | null): boolean => {
  if (isBillingLikeServiceCollision(value)) {
    return false;
  }
  const compactText = compactForMatch(value);
  if (!compactText) {
    return false;
  }
  return Object.values(SERVICE_ALIASES)
    .flat()
    .some((phrase) => {
      const compact = compactForMatch(phrase);
      return compact.length >= 3 && compactText.includes(compact);
    });
};

const hasFreshBookingRestartIntent = (value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return false;
  }
  const appointmentWord = /\b(?:appointment|booking)\b/.test(normalized);
  const contextualApartment =
    /\bapartment\b/.test(normalized) &&
    /\b(?:book|schedule|new|another|make|start\s+over|restart|appointment)\b/.test(normalized);
  if (
    /\b(?:start\s+over|restart(?:\s+the\s+booking)?|start\s+a\s+new\s+booking|new\s+booking|book\s+again|book\s+another|make\s+another)\b/.test(
      normalized
    )
  ) {
    return true;
  }
  if (
    /\b(?:i\s+want\s+to\s+book|want\s+to\s+book|need\s+to\s+book|book|schedule|make)\b/.test(normalized) &&
    /\b(?:new|another|different)\b/.test(normalized) &&
    (appointmentWord || contextualApartment)
  ) {
    return true;
  }
  if (/\b(?:i\s+need|need|want)\s+(?:a\s+)?different\s+(?:appointment|booking|apartment)\b/.test(normalized)) {
    return true;
  }
  return Boolean(
    /^(?:no|nope|nah|wait\s+no|no\s+i\s+say\s+no)\b/.test(normalized) &&
      /\bbook\b/.test(normalized) &&
      (hasStaticServiceAliasInText(value) ||
        new RegExp(DATE_PHRASE_PATTERN, "i").test(value ?? "") ||
        Boolean(extractTimeCandidate(value ?? "")))
  );
};

const classifyFinalBookingConfirmation = (
  value?: string | null,
  options: { hasExplicitStaffChange?: boolean } = {}
): FinalBookingConfirmationOutcome => {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return "UNKNOWN";
  }
  if (isFinalConfirmationOnlyPhrase(normalized)) {
    return "AFFIRMED";
  }

  const hasChangeRequest =
    /\b(?:change|make it|instead|switch|move it|can we do|could we do|actually)\b/.test(normalized);
  const hasStaffChangeRequest =
    /\b(?:change|switch)\s+(?:the\s+)?(?:person|staff|technician|tech)\b/.test(normalized) ||
    /\b(?:someone else|different person|different staff|different technician|different tech)\b/.test(normalized) ||
    /\bnot\s+(?!correct\b|right\b|book\b|it\b|that\b|my\b|me\b|name\b)[a-z][a-z\s'-]{1,40}\b/.test(normalized) ||
    /\bwith\s+[a-z][a-z\s'-]{1,40}\s+instead\b/.test(normalized);
  const hasNewBookingValue =
    hasStaticServiceAliasInText(value) ||
    new RegExp(DATE_PHRASE_PATTERN, "i").test(value ?? "") ||
    Boolean(extractTimeCandidate(value ?? "")) ||
    Boolean(options.hasExplicitStaffChange);
  const hasExplicitNegation =
    /\b(?:no|nope|nah|wrong|not correct|not right|do not|don t|dont|cancel it|wait no|change it|update it)\b/.test(normalized) ||
    /^(?:2|two)$/.test(normalized);
	  const hasAffirmation =
    /\b(?:yes|yeah|yep|correct|right|sure|ok|okay)\b/.test(normalized) ||
    /^(?:1|one)$/.test(normalized) ||
    /\b(?:that s right|that is right|sounds good|that s fine|that is fine|go ahead|please book it|book it|confirm it)\b/.test(
      normalized
	    );

  if (hasFreshBookingRestartIntent(value)) {
    return "NEW_BOOKING";
  }

  if (hasStaffChangeRequest) {
    return "CHANGE_REQUEST";
  }
  if ((hasExplicitNegation || hasChangeRequest) && hasNewBookingValue) {
    return "CHANGE_REQUEST";
  }
  if (hasNewBookingValue && hasAffirmation && /\b(?:but|actually|instead|change|make|move|switch|want|need|with|at|for)\b/.test(normalized)) {
    return "CHANGE_REQUEST";
  }
  if (hasNewBookingValue && !hasAffirmation) {
    return "CHANGE_REQUEST";
  }
  if (hasExplicitNegation) {
    return "DENIED";
  }

  return hasAffirmation ? "AFFIRMED" : "UNKNOWN";
};

const readDtmfDigit = (value?: string | null): string | undefined => {
  const trimmed = (value ?? "").trim();
  const match = trimmed.match(/^(?:dtmf\s*)?([0-9]{1,2})#?$/i);
  return match?.[1];
};

const readSpokenDigitCandidate = (value?: string | null): string | undefined => {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return undefined;
  }
  if (/^[0-9]$/.test(trimmed)) {
    return trimmed;
  }
  const normalized = normalizeForMatch(trimmed);
  if (normalized === "zero" || /^(?:press|pressed|hit|dial)\s+zero$/.test(normalized)) {
    return "0";
  }
  const spokenDigitMatch = normalized.match(
    /^(?:(?:uh|um|er|ah)\s+)?(?:(?:number|option|press|pressed|hit|dial)\s+)?(one|two|three|tree|tri|four|five|six|seven|eight|nine)$/
  );
  return spokenDigitMatch?.[1] ? String(NUMBER_WORDS[spokenDigitMatch[1]] ?? "") : undefined;
};

const readScopedDtmfSelection = (
  isScoped: boolean,
  isGenuineDtmf: boolean,
  values: Array<string | undefined>,
  options: Record<string, string>
): string | undefined => {
  if (!isScoped || !isGenuineDtmf) {
    return undefined;
  }
  for (const value of values) {
    const digit = readDtmfDigit(value);
    if (digit && options[digit]) {
      return options[digit];
    }
  }
  return undefined;
};

const readServiceDtmfOptions = (
  attributes: Record<string, unknown> | undefined
): Record<string, string> => {
  const activeOptions = parseJsonStringRecord(readStringAttribute(attributes, ["activeDtmfOptionsJson"]));
  if (Object.keys(activeOptions).length) {
    return activeOptions;
  }
  return SERVICE_DTMF_OPTIONS;
};

const isAnyStaffPreference = (
  value?: string | null,
  context: { lastAskedSlot?: string; activeDtmfMenu?: string } = {}
): boolean => {
  const normalized = normalizeForMatch(value);
  if (!normalized || /\bany\s+time\b/.test(normalized)) {
    return false;
  }
  if (ANY_STAFF_PHRASES.has(normalized)) {
    return true;
  }
  const contextual = normalized.replace(
    /\s+(?:is\s+(?:fine|okay|ok)|works\s+for\s+me|if\s+i|please)$/,
    ""
  );
  return Boolean(
    (context.lastAskedSlot === "staffPreference" || context.activeDtmfMenu === "staff") &&
      CONTEXTUAL_ANY_STAFF_PHRASES.has(contextual)
  );
};

const parseJsonStringRecord = (value?: string): Record<string, string> => {
  if (!value) {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([key, entry]) => /^(?:0|[1-9][0-9]?)$/.test(key) && typeof entry === "string" && entry.trim())
        .map(([key, entry]) => [key, String(entry).trim()])
    );
  } catch {
    return {};
  }
};

const readStaffDtmfOptions = (
  attributes: Record<string, unknown> | undefined
): Record<string, string> => {
  const dynamicOptions = parseJsonStringRecord(readStringAttribute(attributes, ["staffDtmfOptions"]));
  if (Object.keys(dynamicOptions).length) {
    return dynamicOptions;
  }
  const activeOptions = parseJsonStringRecord(readStringAttribute(attributes, ["activeDtmfOptionsJson"]));
  const staffOptions = Object.fromEntries(
    Object.entries(activeOptions).filter(([, value]) => value !== "__operator__")
  );
  return Object.keys(staffOptions).length ? staffOptions : STAFF_DTMF_OPTIONS;
};

const readStaffDtmfStaffIds = (
  attributes: Record<string, unknown> | undefined
): Record<string, string> => {
  return parseJsonStringRecord(
    readStringAttribute(attributes, ["staffDtmfStaffIds", "staffDtmfOptionStaffIds", "activeDtmfOptionStaffIds"])
  );
};

const isOperatorZeroRequest = (value?: string | null): boolean => {
  const digit = readDtmfDigit(value);
  if (digit === "0") {
    return true;
  }
  const normalized = normalizeForMatch(value);
  return normalized === "zero" || /\b(?:press|pressed|hit|dial)\s+zero\b/.test(normalized);
};

const isInvalidCustomerNameNoise = (value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  return Boolean(
    normalized &&
      (CUSTOMER_NAME_NOISE.has(normalized) ||
        CUSTOMER_NAME_SMALL_TALK_PATTERNS.some((pattern) => pattern.test(normalized)) ||
        isDigitOnlyOrSequenceUtterance(value) ||
        /\b(book|booking|appointment|service|pedicure|manicure|full set|dip|powder|first available|any staff|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|night|am|pm|with|at|on|for|to|by|from|and|the|please|phone|number|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/.test(
          normalized
        ))
  );
};

const isAcceptableCustomerName = (value?: string | null): value is string => {
  const raw = value?.trim();
  const normalized = normalizeForMatch(raw);
  if (!raw || isInvalidCustomerNameNoise(raw) || readDtmfDigit(raw)) {
    return false;
  }
  const candidate = collapseSpokenNameSpelling(raw);
  if (!CUSTOMER_NAME_PATTERN.test(candidate) || normalized.split(" ").length > 4) {
    return false;
  }
  return true;
};

const extractBareCustomerNameAnswer = (value?: string | null): string | undefined => {
  const raw = value?.trim();
  const candidate = collapseSpokenNameSpelling(raw);
  const normalized = normalizeForMatch(raw);
  if (
    !raw ||
    readDtmfDigit(raw) ||
    isOperatorZeroRequest(raw) ||
    isInvalidCustomerNameNoise(raw) ||
    /\b(real person|live person|human|operator|representative|talk to a person|talk to someone|speak to someone|speak with someone)\b/.test(normalized) ||
    /\b(book|booking|appointment|service|pedicure|manicure|full set|dip|powder|first available|any staff|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|night|am|pm|with|at|on|for|to|by|from|and|the|please|phone|number|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/.test(normalized)
  ) {
    return undefined;
  }
  if (!CUSTOMER_NAME_PATTERN.test(candidate) || normalizeForMatch(candidate).split(" ").length > 4) {
    return undefined;
  }
  return candidate;
};

const extractExplicitCustomerNameCorrection = (value?: string | null): string | undefined => {
  const raw = value?.trim();
  if (!raw) {
    return undefined;
  }
  const match = raw.match(
    /(?:my\s+name\s+is|name\s+is|call\s+me|use)\s+(\p{L}[\p{L}'-]*(?:\s+\p{L}[\p{L}'-]*){0,3})(?=\s*(?:[,.!?;]|$|for\s+(?:the\s+)?appointment))/iu
  );
  const candidate = collapseSpokenNameSpelling(match?.[1]);
  return isAcceptableCustomerName(candidate) ? candidate : undefined;
};

const hasExplicitCustomerNameCorrectionPhrase = (value?: string | null): boolean => {
  const raw = value ?? "";
  return Boolean(extractCustomerNameFromText(raw)) ||
    /(?:\bmy\s+name\s+is\b|\bname\s+is\b|\bthis\s+is\b|\byou\s+can\s+call\s+me\b|\bcall\s+me\b|\buse\s+\p{L}[\p{L}'-]*(?:\s+\p{L}[\p{L}'-]*){0,3}\s+for\s+(?:the\s+)?name\b)/iu.test(
      raw
    );
};

const rejectsRecognizedCustomerName = (value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  return /\b(?:that s not my name|that is not my name|that isn t my name|that is not me|that isn t me|that s not me|not my name|not me)\b/.test(
    normalized
  );
};

const isReusableCallerName = (value?: string | null): value is string => {
  return Boolean(extractBareCustomerNameAnswer(value));
};

const STAFF_ALIAS_PHRASES: Record<string, string[]> = {
  trang: ["trang", "chang", "jang", "jan", "jen", "train", "trangg", "dang"],
  amy: ["amy", "amie", "aimee", "emmy", "emmie", "a me"],
  kelly: ["kelly", "kelley", "keli", "ke li"],
  kevin: ["kevin", "kenvin"]
};
const TRANG_ASR_CONFUSION_ALIASES = new Set(["frank", "jen", "hang"]);
const TRANG_NEGATIVE_ASR_EXCLUSION_ALIASES = new Set([
  "jang",
  "praying",
  "trained",
  "train",
  "chang",
  "dang"
]);

const getStaffAliasPhrases = (staffName: string): string[] => {
  const firstName = staffName.split(/\s+/)[0] ?? "";
  return [
    staffName,
    firstName,
    ...((firstName && STAFF_ALIAS_PHRASES[normalizeForMatch(firstName)]) || [])
  ].filter(Boolean);
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const textContainsStaffAlias = (normalizedText: string, alias: string): boolean => {
  const normalizedAlias = normalizeForMatch(alias);
  if (!normalizedAlias) {
    return false;
  }
  if (normalizedAlias.includes(" ")) {
    return normalizedText.includes(normalizedAlias);
  }
  return new RegExp(`\\b${escapeRegExp(normalizedAlias)}\\b`).test(normalizedText);
};

const staffAliasMatchesInText = (normalizedText: string, alias: string): number[] => {
  const normalizedAlias = normalizeForMatch(alias);
  if (!normalizedText || !normalizedAlias) {
    return [];
  }
  const pattern = new RegExp(`(^|\\s)${escapeRegExp(normalizedAlias)}(?=\\s|$)`, "g");
  const matches: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(normalizedText)) !== null) {
    matches.push(match.index + (match[1] ? match[1].length : 0));
  }
  return matches;
};

const containsKnownStaffAliasText = (
  value?: string | null,
  context: StaffPhraseContext = {}
): boolean => {
  const normalizedText = normalizeForMatch(value);
  if (!normalizedText) {
    return false;
  }
  const staticMatch = Object.entries(STAFF_ALIAS_PHRASES).some(([canonical, aliases]) =>
    [canonical, ...aliases].some(
      (alias) =>
        !shouldSkipStaffAlias(canonical, alias, normalizedText, context) &&
        staffAliasMatchesInText(normalizedText, alias).length > 0
    )
  );
  if (staticMatch) {
    return true;
  }
  return Object.values(readStaffDtmfOptions(context as Record<string, unknown>)).some((staffName) => {
    const normalizedStaffName = normalizeForMatch(staffName);
    if (!normalizedStaffName || normalizedStaffName === "any staff") {
      return false;
    }
    const firstName = normalizeForMatch(staffName.split(/\s+/)[0]);
    return (
      staffAliasMatchesInText(normalizedText, normalizedStaffName).length > 0 ||
      (firstName && staffAliasMatchesInText(normalizedText, firstName).length > 0)
    );
  });
};

const isNegatedStaffAlias = (normalizedText: string, matchIndex: number): boolean => {
  const before = normalizedText.slice(0, matchIndex).trim();
  return /\b(?:not|except|but\s+not|don\s+t\s+want|dont\s+want|do\s+not\s+want)(?:\s+(?:the|that|this|one|staff|technician|tech))?$/.test(
    before
  );
};

type StaffPhraseContext = {
  lastAskedSlot?: string;
  activeDtmfMenu?: string;
  serviceName?: string;
  confirmedServiceName?: string;
  requestedDate?: string;
  requestedTime?: string;
  staffPreference?: string;
  confirmedStaffName?: string;
  staffId?: string;
  selectedStaffId?: string;
};

type VoiceSlotDecision = {
  slot: "serviceName" | "requestedDate" | "requestedTime" | "staffPreference" | "customerName" | "bookingConfirmation";
  action: "accept" | "propose" | "reject" | "preserve" | "ignore";
  canonicalValue?: string;
  entityId?: string;
  reason: string;
  confidenceBand: "high" | "medium" | "low";
  evidence: string[];
  source: "dtmf" | "exact_catalog" | "lex_resolved" | "transcript" | "asr_alternative" | "contextual_repair";
  activeSlot: string;
  negated: boolean;
  requiresConfirmation: boolean;
  alternativesUsed: boolean;
};

const staffPhraseContextFromAttributes = (
  attributes?: Record<string, unknown>
): StaffPhraseContext => ({
  lastAskedSlot: readStringAttribute(attributes, ["lastAskedSlot"]),
  activeDtmfMenu: readStringAttribute(attributes, ["activeDtmfMenu"]),
  serviceName: readStringAttribute(attributes, ["serviceName"]),
  confirmedServiceName: readStringAttribute(attributes, ["confirmedServiceName"]),
  requestedDate: readStringAttribute(attributes, ["requestedDate"]),
  requestedTime: readStringAttribute(attributes, ["requestedTime"]),
  staffPreference: readStringAttribute(attributes, ["staffPreference"]),
  confirmedStaffName: readStringAttribute(attributes, ["confirmedStaffName"]),
  staffId: readStringAttribute(attributes, ["staffId", "confirmedStaffId"]),
  selectedStaffId: readStringAttribute(attributes, ["selectedStaffId"])
});

const hasExplicitStaffContextCue = (
  normalizedText: string,
  context: StaffPhraseContext = {}
): boolean =>
  Boolean(
    context.lastAskedSlot === "staffPreference" ||
      context.activeDtmfMenu === "staff" ||
      /\b(?:with|use|i said|technician|staff|tech)\b/.test(normalizedText) ||
      /\b(?:change|switch)\s+(?:the\s+)?(?:person|staff|technician|tech)\b/.test(normalizedText) ||
      /\b(?:someone else|different person|different staff|different technician|different tech)\b/.test(
        normalizedText
      ) ||
      /\binstead\b/.test(normalizedText)
  );

const isStaffSelectionContext = (
  normalizedText: string,
  context: StaffPhraseContext = {}
): boolean =>
  Boolean(
    context.lastAskedSlot === "staffPreference" ||
      context.activeDtmfMenu === "staff" ||
      hasExplicitStaffContextCue(normalizedText, context) ||
      /\b(?:staff|technician|tech)\b/.test(normalizedText) ||
      /\b(?:any\s+staff|any\s+stat|any\s+technician|any\s+tech|first\s+avai?lable|the\s+first\s+available|for\s+available)\b/.test(
	        normalizedText
	      )
  );

const stripAnyStaffTrailingFiller = (normalizedText: string): string => {
  let stripped = normalizedText;
  while (/\s+(?:is\s+(?:fine|okay|ok)|works\s+for\s+me|if\s+i|please)$/.test(stripped)) {
    stripped = stripped.replace(/\s+(?:is\s+(?:fine|okay|ok)|works\s+for\s+me|if\s+i|please)$/, "").trim();
  }
  return stripped;
};

const normalizeAnyStaffPhrase = (
  value?: string | null,
  context: StaffPhraseContext = {}
): "Any staff" | undefined => {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return undefined;
  }
  if (hasExplicitFirstAvailableStaffRejection(value)) {
    return undefined;
  }
  if (/\b(?:and\s+)?stop\s+at\s+(?:five|5)\b/.test(normalized)) {
    return "Any staff";
  }

  if (
    Array.from(ANY_STAFF_PHRASES).some((phrase) => {
      const normalizedPhrase = normalizeForMatch(phrase);
      return normalized === normalizedPhrase || textContainsStaffAlias(normalized, normalizedPhrase);
    })
  ) {
    return "Any staff";
  }
  if (/\bany\s+time\b/.test(normalized)) {
    return undefined;
  }

  if (!isStaffSelectionContext(normalized, context)) {
    return undefined;
  }

  const contextualCandidate = stripAnyStaffTrailingFiller(normalized);
  const contextualCompact = compactForMatch(contextualCandidate);
  return Array.from(CONTEXTUAL_ANY_STAFF_PHRASES).some((phrase) => {
    const normalizedPhrase = normalizeForMatch(phrase);
    return (
      contextualCandidate === normalizedPhrase ||
      contextualCompact === compactForMatch(phrase) ||
      (normalizedPhrase !== "available" && textContainsStaffAlias(contextualCandidate, normalizedPhrase))
    );
  })
    ? "Any staff"
    : undefined;
};

const isScopedDangAliasAllowed = (
  normalizedText: string,
  context: StaffPhraseContext = {}
): boolean =>
  Boolean(
    context.lastAskedSlot === "staffPreference" ||
      context.activeDtmfMenu === "staff" ||
      /\b(?:with|use|staff|technician|tech)\s+dang\b/.test(normalizedText) ||
      /\b(?:no\s+)?i\s+want(?:\s+to\s+book)?\s+dang\b/.test(normalizedText) ||
      /\b(?:change|switch)\s+(?:the\s+)?(?:person|staff|technician|tech)(?:\s+(?:to|into))?\s+dang\b/.test(
        normalizedText
      ) ||
      /\bdang\s+instead\b/.test(normalizedText)
  );

const shouldSkipStaffAlias = (
  staffName: string,
  alias: string,
  normalizedText: string,
  context: StaffPhraseContext = {}
): boolean => {
  const normalizedStaffName = normalizeForMatch(staffName);
  const normalizedAlias = normalizeForMatch(alias);
  return (
    (normalizedStaffName === "trang" &&
      normalizedAlias === "dang" &&
      !isScopedDangAliasAllowed(normalizedText, context))
  );
};

const extractTrangAsrConfusionToken = (value?: string | null): string | undefined => {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return undefined;
  }
  return normalized.split(/\s+/).find((token) => TRANG_ASR_CONFUSION_ALIASES.has(token));
};

const hasExactActiveStaffNameCollision = (staff: StaffCandidate[], token: string): boolean =>
  staff.some((member) => {
    const fullName = normalizeForMatch(member.fullName);
    const firstName = normalizeForMatch(member.fullName.split(/\s+/)[0]);
    return token === fullName || token === firstName;
  });

const staffAliasCollidesWithExactActiveStaff = (
  staff: StaffCandidate[],
  staffName: string,
  alias: string
): boolean => {
  if (normalizeForMatch(staffName) !== "trang") {
    return false;
  }
  const normalizedAlias = normalizeForMatch(alias);
  const normalizedStaffName = normalizeForMatch(staffName);
  if (!normalizedAlias || !normalizedStaffName) {
    return false;
  }
  return staff.some((member) => {
    const fullName = normalizeForMatch(member.fullName);
    const firstName = normalizeForMatch(member.fullName.split(/\s+/)[0]);
    if (normalizedStaffName === fullName || normalizedStaffName === firstName) {
      return false;
    }
    return normalizedAlias === fullName || normalizedAlias === firstName;
  });
};

const resolveTrangAsrConfusionStaff = (
  staff: StaffCandidate[],
  value?: string | null,
  context: StaffPhraseContext = {}
): StaffCandidate | undefined => {
  if (
    context.lastAskedSlot === "customerName" &&
    context.activeDtmfMenu !== "staff"
  ) {
    return undefined;
  }
  const normalized = normalizeForMatch(value);
  const token = extractTrangAsrConfusionToken(normalized);
  if (!token || !hasExplicitStaffContextCue(normalized, context)) {
    return undefined;
  }
  if (hasExactActiveStaffNameCollision(staff, token)) {
    return undefined;
  }
  return staff.find((member) => normalizeForMatch(member.fullName.split(/\s+/)[0]) === "trang");
};

const isUnsupportedServiceRequestPhrase = (value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  return Boolean(
    normalized &&
      /\b(?:haircut|hair cut|facial|polish|gel|gel nails|gel service|gel manicure|jell manicure)\b/.test(
        normalized
      )
  );
};

type UnsupportedServiceRequest = {
  heardServiceName: string;
  displayServiceName: string;
  category: "gel" | "unsupported";
};

const detectUnsupportedServiceRequest = (value?: string | null): UnsupportedServiceRequest | null => {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return null;
  }
  if (/\b(?:gel|gel nails|gel service|gel manicure|jell manicure)\b/.test(normalized)) {
    return {
      heardServiceName: "gel",
      displayServiceName: "Gel Manicure",
      category: "gel"
    };
  }
  const match = normalized.match(/\b(haircut|hair cut|facial|polish)\b/);
  if (!match) {
    return null;
  }
  return {
    heardServiceName: match[1] ?? "service",
    displayServiceName: toCustomerNameCase(match[1] ?? "service"),
    category: "unsupported"
  };
};

const normalizeScopedStaffCandidatePhrase = (
  value?: string | null,
  context: StaffPhraseContext = {}
): string | undefined => {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return undefined;
  }
  if (isFinalConfirmationOnlyPhrase(normalized)) {
    return undefined;
  }
  if (readDtmfDigit(normalized)) {
    return undefined;
  }
  if (normalizeAnyStaffPhrase(value, context)) {
    return "any staff";
  }
  if (
    /\bnot\s+(?:correct|right|sure|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(
      normalized
    ) ||
    /\b(?:do not|don t|dont)\s+book\b|\bcancel it\b|\bwait no\b|\bno that is wrong\b/.test(normalized)
  ) {
    return undefined;
  }
  if (normalizeAnyStaffPhrase(value, context)) {
    return "any staff";
  }
  const wantMatch = normalized.match(/^(?:no\s+)?i\s+want(?:\s+to\s+book)?\s+(.+)$/);
  const staffContext = hasExplicitStaffContextCue(normalized, context);
  const containsKnownStaffAlias = (text: string): boolean => {
    const normalizedText = normalizeForMatch(text);
    if (!normalizedText) {
      return false;
    }
    return Object.entries(STAFF_ALIAS_PHRASES).some(([canonical, aliases]) =>
      [canonical, ...aliases].some(
        (alias) =>
          !shouldSkipStaffAlias(canonical, alias, normalizedText, context) &&
          staffAliasMatchesInText(normalizedText, alias).length > 0
      )
    );
  };
  const hasKnownStaticStaffAlias =
    containsKnownStaffAlias(normalized) ||
    Boolean(wantMatch?.[1] && containsKnownStaffAlias(wantMatch[1]));
  if (!staffContext && !hasKnownStaticStaffAlias) {
    return undefined;
  }
  if (wantMatch && !staffContext && !containsKnownStaffAlias(wantMatch[1])) {
    return undefined;
  }
  if (isUnsupportedServiceRequestPhrase(normalized)) {
    return undefined;
  }

  let candidate = normalized
    .replace(/\b(?:technician|tech|staff|please|actually|instead|just)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  candidate = candidate
    .replace(/^(?:no\s+)?i\s+want(?:\s+to\s+book)?\s+/, "")
    .replace(/^(?:book\s+with|with|use|i\s+said|change(?:\s+it)?\s+to|switch(?:\s+it)?\s+to)\s+/, "")
    .trim();

  if (candidate.startsWith("not ")) {
    const [, , ...replacementTokens] = candidate.split(/\s+/);
    candidate = replacementTokens.join(" ");
  } else {
    const notIndex = candidate.indexOf(" not ");
    if (notIndex > 0) {
      candidate = candidate.slice(0, notIndex);
    }
  }

  candidate = normalizeForMatch(
    candidate.replace(
      /\b(?:with|book|use|i|want|to|said|change|switch|it|instead|just|no|please|actually|technician|staff|tech|the|a|an)\b/g,
      " "
    )
  );
  if (!candidate || candidate.split(/\s+/).length > 2) {
    return undefined;
  }
  if (
    /^(?:yes|yeah|yep|correct|right|sure|ok|okay|no|nope|nah|wrong)(?:\s+(?:yes|yeah|yep|correct|right|sure|ok|okay|no|nope|nah|wrong))*$/.test(
      candidate
    )
  ) {
    return undefined;
  }
  if (
    hasStaticServiceAliasInText(candidate) ||
    isUnsupportedServiceRequestPhrase(candidate) ||
    new RegExp(DATE_PHRASE_PATTERN, "i").test(candidate) ||
    Boolean(extractTimeCandidate(candidate))
  ) {
    return undefined;
  }
  return candidate;
};

const hasExplicitStaffPhrase = (
  value?: string | null,
  context: StaffPhraseContext = {}
): boolean => {
  const normalized = normalizeForMatch(value);
  return Boolean(
    normalized &&
      (normalizeScopedStaffCandidatePhrase(value, context) ||
        /\bnot\s+(?!today\b|tomorrow\b|monday\b|tuesday\b|wednesday\b|thursday\b|friday\b|saturday\b|sunday\b|correct\b|right\b|book\b|it\b|that\b|this\b|my\b|me\b|name\b)[a-z][a-z'-]{1,40}\b/.test(normalized))
  );
};

const hasStaffCuePhrase = (
  value?: string | null,
  context: StaffPhraseContext = {}
): boolean => {
  const normalized = normalizeForMatch(value);
  return Boolean(
    normalized &&
	      (hasExplicitStaffContextCue(normalized, context) ||
        /\b(?:any\s+staff|any\s+stat|first\s+avai?lable|the\s+first\s+available)\b/.test(normalized) ||
	        /\bnot\s+(?!today\b|tomorrow\b|monday\b|tuesday\b|wednesday\b|thursday\b|friday\b|saturday\b|sunday\b|correct\b|right\b|book\b|it\b|that\b|this\b|my\b|me\b|name\b)[a-z][a-z'-]{1,40}\b/.test(normalized))
	  );
};

const STAFF_FUZZY_STOP_TOKENS = new Set([
  "change",
  "changes",
  "changed",
  "changing",
  "switch",
  "move",
  "make",
  "just",
  "into",
  "instead"
]);

const isConservativeStaffFuzzyMatch = (alias: string, requested: string): boolean => {
  const compactAlias = compactForMatch(alias);
  const compactRequested = compactForMatch(requested);
  return (
    compactAlias.length >= 5 &&
    compactRequested.length >= 5 &&
    levenshteinDistance(compactAlias, compactRequested) <= 1
  );
};

const isClearlyInvalidStaffPreference = (value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  const compact = compactForMatch(value);
  if (!normalized || isAnyStaffPreference(normalized)) {
    return false;
  }
  if (isAffirmative(normalized) || isNegative(normalized)) {
    return true;
  }
  if (/^(?:am|pm|a m|p m|time|phone|phone number)$/.test(normalized)) {
    return true;
  }
  if (isFinalConfirmationOnlyPhrase(normalized)) {
    return true;
  }
  if (hasStaticServiceAliasInText(normalized)) {
    return true;
  }
  if (isUnsupportedServiceRequestPhrase(normalized)) {
    return true;
  }
  if (normalized.split(/\s+/).length > 3) {
    return true;
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

const customerDisplayName = (customer: CustomerCandidate): string => {
  return customer.firstName.trim() || formatCustomerName(customer.firstName, customer.lastName);
};

const getReusableCustomerDisplayName = (customer: CustomerCandidate): string | undefined => {
  const displayName = customerDisplayName(customer);
  return isReusableCallerName(displayName) ? displayName : undefined;
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

const readNumberAttribute = (
  attributes: Record<string, unknown> | undefined,
  names: string[]
): number | undefined => {
  for (const name of names) {
    const value = attributes?.[name];
    const parsed = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const parseAttemptCount = (value?: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const BOOKING_ATTRIBUTE_NAMES = {
  customerName: ["customerName", "CustomerName"],
  customerPhone: [
    "callerPhone",
    "CustomerEndpointAddress",
    "CustomerEndpoint",
    "customerPhone",
    "CustomerPhone",
    "CallerId",
    "ANI"
  ],
  serviceName: ["serviceName", "ServiceName", "service", "Service", "confirmedServiceName"],
  requestedDate: ["requestedDate", "RequestedDate", "preferredDate", "preferredDateTime"],
  requestedTime: ["requestedTime", "RequestedTime", "preferredTime"],
  staffPreference: ["staffPreference", "StaffPreference", "confirmedStaffName"],
  staffId: ["staffId", "StaffId", "selectedStaffId", "SelectedStaffId", "confirmedStaffId"],
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
    /\b(one|two|three|tree|tri|four|five|fife|six|seven|eight|nine|ten|eleven|twelve)\b/gi,
    (match) => String(NUMBER_WORDS[match.toLowerCase()] ?? match)
  );
};

const digitSequenceFromUtterance = (value?: string | null): string[] => {
  const normalized = normalizeForMatch(value)
    .replace(/^(?:press|pressed|hit|dial|number|option)\s+/, "")
    .trim();
  if (!normalized) {
    return [];
  }
  if (/^\d{2,}$/.test(normalized)) {
    return normalized.split("");
  }
  const tokens = normalized.split(/\s+/);
  const digits = tokens.map((token) => {
    if (/^\d$/.test(token)) {
      return token;
    }
    if (token === "zero") {
      return "0";
    }
    const number = NUMBER_WORDS[token];
    return number !== undefined && number >= 0 && number <= 9 ? String(number) : "";
  });
  return digits.every(Boolean) ? digits : [];
};

const isDigitOnlyOrSequenceUtterance = (value?: string | null): boolean =>
  digitSequenceFromUtterance(value).length > 0;

const getReferenceDateTime = (timezone: string): DateTime => {
  const configured = process.env.FASTAIBOOKING_TEST_NOW_ISO;
  if (!configured || process.env.NODE_ENV !== "test") {
    return DateTime.now().setZone(timezone);
  }
  const parsed = DateTime.fromISO(configured, { setZone: true });
  return parsed.isValid ? parsed.setZone(timezone) : DateTime.now().setZone(timezone);
};

const getReferenceJsDate = (): Date => getReferenceDateTime("utc").toJSDate();

const parseMonthDayDateText = (value: string, timezone: string): DateTime | null => {
  const normalized = normalizeForMatch(value);
  const monthNames = Object.keys(MONTH_NUMBERS).join("|");
  const dayNames = Object.keys(ORDINAL_DAY_WORDS).sort((left, right) => right.length - left.length).join("|");
  const match = normalized.match(
    new RegExp(`\\b(${monthNames})\\s+((?:\\d{1,2}(?:st|nd|rd|th)?)|${dayNames})(?:\\s+(\\d{4}))?\\b`)
  );
  if (!match) {
    return null;
  }

  const month = MONTH_NUMBERS[match[1] ?? ""];
  const dayText = match[2] ?? "";
  const numericDay = dayText.match(/^\d{1,2}/)?.[0];
  const day = numericDay ? Number(numericDay) : ORDINAL_DAY_WORDS[dayText];
  if (!month || !day) {
    return null;
  }

  const now = getReferenceDateTime(timezone);
  const parsed = DateTime.fromObject(
    {
      year: match[3] ? Number(match[3]) : now.year,
      month,
      day
    },
    { zone: timezone }
  );
  return parsed.isValid ? parsed.startOf("day") : null;
};

const parseIsoDateOnlyText = (value: string, timezone: string): DateTime | null => {
  const match = value.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (!match?.[0]) {
    return null;
  }
  const parsed = DateTime.fromISO(match[0], { zone: timezone });
  return parsed.isValid ? parsed.startOf("day") : null;
};

const findSpokenWeekdayToken = (value?: string | null): string | undefined => {
  const normalized = normalizeForMatch(value);
  return normalized.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/)?.[1];
};

const getRelativeWeekdayPhraseCandidate = (
  value?: string | null
): { text: string; weekday: string; mode: "this" | "next" | "next_week" | "bare"; index: number } | null => {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return null;
  }
  const candidates: Array<{ text: string; weekday: string; mode: "this" | "next" | "next_week" | "bare"; index: number }> = [];
  const add = (match: RegExpMatchArray | null, mode: "this" | "next" | "next_week" | "bare") => {
    if (!match?.[0] || match.index === undefined) {
      return;
    }
    const weekday = match[1] ?? match[2];
    if (!weekday) {
      return;
    }
    candidates.push({
      text: match[0],
      weekday,
      mode,
      index: match.index
    });
  };
  add(normalized.match(new RegExp(`\\bnext\\s+week\\s+(${WEEKDAY_WORD_PATTERN})\\b`)), "next_week");
  add(normalized.match(new RegExp(`\\bnextweek\\s+(${WEEKDAY_WORD_PATTERN})\\b`)), "next_week");
  add(normalized.match(new RegExp(`\\b(?:the\\s+)?(${WEEKDAY_WORD_PATTERN})\\s+next\\s+week\\b`)), "next_week");
  add(normalized.match(new RegExp(`\\bnext\\s+(${WEEKDAY_WORD_PATTERN})\\b`)), "next");
  add(normalized.match(new RegExp(`\\bthis\\s+(${WEEKDAY_WORD_PATTERN})\\b`)), "this");
  const occupied = candidates.map((candidate) => [candidate.index, candidate.index + candidate.text.length]);
  for (const match of normalized.matchAll(new RegExp(`\\b(${WEEKDAY_WORD_PATTERN})\\b`, "g"))) {
    const index = match.index ?? 0;
    if (occupied.some(([start, end]) => index >= start && index < end)) {
      continue;
    }
    add(match, "bare");
  }
  return candidates.sort((left, right) => left.index - right.index)[0] ?? null;
};

const resolveRelativeWeekdayCandidate = (
  candidate: NonNullable<ReturnType<typeof getRelativeWeekdayPhraseCandidate>>,
  timezone: string
): DateTime | null => {
  const weekday = WEEKDAY_INDEXES[candidate.weekday];
  if (!weekday) {
    return null;
  }
  const now = getReferenceDateTime(timezone);
  let daysUntil = (weekday - now.weekday + 7) % 7;
  if (candidate.mode === "next_week" || (candidate.mode === "next" && daysUntil === 0)) {
    daysUntil += 7;
  }
  return now.plus({ days: daysUntil }).startOf("day");
};

const getBareSameDayWeekdayClarification = (
  value: string | undefined,
  timezone: string
): {
  weekday: string;
  todayDate: string;
  nextDate: string;
  todayLabel: string;
  nextLabel: string;
} | null => {
  if (value && (parseMonthDayDateText(value, timezone)?.isValid || parseIsoDateOnlyText(value, timezone)?.isValid)) {
    return null;
  }
  const candidate = getRelativeWeekdayPhraseCandidate(value);
  if (!candidate || candidate.mode !== "bare") {
    return null;
  }
  const weekday = WEEKDAY_INDEXES[candidate.weekday];
  const now = getReferenceDateTime(timezone).startOf("day");
  if (!weekday || now.weekday !== weekday) {
    return null;
  }
  const next = now.plus({ days: 7 });
  return {
    weekday: WEEKDAY_LABELS[weekday] ?? candidate.weekday,
    todayDate: now.toFormat("yyyy-MM-dd"),
    nextDate: next.toFormat("yyyy-MM-dd"),
    todayLabel: formatConflictDate(now),
    nextLabel: formatConflictDate(next)
  };
};

const buildBareSameDayWeekdayMessage = (
  clarification: NonNullable<ReturnType<typeof getBareSameDayWeekdayClarification>>
): string =>
  speak(
    `Do you mean today, ${escapeSsml(clarification.todayLabel)}, or next ${escapeSsml(clarification.nextLabel)}?`
  );

const buildDateDecisionDiagnostic = (input: {
  rawTranscript?: string;
  timezone: string;
  selectedDate?: string | null;
  decisionReason: string;
  clarificationReason?: string;
  candidates?: unknown[];
  explicitDateCandidate?: string;
  relativePhrase?: string;
}): Record<string, unknown> => ({
  rawTranscript: input.rawTranscript ?? "",
  salonTimezone: input.timezone,
  referenceLocalDateTime: getReferenceDateTime(input.timezone).toISO(),
  referenceLocalDate: getReferenceDateTime(input.timezone).toFormat("yyyy-MM-dd"),
  selectedDate: input.selectedDate ?? null,
  decisionReason: input.decisionReason,
  confidenceBand: input.clarificationReason ? "needs_clarification" : "high",
  clarificationReason: input.clarificationReason,
  candidates: input.candidates ?? [],
  explicitDateCandidate: input.explicitDateCandidate,
  parsedRelativePhrase: input.relativePhrase
});

const formatConflictDate = (value: DateTime): string => value.toFormat("cccc, LLLL d");

const getWeekdayDateConflict = (
  value: string | undefined,
  timezone: string
): {
  spokenWeekday: string;
  explicitDate: string;
  explicitMonthDay: string;
  explicitDateLabel: string;
	  actualWeekday: string;
	  intendedDate: string;
	  intendedDateLabel: string;
  explicitChoiceLabel?: string;
  intendedChoiceLabel?: string;
  conflictReason?: "weekday_date_conflict" | "relative_explicit_conflict";
	} | null => {
  if (!value?.trim()) {
    return null;
  }
  const weekdayToken = findSpokenWeekdayToken(value);
  if (!weekdayToken) {
    return null;
  }
  const explicitDate = parseMonthDayDateText(value, timezone) ?? parseIsoDateOnlyText(value, timezone);
  const relativeCandidate = getRelativeWeekdayPhraseCandidate(value);
  const relativeDate = relativeCandidate ? resolveRelativeWeekdayCandidate(relativeCandidate, timezone) : null;
  if (
    explicitDate?.isValid &&
    relativeCandidate &&
    relativeCandidate.mode !== "bare" &&
    relativeDate?.isValid &&
    explicitDate.toFormat("yyyy-MM-dd") !== relativeDate.toFormat("yyyy-MM-dd")
  ) {
    const spokenWeekdayIndex = WEEKDAY_INDEXES[relativeCandidate.weekday];
    const explicitDateValue = explicitDate.toFormat("yyyy-MM-dd");
    const explicitDateLabel = formatConflictDate(explicitDate);
    const intendedDateLabel = formatConflictDate(relativeDate);
    const todayDate = getReferenceDateTime(timezone).toFormat("yyyy-MM-dd");
    return {
      spokenWeekday: spokenWeekdayIndex ? WEEKDAY_LABELS[spokenWeekdayIndex] ?? relativeCandidate.weekday : relativeCandidate.weekday,
      explicitDate: explicitDateValue,
      explicitMonthDay: explicitDate.toFormat("LLLL d"),
      explicitDateLabel,
      explicitChoiceLabel: `${explicitDateValue === todayDate ? "today, " : ""}${explicitDateLabel}`,
      actualWeekday: WEEKDAY_LABELS[explicitDate.weekday] ?? explicitDate.toFormat("cccc"),
      intendedDate: relativeDate.toFormat("yyyy-MM-dd"),
      intendedDateLabel,
      intendedChoiceLabel: `next ${intendedDateLabel}`,
      conflictReason: "relative_explicit_conflict"
    };
  }
  if (!explicitDate?.isValid) {
    return null;
  }
  const spokenWeekdayIndex = WEEKDAY_INDEXES[weekdayToken];
  if (!spokenWeekdayIndex || explicitDate.weekday === spokenWeekdayIndex) {
    return null;
  }
  const intendedDate = parseLocalDateText(weekdayToken, timezone);
	  return {
    spokenWeekday: WEEKDAY_LABELS[spokenWeekdayIndex] ?? weekdayToken,
    explicitDate: explicitDate.toFormat("yyyy-MM-dd"),
    explicitMonthDay: explicitDate.toFormat("LLLL d"),
    explicitDateLabel: formatConflictDate(explicitDate),
    actualWeekday: WEEKDAY_LABELS[explicitDate.weekday] ?? explicitDate.toFormat("cccc"),
    intendedDate: intendedDate?.toFormat("yyyy-MM-dd") ?? "",
    intendedDateLabel: intendedDate?.isValid
      ? formatConflictDate(intendedDate)
      : (WEEKDAY_LABELS[spokenWeekdayIndex] ?? weekdayToken),
    conflictReason: "weekday_date_conflict"
  };
};

const buildWeekdayDateConflictMessage = (
  conflict: NonNullable<ReturnType<typeof getWeekdayDateConflict>>
): string =>
  speak(
    conflict.conflictReason === "relative_explicit_conflict"
      ? `Did you mean ${escapeSsml(conflict.explicitChoiceLabel ?? conflict.explicitDateLabel)}, or ${escapeSsml(conflict.intendedChoiceLabel ?? conflict.intendedDateLabel)}?`
      : `${escapeSsml(conflict.explicitMonthDay)} is ${escapeSsml(conflict.actualWeekday)}. Did you mean ${escapeSsml(conflict.explicitDateLabel)}, or ${escapeSsml(conflict.intendedDateLabel)}?`
  );

const getCurrentTurnTemporalConflict = (
  value: string | undefined,
  timezone: string
): {
  message: string;
  reasonCode:
    | "TODAY_TOMORROW_CONFLICT"
    | "TODAY_EXPLICIT_DATE_CONFLICT"
    | "TOMORROW_EXPLICIT_DATE_CONFLICT"
    | "MULTIPLE_TIME_CONFLICT";
  diagnostic: Record<string, unknown>;
} | null => {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return null;
  }
  const now = getReferenceDateTime(timezone);
  const today = now.toFormat("yyyy-MM-dd");
  const tomorrow = now.plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const hasToday = /\btoday\b|\btonight\b|\bthis\s+(?:morning|afternoon|evening)\b/.test(normalized);
  const hasTomorrow = /\btomorrow\b/.test(normalized);
  const makeDiagnostic = (
    reason: string,
    candidates: unknown[],
    explicitDateCandidate?: string
  ) =>
    buildDateDecisionDiagnostic({
      rawTranscript: value,
      timezone,
      selectedDate: null,
      decisionReason: reason,
      clarificationReason: reason,
      candidates,
      explicitDateCandidate
    });
  if (hasToday && hasTomorrow) {
    return {
      message: speak("Did you mean today or tomorrow?"),
      reasonCode: "TODAY_TOMORROW_CONFLICT",
      diagnostic: makeDiagnostic("today_tomorrow_conflict", [
        { source: "today", date: today, label: "today" },
        { source: "tomorrow", date: tomorrow, label: "tomorrow" }
      ])
    };
  }
  const explicitDate = parseMonthDayDateText(value ?? "", timezone) ?? parseIsoDateOnlyText(value ?? "", timezone);
  if (explicitDate?.isValid) {
    const explicit = explicitDate.toFormat("yyyy-MM-dd");
    if (hasToday && explicit !== today) {
      return {
        message: speak(`Did you mean today or ${escapeSsml(formatConflictDate(explicitDate))}?`),
        reasonCode: "TODAY_EXPLICIT_DATE_CONFLICT",
        diagnostic: makeDiagnostic(
          "today_explicit_date_conflict",
          [
            { source: "today", date: today, label: "today" },
            { source: "explicit", date: explicit, label: formatConflictDate(explicitDate) }
          ],
          explicit
        )
      };
    }
    if (hasTomorrow && explicit !== tomorrow) {
      return {
        message: speak(`Did you mean tomorrow or ${escapeSsml(formatConflictDate(explicitDate))}?`),
        reasonCode: "TOMORROW_EXPLICIT_DATE_CONFLICT",
        diagnostic: makeDiagnostic(
          "tomorrow_explicit_date_conflict",
          [
            { source: "tomorrow", date: tomorrow, label: "tomorrow" },
            { source: "explicit", date: explicit, label: formatConflictDate(explicitDate) }
          ],
          explicit
        )
      };
    }
  }
  const timeMatches = Array.from(
    normalized.matchAll(
      new RegExp(`\\b(?:at\\s+)?((?:${SPOKEN_HOUR_PATTERN}|\\d{1,2})(?::\\d{2})?)\\s*(am|pm|a\\s*m|p\\s*m)\\b`, "g")
    )
  );
  const normalizedTimes = Array.from(
    new Set(
      timeMatches
        .map((match) => {
          const parsed = parseLocalTimeText(`${match[1]} ${match[2]}`);
          return parsed && !parsed.ambiguous
            ? `${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}`
            : undefined;
        })
        .filter((item): item is string => Boolean(item))
    )
  );
  if (normalizedTimes.length > 1) {
    return {
      message: speak("Which time did you mean?"),
      reasonCode: "MULTIPLE_TIME_CONFLICT",
      diagnostic: makeDiagnostic(
        "multiple_time_conflict",
        normalizedTimes.map((time) => ({ source: "time", time, label: time }))
      )
    };
  }
  return null;
};

const parseLocalDateText = (value: string, timezone: string): DateTime | null => {
  const cleaned = normalizeForMatch(value);
  const now = getReferenceDateTime(timezone);

  if (
    cleaned === "today" ||
    cleaned === "this morning" ||
    cleaned === "this afternoon" ||
    cleaned === "this evening" ||
    cleaned === "tonight"
  ) {
    return now.startOf("day");
  }
  if (
    cleaned === "tomorrow" ||
    cleaned === "tomorrow morning" ||
    cleaned === "tomorrow afternoon" ||
    cleaned === "tomorrow evening" ||
    cleaned === "tomorrow night"
  ) {
    return now.plus({ days: 1 }).startOf("day");
  }

  const relativeWeekdayCandidate = getRelativeWeekdayPhraseCandidate(cleaned);
  if (relativeWeekdayCandidate && relativeWeekdayCandidate.text === cleaned) {
    return resolveRelativeWeekdayCandidate(relativeWeekdayCandidate, timezone);
  }

  const isoDate = DateTime.fromISO(value.trim(), { zone: timezone });
  if (isoDate.isValid) {
    return isoDate.startOf("day");
  }

  const monthDayDate = parseMonthDayDateText(value, timezone);
  if (monthDayDate) {
    return monthDayDate;
  }

  const formats = ["M/d/yyyy", "M-d-yyyy", "LLLL d yyyy", "LLL d yyyy", "LLLL d", "LLL d"];
  for (const format of formats) {
    const parsed = DateTime.fromFormat(value.trim().replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi, "$1"), format, {
      zone: timezone
    });
    if (parsed.isValid) {
      const withYear = parsed.year === now.year ? parsed : parsed.set({ year: now.year });
      return withYear.startOf("day");
    }
  }

  return null;
};

const readSpokenMinuteValue = (value: string): number | null => {
  const normalized = normalizeForMatch(value);
  if (/^[0-5]?\d$/.test(normalized)) {
    return Number(normalized);
  }
  if (Object.prototype.hasOwnProperty.call(SPOKEN_MINUTE_BASE, normalized)) {
    return SPOKEN_MINUTE_BASE[normalized]!;
  }
  const [base, suffix] = normalized.split(/\s+/);
  if (
    base &&
    suffix &&
    Object.prototype.hasOwnProperty.call(SPOKEN_MINUTE_BASE, base) &&
    NUMBER_WORDS[suffix] !== undefined
  ) {
    const minute = SPOKEN_MINUTE_BASE[base]! + NUMBER_WORDS[suffix]!;
    return minute >= 0 && minute <= 59 ? minute : null;
  }
  return null;
};

const normalizeHourMinuteTimeExpression = (value?: string | null): string => {
  const source = (value ?? "")
    .replace(/\b(\d{3,4})\s*([ap])\s*\.?\s*m\.?\b/gi, (match, digits: string, periodLetter: string) => {
      const hourText = digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2);
      const minuteText = digits.slice(-2);
      const hour = Number(hourText);
      const minute = Number(minuteText);
      if (hour < 1 || hour > 12 || minute > 59) {
        return match;
      }
      return `${hour}:${minuteText} ${periodLetter.toUpperCase()}M`;
    })
    .replace(/\b([ap])\s*\.?\s*m\.?\b/gi, "$1m")
    .replace(/\ba\.?m\.?\b/gi, "am")
    .replace(/\bp\.?m\.?\b/gi, "pm");
  const pattern = new RegExp(
    `\\b(${SPOKEN_HOUR_PATTERN}|\\d{1,2})\\s+(?:and\\s+)?(${SPOKEN_MINUTE_PATTERN})(?:\\s+(am|pm))?\\b`,
    "i"
  );
  return source.replace(pattern, (match, hourText: string, minuteText: string, periodText?: string) => {
    const hour = /^\d{1,2}$/.test(hourText)
      ? Number(hourText)
      : NUMBER_WORDS[normalizeForMatch(hourText)];
    const minute = readSpokenMinuteValue(minuteText);
    if (!hour || hour < 1 || hour > 12 || minute === null || minute > 59) {
      return match;
    }
    const period = periodText ? ` ${periodText.toUpperCase()}` : "";
    return `${hour}:${String(minute).padStart(2, "0")}${period}`;
  });
};

type TimePhraseContext = {
  lastAskedSlot?: string;
  currentTurnSemanticType?: string;
  semanticType?: string;
  currentTurnHasDatePhrase?: boolean;
};

const hasGpsTimeContext = (value?: string | null, context: TimePhraseContext = {}): boolean => {
  const normalized = normalizeForMatch(value);
  return Boolean(
    /\bat\s+g\s+p\s+s\b/.test(normalized) ||
      context.lastAskedSlot === "requestedTime" ||
      context.currentTurnSemanticType === "TIME_REQUEST" ||
      context.semanticType === "TIME_REQUEST"
  );
};

const normalizeGpsTimePhrase = (
  value?: string | null,
  context: TimePhraseContext = {}
): "3 PM" | undefined => {
  const normalized = normalizeForMatch(value);
  if (!normalized || !hasGpsTimeContext(value, context)) {
    return undefined;
  }
  if (/\bat\s+g\s+p\s+s\b/.test(normalized)) {
    return "3 PM";
  }
  return /^(?:g\s+p\s+s)$/.test(normalized) ? "3 PM" : undefined;
};

const hasRequestedTimeContext = (context: TimePhraseContext = {}): boolean =>
  context.lastAskedSlot === "requestedTime" ||
  context.currentTurnSemanticType === "TIME_REQUEST" ||
  context.semanticType === "TIME_REQUEST";

const normalizeBareRequestedTimeAnswer = (value?: string | null): string => {
  const normalized = normalizeSpokenNumbers(normalizeHourMinuteTimeExpression(value ?? ""))
    .replace(/\b([ap])\s*\.?\s*m\.?\b/gi, "$1m")
    .trim()
    .toLowerCase();
  return normalizeForMatch(normalized)
    .replace(/\b(\d{1,2})\s+([0-5]\d)\b/g, "$1:$2")
    .replace(/^(?:and\s+)?(?:it\s+is|its|it's)\s+/, "")
    .trim();
};

const isBareRequestedTimeAnswer = (
  value?: string | null,
  context: TimePhraseContext = {}
): boolean => {
  if (!hasRequestedTimeContext(context)) {
    return false;
  }
  const normalized = normalizeBareRequestedTimeAnswer(value);
  return /^([1-9]|1[0-2])(?::[0-5]\d)?$/.test(normalized);
};

const getActiveVoiceSlot = (attributes?: Record<string, unknown>): string => {
  const lastAskedSlot = readStringAttribute(attributes, ["lastAskedSlot"]);
  if (lastAskedSlot) {
    return lastAskedSlot;
  }
  const activeDtmfMenu = readStringAttribute(attributes, ["activeDtmfMenu"]);
  if (activeDtmfMenu === "service") {
    return "serviceName";
  }
  if (activeDtmfMenu === "staff") {
    return "staffPreference";
  }
  return "";
};

const hasExplicitSlotCorrectionPhrase = (value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  return Boolean(
    normalized &&
      (/\b(?:actually|change|update|switch|move|make\s+it|instead|rather)\b/.test(normalized) ||
        new RegExp(
          `\\bnot\\s+(?:a\\s+|the\\s+)?(?:${SPOKEN_HOUR_PATTERN}|\\d{1,2})(?::\\d{2})?(?:\\s*(?:am|pm|a\\s*m|p\\s*m))?\\b`,
          "i"
        ).test(normalized))
  );
};

const timeCandidateIsNegated = (
  text?: string | null,
  candidate?: string | null,
  context: TimePhraseContext = {}
): boolean => {
  if (!candidate?.trim()) {
    return false;
  }
  const proposedMinutes = timeCandidateToMinutes(candidate, {
    ...context,
    lastAskedSlot: "requestedTime"
  });
  if (proposedMinutes === null) {
    return false;
  }
  const normalized = normalizeForMatch(text);
  const negatedMatches = Array.from(
    normalized.matchAll(
      new RegExp(
        `\\bnot\\s+(?:a\\s+|the\\s+)?((?:${SPOKEN_HOUR_PATTERN}|\\d{1,2})(?::\\d{2})?(?:\\s*(?:am|pm|a\\s*m|p\\s*m|o\\s+clock|oclock))?)\\b`,
        "gi"
      )
    )
  );
  return negatedMatches.some((match) => {
    const negatedMinutes = timeCandidateToMinutes(match[1], {
      ...context,
      lastAskedSlot: "requestedTime"
    });
    return negatedMinutes !== null && negatedMinutes === proposedMinutes;
  });
};

const isBareOrAmbiguousTimeMutation = (
  text?: string | null,
  context: TimePhraseContext = {}
): boolean => {
  const normalized = normalizeForMatch(text);
  if (!normalized) {
    return false;
  }
  if (/\b(?:am|pm|a\s*m|p\s*m|o\s+clock|oclock)\b/.test(normalized)) {
    return false;
  }
  if (context.currentTurnHasDatePhrase || hasGroundedDatePhrase(text)) {
    return false;
  }
  return new RegExp(
    `\\b(?:at\\s+)?(?:${SPOKEN_HOUR_PATTERN}|\\d{1,2})(?::\\d{2})?\\b`,
    "i"
  ).test(normalized);
};

const canUseMarkedBareTimeCandidate = (
  value?: string | null,
  context: TimePhraseContext = {}
): boolean => {
  if (hasRequestedTimeContext(context)) {
    return true;
  }
  if (context.currentTurnHasDatePhrase || hasGroundedDatePhrase(value)) {
    return true;
  }
  if (hasExplicitSlotCorrectionPhrase(value)) {
    return true;
  }
  return !context.lastAskedSlot || context.lastAskedSlot === "requestedTime";
};

const localTimesEquivalent = (left?: string, right?: string): boolean => {
  const leftParsed = left ? parseLocalTimeText(left) : null;
  const rightParsed = right ? parseLocalTimeText(right) : null;
  return Boolean(
    leftParsed &&
    rightParsed &&
    !leftParsed.ambiguous &&
    !rightParsed.ambiguous &&
    leftParsed.hour === rightParsed.hour &&
    leftParsed.minute === rightParsed.minute
  );
};

const valuesEquivalentForSlot = (
  slotName: string,
  left?: string | null,
  right?: string | null
): boolean => {
  if (!left?.trim() || !right?.trim()) {
    return false;
  }
  if (slotName === "requestedTime") {
    return localTimesEquivalent(left, right);
  }
  if (slotName === "serviceName") {
    return normalizeForMatch(getCustomerFacingServiceName(left) ?? left) ===
      normalizeForMatch(getCustomerFacingServiceName(right) ?? right);
  }
  return normalizeForMatch(left) === normalizeForMatch(right);
};

const isClearlyStructuredBookingRequest = (
  value?: string | null,
  attributes?: Record<string, unknown>
): boolean => {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return false;
  }
  if (
    !/\b(?:book|booking|schedule|appointment|service|nail|nails|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|with|at|am|pm|full\s*set|any\s+staff|first\s+available)\b/.test(
      normalized
    )
  ) {
    return false;
  }
  const staffContext = staffPhraseContextFromAttributes(attributes);
  const hasService = Boolean(recognizeFullSetFromText(value, staffContext) || hasStaticServiceAliasInText(value));
  const hasDate = hasGroundedDatePhrase(value);
  const hasTime = hasGroundedTimePhrase(value, {
    lastAskedSlot: readStringAttribute(attributes, ["lastAskedSlot"]),
    currentTurnHasDatePhrase: hasGroundedDatePhrase(value)
  });
  const hasStaff = Boolean(normalizeAnyStaffPhrase(value, staffContext)) || /\bwith\s+[a-z][a-z'-]*\b/.test(normalized);
  return hasService && hasDate && hasTime && hasStaff;
};

const isBookingLikeUtterance = (value?: string | null): boolean =>
  /\b(?:book|booking|schedule|appointment|service|nail|nails|pedicure|manicure|full\s*set|today|tomorrow|any\s+staff|first\s+available|at|am|pm)\b/i.test(
    normalizeForMatch(value)
  );

const buildVoiceSlotMutationPolicy = (input: {
  slotName: string;
  proposedValue?: string;
  trustedValue?: string;
  transcript?: string;
  attributes?: Record<string, unknown>;
}): {
  slotName: string;
  activeSlot: string;
  previousValue?: string;
  proposedValue?: string;
  accepted: boolean;
  reason: string;
} => {
  const proposedValue = input.proposedValue?.trim();
  const trustedValue = input.trustedValue?.trim();
  const activeSlot = getActiveVoiceSlot(input.attributes);
  const base = {
    slotName: input.slotName,
    activeSlot,
    previousValue: trustedValue,
    proposedValue
  };
  if (!proposedValue) {
    return { ...base, accepted: false, reason: "empty_proposed_value" };
  }
  if (trustedValue && valuesEquivalentForSlot(input.slotName, trustedValue, proposedValue)) {
    return { ...base, accepted: true, reason: "same_as_trusted_value" };
  }
  const transcript = input.transcript ?? "";
  const timeContext: TimePhraseContext = {
    lastAskedSlot: readStringAttribute(input.attributes, ["lastAskedSlot"]),
    currentTurnSemanticType: readStringAttribute(input.attributes, ["currentTurnSemanticType"]),
    currentTurnHasDatePhrase: hasGroundedDatePhrase(transcript)
  };
  const negatesProposed =
    input.slotName === "requestedTime" && timeCandidateIsNegated(transcript, proposedValue, timeContext);
  if (activeSlot === input.slotName) {
    return { ...base, accepted: true, reason: "active_slot" };
  }
  if (hasExplicitSlotCorrectionPhrase(transcript) && !negatesProposed) {
    return { ...base, accepted: true, reason: "explicit_correction" };
  }
  if (isClearlyStructuredBookingRequest(transcript, input.attributes)) {
    return { ...base, accepted: true, reason: "structured_booking_request" };
  }
  if (!trustedValue && input.slotName === "requestedTime" && !isBareOrAmbiguousTimeMutation(transcript, timeContext)) {
    return { ...base, accepted: true, reason: "new_grounded_time" };
  }
  return {
    ...base,
    accepted: false,
    reason: negatesProposed
      ? "caller_rejected_proposed_value"
      : trustedValue
        ? "protected_trusted_slot"
        : "bare_or_ambiguous_wrong_slot"
  };
};

const buildVoiceSlotDecision = (input: {
  slot: VoiceSlotDecision["slot"];
  action: VoiceSlotDecision["action"];
  canonicalValue?: string;
  entityId?: string;
  reason?: string;
  confidenceBand?: VoiceSlotDecision["confidenceBand"];
  evidence?: Array<string | null | undefined>;
  source?: VoiceSlotDecision["source"];
  activeSlot?: string;
  negated?: boolean;
  requiresConfirmation?: boolean;
  alternativesUsed?: boolean;
}): VoiceSlotDecision => ({
  slot: input.slot,
  action: input.action,
  ...(input.canonicalValue ? { canonicalValue: input.canonicalValue } : {}),
  ...(input.entityId ? { entityId: input.entityId } : {}),
  reason: input.reason ?? "unspecified",
  confidenceBand: input.confidenceBand ?? "medium",
  evidence: (input.evidence ?? [])
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item))
    .slice(0, 5),
  source: input.source ?? "contextual_repair",
  activeSlot: input.activeSlot ?? "",
  negated: Boolean(input.negated),
  requiresConfirmation:
    input.requiresConfirmation === undefined ? input.action === "propose" : Boolean(input.requiresConfirmation),
  alternativesUsed: Boolean(input.alternativesUsed)
});

const confidenceBandForMutationDecision = (decision: {
  accepted: boolean;
  reason: string;
}): VoiceSlotDecision["confidenceBand"] => {
  if (decision.reason === "bare_or_ambiguous_wrong_slot") {
    return "low";
  }
  if (decision.accepted || decision.reason === "caller_rejected_proposed_value") {
    return "high";
  }
  return "medium";
};

const mutationPolicyToVoiceSlotDecision = (
  decision: ReturnType<typeof buildVoiceSlotMutationPolicy>,
  evidence: Array<string | null | undefined> = [],
  alternativesUsed = false
): VoiceSlotDecision =>
  buildVoiceSlotDecision({
    slot: decision.slotName as VoiceSlotDecision["slot"],
    action: decision.accepted ? "accept" : "reject",
    canonicalValue: decision.accepted ? decision.proposedValue : undefined,
    reason: decision.reason,
    confidenceBand: confidenceBandForMutationDecision(decision),
    evidence: [
      ...evidence,
      decision.proposedValue ? `proposed=${decision.proposedValue}` : undefined,
      decision.previousValue ? `previous=${decision.previousValue}` : undefined
    ],
    source: decision.accepted ? "transcript" : "contextual_repair",
    activeSlot: decision.activeSlot ?? "",
    negated: decision.reason === "caller_rejected_proposed_value",
    requiresConfirmation: false,
    alternativesUsed
  });

const parseVoiceSlotDecisions = (value: unknown): VoiceSlotDecision[] => {
  const raw = typeof value === "string" ? value.trim() : value;
  if (!raw) {
    return [];
  }
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is VoiceSlotDecision =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof (item as VoiceSlotDecision).slot === "string" &&
            typeof (item as VoiceSlotDecision).action === "string"
        )
      : [];
  } catch {
    return [];
  }
};

const withVoiceSlotDecision = (
  attributes: Record<string, unknown> | undefined,
  decision: VoiceSlotDecision
): string =>
  JSON.stringify([
    ...parseVoiceSlotDecisions(attributes?.voiceSlotDecisions),
    decision
  ].slice(-8));

const parseLocalTimeText = (
  value: string,
  context: TimePhraseContext = {}
): { hour: number; minute: number; ambiguous: boolean } | null => {
  const gpsTime = normalizeGpsTimePhrase(value, context);
  if (gpsTime) {
    return {
      hour: 15,
      minute: 0,
      ambiguous: false
    };
  }
  const normalized = normalizeSpokenNumbers(normalizeHourMinuteTimeExpression(value))
    .replace(/\b([ap])\s*\.?\s*m\.?\b/gi, "$1m")
    .replace(/\ba\.?m\.?\b/gi, "am")
    .replace(/\bp\.?m\.?\b/gi, "pm")
    .trim();
  const normalizedWords = normalizeForMatch(normalized);
  const hasMorningContext = /\bmorning\b/.test(normalizedWords);
  const hasAtHourCue = /^at\s+\d{1,2}(?::\d{2})?/.test(normalizedWords);
  const hasOclockCue = /\b(?:o\s+clock|oclock)\b/.test(normalizedWords);
  const requestedTimeAnswer = isBareRequestedTimeAnswer(value, context);

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
    if (requestedTimeAnswer && hour >= 1 && hour <= 12) {
      if (hasMorningContext) {
        return { hour: hour === 12 ? 0 : hour, minute, ambiguous: false };
      }
      return { hour: hour >= 1 && hour <= 7 ? hour + 12 : hour, minute, ambiguous: false };
    }
    return { hour, minute, ambiguous: false };
  }

  const applyContext = (hour: number): { hour: number; ambiguous: boolean } => {
    if (hasMorningContext) {
      return { hour: hour === 12 ? 0 : hour, ambiguous: false };
    }
    if (hasAtHourCue || hasOclockCue || requestedTimeAnswer) {
      return { hour: hour >= 1 && hour <= 7 ? hour + 12 : hour, ambiguous: false };
    }
    return { hour, ambiguous: true };
  };

  const bareHourMatch = normalized.match(/^(?:at\s+)?(\d{1,2})(?::(\d{2}))?(?:\s*(?:o\s*'?clock|oclock))?$/i);
  if (bareHourMatch) {
    const hour = Number(bareHourMatch[1]);
    const minute = Number(bareHourMatch[2] ?? 0);
    if (minute > 59) {
      return null;
    }
    if (hour >= 1 && hour <= 12) {
      const contextual = applyContext(hour);
      return { hour: contextual.hour, minute, ambiguous: contextual.ambiguous };
    }
    if (hour >= 13 && hour <= 23) {
      return { hour, minute, ambiguous: false };
    }
  }

  return null;
};

const extractTimeCandidate = (value: string, context: TimePhraseContext = {}): string | undefined => {
  const gpsTime = normalizeGpsTimePhrase(value, context);
  if (gpsTime) {
    return gpsTime;
  }
  const source = normalizeHourMinuteTimeExpression(value)
    .replace(/\b([ap])\s*\.?\s*m\.?\b/gi, "$1m")
    .trim();
  const searchable = source;
  const segment = searchable
    .split(/[,.!?;]/)[0]
    ?.trim();
  if (!searchable) {
    return undefined;
  }

  const explicitMatch = searchable.match(
    new RegExp(
      `\\b(?:${SPOKEN_HOUR_PATTERN}|\\d{1,2})(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)\\b`,
      "i"
    )
  );
  if (explicitMatch?.[0]) {
    return explicitMatch[0];
  }

  const oclockMatch = searchable.match(
    new RegExp(
      `\\b((?:${SPOKEN_HOUR_PATTERN}|\\d{1,2})(?::\\d{2})?\\s*(?:o\\s*'?clock|oclock))\\b`,
      "i"
    )
  );
  if (oclockMatch?.[1]) {
    return oclockMatch[1];
  }

  if (/\b(?:and\s+)?stop\s+at\s+(?:five|5)\b/i.test(normalizeForMatch(searchable))) {
    return undefined;
  }

  const markedBareMatch = searchable.match(
    new RegExp(
      `\\bat\\s+((?:${SPOKEN_HOUR_PATTERN}|\\d{1,2})(?::\\d{2})?)\\b`,
      "i"
    )
  );
  if (markedBareMatch?.[1]) {
    if (!canUseMarkedBareTimeCandidate(searchable, context)) {
      return undefined;
    }
    return `at ${markedBareMatch[1]}`;
  }

  if (!segment) {
    return undefined;
  }

  return isBareRequestedTimeAnswer(segment, context) ? normalizeBareRequestedTimeAnswer(segment) : undefined;
};

const getPreferredDateCandidate = (
  raw: string
): { text: string; index: number; kind: "explicit" | "relative" } | null => {
  const collect = (
    pattern: string,
    kind: "explicit" | "relative"
  ): { text: string; index: number; kind: "explicit" | "relative" }[] =>
    Array.from(raw.matchAll(new RegExp(pattern, "gi")))
      .filter((match) => match[0] && match.index !== undefined)
      .map((match) => ({
        text: match[0],
        index: match.index!,
        kind
      }));

  const relativeMatches = collect(DATE_PHRASE_PATTERN, "relative").sort(
    (left, right) => left.index - right.index
  );
  const strongRelative = relativeMatches.find((candidate) => {
    const relative = getRelativeWeekdayPhraseCandidate(candidate.text);
    return relative && relative.mode !== "bare";
  });
  if (strongRelative) {
    return strongRelative;
  }
  const explicitMatches = [
    ...collect(ISO_DATE_PATTERN, "explicit"),
    ...collect(MONTH_DAY_PATTERN, "explicit")
  ].sort((left, right) => left.index - right.index);
  if (explicitMatches.length) {
    return explicitMatches[explicitMatches.length - 1] ?? null;
  }
  return relativeMatches[0] ?? null;
};

const hasGroundedDatePhrase = (value?: string | null): boolean =>
  Boolean(value?.trim() && getPreferredDateCandidate(value));

const hasGroundedTimePhrase = (
  value?: string | null,
  context: TimePhraseContext = {}
): boolean => {
  if (!value?.trim()) {
    return false;
  }
  const timeCandidate = extractTimeCandidate(value, context);
  if (isDigitOnlyOrSequenceUtterance(value) && !timeCandidate) {
    return false;
  }
  const parsed = timeCandidate ? parseLocalTimeText(timeCandidate, context) : null;
  return Boolean(parsed && !parsed.ambiguous);
};

const extractExplicitDate = (value: string | undefined, timezone: string): string | undefined => {
  if (!value?.trim()) {
    return undefined;
  }
  const dateCandidate = getPreferredDateCandidate(value);
  if (!dateCandidate) {
    return undefined;
  }
  const parsed = parseLocalDateText(dateCandidate.text, timezone);
  return parsed?.isValid ? parsed.toFormat("yyyy-MM-dd") : undefined;
};

const extractExplicitTime = (
  value: string | undefined,
  context: TimePhraseContext = {}
): string | undefined => {
  if (!value?.trim()) {
    return undefined;
  }
  const timeCandidate = extractTimeCandidate(value, context);
  if (isDigitOnlyOrSequenceUtterance(value) && !timeCandidate) {
    return undefined;
  }
  const parsed = timeCandidate ? parseLocalTimeText(timeCandidate, context) : null;
  if (!parsed || parsed.ambiguous) {
    return undefined;
  }
  return `${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}`;
};

const normalizeRequestedDateForState = (
  value: string | undefined,
  timezone = "America/New_York"
): string | undefined => {
  if (!value?.trim()) {
    return undefined;
  }
  if (hasGroundedTimePhrase(value, { lastAskedSlot: "requestedTime" }) && !hasGroundedDatePhrase(value)) {
    return undefined;
  }
  const parsed = parseLocalDateText(value, timezone);
  return parsed?.isValid ? parsed.toFormat("yyyy-MM-dd") : undefined;
};

const timeCandidateToMinutes = (
  value?: string | null,
  context: TimePhraseContext = {}
): number | null => {
  if (!value?.trim()) {
    return null;
  }
  const parsed = parseLocalTimeText(value, context);
  return parsed && !parsed.ambiguous ? parsed.hour * 60 + parsed.minute : null;
};

const formatMinutesForTimePrompt = (totalMinutes: number): string => {
  let hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const period = hour >= 12 ? "PM" : "AM";
  hour %= 12;
  if (hour === 0) {
    hour = 12;
  }
  return minute === 0 ? `${hour} ${period}` : `${hour}:${String(minute).padStart(2, "0")} ${period}`;
};

const collectLocalTimeCandidates = (
  value?: string | null,
  context: TimePhraseContext = {}
): Array<{ text: string; minutes: number; source: string; confidence: number }> => {
  const raw = value?.trim();
  if (!raw) {
    return [];
  }
  const candidates: Array<{ key: string; text: string; minutes: number; source: string; confidence: number }> = [];
  const addCandidate = (text: string, source: string, confidence: number) => {
    const minutes = timeCandidateToMinutes(text, context);
    if (minutes === null) {
      return;
    }
    const key = String(minutes);
    if (candidates.some((candidate) => candidate.key === key)) {
      return;
    }
    candidates.push({
      key,
      text: formatMinutesForTimePrompt(minutes),
      minutes,
      source,
      confidence
    });
  };

  const normalized = normalizeForMatch(raw);
  const hasHourMinuteExpression = /\b\d{1,2}:\d{2}\b/.test(normalizeHourMinuteTimeExpression(raw));
  const hourPattern = `(?:${SPOKEN_HOUR_PATTERN}|\\d{1,2})`;
  const noisyHourMinute = new RegExp(
    `\\b(${hourPattern})\\s+(${hourPattern})\\s+(${SPOKEN_MINUTE_PATTERN}|\\d{1,2})\\s*(a\\s*m|p\\s*m|am|pm)\\b`,
    "i"
  );
  const noisyMatch = normalized.match(noisyHourMinute);
  if (noisyMatch) {
    addCandidate(`${noisyMatch[1]} ${String(noisyMatch[4]).replace(/\s+/g, "")}`, "noisy_leading_hour", 0.7);
    addCandidate(`${noisyMatch[2]} ${noisyMatch[3]} ${String(noisyMatch[4]).replace(/\s+/g, "")}`, "noisy_hour_minute", 0.55);
  }

  const timeCollectionContext =
    context.lastAskedSlot === "requestedTime" ||
    context.currentTurnSemanticType === "TIME_REQUEST" ||
    /\b(?:at|o\s*clock|o'clock|oclock)\b/.test(normalized);
  if (
    timeCollectionContext &&
    !/\b(?:a\s*m|p\s*m|am|pm)\b/.test(normalized) &&
    !/\b\d{1,2}\s*:\s*\d{2}\b/.test(normalized) &&
    !hasHourMinuteExpression
  ) {
    const bareHourMatch = normalized.match(
      new RegExp(`\\b(?:at\\s+)?(${hourPattern})(?:\\s+(?:o\\s*clock|o'clock|oclock))?\\b`, "i")
    );
    if (bareHourMatch) {
      addCandidate(bareHourMatch[1], "time_context_bare_hour", 0.88);
    }
  }

  const extracted = extractTimeCandidate(raw, context);
  if (extracted) {
    addCandidate(extracted, "extract_time_candidate", noisyMatch ? 0.55 : 0.9);
  }

  return candidates
    .sort((left, right) => right.confidence - left.confidence)
    .map(({ key: _key, ...candidate }) => candidate);
};

const analyzeTimeRecognition = (input: {
  rawTranscript?: string | null;
  lexSlotValue?: string | null;
  context?: TimePhraseContext;
}): {
  rawTranscript: string;
  lexSlotValue: string;
  candidates: Array<{ text: string; minutes: number; source: string; confidence: number }>;
  selectedCandidate?: { text: string; minutes: number; source: string };
  requiresConfirmation: boolean;
  rejectionReason?: string;
  finalNormalizedLocalTime?: string;
} => {
  const context = input.context ?? {};
  const transcriptCandidates = collectLocalTimeCandidates(input.rawTranscript, context);
  const slotCandidates = collectLocalTimeCandidates(input.lexSlotValue, {
    ...context,
    lastAskedSlot: context.lastAskedSlot ?? "requestedTime"
  });
  const byMinute = new Map<number, { text: string; minutes: number; source: string; confidence: number }>();
  const transcriptMinuteSet = new Set(transcriptCandidates.map((candidate) => candidate.minutes));
  for (const candidate of transcriptCandidates) {
    const existing = byMinute.get(candidate.minutes);
    if (!existing || candidate.confidence > existing.confidence) {
      byMinute.set(candidate.minutes, candidate);
    }
  }
  for (const candidate of slotCandidates) {
    const existing = byMinute.get(candidate.minutes);
    if (existing && transcriptMinuteSet.has(candidate.minutes)) {
      continue;
    }
    if (!existing || candidate.confidence > existing.confidence) {
      byMinute.set(candidate.minutes, candidate);
    }
  }
  const candidates = Array.from(byMinute.values()).sort((left, right) => right.confidence - left.confidence);
  const selectedCandidate = candidates[0]
    ? {
        text: candidates[0].text,
        minutes: candidates[0].minutes,
        source: candidates[0].source
      }
    : undefined;
  const lexMinutes = timeCandidateToMinutes(input.lexSlotValue, {
    ...context,
    lastAskedSlot: context.lastAskedSlot ?? "requestedTime"
  });
  const hasAmbiguousTranscriptEvidence = transcriptCandidates.length > 1;
  const lexConflictsWithTranscript =
    lexMinutes !== null &&
    transcriptCandidates.length > 0 &&
    !transcriptCandidates.some((candidate) => candidate.minutes === lexMinutes);
  const noisyMultipleTimeEvidence =
    /\b(?:uh|um|ah)\b/.test(normalizeForMatch(input.rawTranscript)) && hasAmbiguousTranscriptEvidence;
  const requiresConfirmation = Boolean(
    selectedCandidate &&
      (hasAmbiguousTranscriptEvidence ||
        noisyMultipleTimeEvidence ||
        (lexConflictsWithTranscript && transcriptCandidates.length !== 1))
  );
  return {
    rawTranscript: input.rawTranscript?.trim() ?? "",
    lexSlotValue: input.lexSlotValue?.trim() ?? "",
    candidates,
    selectedCandidate,
    requiresConfirmation,
    rejectionReason: hasAmbiguousTranscriptEvidence
      ? "multiple_time_candidates"
      : lexConflictsWithTranscript
        ? "lex_slot_conflicts_with_transcript"
        : noisyMultipleTimeEvidence
          ? "noisy_time_transcript"
          : undefined,
    finalNormalizedLocalTime: selectedCandidate ? formatMinutesForTimePrompt(selectedCandidate.minutes) : undefined
  };
};

const rejectsMentionedDate = (value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  return /\b(?:not\s+on|no|not)\s+(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(
    normalized
  );
};

const parseDateTimeText = (
  text: string,
  timezone: string,
  context: TimePhraseContext = {}
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

  const dateCandidate = getPreferredDateCandidate(raw);
  if (dateCandidate) {
    const localDate = parseLocalDateText(dateCandidate.text, timezone);
    const afterDate = raw.slice(dateCandidate.index + dateCandidate.text.length);
    const beforeDate = raw.slice(0, dateCandidate.index);
    const timeContext = {
      ...context,
      currentTurnHasDatePhrase: true
    };
    const timeCandidate =
      extractTimeCandidate(afterDate, timeContext) ??
      extractTimeCandidate(beforeDate.split(/[!?;]/).at(-1) ?? "", timeContext) ??
      extractTimeCandidate(raw, timeContext);
    const localTime = timeCandidate ? parseLocalTimeText(timeCandidate, timeContext) : null;

    if (localDate && localTime) {
      return {
        local: localDate.set({
          hour: localTime.hour,
          minute: localTime.minute,
          second: 0,
          millisecond: 0
        }),
        sourceText: [dateCandidate.text, timeCandidate].join(" "),
        ambiguousTime: localTime.ambiguous
      };
    }
  }

  const explicitLocalMatch = raw.match(
    new RegExp(
      `(\\d{4}-\\d{2}-\\d{2}|[01]?\\d\\/[0-3]?\\d\\/\\d{4}|${DATE_PHRASE_PATTERN})(?:\\s+|.*?\\s+at\\s+)([a-z0-9:.\\s]+?(?:am|pm)?)(?:$|[,.])`,
      "i"
    )
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

const hasUsableStartTime = (value: string | undefined, timezone: string): boolean => {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return false;
  }
  const iso = DateTime.fromISO(value.trim(), { setZone: true });
  if (iso.isValid && /T\d{1,2}:\d{2}/.test(value)) {
    return true;
  }
  const parsed = parseDateTimeText(value, timezone);
  return Boolean(parsed?.local.isValid && !parsed.ambiguousTime);
};

const isClearlyInvalidServiceName = (value?: string | null, timezone = "America/New_York"): boolean => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return false;
  }

  const normalized = normalizeForMatch(trimmed);
  const digits = trimmed.replace(/\D/g, "");
  if (isInvalidServicePlaceholder(trimmed)) {
    return true;
  }
  if (/^(?:am|pm|a m|p m)$/.test(normalized)) {
    return true;
  }
  if (isAffirmative(normalized) || isNegative(normalized)) {
    return true;
  }
  if (digits.length >= 7) {
    return true;
  }
  if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(trimmed)) {
    return true;
  }
  if (
    new RegExp(
      `^(?:at\\s+)?(?:${SPOKEN_HOUR_PATTERN}|\\d{1,2})(?::\\d{2})?(?:\\s*(?:am|pm|a\\s*m|p\\s*m))?$`,
      "i"
    ).test(normalized)
  ) {
    return true;
  }
  if (parseLocalTimeText(trimmed)) {
    return true;
  }
  if (
    new RegExp(`^(?:${DATE_PHRASE_PATTERN}|${MONTH_DAY_PATTERN}|${ISO_DATE_PATTERN})$`, "i").test(
      trimmed
    )
  ) {
    return true;
  }
  if (parseLocalDateText(trimmed, timezone) && normalized.split(" ").length <= 4) {
    return true;
  }

  return false;
};

const applyDeterministicTextRecovery = (input: {
  intent: BookingIntentResult;
  text: string;
  timezone: string;
  serviceNames: string[];
}): BookingIntentResult => {
  const next: BookingIntentResult = {
    ...input.intent,
    customer: {
      ...input.intent.customer
    },
    normalizedBookingRequest: {
      ...input.intent.normalizedBookingRequest
    }
  };

  const recoveredStartTimeIso = parseDateTimeFromText(input.text, input.timezone);
  if (
    recoveredStartTimeIso &&
    !hasUsableStartTime(next.normalizedBookingRequest.startTimeIso ?? next.requestedDateTime, input.timezone)
  ) {
    next.requestedDateTime = recoveredStartTimeIso;
    next.normalizedBookingRequest.startTimeIso = recoveredStartTimeIso;
    next.normalizedBookingRequest.timezone = input.timezone;
  }

  const recoveredService = findConfiguredServiceNameInText(input.serviceNames, input.text);
  if (recoveredService) {
    next.requestedService = recoveredService;
    next.normalizedBookingRequest.serviceName = recoveredService;
  }

  const serviceValue = next.normalizedBookingRequest.serviceName ?? next.requestedService;
  if (isClearlyInvalidServiceName(serviceValue, input.timezone)) {
    next.requestedService = undefined;
    next.normalizedBookingRequest.serviceName = undefined;
  }

  return next;
};

const inferFallbackIntent = (input: {
  text: string;
  timezone: string;
  serviceNames: string[];
  staffNames: string[];
}): BookingIntentResult => {
  const lower = input.text.toLowerCase();
  const matchedService = findConfiguredServiceNameInText(input.serviceNames, input.text);
  const matchedStaff = input.staffNames.find((staff) => lower.includes(staff.toLowerCase()));

  const phone = extractCustomerPhoneFromText(input.text);
  const customerName = extractCustomerNameFromText(input.text);
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
      isOperatorZeroRequest(input.text) ||
      lower.includes("live person") ||
      lower.includes("real person") ||
      lower.includes("operator") ||
      lower.includes("representative") ||
      lower.includes("agent") ||
      lower.includes("talk to a person") ||
      lower.includes("speak to someone")
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
    } else if (staffResolution.status === "explicit_any") {
      requestedStaff = "Any staff";
      nextNormalizedRequest.staffName = "Any staff";
    } else {
      requestedStaff = undefined;
      nextNormalizedRequest.staffName = undefined;
    }
  }

  const serviceValue = [nextNormalizedRequest.serviceName, intent.requestedService].find(
    (candidate) => candidate && !isClearlyInvalidServiceName(candidate)
  );
  let requestedService = intent.requestedService;
  if (serviceValue) {
    const serviceMatch = await resolveServiceMatch(salonId, serviceValue);
    if (serviceMatch && (serviceMatch.exact || serviceMatch.matchedBy === "alias")) {
      requestedService = getCustomerFacingServiceName(serviceMatch.service.name);
      nextNormalizedRequest.serviceName = requestedService;
    }
  } else if (nextNormalizedRequest.serviceName || intent.requestedService) {
    requestedService = undefined;
    nextNormalizedRequest.serviceName = undefined;
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

type CreateAIInteractionLogInput = {
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
  confidence?: number | null;
  interactionKey?: string;
  isSynthetic?: boolean;
};

const createAIInteractionLog = async (input: CreateAIInteractionLogInput) => {
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
      interactionKey: input.interactionKey,
      isSynthetic: input.isSynthetic ?? false,
      callSessionId: input.callSessionId,
      transcriptId: input.transcriptId,
      bookingAttemptId: input.bookingAttemptId,
      createdByUserId: input.actorUserId
    }
  });
};

const recordFromUnknown = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const arrayFromUnknown = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const AMAZON_CONNECT_BOOKING_TASK = "amazon_connect_booking_fulfillment";

const stableHash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const readStringValue = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

const validateSsmlForDiagnostics = (
  contentType: string,
  content: unknown
): { valid: boolean; reason: string } => {
  if (contentType !== "SSML") {
    return { valid: true, reason: "not_ssml" };
  }
  const trimmed = readStringValue(content);
  if (!trimmed) {
    return { valid: false, reason: "empty_ssml" };
  }
  if (!/^<speak(?:\s|>)/i.test(trimmed) || !/<\/speak>\s*$/i.test(trimmed)) {
    return { valid: false, reason: "missing_speak_root" };
  }
  const stack: string[] = [];
  const tagPattern = /<\/?([a-zA-Z][\w:-]*)(?:\s[^>]*)?>/g;
  for (const match of trimmed.matchAll(tagPattern)) {
    const fullTag = match[0];
    const tagName = match[1]!.toLowerCase();
    if (/\/>$/.test(fullTag)) {
      continue;
    }
    if (fullTag.startsWith("</")) {
      if (stack.pop() !== tagName) {
        return { valid: false, reason: "mismatched_tag" };
      }
      continue;
    }
    stack.push(tagName);
  }
  return { valid: stack.length === 0, reason: stack.length === 0 ? "ok" : "unclosed_tag" };
};

const inferLexMessageContentType = (message: string, lexResponse: Record<string, unknown>): string =>
  readStringValue(lexResponse.messageContentType) || (message.trim().startsWith("<speak>") ? "SSML" : "PlainText");

const readAmazonConnectContactIdFromRequestPayload = (requestPayload: unknown): string => {
  const payload = recordFromUnknown(requestPayload);
  const attributes = recordFromUnknown(payload.attributes);
  return (
    readStringValue(payload.amazonConnectContactId) ||
    readStringValue(payload.contactId) ||
    readStringValue(attributes.AmazonConnectContactId) ||
    readStringValue(attributes.contactId) ||
    readStringValue(attributes.ContactId)
  );
};

const isSyntheticAmazonConnectIdentity = (value?: string | null): boolean =>
  Boolean(value && /^codex-/i.test(value.trim()));

const buildAmazonConnectInteractionKey = (input: CreateAIInteractionLogInput): string | undefined => {
  if (
    input.provider !== ExternalProvider.AMAZON_CONNECT ||
    input.taskType !== AMAZON_CONNECT_BOOKING_TASK
  ) {
    return undefined;
  }
  const identity = input.callSessionId || readAmazonConnectContactIdFromRequestPayload(input.requestPayload);
  return identity ? `AMAZON_CONNECT:${AMAZON_CONNECT_BOOKING_TASK}:${identity}` : undefined;
};

const readSessionAttributeRecord = (value: unknown): Record<string, unknown> => recordFromUnknown(value);

const parseDtmfOptionsForHistory = (value: unknown): Record<string, string> => {
  if (typeof value !== "string" || !value.trim()) {
    return {};
  }
  return parseJsonStringRecord(value);
};

const buildAmazonConnectTurnHistoryItem = (input: {
  index: number;
  createdAt: string;
  interactionInput: CreateAIInteractionLogInput;
  interactionKey: string;
}) => {
  const requestPayload = recordFromUnknown(input.interactionInput.requestPayload);
  const responsePayload = recordFromUnknown(input.interactionInput.responsePayload);
  const requestAttributes = recordFromUnknown(requestPayload.attributes);
  const responseDebug = recordFromUnknown(responsePayload.lexTurnDebug);
  const sanitization = recordFromUnknown(responseDebug.sanitization);
  const turnDiagnostics = recordFromUnknown(responsePayload.turnStateDiagnostics);
  const sessionAttributesBefore = readSessionAttributeRecord(
    responseDebug.sessionAttributesBefore ?? responseDebug.attributesBefore
  );
  const sessionAttributesAfter = readSessionAttributeRecord(
    responseDebug.sessionAttributesAfter ??
      responseDebug.attributesAfter ??
      responsePayload.sessionAttributes ??
      recordFromUnknown(recordFromUnknown(responsePayload.lexResponse).sessionAttributes)
  );
  const activeDtmfOptionsBefore =
    responseDebug.activeDtmfOptionsBefore ??
    parseDtmfOptionsForHistory(sessionAttributesBefore.activeDtmfOptionsJson);
  const activeDtmfOptionsAfter =
    responseDebug.activeDtmfOptionsAfter ??
    parseDtmfOptionsForHistory(sessionAttributesAfter.activeDtmfOptionsJson);
  const slotToElicit =
    responseDebug.slotToElicit ??
    responsePayload.slotToElicit ??
    recordFromUnknown(recordFromUnknown(responsePayload.lexResponse).dialogAction).slotToElicit;

  const turn = {
    index: input.index,
    createdAt: input.createdAt,
    humanTurnId:
      readStringValue(requestAttributes.humanTurnId) ||
      readStringValue(turnDiagnostics.humanTurnId) ||
      readStringValue(responseDebug.humanTurnId) ||
      null,
    providerTurnId:
      readStringValue(requestAttributes.providerTurnId) ||
      readStringValue(turnDiagnostics.providerTurnId) ||
      readStringValue(responseDebug.providerTurnId) ||
      null,
    physicalSpeechTurnId:
      readStringValue(requestAttributes.physicalSpeechTurnId) ||
      readStringValue(turnDiagnostics.physicalSpeechTurnId) ||
      null,
    speechSegmentId:
      readStringValue(requestAttributes.speechSegmentId) ||
      readStringValue(turnDiagnostics.speechSegmentId) ||
      null,
    providerSequence:
      readStringValue(requestAttributes.providerSequence) ||
      readStringValue(turnDiagnostics.providerSequence) ||
      null,
    segmentStartedAt:
      readStringValue(requestAttributes.segmentStartedAt) ||
      readStringValue(turnDiagnostics.segmentStartedAt) ||
      null,
    segmentEndedAt:
      readStringValue(requestAttributes.segmentEndedAt) ||
      readStringValue(turnDiagnostics.segmentEndedAt) ||
      null,
    providerRequestId:
      readStringValue(requestAttributes.providerRequestId) ||
      readStringValue(turnDiagnostics.providerRequestId) ||
      null,
    lexRequestId:
      readStringValue(requestAttributes.lexRequestId) ||
      readStringValue(turnDiagnostics.lexRequestId) ||
      null,
	    lexPhase:
	      readStringValue(requestAttributes.lexPhase) ||
	      readStringValue(turnDiagnostics.lexPhase) ||
	      readStringValue(requestPayload.invocationSource) ||
	      null,
    transcriptFingerprint:
      readStringValue(requestAttributes.transcriptFingerprint) ||
      readStringValue(turnDiagnostics.transcriptFingerprint) ||
      null,
    duplicateDisposition:
      readStringValue(turnDiagnostics.duplicateDisposition) ||
      readStringValue(requestAttributes.duplicateDisposition) ||
      null,
    currentTurnTranscript:
      responsePayload.currentTurnTranscript ??
      responseDebug.currentTurnTranscript ??
      requestPayload.currentTurnTranscript ??
      requestPayload.text ??
      null,
    aggregatedBookingTranscript:
      responsePayload.aggregatedBookingTranscript ??
      requestPayload.aggregatedBookingTranscript ??
      requestPayload.transcript ??
      input.interactionInput.requestText ??
      null,
    responseText: input.interactionInput.responseText ?? null,
    intentName: requestPayload.intentName ?? responseDebug.intentName ?? null,
    inputMode: responseDebug.inputMode ?? requestPayload.inputMode ?? null,
    lastAskedSlotBefore:
      responseDebug.lastAskedSlotBefore ?? sessionAttributesBefore.lastAskedSlot ?? requestAttributes.lastAskedSlot ?? null,
    lastAskedSlotAfter:
      responseDebug.lastAskedSlotAfter ?? sessionAttributesAfter.lastAskedSlot ?? null,
    activeDtmfMenuBefore:
      responseDebug.activeDtmfMenuBefore ?? sessionAttributesBefore.activeDtmfMenu ?? null,
    activeDtmfMenuAfter:
      responseDebug.activeDtmfMenuAfter ?? sessionAttributesAfter.activeDtmfMenu ?? null,
    activeDtmfOptionsBefore,
    activeDtmfOptionsAfter,
    dtmfRouting: responseDebug.dtmfRouting ?? null,
    trustedSlotsBefore: responseDebug.trustedSlotsBefore ?? null,
    trustedSlotsAfter:
      responseDebug.trustedSlotsAfter ?? {
        customerName: sessionAttributesAfter.customerName,
        customerPhone: sessionAttributesAfter.customerPhone,
        serviceName: sessionAttributesAfter.serviceName,
        confirmedServiceName: sessionAttributesAfter.confirmedServiceName,
        requestedDate: sessionAttributesAfter.requestedDate,
        requestedTime: sessionAttributesAfter.requestedTime,
        staffPreference: sessionAttributesAfter.staffPreference,
        confirmedStaffName: sessionAttributesAfter.confirmedStaffName,
        staffId: sessionAttributesAfter.staffId,
        selectedStaffId: sessionAttributesAfter.selectedStaffId
      },
    sessionAttributesBefore,
    sessionAttributesAfter,
    slotsOriginalValues: responseDebug.slotsOriginalValues ?? null,
    slotsInterpretedValues: responseDebug.slotsInterpretedValues ?? null,
    ignoredUngroundedSlots:
      sanitization.ignoredUngroundedSlots ?? responsePayload.ignoredUngroundedSlots ?? [],
    ignoredPollutedSlots:
      sanitization.ignoredPollutedSlots ?? responsePayload.ignoredPollutedSlots ?? [],
    ignoredNoiseFields:
      sanitization.ignoredNoiseFields ?? responsePayload.ignoredNoiseFields ?? [],
    slotToElicit: slotToElicit ?? null,
    missingFields: responsePayload.missingFields ?? null,
    promptMissingFields: responsePayload.promptMissingFields ?? null,
    errorCode: responsePayload.errorCode ?? responseDebug.errorCode ?? null,
    callerSafeResponseText:
      responsePayload.callerSafeResponseText ?? responseDebug.responseMessage ?? null,
    providerTranscriptTimestamp: turnDiagnostics.providerTranscriptTimestamp ?? null,
    lambdaReceivedAt: turnDiagnostics.lambdaReceivedAt ?? null,
    apiStartedAt: turnDiagnostics.apiStartedAt ?? null,
    apiCompletedAt: turnDiagnostics.apiCompletedAt ?? null,
    lambdaRespondedAt: turnDiagnostics.lambdaRespondedAt ?? null,
    lambdaProcessingMs: turnDiagnostics.lambdaProcessingMs ?? null,
    apiProcessingMs: turnDiagnostics.apiProcessingMs ?? null,
	    connectBranch: turnDiagnostics.connectBranch ?? null,
	    promptText: turnDiagnostics.promptText ?? input.interactionInput.responseText ?? null,
	    promptExpectedToPlay: turnDiagnostics.promptExpectedToPlay ?? true,
	    promptPlaybackConfirmed: turnDiagnostics.promptPlaybackConfirmed ?? false,
	    playbackEvidenceStage: turnDiagnostics.playbackEvidenceStage ?? "LAMBDA_RESPONSE_ONLY",
	    lambdaResponseFingerprint:
	      turnDiagnostics.lambdaResponseFingerprint ?? turnDiagnostics.responseFingerprint ?? null,
	    dialogActionType: turnDiagnostics.dialogActionType ?? null,
	    messageContentType: turnDiagnostics.messageContentType ?? null,
	    ssmlValidation: turnDiagnostics.ssmlValidation ?? null,
	    providerDisconnectedAt: turnDiagnostics.providerDisconnectedAt ?? null,
    isValid: input.interactionInput.isValid,
    transferToQueue:
      sessionAttributesAfter.transferToQueue ?? responsePayload.transferToQueue ?? null,
    forceHumanEscalation:
      sessionAttributesAfter.forceHumanEscalation ?? responsePayload.forceHumanEscalation ?? null,
    turnStateDiagnostics: responsePayload.turnStateDiagnostics ?? null
  };
  const stableTurnIdentity = turn.humanTurnId
    ? `human:${turn.humanTurnId}`
    : turn.providerTurnId
      ? `provider:${turn.providerTurnId}`
      : "";
  return {
    idempotencyKey: stableTurnIdentity
      ? `${input.interactionKey}:${stableTurnIdentity}`
      : stableHash({
          interactionKey: input.interactionKey,
          currentTurnTranscript: turn.currentTurnTranscript,
          intentName: turn.intentName,
          inputMode: turn.inputMode,
          lastAskedSlotBefore: turn.lastAskedSlotBefore,
          activeDtmfMenuBefore: turn.activeDtmfMenuBefore,
          slotToElicit: turn.slotToElicit,
          responseText: turn.responseText
        }),
    ...turn
  };
};

const getAmazonConnectTurnHistory = (responsePayload: unknown): unknown[] => {
  const payload = recordFromUnknown(responsePayload);
  return arrayFromUnknown(payload.turnHistory);
};

const readTurnCreatedAt = (turn: unknown): number => {
  const value = recordFromUnknown(turn).createdAt;
  const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const getTurnIdempotencyKey = (turn: unknown): string => {
  const record = recordFromUnknown(turn);
  return readStringValue(record.idempotencyKey) || stableHash({
    currentTurnTranscript: record.currentTurnTranscript,
    intentName: record.intentName,
    inputMode: record.inputMode,
    lastAskedSlotBefore: record.lastAskedSlotBefore,
    activeDtmfMenuBefore: record.activeDtmfMenuBefore,
    slotToElicit: record.slotToElicit,
    responseText: record.responseText
  });
};

const mergeAmazonConnectTurnHistory = (turns: unknown[]): unknown[] => {
  const byKey = new Map<string, unknown>();
  for (const turn of turns) {
    const key = getTurnIdempotencyKey(turn);
    if (!byKey.has(key)) {
      byKey.set(key, turn);
    }
  }
  return Array.from(byKey.values())
    .sort((left, right) => readTurnCreatedAt(left) - readTurnCreatedAt(right))
    .map((turn, index) => ({
      ...recordFromUnknown(turn),
      index: index + 1
    }));
};

const withAmazonConnectTurnHistory = (
  responsePayload: unknown,
  turnHistory: unknown[]
): Record<string, unknown> => ({
  ...recordFromUnknown(responsePayload),
  turnHistory,
  turnCount: turnHistory.length,
  latestTurn: turnHistory[turnHistory.length - 1] ?? null
});

const getIncomingTurnIdentity = (input: CreateAmazonConnectAIAppointmentInput) => {
  const attributes = recordFromUnknown(input.attributes);
  const transcript = readStringValue(input.currentTurnTranscript) || readStringValue(input.text);
  return {
    humanTurnId: readStringValue(attributes.humanTurnId),
    providerTurnId: readStringValue(attributes.providerTurnId),
    providerRequestId: readStringValue(attributes.providerRequestId),
    lexPhase: readStringValue(attributes.lexPhase),
    lexRequestId: readStringValue(attributes.lexRequestId),
    transcriptFingerprint: transcript
      ? createHash("sha256").update(normalizeForMatch(transcript)).digest("hex").slice(0, 24)
      : ""
  };
};

const turnMatchesIncomingIdentity = (
  turn: unknown,
  identity: ReturnType<typeof getIncomingTurnIdentity>
): boolean => {
  const record = recordFromUnknown(turn);
  const diagnostics = recordFromUnknown(record.turnStateDiagnostics);
  const turnHumanId = readStringValue(record.humanTurnId) || readStringValue(diagnostics.humanTurnId);
  const turnProviderId =
    readStringValue(record.providerTurnId) || readStringValue(diagnostics.providerTurnId);
  if (identity.humanTurnId && turnHumanId) {
    return turnHumanId === identity.humanTurnId;
  }
  return Boolean(
    identity.providerTurnId &&
      turnProviderId === identity.providerTurnId &&
      (!identity.humanTurnId || !turnHumanId)
  );
};

const getDuplicateDisposition = (
  turn: unknown,
  identity: ReturnType<typeof getIncomingTurnIdentity>
): "duplicate_same_human_turn" | "provider_phase_duplicate" => {
  const record = recordFromUnknown(turn);
  const diagnostics = recordFromUnknown(record.turnStateDiagnostics);
  const turnProviderId = readStringValue(record.providerTurnId) || readStringValue(diagnostics.providerTurnId);
  return identity.providerTurnId && turnProviderId === identity.providerTurnId
    ? "provider_phase_duplicate"
    : "duplicate_same_human_turn";
};

const findProviderRequestIdReuse = (
  turnHistory: unknown[],
  identity: ReturnType<typeof getIncomingTurnIdentity>
): unknown | null => {
  const providerRequestId = identity.providerRequestId || identity.lexRequestId;
  if (!providerRequestId || !identity.humanTurnId) {
    return null;
  }
  return turnHistory.find((turn) => {
    const record = recordFromUnknown(turn);
    const diagnostics = recordFromUnknown(record.turnStateDiagnostics);
    const turnHumanId = readStringValue(record.humanTurnId) || readStringValue(diagnostics.humanTurnId);
    const turnProviderRequestId =
      readStringValue(record.providerRequestId) ||
      readStringValue(diagnostics.providerRequestId) ||
      readStringValue(record.lexRequestId) ||
      readStringValue(diagnostics.lexRequestId);
    return Boolean(turnProviderRequestId === providerRequestId && turnHumanId && turnHumanId !== identity.humanTurnId);
  }) ?? null;
};

const applySameRequestSegmentState = (
  normalized: ReturnType<typeof normalizeAmazonConnectAppointmentInput>,
  previousSegment: unknown | null
): void => {
  if (!previousSegment) {
    return;
  }
  const record = recordFromUnknown(previousSegment);
  const trusted = recordFromUnknown(record.trustedSlotsAfter);
  const fields = [
    "customerName",
    "customerPhone",
    "serviceName",
    "confirmedServiceName",
    "requestedDate",
    "requestedTime",
    "staffPreference",
    "confirmedStaffName",
    "staffId",
    "selectedStaffId"
  ];
  for (const field of fields) {
    const value = readStringValue(trusted[field]);
    if (!value) {
      continue;
    }
    if (field === "confirmedServiceName" && !normalized.serviceName) {
      normalized.serviceName = value;
    } else if (field === "confirmedStaffName" && !normalized.staffPreference) {
      normalized.staffPreference = value;
    } else if (field === "selectedStaffId" && !normalized.staffId) {
      normalized.staffId = value;
    } else if (field in normalized && !readStringValue((normalized as unknown as Record<string, unknown>)[field])) {
      (normalized as unknown as Record<string, unknown>)[field] = value;
    }
    if (!readStringAttribute(normalized.attributes, [field])) {
      normalized.attributes[field] = value;
    }
  }
  normalized.attributes.providerRequestIdReuseDetected = "true";
  normalized.attributes.duplicateDisposition = "provider_request_id_reused_for_distinct_human_turn";
  normalized.attributes.coalescedSegmentCount = String(
    Math.max(2, Number.parseInt(readStringAttribute(normalized.attributes, ["coalescedSegmentCount"]) || "1", 10) + 1)
  );
  normalized.attributes.coalescingReason = "same_provider_request_id_segment_state_merge";
  normalized.attributes.stateVersionBefore =
    readStringValue(record.index) || readStringAttribute(normalized.attributes, ["stateVersionBefore", "stateVersion"]) || "0";
};

const KNOWN_BOOKING_SLOT_NAMES = new Set([
  "serviceName",
  "requestedDate",
  "requestedTime",
  "staffPreference",
  "customerName",
  "customerPhone",
  "bookingConfirmation"
]);

const inferDuplicateSlotToElicit = (sessionAttributes: Record<string, unknown>): string => {
  const explicitSlot = readStringValue(sessionAttributes.slotToElicit);
  if (explicitSlot && KNOWN_BOOKING_SLOT_NAMES.has(explicitSlot)) {
    return explicitSlot;
  }
  const lastAskedSlot = readStringValue(sessionAttributes.lastAskedSlot);
  if (lastAskedSlot && KNOWN_BOOKING_SLOT_NAMES.has(lastAskedSlot)) {
    return lastAskedSlot;
  }
  return "";
};

const buildDuplicateTurnResponse = (
  existing: {
    id: string;
    responsePayload: unknown;
    parsedOutput?: unknown;
  },
  turn: unknown
) => {
  const payload = recordFromUnknown(existing.responsePayload);
  const parsedOutput = recordFromUnknown(existing.parsedOutput);
  const turnRecord = recordFromUnknown(turn);
  const sessionAttributesAfter = recordFromUnknown(turnRecord.sessionAttributesAfter);
  const responseText =
    readStringValue(turnRecord.responseText) ||
    readStringValue(recordFromUnknown(payload.lexResponse).message) ||
    "I have that. Please continue.";
  const slotToElicit =
    readStringValue(turnRecord.slotToElicit) || inferDuplicateSlotToElicit(sessionAttributesAfter);
  const dialogAction = slotToElicit
    ? {
        type: "ElicitSlot",
        slotToElicit
      }
    : recordFromUnknown(recordFromUnknown(payload.lexResponse).dialogAction);
  return {
    outcome: readStringValue(parsedOutput.outcome) || "MISSING_INFO",
    message: responseText,
    lexResponse: {
      fulfillmentState: readStringValue(recordFromUnknown(payload.lexResponse).fulfillmentState) || "InProgress",
      message: responseText,
      messageContentType:
        readStringValue(recordFromUnknown(payload.lexResponse).messageContentType) ||
        (responseText.trim().startsWith("<speak>") ? "SSML" : "PlainText"),
      dialogAction:
        Object.keys(dialogAction).length > 0
          ? dialogAction
          : {
              type: "ElicitIntent"
            },
      sessionAttributes:
        Object.keys(sessionAttributesAfter).length > 0
          ? sessionAttributesAfter
          : recordFromUnknown(recordFromUnknown(payload.lexResponse).sessionAttributes)
    },
    appointment: null,
    bookingAttempt: null,
    callSession: null,
    transcript: null,
    aiInteraction: existing,
    escalation: null,
    alternatives: [],
    missingFields: [],
    salonResolutionSource: "DUPLICATE_TURN"
  };
};

const findDuplicateAmazonConnectTurn = async (
  interactionKey: string,
  input: CreateAmazonConnectAIAppointmentInput
) => {
  const identity = getIncomingTurnIdentity(input);
  if (!identity.humanTurnId && !identity.providerTurnId) {
    return null;
  }
  const existing = await prisma.aiInteractionLog.findUnique({
    where: {
      interactionKey
    }
  });
  if (!existing) {
    return null;
  }
  const turnHistory = getAmazonConnectTurnHistory(existing.responsePayload);
  const matchedTurn = turnHistory.find((turn) => turnMatchesIncomingIdentity(turn, identity));
  if (!matchedTurn) {
    return null;
  }
  const duplicateDisposition = getDuplicateDisposition(matchedTurn, identity);
  const updatedHistory = turnHistory.map((turn) => {
    if (!turnMatchesIncomingIdentity(turn, identity)) {
      return turn;
    }
    const record = recordFromUnknown(turn);
    return {
      ...record,
      turnStateDiagnostics: {
        ...recordFromUnknown(record.turnStateDiagnostics),
        staleOrDuplicateRejectionReason: duplicateDisposition,
        duplicateDisposition,
        duplicateLexPhase: identity.lexPhase || null,
        duplicateLexRequestId: identity.lexRequestId || null,
        incomingTranscriptFingerprint: identity.transcriptFingerprint || null
      }
    };
  });
  await prisma.aiInteractionLog.update({
    where: {
      id: existing.id
    },
    data: {
      responsePayload: toJson(withAmazonConnectTurnHistory(existing.responsePayload, updatedHistory))
    }
  });
  return buildDuplicateTurnResponse(existing, matchedTurn);
};

const buildProviderDisconnectedStaleTurnResponse = async (input: {
  request: CreateAmazonConnectAIAppointmentInput;
  normalized: ReturnType<typeof normalizeAmazonConnectAppointmentInput>;
  salonId: string;
  actorUserId: string;
  callSession: {
    id: string;
    status: CallSessionStatus;
    startedAt?: Date | null;
    endedAt?: Date | null;
    rawPayload?: unknown;
  };
  providerDisconnectedAt: Date;
  turnTimestamp: Date;
}) => {
  const terminalStatuses = new Set<CallSessionStatus>([
    CallSessionStatus.COMPLETED,
    CallSessionStatus.MISSED,
    CallSessionStatus.FAILED,
    CallSessionStatus.CANCELED,
    CallSessionStatus.VOICEMAIL
  ]);
  if (!terminalStatuses.has(input.callSession.status) || !input.callSession.endedAt) {
    const durationSeconds = input.callSession.startedAt
      ? Math.max(
          0,
          Math.round((input.providerDisconnectedAt.getTime() - input.callSession.startedAt.getTime()) / 1000)
        )
      : undefined;
    await prisma.callSession.update({
      where: {
        id: input.callSession.id
      },
      data: {
        status: CallSessionStatus.COMPLETED,
        endedAt: input.providerDisconnectedAt,
        durationSeconds,
        finalResolution: undefined
      }
    });
  }

  const sessionAttributes = Object.fromEntries(
    Object.entries({
      ...recordFromUnknown(input.request.attributes),
      staleOrDuplicateRejectionReason: "provider_disconnected",
      providerDisconnectedAt: input.providerDisconnectedAt.toISOString(),
      rejectedTurnTimestamp: input.turnTimestamp.toISOString(),
      conversationState: "TERMINAL",
      conversationOutcome: "PROVIDER_DISCONNECTED",
      conversationComplete: "true",
      forceHumanEscalation: "false",
      transferToQueue: "false"
    }).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
  ) as Record<string, string>;
  const message = "The caller already disconnected.";
  const lexResponse = {
    fulfillmentState: "Fulfilled",
    message,
    messageContentType: "PlainText",
    dialogAction: {
      type: "Close"
    },
    sessionAttributes
  };
  const timingDiagnostics = buildAmazonConnectTimingDiagnostics({
    attributes: recordFromUnknown(input.request.attributes),
    promptText: message,
    promptExpectedToPlay: false,
    providerDisconnectedAt: input.providerDisconnectedAt
  });
  const responsePayload = {
    currentTurnTranscript: input.normalized.currentTurnTranscript ?? input.normalized.transcriptText,
    aggregatedBookingTranscript: input.normalized.aggregatedBookingTranscript ?? input.normalized.transcriptText,
    callerSafeResponseText: message,
    lexResponse,
    sessionAttributes,
    turnStateDiagnostics: {
      ...timingDiagnostics,
      staleOrDuplicateRejectionReason: "provider_disconnected",
      duplicateDisposition: "rejected_after_provider_disconnect",
      providerDisconnectedAt: input.providerDisconnectedAt.toISOString(),
      rejectedTurnTimestamp: input.turnTimestamp.toISOString(),
      humanTurnId: input.request.attributes?.humanTurnId,
      providerTurnId: input.request.attributes?.providerTurnId,
      providerRequestId: input.request.attributes?.providerRequestId,
      lexRequestId: input.request.attributes?.lexRequestId,
      lexPhase: input.request.attributes?.lexPhase
    }
  };
  const aiInteraction = await upsertAmazonConnectBookingAIInteractionLog({
    salonId: input.salonId,
    actorUserId: input.actorUserId,
    callSessionId: input.callSession.id,
    provider: ExternalProvider.AMAZON_CONNECT,
    model: env.AMAZON_LEX_BOT_ID ?? "amazon-lex",
    taskType: AMAZON_CONNECT_BOOKING_TASK,
    requestText: input.normalized.aggregatedBookingTranscript ?? input.normalized.transcriptText ?? "",
    requestPayload: input.request,
    responseText: message,
    responsePayload,
    parsedOutput: {
      outcome: "MISSING_INFO",
      staleOrDuplicateRejectionReason: "provider_disconnected"
    },
    isValid: false,
    validationErrors: {
      staleOrDuplicateRejectionReason: "provider_disconnected"
    },
    confidence: 0,
    isSynthetic: isSyntheticAmazonConnectIdentity(input.normalized.contactId)
  });

  return {
    outcome: "MISSING_INFO" as const,
    message,
    lexResponse,
    appointment: null,
    bookingAttempt: null,
    callSession: input.callSession,
    transcript: null,
    aiInteraction,
    escalation: null,
    alternatives: [],
    missingFields: [],
    salonResolutionSource: "PROVIDER_DISCONNECTED"
  };
};

const upsertAmazonConnectBookingAIInteractionLog = async (
  input: CreateAIInteractionLogInput
) => {
  const interactionKey = input.interactionKey ?? buildAmazonConnectInteractionKey(input);
  if (!interactionKey) {
    const turn = buildAmazonConnectTurnHistoryItem({
      index: 1,
      createdAt: new Date().toISOString(),
      interactionInput: input,
      interactionKey: `missing:${stableHash(input.requestPayload)}`
    });
    return createAIInteractionLog({
      ...input,
      responsePayload: withAmazonConnectTurnHistory(input.responsePayload, [turn]),
      isSynthetic:
        input.isSynthetic ??
        isSyntheticAmazonConnectIdentity(readAmazonConnectContactIdFromRequestPayload(input.requestPayload))
    });
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${interactionKey}, 0))`;

    const existing = await tx.aiInteractionLog.findUnique({
      where: {
        interactionKey
      }
    });
    const existingHistory = existing ? getAmazonConnectTurnHistory(existing.responsePayload) : [];
    const turn = buildAmazonConnectTurnHistoryItem({
      index: existingHistory.length + 1,
      createdAt: new Date().toISOString(),
      interactionInput: input,
      interactionKey
    });
    const turnHistory = mergeAmazonConnectTurnHistory([...existingHistory, turn]);
    const responsePayload = withAmazonConnectTurnHistory(input.responsePayload, turnHistory);
    const isSynthetic =
      input.isSynthetic ??
      existing?.isSynthetic ??
      isSyntheticAmazonConnectIdentity(readAmazonConnectContactIdFromRequestPayload(input.requestPayload));

    if (existing) {
      return tx.aiInteractionLog.update({
        where: {
          interactionKey
        },
        data: {
          requestText: input.requestText,
          requestPayload: toJson(input.requestPayload),
          responseText: input.responseText,
          responsePayload: toJson(responsePayload),
          parsedOutput: toJson(input.parsedOutput),
          isValid: input.isValid,
          validationErrors:
            input.validationErrors === undefined ? undefined : toJson(input.validationErrors),
          confidence: input.confidence,
          transcriptId: input.transcriptId,
          bookingAttemptId: input.bookingAttemptId,
          createdByUserId: input.actorUserId,
          isSynthetic
        }
      });
    }

    return tx.aiInteractionLog.create({
      data: {
        salonId: input.salonId,
        provider: input.provider ?? ExternalProvider.VERTEX,
        model: input.model,
        taskType: input.taskType,
        requestText: input.requestText,
        requestPayload: toJson(input.requestPayload),
        responseText: input.responseText,
        responsePayload: toJson(responsePayload),
        parsedOutput: toJson(input.parsedOutput),
        isValid: input.isValid,
        validationErrors:
          input.validationErrors === undefined ? undefined : toJson(input.validationErrors),
        confidence: input.confidence,
        interactionKey,
        isSynthetic,
        callSessionId: input.callSessionId,
        transcriptId: input.transcriptId,
        bookingAttemptId: input.bookingAttemptId,
        createdByUserId: input.actorUserId
      }
    });
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

  const recoveredIntent = applyDeterministicTextRecovery({
    intent: parsedIntent,
    text: input.text,
    timezone: context.timezone,
    serviceNames: context.services.map((service) => service.name)
  });

  const normalized = await sanitizeParsedIntentForConfiguredData(
    input.salonId,
    normalizeIntentResult(recoveredIntent),
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
  return getStaticServiceAliasPhrases(serviceName);
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
  if (hasUnsafeSunsetWithoutExplicitFullSetAlias(requestedServiceName)) {
    return null;
  }
  const dedicatedFullSet = recognizeFullSetFromText(requestedServiceName);
  if (dedicatedFullSet && serviceName === "full set") {
    return { service, confidence: 0.98, exact: false, matchedBy: "alias" };
  }

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

const applyGuardedPrincessServiceCorrection = async (
  salonId: string,
  serviceName: string | undefined,
  attributes: Record<string, unknown>,
  currentTurnTranscript?: string,
  transcriptText?: string
): Promise<string | undefined> => {
  const correctionRaw = readStringAttribute(attributes, ["serviceAliasCorrectionRaw"]);
  const hasPrincessToken = (value?: string | null) => /\bprincess\b/.test(normalizeForMatch(value));
  const serviceLooksLikePrincess = hasPrincessToken(serviceName);
  const correctionLooksLikePrincess = hasPrincessToken(correctionRaw);
  const transcriptLooksLikePrincess =
    hasPrincessToken(currentTurnTranscript) || hasPrincessToken(transcriptText);
  if (!serviceLooksLikePrincess && !correctionLooksLikePrincess && !transcriptLooksLikePrincess) {
    return serviceName;
  }

  const serviceContext =
    readStringAttribute(attributes, ["lastAskedSlot"]) === "serviceName" ||
    readStringAttribute(attributes, ["activeDtmfMenu"]) === "service" ||
    /\b(?:book|booking|appointment|service|nail|set)\b/i.test(
      [currentTurnTranscript, transcriptText].filter(Boolean).join(" ")
    );
  if (!serviceContext) {
    return serviceName;
  }

  const activeServices = await prisma.service.findMany({
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
  const exactPrincess = activeServices.find((service) => normalizeForMatch(service.name) === "princess");
  if (exactPrincess) {
    return exactPrincess.name;
  }
  const fullSet = activeServices.find((service) => normalizeForMatch(service.name) === "full set");
  return fullSet ? getCustomerFacingServiceName(fullSet.name) : serviceName;
};

const applyGuardedPedicureServiceCorrection = async (
  salonId: string,
  serviceName: string | undefined,
  attributes: Record<string, unknown>,
  currentTurnTranscript?: string,
  transcriptText?: string
): Promise<string | undefined> => {
  const heardValues = [serviceName, currentTurnTranscript, transcriptText].filter(Boolean).join(" ");
  const normalizedHeard = normalizeForMatch(heardValues);
  if (!/\bfifty\s+kill\b/.test(normalizedHeard)) {
    return serviceName;
  }

  const serviceContext =
    readStringAttribute(attributes, ["lastAskedSlot"]) === "serviceName" ||
    readStringAttribute(attributes, ["activeDtmfMenu"]) === "service" ||
    /\b(?:book|booking|appointment|service|nail|pedicure|manicure)\b/i.test(
      [currentTurnTranscript, transcriptText].filter(Boolean).join(" ")
    );
  if (!serviceContext) {
    return serviceName;
  }

  const activeServices = await prisma.service.findMany({
    where: {
      salonId,
      isActive: true,
      deletedAt: null
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
  const heardParts = [serviceName, currentTurnTranscript, transcriptText]
    .map((value) => normalizeForMatch(value))
    .filter(Boolean);
  const exactHeardService = activeServices.find((service) =>
    heardParts.some((value) => value === normalizeForMatch(service.name))
  );
  if (exactHeardService) {
    return getCustomerFacingServiceName(exactHeardService.name) ?? exactHeardService.name;
  }

  const conflictingServiceMention = activeServices
    .map((service) => rankServiceMatch(service, heardValues))
    .filter((match): match is ServiceMatch => Boolean(match))
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        Number(right.exact) - Number(left.exact) ||
        left.service.name.length - right.service.name.length
    )[0];
  if (
    conflictingServiceMention &&
    normalizeForMatch(conflictingServiceMention.service.name) !== "pedicure" &&
    conflictingServiceMention.confidence >= 0.94
  ) {
    return serviceName;
  }

  const pedicure = activeServices.find((service) => normalizeForMatch(service.name) === "pedicure");
  return pedicure ? getCustomerFacingServiceName(pedicure.name) ?? pedicure.name : serviceName;
};

const applyGuardedObservedServiceAsrCorrection = async (
  salonId: string,
  serviceName: string | undefined,
  attributes: Record<string, unknown>,
  currentTurnTranscript?: string,
  transcriptText?: string
): Promise<string | undefined> => {
  const heardValues = [serviceName, currentTurnTranscript, transcriptText].filter(Boolean).join(" ");
  const normalizedHeard = normalizeForMatch(heardValues);
  if (hasUnsafeSunsetWithoutExplicitFullSetAlias(heardValues)) {
    return serviceName && !["full set", "sunset", "sun set"].includes(normalizeForMatch(serviceName))
      ? serviceName
      : undefined;
  }
  const requestedCanonical = /\bpay\s+the\s+bill\b/.test(normalizedHeard) ? "pedicure" : "";
  if (!requestedCanonical) {
    return serviceName;
  }

  const serviceContext =
    readStringAttribute(attributes, ["lastAskedSlot"]) === "serviceName" ||
    readStringAttribute(attributes, ["activeDtmfMenu"]) === "service" ||
    /\b(?:book|booking|appointment|service|nail|today|tomorrow|with|at|for|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(
      [currentTurnTranscript, transcriptText].filter(Boolean).join(" ")
    );
  if (!serviceContext) {
    return serviceName;
  }

  const activeServices = await prisma.service.findMany({
    where: {
      salonId,
      isActive: true,
      deletedAt: null
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
  const exactHeardService = activeServices.find((service) =>
    [serviceName, currentTurnTranscript]
      .map((value) => normalizeForMatch(value))
      .filter(Boolean)
      .some((value) => value === normalizeForMatch(service.name))
  );
  if (exactHeardService) {
    return getCustomerFacingServiceName(exactHeardService.name) ?? exactHeardService.name;
  }
  const targetService = activeServices.find(
    (service) => normalizeForMatch(service.name) === requestedCanonical
  );
  return targetService ? getCustomerFacingServiceName(targetService.name) ?? targetService.name : serviceName;
};

const shouldAutoAcceptServiceMatch = (
  serviceMatch: ServiceMatch,
  requestedServiceName?: string
): boolean => {
  if (serviceMatch.exact) {
    return true;
  }
  if (serviceMatch.matchedBy === "alias" && serviceMatch.confidence >= 0.9) {
    return true;
  }
  return (
    normalizeForMatch(serviceMatch.service.name) === "pedicure" &&
    serviceMatch.confidence >= 0.86 &&
    getServiceAliasPhrases("pedicure").some(
      (phrase) => compactForMatch(phrase) === compactForMatch(requestedServiceName)
    )
  );
};

const findServiceMentionInText = async (
  salonId: string,
  text?: string
): Promise<ServiceMatch | null> => {
  if (isBillingLikeServiceCollision(text)) {
    return null;
  }
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

const parseAsrAlternativeDiagnostics = (
  attributes: Record<string, unknown> | undefined
): Array<{ transcript: string; confidence?: number; transcriptionConfidence?: number; nluConfidence?: number; source?: string }> => {
  const raw =
    attributes?.asrNBestAlternatives ??
    attributes?.nBestAlternatives ??
    attributes?.asrDiagnostics;
  if (!raw) {
    return [];
  }
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    const alternatives = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { alternativeTranscripts?: unknown }).alternativeTranscripts)
        ? (parsed as { alternativeTranscripts: unknown[] }).alternativeTranscripts
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { nBestAlternatives?: unknown }).nBestAlternatives)
          ? (parsed as { nBestAlternatives: unknown[] }).nBestAlternatives
        : [];
    return alternatives
      .map((item) => {
        if (typeof item === "string") {
          return { transcript: item };
        }
        if (!item || typeof item !== "object") {
          return null;
        }
        const record = item as Record<string, unknown>;
        const transcript =
          typeof record.transcript === "string" && record.transcript.trim()
            ? record.transcript.trim()
            : typeof record.transcription === "string" && record.transcription.trim()
              ? record.transcription.trim()
              : undefined;
        if (!transcript) {
          return null;
        }
        const transcriptionConfidenceValue = record.transcriptionConfidence;
        const transcriptionConfidence =
          typeof transcriptionConfidenceValue === "number"
            ? transcriptionConfidenceValue
            : typeof transcriptionConfidenceValue === "string" && transcriptionConfidenceValue.trim()
              ? Number(transcriptionConfidenceValue)
              : undefined;
        const nluConfidenceValue = record.nluConfidence;
        const nluConfidence =
          typeof nluConfidenceValue === "number"
            ? nluConfidenceValue
            : typeof nluConfidenceValue === "string" && nluConfidenceValue.trim()
              ? Number(nluConfidenceValue)
              : undefined;
        return {
          transcript,
          confidence: Number.isFinite(transcriptionConfidence) ? transcriptionConfidence : undefined,
          transcriptionConfidence: Number.isFinite(transcriptionConfidence) ? transcriptionConfidence : undefined,
          nluConfidence: Number.isFinite(nluConfidence) ? nluConfidence : undefined,
          source: typeof record.source === "string" ? record.source : undefined
        };
      })
      .filter((item): item is { transcript: string; confidence?: number; transcriptionConfidence?: number; nluConfidence?: number; source?: string } => Boolean(item))
      .slice(0, 5);
  } catch {
    return [];
  }
};

const getAsrDecisionTranscripts = (
  topTranscript?: string,
  attributes?: Record<string, unknown>
): Array<{ transcript: string; confidence?: number; source: "top" | "alternative" }> => {
  const alternatives = parseAsrAlternativeDiagnostics(attributes);
  const candidates = [
    ...(topTranscript?.trim() ? [{ transcript: topTranscript.trim(), source: "top" as const }] : []),
    ...alternatives.map((alternative) => ({ ...alternative, source: "alternative" as const }))
  ];
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = normalizeForMatch(candidate.transcript);
    if (!key || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

const hasScopedFullSetPhoneticCandidate = (value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  if (!normalized || hasUnsafeSunsetWithoutExplicitFullSetAlias(value)) {
    return false;
  }
  return Boolean(
    /\bwho\s+(?:said|s\s+that|is\s+that|that)\b/.test(normalized) ||
      /\bfull\s+jet\b/.test(normalized) ||
      /\btime\s+to\s+fight\b/.test(normalized) ||
      /\bfun\s+facts?\b/.test(normalized) ||
      /\b(?:phone\s+set|phone\s+chat|food\s+set|pool\s+set|cool\s+set|moon\s+set|fu\s+set|pun\s+set|bloom\s*tet)\b/.test(normalized) ||
      /\b(?:can\s+we|could\s+we|so\s+we\s+ll|we\s+ll)\s+set\b/.test(normalized)
  );
};

const hasTruncatedSetFullSetCandidate = (value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  if (!normalized || hasUnsafeSunsetWithoutExplicitFullSetAlias(value)) {
    return false;
  }
  if (!/^set(?:\s|$)/.test(normalized) || normalized === "set") {
    return false;
  }
  if (/\b(?:set\s+up|the\s+alarm|alarm|meeting|reminder|timer|reset)\b/.test(normalized)) {
    return false;
  }
  return hasGroundedDatePhrase(value) || hasGroundedTimePhrase(value, {
    currentTurnHasDatePhrase: hasGroundedDatePhrase(value)
  });
};

const getActiveCatalogServiceNamesForRepair = (
  attributes?: Record<string, unknown>
): string[] => {
  const activeNamesRaw = readStringAttribute(attributes, ["activeServiceNames"]);
  const activeNames = (() => {
    if (!activeNamesRaw) {
      return [];
    }
    try {
      const parsed = JSON.parse(activeNamesRaw);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
    } catch {
      return [];
    }
  })();
  const serviceOptions = parseJsonStringRecord(readStringAttribute(attributes, ["serviceDtmfOptions"]));
  const dtmfNames = Object.values(
    Object.keys(serviceOptions).length ? serviceOptions : SERVICE_DTMF_OPTIONS
  ).filter(
    (value) => value && value !== "__operator__"
  );
  return activeNames.length ? activeNames : dtmfNames;
};

const catalogAllowsTruncatedFullSetRepair = (
  attributes?: Record<string, unknown>
): boolean => {
  const catalogNames = getActiveCatalogServiceNamesForRepair(attributes);
  const hasFullSet = catalogNames.some((serviceName) => normalizeForMatch(serviceName) === "full set");
  const hasAmbiguousSetService = catalogNames.some((serviceName) => {
    const normalized = normalizeForMatch(serviceName);
    return normalized === "set" || (normalized.endsWith(" set") && normalized !== "full set");
  });
  return hasFullSet && !hasAmbiguousSetService;
};

const transcriptHasExactDifferentServiceForFullSetRepair = (
  value?: string | null,
  attributes?: Record<string, unknown>
): boolean => {
  const serviceName = recognizeFullSetFromText(value, {
    lastAskedSlot: readStringAttribute(attributes, ["lastAskedSlot"]),
    activeDtmfMenu: readStringAttribute(attributes, ["activeDtmfMenu"])
  })
    ? "Full Set"
    : undefined;
  if (serviceName) {
    return false;
  }
  const normalized = compactForMatch(value);
  return getActiveCatalogServiceNamesForRepair(attributes)
    .filter((candidate) => normalizeForMatch(candidate) !== "full set" && candidate !== "__operator__")
    .some((candidate) => {
      const compact = compactForMatch(candidate);
      return compact.length >= 4 && normalized.includes(compact);
    });
};

const hasStrongServiceSlotFullSetCandidate = (value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  if (!normalized || hasUnsafeSunsetWithoutExplicitFullSetAlias(value)) {
    return false;
  }
  return Boolean(/\bfull\s+(?:set|jet)\b/.test(normalized) || /\bfullset\b/.test(normalized));
};

const findProposedFullSetServiceClarification = (input: {
  serviceName?: string;
  requestedDate?: string;
  requestedTime?: string;
  currentTurnTranscript?: string;
  transcriptText?: string;
  attributes?: Record<string, unknown>;
}): {
  proposedServiceName: "Full Set";
  reason: "asr_alternative_full_set" | "scoped_phonetic_full_set";
  asrAlternativesUsed: boolean;
  matchedTranscript: string;
} | null => {
  if (input.serviceName) {
    return null;
  }
  const topTranscript = input.currentTurnTranscript ?? input.transcriptText ?? "";
  if (!topTranscript || hasUnsafeSunsetWithoutExplicitFullSetAlias(topTranscript)) {
    return null;
  }
  const staffContext = staffPhraseContextFromAttributes(input.attributes);
  const candidates = getAsrDecisionTranscripts(topTranscript, input.attributes);
  if (candidates.some((candidate) => transcriptHasExactDifferentServiceForFullSetRepair(candidate.transcript, input.attributes))) {
    return null;
  }
  const alternativeMatch = candidates.find(
    (candidate) =>
      candidate.source === "alternative" &&
      recognizeFullSetFromText(candidate.transcript, {
        ...staffContext,
        lastAskedSlot: "serviceName"
      })
  );
  if (alternativeMatch) {
    return {
      proposedServiceName: "Full Set",
      reason: "asr_alternative_full_set",
      asrAlternativesUsed: true,
      matchedTranscript: alternativeMatch.transcript
    };
  }
  const serviceSlotActive = getActiveVoiceSlot(input.attributes) === "serviceName";
  const hasBookingContext =
    Boolean(input.requestedDate && input.requestedTime) &&
    /\b(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|at|am|pm|appointment|book|booking|service)\b/.test(
      normalizeForMatch(topTranscript)
    );
  const truncatedSetCandidate = hasTruncatedSetFullSetCandidate(topTranscript);
  const currentTurnHasDateOrTime =
    hasGroundedDatePhrase(topTranscript) ||
    hasGroundedTimePhrase(topTranscript, {
      lastAskedSlot: readStringAttribute(input.attributes, ["lastAskedSlot"]),
      currentTurnHasDatePhrase: hasGroundedDatePhrase(topTranscript)
    });
  const knownDateOrTime = Boolean(input.requestedDate || input.requestedTime);
  if (
    truncatedSetCandidate &&
    (!catalogAllowsTruncatedFullSetRepair(input.attributes) ||
      (!currentTurnHasDateOrTime && !knownDateOrTime))
  ) {
    return null;
  }
  const hasServiceSlotOnlyContext =
    serviceSlotActive && (hasScopedFullSetPhoneticCandidate(topTranscript) || truncatedSetCandidate);
  if (
    (hasScopedFullSetPhoneticCandidate(topTranscript) || truncatedSetCandidate) &&
    (hasServiceSlotOnlyContext || hasBookingContext)
  ) {
    return {
      proposedServiceName: "Full Set",
      reason: "scoped_phonetic_full_set",
      asrAlternativesUsed: candidates.length > 1,
      matchedTranscript: topTranscript
    };
  }
  return null;
};

const isAmbiguousFirstAvailableStaffCandidate = (
  value?: string | null,
  attributes?: Record<string, unknown>
): boolean => {
  const normalized = normalizeForMatch(value);
  if (!normalized || getActiveVoiceSlot(attributes) !== "staffPreference") {
    return false;
  }
  return hasGuardedFirstAvailableStaffTail(normalized);
};

const hasGuardedFirstAvailableStaffTail = (normalizedValue: string): boolean => {
  const normalized = normalizeForMatch(normalizedValue);
  if (!normalized) {
    return false;
  }
  if (hasExplicitFirstAvailableStaffRejection(normalized)) {
    return false;
  }
  const tail = stripAnyStaffTrailingFiller(normalized)
    .replace(/\s+(?:music|background music|noise)$/, "")
    .trim();
  if (/\bnot\s+(?:the\s+)?first\s+available\b/.test(tail) || /\bnot\s+(?:a\s+)?(?:five|5)\b/.test(tail)) {
    return false;
  }
  return Boolean(
    /\b(?:and\s+)?(?:it\s+s|its|it\s+is|it)?\s*stopp?ed\s+at\s+(?:five|5)\b/.test(tail) ||
      [
        "any stop",
        "any top",
        "anystop",
        "edit stop",
        "edit stop if i",
        "any stop if i",
        "i need stop if i",
        "i need stop",
        "need stop if i",
        "need stop",
        "any stuff",
        "any star",
        "any star is fine",
        "and it s top",
        "and its top",
        "and it is top",
        "at least happy five",
        "and it s thirty five",
        "and its thirty five",
        "and it is thirty five",
        "it s thirty five",
        "its thirty five",
        "it is thirty five",
        "and it s top five",
        "and its top five",
        "and it is top five",
        "and it s top a five",
        "and its top a five",
        "and it is top a five",
        "and it s top e five",
        "and its top e five",
        "and it is top e five",
        "it s top five",
        "its top five",
        "it is top five",
        "any top five",
        "and is up for hire able",
        "and he s up for hire able",
        "and hes up for hire able",
        "is up for hire able",
        "he s up for hire able",
        "hes up for hire able",
        "the end is high"
      ].some((alias) => tail === alias || tail.endsWith(` ${alias}`))
  );
};

const hasLowConfidenceFirstAvailableStaffTail = (value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  if (!normalized || hasExplicitFirstAvailableStaffRejection(normalized)) {
    return false;
  }
  const tail = stripAnyStaffTrailingFiller(normalized)
    .replace(/\s+(?:music|background music|noise)$/, "")
    .trim();
  return [
    "and it s not",
    "and its not",
    "and it is not",
    "it s not",
    "its not",
    "it is not",
    "and it s not a fight",
    "and its not a fight",
    "and it is not a fight",
    "it s not a fight",
    "its not a fight",
    "it is not a fight"
  ].some((alias) => tail === alias || tail.endsWith(` ${alias}`));
};

const findProposedTodayDateClarification = (input: {
  serviceName?: string;
  requestedDate?: string;
  requestedTime?: string;
  currentTurnTranscript?: string;
  transcriptText?: string;
  timezone: string;
}): {
  proposedRequestedDate: string;
  reason: "dropped_today_day_at_time";
  matchedTranscript: string;
} | null => {
  if (input.requestedDate || !input.serviceName || !input.requestedTime) {
    return null;
  }
  const text = input.currentTurnTranscript ?? input.transcriptText ?? "";
  const normalized = normalizeForMatch(text);
  if (!normalized || isNegative(text)) {
    return null;
  }
  if (/\b(?:some|another|a|one|next)\s+day\b/.test(normalized)) {
    return null;
  }
  if (/\b(?:today|tomorrow|tonight|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.test(normalized)) {
    return null;
  }
  if (new RegExp(MONTH_DAY_PATTERN, "i").test(text) || new RegExp(ISO_DATE_PATTERN, "i").test(text)) {
    return null;
  }
  const timeCandidate = extractTimeCandidate(text, { currentTurnHasDatePhrase: true });
  const parsedTime = timeCandidate ? parseLocalTimeText(timeCandidate, { currentTurnHasDatePhrase: true }) : null;
  if (!parsedTime || parsedTime.ambiguous) {
    return null;
  }
  const spokenNumberNormalized = normalizeForMatch(normalizeSpokenNumbers(normalizeHourMinuteTimeExpression(text)));
  if (!/\bday\s+at\s+\d{1,2}(?::\d{2})?\s*(?:a\s*m|p\s*m|am|pm)\b/.test(spokenNumberNormalized)) {
    return null;
  }
  const today = normalizeRequestedDateForState("today", input.timezone);
  return today
    ? {
        proposedRequestedDate: today,
        reason: "dropped_today_day_at_time",
        matchedTranscript: text
      }
    : null;
};

const isRejectedFirstAvailableStaffCandidate = (
  value?: string | null,
  attributes?: Record<string, unknown>
): boolean => {
  const normalized = normalizeForMatch(value);
  if (!normalized || getActiveVoiceSlot(attributes) !== "staffPreference") {
    return false;
  }
  return hasExplicitFirstAvailableStaffRejection(value) ||
    /\bnot\s+(?:any\s+staff|the\s+first\s+available|first\s+available)\b/.test(normalized) ||
    /\bnot\s+(?:a\s+)?(?:five|5)\b/.test(normalized);
};

const findProposedAnyStaffClarification = (input: {
  serviceName?: string;
  requestedDate?: string;
  proposedRequestedDate?: string;
  requestedTime?: string;
  staffPreference?: string;
  currentTurnTranscript?: string;
  transcriptText?: string;
  attributes?: Record<string, unknown>;
}): {
  proposedStaffPreference: "Any staff";
  reason: "asr_alternative_first_available" | "ambiguous_first_available_asr" | "out_of_order_first_available";
  confidenceBand: "medium" | "low";
  asrAlternativesUsed: boolean;
  matchedTranscript: string;
} | null => {
  const topTranscript = input.currentTurnTranscript ?? input.transcriptText ?? "";
  if (hasExplicitFirstAvailableStaffRejection(topTranscript)) {
    return null;
  }
  const activeSlot = getActiveVoiceSlot(input.attributes);
  const activeStaffSlot = activeSlot === "staffPreference";
  const activeServiceSlot =
    activeSlot === "serviceName" ||
    readStringAttribute(input.attributes, ["lastAskedSlot"]) === "serviceName" ||
    readStringAttribute(input.attributes, ["activeDtmfMenu"]) === "service";
  const hasDateAndTime = Boolean((input.requestedDate || input.proposedRequestedDate) && input.requestedTime);
  const hasCompleteBookingFrame =
    Boolean(input.serviceName && (input.requestedDate || input.proposedRequestedDate) && input.requestedTime) &&
    isBookingLikeUtterance(topTranscript);
  const hasNamedTrustedStaff = Boolean(
    input.staffPreference &&
      normalizeForMatch(input.staffPreference) !== "any staff"
  );
  const hasFinalConfirmationReplacementContext =
    readStringAttribute(input.attributes, ["awaitingFinalBookingConfirmation"]) === "true" ||
    readStringAttribute(input.attributes, ["bookingConfirmationAsked"]) === "true" ||
    readStringAttribute(input.attributes, ["lastAskedSlot"]) === "bookingConfirmation";
  const canProposeFinalConfirmationReplacement =
    hasFinalConfirmationReplacementContext &&
    hasNamedTrustedStaff &&
    Boolean(input.serviceName && (input.requestedDate || input.proposedRequestedDate) && input.requestedTime);
  const hasOutOfOrderStaffRepairContext =
    activeServiceSlot &&
    !input.staffPreference &&
    !readStringAttribute(input.attributes, ["confirmedStaffName"]);
  if (
    !activeStaffSlot &&
    !hasCompleteBookingFrame &&
    !hasOutOfOrderStaffRepairContext &&
    !canProposeFinalConfirmationReplacement
  ) {
    return null;
  }
  if (
    input.staffPreference &&
    !canProposeFinalConfirmationReplacement
  ) {
    return null;
  }
  if (
    !canProposeFinalConfirmationReplacement &&
    !hasOutOfOrderStaffRepairContext &&
    (!hasDateAndTime || !input.serviceName)
  ) {
    return null;
  }
  const staffContext = {
    ...staffPhraseContextFromAttributes(input.attributes),
    serviceName: input.serviceName,
    requestedDate: input.requestedDate ?? input.proposedRequestedDate,
    requestedTime: input.requestedTime,
    lastAskedSlot: "staffPreference"
  };
  const topAnyStaffPhrase = normalizeAnyStaffPhrase(topTranscript, staffContext);
  const topLowConfidenceTail = hasLowConfidenceFirstAvailableStaffTail(topTranscript);
	  const topGuardedTail = hasGuardedFirstAvailableStaffTail(topTranscript);
	  if (topAnyStaffPhrase) {
    if (hasCompleteBookingFrame) {
      return {
        proposedStaffPreference: "Any staff",
        reason: "ambiguous_first_available_asr",
        confidenceBand: "medium",
        asrAlternativesUsed: getAsrDecisionTranscripts(topTranscript, input.attributes).length > 1,
        matchedTranscript: topTranscript
      };
    }
	    if (!hasOutOfOrderStaffRepairContext) {
	      return null;
	    }
    return {
      proposedStaffPreference: "Any staff",
      reason: "out_of_order_first_available",
      confidenceBand: "medium",
      asrAlternativesUsed: getAsrDecisionTranscripts(topTranscript, input.attributes).length > 1,
      matchedTranscript: topTranscript
    };
  }
  if (topLowConfidenceTail) {
    return {
      proposedStaffPreference: "Any staff",
      reason: "ambiguous_first_available_asr",
      confidenceBand: "low",
      asrAlternativesUsed: getAsrDecisionTranscripts(topTranscript, input.attributes).length > 1,
      matchedTranscript: topTranscript
    };
  }
  if (topGuardedTail) {
    return {
      proposedStaffPreference: "Any staff",
      reason: "ambiguous_first_available_asr",
      confidenceBand: "medium",
      asrAlternativesUsed: getAsrDecisionTranscripts(topTranscript, input.attributes).length > 1,
      matchedTranscript: topTranscript
    };
  }
  if (containsKnownStaffAliasText(topTranscript, input.attributes)) {
    return null;
  }
  const ambiguousAlternativeMatch = getAsrDecisionTranscripts(topTranscript, input.attributes).find(
    (candidate) =>
      candidate.source === "alternative" &&
      (hasLowConfidenceFirstAvailableStaffTail(candidate.transcript) ||
        hasGuardedFirstAvailableStaffTail(candidate.transcript))
  );
  if (ambiguousAlternativeMatch) {
    return {
      proposedStaffPreference: "Any staff",
      reason: "ambiguous_first_available_asr",
      confidenceBand: hasLowConfidenceFirstAvailableStaffTail(ambiguousAlternativeMatch.transcript) ? "low" : "medium",
      asrAlternativesUsed: true,
      matchedTranscript: ambiguousAlternativeMatch.transcript
    };
  }
  const alternativeMatch = getAsrDecisionTranscripts(topTranscript, input.attributes).find(
    (candidate) =>
      candidate.source === "alternative" &&
      normalizeAnyStaffPhrase(candidate.transcript, staffContext)
  );
  if (!alternativeMatch) {
    return null;
  }
  return {
    proposedStaffPreference: "Any staff",
    reason: "asr_alternative_first_available",
    confidenceBand: "medium",
    asrAlternativesUsed: true,
    matchedTranscript: alternativeMatch.transcript
  };
};

const buildBookingFrameRepairConfirmationPrompt = (
  input: {
    serviceName?: string;
    proposedServiceName?: string;
    requestedDate?: string;
    proposedRequestedDate?: string;
    requestedTime: string;
    proposedStaffPreference: "Any staff";
  },
  timezone: string
): string => {
  const serviceName = input.proposedServiceName ?? input.serviceName;
  const date = formatKnownDateForPrompt(input.proposedRequestedDate ?? input.requestedDate, timezone);
  const time = formatKnownTimeForPrompt(input.requestedTime);
  const staff =
    normalizeForMatch(input.proposedStaffPreference) === "any staff"
      ? "the first available staff"
      : input.proposedStaffPreference;
  return speak(
    `I heard ${escapeSsml(serviceName)} ${escapeSsml(date)} at ${escapeSsml(time)} with ${escapeSsml(staff)}. Is that right?`
  );
};

const isStaffConfirmationRejection = (value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  return Boolean(
    isNegative(value) ||
      /\bnot\s+(?:a\s+|the\s+)?(?:five|5)\b/.test(normalized) ||
      /\bnot\s+(?:first\s+available|any\s+staff|that|it)\b/.test(normalized)
  );
};

const buildProposedServicePrompt = (
  normalized: {
    requestedDate?: string;
    requestedTime?: string;
  },
  timezone: string
): string => {
  const date = formatKnownDateForPrompt(normalized.requestedDate, timezone);
  const time = formatKnownTimeForPrompt(normalized.requestedTime);
  const heard = [date, time ? `at ${time}` : ""].filter(Boolean).join(" ");
  return speak(
    heard
      ? `I heard ${escapeSsml(heard)}, but I'm not sure about the service. Did you say Full Set?`
      : "I'm not sure about the service. Did you say Full Set?"
  );
};

const buildFocusedStaffChoicePrompt = (staffOptions: StaffCandidate[]): string => {
  const names = staffOptions.map((staff) => staff.fullName).filter(Boolean);
  const preferred = names.find((name) => normalizeForMatch(name) === "amy") ?? names[0];
  return preferred
    ? `Which staff would you like, ${escapeSsml(preferred)} or first available?`
    : "Which staff would you like, or first available?";
};

const buildAmbiguousStaffConfirmationPrompt = (
  normalized: {
    serviceName?: string;
    requestedDate?: string;
    requestedTime?: string;
  },
  timezone: string
): string => {
  const summary = buildKnownBookingPromptSummary(normalized, timezone);
  return speak(
    summary
      ? `I still have ${escapeSsml(summary)}. Did you mean first available?`
      : "Did you mean first available?"
  );
};

const buildStaffConfirmationRejectedPrompt = (
  normalized: {
    requestedTime?: string;
  },
  staffOptions: StaffCandidate[]
): string => {
  const time = formatKnownTimeForPrompt(normalized.requestedTime);
  const prefix = time ? `Understood. I still have ${escapeSsml(time)}. ` : "Understood. ";
  return speak(`${prefix}${buildFocusedStaffChoicePrompt(staffOptions)}`);
};

const hasCloseManicurePedicureAsrAlternatives = (
  attributes: Record<string, unknown> | undefined
): boolean => {
  const alternatives = parseAsrAlternativeDiagnostics(attributes);
  const manicure = alternatives.find((item) => normalizeForMatch(item.transcript).includes("manicure"));
  const pedicure = alternatives.find((item) => normalizeForMatch(item.transcript).includes("pedicure"));
  if (!manicure || !pedicure) {
    return false;
  }
  if (manicure.confidence === undefined || pedicure.confidence === undefined) {
    return true;
  }
  return Math.abs(manicure.confidence - pedicure.confidence) <= 0.12;
};

const shouldConfirmManicurePedicureAfterFailure = (input: {
  serviceMatch: ServiceMatch | null;
  serviceName?: string;
  currentTurnTranscript?: string;
  attributes: Record<string, unknown>;
}): boolean => {
  if (normalizeForMatch(input.serviceMatch?.service.name) !== "manicure") {
    return false;
  }
  return hasCloseManicurePedicureAsrAlternatives(input.attributes);
};

const findStaffMentionInText = async (
  salonId: string,
  text?: string,
  context: StaffPhraseContext = {}
): Promise<string | undefined> => {
  const normalizedText = normalizeForMatch(text);
  if (!normalizedText) {
    return undefined;
  }
  if (
    context.lastAskedSlot === "customerName" &&
    context.activeDtmfMenu !== "staff" &&
    !hasExplicitStaffContextCue(normalizedText, context)
  ) {
    return undefined;
  }

  const staff = await getStaffCandidates({ salonId });
  const scopedCandidate = normalizeScopedStaffCandidatePhrase(text, context);
  const searchText = scopedCandidate && scopedCandidate !== "any staff" ? scopedCandidate : normalizedText;
  const aliasMatches = staff.flatMap((member) => {
    const aliases = new Set(getStaffAliasPhrases(member.fullName).map((alias) => normalizeForMatch(alias)));
    return Array.from(aliases.values()).flatMap((alias) =>
      shouldSkipStaffAlias(member.fullName, alias, searchText, context) ||
      staffAliasCollidesWithExactActiveStaff(staff, member.fullName, alias)
        ? []
        : staffAliasMatchesInText(searchText, alias).map((index) => ({
            member,
            index,
            negated: isNegatedStaffAlias(searchText, index)
          }))
    );
  });
  const positiveMatches = aliasMatches.filter((match) => !match.negated);
  const positiveStaff = dedupeStaffById(positiveMatches.map((match) => match.member));
  if (positiveStaff.length === 1) {
    return positiveStaff[0]!.fullName;
  }
  if (positiveStaff.length > 1) {
    return undefined;
  }
  if (aliasMatches.length && positiveMatches.length === 0) {
    return undefined;
  }

  const trangAsrConfusionToken = extractTrangAsrConfusionToken(searchText);
  if (trangAsrConfusionToken) {
    const tokenResolution = resolveStaffPreferenceFromCandidates(
      staff,
      trangAsrConfusionToken,
      context
    );
    if (tokenResolution.status === "matched") {
      return tokenResolution.matchedStaff.fullName;
    }
    const trangAsrConfusion = resolveTrangAsrConfusionStaff(staff, searchText, context);
    if (trangAsrConfusion) {
      return trangAsrConfusion.fullName;
    }
  }

  if (scopedCandidate && scopedCandidate !== "any staff") {
    const candidateResolution = resolveStaffPreferenceFromCandidates(staff, scopedCandidate, context);
    if (candidateResolution.status === "matched") {
      return candidateResolution.matchedStaff.fullName;
    }
    return undefined;
  }

  const tokens = normalizedText
    .split(/\s+/)
    .filter((token) => token.length >= 5 && !STAFF_FUZZY_STOP_TOKENS.has(token));
  const fuzzyMatches = staff.filter((member) =>
    getStaffAliasPhrases(member.fullName).some((alias) =>
      tokens.some((token) => isConservativeStaffFuzzyMatch(alias, token))
    )
  );
  if (fuzzyMatches.length === 1) {
    return fuzzyMatches[0]!.fullName;
  }

  const exactStaff = staff.find((member) => {
    const fullName = normalizeForMatch(member.fullName);
    const firstName = normalizeForMatch(member.fullName.split(/\s+/)[0]);
    return textContainsStaffAlias(normalizedText, fullName) || textContainsStaffAlias(normalizedText, firstName);
  });
  if (exactStaff) {
    return exactStaff.fullName;
  }

  if (normalizeAnyStaffPhrase(text, context)) {
    return "Any staff";
  }

  return undefined;
};

const parseStringArrayAttribute = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
      .map((item) => item.trim());
  }
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .map((item) => item.trim());
    }
  } catch {
    // Fall back to comma-separated attributes.
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const readStringArrayAttribute = (
  attributes: Record<string, unknown> | undefined,
  names: string[]
): string[] => {
  for (const name of names) {
    const values = parseStringArrayAttribute(attributes?.[name]);
    if (values.length) {
      return values;
    }
  }
  return [];
};

const staffAliasTexts = (member: StaffCandidate): string[] =>
  Array.from(
    new Set([
      member.fullName,
      member.fullName.split(/\s+/)[0] ?? "",
      ...getStaffAliasPhrases(member.fullName)
    ].map((value) => normalizeForMatch(value)).filter(Boolean))
  );

const staffAliasTextsForActiveStaff = (member: StaffCandidate, staff: StaffCandidate[]): string[] =>
  staffAliasTexts(member).filter(
    (alias) => !staffAliasCollidesWithExactActiveStaff(staff, member.fullName, alias)
  );

const staffMatchesName = (member: StaffCandidate, value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return false;
  }
  return staffAliasTexts(member).some((alias) => alias === normalized);
};

const staffIsExcluded = (
  member: StaffCandidate,
  excludedStaffIds: Set<string>,
  excludedStaffNames: Set<string>
): boolean =>
  excludedStaffIds.has(member.id) ||
  staffAliasTexts(member).some((alias) => excludedStaffNames.has(alias));

const filterExcludedStaff = (
  staff: StaffCandidate[],
  excludedStaffIds: Set<string>,
  excludedStaffNames: Set<string>
): StaffCandidate[] =>
  staff.filter((member) => !staffIsExcluded(member, excludedStaffIds, excludedStaffNames));

const readStaffExclusionState = (attributes: Record<string, unknown> | undefined) => ({
  ids: new Set(readStringArrayAttribute(attributes, ["excludedStaffIds"])),
  names: new Set(
    readStringArrayAttribute(attributes, ["excludedStaffNames"]).map((name) => normalizeForMatch(name))
  )
});

const serializeStaffExclusionState = (input: {
  ids: Set<string>;
  names: Set<string>;
}) => ({
  excludedStaffIds: input.ids.size ? JSON.stringify(Array.from(input.ids.values())) : undefined,
  excludedStaffNames: input.names.size ? JSON.stringify(Array.from(input.names.values())) : undefined
});

const applyStaffExclusionStateToAttributes = (
  attributes: Record<string, unknown>,
  state: { ids: Set<string>; names: Set<string> }
) => {
  const serialized = serializeStaffExclusionState(state);
  if (serialized.excludedStaffIds) {
    attributes.excludedStaffIds = serialized.excludedStaffIds;
  } else {
    delete attributes.excludedStaffIds;
  }
  if (serialized.excludedStaffNames) {
    attributes.excludedStaffNames = serialized.excludedStaffNames;
  } else {
    delete attributes.excludedStaffNames;
  }
};

const addStaffToExclusionState = (
  state: { ids: Set<string>; names: Set<string> },
  member: StaffCandidate
) => {
  state.ids.add(member.id);
  state.names.add(normalizeForMatch(member.fullName));
};

const removeStaffFromExclusionState = (
  state: { ids: Set<string>; names: Set<string> },
  member: StaffCandidate
) => {
  state.ids.delete(member.id);
  staffAliasTexts(member).forEach((alias) => state.names.delete(alias));
};

const textHasGovernedStaffExclusion = (normalized: string, alias: string): boolean => {
  const aliasPattern = escapeRegExp(alias);
  return (
    new RegExp(`\\b(?:but\\s+not|except|not)\\s+(?:the\\s+)?(?:(?:staff|technician|tech)\\s+)?${aliasPattern}\\b`).test(normalized) ||
    new RegExp(`\\b(?:don\\s+t|dont|do\\s+not)\\s+want\\s+(?:the\\s+)?(?:(?:staff|technician|tech)\\s+)?${aliasPattern}\\b`).test(normalized) ||
    new RegExp(`\\bno\\s+i\\s+(?:don\\s+t|dont|do\\s+not)\\s+want\\s+(?:the\\s+)?(?:(?:staff|technician|tech)\\s+)?${aliasPattern}\\b`).test(normalized) ||
    new RegExp(`\\bonly\\s+staff(?:\\s+but)?\\s+not\\s+${aliasPattern}\\b`).test(normalized) ||
    new RegExp(`\\b${aliasPattern}\\b\\s+is\\s+not\\s+(?:ok|okay|fine)\\b`).test(normalized)
  );
};

const parseStaffIntent = (input: {
  text?: string | null;
  staff: StaffCandidate[];
  currentStaffId?: string;
  currentStaffName?: string;
  context?: StaffPhraseContext;
}): StaffIntentParseResult => {
  const normalized = normalizeForMatch(input.text);
  const observedAnyStaffExceptTrang = /\b(?:and\s+)?(?:he\s+)?stop\s+at\s+se\s+chang\b/.test(normalized);
  const excludedStaff: StaffCandidate[] = [];
  if (!normalized) {
    return {
      selectionMode: "UNKNOWN",
      excludedStaff,
      hasExplicitExclusion: false
    };
  }

  for (const member of input.staff) {
    const aliases = staffAliasTextsForActiveStaff(member, input.staff);
    const hasExcludedAlias = aliases.some((alias) => textHasGovernedStaffExclusion(normalized, alias));
    if (hasExcludedAlias) {
      excludedStaff.push(member);
    }
  }

  const trang = input.staff.find((member) => normalizeForMatch(member.fullName.split(/\s+/)[0]) === "trang");
  if (trang) {
    if (observedAnyStaffExceptTrang && !excludedStaff.some((member) => member.id === trang.id)) {
      excludedStaff.push(trang);
    }
    for (const alias of Array.from(TRANG_NEGATIVE_ASR_EXCLUSION_ALIASES.values())) {
      if (
        textHasGovernedStaffExclusion(normalized, alias) &&
        !hasExactActiveStaffNameCollision(input.staff, alias) &&
        !excludedStaff.some((member) => member.id === trang.id)
      ) {
        excludedStaff.push(trang);
      }
    }
  }

  const genericChange =
    /\b(?:someone else|another person|another staff|another stop|another technician|another tech|different person|different staff|different technician|different tech)\b/.test(
      normalized
    ) ||
    /\b(?:change|switch)\s+(?:the\s+)?(?:person|staff|technician|tech)\b/.test(normalized);
  if (genericChange) {
    const currentStaff = input.staff.find(
      (member) =>
        (input.currentStaffId && member.id === input.currentStaffId) ||
        staffMatchesName(member, input.currentStaffName)
    );
    if (currentStaff && !excludedStaff.some((member) => member.id === currentStaff.id)) {
      excludedStaff.push(currentStaff);
    }
  }

  const requestedAnyStaff =
    observedAnyStaffExceptTrang ||
    Boolean(normalizeAnyStaffPhrase(input.text, input.context)) ||
    /\b(?:first\s+avai?lable|available|anyone|anybody|any\s+staff|any\s+technician|any\s+tech)\b/.test(
      normalized
    ) ||
    ((input.context?.lastAskedSlot === "staffPreference" || input.context?.activeDtmfMenu === "staff") &&
      /\bonly\s+staff\b/.test(normalized));
  const positiveStaff = input.staff.find((member) => {
    if (excludedStaff.some((excluded) => excluded.id === member.id)) {
      return false;
    }
    return staffAliasTextsForActiveStaff(member, input.staff).some((alias) => !textHasGovernedStaffExclusion(normalized, alias) && textContainsStaffAlias(normalized, alias));
  });
  const selectionMode: StaffIntentParseResult["selectionMode"] = positiveStaff
    ? "SPECIFIC"
    : requestedAnyStaff
      ? "ANY"
      : genericChange
        ? "CHANGE"
        : "UNKNOWN";

  return {
    selectionMode,
    requestedStaff: positiveStaff,
    excludedStaff: dedupeStaffById(excludedStaff),
    hasExplicitExclusion: excludedStaff.length > 0
  };
};

const resolveCustomer = async (input: {
  salonId: string;
  actorUserId: string;
  customerName?: string;
  customerPhone?: string;
  createCustomerIfMissing: boolean;
}) => {
  const normalizedPhone = normalizeCustomerPhone(input.customerPhone);
  if (normalizedPhone) {
    const existingByPhone = await findExistingCustomerByPhone({
      salonId: input.salonId,
      customerPhone: normalizedPhone
    });
    if (existingByPhone) {
      return existingByPhone;
    }
  }

  if (!normalizedPhone && input.customerName) {
    const [firstNamePart, ...lastNameParts] = input.customerName.trim().split(/\s+/);
    const lastNamePart = lastNameParts.join(" ").trim();

    const existingByName = await prisma.customer.findFirst({
      where: {
        salonId: input.salonId,
        deletedAt: null,
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
  const lastName = lastNameParts.join(" ").trim();
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
  return orderStaffForPrompt(await prisma.staff.findMany({
    where: {
      salonId,
      status: StaffStatus.ACTIVE,
      isBookable: true,
      deletedAt: null
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

const getActiveBookableStaffById = async (
  salonId: string,
  staffId?: string
): Promise<StaffCandidate | null> => {
  if (!staffId?.trim()) {
    return null;
  }
  return prisma.staff.findFirst({
    where: {
      id: staffId.trim(),
      salonId,
      status: StaffStatus.ACTIVE,
      isBookable: true,
      deletedAt: null
    },
    select: {
      id: true,
      fullName: true
    }
  });
};

const getMappedActiveBookableStaffForService = async (input: {
  salonId: string;
  serviceId: string;
}): Promise<StaffCandidate[]> => {
  const rows = await prisma.staffService.findMany({
    where: {
      salonId: input.salonId,
      serviceId: input.serviceId,
      staff: {
        salonId: input.salonId,
        status: StaffStatus.ACTIVE,
        isBookable: true,
        deletedAt: null
      },
      service: {
        salonId: input.salonId,
        isActive: true,
        deletedAt: null
      }
    },
    select: {
      staff: {
        select: {
          id: true,
          fullName: true
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  return orderStaffForPrompt(dedupeStaffById(rows.map((row) => row.staff)));
};

const resolveStaffPreferenceFromCandidates = (
  staff: StaffCandidate[],
  requestedStaffName?: string,
  context: StaffPhraseContext = {}
): StaffPreferenceResolution => {
  const allStaff = orderStaffForPrompt(dedupeStaffById(staff));
  const rawStaffPreference = requestedStaffName?.trim();
  const scopedStaffPreference = normalizeScopedStaffCandidatePhrase(rawStaffPreference, context);
  const requested = normalizeForMatch(scopedStaffPreference ?? rawStaffPreference);

  if (!requested) {
    return {
      status: "missing",
      candidates: allStaff,
      allStaff,
      invalidReason: "missing"
    };
  }
  if (normalizeAnyStaffPhrase(scopedStaffPreference ?? rawStaffPreference, context)) {
    return {
      status: "explicit_any",
      candidates: allStaff,
      allStaff,
      rawStaffPreference,
      invalidReason: "explicit_any"
    };
  }
  if (isClearlyInvalidStaffPreference(requested)) {
    return {
      status: "invalid_noise",
      candidates: [],
      allStaff,
      rawStaffPreference,
      invalidReason: "invalid_format"
    };
  }

  const exactMatches = allStaff.filter((member) => {
    const aliases = new Set([
      normalizeForMatch(member.fullName),
      normalizeForMatch(member.fullName.split(/\s+/)[0]),
      ...getStaffAliasPhrases(member.fullName).map((alias) => normalizeForMatch(alias))
    ]);
    return Array.from(aliases).some(
      (alias) =>
        alias === requested &&
        !shouldSkipStaffAlias(member.fullName, alias, requested, context) &&
        !staffAliasCollidesWithExactActiveStaff(allStaff, member.fullName, alias)
    );
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
    const aliases = [
      normalizeForMatch(member.fullName),
      normalizeForMatch(member.fullName.split(/\s+/)[0]),
      ...getStaffAliasPhrases(member.fullName).map((alias) => normalizeForMatch(alias))
    ].filter(Boolean);
    return aliases.some(
      (alias) =>
        !shouldSkipStaffAlias(member.fullName, alias, requested, context) &&
        !staffAliasCollidesWithExactActiveStaff(allStaff, member.fullName, alias) &&
        requested.length >= 3 &&
        (alias.includes(requested) ||
          requested.includes(alias) ||
          (compactForMatch(alias).length >= 3 &&
            compactForMatch(alias).includes(compactForMatch(requested))))
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
      const aliases = [
        normalizeForMatch(member.fullName),
        normalizeForMatch(member.fullName.split(/\s+/)[0]),
        ...getStaffAliasPhrases(member.fullName).map((alias) => normalizeForMatch(alias))
      ].filter(
        (alias) =>
          alias &&
          !shouldSkipStaffAlias(member.fullName, alias, requested, context) &&
          !staffAliasCollidesWithExactActiveStaff(allStaff, member.fullName, alias)
      );
      const score = Math.max(...aliases.map((alias) => similarityScore(alias, requested)));
      const editDistanceMatch = aliases.some((alias) =>
        isConservativeStaffFuzzyMatch(alias, requested)
      );
      return { member, score, editDistanceMatch };
    })
    .filter((item) => item.editDistanceMatch || item.score >= 0.84)
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

  const trangAsrConfusion = resolveTrangAsrConfusionStaff(
    allStaff,
    scopedStaffPreference ?? rawStaffPreference,
    context
  );
  if (trangAsrConfusion) {
    return {
      status: "matched",
      candidates: [trangAsrConfusion],
      allStaff,
      rawStaffPreference: rawStaffPreference!,
      matchedStaff: trangAsrConfusion
    };
  }

  return {
    status: "unmatched_specific",
    candidates: [],
    allStaff,
    rawStaffPreference,
    invalidReason: "no_match"
  };
};

const resolveStaffCandidates = async (input: {
  salonId: string;
  requestedStaffName?: string;
  staffId?: string;
  attributes?: Record<string, unknown>;
  excludedStaffIds?: Set<string> | string[];
  excludedStaffNames?: Set<string> | string[];
}): Promise<StaffPreferenceResolution> => {
  const attributeExclusions = readStaffExclusionState(input.attributes);
  const excludedStaffIds = new Set([
    ...attributeExclusions.ids,
    ...(input.excludedStaffIds instanceof Set ? Array.from(input.excludedStaffIds) : input.excludedStaffIds ?? [])
  ]);
  const excludedStaffNames = new Set([
    ...attributeExclusions.names,
    ...(input.excludedStaffNames instanceof Set
      ? Array.from(input.excludedStaffNames)
      : input.excludedStaffNames ?? []
    ).map((name) => normalizeForMatch(name))
  ]);
  const activeStaff = await getActiveBookableStaff(input.salonId);
  const allStaff = filterExcludedStaff(activeStaff, excludedStaffIds, excludedStaffNames);
  const matchedById = await getActiveBookableStaffById(input.salonId, input.staffId);
  if (matchedById && !staffIsExcluded(matchedById, excludedStaffIds, excludedStaffNames)) {
    return {
      status: "matched",
      candidates: [matchedById],
      allStaff,
      rawStaffPreference: input.requestedStaffName || matchedById.fullName,
      matchedStaff: matchedById
    };
  }
  return resolveStaffPreferenceFromCandidates(
    allStaff,
    input.requestedStaffName,
    staffPhraseContextFromAttributes(input.attributes)
  );
};

const getStaffCandidates = async (input: {
  salonId: string;
  requestedStaffName?: string;
  staffId?: string;
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

async function findExistingCustomerByPhone(input: {
  salonId: string;
  customerPhone?: string | null;
}): Promise<CustomerCandidate | null> {
  const lookupValues = buildPhoneLookupValues(input.customerPhone);
  if (!lookupValues.length) {
    return null;
  }

  const exactMatch = await prisma.customer.findFirst({
    where: {
      salonId: input.salonId,
      deletedAt: null,
      phone: {
        in: lookupValues
      }
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true
    }
  });
  if (exactMatch) {
    return exactMatch;
  }

  const lookupDigits = stripLeadingCountryCode(input.customerPhone);
  const lastFour = lookupDigits.slice(-4);
  if (lookupDigits.length < 7 || lastFour.length < 4) {
    return null;
  }

  const possibleMatches = await prisma.customer.findMany({
    where: {
      salonId: input.salonId,
      deletedAt: null,
      phone: {
        contains: lastFour
      }
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true
    },
    take: 25,
    orderBy: {
      createdAt: "desc"
    }
  });

  return (
    possibleMatches.find((customer) => stripLeadingCountryCode(customer.phone) === lookupDigits) ?? null
  );
}

async function findUpcomingAppointmentsForCustomer(input: {
  salonId: string;
  customerId: string;
}): Promise<UpcomingAppointmentCandidate[]> {
  return prisma.appointment.findMany({
    where: {
      salonId: input.salonId,
      customerId: input.customerId,
      startTime: {
        gte: getReferenceJsDate()
      },
      status: {
        in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED]
      }
    },
    select: {
      id: true,
      startTime: true,
      service: {
        select: {
          name: true
        }
      },
      staff: {
        select: {
          fullName: true
        }
      }
    },
    orderBy: {
      startTime: "asc"
    },
    take: 3
  });
}

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

const isRequestedStartTimeInPast = (
  startTime: Date,
  timezone: string,
  now = getReferenceDateTime(timezone)
): boolean => DateTime.fromJSDate(startTime, { zone: "utc" }).setZone(timezone) < now;

const buildPastRequestedTimeDecision = (startTime: Date, timezone: string) => {
  const salonNow = getReferenceDateTime(timezone);
  const requestedLocal = DateTime.fromJSDate(startTime, { zone: "utc" }).setZone(timezone);
  const sameDay = requestedLocal.hasSame(salonNow, "day");
  const proposedTomorrow = salonNow.plus({ days: 1 }).toFormat("yyyy-MM-dd");
  const requestedLocalTime = formatLocalTimeForSpeech(startTime, timezone);
  return {
    sameDay,
    proposedRequestedDate: sameDay ? proposedTomorrow : undefined,
    proposedRequestedTime: requestedLocalTime,
    diagnostic: {
      salonTimezone: timezone,
      salonNowIso: salonNow.toUTC().toISO(),
      salonNowLocal: salonNow.toISO(),
      requestedLocalDate: requestedLocal.toFormat("yyyy-MM-dd"),
      requestedLocalTime,
      requestedLocalDateTime: requestedLocal.toISO(),
      requestedUtcDateTime: requestedLocal.toUTC().toISO(),
      comparisonTimestamp: salonNow.toUTC().toISO(),
      temporalComparison: requestedLocal < salonNow ? "requested_before_salon_now" : "requested_not_in_past",
      temporalRejectionReason: sameDay ? "past_same_day_time" : "past_requested_date",
      proposedRequestedDate: sameDay ? proposedTomorrow : null,
      proposedRequestedTime: requestedLocalTime
    }
  };
};

const buildPastRequestedTimeMessage = (decision: ReturnType<typeof buildPastRequestedTimeDecision>): string =>
  decision.sameDay
    ? speak(
        `${escapeSsml(decision.proposedRequestedTime)} today is earlier than the current time at the salon. Would you like ${escapeSsml(decision.proposedRequestedTime)} tomorrow?`
      )
    : speak("That date is earlier than today at the salon. What future day would you like?");

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

  const terminalCallStatuses = new Set<CallSessionStatus>([
    CallSessionStatus.COMPLETED,
    CallSessionStatus.MISSED,
    CallSessionStatus.FAILED,
    CallSessionStatus.CANCELED,
    CallSessionStatus.VOICEMAIL
  ]);
  const routingOutcome = input.routingOutcome ?? CallRoutingOutcome.AI_RECEPTION;
  const finalResolution = input.finalResolution ?? "Amazon Connect AI reception in progress.";
  const readProviderDisconnectedAt = (rawPayload: unknown): Date | null => {
    const timing = recordFromUnknown(recordFromUnknown(rawPayload).providerTiming);
    const rawTimestamp = readStringValue(timing.providerDisconnectedAt);
    const parsed = rawTimestamp ? new Date(rawTimestamp) : null;
    if (parsed && Number.isFinite(parsed.getTime())) {
      return parsed;
    }
    return null;
  };
  const existing = await prisma.callSession.findUnique({
    where: {
      provider_providerCallId: {
        provider: ExternalProvider.AMAZON_CONNECT,
        providerCallId: contactId
      }
    }
  });
  const existingIsTerminal = existing ? terminalCallStatuses.has(existing.status) : false;
  const existingProviderDisconnectedAt = existing
    ? readProviderDisconnectedAt(existing.rawPayload)
    : null;
  const existingIsProviderDisconnected = Boolean(existingProviderDisconnectedAt);

  if (existing) {
    const endedAt = existingProviderDisconnectedAt ?? existing.endedAt;
    const durationSeconds =
      endedAt && existing.startedAt
        ? Math.max(0, Math.round((endedAt.getTime() - existing.startedAt.getTime()) / 1000))
        : existing.durationSeconds;
    return prisma.callSession.update({
      where: {
        id: existing.id
      },
      data: {
        salonId: input.salonId,
        providerCompanyId: env.AMAZON_CONNECT_INSTANCE_ID,
        callerPhone: normalizePhoneForMatching(input.customerPhone) ?? existing.callerPhone,
        trackingNumber: normalizePhoneForMatching(input.amazonConnectPhoneNumber) ?? existing.trackingNumber,
        dialedPhone: normalizePhoneForMatching(input.calledNumber) ?? existing.dialedPhone,
        status: existingIsTerminal
          ? existing.status
          : existingIsProviderDisconnected
            ? CallSessionStatus.COMPLETED
            : CallSessionStatus.IN_PROGRESS,
        endedAt: existingIsProviderDisconnected ? endedAt : undefined,
        durationSeconds: existingIsProviderDisconnected ? durationSeconds : undefined,
        routingOutcome: existing.routingOutcome ?? routingOutcome,
        finalResolution:
          existingIsTerminal || existingIsProviderDisconnected
            ? existing.finalResolution ?? finalResolution
            : finalResolution
      }
    });
  }

  return prisma.callSession.create({
    data: {
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

const readProviderDisconnectedAtFromCallSession = (
  callSession?: {
    rawPayload?: unknown;
    endedAt?: Date | null;
  } | null
): Date | null => {
  if (!callSession) {
    return null;
  }
  const timing = recordFromUnknown(recordFromUnknown(callSession.rawPayload).providerTiming);
  const rawTimestamp = readStringValue(timing.providerDisconnectedAt);
  const parsed = rawTimestamp ? new Date(rawTimestamp) : null;
  if (parsed && Number.isFinite(parsed.getTime())) {
    return parsed;
  }
  return null;
};

const readIncomingAmazonConnectTurnTimestamp = (
  input: CreateAmazonConnectAIAppointmentInput
): Date => {
  const attributes = recordFromUnknown(input.attributes);
  const raw =
    readStringValue(attributes.turnTimestamp) ||
    readStringValue(attributes.providerTranscriptTimestamp) ||
    readStringValue(attributes.lambdaReceivedAt) ||
    readStringValue(attributes.apiStartedAt) ||
    readStringValue(attributes.createdAt);
  const parsed = raw ? new Date(raw) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed : new Date();
};

const isPostProviderDisconnectTurn = (
  input: CreateAmazonConnectAIAppointmentInput,
  callSession?: {
    rawPayload?: unknown;
    endedAt?: Date | null;
  } | null
): { stale: boolean; providerDisconnectedAt: Date | null; turnTimestamp: Date } => {
  const providerDisconnectedAt = readProviderDisconnectedAtFromCallSession(callSession);
  const turnTimestamp = readIncomingAmazonConnectTurnTimestamp(input);
  return {
    stale: Boolean(providerDisconnectedAt && turnTimestamp.getTime() > providerDisconnectedAt.getTime()),
    providerDisconnectedAt,
    turnTimestamp
  };
};

const buildAmazonConnectTimingDiagnostics = (input: {
  attributes?: Record<string, unknown>;
  promptText?: string;
  promptExpectedToPlay?: boolean;
  providerDisconnectedAt?: Date | null;
}) => {
  const attributes = input.attributes ?? {};
  const apiCompletedAt = new Date().toISOString();
  const rawApiStartedAt = readStringValue(attributes.apiStartedAt);
  const lambdaReceivedAt = readStringValue(attributes.lambdaReceivedAt);
  const rawLambdaRespondedAt = readStringValue(attributes.lambdaRespondedAt);
  const providerDisconnectedAt =
    input.providerDisconnectedAt?.toISOString() ||
    readStringValue(attributes.providerDisconnectedAt);
  const apiStartedMs = rawApiStartedAt ? Date.parse(rawApiStartedAt) : NaN;
  const apiCompletedMs = Date.parse(apiCompletedAt);
  const lambdaReceivedMs = lambdaReceivedAt ? Date.parse(lambdaReceivedAt) : NaN;
  const rawLambdaRespondedMs = rawLambdaRespondedAt ? Date.parse(rawLambdaRespondedAt) : NaN;
  const apiStartedAt =
    Number.isFinite(apiStartedMs) && apiStartedMs <= apiCompletedMs ? rawApiStartedAt : null;
  const lambdaRespondedAt =
    Number.isFinite(rawLambdaRespondedMs) &&
    (!Number.isFinite(lambdaReceivedMs) || rawLambdaRespondedMs >= lambdaReceivedMs) &&
    rawLambdaRespondedMs >= apiCompletedMs
      ? rawLambdaRespondedAt
      : null;
  const lambdaRespondedMs = lambdaRespondedAt ? rawLambdaRespondedMs : NaN;
  return {
    providerTranscriptTimestamp: readStringValue(attributes.providerTranscriptTimestamp) || null,
    lambdaReceivedAt: lambdaReceivedAt || null,
    apiStartedAt,
    apiCompletedAt,
    lambdaRespondedAt,
    lambdaProcessingMs: Number.isFinite(lambdaReceivedMs) && Number.isFinite(lambdaRespondedMs)
        ? Math.max(0, lambdaRespondedMs - lambdaReceivedMs)
        : null,
    apiProcessingMs: Number.isFinite(apiStartedMs) && Number.isFinite(apiCompletedMs)
        ? Math.max(0, apiCompletedMs - apiStartedMs)
        : null,
    connectBranch:
      readStringValue(attributes.connectBranch) ||
      readStringValue(attributes.connectRecoveryStage) ||
      readStringValue(attributes.connectLastErrorBranch) ||
      null,
	    promptText: input.promptText || null,
	    promptExpectedToPlay: input.promptExpectedToPlay ?? true,
	    promptPlaybackConfirmed: false,
	    playbackEvidenceStage: readStringValue(attributes.playbackEvidenceStage) || "LAMBDA_RESPONSE_ONLY",
	    providerDisconnectedAt: providerDisconnectedAt || null
	  };
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
    : getReferenceDateTime(input.timezone);

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
        ? input.escalation?.messageToCaller ?? OPERATOR_TRANSFER_PROMPT
        : input.resolution,
    updatedAt: new Date().toISOString()
  };
};

const asTrimmedString = (value?: unknown): string | undefined => {
  const trimmed = typeof value === "string" ? value.trim() : undefined;
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
};

const readLexTurnDebugServiceSlotValue = (lexTurnDebug?: Record<string, unknown>): string | undefined => {
  if (!lexTurnDebug) {
    return undefined;
  }
  const originalSlots = recordFromUnknown(lexTurnDebug.slotsOriginalValues);
  const interpretedSlots = recordFromUnknown(lexTurnDebug.slotsInterpretedValues);
  return asTrimmedString(originalSlots.serviceName) ?? asTrimmedString(interpretedSlots.serviceName);
};

const buildApiReleaseIdentity = () => ({
  VOICE_API_RELEASE_ID: env.FASTAIBOOKING_API_RELEASE_ID ?? "",
  VOICE_API_SOURCE_SHA256: env.FASTAIBOOKING_API_SOURCE_SHA256 ?? "",
  VOICE_API_VARIANT: env.FASTAIBOOKING_API_VARIANT ?? ""
});

const buildVoiceReleaseIdentity = (attributes?: Record<string, unknown>) => {
  const source = recordFromUnknown(attributes);
  const pick = (name: string) => asTrimmedString(source[name]);
  return {
    VOICE_RELEASE_ID: pick("VOICE_RELEASE_ID"),
    VOICE_VARIANT: pick("VOICE_VARIANT"),
    VOICE_SOURCE_SHA256: pick("VOICE_SOURCE_SHA256"),
    VOICE_CONNECT_FLOW_ID: pick("VOICE_CONNECT_FLOW_ID"),
    VOICE_CONNECT_MARKER: pick("VOICE_CONNECT_MARKER") ?? pick("connectFlowSourceVersion"),
    VOICE_LEX_ALIAS_ID: pick("VOICE_LEX_ALIAS_ID"),
    VOICE_LEX_ALIAS_ARN: pick("VOICE_LEX_ALIAS_ARN"),
    VOICE_LEX_BOT_VERSION: pick("VOICE_LEX_BOT_VERSION"),
    VOICE_LAMBDA_FUNCTION_NAME: pick("VOICE_LAMBDA_FUNCTION_NAME"),
    VOICE_LAMBDA_FUNCTION_VERSION: pick("VOICE_LAMBDA_FUNCTION_VERSION"),
    VOICE_LAMBDA_CODE_SHA256: pick("VOICE_LAMBDA_CODE_SHA256"),
    ...buildApiReleaseIdentity()
  };
};

const findKnownCallerMemoryByPhone = async (input: {
  salonId: string;
  customerPhone?: string | null;
}): Promise<{ customerName: string; customerPhone?: string; source: string } | null> => {
  const existingCustomer = await findExistingCustomerByPhone(input);
  if (existingCustomer) {
    const existingCustomerName = getReusableCustomerDisplayName(existingCustomer);
    if (existingCustomerName) {
      return {
        customerName: existingCustomerName,
        customerPhone: existingCustomer.phone,
        source: "customer"
      };
    }
  }

  return null;
};

const hasTimeComponent = (value?: string): boolean => {
  if (!value) {
    return false;
  }
  if (normalizeGpsTimePhrase(value)) {
    return true;
  }
  return /T\d{1,2}:\d{2}|[^\d]\d{1,2}:\d{2}|\b\d{1,2}\s?(?:a\.?\s?m\.?|p\.?\s?m\.?)\b|\b(one|two|three|tree|tri|four|five|fife|six|seven|eight|nine|ten|eleven|twelve)\s?(?:a\.?\s?m\.?|p\.?\s?m\.?)\b/i.test(
    value
  ) || new RegExp(
    `\\b(?:at|around|about|for|by)\\s+(?:${SPOKEN_HOUR_PATTERN}|[1-7])(?::[0-5]\\d)?\\b`,
    "i"
  ).test(value) || new RegExp(
    `${DATE_PHRASE_PATTERN}\\s+(?:at\\s+)?(?:${SPOKEN_HOUR_PATTERN}|[1-7])(?::[0-5]\\d)?\\b`,
    "i"
  ).test(value);
};

const normalizeAmazonConnectAppointmentInput = (input: CreateAmazonConnectAIAppointmentInput) => {
  const attributes = input.attributes ?? {};
  const lastAskedSlot = readStringAttribute(attributes, ["lastAskedSlot"]);
  const activeDtmfMenu = readStringAttribute(attributes, ["activeDtmfMenu"]);
  const timePhraseContext: TimePhraseContext = {
    lastAskedSlot,
    currentTurnSemanticType: readStringAttribute(attributes, ["currentTurnSemanticType"]),
    currentTurnHasDatePhrase: hasGroundedDatePhrase(
      asTrimmedString(input.currentTurnTranscript) ??
        readStringAttribute(attributes, ["currentTurnTranscript"]) ??
        asTrimmedString(input.text)
    )
  };
  const lexTurnDebug =
    input.attributes &&
    typeof input.attributes.lexTurnDebug === "object" &&
    input.attributes.lexTurnDebug !== null &&
    !Array.isArray(input.attributes.lexTurnDebug)
      ? (input.attributes.lexTurnDebug as Record<string, unknown>)
      : undefined;
  const currentTurnTranscriptWasProvided =
    Object.prototype.hasOwnProperty.call(input, "currentTurnTranscript") ||
    Object.prototype.hasOwnProperty.call(attributes, "currentTurnTranscript") ||
    Boolean(lexTurnDebug && Object.prototype.hasOwnProperty.call(lexTurnDebug, "currentTurnTranscript"));
  const currentTurnTranscript =
    asTrimmedString(input.currentTurnTranscript) ??
    readStringAttribute(attributes, ["currentTurnTranscript"]) ??
    asTrimmedString(lexTurnDebug?.currentTurnTranscript) ??
    (currentTurnTranscriptWasProvided ? undefined : asTrimmedString(input.text));
  const aggregatedBookingTranscript =
    asTrimmedString(input.aggregatedBookingTranscript) ??
    readStringAttribute(attributes, ["aggregatedBookingTranscript"]) ??
    asTrimmedString(input.transcript) ??
    currentTurnTranscript;
  const transcriptText =
    currentTurnTranscript ?? (currentTurnTranscriptWasProvided ? undefined : aggregatedBookingTranscript);
  const suggestedServiceName = readStringAttribute(attributes, [
    "serviceSuggestionName",
    "aiSuggestedServiceName"
  ]);
  const lexServiceSlotValue = readLexTurnDebugServiceSlotValue(lexTurnDebug);
  const serviceDtmfScoped = activeDtmfMenu === "service";
  const staffDtmfScoped = activeDtmfMenu === "staff";
  const inputMode = asTrimmedString(input.inputMode) ?? readStringAttribute(attributes, ["inputMode"]);
  const inputModeSource =
    asTrimmedString(input.inputMode)
      ? "payload.inputMode"
      : readStringAttribute(attributes, ["inputMode"])
        ? "attributes.inputMode"
        : "unknown";
  const genuineDtmfInput = inputMode?.toLowerCase() === "dtmf";
  const speechInput = inputMode?.toLowerCase() === "speech";
  const spokenDigitCandidate = speechInput
    ? [
        transcriptText,
        asTrimmedString(input.serviceName),
        asTrimmedString(input.service),
        asTrimmedString(input.staffPreference)
      ]
        .map((value) => readSpokenDigitCandidate(value))
        .find((value): value is string => Boolean(value))
    : undefined;
  const serviceSpokenMenuSelection =
    serviceDtmfScoped && spokenDigitCandidate
      ? readServiceDtmfOptions(attributes)[spokenDigitCandidate]
      : undefined;
  const staffSpokenMenuSelection =
    staffDtmfScoped && spokenDigitCandidate
      ? readStaffDtmfOptions(attributes)[spokenDigitCandidate]
      : undefined;
  const serviceDtmfSelection =
    readScopedDtmfSelection(
      serviceDtmfScoped,
      genuineDtmfInput,
      [
        transcriptText,
        asTrimmedString(input.serviceName),
        asTrimmedString(input.service),
        readBookingFieldAttribute(attributes, "serviceName")
      ],
      readServiceDtmfOptions(attributes)
    ) ??
    (serviceSpokenMenuSelection && serviceSpokenMenuSelection !== "__operator__"
      ? serviceSpokenMenuSelection
      : undefined);
  const staffDtmfSelection =
    readScopedDtmfSelection(
      staffDtmfScoped,
      genuineDtmfInput,
      [
        transcriptText,
        asTrimmedString(input.staffPreference),
        readBookingFieldAttribute(attributes, "staffPreference")
      ],
      readStaffDtmfOptions(attributes)
    ) ??
    (staffSpokenMenuSelection && staffSpokenMenuSelection !== "__operator__"
      ? staffSpokenMenuSelection
      : undefined);
  const serviceDtmfDigit =
    serviceDtmfScoped && genuineDtmfInput
      ? [
          transcriptText,
          asTrimmedString(input.serviceName),
          asTrimmedString(input.service),
          readBookingFieldAttribute(attributes, "serviceName")
        ]
          .map((value) => readDtmfDigit(value))
          .find((value): value is string => Boolean(value))
      : serviceDtmfScoped && spokenDigitCandidate
        ? spokenDigitCandidate
        : undefined;
  const staffDtmfDigit =
    staffDtmfScoped && genuineDtmfInput
      ? [
          transcriptText,
          asTrimmedString(input.staffPreference),
          readBookingFieldAttribute(attributes, "staffPreference")
        ]
          .map((value) => readDtmfDigit(value))
          .find((value): value is string => Boolean(value))
      : staffDtmfScoped && spokenDigitCandidate
        ? spokenDigitCandidate
        : undefined;
  if (spokenDigitCandidate && (serviceDtmfScoped || staffDtmfScoped)) {
    const proposedSpokenSelection = serviceDtmfScoped
      ? readServiceDtmfOptions(attributes)[spokenDigitCandidate]
      : readStaffDtmfOptions(attributes)[spokenDigitCandidate];
    attributes.inputMode = inputMode ?? "Speech";
    attributes.inputModeSource = inputModeSource;
    attributes.spokenDigitCandidate = spokenDigitCandidate;
    if (proposedSpokenSelection && proposedSpokenSelection !== "__operator__") {
      attributes.spokenMenuSelectionAccepted = "true";
      attributes.spokenMenuSelectionProposed = "false";
      attributes.dtmfAccepted = "true";
      attributes.dtmfRejectedReason = "";
      if (serviceDtmfScoped) {
        attributes.serviceRecognitionSource = "speech_menu_digit";
        attributes.serviceRecognitionConfidence = "";
        attributes.asrConfidenceSource = "unknown";
      } else {
        attributes.staffRecognitionSource = "speech_menu_digit";
      }
    } else {
      attributes.spokenMenuSelectionAccepted = "false";
      attributes.spokenMenuSelectionProposed = "false";
      attributes.invalidMenuChoice = spokenDigitCandidate;
      attributes.dtmfAccepted = "false";
      attributes.dtmfRejectedReason = "digit_not_in_active_menu";
    }
  }
  if (serviceDtmfSelection) {
    attributes.awaitingServiceConfirmation = "false";
    attributes.proposedServiceName = "";
    attributes.spokenMenuSelectionProposed = "false";
    attributes.serviceDtmfConflictWithInitialUtterance = "";
    attributes.clarificationReason = "";
  }
  if (staffDtmfSelection) {
    attributes.proposedStaffPreference = "";
    attributes.staffClarificationReason = "";
    attributes.spokenMenuSelectionProposed = "false";
  }
  const staffDtmfStaffId =
    staffDtmfDigit && staffDtmfSelection
      ? readStaffDtmfStaffIds(attributes)[staffDtmfDigit]
      : undefined;
  const bookingConfirmation =
    asTrimmedString(input.bookingConfirmation) ??
    readStringAttribute(attributes, ["bookingConfirmation"]);
  const customerName =
    asTrimmedString(input.customerName) ??
    asTrimmedString(input.customer?.name) ??
    readBookingFieldAttribute(attributes, "customerName");
  const amazonConnectCallerPhone =
    asTrimmedString(input.callerPhone) ?? readBookingFieldAttribute(attributes, "customerPhone");
  const customerPhone =
    amazonConnectCallerPhone ??
    asTrimmedString(input.customerPhone) ??
    asTrimmedString(input.customer?.phone) ??
    readBookingFieldAttribute(attributes, "customerPhone");
  const currentTurnIsDigitNoise = isDigitOnlyOrSequenceUtterance(transcriptText);
  const confirmedServiceName = readStringAttribute(attributes, ["confirmedServiceName"]);
  const inputServiceName = asTrimmedString(input.serviceName) ?? asTrimmedString(input.service);
  const serviceCaptureContext =
    lastAskedSlot === "serviceName" ||
    activeDtmfMenu === "service" ||
    /\b(?:service|services|nail service|nail services)\b/i.test(transcriptText ?? "");
  const rawServiceName =
    serviceDtmfSelection ??
    (currentTurnIsDigitNoise && confirmedServiceName ? confirmedServiceName : undefined) ??
    inputServiceName ??
    readBookingFieldAttribute(attributes, "serviceName");
  const serviceCandidate =
    rawServiceName && isAffirmative(rawServiceName) && suggestedServiceName
      ? suggestedServiceName
      : rawServiceName;
  const serviceRecognitionText = [serviceCandidate, currentTurnTranscript, transcriptText]
    .filter(Boolean)
    .join(" ");
  const normalizedServiceCandidate = normalizeForMatch(serviceCandidate);
  const fullSetFromTranscript = recognizeFullSetFromText(serviceRecognitionText, {
    lastAskedSlot,
    activeDtmfMenu
  });
  const unsafeSunsetServiceSlot =
    hasUnsafeSunsetWithoutExplicitFullSetAlias(serviceRecognitionText) &&
    (normalizedServiceCandidate === "full set" ||
      /\bsun\s*set\b/.test(normalizedServiceCandidate));
  let serviceName =
    fullSetFromTranscript ??
    (serviceCandidate && !unsafeSunsetServiceSlot && !isClearlyInvalidServiceName(serviceCandidate)
      ? getCustomerFacingServiceName(serviceCandidate)
      : undefined);
  if (
    serviceName &&
    inputServiceName &&
    !serviceDtmfSelection &&
    !readBookingFieldAttribute(attributes, "serviceName") &&
    !readStringAttribute(attributes, ["confirmedServiceName"]) &&
    serviceCaptureContext &&
    normalizeForMatch(inputServiceName) === normalizeForMatch(serviceCandidate) &&
    (!lexServiceSlotValue ||
      normalizeForMatch(lexServiceSlotValue) === normalizeForMatch(inputServiceName)) &&
    !serviceNameHasCurrentTurnEvidence(serviceName, transcriptText, attributes)
  ) {
    attributes.ignoredUngroundedSlots = JSON.stringify([
      ...new Set([
        ...parseStringArrayAttribute(attributes.ignoredUngroundedSlots),
        "serviceName_unverified_lex_slot"
      ])
    ]);
    serviceName = undefined;
  }
  if (isBillingLikeServiceCollision(serviceRecognitionText)) {
    serviceName = undefined;
  }
  const initialBookingUtterance = readStringAttribute(attributes, ["initialBookingUtterance"]);
  const initialFullSetService =
    serviceDtmfSelection && initialBookingUtterance
      ? recognizeFullSetFromText(initialBookingUtterance, {
          lastAskedSlot: "serviceName",
          activeDtmfMenu: "service"
        })
      : undefined;
  if (
    serviceDtmfSelection &&
    initialFullSetService &&
    normalizeForMatch(initialFullSetService) !== normalizeForMatch(serviceDtmfSelection)
  ) {
    attributes.awaitingServiceConfirmation = "true";
    attributes.proposedServiceName = serviceDtmfSelection;
    attributes.serviceDtmfConflictWithInitialUtterance = initialFullSetService;
    attributes.clarificationReason = "service_dtmf_conflicts_initial_utterance";
    serviceName = undefined;
  }
  const previousRequestedDate = normalizeRequestedDateForState(
    readBookingFieldAttribute(attributes, "requestedDate")
  );
  const previousRequestedTime = readBookingFieldAttribute(attributes, "requestedTime");
  const inputRequestedDate = normalizeRequestedDateForState(
    asTrimmedString(input.requestedDate) ?? asTrimmedString(input.preferredDateTime)
  );
  const inputRequestedTime = asTrimmedString(input.requestedTime);
  const currentTurnHasDate = hasGroundedDatePhrase(transcriptText);
  const currentTurnHasTime = hasGroundedTimePhrase(transcriptText, timePhraseContext);
  const transcriptRequestedTime = currentTurnHasTime
    ? extractExplicitTime(transcriptText, timePhraseContext)
    : undefined;
  const groundedInputRequestedTime =
    inputRequestedTime &&
    transcriptRequestedTime &&
    localTimesEquivalent(inputRequestedTime, transcriptRequestedTime)
      ? inputRequestedTime
      : undefined;
  const shouldRejectUngroundedInputTime =
    Boolean(inputRequestedTime) &&
    currentTurnTranscriptWasProvided &&
    !currentTurnHasTime &&
    hasRequestedTimeContext(timePhraseContext);
  const requestedDate =
    currentTurnIsDigitNoise && previousRequestedDate
      ? previousRequestedDate
      : inputRequestedDate && previousRequestedDate && !currentTurnHasDate
        ? previousRequestedDate
        : currentTurnIsDigitNoise
          ? previousRequestedDate
          : inputRequestedDate ?? previousRequestedDate;
  const requestedTimeCandidate =
    currentTurnIsDigitNoise && previousRequestedTime
      ? previousRequestedTime
      : shouldRejectUngroundedInputTime
        ? previousRequestedTime
      : inputRequestedTime && previousRequestedTime && !currentTurnHasTime
        ? previousRequestedTime
      : currentTurnIsDigitNoise
          ? previousRequestedTime
          : groundedInputRequestedTime ?? transcriptRequestedTime ?? inputRequestedTime ?? previousRequestedTime;
  const requestedTimeMutationPolicy = buildVoiceSlotMutationPolicy({
    slotName: "requestedTime",
    proposedValue: requestedTimeCandidate,
    trustedValue: previousRequestedTime,
    transcript: transcriptText,
    attributes
  });
  const requestedTimeVoiceSlotDecision = mutationPolicyToVoiceSlotDecision(
    requestedTimeMutationPolicy,
    [transcriptText],
    parseAsrAlternativeDiagnostics(attributes).length > 1
  );
  if (requestedTimeCandidate && !requestedTimeMutationPolicy.accepted) {
    attributes.preventedSlotMutations = JSON.stringify([requestedTimeMutationPolicy]);
    attributes.proposedSlotMutation = JSON.stringify(requestedTimeMutationPolicy);
    attributes.voiceSlotDecisions = withVoiceSlotDecision(attributes, requestedTimeVoiceSlotDecision);
  } else if (requestedTimeCandidate) {
    attributes.acceptedSlotMutations = JSON.stringify([requestedTimeMutationPolicy]);
    attributes.proposedSlotMutation = JSON.stringify(requestedTimeMutationPolicy);
    attributes.voiceSlotDecisions = withVoiceSlotDecision(attributes, requestedTimeVoiceSlotDecision);
  }
  const requestedTime =
    requestedTimeCandidate && requestedTimeMutationPolicy.accepted
      ? requestedTimeCandidate
      : previousRequestedTime;
  const contactId =
    asTrimmedString(input.amazonConnectContactId) ??
    asTrimmedString(input.contactId) ??
    asTrimmedString(input.callSessionId) ??
    readBookingFieldAttribute(attributes, "contactId");
  const intentName = asTrimmedString(input.intentName);
  const source = asTrimmedString(input.source) ?? readBookingFieldAttribute(attributes, "source") ?? "AMAZON_CONNECT_LEX";

  return {
    intentName,
    customerName,
    customerPhone,
    serviceName,
    serviceDtmfDigit,
    invalidServiceDtmfSelection:
      Boolean(serviceDtmfDigit) &&
      !serviceDtmfSelection &&
      Boolean(Object.keys(readServiceDtmfOptions(attributes)).length),
    requestedDate,
    requestedTime,
    staffPreference:
      staffDtmfSelection ??
      asTrimmedString(input.staffPreference) ??
      readBookingFieldAttribute(attributes, "staffPreference"),
    staffId:
      staffDtmfStaffId ??
      asTrimmedString(input.staffId) ??
      asTrimmedString(input.selectedStaffId) ??
      readBookingFieldAttribute(attributes, "staffId"),
    staffDtmfDigit,
    invalidStaffDtmfSelection:
      Boolean(staffDtmfDigit) && !staffDtmfSelection && Boolean(Object.keys(readStaffDtmfOptions(attributes)).length),
    unrecognizedStaffUtterance: undefined as string | undefined,
    bookingConfirmation,
    confirmationState: asTrimmedString(input.confirmationState),
    source,
    contactId,
    transcriptText,
    currentTurnTranscript,
    currentTurnTranscriptWasProvided,
    aggregatedBookingTranscript,
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

const currentTurnHasBookingDetails = (input: ReturnType<typeof normalizeAmazonConnectAppointmentInput>): boolean =>
  {
    const text = input.currentTurnTranscript ?? input.transcriptText;
    return Boolean(
      hasStaticServiceAliasInText(text) ||
      hasGroundedDatePhrase(text) ||
      hasGroundedTimePhrase(input.currentTurnTranscript ?? input.transcriptText, {
        lastAskedSlot: readStringAttribute(input.attributes, ["lastAskedSlot"]),
        currentTurnSemanticType: readStringAttribute(input.attributes, ["currentTurnSemanticType"])
      }) ||
      normalizeAnyStaffPhrase(text, staffPhraseContextFromAttributes(input.attributes))
    );
  };

const applyFreshBookingResetToNormalized = (
  normalized: ReturnType<typeof normalizeAmazonConnectAppointmentInput>,
  extra: Record<string, unknown> = {}
): void => {
  applyAttributeClears(normalized.attributes, getBookingFrameResetKeys());
  normalized.serviceName = undefined;
  normalized.requestedDate = undefined;
  normalized.requestedTime = undefined;
  normalized.staffPreference = undefined;
  normalized.staffId = undefined;
  normalized.bookingConfirmation = undefined;
  normalized.confirmationState = undefined;
  Object.assign(normalized.attributes, {
    ...extra,
    freshBookingRestart: "true",
    restartBookingFrameCleared: "true",
    awaitingFinalBookingConfirmation: "false",
    bookingConfirmationAsked: "false",
    awaitingRejectedBookingChoice: "false",
    sessionAttributeKeysToClear: JSON.stringify(getBookingFrameResetKeys())
  });
};

const classifyRejectedBookingChoice = (
  value: string | undefined,
  normalized: ReturnType<typeof normalizeAmazonConnectAppointmentInput>
): "NEW_BOOKING" | "CHANGE_REQUEST" | "CHANGE_DETAIL_MENU" | "STOP" | "UNKNOWN" => {
  const normalizedText = normalizeForMatch(value);
  if (!normalizedText) {
    return "UNKNOWN";
  }
  if (
    /^(?:no|nope|nah|no thanks|never mind|nevermind|forget it|stop|i m done|im done|done)$/.test(normalizedText) ||
    /\b(?:do not book anything|don t book anything|dont book anything|no thanks|never mind|forget it|stop|goodbye)\b/.test(
      normalizedText
    )
  ) {
    return "STOP";
  }
  if (hasFreshBookingRestartIntent(value) || isAffirmative(value)) {
    return "NEW_BOOKING";
  }
  if (/\bchange(?:\s+a)?\s+detail\b/.test(normalizedText) && !currentTurnHasBookingDetails(normalized)) {
    return "CHANGE_DETAIL_MENU";
  }
  if (
    currentTurnHasBookingDetails(normalized) ||
    /\b(?:change|make it|instead|switch|move it|use)\b/.test(normalizedText)
  ) {
    return "CHANGE_REQUEST";
  }
  return "UNKNOWN";
};

const pickNormalizedAppointmentDebug = (
  normalized: ReturnType<typeof normalizeAmazonConnectAppointmentInput>
) => ({
  customerName: normalized.customerName,
  customerPhone: normalized.customerPhone,
  serviceName: normalized.serviceName,
  requestedDate: normalized.requestedDate,
  requestedTime: normalized.requestedTime,
  staffPreference: normalized.staffPreference,
  staffId: normalized.staffId,
  contactId: normalized.contactId,
  currentTurnTranscript: normalized.currentTurnTranscript,
  aggregatedBookingTranscript: normalized.aggregatedBookingTranscript,
  lastAskedSlot: readStringAttribute(normalized.attributes, ["lastAskedSlot"]),
  activeDtmfMenu: readStringAttribute(normalized.attributes, ["activeDtmfMenu"]),
  ignoredUngroundedSlots: readStringAttribute(normalized.attributes, ["ignoredUngroundedSlots"]),
  ignoredNoiseFields: readStringAttribute(normalized.attributes, ["ignoredNoiseFields"])
});

const hasIgnoredCustomerNameNoise = (attributes?: Record<string, unknown>): boolean =>
  parseSessionAttributeKeysToClear(readStringAttribute(attributes, ["ignoredNoiseFields"]))
    .includes("customerName");

const shouldTransferToHuman = (input: {
  intentName?: string;
  transcriptText?: string;
  serviceName?: string;
  staffPreference?: string;
  attributes?: Record<string, unknown>;
}): boolean => {
  return Boolean(getHumanEscalationReason(input));
};

const getHumanEscalationReason = (input: {
  intentName?: string;
  transcriptText?: string;
  serviceName?: string;
  staffPreference?: string;
  attributes?: Record<string, unknown>;
}): "customer_pressed_zero" | "caller_requested_human" | undefined => {
  const intent = input.intentName?.toLowerCase();
  const staffPromptAnyStaffZero =
    readStringAttribute(input.attributes, ["lastAskedSlot"]) === "staffPreference" &&
    readDtmfDigit(input.transcriptText) === "0" &&
    isAnyStaffPreference(input.staffPreference);
  if (
    readStringAttribute(input.attributes, ["escalationReason"]) === "customer_pressed_zero" ||
    (!staffPromptAnyStaffZero && isOperatorZeroRequest(input.transcriptText)) ||
    isOperatorZeroRequest(input.serviceName) ||
    isOperatorZeroRequest(input.staffPreference)
  ) {
    return "customer_pressed_zero";
  }

  if (
    readStringAttribute(input.attributes, ["humanEscalationOffer"]) &&
    (isAffirmative(input.transcriptText) || isAffirmative(input.serviceName))
  ) {
    return "caller_requested_human";
  }

  const text = input.transcriptText?.toLowerCase() ?? "";
  if (
    /\b(real person|live person|human|operator|representative|talk to a person|talk with a person|talk to someone|speak to a person|speak with a person|speak to someone|speak with someone|speak to an operator|speak with an operator|speak with an agent|speak to an agent|talk to an agent|representative please)\b/.test(text)
  ) {
    return "caller_requested_human";
  }

  if (intent === "humanescalationintent") {
    const confidence = readNumberAttribute(input.attributes, [
      "intentConfidence",
      "nluConfidence",
      "lexIntentConfidence"
    ]);
    if (confidence !== undefined && confidence >= 0.7) {
      return "caller_requested_human";
    }
  }

  return undefined;
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

const orderStaffForPrompt = <T extends { fullName: string }>(staff: T[]): T[] => [...staff];

const buildStaffDtmfOptionMaps = (
  staff: StaffCandidate[]
): { options: Record<string, string>; staffIds: Record<string, string> } => {
  const orderedStaff = orderStaffForPrompt(dedupeStaffById(staff));
  const options: Record<string, string> = {};
  const staffIds: Record<string, string> = {};
  orderedStaff.forEach((member, index) => {
    const digit = String(index + 1);
    options[digit] = member.fullName;
    staffIds[digit] = member.id;
  });
  options[String(orderedStaff.length + 1)] = "Any staff";
  return { options, staffIds };
};

const buildStaffDtmfPromptText = (staff: StaffCandidate[]): string => {
  const orderedStaff = orderStaffForPrompt(dedupeStaffById(staff));
  if (!orderedStaff.length) {
    return "I don't see any active bookable staff right now. I can check any available staff, or you can say operator to speak with a person.";
  }

  const staffNames = orderedStaff.map((member) => member.fullName);
  if (orderedStaff.length > 4) {
    return `Which staff would you like, ${escapeSsml(
      staffNames.slice(0, 4).join(", ")
    )}, or first available?`;
  }

  return `Which staff would you like, ${escapeSsml(
    staffNames.join(", ")
  )}, or first available?`;
};

const buildStaffNumberedDtmfPromptText = (staff: StaffCandidate[]): string => {
  const { options } = buildStaffDtmfOptionMaps(staff);
  const optionPhrases = Object.entries(options).map(
    ([digit, staffName]) =>
      normalizeForMatch(staffName) === "any staff"
        ? `press ${digit} for first available`
        : `press ${digit} for ${staffName}`
  );
  return optionPhrases.length
    ? `${optionPhrases.join(", ")}, or press 0 for an operator.`
    : buildStaffDtmfPromptText(staff);
};

const buildStaffPromptSessionAttributes = (staff: StaffCandidate[]): Record<string, string> => {
  const { options, staffIds } = buildStaffDtmfOptionMaps(staff);
  const staffMenuFingerprint = createHash("sha1")
    .update(JSON.stringify({ options, staffIds }))
    .digest("hex")
    .slice(0, 12);
  return {
    staffDtmfOptions: JSON.stringify(options),
    staffDtmfStaffIds: JSON.stringify(staffIds),
    staffDtmfPromptText: buildStaffDtmfPromptText(staff),
    staffMenuFingerprint,
    menuFingerprint: staffMenuFingerprint,
    activeDtmfMenu: "staff",
    activeDtmfOptionsJson: JSON.stringify({
      ...options,
      "0": "__operator__"
    })
  };
};

const getActiveServiceMenuServices = async (salonId: string): Promise<ServiceMenuCandidate[]> => {
  const services = await prisma.service.findMany({
    where: {
      salonId,
      isActive: true,
      deletedAt: null
    },
    select: {
      id: true,
      name: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  const seen = new Set<string>();
  const activeServices = services
    .map((service) => ({
      id: service.id,
      name: getCustomerFacingServiceName(service.name) ?? service.name
    }))
    .filter((service) => {
      const key = normalizeForMatch(service.name);
      if (!key || seen.has(key) || isInvalidServicePlaceholder(service.name)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  const byName = new Map(activeServices.map((service) => [normalizeForMatch(service.name), service]));
  const canonicalNames = ["Pedicure", "Manicure", "Gel Manicure", "Full Set", "Dip Powder"];
  const canonical = canonicalNames.map((name) => byName.get(normalizeForMatch(name)) ?? { name });
  const extra = activeServices.filter(
    (service) => !canonicalNames.some((name) => normalizeForMatch(name) === normalizeForMatch(service.name))
  );
  return [...canonical, ...extra].slice(0, 9);
};

const buildServiceDtmfOptionMaps = (services: ServiceMenuCandidate[]) => {
  const options: Record<string, string> = {};
  const serviceIds: Record<string, string> = {};
  services.slice(0, 9).forEach((service, index) => {
    const digit = String(index + 1);
    options[digit] = service.name;
    if (service.id) {
      serviceIds[digit] = service.id;
    }
  });
  return { options, serviceIds };
};

const buildServiceDtmfPromptText = (services: ServiceMenuCandidate[]): string => {
  const { options } = buildServiceDtmfOptionMaps(services);
  const optionPhrases = Object.entries(options).map(
    ([digit, serviceName]) => `Press ${digit} for ${serviceName}`
  );
  return optionPhrases.length
    ? `Available services: ${optionPhrases.join(", ")}, or 0 for a person.`
    : SERVICE_DTMF_OPTIONS_PROMPT;
};

const buildServicePromptSessionAttributes = (services: ServiceMenuCandidate[]): Record<string, string> => {
  const { options, serviceIds } = buildServiceDtmfOptionMaps(services);
  const activeServiceIds = services.map((service) => service.id).filter((id): id is string => Boolean(id));
  const activeServiceNames = services.map((service) => service.name);
  const serviceMenuVersion = createHash("sha1")
    .update(JSON.stringify({ activeServiceIds, activeServiceNames }))
    .digest("hex")
    .slice(0, 12);

  return {
    serviceDtmfOptions: JSON.stringify(options),
    serviceDtmfServiceIds: JSON.stringify(serviceIds),
    serviceDtmfPromptText: buildServiceDtmfPromptText(services),
    serviceMenuSource: "active_services",
    serviceMenuVersion,
    serviceMenuFingerprint: serviceMenuVersion,
    menuFingerprint: serviceMenuVersion,
    activeServiceIds: JSON.stringify(activeServiceIds),
    activeServiceNames: JSON.stringify(activeServiceNames),
    activeDtmfMenu: "service",
    activeDtmfOptionsJson: JSON.stringify({
      ...options,
      "0": "__operator__"
    })
  };
};

const getServicePromptNames = (serviceNames: string[]): string[] => {
  const customerFacingNames = Array.from(
    new Set(
      serviceNames
        .map((name) => getCustomerFacingServiceName(name))
        .filter((name): name is string => Boolean(name))
    )
  );
  return customerFacingNames.filter((name) => !isInvalidServicePlaceholder(name)).slice(0, 5);
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
  const now = getReferenceDateTime(timezone);
  const date =
    local.hasSame(now, "day")
      ? "today"
      : local.hasSame(now.plus({ days: 1 }), "day")
        ? "tomorrow"
    : local.toFormat("cccc, LLL d");
  return `${date} at ${formatLocalTimeForSpeech(value, timezone)}`;
};

const mapLuxonWeekdayToBusinessHour = (weekday: number): number => weekday % 7;

const formatBusinessHoursRangeForSpeech = (openTime: string, closeTime: string): string => {
  const date = DateTime.fromObject({ year: 2026, month: 1, day: 1 });
  const [openHour, openMinute] = openTime.split(":").map(Number);
  const [closeHour, closeMinute] = closeTime.split(":").map(Number);
  const open = date.set({ hour: openHour ?? 0, minute: openMinute ?? 0 });
  const close = date.set({ hour: closeHour ?? 0, minute: closeMinute ?? 0 });
  const format = (value: DateTime) => value.minute === 0 ? value.toFormat("h a") : value.toFormat("h:mm a");
  return `${format(open)} to ${format(close)}`;
};

const getBusinessHoursDecision = async (input: {
  salonId: string;
  timezone: string;
  startTime: Date;
  durationMinutes: number;
}): Promise<{
  allowed: boolean;
  reason?: "closed" | "outside_hours";
  message?: string;
  debug: Record<string, unknown>;
}> => {
  const localStart = DateTime.fromJSDate(input.startTime, { zone: "utc" }).setZone(input.timezone);
  const localEnd = localStart.plus({ minutes: input.durationMinutes });
  const dayOfWeek = mapLuxonWeekdayToBusinessHour(localStart.weekday);
  const businessHour = await prisma.businessHour.findUnique({
    where: {
      salonId_dayOfWeek: {
        salonId: input.salonId,
        dayOfWeek
      }
    }
  });
  const baseDebug = {
    businessHoursSource: businessHour ? "database" : "missing_row",
    localRequestedTime: localStart.toISO(),
    localRequestedEndTime: localEnd.toISO(),
    dayOfWeek,
    openTime: businessHour?.openTime ?? null,
    closeTime: businessHour?.closeTime ?? null,
    timezone: input.timezone
  };

  if (!businessHour?.isOpen || !businessHour.openTime || !businessHour.closeTime) {
    return {
      allowed: false,
      reason: "closed",
      message: speak(
        `We are closed on ${escapeSsml(localStart.toFormat("cccc"))}. <break time="300ms"/> Would you like another day or a person?`
      ),
      debug: baseDebug
    };
  }

  const [openHour, openMinute] = businessHour.openTime.split(":").map(Number);
  const [closeHour, closeMinute] = businessHour.closeTime.split(":").map(Number);
  const openLocal = localStart.set({
    hour: openHour ?? 0,
    minute: openMinute ?? 0,
    second: 0,
    millisecond: 0
  });
  const closeLocal = localStart.set({
    hour: closeHour ?? 0,
    minute: closeMinute ?? 0,
    second: 0,
    millisecond: 0
  });

  if (localStart < openLocal || localEnd > closeLocal) {
    const range = formatBusinessHoursRangeForSpeech(businessHour.openTime, businessHour.closeTime);
    return {
      allowed: false,
      reason: "outside_hours",
      message: speak(
        `We are open ${escapeSsml(localStart.toFormat("cccc"))} from ${escapeSsml(range)}, so I cannot book ${escapeSsml(formatLocalTimeForSpeech(input.startTime, input.timezone))}. <break time="300ms"/> What time during those hours works for you?`
      ),
      debug: {
        ...baseDebug,
        openLocal: openLocal.toISO(),
        closeLocal: closeLocal.toISO()
      }
    };
  }

  return {
    allowed: true,
    debug: {
      ...baseDebug,
      openLocal: openLocal.toISO(),
      closeLocal: closeLocal.toISO()
    }
  };
};

const getBusinessHoursDayDecision = async (input: {
  salonId: string;
  timezone: string;
  requestedDate?: string;
}): Promise<{
  allowed: boolean;
  reason?: "closed";
  message?: string;
  debug: Record<string, unknown>;
}> => {
  if (!input.requestedDate?.trim()) {
    return {
      allowed: true,
      debug: {
        businessHoursSource: "no_requested_date"
      }
    };
  }
  const localDate = parseLocalDateText(input.requestedDate, input.timezone);
  if (!localDate?.isValid) {
    return {
      allowed: true,
      debug: {
        businessHoursSource: "invalid_requested_date",
        requestedDate: input.requestedDate
      }
    };
  }
  const dayOfWeek = mapLuxonWeekdayToBusinessHour(localDate.weekday);
  const businessHour = await prisma.businessHour.findUnique({
    where: {
      salonId_dayOfWeek: {
        salonId: input.salonId,
        dayOfWeek
      }
    }
  });
  const debug = {
    businessHoursSource: businessHour ? "database" : "missing_row",
    localRequestedDate: localDate.toFormat("yyyy-MM-dd"),
    dayOfWeek,
    openTime: businessHour?.openTime ?? null,
    closeTime: businessHour?.closeTime ?? null,
    timezone: input.timezone
  };
  if (!businessHour?.isOpen || !businessHour.openTime || !businessHour.closeTime) {
    return {
      allowed: false,
      reason: "closed",
      message: speak(
        `We are closed on ${escapeSsml(localDate.toFormat("cccc"))}. <break time="300ms"/> What other day works for you? You can also press 0 for a person.`
      ),
      debug
    };
  }
  return {
    allowed: true,
    debug
  };
};

const buildBookingFingerprint = (input: {
  salonId: string;
  customerId?: string | null;
  customerPhone?: string;
  serviceId: string;
  staffId: string;
  startTime: Date;
  durationMinutes: number;
}): string => {
  const material = [
    input.salonId,
    input.customerId || normalizePhoneForMatching(input.customerPhone) || "",
    input.serviceId,
    input.startTime.toISOString(),
    input.staffId,
    String(input.durationMinutes)
  ].join("|");
  return createHash("sha256").update(material).digest("hex");
};

const formatKnownDateForPrompt = (value?: string, timezone = "America/New_York"): string | undefined => {
  if (!value?.trim()) {
    return undefined;
  }
  const normalizedDate = normalizeRequestedDateForState(value, timezone);
  const parsed = normalizedDate ? parseLocalDateText(normalizedDate, timezone) : null;
  if (!parsed?.isValid) {
    return undefined;
  }
  const today = getReferenceDateTime(timezone).startOf("day");
  if (parsed.hasSame(today, "day")) {
    return "today";
  }
  if (parsed.hasSame(today.plus({ days: 1 }), "day")) {
    return "tomorrow";
  }
  return parsed.toFormat("cccc, LLL d");
};

const formatKnownTimeForPrompt = (value?: string): string | undefined => {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = parseLocalTimeText(value);
  if (parsed && !parsed.ambiguous) {
    const date = DateTime.fromObject({
      year: 2026,
      month: 1,
      day: 1,
      hour: parsed.hour,
      minute: parsed.minute
    });
    return parsed.minute === 0 ? date.toFormat("h a") : date.toFormat("h:mm a");
  }
  return value;
};

const buildKnownBookingPromptSummary = (
  knownFields: {
    serviceName?: string;
    requestedDate?: string;
    requestedTime?: string;
    staffPreference?: string;
  } = {},
  timezone = "America/New_York",
  options: { forPhrase?: boolean } = {}
): string => {
  const service = knownFields.serviceName;
  const date = formatKnownDateForPrompt(knownFields.requestedDate, timezone);
  const time = formatKnownTimeForPrompt(knownFields.requestedTime);
  const pieces = [service].filter((value): value is string => Boolean(value));
  if (date && time) {
    pieces.push(options.forPhrase ? `for ${date} at ${time}` : `${date} at ${time}`);
  } else if (date) {
    pieces.push(options.forPhrase ? `for ${date}` : date);
  } else if (time && service) {
    pieces.push(`at ${time}`);
  }
  if (knownFields.staffPreference) {
    pieces.push(`with ${knownFields.staffPreference}`);
  }
  return pieces.join(" ").replace(/\s+/g, " ").trim();
};

const buildCurrentTurnAcknowledgement = (input: {
  currentTurnTranscript?: string;
  attributes?: Record<string, unknown>;
  knownFields: {
    customerName?: string;
    serviceName?: string;
    requestedDate?: string;
    requestedTime?: string;
    staffPreference?: string;
  };
  salonTimezone?: string;
}): string | undefined => {
  const transcript = input.currentTurnTranscript?.trim();
  if (!transcript) {
    return undefined;
  }
  const attributes = input.attributes ?? {};
  const lastAskedSlot = readStringAttribute(attributes, ["lastAskedSlot"]);
  const timezone = input.salonTimezone ?? "America/New_York";
  const normalizedTranscript = normalizeForMatch(transcript);
  const previous = {
    customerName: readStringAttribute(attributes, ["customerName", "recognizedCustomerName"]),
    serviceName: readStringAttribute(attributes, ["serviceName", "confirmedServiceName"]),
    requestedDate: normalizeRequestedDateForState(
      readStringAttribute(attributes, ["requestedDate"]),
      timezone
    ),
    requestedTime: readStringAttribute(attributes, ["requestedTime"]),
    staffPreference: readStringAttribute(attributes, ["staffPreference", "confirmedStaffName"])
  };
  const currentDate = normalizeRequestedDateForState(input.knownFields.requestedDate, timezone);
  const serviceName = getCustomerFacingServiceName(input.knownFields.serviceName);
  const serviceAcceptedThisTurn =
    Boolean(serviceName) &&
    !valuesEquivalentForSlot("serviceName", previous.serviceName, serviceName) &&
    (lastAskedSlot === "serviceName" ||
      normalizedTranscript.includes(normalizeForMatch(serviceName)));
  const dateAcceptedThisTurn =
    Boolean(currentDate) &&
    !valuesEquivalentForSlot("requestedDate", previous.requestedDate, currentDate) &&
    (lastAskedSlot === "requestedDate" ||
      lastAskedSlot === "preferredDateTime" ||
      hasGroundedDatePhrase(transcript));
  const timeAcceptedThisTurn =
    Boolean(input.knownFields.requestedTime) &&
    !valuesEquivalentForSlot("requestedTime", previous.requestedTime, input.knownFields.requestedTime) &&
    (lastAskedSlot === "requestedTime" ||
      lastAskedSlot === "preferredDateTime" ||
      hasGroundedTimePhrase(transcript, { lastAskedSlot }));
  const staffAcceptedThisTurn =
    Boolean(input.knownFields.staffPreference) &&
    !valuesEquivalentForSlot("staffPreference", previous.staffPreference, input.knownFields.staffPreference) &&
    (lastAskedSlot === "staffPreference" ||
      normalizedTranscript.includes(normalizeForMatch(input.knownFields.staffPreference)));
  const nameAcceptedThisTurn =
    Boolean(input.knownFields.customerName) &&
    !valuesEquivalentForSlot("customerName", previous.customerName, input.knownFields.customerName) &&
    (lastAskedSlot === "customerName" || hasExplicitCustomerNameCorrectionPhrase(transcript));
  if (nameAcceptedThisTurn) {
    return `Thanks, ${input.knownFields.customerName}.`;
  }
  const summary = buildKnownBookingPromptSummary(
    {
      serviceName: serviceAcceptedThisTurn ? serviceName : undefined,
      requestedDate: dateAcceptedThisTurn ? currentDate : undefined,
      requestedTime: timeAcceptedThisTurn ? input.knownFields.requestedTime : undefined,
      staffPreference: staffAcceptedThisTurn ? input.knownFields.staffPreference : undefined
    },
    timezone
  );
  return summary ? `Got it, ${summary}.` : undefined;
};

const currentTurnRepeatsKnownBookingField = (
  currentTurnTranscript: string | undefined,
  knownFields: {
    serviceName?: string;
    requestedDate?: string;
    requestedTime?: string;
    staffPreference?: string;
  },
  timezone = "America/New_York"
): boolean => {
  const normalizedTurn = normalizeForMatch(currentTurnTranscript);
  if (!normalizedTurn) {
    return false;
  }

  const serviceName = getCustomerFacingServiceName(knownFields.serviceName);
  if (serviceName && normalizedTurn === normalizeForMatch(serviceName)) {
    return true;
  }

  if (knownFields.staffPreference && normalizedTurn === normalizeForMatch(knownFields.staffPreference)) {
    return true;
  }

  const datePrompt = formatKnownDateForPrompt(knownFields.requestedDate, timezone);
  if (datePrompt && normalizedTurn === normalizeForMatch(datePrompt)) {
    return true;
  }

  const timePrompt = formatKnownTimeForPrompt(knownFields.requestedTime);
  return Boolean(
    timePrompt &&
      (normalizedTurn === normalizeForMatch(timePrompt) ||
        normalizedTurn === normalizeForMatch(knownFields.requestedTime))
  );
};

type ExistingAppointmentRequestKind = "existing" | "ambiguous" | "new_booking" | "none";

const classifyExistingAppointmentRequest = (input: {
  intentName?: string;
  transcriptText?: string;
  serviceName?: string;
  requestedDate?: string;
  requestedTime?: string;
}): ExistingAppointmentRequestKind => {
  const intent = input.intentName?.toLowerCase();
  const text = normalizeForMatch(input.transcriptText);

  if (intent === "cancelappointmentintent" || intent === "rescheduleappointmentintent") {
    return "existing";
  }

  if (
    /\b(cancel|reschedule|re schedule|change|move|update)\b.*\bappointment\b/.test(text) ||
    /\b(my appointment|existing appointment|current appointment)\b/.test(text) ||
    /\b(what time|when)\b.*\b(my )?appointment\b/.test(text)
  ) {
    return "existing";
  }

  if (/\b(book|booking|new appointment|make an appointment|schedule)\b/.test(text)) {
    return "new_booking";
  }

  if (
    /\bappointment\b/.test(text) &&
    !input.serviceName &&
    !input.requestedDate &&
    !input.requestedTime
  ) {
    return "ambiguous";
  }

  return "none";
};

const isExistingAppointmentStatusQuestion = (value?: string): boolean => {
  const text = normalizeForMatch(value);
  return /\b(what time|when)\b.*\b(my )?appointment\b/.test(text);
};

const formatUpcomingAppointmentForSpeech = (
  appointment: UpcomingAppointmentCandidate,
  timezone: string
): string => {
  const service = (getCustomerFacingServiceName(appointment.service.name) ?? appointment.service.name).toLowerCase();
  const time = formatLocalDateTimeForSpeech(appointment.startTime, timezone);
  return `${service} with ${appointment.staff.fullName} ${time}`;
};

const formatFinalConfirmationDateTimeForSpeech = (value: Date, timezone: string): string => {
  const local = DateTime.fromJSDate(value, { zone: "utc" }).setZone(timezone);
  const today = getReferenceDateTime(timezone).startOf("day");
  const appointmentDay = local.startOf("day");
  const dayOffset = Math.round(appointmentDay.diff(today, "days").days);
  const dayLabel =
    dayOffset === 0 ? "today" : dayOffset === 1 ? "tomorrow" : local.toFormat("cccc, LLLL d");
  return `${dayLabel} at ${formatLocalTimeForSpeech(value, timezone)}`;
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

const formatAlternativeChoicePrompt = (alternatives: SuggestedSlot[], timezone: string): string => {
  const readable = dedupeSuggestedSlots(alternatives).slice(0, 2).map((slot, index) => {
    const time = formatLocalTimeForSpeech(slot.startTime, timezone);
    return `press ${index + 1} for ${time} with ${slot.staffName}`;
  });
  if (readable.length === 2) {
    return `${readable[0]}, or ${readable[1]}.`;
  }
  return readable[0] ? `${readable[0]}.` : "";
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
  customerName?: string;
  requestedAnyStaff?: boolean;
  customerNameFallbackNotice?: string;
  excludedStaffNames?: string[];
  changeAcknowledgement?: string;
}): string => {
  const service = input.serviceName;
  const appointmentTime = formatFinalConfirmationDateTimeForSpeech(
    input.appointmentStartTime,
    input.salonTimezone
  );
  const selectedStaffPrefix = input.requestedAnyStaff
    ? `You said first available. ${escapeSsml(input.staffName)} is available. <break time="300ms"/> `
    : "";
  const fallbackNotice = input.customerNameFallbackNotice
    ? `${escapeSsml(input.customerNameFallbackNotice)} <break time="300ms"/> `
    : "";
  const exclusionNotice = input.excludedStaffNames?.length
    ? `Okay, I'll exclude ${escapeSsml(formatNameList(input.excludedStaffNames))}. <break time="300ms"/> `
    : "";
  const changeAcknowledgement = input.changeAcknowledgement
    ? `${escapeSsml(input.changeAcknowledgement)} `
    : "";
  const customerPrefix = input.customerName ? `${escapeSsml(input.customerName)}, ` : "";
  return speak(
    `${exclusionNotice}${fallbackNotice}${selectedStaffPrefix}${changeAcknowledgement}${customerPrefix}just to confirm: ${escapeSsml(service)} ${escapeSsml(appointmentTime)} with ${escapeSsml(input.staffName)}. <break time="300ms"/> Is that correct?`
  );
};

const buildRescheduleFingerprint = (input: {
  salonId: string;
  appointmentId: string;
  startTime: Date;
  staffId: string;
}): string => {
  return createHash("sha256")
    .update([input.salonId, input.appointmentId, input.startTime.toISOString(), input.staffId].join("|"))
    .digest("hex");
};

const buildRescheduleConfirmationMessage = (input: {
  serviceName: string;
  oldStartTime: Date;
  newStartTime: Date;
  salonTimezone: string;
  staffName: string;
}): string => {
  return speak(
    `Just to confirm, move your ${escapeSsml(input.serviceName.toLowerCase())} appointment from ${escapeSsml(
      formatLocalDateTimeForSpeech(input.oldStartTime, input.salonTimezone)
    )} to ${escapeSsml(formatLocalDateTimeForSpeech(input.newStartTime, input.salonTimezone))} with ${escapeSsml(
      input.staffName
    )}. <break time="300ms"/> Is that correct?`
  );
};

const buildLexMessage = (input: {
  outcome: AmazonConnectAIAppointmentOutcome;
  missingFields?: string[];
  appointmentStartTime?: Date;
  salonTimezone?: string;
  serviceName?: string;
  staffName?: string;
  staffOptions?: StaffCandidate[];
  servicePromptText?: string;
  staffMenuPromptText?: string;
  staffMenuAlreadySpoken?: boolean;
  collectingServiceName?: boolean;
  knownCallerAcknowledgementName?: string;
  unsupportedServiceRequest?: UnsupportedServiceRequest & {
    suggestedServiceName?: string;
  };
  requestedStaffName?: string;
  alternatives?: SuggestedSlot[];
  failureReason?: string;
  availabilityReasonCode?: string;
  knownFields?: {
    customerName?: string;
    customerPhone?: string;
    serviceName?: string;
    requestedDate?: string;
    requestedTime?: string;
    staffPreference?: string;
  };
  attemptCount?: number;
  invalidServiceDtmfSelection?: boolean;
  invalidStaffDtmfSelection?: boolean;
  unmatchedStaffPreference?: boolean;
  repeatedKnownFieldWhileAskingName?: boolean;
  rejectedCustomerName?: boolean;
  partialBookingFragment?: boolean;
  hasCurrentTurnTranscript?: boolean;
  currentTurnAcknowledgement?: string;
  serviceSlotConversationalNoise?: boolean;
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

  if (input.outcome === "RESCHEDULED") {
    const appointmentTime = input.appointmentStartTime
      ? formatLocalDateTimeForSpeech(
          input.appointmentStartTime,
          input.salonTimezone ?? "America/New_York"
        )
      : "the requested time";
    const service = input.serviceName ? input.serviceName.toLowerCase() : "appointment";
    const staff = input.staffName ? ` with ${input.staffName}` : "";
    return speak(
      `You're all set. <break time="300ms"/> Your ${escapeSsml(service)} has been moved to ${escapeSsml(appointmentTime)}${escapeSsml(staff)}. Thank you for calling.`
    );
  }

  if (input.outcome === "HUMAN_ESCALATION") {
    return speak(
      `I'm having trouble getting that clearly. <break time="300ms"/> ${OPERATOR_TRANSFER_PROMPT}`
    );
  }

  if (input.outcome === "MISSING_INFO") {
    const isRetry = (input.attemptCount ?? 1) > 1;
    const knownCallerIntro = input.knownCallerAcknowledgementName
      ? `Welcome back, ${escapeSsml(input.knownCallerAcknowledgementName)}. `
      : "";
    const intro = input.invalidStaffDtmfSelection
      ? INVALID_MENU_CHOICE_PROMPT
      : input.unmatchedStaffPreference
        ? "I didn't find that technician."
        : isRetry
          ? "Sorry, I did not catch that."
          : "Got it.";
    if (input.missingFields?.includes("staffPreference")) {
      const prompt =
        input.staffMenuPromptText ??
        (input.staffMenuAlreadySpoken
          ? "Please say a listed staff name or press one of the numbers."
          : buildStaffDtmfPromptText(input.staffOptions ?? []));
      const currentTurnPrefix = input.currentTurnAcknowledgement
        ? `${escapeSsml(input.currentTurnAcknowledgement)} `
        : "";
      if (input.invalidStaffDtmfSelection) {
        return speak(INVALID_MENU_CHOICE_PROMPT);
      }
      return speak(
        input.unmatchedStaffPreference
            ? `${knownCallerIntro}${intro} <break time="300ms"/> ${prompt}`
            : `${knownCallerIntro}${currentTurnPrefix}${prompt}`
      );
    }
    if (input.missingFields?.includes("customerName")) {
      const summary = buildKnownBookingPromptSummary(
        {
          serviceName: input.knownFields?.serviceName,
          requestedDate: input.knownFields?.requestedDate,
          requestedTime: input.knownFields?.requestedTime,
          staffPreference: input.knownFields?.staffPreference
        },
        input.salonTimezone,
        {
          forPhrase: Boolean(input.repeatedKnownFieldWhileAskingName)
        }
      );
      return speak(
        input.repeatedKnownFieldWhileAskingName && summary
          ? `I already have ${escapeSsml(summary)}. <break time="300ms"/> What name should I put on the appointment?`
          : input.rejectedCustomerName
          ? "I missed your name. What is your first name?"
          : (input.attemptCount ?? 1) >= 3
          ? "Could you spell your first name, one letter at a time?"
          : isRetry
          ? "I missed your name. What is your first name?"
          : input.currentTurnAcknowledgement
            ? `${escapeSsml(input.currentTurnAcknowledgement)} <break time="300ms"/> May I have your name, please?`
          : summary
            ? `I have ${escapeSsml(summary)}. <break time="300ms"/> May I have your name, please?`
            : "I'd be happy to help. May I have your name, please?"
      );
    }
    if (input.missingFields?.includes("customerPhone")) {
      const name = input.knownFields?.customerName;
      return speak(
        `${name ? `Thanks, ${escapeSsml(name)}.` : intro} <break time="300ms"/> What phone number should we keep on the appointment?`
      );
    }
    if (input.missingFields?.includes("serviceName")) {
      if (input.invalidServiceDtmfSelection) {
        return speak(INVALID_MENU_CHOICE_PROMPT);
      }
      if (input.unsupportedServiceRequest) {
        const prompt = input.servicePromptText ?? SERVICE_DTMF_OPTIONS_PROMPT;
        const suggestion = input.unsupportedServiceRequest.suggestedServiceName;
        return speak(
          suggestion
            ? `${knownCallerIntro}We don't currently have ${escapeSsml(input.unsupportedServiceRequest.displayServiceName)} listed. <break time="300ms"/> Did you mean ${escapeSsml(suggestion)}? You can say yes, no, or choose from the service menu. <break time="300ms"/> ${prompt}`
            : `${knownCallerIntro}We don't currently have ${escapeSsml(input.unsupportedServiceRequest.displayServiceName)} listed. I can tell you the available services. <break time="300ms"/> ${prompt}`
        );
      }
      if (input.partialBookingFragment) {
        return speak(SERVICE_FIRST_RETRY_PROMPT);
      }
      if (input.serviceSlotConversationalNoise) {
        return speak("I'm here. Which service would you like to book?");
      }
      const firstName = input.knownFields?.customerName?.split(/\s+/)[0];
      const servicePrompt = isRetry || input.collectingServiceName
        ? input.servicePromptText ?? SERVICE_DTMF_OPTIONS_PROMPT
        : SERVICE_FIRST_RETRY_PROMPT;
      const retainedDetails = buildKnownBookingPromptSummary(
        {
          requestedDate: input.knownFields?.requestedDate,
          requestedTime: input.knownFields?.requestedTime,
          staffPreference: input.knownFields?.staffPreference
        },
        input.salonTimezone,
        {
          forPhrase: true
        }
      );
      if (retainedDetails) {
        const retainedDetailsForSpeech = retainedDetails.replace(/^for\s+/i, "");
        return speak(
          `${knownCallerIntro}I have ${escapeSsml(retainedDetailsForSpeech)}. <break time="300ms"/> ${servicePrompt}`
        );
      }
      const shouldUseKnownCallerGreeting =
        !isRetry && !input.collectingServiceName && !input.hasCurrentTurnTranscript;
      return speak(
        knownCallerIntro && shouldUseKnownCallerGreeting
          ? `${knownCallerIntro}How may I help you today?`
          : knownCallerIntro
            ? `${knownCallerIntro}${servicePrompt}`
          : firstName && shouldUseKnownCallerGreeting
            ? `Welcome back, ${escapeSsml(firstName)}. How may I help you today?`
            : servicePrompt
      );
    }
    if (input.missingFields?.includes("preferredDateTime")) {
      const currentTurnPrefix = input.currentTurnAcknowledgement
        ? escapeSsml(input.currentTurnAcknowledgement)
        : intro;
      return input.knownFields?.requestedDate
        ? speak(
            `${knownCallerIntro}${currentTurnPrefix} <break time="300ms"/> What time? You can say 3 PM.`
          )
        : speak(
            `${knownCallerIntro}${currentTurnPrefix} <break time="300ms"/> What day would you like?`
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
    const dedupedAlternatives = dedupeSuggestedSlots(alternatives).slice(0, 2);
    if (input.requestedStaffName && input.appointmentStartTime) {
      const requestedTime = formatLocalTimeForSpeech(input.appointmentStartTime, timezone);
      const requestedStaffUnavailableText =
        input.availabilityReasonCode === "APPOINTMENT_OVERLAP"
          ? `${escapeSsml(input.requestedStaffName)} already has an appointment at ${escapeSsml(requestedTime)}.`
          : input.availabilityReasonCode === "STAFF_NOT_MAPPED"
            ? `${escapeSsml(input.requestedStaffName)} doesn't provide ${escapeSsml(input.serviceName ?? "that service")}.`
            : input.availabilityReasonCode === "OUTSIDE_BUSINESS_HOURS"
              ? `That time is outside business hours.`
              : input.availabilityReasonCode === "SALON_CLOSED"
                ? `The salon is closed then.`
                : `${escapeSsml(input.requestedStaffName)} is not available at ${escapeSsml(requestedTime)}.`;
      if (dedupedAlternatives.length === 1) {
        const [alternative] = dedupedAlternatives;
        const alternativeTime = formatLocalTimeForSpeech(alternative.startTime, timezone);
        return speak(
          `${requestedStaffUnavailableText} <break time="300ms"/> ${escapeSsml(alternative.staffName)} is available at ${escapeSsml(alternativeTime)}. Would you like ${escapeSsml(alternativeTime)} with ${escapeSsml(alternative.staffName)}?`
        );
      }
      const formattedChoices = formatAlternativeChoicePrompt(dedupedAlternatives, timezone);
      return speak(
        `${requestedStaffUnavailableText} <break time="300ms"/> ${escapeSsml(formattedChoices)}`
      );
    }
    if (dedupedAlternatives.length === 1) {
      const [alternative] = dedupedAlternatives;
      const alternativeTime = formatLocalTimeForSpeech(alternative.startTime, timezone);
      return speak(
        `That time is not available. <break time="300ms"/> ${escapeSsml(alternative.staffName)} is available at ${escapeSsml(alternativeTime)}. Would you like ${escapeSsml(alternativeTime)} with ${escapeSsml(alternative.staffName)}?`
      );
    }
    const formattedChoices = formatAlternativeChoicePrompt(dedupedAlternatives, timezone);
    return speak(
      `That time is not available. <break time="300ms"/> ${escapeSsml(formattedChoices)}`
    );
  }

  return speak(
    `${escapeSsml(
      input.failureReason ??
        "I could not confirm the appointment right now."
    )} <break time="300ms"/> You can press 0 to speak with an operator, or I can take a callback request.`
  );
};

const getElicitSlotForMissingFields = (
  missingFields: Set<string>,
  normalized: ReturnType<typeof normalizeAmazonConnectAppointmentInput>,
  servicePromptSessionAttributes: Record<string, string> = {}
): {
  slotToElicit: string;
  promptMissingFields: string[];
  attemptCount: number;
  sessionAttributes: Record<string, string>;
} => {
  const lastAskedSlot = readStringAttribute(normalized.attributes, ["lastAskedSlot"]);
  const currentTurnTranscript = normalized.currentTurnTranscript ?? normalized.transcriptText ?? "";
  const shouldKeepActiveTimeSlot =
    lastAskedSlot === "requestedTime" &&
    missingFields.has("preferredDateTime") &&
    Boolean(currentTurnTranscript.trim()) &&
    !normalized.requestedTime &&
    !hasGroundedTimePhrase(currentTurnTranscript, {
      lastAskedSlot: "requestedTime",
      currentTurnHasDatePhrase: hasGroundedDatePhrase(currentTurnTranscript)
    });
	  let slotToElicit = "serviceName";
  const freshBookingRestart = readStringAttribute(normalized.attributes, ["freshBookingRestart"]) === "true";
	  if (freshBookingRestart && missingFields.has("serviceName")) {
    slotToElicit = "serviceName";
  } else if (shouldKeepActiveTimeSlot) {
	    slotToElicit = "requestedTime";
  } else if (missingFields.has("serviceName")) {
    slotToElicit = "serviceName";
  } else if (missingFields.has("preferredDateTime")) {
    slotToElicit = normalized.requestedDate ? "requestedTime" : "requestedDate";
  } else if (missingFields.has("customerName")) {
    slotToElicit = "customerName";
  } else if (missingFields.has("staffPreference")) {
    slotToElicit = "staffPreference";
  } else if (missingFields.has("customerPhone")) {
    slotToElicit = "customerPhone";
  }

  const previousCount = parseAttemptCount(
    readStringAttribute(normalized.attributes, ["askedSlotsCount", "fallbackCount", "errorCount"])
  );
  const serviceClarificationCount =
    slotToElicit === "serviceName"
      ? parseAttemptCount(readStringAttribute(normalized.attributes, ["serviceClarificationAttempts"]))
      : 0;
  const attemptCount =
    slotToElicit === "serviceName" && serviceClarificationCount > 0
      ? serviceClarificationCount
      : lastAskedSlot === slotToElicit
        ? previousCount + 1
        : 1;
  const promptMissingFields =
    slotToElicit === "requestedDate" || slotToElicit === "requestedTime"
      ? ["preferredDateTime"]
      : [slotToElicit];

  const sessionAttributes: Record<string, string> = {
    lastAskedSlot: slotToElicit,
    askedSlotsCount: String(attemptCount),
    fallbackCount: String(attemptCount),
    errorCount: String(attemptCount)
  };
  if (slotToElicit === "serviceName") {
    sessionAttributes.serviceRecognitionFailureCount = String(attemptCount);
  }
  if (slotToElicit === "serviceName") {
    Object.assign(
      sessionAttributes,
      Object.keys(servicePromptSessionAttributes).length
        ? servicePromptSessionAttributes
        : {
            activeDtmfMenu: "service",
            activeDtmfOptionsJson: JSON.stringify(SERVICE_DTMF_OPTIONS)
          }
    );
  }

  return {
    slotToElicit,
    promptMissingFields,
    attemptCount,
    sessionAttributes
  };
};

const buildServiceClarificationMessage = (input: {
  heardServiceName: string;
  suggestedServiceName?: string;
  availableServiceNames: string[];
  attempts: number;
  servicePromptText?: string;
}): string => {
  const options = formatNameList(getServicePromptNames(input.availableServiceNames));
  return options
    ? speak(input.servicePromptText ?? SERVICE_DTMF_OPTIONS_PROMPT)
    : speak(
        `I heard ${escapeSsml(input.heardServiceName)}. <break time="300ms"/> Which service would you like?`
      );
};

const buildStaffClarificationMessage = (input: {
  availableStaff: StaffCandidate[];
}): string => {
  return speak(buildStaffDtmfPromptText(input.availableStaff));
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
  requestedTime?: string;
  staffPreference?: string;
  timezone: string;
  allowAffirmativeSingleOption?: boolean;
}): SuggestedSlot | null => {
  if (!input.alternatives.length) {
    return null;
  }

  if (
    isNegative(input.transcriptText) ||
    isNegative(input.requestedTime) ||
    isNegative(input.staffPreference)
  ) {
    return null;
  }

  if (
    input.allowAffirmativeSingleOption &&
    input.alternatives.length === 1 &&
    (isAffirmative(input.transcriptText) ||
      isAffirmative(input.requestedTime) ||
      isAffirmative(input.staffPreference))
  ) {
    return input.alternatives[0] ?? null;
  }

  const digit =
    readDtmfDigit(input.transcriptText) ||
    readDtmfDigit(input.requestedTime) ||
    readDtmfDigit(input.staffPreference);
  if (digit === "1") {
    return input.alternatives[0] ?? null;
  }
  if (digit === "2") {
    return input.alternatives[1] ?? null;
  }

  const selectionText = [input.transcriptText, input.requestedTime, input.staffPreference]
    .filter(Boolean)
    .join(" ");
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

const getSafeErrorCode = (error: unknown): string =>
  error instanceof AppError
    ? error.code
    : error instanceof Error && error.name
      ? error.name
      : "UNKNOWN_ERROR";

const buildTrustedSlotSnapshot = (attributes: Record<string, unknown> = {}): Record<string, unknown> =>
  Object.fromEntries(
    bookingDebugFields
      .map((field) => [field, attributes[field]])
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
  );

const buildRecoverableSaveFailureMessage = (
  normalized: ReturnType<typeof normalizeAmazonConnectAppointmentInput>,
  timezone: string
): string => {
  const date = formatKnownDateForPrompt(normalized.requestedDate, timezone);
  const time = formatKnownTimeForPrompt(normalized.requestedTime);
  const service = normalized.serviceName ?? "the appointment";
  const staff = normalized.staffPreference
    ? isAnyStaffPreference(normalized.staffPreference)
      ? "the first available technician"
      : normalized.staffPreference
    : "the first available technician";
  const appointmentTime = [date, time ? `at ${time}` : ""].filter(Boolean).join(" ");
  const underName = normalized.customerName ? ` under ${normalized.customerName}` : "";
  return speak(
    `I'm sorry, I couldn't save the appointment just yet. I still have ${escapeSsml(service)} ${escapeSsml(appointmentTime)} with ${escapeSsml(staff)}${escapeSsml(underName)}. Would you like me to try once more?`
  );
};

export const createAmazonConnectAIRecoverableFailure = async (
  input: CreateAmazonConnectAIAppointmentInput,
  options: {
    reason: "backend_error" | "backend_timeout";
    error: unknown;
  }
) => {
  const normalized = normalizeAmazonConnectAppointmentInput(input);
  const { salon, resolutionSource } = await resolveAmazonConnectSalon({
    salonId: input.salonId,
    amazonConnectPhoneNumber: normalized.amazonConnectPhoneNumber,
    calledNumber: normalized.calledNumber
  });
  normalized.requestedDate = normalizeRequestedDateForState(normalized.requestedDate, salon.timezone);
  const actorUserId = await resolveActionActorUserId(salon.id);
  const activeServiceMenuServices = await getActiveServiceMenuServices(salon.id);
  const servicePromptSessionAttributes = buildServicePromptSessionAttributes(activeServiceMenuServices);
  const callSession = await upsertAmazonConnectCallSession({
    salonId: salon.id,
    contactId: normalized.contactId,
    customerPhone: normalized.customerPhone,
    amazonConnectPhoneNumber: normalized.amazonConnectPhoneNumber,
    calledNumber: normalized.calledNumber,
    finalResolution: "Amazon Connect AI booking hit a recoverable backend error."
  });
  const activeBookingAttempt = callSession
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
  const currentTurnServiceAnswer =
    readStringAttribute(normalized.attributes, ["lastAskedSlot"]) === "serviceName" &&
    normalized.currentTurnTranscript
      ? await findServiceMentionInText(salon.id, normalized.currentTurnTranscript)
      : null;
  if (currentTurnServiceAnswer) {
    normalized.serviceName = getCustomerFacingServiceName(currentTurnServiceAnswer.service.name);
  }
  normalized.serviceName ??=
    getCustomerFacingServiceName(activeBookingAttempt?.requestedService ?? undefined) ??
    getCustomerFacingServiceName(
      readStringAttribute(activeNormalizedRequest, ["serviceName", "suggestedServiceName"])
    );
  if (isBillingLikeServiceCollision(normalized.currentTurnTranscript ?? normalized.transcriptText)) {
    normalized.serviceName = undefined;
  }
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
  normalized.requestedDate = normalizeRequestedDateForState(normalized.requestedDate, salon.timezone);
  normalized.requestedTime ??= readStringAttribute(activeNormalizedRequest, ["requestedTime"]);
  normalized.staffId ??= readStringAttribute(activeNormalizedRequest, ["staffId", "selectedStaffId"]);
  if (normalized.customerName && !isAcceptableCustomerName(normalized.customerName)) {
    normalized.customerName = undefined;
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
  if (!normalized.requestedDate || (!normalized.requestedTime && !hasTimeComponent(normalized.requestedDate))) {
    missingFields.add("preferredDateTime");
  }
  if (!normalized.staffPreference && !normalized.staffId) {
    missingFields.add("staffPreference");
  }

  const errorCode = getSafeErrorCode(options.error);
  const requestAttributes = recordFromUnknown(input.attributes);
  const baseSessionAttributes = Object.fromEntries(
    Object.entries({
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: normalized.serviceName,
      requestedDate: normalized.requestedDate,
      requestedTime: normalized.requestedTime,
      staffPreference: normalized.staffPreference,
      staffId: normalized.staffId,
      selectedStaffId: normalized.staffId,
      confirmedServiceName: normalized.serviceName,
      confirmedStaffName: normalized.staffPreference,
      callSessionId: callSession?.id,
      amazonConnectContactId: normalized.contactId,
      recoverableErrorReason: options.reason,
      recoverableErrorCode: errorCode,
      forceHumanEscalation: "false",
      transferToQueue: "false"
    }).filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
  ) as Record<string, string>;

  let message: string;
  let dialogAction: { type: string; slotToElicit?: string };
  let promptMissingFields: string[] = [];
  if (missingFields.size > 0) {
    const elicitDecision = getElicitSlotForMissingFields(
      missingFields,
      normalized,
      servicePromptSessionAttributes
    );
    promptMissingFields = elicitDecision.promptMissingFields;
    Object.assign(baseSessionAttributes, elicitDecision.sessionAttributes);
    const currentTurnAcknowledgement = buildCurrentTurnAcknowledgement({
      currentTurnTranscript: normalized.currentTurnTranscript ?? normalized.transcriptText,
      attributes: normalized.attributes,
      knownFields: normalized,
      salonTimezone: salon.timezone
    });
    message = buildLexMessage({
      outcome: "MISSING_INFO",
      missingFields: elicitDecision.promptMissingFields,
      knownFields: normalized,
      salonTimezone: salon.timezone,
      attemptCount: elicitDecision.attemptCount,
      rejectedCustomerName: hasIgnoredCustomerNameNoise(normalized.attributes),
      servicePromptText: servicePromptSessionAttributes.serviceDtmfPromptText,
      currentTurnAcknowledgement,
      serviceSlotConversationalNoise:
        elicitDecision.slotToElicit === "serviceName" &&
        readStringAttribute(normalized.attributes, ["lastAskedSlot"]) === "serviceName" &&
        isServiceSlotConversationalNoise(normalized.currentTurnTranscript ?? normalized.transcriptText)
    });
    dialogAction = {
      type: "ElicitSlot",
      slotToElicit: elicitDecision.slotToElicit
    };
  } else {
    message = buildRecoverableSaveFailureMessage(normalized, salon.timezone);
    Object.assign(baseSessionAttributes, {
      awaitingBackendRetryConfirmation: "true",
      lastAskedSlot: readStringAttribute(normalized.attributes, ["lastAskedSlot"]) ?? "bookingConfirmation"
    });
    dialogAction = {
      type: "ElicitIntent"
    };
  }

  const bookingAttemptData = {
    salonId: salon.id,
    callSessionId: callSession?.id,
    status: BookingAttemptStatus.NEEDS_INPUT,
    source: normalized.source,
    customerName: normalized.customerName,
    customerPhone:
      normalizeCustomerPhone(normalized.customerPhone) ?? normalizePhoneForMatching(normalized.customerPhone),
    requestedService: normalized.serviceName,
    requestedStaff: normalized.staffPreference,
    requestedDateTimeText: [normalized.requestedDate, normalized.requestedTime]
      .filter((value): value is string => Boolean(value))
      .join(" "),
    normalizedRequest: toJson({
      salonId: salon.id,
      salonResolutionSource: resolutionSource,
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: normalized.serviceName,
      requestedDate: normalized.requestedDate,
      requestedTime: normalized.requestedTime,
      staffPreference: normalized.staffPreference,
      staffId: normalized.staffId,
      selectedStaffId: normalized.staffId,
      releaseIdentity: buildVoiceReleaseIdentity(normalized.attributes),
      recoverableErrorReason: options.reason,
      recoverableErrorCode: errorCode
    }),
    failureReason: `Recoverable backend error: ${errorCode}`,
    rawInput: toJson({
      ...input,
      authorization: undefined,
      releaseIdentity: buildVoiceReleaseIdentity(normalized.attributes),
      normalizedProvider: normalized.provider
    }),
    createdByUserId: actorUserId
  };
  const bookingAttempt = activeBookingAttempt
    ? await prisma.bookingAttempt.update({
        where: {
          id: activeBookingAttempt.id
        },
        data: bookingAttemptData
      })
    : await prisma.bookingAttempt.create({
        data: bookingAttemptData
      });

  if (callSession) {
    await markBookingAttemptResultOnCall(callSession.id, bookingAttempt.status, {
      bookingAttemptId: bookingAttempt.id,
      failureReason: bookingAttempt.failureReason ?? undefined
    });
  }

  const lexResponse = {
    fulfillmentState: "InProgress",
    message,
    messageContentType: message.trim().startsWith("<speak>") ? "SSML" : "PlainText",
    dialogAction,
    sessionAttributes: baseSessionAttributes
  };
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
  const responsePayload = {
    currentTurnTranscript: normalized.currentTurnTranscript ?? normalized.transcriptText,
    aggregatedBookingTranscript: normalized.aggregatedBookingTranscript ?? normalized.transcriptText,
    missingFields: Array.from(missingFields.values()),
    promptMissingFields,
    errorCode,
    recoverableErrorReason: options.reason,
    releaseIdentity: buildVoiceReleaseIdentity(normalized.attributes),
    callerSafeResponseText: message,
    lexResponse,
    sessionAttributes: baseSessionAttributes,
    lexTurnDebug: {
      ...recordFromUnknown(requestAttributes.lexTurnDebug),
      currentTurnTranscript: normalized.currentTurnTranscript ?? normalized.transcriptText,
      lastAskedSlotBefore: readStringAttribute(requestAttributes, ["lastAskedSlot"]) ?? null,
      lastAskedSlotAfter: baseSessionAttributes.lastAskedSlot ?? null,
      sessionAttributesBefore: requestAttributes,
      sessionAttributesAfter: baseSessionAttributes,
      trustedSlotsBefore: buildTrustedSlotSnapshot(requestAttributes),
      trustedSlotsAfter: buildTrustedSlotSnapshot(baseSessionAttributes),
      errorCode,
      recoverableErrorReason: options.reason,
      responseMessage: message,
      slotToElicit: dialogAction.slotToElicit,
      releaseIdentity: buildVoiceReleaseIdentity(normalized.attributes)
    }
  };
  const aiInteraction = await upsertAmazonConnectBookingAIInteractionLog({
    salonId: salon.id,
    actorUserId,
    callSessionId: callSession?.id,
    bookingAttemptId: bookingAttempt.id,
    provider: ExternalProvider.AMAZON_CONNECT,
    model: env.AMAZON_LEX_BOT_ID ?? "amazon-lex",
    taskType: AMAZON_CONNECT_BOOKING_TASK,
    requestText: normalized.aggregatedBookingTranscript ?? normalized.transcriptText ?? "",
    requestPayload: input,
    responseText: message,
    responsePayload,
    parsedOutput: {
      outcome: "MISSING_INFO",
      parsed
    },
    isValid: false,
    validationErrors: {
      code: errorCode,
      reason: options.reason
    },
    confidence: 0,
    isSynthetic: isSyntheticAmazonConnectIdentity(normalized.contactId)
  });

  return {
    outcome: "MISSING_INFO" as const,
    message,
    lexResponse,
    appointment: null,
    bookingAttempt,
    callSession,
    transcript: null,
    aiInteraction,
    escalation: null,
    alternatives: [],
    missingFields: Array.from(missingFields.values()),
    salonResolutionSource: resolutionSource
  };
};

export const createAmazonConnectAIAppointment = async (
  input: CreateAmazonConnectAIAppointmentInput
) => {
  const apiStartedAt = new Date().toISOString();
  input.attributes = {
    ...recordFromUnknown(input.attributes),
    apiStartedAt
  };
  const normalized = normalizeAmazonConnectAppointmentInput(input);
  normalized.attributes.apiStartedAt = apiStartedAt;
  const normalizedBeforeDebug = pickNormalizedAppointmentDebug(normalized);
  let customerNameSourceOverride = readStringAttribute(normalized.attributes, ["customerNameSource"]);
  let customerNameNeedsReview = readStringAttribute(normalized.attributes, ["customerNameNeedsReview"]) === "true";
  const { salon, resolutionSource } = await resolveAmazonConnectSalon({
    salonId: input.salonId,
    amazonConnectPhoneNumber: normalized.amazonConnectPhoneNumber,
    calledNumber: normalized.calledNumber
  });
  const actorUserId = await resolveActionActorUserId(salon.id);
  const activeServiceMenuServices = await getActiveServiceMenuServices(salon.id);
  const servicePromptSessionAttributes = buildServicePromptSessionAttributes(activeServiceMenuServices);
  const rawUnsupportedServiceRequest = detectUnsupportedServiceRequest(
    normalized.currentTurnTranscript ?? normalized.transcriptText
  );
  const activeExactUnsupportedService = rawUnsupportedServiceRequest
    ? activeServiceMenuServices.find(
        (service) =>
          normalizeForMatch(service.name) === normalizeForMatch(rawUnsupportedServiceRequest.displayServiceName)
      )
    : undefined;
  const unsupportedServiceRequest = activeExactUnsupportedService
    ? null
    : rawUnsupportedServiceRequest;
  const unsupportedServiceSuggestionName =
    unsupportedServiceRequest?.category === "gel"
      ? (() => {
          const gelAlternatives = activeServiceMenuServices.filter((service) => {
            const normalizedName = normalizeForMatch(service.name);
            return normalizedName.includes("gel") && normalizedName !== "gel manicure";
          });
          return gelAlternatives.length === 1 ? gelAlternatives[0]!.name : undefined;
        })()
      : undefined;
  if (activeExactUnsupportedService && !normalized.serviceName) {
    normalized.serviceName = activeExactUnsupportedService.name;
  }
  const callSession = await upsertAmazonConnectCallSession({
    salonId: salon.id,
    contactId: normalized.contactId,
    customerPhone: normalized.customerPhone,
    amazonConnectPhoneNumber: normalized.amazonConnectPhoneNumber,
    calledNumber: normalized.calledNumber
  });
	  if (callSession) {
	    const staleTurn = isPostProviderDisconnectTurn(input, callSession);
    if (staleTurn.stale && staleTurn.providerDisconnectedAt) {
      return buildProviderDisconnectedStaleTurnResponse({
        request: input,
        normalized,
        salonId: salon.id,
        actorUserId,
        callSession,
        providerDisconnectedAt: staleTurn.providerDisconnectedAt,
        turnTimestamp: staleTurn.turnTimestamp
      });
    }
	    const duplicateResponse = await findDuplicateAmazonConnectTurn(
	      `AMAZON_CONNECT:${AMAZON_CONNECT_BOOKING_TASK}:${callSession.id}`,
	      input
	    );
	    if (duplicateResponse) {
      return {
        ...duplicateResponse,
	        callSession
	      };
	    }
      const existingInteraction = await prisma.aiInteractionLog.findUnique({
        where: {
          interactionKey: `AMAZON_CONNECT:${AMAZON_CONNECT_BOOKING_TASK}:${callSession.id}`
        }
      });
      const providerRequestReuse = existingInteraction
        ? findProviderRequestIdReuse(
            getAmazonConnectTurnHistory(existingInteraction.responsePayload),
            getIncomingTurnIdentity(input)
          )
        : null;
      if (providerRequestReuse) {
        applySameRequestSegmentState(normalized, providerRequestReuse);
        normalized.attributes.duplicateDisposition = "provider_request_id_reused_for_distinct_human_turn";
        normalized.attributes.providerRequestIdReuseDetected = "true";
      }
	  }
  const initialActiveBookingConfirmationSlot =
    readStringAttribute(normalized.attributes, ["lastAskedSlot"]) === "bookingConfirmation" ||
    readStringAttribute(normalized.attributes, ["slotToElicit"]) === "bookingConfirmation" ||
    Boolean(normalized.bookingConfirmation);
  const initialAwaitingFinalBookingConfirmation =
    readStringAttribute(normalized.attributes, ["awaitingRejectedBookingChoice"]) !== "true" &&
    (readStringAttribute(normalized.attributes, ["awaitingFinalBookingConfirmation"]) === "true" ||
      (readStringAttribute(normalized.attributes, ["bookingConfirmationAsked", "finalBookingConfirmationAsked"]) === "true" &&
        initialActiveBookingConfirmationSlot));
  const initialFinalConfirmationOutcome = initialAwaitingFinalBookingConfirmation
    ? classifyFinalBookingConfirmation(normalized.currentTurnTranscript ?? normalized.transcriptText)
    : "UNKNOWN";
  const initialFinalConfirmationRestarts = initialFinalConfirmationOutcome === "NEW_BOOKING";
  if (initialFinalConfirmationRestarts) {
    applyFreshBookingResetToNormalized(normalized, {
      restartBookingWithDetails: currentTurnHasBookingDetails(normalized) ? "true" : "false"
    });
  }
  const initialAwaitingRejectedBookingChoice =
    readStringAttribute(normalized.attributes, ["awaitingRejectedBookingChoice"]) === "true";
  const initialRejectedBookingChoice = initialAwaitingRejectedBookingChoice
    ? classifyRejectedBookingChoice(normalized.currentTurnTranscript ?? normalized.transcriptText, normalized)
    : "UNKNOWN";
  const postRejectedChoiceStops = initialRejectedBookingChoice === "STOP";
  const postRejectedChoiceNeedsDetailMenu = initialRejectedBookingChoice === "CHANGE_DETAIL_MENU";
  const postRejectedChoiceRestarts = initialRejectedBookingChoice === "NEW_BOOKING";
  const postRejectedChoiceChangesDraft = initialRejectedBookingChoice === "CHANGE_REQUEST";
  if (postRejectedChoiceRestarts) {
    applyFreshBookingResetToNormalized(normalized, {
      restartBookingWithDetails: currentTurnHasBookingDetails(normalized) ? "true" : "false"
    });
  } else if (postRejectedChoiceChangesDraft) {
    normalized.attributes.awaitingRejectedBookingChoice = "false";
    normalized.attributes.awaitingFinalBookingConfirmation = "false";
    normalized.attributes.bookingConfirmationAsked = "false";
    normalized.attributes.finalConfirmationChangeRequest = "true";
  }
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
  if (postRejectedChoiceRestarts || initialFinalConfirmationRestarts) {
    activeBookingAttempt = null;
  }
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
  const currentTurnServiceAnswer =
    (readStringAttribute(normalized.attributes, ["lastAskedSlot"]) === "serviceName" ||
      readStringAttribute(normalized.attributes, ["activeDtmfMenu"]) === "service") &&
    normalized.currentTurnTranscript
      ? await findServiceMentionInText(salon.id, normalized.currentTurnTranscript)
      : null;
  if (currentTurnServiceAnswer) {
    normalized.serviceName = getCustomerFacingServiceName(currentTurnServiceAnswer.service.name);
  }
  normalized.serviceName ??=
    getCustomerFacingServiceName(activeBookingAttempt?.requestedService ?? undefined) ??
    getCustomerFacingServiceName(
      readStringAttribute(activeNormalizedRequest, ["serviceName", "suggestedServiceName"])
    );
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
  normalized.requestedDate = normalizeRequestedDateForState(normalized.requestedDate, salon.timezone);
  normalized.requestedTime ??= readStringAttribute(activeNormalizedRequest, ["requestedTime"]);
  normalized.staffId ??= readStringAttribute(activeNormalizedRequest, ["staffId", "selectedStaffId"]);

  if (normalized.staffDtmfDigit && (!normalized.staffPreference || !normalized.staffId)) {
    const savedStaffOptions = readStaffDtmfOptions(normalized.attributes);
    const savedStaffIds = readStaffDtmfStaffIds(normalized.attributes);
    const currentStaff = await getActiveBookableStaff(salon.id);
    const currentStaffOptions = buildStaffDtmfOptionMaps(currentStaff);
    const selectedStaffName =
      savedStaffOptions[normalized.staffDtmfDigit] ?? currentStaffOptions.options[normalized.staffDtmfDigit];
    if (selectedStaffName) {
      normalized.staffPreference = selectedStaffName;
      normalized.staffId =
        savedStaffIds[normalized.staffDtmfDigit] ?? currentStaffOptions.staffIds[normalized.staffDtmfDigit];
      normalized.invalidStaffDtmfSelection = false;
      if (normalized.staffDtmfDigit === "0") {
        normalized.staffId = undefined;
      }
    } else if (!normalized.staffPreference) {
      normalized.invalidStaffDtmfSelection = true;
      normalized.staffId = undefined;
    }
  }

  if (isClearlyInvalidServiceName(normalized.serviceName, salon.timezone)) {
    normalized.serviceName = undefined;
  }
  normalized.serviceName = await applyGuardedPrincessServiceCorrection(
    salon.id,
    normalized.serviceName,
    recordFromUnknown(normalized.attributes),
    normalized.currentTurnTranscript,
    normalized.transcriptText
  );
  normalized.serviceName = await applyGuardedPedicureServiceCorrection(
    salon.id,
    normalized.serviceName,
    recordFromUnknown(normalized.attributes),
    normalized.currentTurnTranscript,
    normalized.transcriptText
  );
  normalized.serviceName = await applyGuardedObservedServiceAsrCorrection(
    salon.id,
    normalized.serviceName,
    recordFromUnknown(normalized.attributes),
    normalized.currentTurnTranscript,
    normalized.transcriptText
  );
  if (unsupportedServiceRequest) {
    normalized.serviceName = undefined;
  }

  const nameCorrectionText = normalized.currentTurnTranscript ?? normalized.transcriptText;
  const explicitCustomerNameCorrection = extractExplicitCustomerNameCorrection(nameCorrectionText);
  const rejectedRecognizedCustomerName = rejectsRecognizedCustomerName(nameCorrectionText);
  const currentTurnOwnsCustomerName =
    readStringAttribute(normalized.attributes, ["lastAskedSlot"]) === "customerName" ||
    (!readStringAttribute(normalized.attributes, ["lastAskedSlot"]) && Boolean(normalized.customerName)) ||
    hasExplicitCustomerNameCorrectionPhrase(nameCorrectionText);
  if (!currentTurnOwnsCustomerName && normalized.customerName) {
    const trustedNameFromAttributes = readStringAttribute(normalized.attributes, [
      "customerName",
      "recognizedCustomerName"
    ]);
    normalized.customerName = trustedNameFromAttributes || undefined;
  }
  const customerNameTurnReceivedNoise =
    readStringAttribute(normalized.attributes, ["lastAskedSlot"]) === "customerName" &&
    readStringAttribute(normalized.attributes, ["activeDtmfMenu"]) !== "staff" &&
    isInvalidCustomerNameNoise(nameCorrectionText);
  const explicitCustomerName = explicitCustomerNameCorrection ??
    (normalized.transcriptText &&
      (currentTurnOwnsCustomerName || hasExplicitCustomerNameCorrectionPhrase(normalized.transcriptText))
      ? extractCustomerNameFromText(normalized.transcriptText)
      : undefined);
  const bareCustomerName =
    !explicitCustomerName && readStringAttribute(normalized.attributes, ["lastAskedSlot"]) === "customerName"
      ? extractBareCustomerNameAnswer(normalized.transcriptText)
      : undefined;
  if (normalized.transcriptText) {
    if (explicitCustomerName) {
      normalized.customerName = explicitCustomerName;
    } else if (bareCustomerName) {
      normalized.customerName = bareCustomerName;
    }
    normalized.customerPhone ??= extractCustomerPhoneFromText(normalized.transcriptText);
  }
  if (normalized.customerName) {
    normalized.customerName = collapseSpokenNameSpelling(normalized.customerName);
  }
  const currentTurnCustomerNameCandidate = explicitCustomerName || bareCustomerName;
  let rejectedCurrentTurnCustomerName = false;
  if (normalized.customerName && !isAcceptableCustomerName(normalized.customerName)) {
    rejectedCurrentTurnCustomerName = Boolean(currentTurnCustomerNameCandidate);
    normalized.customerName = undefined;
  }
  if (!normalized.customerName && !currentTurnCustomerNameCandidate && customerNameTurnReceivedNoise) {
    rejectedCurrentTurnCustomerName = true;
  }
  const trustedCustomerNameBeforeLookup = normalized.customerName;
  const currentTurnAcceptedCustomerName = currentTurnCustomerNameCandidate;
  if (currentTurnAcceptedCustomerName && normalized.customerName) {
    customerNameSourceOverride = "current_turn_explicit";
    customerNameNeedsReview = false;
  }

  const recognizedCustomer = normalized.customerPhone
    ? await findExistingCustomerByPhone({
        salonId: salon.id,
        customerPhone: normalized.customerPhone
      })
    : null;
  const recognizedCustomerReusableName = recognizedCustomer
    ? getReusableCustomerDisplayName(recognizedCustomer)
    : undefined;
  if (recognizedCustomer) {
    normalized.customerName = rejectedRecognizedCustomerName && !currentTurnAcceptedCustomerName
      ? undefined
      : currentTurnAcceptedCustomerName ||
        recognizedCustomerReusableName ||
        trustedCustomerNameBeforeLookup;
    if (normalized.customerName && !isAcceptableCustomerName(normalized.customerName)) {
      normalized.customerName = undefined;
    }
    normalized.customerPhone = normalizePhoneForMatching(normalized.customerPhone) ?? recognizedCustomer.phone;
    if (currentTurnAcceptedCustomerName && normalized.customerName) {
      customerNameSourceOverride = "current_turn_explicit";
      customerNameNeedsReview = false;
    } else if (rejectedRecognizedCustomerName) {
      customerNameSourceOverride = "current_turn_rejected_profile";
      customerNameNeedsReview = true;
    } else if (recognizedCustomerReusableName) {
      customerNameSourceOverride = undefined;
      customerNameNeedsReview = false;
    } else if (trustedCustomerNameBeforeLookup && normalized.customerName) {
      customerNameNeedsReview = customerNameSourceOverride === "phone_fallback" ? customerNameNeedsReview : false;
    } else {
      customerNameNeedsReview = false;
    }
  }
  const knownCallerMemory =
    !recognizedCustomer && normalized.customerPhone && !explicitCustomerName && !bareCustomerName
      ? await findKnownCallerMemoryByPhone({
          salonId: salon.id,
          customerPhone: normalized.customerPhone
        })
      : null;
  if (knownCallerMemory && !normalized.customerName) {
    normalized.customerName = knownCallerMemory.customerName;
    normalized.customerPhone =
      normalizePhoneForMatching(normalized.customerPhone) ??
      knownCallerMemory.customerPhone ??
      normalized.customerPhone;
  }
  const lastAskedSlotForName = readStringAttribute(normalized.attributes, ["lastAskedSlot"]) === "customerName";
  const previousNameAttempts = parseAttemptCount(
    readStringAttribute(normalized.attributes, ["askedSlotsCount", "fallbackCount", "errorCount"])
  );
  if (
    lastAskedSlotForName &&
    !recognizedCustomer &&
    !normalized.customerName &&
    previousNameAttempts >= 2 &&
    !getHumanEscalationReason(normalized)
  ) {
    const lastFourDigits = (normalized.customerPhone ?? "").replace(/\D/g, "").slice(-4);
    normalized.customerName = `Guest${lastFourDigits ? ` ${lastFourDigits}` : ""}`;
    customerNameSourceOverride = "phone_fallback";
    customerNameNeedsReview = true;
  }
  if (
    normalized.customerName &&
    isAcceptableCustomerName(normalized.customerName) &&
    customerNameSourceOverride !== "phone_fallback"
  ) {
    customerNameNeedsReview = false;
  }
  const spokenCustomerName = currentTurnAcceptedCustomerName;
  const customerProfileSource = recognizedCustomer
    ? "active_customer"
    : knownCallerMemory
      ? knownCallerMemory.source ?? "caller_memory"
      : customerNameSourceOverride ?? "current_request";
  const recognizedCustomerNameForSession =
    rejectedRecognizedCustomerName && !currentTurnAcceptedCustomerName
      ? undefined
      : recognizedCustomerReusableName;
  const knownCallerAlreadyAcknowledged =
    readStringAttribute(normalized.attributes, ["knownCallerAcknowledged"]) === "true";
  const shouldAcknowledgeKnownCaller =
    Boolean(recognizedCustomerNameForSession) &&
    !knownCallerAlreadyAcknowledged &&
    !currentTurnAcceptedCustomerName &&
    !rejectedRecognizedCustomerName;

  const transcript =
    callSession && normalized.transcriptText
      ? await createTranscriptForSession(callSession.id, {
          transcriptSource: "amazon_connect_lex",
          transcriptText: normalized.transcriptText
        })
      : null;

  const transcriptDateTime =
    normalized.transcriptText && (!normalized.requestedDate || !normalized.requestedTime)
      ? parseDateTimeText(normalized.transcriptText, salon.timezone, {
          lastAskedSlot: readStringAttribute(normalized.attributes, ["lastAskedSlot"]),
          currentTurnSemanticType: readStringAttribute(normalized.attributes, ["currentTurnSemanticType"])
        })
      : null;
  if (transcriptDateTime?.local.isValid && !transcriptDateTime.ambiguousTime) {
    normalized.requestedDate ??= transcriptDateTime.local.toFormat("yyyy-MM-dd");
    normalized.requestedTime ??= transcriptDateTime.local.toFormat("HH:mm");
  }
  if (normalized.transcriptText && normalized.requestedDate && !normalized.requestedTime) {
    const timePhraseContext = {
      lastAskedSlot: readStringAttribute(normalized.attributes, ["lastAskedSlot"]),
      currentTurnSemanticType: readStringAttribute(normalized.attributes, ["currentTurnSemanticType"])
    };
    const transcriptTimeCandidate = extractTimeCandidate(normalized.transcriptText, timePhraseContext);
    const transcriptTime = transcriptTimeCandidate
      ? parseLocalTimeText(transcriptTimeCandidate, timePhraseContext)
      : null;
    if (transcriptTime && !transcriptTime.ambiguous) {
      normalized.requestedTime = `${String(transcriptTime.hour).padStart(2, "0")}:${String(
        transcriptTime.minute
      ).padStart(2, "0")}`;
    }
  }
  const currentTurnDateText = normalized.currentTurnTranscript ?? normalized.transcriptText;
	  const currentTurnExplicitDate = extractExplicitDate(currentTurnDateText, salon.timezone);
  const currentTurnWeekdayDateConflict = getWeekdayDateConflict(currentTurnDateText, salon.timezone);
  const currentTurnBareSameDayWeekday = getBareSameDayWeekdayClarification(currentTurnDateText, salon.timezone);
  let currentTurnDateClarification:
    | {
        message: string;
        reasonCode:
          | "WEEKDAY_DATE_CONFLICT"
          | "BARE_SAME_DAY_WEEKDAY_AMBIGUOUS"
          | "RELATIVE_EXPLICIT_CONFLICT"
          | "TODAY_TOMORROW_CONFLICT"
          | "TODAY_EXPLICIT_DATE_CONFLICT"
          | "TOMORROW_EXPLICIT_DATE_CONFLICT"
          | "MULTIPLE_TIME_CONFLICT";
        diagnostic: Record<string, unknown>;
      }
    | null = null;
  const currentTurnTemporalConflict = getCurrentTurnTemporalConflict(currentTurnDateText, salon.timezone);
  if (currentTurnTemporalConflict) {
    currentTurnDateClarification = currentTurnTemporalConflict;
    normalized.requestedDate = undefined;
  } else if (currentTurnWeekdayDateConflict) {
    currentTurnDateClarification = {
      message: buildWeekdayDateConflictMessage(currentTurnWeekdayDateConflict),
      reasonCode:
        currentTurnWeekdayDateConflict.conflictReason === "relative_explicit_conflict"
          ? "RELATIVE_EXPLICIT_CONFLICT"
          : "WEEKDAY_DATE_CONFLICT",
      diagnostic: buildDateDecisionDiagnostic({
        rawTranscript: currentTurnDateText,
        timezone: salon.timezone,
        selectedDate: null,
        decisionReason: currentTurnWeekdayDateConflict.conflictReason ?? "weekday_date_conflict",
        clarificationReason: currentTurnWeekdayDateConflict.conflictReason ?? "weekday_date_conflict",
        candidates: [
          {
            source: "explicit",
            date: currentTurnWeekdayDateConflict.explicitDate,
            label: currentTurnWeekdayDateConflict.explicitDateLabel
          },
          {
            source: "relative",
            date: currentTurnWeekdayDateConflict.intendedDate,
            label: currentTurnWeekdayDateConflict.intendedDateLabel
          }
        ],
        explicitDateCandidate: currentTurnWeekdayDateConflict.explicitDate
      })
    };
    normalized.requestedDate = undefined;
  } else if (currentTurnBareSameDayWeekday) {
    currentTurnDateClarification = {
      message: buildBareSameDayWeekdayMessage(currentTurnBareSameDayWeekday),
      reasonCode: "BARE_SAME_DAY_WEEKDAY_AMBIGUOUS",
      diagnostic: buildDateDecisionDiagnostic({
        rawTranscript: currentTurnDateText,
        timezone: salon.timezone,
        selectedDate: null,
        decisionReason: "bare_same_day_weekday_ambiguous",
        clarificationReason: "bare_same_day_weekday_ambiguous",
        candidates: [
          {
            source: "today",
            date: currentTurnBareSameDayWeekday.todayDate,
            label: currentTurnBareSameDayWeekday.todayLabel
          },
          {
            source: "next_week",
            date: currentTurnBareSameDayWeekday.nextDate,
            label: currentTurnBareSameDayWeekday.nextLabel
          }
        ]
      })
    };
    normalized.requestedDate = undefined;
  }
	  const currentTurnExplicitTime = extractExplicitTime(normalized.currentTurnTranscript, {
	    lastAskedSlot: readStringAttribute(normalized.attributes, ["lastAskedSlot"]),
	    currentTurnSemanticType: readStringAttribute(normalized.attributes, ["currentTurnSemanticType"])
	  });
  const awaitingTimeConfirmation =
    readStringAttribute(normalized.attributes, ["awaitingTimeConfirmation"]) === "true";
  const proposedRequestedTime = readStringAttribute(normalized.attributes, ["proposedRequestedTime"]);
  if (awaitingTimeConfirmation && isAffirmative(normalized.currentTurnTranscript) && proposedRequestedTime) {
    normalized.requestedTime = proposedRequestedTime;
    normalized.attributes.awaitingTimeConfirmation = "false";
    normalized.attributes.proposedRequestedTime = "";
  } else if (awaitingTimeConfirmation && isNegative(normalized.currentTurnTranscript)) {
    normalized.requestedTime = undefined;
    normalized.attributes.awaitingTimeConfirmation = "false";
    normalized.attributes.proposedRequestedTime = "";
  }
	  if (currentTurnExplicitDate && !currentTurnDateClarification) {
	    normalized.requestedDate = currentTurnExplicitDate;
	  }
  if (currentTurnExplicitTime && !localTimesEquivalent(normalized.requestedTime, currentTurnExplicitTime)) {
    const explicitTimeMutationPolicy = buildVoiceSlotMutationPolicy({
      slotName: "requestedTime",
      proposedValue: currentTurnExplicitTime,
      trustedValue: readStringAttribute(normalized.attributes, ["requestedTime"]) ?? normalized.requestedTime,
      transcript: normalized.currentTurnTranscript,
      attributes: normalized.attributes
    });
    normalized.attributes.proposedSlotMutation = JSON.stringify(explicitTimeMutationPolicy);
    if (explicitTimeMutationPolicy.accepted) {
      normalized.requestedTime = currentTurnExplicitTime;
      normalized.attributes.acceptedSlotMutations = JSON.stringify([explicitTimeMutationPolicy]);
    } else {
      normalized.attributes.preventedSlotMutations = JSON.stringify([explicitTimeMutationPolicy]);
    }
  }
  const timeRecognition = analyzeTimeRecognition({
    rawTranscript: normalized.currentTurnTranscript,
    lexSlotValue: input.requestedTime ?? normalized.requestedTime,
    context: {
      lastAskedSlot: readStringAttribute(normalized.attributes, ["lastAskedSlot"]),
      currentTurnSemanticType: readStringAttribute(normalized.attributes, ["currentTurnSemanticType"])
    }
  });
  if (timeRecognition.requiresConfirmation && timeRecognition.selectedCandidate) {
    normalized.requestedTime = undefined;
    normalized.attributes.awaitingTimeConfirmation = "true";
    normalized.attributes.proposedRequestedTime = timeRecognition.selectedCandidate.text;
    normalized.attributes.timeRecognitionDiagnostics = JSON.stringify(timeRecognition);
  }

  const awaitingBookingFrameRepairConfirmation =
    readStringAttribute(normalized.attributes, ["awaitingBookingFrameRepairConfirmation"]) === "true";
  const proposedFrameDate = readStringAttribute(normalized.attributes, ["proposedRequestedDate"]);
  const proposedFrameService = readStringAttribute(normalized.attributes, ["proposedServiceName"]);
  const proposedFrameStaff = readStringAttribute(normalized.attributes, ["proposedStaffPreference"]);
  if (
    awaitingBookingFrameRepairConfirmation &&
    isAffirmative(normalized.currentTurnTranscript) &&
    (proposedFrameDate || proposedFrameService) &&
    proposedFrameStaff
  ) {
    if (proposedFrameDate) {
      normalized.requestedDate = proposedFrameDate;
    }
    if (proposedFrameService) {
      normalized.serviceName = proposedFrameService;
      normalized.attributes.serviceRecognitionConfirmed = "true";
    }
    normalized.staffPreference = proposedFrameStaff;
    normalized.staffId = undefined;
    normalized.confirmationState = undefined;
    normalized.attributes.awaitingBookingFrameRepairConfirmation = "false";
    normalized.attributes.proposedRequestedDate = "";
    normalized.attributes.proposedServiceName = "";
    normalized.attributes.proposedStaffPreference = "";
    normalized.attributes.bookingFrameRepairConfirmed = "true";
    normalized.attributes.lastAskedSlot = "bookingFrameRepairConfirmation";
    normalized.attributes.awaitingFinalBookingConfirmation = "false";
    normalized.attributes.bookingConfirmationAsked = "false";
  } else if (awaitingBookingFrameRepairConfirmation && isNegative(normalized.currentTurnTranscript)) {
    if (proposedFrameDate) {
      normalized.requestedDate = undefined;
    }
    normalized.staffPreference = undefined;
    normalized.staffId = undefined;
    normalized.confirmationState = undefined;
    normalized.attributes.awaitingBookingFrameRepairConfirmation = "false";
    normalized.attributes.proposedRequestedDate = "";
    normalized.attributes.proposedServiceName = "";
    normalized.attributes.proposedStaffPreference = "";
    normalized.attributes.bookingFrameRepairConfirmed = "false";
    normalized.attributes.bookingFrameRepairRejected = "true";
  }

  const awaitingPastTimeTomorrowConfirmation =
    readStringAttribute(normalized.attributes, ["awaitingPastTimeTomorrowConfirmation"]) === "true";
  const proposedPastTimeDate = readStringAttribute(normalized.attributes, ["proposedRequestedDate"]);
  const proposedPastTimeTime = readStringAttribute(normalized.attributes, ["proposedRequestedTime"]);
  const currentTurnPastTimeCorrectionDate =
    awaitingPastTimeTomorrowConfirmation && currentTurnExplicitDate
      ? currentTurnExplicitDate
      : undefined;
  const currentTurnPastTimeCorrectionTime =
    awaitingPastTimeTomorrowConfirmation && currentTurnExplicitTime
      ? currentTurnExplicitTime
      : undefined;
  if (
    awaitingPastTimeTomorrowConfirmation &&
    (currentTurnPastTimeCorrectionDate || currentTurnPastTimeCorrectionTime)
  ) {
    if (currentTurnPastTimeCorrectionDate) {
      normalized.requestedDate = currentTurnPastTimeCorrectionDate;
    }
    if (currentTurnPastTimeCorrectionTime) {
      normalized.requestedTime = currentTurnPastTimeCorrectionTime;
    }
    normalized.attributes.awaitingPastTimeTomorrowConfirmation = "false";
    normalized.attributes.proposedRequestedDate = "";
    normalized.attributes.proposedRequestedTime = "";
    normalized.attributes.dateTimeValidationReason = "";
    normalized.attributes.temporalRejectionReason = "";
    normalized.attributes.pastTimeProposalConfirmed = "false";
    normalized.attributes.pastTimeProposalRejectedThisTurn = "";
    normalized.attributes.pastTimeProposalCorrectedThisTurn = "true";
    normalized.attributes.awaitingFinalBookingConfirmation = "false";
    normalized.attributes.bookingConfirmationAsked = "false";
  } else if (
    awaitingPastTimeTomorrowConfirmation &&
    isAffirmative(normalized.currentTurnTranscript) &&
    proposedPastTimeDate &&
    proposedPastTimeTime
  ) {
    normalized.requestedDate = proposedPastTimeDate;
    normalized.requestedTime = proposedPastTimeTime;
    normalized.attributes.awaitingPastTimeTomorrowConfirmation = "false";
    normalized.attributes.proposedRequestedDate = "";
    normalized.attributes.proposedRequestedTime = "";
    normalized.attributes.dateTimeValidationReason = "";
    normalized.attributes.temporalRejectionReason = "";
    normalized.attributes.pastTimeProposalConfirmed = "true";
    normalized.attributes.pastTimeProposalRejectedThisTurn = "";
    normalized.attributes.awaitingFinalBookingConfirmation = "false";
    normalized.attributes.bookingConfirmationAsked = "false";
  } else if (awaitingPastTimeTomorrowConfirmation && isNegative(normalized.currentTurnTranscript)) {
    normalized.requestedDate = undefined;
    normalized.requestedTime = proposedPastTimeTime ?? normalized.requestedTime;
    normalized.attributes.awaitingPastTimeTomorrowConfirmation = "false";
    normalized.attributes.proposedRequestedDate = "";
    normalized.attributes.proposedRequestedTime = proposedPastTimeTime ?? "";
    normalized.attributes.pastTimeProposalConfirmed = "false";
    normalized.attributes.pastTimeProposalRejectedThisTurn = "true";
    normalized.attributes.awaitingFinalBookingConfirmation = "false";
    normalized.attributes.bookingConfirmationAsked = "false";
  }

  const awaitingServiceConfirmation =
    readStringAttribute(normalized.attributes, ["awaitingServiceConfirmation"]) === "true";
  const proposedServiceName = readStringAttribute(normalized.attributes, ["proposedServiceName"]);
  if (awaitingServiceConfirmation && isAffirmative(normalized.currentTurnTranscript) && proposedServiceName) {
    normalized.serviceName = proposedServiceName;
    normalized.attributes.awaitingServiceConfirmation = "false";
    normalized.attributes.proposedServiceName = "";
    normalized.attributes.serviceRecognitionConfirmed = "true";
    normalized.attributes.clarificationReason = "service_proposal_confirmed";
  } else if (awaitingServiceConfirmation && isNegative(normalized.currentTurnTranscript)) {
    normalized.serviceName = undefined;
    normalized.attributes.awaitingServiceConfirmation = "false";
    normalized.attributes.proposedServiceName = "";
    normalized.attributes.serviceRecognitionConfirmed = "false";
    normalized.attributes.clarificationReason = "service_proposal_rejected";
  }

  const awaitingStaffConfirmation =
    readStringAttribute(normalized.attributes, ["awaitingStaffConfirmation"]) === "true";
  const proposedStaffPreference = readStringAttribute(normalized.attributes, ["proposedStaffPreference"]);
  if (awaitingStaffConfirmation && isAffirmative(normalized.currentTurnTranscript) && proposedStaffPreference) {
    normalized.staffPreference = proposedStaffPreference;
    normalized.staffId = undefined;
    normalized.attributes.awaitingStaffConfirmation = "false";
    normalized.attributes.proposedStaffPreference = "";
    normalized.attributes.staffReplacementPreviousStaff = "";
    normalized.attributes.staffReplacementPreviousStaffId = "";
    normalized.attributes.staffReplacementPreviousSelectedStaffId = "";
    normalized.attributes.staffReplacementPreviousConfirmedStaffId = "";
    normalized.attributes.staffRecognitionConfirmed = "true";
    normalized.attributes.staffClarificationReason = "staff_proposal_confirmed";
  } else if (awaitingStaffConfirmation && isStaffConfirmationRejection(normalized.currentTurnTranscript)) {
    const replacementPreviousStaff = readStringAttribute(normalized.attributes, ["staffReplacementPreviousStaff"]);
    if (replacementPreviousStaff) {
      normalized.staffPreference = replacementPreviousStaff;
      normalized.staffId =
        readStringAttribute(normalized.attributes, ["staffReplacementPreviousStaffId"]) ??
        normalized.staffId;
      normalized.attributes.confirmedStaffName = replacementPreviousStaff;
      normalized.attributes.confirmedStaffId =
        readStringAttribute(normalized.attributes, ["staffReplacementPreviousConfirmedStaffId"]) ??
        normalized.attributes.confirmedStaffId;
      normalized.attributes.selectedStaffId =
        readStringAttribute(normalized.attributes, ["staffReplacementPreviousSelectedStaffId"]) ??
        normalized.attributes.selectedStaffId;
      normalized.attributes.awaitingFinalBookingConfirmation = "true";
      normalized.attributes.bookingConfirmationAsked = "true";
      normalized.attributes.lastAskedSlot = "bookingConfirmation";
    } else {
      normalized.staffPreference = undefined;
      normalized.staffId = undefined;
    }
    normalized.attributes.awaitingStaffConfirmation = "false";
    normalized.attributes.proposedStaffPreference = "";
    normalized.attributes.staffReplacementPreviousStaff = "";
    normalized.attributes.staffReplacementPreviousStaffId = "";
    normalized.attributes.staffReplacementPreviousSelectedStaffId = "";
    normalized.attributes.staffReplacementPreviousConfirmedStaffId = "";
    normalized.attributes.staffRecognitionConfirmed = "false";
    normalized.attributes.staffClarificationReason = replacementPreviousStaff
      ? "staff_replacement_proposal_rejected"
      : "staff_proposal_rejected";
  }

  if (!unsupportedServiceRequest && !normalized.serviceName && normalized.transcriptText) {
    const serviceMention = await findServiceMentionInText(salon.id, normalized.transcriptText);
    if (serviceMention) {
      normalized.serviceName = getCustomerFacingServiceName(serviceMention.service.name);
    }
  }

	  const awaitingAlternativeSelection =
	    readStringAttribute(normalized.attributes, ["awaitingAlternativeSelection"]) === "true";
  const activeBookingConfirmationSlot =
    readStringAttribute(normalized.attributes, ["lastAskedSlot"]) === "bookingConfirmation" ||
    readStringAttribute(normalized.attributes, ["slotToElicit"]) === "bookingConfirmation" ||
    Boolean(normalized.bookingConfirmation);
	  const awaitingFinalBookingConfirmation =
    readStringAttribute(normalized.attributes, ["awaitingRejectedBookingChoice"]) !== "true" &&
    readStringAttribute(normalized.attributes, ["freshBookingRestart"]) !== "true" &&
    (readStringAttribute(normalized.attributes, ["awaitingFinalBookingConfirmation"]) === "true" ||
      (readStringAttribute(normalized.attributes, [
        "bookingConfirmationAsked",
        "finalBookingConfirmationAsked"
      ]) === "true" &&
        activeBookingConfirmationSlot));
  const customerNameTurnOwnsTranscript =
    readStringAttribute(normalized.attributes, ["lastAskedSlot"]) === "customerName" &&
    readStringAttribute(normalized.attributes, ["activeDtmfMenu"]) !== "staff";
  const finalConfirmationText =
    normalized.bookingConfirmation ?? normalized.currentTurnTranscript ?? normalized.transcriptText;
  const finalConfirmationOnlyPhrase =
    awaitingFinalBookingConfirmation && isFinalConfirmationOnlyPhrase(finalConfirmationText);
  const preStaffBusinessHoursDayDecision = normalized.requestedDate
    ? await getBusinessHoursDayDecision({
        salonId: salon.id,
        timezone: salon.timezone,
        requestedDate: normalized.requestedDate
      })
    : null;
  const requestedDayIsClosedBeforeStaff = Boolean(
    preStaffBusinessHoursDayDecision && !preStaffBusinessHoursDayDecision.allowed
  );
  const staffPhraseContext = staffPhraseContextFromAttributes(normalized.attributes);
  let currentTurnStaffMention: string | undefined;
  const staffIdBeforeCurrentTurn =
    readStringAttribute(normalized.attributes, ["selectedStaffId", "confirmedStaffId", "staffId"]) ??
    normalized.staffId;
  const staffNameBeforeCurrentTurn =
    readStringAttribute(normalized.attributes, ["confirmedStaffName", "staffPreference"]) ??
    normalized.staffPreference;
  const currentTurnAllowsUnmatchedStaff =
    !requestedDayIsClosedBeforeStaff &&
    Boolean(normalized.currentTurnTranscript) &&
    !customerNameTurnOwnsTranscript &&
    !finalConfirmationOnlyPhrase &&
    (readStringAttribute(normalized.attributes, ["lastAskedSlot"]) === "staffPreference" ||
      readStringAttribute(normalized.attributes, ["activeDtmfMenu"]) === "staff" ||
      hasStaffCuePhrase(normalized.currentTurnTranscript, staffPhraseContext));
  const currentTurnStaffCandidate = currentTurnAllowsUnmatchedStaff
    ? normalizeScopedStaffCandidatePhrase(normalized.currentTurnTranscript, staffPhraseContext)
    : undefined;
  const currentTurnHasExplicitStaffPhrase = currentTurnAllowsUnmatchedStaff
    ? hasExplicitStaffPhrase(normalized.currentTurnTranscript, staffPhraseContext)
    : false;
  const staffExclusionState = readStaffExclusionState(normalized.attributes);
  let allBookableStaffForExclusion: StaffCandidate[] = [];
  let staffIntent: StaffIntentParseResult = {
    selectionMode: "UNKNOWN",
    excludedStaff: [],
    hasExplicitExclusion: false
  };
  let hasActiveStaffExclusions =
    staffExclusionState.ids.size > 0 || staffExclusionState.names.size > 0;
  let shouldAutoSelectAnyStaffAfterExclusion = false;
  let finalConfirmationRequiresStaffSelection = false;
  let finalConfirmationStaffChangeAcknowledgement: string | undefined;
  let finalConfirmationOutcome: ReturnType<typeof classifyFinalBookingConfirmation> = "UNKNOWN";

  if (!requestedDayIsClosedBeforeStaff) {
    currentTurnStaffMention =
      normalized.currentTurnTranscript && !customerNameTurnOwnsTranscript && !finalConfirmationOnlyPhrase
        ? await findStaffMentionInText(salon.id, normalized.currentTurnTranscript, staffPhraseContext)
        : undefined;
    if (currentTurnStaffMention) {
      const previousStaffPreference = normalized.staffPreference;
      normalized.staffPreference = currentTurnStaffMention;
      if (
        previousStaffPreference &&
        normalizeForMatch(previousStaffPreference) !== normalizeForMatch(currentTurnStaffMention)
      ) {
        normalized.staffId = undefined;
      }
    } else if (currentTurnHasExplicitStaffPhrase) {
      normalized.staffPreference =
        currentTurnStaffCandidate && currentTurnStaffCandidate !== "any staff"
          ? currentTurnStaffCandidate
          : undefined;
      normalized.staffId = undefined;
    } else if (!normalized.staffPreference && normalized.transcriptText) {
      normalized.staffPreference = await findStaffMentionInText(
        salon.id,
        normalized.transcriptText,
        staffPhraseContext
      );
    }

    allBookableStaffForExclusion = await getActiveBookableStaff(salon.id);
    const explicitlySelectedStaff =
      currentTurnStaffMention && currentTurnStaffMention !== "Any staff"
        ? allBookableStaffForExclusion.find((member) => staffMatchesName(member, currentTurnStaffMention))
        : undefined;
    if (explicitlySelectedStaff) {
      removeStaffFromExclusionState(staffExclusionState, explicitlySelectedStaff);
    }
    staffIntent = parseStaffIntent({
      text: finalConfirmationText,
      staff: allBookableStaffForExclusion,
      currentStaffId: staffIdBeforeCurrentTurn,
      currentStaffName: staffNameBeforeCurrentTurn,
      context: staffPhraseContext
    });
    staffIntent.excludedStaff.forEach((member) => addStaffToExclusionState(staffExclusionState, member));
    hasActiveStaffExclusions =
      staffExclusionState.ids.size > 0 || staffExclusionState.names.size > 0;
    const normalizedStaffMember = allBookableStaffForExclusion.find(
      (member) =>
        (normalized.staffId && member.id === normalized.staffId) ||
        staffMatchesName(member, normalized.staffPreference)
    );
    const normalizedStaffIsExcluded =
      normalizedStaffMember && staffIsExcluded(normalizedStaffMember, staffExclusionState.ids, staffExclusionState.names);
    const currentStaffWasExplicitlyExcluded = staffIntent.excludedStaff.some(
      (member) =>
        (staffIdBeforeCurrentTurn && member.id === staffIdBeforeCurrentTurn) ||
        staffMatchesName(member, staffNameBeforeCurrentTurn)
    );
    shouldAutoSelectAnyStaffAfterExclusion =
      awaitingFinalBookingConfirmation &&
      staffIntent.hasExplicitExclusion &&
      currentStaffWasExplicitlyExcluded &&
      staffIntent.selectionMode !== "SPECIFIC";
    if (staffIntent.hasExplicitExclusion || staffIntent.selectionMode === "CHANGE" || normalizedStaffIsExcluded) {
      if (
        staffIntent.selectionMode === "ANY" ||
        currentTurnStaffMention === "Any staff" ||
        shouldAutoSelectAnyStaffAfterExclusion
      ) {
        normalized.staffPreference = "Any staff";
      } else if (normalizedStaffIsExcluded || staffIntent.selectionMode === "CHANGE") {
        normalized.staffPreference = undefined;
      }
      normalized.staffId = undefined;
      normalized.confirmationState = undefined;
    }
    applyStaffExclusionStateToAttributes(normalized.attributes, staffExclusionState);

    finalConfirmationRequiresStaffSelection =
      awaitingFinalBookingConfirmation &&
      (staffIntent.hasExplicitExclusion || staffIntent.selectionMode === "CHANGE") &&
      staffIntent.selectionMode !== "ANY" &&
      !shouldAutoSelectAnyStaffAfterExclusion;
    finalConfirmationOutcome = awaitingFinalBookingConfirmation
      ? classifyFinalBookingConfirmation(finalConfirmationText, {
          hasExplicitStaffChange: Boolean(
            currentTurnStaffMention ||
            staffIntent.hasExplicitExclusion ||
            staffIntent.selectionMode === "CHANGE" ||
            staffIntent.selectionMode === "ANY"
          )
        })
      : "UNKNOWN";
	    if (awaitingFinalBookingConfirmation && finalConfirmationOutcome === "NEW_BOOKING") {
      applyFreshBookingResetToNormalized(normalized, {
        restartBookingWithDetails: currentTurnHasBookingDetails(normalized) ? "true" : "false"
      });
    } else if (awaitingFinalBookingConfirmation && finalConfirmationOutcome === "AFFIRMED") {
	      normalized.confirmationState = "Confirmed";
	    } else if (awaitingFinalBookingConfirmation && finalConfirmationOutcome === "DENIED") {
	      normalized.confirmationState = "Denied";
    } else if (awaitingFinalBookingConfirmation && finalConfirmationOutcome === "CHANGE_REQUEST") {
      normalized.confirmationState = undefined;
      const changedDate = extractExplicitDate(finalConfirmationText, salon.timezone);
      const changedTime = extractExplicitTime(finalConfirmationText);
      const clearedDate = rejectsMentionedDate(finalConfirmationText);
      const requestsStaffChange =
        /\b(?:change|switch)\s+(?:the\s+)?(?:person|staff|technician|tech)\b/.test(
          normalizeForMatch(finalConfirmationText)
        ) ||
        /\b(?:someone else|different person|different staff|different technician|different tech)\b/.test(
          normalizeForMatch(finalConfirmationText)
        ) ||
        (!clearedDate && /\bnot\s+(?!correct\b|right\b|book\b|it\b|that\b|my\b|me\b|name\b)[a-z][a-z\s'-]{1,40}\b/.test(
          normalizeForMatch(finalConfirmationText)
        )) ||
        /\bwith\s+[a-z][a-z\s'-]{1,40}\s+instead\b/.test(normalizeForMatch(finalConfirmationText));
      if (clearedDate) {
        normalized.requestedDate = undefined;
      } else if (changedDate) {
        normalized.requestedDate = changedDate;
      }
      if (changedTime) {
        normalized.requestedTime = changedTime;
      }
      if (finalConfirmationText) {
        const changedService = await findServiceMentionInText(salon.id, finalConfirmationText);
        if (changedService) {
          normalized.serviceName = getCustomerFacingServiceName(changedService.service.name);
        }
        const genericStaffChangeWithoutName =
          /\b(?:change|switch)\s+(?:the\s+)?(?:person|staff|technician|tech)\b/.test(
            normalizeForMatch(finalConfirmationText)
          ) ||
          /\b(?:someone else|different person|different staff|different technician|different tech)\b/.test(
            normalizeForMatch(finalConfirmationText)
          );
        const currentTurnDesiredStaffCandidate =
          currentTurnStaffCandidate && currentTurnStaffCandidate !== "any staff"
            ? currentTurnStaffCandidate
            : undefined;
        const changedStaff = genericStaffChangeWithoutName
          ? undefined
          : shouldAutoSelectAnyStaffAfterExclusion
            ? undefined
            : currentTurnStaffMention ??
              currentTurnDesiredStaffCandidate ??
              await findStaffMentionInText(salon.id, finalConfirmationText, staffPhraseContext);
        if (shouldAutoSelectAnyStaffAfterExclusion) {
          normalized.staffPreference = "Any staff";
          normalized.staffId = undefined;
          finalConfirmationRequiresStaffSelection = false;
        } else if (changedStaff) {
          normalized.staffPreference = changedStaff;
          normalized.staffId = undefined;
          finalConfirmationRequiresStaffSelection = false;
          finalConfirmationStaffChangeAcknowledgement = `Got it, with ${changedStaff} instead.`;
        } else if (requestsStaffChange) {
          normalized.staffPreference = undefined;
          normalized.staffId = undefined;
          finalConfirmationRequiresStaffSelection = true;
        }
      }
    } else if (awaitingFinalBookingConfirmation && finalConfirmationOutcome === "UNKNOWN") {
      normalized.confirmationState = undefined;
    }
    if (
      awaitingFinalBookingConfirmation &&
      !shouldAutoSelectAnyStaffAfterExclusion &&
      !currentTurnStaffMention &&
      (/\b(?:change|switch)\s+(?:the\s+)?(?:person|staff|technician|tech)\b/.test(
        normalizeForMatch(finalConfirmationText)
      ) ||
        /\b(?:someone else|different person|different staff|different technician|different tech)\b/.test(
          normalizeForMatch(finalConfirmationText)
        ))
    ) {
      normalized.confirmationState = undefined;
      normalized.staffPreference = undefined;
      normalized.staffId = undefined;
      finalConfirmationRequiresStaffSelection = true;
    }
    const selectedExcludedStaffAfterCorrection = allBookableStaffForExclusion.find(
      (member) =>
        ((normalized.staffId && member.id === normalized.staffId) ||
          staffMatchesName(member, normalized.staffPreference)) &&
        staffIsExcluded(member, staffExclusionState.ids, staffExclusionState.names)
    );
    if (selectedExcludedStaffAfterCorrection) {
      normalized.staffPreference = undefined;
      normalized.staffId = undefined;
      normalized.confirmationState = undefined;
      finalConfirmationRequiresStaffSelection = true;
    }
  } else {
    applyStaffExclusionStateToAttributes(normalized.attributes, staffExclusionState);
  }

  const activeAlternativeSlots = awaitingAlternativeSelection
    ? parseAlternativeSlotsAttribute(normalized.attributes)
    : [];
  const currentTurnText = normalized.currentTurnTranscript ?? normalized.transcriptText;
  const currentTurnHasExplicitDate = Boolean(currentTurnExplicitDate);
  const currentTurnHasExplicitTime = Boolean(currentTurnExplicitTime);
  const currentTurnRejectsAlternative =
    awaitingAlternativeSelection &&
    !currentTurnHasExplicitDate &&
    !currentTurnHasExplicitTime &&
    !currentTurnStaffMention &&
    (isNegative(currentTurnText) || /\b(?:not those|neither|none of those|no thanks)\b/.test(normalizeForMatch(currentTurnText)));
  const currentTurnChangesAlternativeAnchor =
    awaitingAlternativeSelection &&
    (currentTurnHasExplicitDate || currentTurnHasExplicitTime || Boolean(currentTurnStaffMention));
  const currentTurnRequestsAnyStaffSameTime =
    awaitingAlternativeSelection &&
    /\b(?:anyone|any staff|first available|whoever|for available)\b.*\b(?:same time|this time|that time|available|at)\b/.test(
      normalizeForMatch(currentTurnText)
    );

  if (currentTurnRejectsAlternative) {
    normalized.requestedTime = undefined;
    normalized.staffId = undefined;
  }
  if (currentTurnRequestsAnyStaffSameTime) {
    normalized.staffPreference = "Any staff";
    normalized.staffId = undefined;
  }

  const selectedAlternative = currentTurnRejectsAlternative || currentTurnChangesAlternativeAnchor || currentTurnRequestsAnyStaffSameTime
    ? null
    : selectAlternativeSlotFromText({
        alternatives: activeAlternativeSlots,
        transcriptText: normalized.currentTurnTranscript,
        requestedTime: currentTurnHasExplicitTime ? normalized.requestedTime : undefined,
        staffPreference: currentTurnStaffMention ? normalized.staffPreference : undefined,
        timezone: salon.timezone,
        allowAffirmativeSingleOption: awaitingAlternativeSelection
      });
  if (selectedAlternative) {
    const selectedLocalStart = DateTime.fromISO(selectedAlternative.startTime, { zone: "utc" }).setZone(
      salon.timezone
    );
    normalized.requestedDate = selectedLocalStart.toFormat("yyyy-MM-dd");
    normalized.requestedTime = selectedLocalStart.toFormat("HH:mm");
    normalized.staffPreference = selectedAlternative.staffName;
    normalized.staffId = selectedAlternative.staffId;
    if (!awaitingFinalBookingConfirmation) {
      normalized.confirmationState = undefined;
    }
  }

  let serviceMatch = normalized.serviceName
    ? await resolveServiceMatch(salon.id, normalized.serviceName)
    : null;
  if (
    normalized.serviceName &&
    (!serviceMatch ||
      (!shouldAutoAcceptServiceMatch(serviceMatch, normalized.serviceName) &&
        !isAffirmative(normalized.serviceName)))
  ) {
    normalized.serviceName = undefined;
    serviceMatch = null;
  }
  if (isBillingLikeServiceCollision(normalized.currentTurnTranscript ?? normalized.transcriptText)) {
    normalized.serviceName = undefined;
    serviceMatch = null;
  }

  const createAttempt = async (inputForAttempt: {
    status: BookingAttemptStatus;
    appointmentId?: string;
    requestedStartTime?: Date;
    normalizedRequest?: unknown;
    alternativeSlots?: SuggestedSlot[];
    failureReason?: string;
  }) => {
    const inputNormalizedRequest =
      inputForAttempt.normalizedRequest &&
      typeof inputForAttempt.normalizedRequest === "object" &&
      !Array.isArray(inputForAttempt.normalizedRequest)
        ? (inputForAttempt.normalizedRequest as Record<string, unknown>)
        : {};
    const bookingRequestFingerprint = stableHash({
      salonId: salon.id,
      customerId: recognizedCustomer?.id,
      customerPhone:
        normalizeCustomerPhone(normalized.customerPhone) ??
        normalizePhoneForMatching(normalized.customerPhone),
      serviceId: inputNormalizedRequest.serviceId,
      serviceName: inputNormalizedRequest.serviceName ?? normalized.serviceName,
      requestedDate: inputNormalizedRequest.requestedDate ?? normalized.requestedDate,
      requestedTime: inputNormalizedRequest.requestedTime ?? normalized.requestedTime,
      startTimeIso:
        inputNormalizedRequest.startTimeIso ??
        inputForAttempt.requestedStartTime?.toISOString() ??
        normalized.requestedDate,
      staffId: inputNormalizedRequest.staffId ?? normalized.staffId,
      staffPreference: inputNormalizedRequest.staffPreference ?? normalized.staffPreference,
      availabilityReasonCode: inputNormalizedRequest.availabilityReasonCode,
      logicalStatus:
        inputForAttempt.status === BookingAttemptStatus.SUCCESS
          ? "SUCCESS"
          : inputForAttempt.status === BookingAttemptStatus.NO_AVAILABILITY
            ? "NO_AVAILABILITY"
            : "IN_PROGRESS"
    });
    const normalizedRequest = toJson({
      salonId: salon.id,
      salonResolutionSource: resolutionSource,
      customerId: recognizedCustomer?.id,
      recognizedCustomerId: recognizedCustomer?.id,
      spokenCustomerName,
      persistedCustomerFirstName: recognizedCustomer?.firstName,
      persistedCustomerLastName: recognizedCustomer?.lastName,
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      customerNameSource: customerNameSourceOverride,
      customerProfileSource,
      customerNameNeedsReview: customerNameNeedsReview || undefined,
      serviceName: normalized.serviceName,
      requestedDate: normalized.requestedDate,
      requestedTime: normalized.requestedTime,
      staffPreference: normalized.staffPreference,
      staffId: normalized.staffId,
      selectedStaffId: normalized.staffId,
      unrecognizedStaffUtterance: normalized.unrecognizedStaffUtterance,
      excludedStaffIds: Array.from(staffExclusionState.ids.values()),
      excludedStaffNames: Array.from(staffExclusionState.names.values()),
      releaseIdentity: buildVoiceReleaseIdentity(normalized.attributes),
      bookingRequestFingerprint,
      ...inputNormalizedRequest
    });
    const data = {
      salonId: salon.id,
      callSessionId: callSession?.id,
      transcriptId: transcript?.id,
      appointmentId: inputForAttempt.appointmentId,
      status: inputForAttempt.status,
      source: normalized.source,
      customerName: normalized.customerName,
      customerPhone:
        normalizeCustomerPhone(normalized.customerPhone) ??
        normalizePhoneForMatching(normalized.customerPhone),
      requestedService: normalized.serviceName,
      requestedStaff: normalized.staffPreference,
      requestedDateTimeText:
        inputForAttempt.requestedStartTime?.toISOString() ?? normalized.requestedDate,
      normalizedRequest,
      alternativeSlots:
        inputForAttempt.alternativeSlots === undefined
          ? undefined
          : toJson(inputForAttempt.alternativeSlots),
      failureReason: inputForAttempt.failureReason ?? null,
      rawInput: toJson({
        ...input,
        releaseIdentity: buildVoiceReleaseIdentity(normalized.attributes),
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

    if (callSession && inputForAttempt.status !== BookingAttemptStatus.SUCCESS) {
      const recentAttempts = await prisma.bookingAttempt.findMany({
        where: {
          callSessionId: callSession.id,
          appointmentId: null,
          status: {
            not: BookingAttemptStatus.SUCCESS
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 12
      });
      const matchingAttempt = recentAttempts.find((attempt) => {
        const previousRequest = recordFromUnknown(attempt.normalizedRequest);
        return previousRequest.bookingRequestFingerprint === bookingRequestFingerprint;
      });
      if (matchingAttempt) {
        const updated = await prisma.bookingAttempt.update({
          where: {
            id: matchingAttempt.id
          },
          data
        });
        activeBookingAttempt =
          updated.status === BookingAttemptStatus.NEEDS_INPUT ? updated : null;
        return updated;
      }
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
    if (["BOOKED", "RESCHEDULED"].includes(inputForCall.outcome)) {
      const currentCall = await prisma.callSession.findUnique({
        where: {
          id: callSession.id
        },
        select: {
          status: true,
          startedAt: true,
          endedAt: true
        }
      });
      const terminalCallStatuses = new Set<CallSessionStatus>([
        CallSessionStatus.COMPLETED,
        CallSessionStatus.MISSED,
        CallSessionStatus.FAILED,
        CallSessionStatus.CANCELED,
        CallSessionStatus.VOICEMAIL
      ]);
      if (currentCall && !terminalCallStatuses.has(currentCall.status)) {
        const endedAt = currentCall.endedAt ?? new Date();
        await prisma.callSession.update({
          where: {
            id: callSession.id
          },
          data: {
            status: CallSessionStatus.COMPLETED,
            endedAt,
            durationSeconds: currentCall.startedAt
              ? Math.max(0, Math.round((endedAt.getTime() - currentCall.startedAt.getTime()) / 1000))
              : undefined
          }
        });
      }
    }
  };

  const createInteraction = async (inputForInteraction: {
    outcome: AmazonConnectAIAppointmentOutcome;
    message: string;
    parsed: BookingIntentResult;
    bookingAttemptId: string;
    responsePayload: unknown;
    isValid: boolean;
  }) => {
    const responsePayloadBase =
      inputForInteraction.responsePayload &&
      typeof inputForInteraction.responsePayload === "object" &&
      !Array.isArray(inputForInteraction.responsePayload)
        ? (inputForInteraction.responsePayload as Record<string, unknown>)
        : { payload: inputForInteraction.responsePayload };
    const responseSessionAttributes =
      inputForInteraction.responsePayload &&
      typeof inputForInteraction.responsePayload === "object" &&
      !Array.isArray(inputForInteraction.responsePayload) &&
      "sessionAttributes" in inputForInteraction.responsePayload
        ? (inputForInteraction.responsePayload as { sessionAttributes?: unknown }).sessionAttributes
        : undefined;
    const responseSessionAttributesRecord =
      responseSessionAttributes &&
      typeof responseSessionAttributes === "object" &&
      !Array.isArray(responseSessionAttributes)
        ? (responseSessionAttributes as Record<string, unknown>)
        : {};
    const responseSlotToElicit =
      inputForInteraction.responsePayload &&
      typeof inputForInteraction.responsePayload === "object" &&
      !Array.isArray(inputForInteraction.responsePayload) &&
      "slotToElicit" in inputForInteraction.responsePayload
        ? (inputForInteraction.responsePayload as { slotToElicit?: unknown }).slotToElicit
        : undefined;
    const inferredResponseSessionAttributes =
      Object.keys(responseSessionAttributesRecord).length || typeof responseSlotToElicit !== "string"
        ? responseSessionAttributesRecord
        : buildKnownSessionAttributes({
            lastAskedSlot: responseSlotToElicit,
            slotToElicit: responseSlotToElicit,
            askedSlotsCount: "1",
            fallbackCount: "1",
            errorCount: "1"
          });
    if (
      typeof responseSlotToElicit === "string" &&
      responseSlotToElicit === "staffPreference" &&
      !inferredResponseSessionAttributes.activeDtmfMenu
    ) {
      Object.assign(inferredResponseSessionAttributes, {
        activeDtmfMenu: "staff",
        activeDtmfOptionsJson: JSON.stringify({
          ...readStaffDtmfOptions(inferredResponseSessionAttributes),
          "0": "__operator__"
        })
      });
    }
    if (
      typeof responseSlotToElicit === "string" &&
      responseSlotToElicit === "serviceName" &&
      !inferredResponseSessionAttributes.activeDtmfMenu
    ) {
      Object.assign(inferredResponseSessionAttributes, servicePromptSessionAttributes);
    }
    const responsePayloadDebug =
      input.attributes?.lexTurnDebug && typeof input.attributes.lexTurnDebug === "object"
        ? {
            ...input.attributes.lexTurnDebug,
            attributesAfter: inferredResponseSessionAttributes,
            sessionAttributesAfter: inferredResponseSessionAttributes,
            lastAskedSlotAfter: inferredResponseSessionAttributes.lastAskedSlot,
            activeDtmfMenuAfter: inferredResponseSessionAttributes.activeDtmfMenu,
            activeDtmfOptionsAfter: parseDtmfOptionsForHistory(
              inferredResponseSessionAttributes.activeDtmfOptionsJson
            ),
            trustedSlotsAfter: {
              customerName: inferredResponseSessionAttributes.customerName,
              customerPhone: inferredResponseSessionAttributes.customerPhone,
              serviceName: inferredResponseSessionAttributes.serviceName,
              confirmedServiceName: inferredResponseSessionAttributes.confirmedServiceName,
              requestedDate: inferredResponseSessionAttributes.requestedDate,
              requestedTime: inferredResponseSessionAttributes.requestedTime,
              staffPreference: inferredResponseSessionAttributes.staffPreference,
              confirmedStaffName: inferredResponseSessionAttributes.confirmedStaffName,
              staffId: inferredResponseSessionAttributes.staffId,
              selectedStaffId: inferredResponseSessionAttributes.selectedStaffId
            },
            slotToElicit: responseSlotToElicit,
            responseMessage: inputForInteraction.message
          }
        : undefined;
    const parseDiagnosticJson = (value: unknown): unknown => {
      if (typeof value !== "string" || !value.trim()) {
        return value;
      }
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    };
    const responseDebugRecord = responsePayloadDebug
      ? (responsePayloadDebug as Record<string, unknown>)
      : undefined;
    const responseSanitization =
      responseDebugRecord?.sanitization &&
      typeof responseDebugRecord.sanitization === "object" &&
      !Array.isArray(responseDebugRecord.sanitization)
        ? (responseDebugRecord.sanitization as Record<string, unknown>)
        : undefined;
	    const timingDiagnostics = buildAmazonConnectTimingDiagnostics({
	      attributes: input.attributes,
	      promptText: inputForInteraction.message,
	      promptExpectedToPlay: true,
	      providerDisconnectedAt: readProviderDisconnectedAtFromCallSession(callSession)
	    });
	    const lexResponseForDiagnostics = recordFromUnknown(responsePayloadBase.lexResponse);
	    const dialogActionForDiagnostics = recordFromUnknown(lexResponseForDiagnostics.dialogAction);
	    const responseMessageContentType = inferLexMessageContentType(
	      inputForInteraction.message,
	      lexResponseForDiagnostics
	    );
	    const responseSsmlValidation = validateSsmlForDiagnostics(
	      responseMessageContentType,
	      inputForInteraction.message
	    );
	    const lambdaResponseFingerprint = createHash("sha256")
	      .update(
	        JSON.stringify({
	          dialogAction: dialogActionForDiagnostics,
	          intentName:
	            recordFromUnknown(responsePayloadBase.lexResponse).intentName ??
	            normalized.intentName ??
	            "BookAppointmentIntent",
	          message: inputForInteraction.message,
	          messageContentType: responseMessageContentType,
	          conversationState: inferredResponseSessionAttributes.conversationState,
	          conversationOutcome: inferredResponseSessionAttributes.conversationOutcome,
	          conversationComplete: inferredResponseSessionAttributes.conversationComplete,
	          lastAskedSlot: inferredResponseSessionAttributes.lastAskedSlot,
	          confirmationFingerprint: inferredResponseSessionAttributes.confirmationFingerprint,
	          alternativeOfferId: inferredResponseSessionAttributes.alternativeOfferId
	        })
	      )
	      .digest("hex");
	    const turnStateDiagnostics = {
	      ...timingDiagnostics,
      humanTurnId: input.attributes?.humanTurnId,
      providerTurnId: input.attributes?.providerTurnId,
      physicalSpeechTurnId: input.attributes?.physicalSpeechTurnId,
      speechSegmentId: input.attributes?.speechSegmentId,
      providerSequence: input.attributes?.providerSequence,
      segmentStartedAt: input.attributes?.segmentStartedAt,
      segmentEndedAt: input.attributes?.segmentEndedAt,
      providerRequestId: input.attributes?.providerRequestId,
      lexRequestId: input.attributes?.lexRequestId,
      lexPhase: input.attributes?.lexPhase,
      turnSequenceBefore: input.attributes?.turnSequence,
      turnSequenceAfter: inferredResponseSessionAttributes.turnSequence,
      stateVersionBefore: input.attributes?.stateVersionBefore ?? input.attributes?.stateVersion,
      stateVersionAfter:
        inferredResponseSessionAttributes.stateVersion ?? inferredResponseSessionAttributes.turnSequence,
      stateVersionRead: input.attributes?.stateVersionBefore ?? input.attributes?.stateVersion,
      stateVersionCommitted:
        inferredResponseSessionAttributes.stateVersion ?? inferredResponseSessionAttributes.turnSequence,
      responseSequence: inferredResponseSessionAttributes.responseSequence ?? inferredResponseSessionAttributes.turnSequence,
      staleResponseSuppressed: input.attributes?.staleResponseSuppressed ?? "false",
      coalescedSegmentCount: input.attributes?.coalescedSegmentCount ?? "1",
      coalescingReason: input.attributes?.coalescingReason ?? "",
      internalApiInvocationCount: 1,
	      staleOrDuplicateRejectionReason: null,
	      duplicateDisposition:
	        input.attributes?.duplicateDisposition ??
	        (input.attributes?.providerRequestIdReuseDetected === "true"
	          ? "provider_request_id_reused_for_distinct_human_turn"
	          : "processed_new_human_turn"),
      transcriptFingerprint:
        input.attributes?.transcriptFingerprint ??
        createHash("sha256")
          .update(normalizeForMatch(normalized.currentTurnTranscript ?? normalized.transcriptText))
          .digest("hex")
          .slice(0, 24),
      providerRequestIdReuseDetected: input.attributes?.providerRequestIdReuseDetected ?? "false",
      turnDirective:
        responsePayloadBase.turnDirective ??
        responsePayloadBase.confirmationOutcome ??
        responsePayloadBase.errorCode ??
        inputForInteraction.outcome,
      recognizedCustomerSource: customerProfileSource,
      knownCallerAcknowledged:
        inferredResponseSessionAttributes.knownCallerAcknowledged ?? knownCallerAlreadyAcknowledged,
      currentTurnSemanticType:
        responsePayloadBase.currentTurnSemanticType ??
        (responsePayloadBase.serviceClarificationReason ? "SERVICE_REQUEST" : undefined) ??
        (responsePayloadBase.confirmationOutcome ? "CONFIRMATION" : undefined),
      staffRecognitionSource:
        responsePayloadBase.staffRecognitionSource ??
        (normalized.staffId ? "matched_staff" : undefined),
      staffRecognitionAlias: responsePayloadBase.staffRecognitionAlias,
      excludedStaffIds: Array.from(staffExclusionState.ids.values()),
      excludedStaffNames: Array.from(staffExclusionState.names.values()),
      staffIntentSelectionMode: staffIntent.selectionMode,
      voiceSlotDecisions: parseVoiceSlotDecisions(
        inferredResponseSessionAttributes.voiceSlotDecisions ?? responseDebugRecord?.voiceSlotDecisions
      ),
      asrDiagnostics: parseDiagnosticJson(
        input.attributes?.asrDiagnostics ??
          responsePayloadBase.asrDiagnostics ??
          inferredResponseSessionAttributes.asrDiagnostics
      ),
	      timeRecognition: parseDiagnosticJson(
	        responsePayloadBase.timeRecognition ?? inferredResponseSessionAttributes.timeRecognitionDiagnostics
	      ),
      dateDecision: parseDiagnosticJson(
        responsePayloadBase.dateDecisionDiagnostic ?? inferredResponseSessionAttributes.dateDecisionDiagnostic
      ),
	      availabilityReasonCode: responsePayloadBase.availabilityReasonCode,
      serviceClarificationReason: responsePayloadBase.serviceClarificationReason,
      menuFingerprint:
        inferredResponseSessionAttributes.menuFingerprint ??
        inferredResponseSessionAttributes.serviceMenuVersion ??
        inferredResponseSessionAttributes.staffMenuFingerprint,
      menuWasSpoken:
        responsePayloadBase.menuWasSpoken ??
        inferredResponseSessionAttributes.menuWasSpoken ??
        inferredResponseSessionAttributes.staffMenuWasSpoken,
      currentTurnEntities: pickNormalizedAppointmentDebug(normalized),
      groundedChanges:
        responsePayloadBase.groundedChanges ??
        responsePayloadBase.slotDecision ??
        responseDebugRecord?.slotDecisions,
      preservedFields: responsePayloadDebug?.trustedSlotsAfter,
      clearedStaleFields: responseSanitization
        ? {
            ignoredUngroundedSlots: responseSanitization.ignoredUngroundedSlots,
            ignoredPollutedSlots: responseSanitization.ignoredPollutedSlots,
            ignoredNoiseFields: responseSanitization.ignoredNoiseFields
          }
        : undefined,
      confirmationFingerprintBefore: input.attributes?.confirmationFingerprint,
      confirmationFingerprintAfter: inferredResponseSessionAttributes.confirmationFingerprint,
      alternativeOfferId: inferredResponseSessionAttributes.alternativeOfferId,
      offerDisposition: responsePayloadBase.offerDisposition,
      rejectedOptionKeys: inferredResponseSessionAttributes.rejectedOptionKeys,
      businessHoursDecision: parseDiagnosticJson(
        responsePayloadBase.businessHoursDecision ?? inferredResponseSessionAttributes.businessHoursDecision
      ),
	      lambdaResponseFingerprint,
	      dialogActionType: readStringValue(dialogActionForDiagnostics.type),
	      messageContentType: responseMessageContentType,
	      ssmlValidation: responseSsmlValidation,
	      lexResponseSchemaValid: Boolean(inputForInteraction.message && responseSsmlValidation.valid),
      responseFingerprint: createHash("sha256")
	        .update(
	          JSON.stringify({
	            message: inputForInteraction.message,
            outcome: inputForInteraction.outcome,
            conversationState: inferredResponseSessionAttributes.conversationState,
            conversationOutcome: inferredResponseSessionAttributes.conversationOutcome,
            conversationComplete: inferredResponseSessionAttributes.conversationComplete,
            lastAskedSlot: inferredResponseSessionAttributes.lastAskedSlot,
            confirmationFingerprint: inferredResponseSessionAttributes.confirmationFingerprint,
            alternativeOfferId: inferredResponseSessionAttributes.alternativeOfferId
          })
        )
        .digest("hex"),
      conversationStateBefore: input.attributes?.conversationState,
      conversationStateAfter: inferredResponseSessionAttributes.conversationState,
      conversationOutcomeAfter: inferredResponseSessionAttributes.conversationOutcome,
      conversationCompleteBefore: input.attributes?.conversationComplete,
      conversationCompleteAfter: inferredResponseSessionAttributes.conversationComplete,
      releaseIdentity: buildVoiceReleaseIdentity(normalized.attributes)
    };
    const responsePayload = responsePayloadDebug
      ? {
          currentTurnTranscript: normalized.currentTurnTranscript ?? normalized.transcriptText,
          aggregatedBookingTranscript: normalized.aggregatedBookingTranscript ?? normalized.transcriptText,
          normalizedBefore: normalizedBeforeDebug,
          normalizedAfter: pickNormalizedAppointmentDebug(normalized),
          slotDecision:
            input.attributes?.lexTurnDebug &&
            typeof input.attributes.lexTurnDebug === "object" &&
            !Array.isArray(input.attributes.lexTurnDebug)
              ? (input.attributes.lexTurnDebug as Record<string, unknown>).slotDecisions
              : undefined,
          ...responsePayloadBase,
          sessionAttributes:
            responsePayloadBase.sessionAttributes ?? inferredResponseSessionAttributes,
          turnStateDiagnostics,
          lexTurnDebug: responsePayloadDebug
        }
      : {
          currentTurnTranscript: normalized.currentTurnTranscript ?? normalized.transcriptText,
          aggregatedBookingTranscript: normalized.aggregatedBookingTranscript ?? normalized.transcriptText,
          normalizedBefore: normalizedBeforeDebug,
          normalizedAfter: pickNormalizedAppointmentDebug(normalized),
          ...responsePayloadBase,
          sessionAttributes:
            responsePayloadBase.sessionAttributes ?? inferredResponseSessionAttributes,
          turnStateDiagnostics
        };
    const asrDiagnosticsForConfidence = recordFromUnknown(turnStateDiagnostics.asrDiagnostics);
    const asrConfidenceSource = readStringValue(asrDiagnosticsForConfidence.confidenceSource);
    const speechConfidence =
      asrConfidenceSource === "event.transcriptions.transcriptionConfidence"
        ? Number(asrDiagnosticsForConfidence.transcriptionConfidence ?? asrDiagnosticsForConfidence.confidence)
        : NaN;

    return upsertAmazonConnectBookingAIInteractionLog({
      salonId: salon.id,
      actorUserId,
      callSessionId: callSession?.id,
      transcriptId: transcript?.id,
      bookingAttemptId: inputForInteraction.bookingAttemptId,
      provider: ExternalProvider.AMAZON_CONNECT,
      model: env.AMAZON_LEX_BOT_ID ?? "amazon-lex",
      taskType: "amazon_connect_booking_fulfillment",
      requestText: normalized.aggregatedBookingTranscript ?? normalized.transcriptText ?? "",
      requestPayload: input,
      responseText: inputForInteraction.message,
      responsePayload,
      parsedOutput: {
        outcome: inputForInteraction.outcome,
        parsed: inputForInteraction.parsed
      },
      isValid: inputForInteraction.isValid,
      confidence: Number.isFinite(speechConfidence) ? speechConfidence : null,
      isSynthetic: isSyntheticAmazonConnectIdentity(normalized.contactId)
    });
  };

	  const buildKnownSessionAttributes = (
	    extra: Record<string, string | number | null | undefined> = {}
	  ): Record<string, string> => {
    const terminalBooking =
      extra.bookingOutcome === "BOOKED" ||
      extra.bookingOutcome === "RESCHEDULED" ||
      extra.bookingOutcome === "CANCELED";
    const defaultConversationState = terminalBooking ? "COMPLETE" : "CONTINUE";
    const defaultConversationOutcome = terminalBooking ? String(extra.bookingOutcome) : "NEEDS_INPUT";
	    const built = Object.fromEntries(
	      Object.entries({
        conversationState: defaultConversationState,
        conversationOutcome: defaultConversationOutcome,
        conversationComplete: terminalBooking ? "true" : "false",
        customerId: recognizedCustomer?.id,
        recognizedCustomerId: recognizedCustomer?.id,
        spokenCustomerName,
        persistedCustomerFirstName: recognizedCustomer?.firstName,
        persistedCustomerLastName: recognizedCustomer?.lastName,
        recognizedCustomerName: recognizedCustomerNameForSession ?? knownCallerMemory?.customerName,
        knownCallerAcknowledged:
          recognizedCustomerNameForSession && (knownCallerAlreadyAcknowledged || shouldAcknowledgeKnownCaller)
            ? "true"
            : undefined,
        knownCallerLookupAttempted: normalized.customerPhone ? "true" : undefined,
        knownCallerLookupStatus: normalized.customerPhone
          ? recognizedCustomer
            ? "FOUND"
            : "NOT_FOUND"
          : undefined,
        customerNameSource:
          customerNameSourceOverride ??
          (recognizedCustomerNameForSession ? "phone_lookup" : knownCallerMemory?.source),
        customerProfileSource,
        customerNameNeedsReview: customerNameNeedsReview ? "true" : undefined,
        customerName: normalized.customerName,
        customerPhone: normalized.customerPhone,
        serviceName: normalized.serviceName,
        requestedDate: normalized.requestedDate,
        requestedTime: normalized.requestedTime,
        staffPreference: normalized.staffPreference,
        staffId: normalized.staffId,
        selectedStaffId: normalized.staffId,
        confirmedStaffId: normalized.staffId,
        confirmedServiceName: normalized.serviceName,
        confirmedStaffName: normalized.staffPreference,
        staffResolutionStatus: isAnyStaffPreference(normalized.staffPreference) ? "explicit_any" : undefined,
        staffRecognitionFailureCount: isAnyStaffPreference(normalized.staffPreference) ? "0" : undefined,
        invalidStaffPreferenceIgnored: isAnyStaffPreference(normalized.staffPreference) ? "false" : undefined,
        unrecognizedStaffUtterance: normalized.unrecognizedStaffUtterance,
        voiceSlotDecisions: readStringAttribute(normalized.attributes, ["voiceSlotDecisions"]),
        excludedStaffIds: readStringAttribute(normalized.attributes, ["excludedStaffIds"]),
        excludedStaffNames: readStringAttribute(normalized.attributes, ["excludedStaffNames"]),
        callSessionId: callSession?.id,
        amazonConnectContactId: normalized.contactId,
        ...buildVoiceReleaseIdentity(normalized.attributes),
	        ...extra
	      })
	        .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
	        .map(([key, value]) => [key, String(value)])
	    );
    const keysToClear = parseSessionAttributeKeysToClear(built.sessionAttributeKeysToClear);
    for (const key of keysToClear) {
      if (key !== "sessionAttributeKeysToClear") {
        delete built[key];
      }
    }
    if (keysToClear.length) {
      built.sessionAttributeKeysToClear = JSON.stringify(keysToClear);
    }
    return built;
	  };

	  const buildHumanEscalationSessionAttributes = (
    reason: string,
    escalation?: Awaited<ReturnType<typeof createOrUpdateCallEscalation>> | null,
    extra: Record<string, string | number | null | undefined> = {}
  ): Record<string, string> => {
    const operatorQueueOutcome =
      escalation?.metadata &&
      typeof escalation.metadata === "object" &&
      !Array.isArray(escalation.metadata)
        ? String((escalation.metadata as Record<string, unknown>).operatorQueueOutcome ?? "")
        : "";
    const canTransferToQueue =
      escalation?.status === CallEscalationStatus.PENDING &&
      Boolean(escalation.queueId) &&
      [
        "AGENT_AVAILABLE",
        "AGENTS_BUSY",
        "CONNECT_METRICS_DEFERRED_TO_CONNECT_FLOW"
      ].includes(operatorQueueOutcome);
    return buildKnownSessionAttributes({
      conversationState: canTransferToQueue ? "TRANSFER" : "COMPLETE",
      conversationOutcome: canTransferToQueue ? "NEEDS_INPUT" : "CALL_CENTER_ESCALATION",
      conversationComplete: canTransferToQueue ? "false" : "true",
      forceHumanEscalation: canTransferToQueue ? "true" : "false",
      transferToQueue: canTransferToQueue ? "true" : "false",
      escalationReason: reason,
      fallbackMode: "operator_queue",
      queueId: canTransferToQueue ? escalation?.queueId : undefined,
      operatorQueueOutcome,
      ...extra
	    });
	  };

  if (postRejectedChoiceStops || postRejectedChoiceNeedsDetailMenu) {
    const resetKeys = postRejectedChoiceStops
      ? getBookingFrameResetKeys()
      : getFinalConfirmationClearKeys();
    const message = postRejectedChoiceStops
      ? speak("Okay, I won't book an appointment. Goodbye.")
      : speak("What would you like to change: the service, day or time, or technician?");
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: normalized.serviceName,
      staffPreference: normalized.staffPreference,
      requestedDateTime: normalized.requestedDate,
      missingFields: [],
      isReadyToBook: false
    });
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NEEDS_INPUT,
      failureReason: postRejectedChoiceStops
        ? "Caller stopped after rejecting final confirmation."
        : "Caller asked to change a detail after rejecting final confirmation.",
      normalizedRequest: {
        postRejectedChoice: initialRejectedBookingChoice,
        timezone: salon.timezone
      }
    });
    const lexSessionAttributes = buildKnownSessionAttributes({
      awaitingRejectedBookingChoice: postRejectedChoiceStops ? "false" : "true",
      awaitingFinalBookingConfirmation: "false",
      bookingConfirmationAsked: "false",
      sessionAttributeKeysToClear: JSON.stringify(resetKeys),
      forceHumanEscalation: "false",
      transferToQueue: "false",
      ...(postRejectedChoiceStops
        ? {
            conversationState: "COMPLETE",
            conversationOutcome: "CALLER_GOODBYE",
            conversationComplete: "true"
          }
        : {
            conversationState: "CONTINUE",
            conversationOutcome: "NEEDS_INPUT",
            conversationComplete: "false"
          })
    });
    const aiInteraction = await createInteraction({
      outcome: "MISSING_INFO",
      message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        postRejectedChoice: initialRejectedBookingChoice,
        sessionAttributes: lexSessionAttributes
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
        fulfillmentState: postRejectedChoiceStops ? "Fulfilled" : "InProgress",
        message,
        messageContentType: "SSML",
        dialogAction: {
          type: postRejectedChoiceStops ? "Close" : "ElicitIntent"
        },
        sessionAttributes: lexSessionAttributes
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

	  const requestedDateTimeText = [normalized.requestedDate, normalized.requestedTime]
    .filter((value): value is string => Boolean(value))
    .join(" ");

  const existingAppointmentRequestKind = classifyExistingAppointmentRequest({
    intentName: normalized.intentName,
    transcriptText: normalized.transcriptText,
    serviceName: normalized.serviceName,
    requestedDate: normalized.requestedDate,
    requestedTime: normalized.requestedTime
  });
  const normalizedExistingAppointmentText = normalizeForMatch(
    normalized.currentTurnTranscript ?? normalized.transcriptText
  );
  const awaitingRescheduleConfirmation =
    readStringAttribute(normalized.attributes, ["awaitingRescheduleConfirmation"]) === "true";
  const rescheduleFlowActive =
    awaitingRescheduleConfirmation ||
    readStringAttribute(normalized.attributes, ["rescheduleFlowActive"]) === "true" ||
    Boolean(readStringAttribute(normalized.attributes, ["existingAppointmentId"]));
  const isRescheduleRequest =
    normalized.intentName?.toLowerCase() === "rescheduleappointmentintent" ||
    rescheduleFlowActive ||
    (normalized.intentName?.toLowerCase() !== "cancelappointmentintent" &&
      existingAppointmentRequestKind === "existing" &&
      /\b(?:reschedule|re schedule|change|move|update|different technician|different staff|different person|can i move it)\b/.test(
        normalizedExistingAppointmentText
      ));

  if (!recognizedCustomer && existingAppointmentRequestKind === "existing") {
    const message = speak(
      "What phone number is on the appointment?"
    );
    const parsed = buildInternalParsedIntent({
      intentType:
        normalized.intentName?.toLowerCase() === "cancelappointmentintent"
          ? "CANCEL_APPOINTMENT"
          : "RESCHEDULE_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: normalized.serviceName,
      staffPreference: normalized.staffPreference,
      requestedDateTime: normalized.requestedDate,
      missingFields: ["customerPhone"],
      isReadyToBook: false
    });
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NEEDS_INPUT,
      failureReason: "Phone required to find existing appointment.",
      normalizedRequest: {
        intentName: normalized.intentName,
        existingAppointmentRequestKind,
        requestedDateTimeText
      }
    });
    const aiInteraction = await createInteraction({
      outcome: "MISSING_INFO",
      message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        missingFields: ["customerPhone"]
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
          slotToElicit: "customerPhone"
        },
        sessionAttributes: buildKnownSessionAttributes({
          lastAskedSlot: "customerPhone",
          askedSlotsCount: "1",
          fallbackCount: "1",
          errorCount: "1",
          awaitingExistingAppointmentHumanConfirmation: "false",
          forceHumanEscalation: "false",
          transferToQueue: "false"
        })
      },
      appointment: null,
      bookingAttempt,
      callSession,
      transcript,
      aiInteraction,
      escalation: null,
      alternatives: [],
      missingFields: ["customerPhone"],
      salonResolutionSource: resolutionSource
    };
  }

  if (recognizedCustomer && isRescheduleRequest) {
    const upcomingAppointments = await findUpcomingAppointmentsForCustomer({
      salonId: salon.id,
      customerId: recognizedCustomer.id
    });
    const storedAppointmentId = readStringAttribute(normalized.attributes, ["existingAppointmentId"]);
    const selectedUpcoming =
      (storedAppointmentId
        ? upcomingAppointments.find((appointment) => appointment.id === storedAppointmentId)
        : null) ?? (upcomingAppointments.length === 1 ? upcomingAppointments[0] : null);
    const summaries = upcomingAppointments.map((appointment) =>
      formatUpcomingAppointmentForSpeech(appointment, salon.timezone)
    );
    const returnRescheduleNeedsInput = async (inputForResponse: {
      message: string;
      dialogAction: { type: string; slotToElicit?: string };
      failureReason: string;
      responsePayload: Record<string, unknown>;
      sessionAttributes: Record<string, string | number | null | undefined>;
      missingFields?: string[];
      appointmentId?: string;
      requestedStartTime?: Date;
    }) => {
      const parsed = buildInternalParsedIntent({
        intentType: "RESCHEDULE_APPOINTMENT",
        customerName: normalized.customerName,
        customerPhone: normalized.customerPhone,
        serviceName: normalized.serviceName,
        staffPreference: normalized.staffPreference,
        requestedDateTime: inputForResponse.requestedStartTime?.toISOString() ?? normalized.requestedDate,
        missingFields: inputForResponse.missingFields ?? [],
        isReadyToBook: false
      });
      const bookingAttempt = await createAttempt({
        status: BookingAttemptStatus.NEEDS_INPUT,
        appointmentId: inputForResponse.appointmentId,
        requestedStartTime: inputForResponse.requestedStartTime,
        failureReason: inputForResponse.failureReason,
        normalizedRequest: {
          intentName: normalized.intentName,
          existingAppointmentRequestKind,
          existingAppointmentId: inputForResponse.appointmentId,
          requestedDateTimeText
        }
      });
      const lexSessionAttributes = buildKnownSessionAttributes(inputForResponse.sessionAttributes);
      const aiInteraction = await createInteraction({
        outcome: "MISSING_INFO",
        message: inputForResponse.message,
        parsed,
        bookingAttemptId: bookingAttempt.id,
        responsePayload: {
          ...inputForResponse.responsePayload,
          sessionAttributes: lexSessionAttributes
        },
        isValid: true
      });
      await finalizeCall({
        outcome: "MISSING_INFO",
        bookingAttemptId: bookingAttempt.id,
        bookingStatus: bookingAttempt.status,
        parsed,
        message: inputForResponse.message,
        failureReason: bookingAttempt.failureReason ?? undefined
      });

      return {
        outcome: "MISSING_INFO" as const,
        message: inputForResponse.message,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: inputForResponse.message,
          messageContentType: "SSML",
          dialogAction: inputForResponse.dialogAction,
          sessionAttributes: lexSessionAttributes
        },
        appointment: null,
        bookingAttempt,
        callSession,
        transcript,
        aiInteraction,
        escalation: null,
        alternatives: [],
        missingFields: inputForResponse.missingFields ?? [],
        salonResolutionSource: resolutionSource
      };
    };

    if (!upcomingAppointments.length) {
      const message = speak(
        "I don't see an upcoming appointment for this phone number. Would you like to book a new appointment, or speak with our team?"
      );
      return returnRescheduleNeedsInput({
        message,
        dialogAction: { type: "ElicitIntent" },
        failureReason: "No upcoming appointment found for reschedule.",
        responsePayload: {
          upcomingAppointmentCount: 0
        },
        sessionAttributes: {
          rescheduleFlowActive: "false",
          awaitingRescheduleConfirmation: "false",
          forceHumanEscalation: "false",
          transferToQueue: "false"
        }
      });
    }

    if (!selectedUpcoming) {
      const message = speak(
        `I see a few upcoming appointments: ${escapeSsml(summaries.join("; "))}. <break time="300ms"/> Which appointment are you calling about?`
      );
      return returnRescheduleNeedsInput({
        message,
        dialogAction: { type: "ElicitIntent" },
        failureReason: "Multiple upcoming appointments require caller selection.",
        responsePayload: {
          upcomingAppointmentCount: upcomingAppointments.length,
          upcomingAppointmentIds: upcomingAppointments.map((appointment) => appointment.id)
        },
        sessionAttributes: {
          rescheduleFlowActive: "true",
          upcomingAppointmentCount: String(upcomingAppointments.length),
          awaitingRescheduleConfirmation: "false",
          forceHumanEscalation: "false",
          transferToQueue: "false"
        }
      });
    }

    const existingAppointment = await getAppointmentDetail(salon.id, selectedUpcoming.id);
    const oldLocalStart = DateTime.fromJSDate(existingAppointment.startTime, { zone: "utc" }).setZone(
      salon.timezone
    );
    const storedRescheduleDate = readStringAttribute(normalized.attributes, ["rescheduleRequestedDate"]);
    const storedRescheduleTime = readStringAttribute(normalized.attributes, ["rescheduleRequestedTime"]);
    const storedRescheduleStaffId = readStringAttribute(normalized.attributes, ["rescheduleStaffId"]);
    const storedRescheduleStaffName = readStringAttribute(normalized.attributes, ["rescheduleStaffName"]);
    const requestedRescheduleDate = currentTurnExplicitDate ?? storedRescheduleDate;
    const requestedRescheduleTime = currentTurnExplicitTime ?? storedRescheduleTime;
    const requestedRescheduleStaffName = currentTurnStaffMention ?? storedRescheduleStaffName;
    const hasRequestedStaffChange = Boolean(requestedRescheduleStaffName || storedRescheduleStaffId);
    const hasRequestedDateOrTimeChange = Boolean(requestedRescheduleDate || requestedRescheduleTime);

    if (!hasRequestedDateOrTimeChange && !hasRequestedStaffChange) {
      const message = speak(
        `I see your upcoming ${escapeSsml(summaries[0])}. <break time="300ms"/> What day, time, or technician would you like to change it to?`
      );
      return returnRescheduleNeedsInput({
        message,
        dialogAction: { type: "ElicitIntent" },
        failureReason: "Reschedule target details required.",
        responsePayload: {
          existingAppointmentId: existingAppointment.id
        },
        sessionAttributes: {
          rescheduleFlowActive: "true",
          existingAppointmentId: existingAppointment.id,
          existingAppointmentSummary: summaries[0],
          awaitingRescheduleConfirmation: "false",
          forceHumanEscalation: "false",
          transferToQueue: "false"
        },
        appointmentId: existingAppointment.id
      });
    }

    if (requestedRescheduleDate && !requestedRescheduleTime && !hasRequestedStaffChange) {
      const message = speak("What time should I move it to?");
      return returnRescheduleNeedsInput({
        message,
        dialogAction: { type: "ElicitSlot", slotToElicit: "requestedTime" },
        failureReason: "Reschedule time required.",
        responsePayload: {
          existingAppointmentId: existingAppointment.id,
          rescheduleRequestedDate: requestedRescheduleDate
        },
        sessionAttributes: {
          rescheduleFlowActive: "true",
          existingAppointmentId: existingAppointment.id,
          existingAppointmentSummary: summaries[0],
          rescheduleRequestedDate: requestedRescheduleDate,
          awaitingRescheduleConfirmation: "false",
          lastAskedSlot: "requestedTime",
          askedSlotsCount: "1",
          fallbackCount: "1",
          errorCount: "1",
          forceHumanEscalation: "false",
          transferToQueue: "false"
        },
        missingFields: ["requestedTime"],
        appointmentId: existingAppointment.id
      });
    }

    let nextStaffId = existingAppointment.staffId;
    let nextStaffName = existingAppointment.staff.fullName;
    if (hasRequestedStaffChange) {
      const nextStaffResolution = await resolveStaffCandidates({
        salonId: salon.id,
        requestedStaffName: requestedRescheduleStaffName,
        staffId: storedRescheduleStaffId,
        attributes: normalized.attributes
      });
      if (nextStaffResolution.status !== "matched") {
        const staffOptions = await getMappedActiveBookableStaffForService({
          salonId: salon.id,
          serviceId: existingAppointment.serviceId
        });
        const message = buildStaffClarificationMessage({
          availableStaff: staffOptions.length ? staffOptions : await getStaffCandidates({ salonId: salon.id })
        });
        return returnRescheduleNeedsInput({
          message,
          dialogAction: { type: "ElicitSlot", slotToElicit: "staffPreference" },
          failureReason: "Reschedule staff preference required.",
          responsePayload: {
            existingAppointmentId: existingAppointment.id
          },
          sessionAttributes: {
            rescheduleFlowActive: "true",
            existingAppointmentId: existingAppointment.id,
            existingAppointmentSummary: summaries[0],
            rescheduleRequestedDate: requestedRescheduleDate,
            rescheduleRequestedTime: requestedRescheduleTime,
            awaitingRescheduleConfirmation: "false",
            lastAskedSlot: "staffPreference",
            forceHumanEscalation: "false",
            transferToQueue: "false"
          },
          missingFields: ["staffPreference"],
          appointmentId: existingAppointment.id
        });
      }
      nextStaffId = nextStaffResolution.matchedStaff.id;
      nextStaffName = nextStaffResolution.matchedStaff.fullName;
      normalized.staffPreference = nextStaffName;
      normalized.staffId = nextStaffId;
    }

    const nextDate = requestedRescheduleDate ?? oldLocalStart.toFormat("yyyy-MM-dd");
    const nextTime = requestedRescheduleTime ?? oldLocalStart.toFormat("HH:mm");
    let nextStartTime: Date;
    try {
      nextStartTime = parseRequestedStartTimeDetailed({
        requestedDate: nextDate,
        requestedTime: nextTime,
        timezone: salon.timezone
      }).utcDate;
    } catch (error) {
      const message = speak("What day and time should I move it to?");
      return returnRescheduleNeedsInput({
        message,
        dialogAction: { type: "ElicitSlot", slotToElicit: "requestedTime" },
        failureReason: error instanceof Error ? error.message : "Invalid reschedule date or time.",
        responsePayload: {
          existingAppointmentId: existingAppointment.id
        },
        sessionAttributes: {
          rescheduleFlowActive: "true",
          existingAppointmentId: existingAppointment.id,
          existingAppointmentSummary: summaries[0],
          awaitingRescheduleConfirmation: "false",
          lastAskedSlot: "requestedTime",
          forceHumanEscalation: "false",
          transferToQueue: "false"
        },
        missingFields: ["requestedTime"],
        appointmentId: existingAppointment.id
      });
    }

    const serviceIds = existingAppointment.appointmentServices.length
      ? existingAppointment.appointmentServices.map((item) => item.serviceId)
      : [existingAppointment.serviceId];
    const slotValidation = await validateAppointmentSlot({
      salonId: salon.id,
      staffId: nextStaffId,
      serviceIds,
      startTime: nextStartTime,
      excludeAppointmentId: existingAppointment.id
    });
    if (!slotValidation.valid) {
      const message = speak(
        "That time is not available. <break time=\"300ms\"/> What other day, time, or staff would you like?"
      );
      return returnRescheduleNeedsInput({
        message,
        dialogAction: { type: "ElicitIntent" },
        failureReason: slotValidation.reason ?? "Requested reschedule slot is unavailable.",
        responsePayload: {
          existingAppointmentId: existingAppointment.id,
          requestedStartTime: nextStartTime.toISOString()
        },
        sessionAttributes: {
          conversationOutcome: "NO_AVAILABILITY",
          rescheduleFlowActive: "true",
          existingAppointmentId: existingAppointment.id,
          existingAppointmentSummary: summaries[0],
          awaitingRescheduleConfirmation: "false",
          forceHumanEscalation: "false",
          transferToQueue: "false"
        },
        appointmentId: existingAppointment.id,
        requestedStartTime: nextStartTime
      });
    }

    const rescheduleFingerprint = buildRescheduleFingerprint({
      salonId: salon.id,
      appointmentId: existingAppointment.id,
      startTime: nextStartTime,
      staffId: nextStaffId
    });
    const storedRescheduleFingerprint = readStringAttribute(normalized.attributes, [
      "rescheduleConfirmationFingerprint"
    ]);
    const rescheduleConfirmationOutcome = awaitingRescheduleConfirmation
      ? classifyFinalBookingConfirmation(normalized.currentTurnTranscript ?? normalized.transcriptText, {
          hasExplicitStaffChange: Boolean(currentTurnStaffMention)
        })
      : "UNKNOWN";

    if (
      awaitingRescheduleConfirmation &&
      rescheduleConfirmationOutcome === "AFFIRMED" &&
      storedRescheduleFingerprint === rescheduleFingerprint
    ) {
      const rescheduled = await rescheduleAppointment(salon.id, existingAppointment.id, actorUserId, {
        startTime: nextStartTime,
        staffId: nextStaffId
      });
      const message = buildLexMessage({
        outcome: "RESCHEDULED",
        appointmentStartTime: nextStartTime,
        salonTimezone: salon.timezone,
        serviceName: getCustomerFacingServiceName(existingAppointment.service.name) ?? existingAppointment.service.name,
        staffName: nextStaffName
      });
      const parsed = buildInternalParsedIntent({
        intentType: "RESCHEDULE_APPOINTMENT",
        customerName: normalized.customerName,
        customerPhone: normalized.customerPhone,
        serviceName: getCustomerFacingServiceName(existingAppointment.service.name) ?? existingAppointment.service.name,
        staffPreference: nextStaffName,
        requestedDateTime: nextStartTime.toISOString(),
        missingFields: [],
        isReadyToBook: true
      });
      const bookingAttempt = await createAttempt({
        status: BookingAttemptStatus.SUCCESS,
        appointmentId: existingAppointment.id,
        requestedStartTime: nextStartTime,
        normalizedRequest: {
          existingAppointmentId: existingAppointment.id,
          staffId: nextStaffId,
          startTimeIso: nextStartTime.toISOString(),
          timezone: salon.timezone,
          rescheduleConfirmationFingerprint: rescheduleFingerprint
        }
      });
      const aiInteraction = await createInteraction({
        outcome: "RESCHEDULED",
        message,
        parsed,
        bookingAttemptId: bookingAttempt.id,
        responsePayload: {
          appointmentId: existingAppointment.id,
          rescheduleConfirmationFingerprint: rescheduleFingerprint
        },
        isValid: true
      });
      await finalizeCall({
        outcome: "RESCHEDULED",
        bookingAttemptId: bookingAttempt.id,
        bookingStatus: bookingAttempt.status,
        parsed,
        message,
        appointmentId: existingAppointment.id
      });

      return {
        outcome: "RESCHEDULED" as const,
        message,
        lexResponse: {
          fulfillmentState: "Fulfilled",
          message,
          messageContentType: "SSML",
          sessionAttributes: buildKnownSessionAttributes({
            bookingOutcome: "RESCHEDULED",
            existingAppointmentId: existingAppointment.id,
            rescheduleFlowActive: "false",
            awaitingRescheduleConfirmation: "false",
            rescheduleConfirmationFingerprint: "",
            requestedDate: DateTime.fromJSDate(nextStartTime, { zone: "utc" }).setZone(salon.timezone).toFormat("yyyy-MM-dd"),
            requestedTime: DateTime.fromJSDate(nextStartTime, { zone: "utc" }).setZone(salon.timezone).toFormat("HH:mm"),
            staffPreference: nextStaffName,
            staffId: nextStaffId
          })
        },
        appointment: rescheduled,
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

    const explicitRescheduleReprompt =
      awaitingRescheduleConfirmation && rescheduleConfirmationOutcome === "UNKNOWN";
    const message = explicitRescheduleReprompt
      ? speak("Please say yes to confirm, or tell me what you would like to change.")
      : buildRescheduleConfirmationMessage({
          serviceName: getCustomerFacingServiceName(existingAppointment.service.name) ?? existingAppointment.service.name,
          oldStartTime: existingAppointment.startTime,
          newStartTime: nextStartTime,
          salonTimezone: salon.timezone,
          staffName: nextStaffName
        });
    return returnRescheduleNeedsInput({
      message,
      dialogAction: { type: "ElicitIntent" },
      failureReason: "Reschedule confirmation required before updating appointment.",
      responsePayload: {
        existingAppointmentId: existingAppointment.id,
        rescheduleConfirmationFingerprint: rescheduleFingerprint,
        awaitingRescheduleConfirmation: true
      },
      sessionAttributes: {
        rescheduleFlowActive: "true",
        existingAppointmentId: existingAppointment.id,
        existingAppointmentSummary: summaries[0],
        rescheduleRequestedDate: nextDate,
        rescheduleRequestedTime: nextTime,
        rescheduleStaffId: nextStaffId,
        rescheduleStaffName: nextStaffName,
        rescheduleConfirmationFingerprint: rescheduleFingerprint,
        awaitingRescheduleConfirmation: "true",
        lastAskedSlot: "rescheduleConfirmation",
        forceHumanEscalation: "false",
        transferToQueue: "false"
      },
      appointmentId: existingAppointment.id,
      requestedStartTime: nextStartTime
    });
  }

  if (
    recognizedCustomer &&
    (existingAppointmentRequestKind === "existing" ||
      existingAppointmentRequestKind === "ambiguous")
  ) {
    const upcomingAppointments = await findUpcomingAppointmentsForCustomer({
      salonId: salon.id,
      customerId: recognizedCustomer.id
    });
    const summaries = upcomingAppointments.map((appointment) =>
      formatUpcomingAppointmentForSpeech(appointment, salon.timezone)
    );
    const singleAppointment = upcomingAppointments.length === 1 ? upcomingAppointments[0] : null;
    const statusQuestion = isExistingAppointmentStatusQuestion(normalized.transcriptText);
    const shouldOfferHumanForExisting =
      existingAppointmentRequestKind === "existing" &&
      Boolean(singleAppointment) &&
      !statusQuestion;
    const message = (() => {
      if (!upcomingAppointments.length) {
        return speak(
          "I don't see an upcoming appointment for this phone number. Would you like to book a new appointment, or speak with our team?"
        );
      }
      if (existingAppointmentRequestKind === "ambiguous") {
        return speak(
          `I see you have an upcoming appointment: ${escapeSsml(summaries[0])}. <break time="300ms"/> Are you calling about that appointment, or would you like to book a new one?`
        );
      }
      if (upcomingAppointments.length > 1) {
        return speak(
          `I see a few upcoming appointments: ${escapeSsml(summaries.join("; "))}. <break time="300ms"/> Which appointment are you calling about?`
        );
      }
      if (statusQuestion) {
        return speak(
          `I see your upcoming ${escapeSsml(summaries[0])}. <break time="300ms"/> What would you like to do next?`
        );
      }
      return speak(
        `I see your upcoming ${escapeSsml(summaries[0])}. <break time="300ms"/> Would you like me to connect you with our team to update that appointment?`
      );
    })();
    const parsed = buildInternalParsedIntent({
      intentType:
        normalized.intentName?.toLowerCase() === "cancelappointmentintent"
          ? "CANCEL_APPOINTMENT"
          : normalized.intentName?.toLowerCase() === "rescheduleappointmentintent"
            ? "RESCHEDULE_APPOINTMENT"
            : "GENERAL_INQUIRY",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: normalized.serviceName,
      staffPreference: normalized.staffPreference,
      requestedDateTime: singleAppointment?.startTime.toISOString() ?? normalized.requestedDate,
      missingFields: [],
      isReadyToBook: false
    });
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NEEDS_INPUT,
      failureReason: "Existing appointment context provided.",
      normalizedRequest: {
        intentName: normalized.intentName,
        existingAppointmentRequestKind,
        upcomingAppointmentIds: upcomingAppointments.map((appointment) => appointment.id),
        existingAppointmentId: singleAppointment?.id,
        requestedDateTimeText
      }
    });
    const aiInteraction = await createInteraction({
      outcome: "MISSING_INFO",
      message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        upcomingAppointmentCount: upcomingAppointments.length,
        upcomingAppointmentIds: upcomingAppointments.map((appointment) => appointment.id),
        awaitingExistingAppointmentHumanConfirmation: shouldOfferHumanForExisting
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
        sessionAttributes: buildKnownSessionAttributes({
          upcomingAppointmentCount: String(upcomingAppointments.length),
          existingAppointmentId: singleAppointment?.id,
          existingAppointmentSummary: summaries[0],
          awaitingExistingAppointmentHumanConfirmation: shouldOfferHumanForExisting
            ? "true"
            : "false",
          forceHumanEscalation: "false",
          transferToQueue: "false"
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

  const humanEscalationReason = shouldTransferToHuman(normalized)
    ? getHumanEscalationReason(normalized)
    : undefined;
	  if (humanEscalationReason) {
    const humanFailureReason =
      humanEscalationReason === "customer_pressed_zero"
        ? "Caller pressed zero for operator."
        : "Caller requested a human operator.";
    normalized.serviceName = undefined;
    normalized.staffPreference = undefined;
    normalized.staffId = undefined;
    normalized.unrecognizedStaffUtterance = undefined;
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NEEDS_INPUT,
      failureReason: humanFailureReason,
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
          escalationReason: humanFailureReason,
          customerPhone: normalized.customerPhone ?? null,
          messageToCaller: OPERATOR_TRANSFER_PROMPT,
          metadata: {
            bookingAttemptId: bookingAttempt.id,
            transcriptId: transcript?.id,
            intentName: normalized.intentName,
            contactId: normalized.contactId
          }
        })
      : null;
    const operatorQueueOutcome =
      escalation?.metadata &&
      typeof escalation.metadata === "object" &&
      !Array.isArray(escalation.metadata)
        ? String((escalation.metadata as Record<string, unknown>).operatorQueueOutcome ?? "")
        : "";
    const canTransferToQueue =
      escalation?.status === CallEscalationStatus.PENDING &&
      Boolean(escalation.queueId) &&
      [
        "AGENT_AVAILABLE",
        "AGENTS_BUSY",
        "CONNECT_METRICS_DEFERRED_TO_CONNECT_FLOW"
      ].includes(operatorQueueOutcome);
    const message = canTransferToQueue ? OPERATOR_TRANSFER_PROMPT : OPERATOR_BUSY_PROMPT;
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
        escalationId: escalation?.id ?? null,
        operatorQueueOutcome:
          escalation?.metadata &&
          typeof escalation.metadata === "object" &&
          !Array.isArray(escalation.metadata)
            ? (escalation.metadata as Record<string, unknown>).operatorQueueOutcome
            : undefined
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
        escalation?.routingOutcome === CallRoutingOutcome.QUEUED
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
        messageContentType: "PlainText",
        sessionAttributes: buildHumanEscalationSessionAttributes(
          humanEscalationReason,
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

  let requestedStartTime: Date | null = null;
  let requestedStartTimeParseFailed = false;
  if (normalized.requestedDate && (normalized.requestedTime || hasTimeComponent(normalized.requestedDate))) {
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
    } catch {
      requestedStartTimeParseFailed = true;
    }
  }

  const returnRejectedDateTime = async (inputForRejection: {
    message: string;
    failureReason: string;
	    reasonCode:
        | "WEEKDAY_DATE_CONFLICT"
        | "RELATIVE_EXPLICIT_CONFLICT"
        | "BARE_SAME_DAY_WEEKDAY_AMBIGUOUS"
        | "TODAY_TOMORROW_CONFLICT"
        | "TODAY_EXPLICIT_DATE_CONFLICT"
        | "TOMORROW_EXPLICIT_DATE_CONFLICT"
        | "MULTIPLE_TIME_CONFLICT"
        | "PAST_REQUESTED_TIME";
    clearTime: boolean;
    requestedStartTime?: Date | null;
    responsePayload?: Record<string, unknown>;
    normalizedRequest?: Record<string, unknown>;
    pastTimeDecision?: ReturnType<typeof buildPastRequestedTimeDecision>;
  }) => {
    const rejectedDate = normalized.requestedDate;
    const rejectedTime = normalized.requestedTime;
    if (inputForRejection.clearTime) {
      normalized.requestedTime = undefined;
    }
    normalized.requestedDate = undefined;
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: normalized.serviceName,
      staffPreference: normalized.staffPreference,
      requestedDateTime:
        inputForRejection.requestedStartTime?.toISOString() ??
        [rejectedDate, rejectedTime].filter(Boolean).join(" "),
      missingFields: ["preferredDateTime"],
      isReadyToBook: false
    });
    const lexSessionAttributes = buildKnownSessionAttributes({
      requestedDate: undefined,
      requestedTime:
        inputForRejection.reasonCode === "PAST_REQUESTED_TIME"
          ? rejectedTime
          : inputForRejection.clearTime
            ? undefined
            : normalized.requestedTime,
	      dateClarificationReason: inputForRejection.reasonCode,
	      availabilityReasonCode:
          inputForRejection.reasonCode === "PAST_REQUESTED_TIME" ? undefined : inputForRejection.reasonCode,
        dateTimeValidationReason:
          inputForRejection.reasonCode === "PAST_REQUESTED_TIME" ? "past_requested_time" : undefined,
        temporalRejectionReason:
          inputForRejection.pastTimeDecision?.diagnostic.temporalRejectionReason,
        awaitingPastTimeTomorrowConfirmation:
          inputForRejection.pastTimeDecision?.sameDay ? "true" : undefined,
        proposedRequestedDate: inputForRejection.pastTimeDecision?.proposedRequestedDate,
        proposedRequestedTime: inputForRejection.pastTimeDecision?.proposedRequestedTime,
        rejectedRequestedDate:
          inputForRejection.reasonCode === "PAST_REQUESTED_TIME" ? rejectedDate : undefined,
        rejectedRequestedTime:
          inputForRejection.reasonCode === "PAST_REQUESTED_TIME" ? rejectedTime : undefined,
        dateDecisionDiagnostic:
          inputForRejection.pastTimeDecision?.diagnostic
            ? JSON.stringify(inputForRejection.pastTimeDecision.diagnostic)
            : typeof inputForRejection.responsePayload?.dateDecisionDiagnostic === "object"
              ? JSON.stringify(inputForRejection.responsePayload.dateDecisionDiagnostic)
              : undefined,
	      aiAlternativeSlots: "[]",
      awaitingAlternativeSelection: "false",
      awaitingFinalBookingConfirmation: "false",
      bookingConfirmationAsked: "false",
      lastAskedSlot: "requestedDate",
      slotToElicit: "requestedDate",
      askedSlotsCount: "1",
      fallbackCount: "1",
      errorCount: "1"
    });
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NEEDS_INPUT,
      requestedStartTime: inputForRejection.requestedStartTime ?? undefined,
      failureReason: inputForRejection.failureReason,
      normalizedRequest: {
        requestedDate: rejectedDate,
        requestedTime: rejectedTime,
        reasonCode: inputForRejection.reasonCode,
        timezone: salon.timezone,
        ...(inputForRejection.pastTimeDecision
          ? {
              dateDecisionDiagnostic: inputForRejection.pastTimeDecision.diagnostic,
              proposedRequestedDate: inputForRejection.pastTimeDecision.proposedRequestedDate,
              proposedRequestedTime: inputForRejection.pastTimeDecision.proposedRequestedTime
            }
          : {}),
        ...(inputForRejection.requestedStartTime
          ? { startTimeIso: inputForRejection.requestedStartTime.toISOString() }
          : {}),
        ...inputForRejection.normalizedRequest
      }
    });
    const aiInteraction = await createInteraction({
      outcome: "MISSING_INFO",
      message: inputForRejection.message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        reasonCode: inputForRejection.reasonCode,
        rejectedDate,
        rejectedTime,
        sessionAttributes: lexSessionAttributes,
        ...inputForRejection.responsePayload
      },
      isValid: true
    });
    await finalizeCall({
      outcome: "MISSING_INFO",
      bookingAttemptId: bookingAttempt.id,
      bookingStatus: bookingAttempt.status,
      parsed,
      message: inputForRejection.message,
      failureReason: bookingAttempt.failureReason ?? undefined
    });

    return {
      outcome: "MISSING_INFO" as const,
      message: inputForRejection.message,
      lexResponse: {
        fulfillmentState: "InProgress",
        message: inputForRejection.message,
        messageContentType: "SSML",
        dialogAction: {
          type: "ElicitSlot",
          slotToElicit: "requestedDate"
        },
        sessionAttributes: lexSessionAttributes
      },
      appointment: null,
      bookingAttempt,
      callSession,
      transcript,
      aiInteraction,
      escalation: null,
      alternatives: [],
      missingFields: ["preferredDateTime"],
      salonResolutionSource: resolutionSource
    };
	  };

  if (currentTurnDateClarification) {
    return await returnRejectedDateTime({
      message: currentTurnDateClarification.message,
      failureReason: "Requested date needs caller clarification.",
      reasonCode: currentTurnDateClarification.reasonCode,
      clearTime: false,
      requestedStartTime,
      responsePayload: {
        dateDecisionDiagnostic: currentTurnDateClarification.diagnostic
      },
      normalizedRequest: {
        dateDecisionDiagnostic: currentTurnDateClarification.diagnostic
      }
    });
  }

	  const weekdayDateConflict = getWeekdayDateConflict(
	    normalized.currentTurnTranscript ?? normalized.transcriptText,
    salon.timezone
  );
  if (weekdayDateConflict) {
    return await returnRejectedDateTime({
      message: buildWeekdayDateConflictMessage(weekdayDateConflict),
      failureReason: "Requested weekday conflicts with explicit calendar date.",
      reasonCode: "WEEKDAY_DATE_CONFLICT",
      clearTime: false,
      requestedStartTime,
      responsePayload: {
        weekdayDateConflict
      },
      normalizedRequest: {
        weekdayDateConflict
      }
    });
  }

  if (requestedStartTime && isRequestedStartTimeInPast(requestedStartTime, salon.timezone)) {
    const pastTimeDecision = buildPastRequestedTimeDecision(requestedStartTime, salon.timezone);
    return await returnRejectedDateTime({
      message: buildPastRequestedTimeMessage(pastTimeDecision),
      failureReason: "Requested appointment time has already passed.",
      reasonCode: "PAST_REQUESTED_TIME",
      clearTime: false,
      requestedStartTime,
      pastTimeDecision,
      responsePayload: {
        dateDecisionDiagnostic: pastTimeDecision.diagnostic
      },
      normalizedRequest: {
        dateDecisionDiagnostic: pastTimeDecision.diagnostic
      }
    });
  }

  const businessHoursDayDecision = normalized.requestedDate
    ? await getBusinessHoursDayDecision({
        salonId: salon.id,
        timezone: salon.timezone,
        requestedDate: normalized.requestedDate
      })
    : null;
  if (businessHoursDayDecision && !businessHoursDayDecision.allowed) {
    const availabilityReasonCode = "SALON_CLOSED";
    const message = businessHoursDayDecision.message ?? speak(
      "We are closed that day. <break time=\"300ms\"/> What other day works for you? You can also press 0 for a person."
    );
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: normalized.serviceName,
      staffPreference: normalized.staffPreference,
      requestedDateTime: normalized.requestedDate,
      missingFields: ["requestedDate"],
      isReadyToBook: false
    });
    const lexSessionAttributes = buildKnownSessionAttributes({
      conversationState: "CONTINUE",
      conversationOutcome: "NO_AVAILABILITY",
      conversationComplete: "false",
      availabilityReasonCode,
      aiAlternativeSlots: "[]",
      awaitingAlternativeSelection: "false",
      awaitingFinalBookingConfirmation: "false",
      bookingConfirmationAsked: "false",
      requestedDate: undefined,
      lastAskedSlot: "requestedDate",
      slotToElicit: "requestedDate",
      askedSlotsCount: "1",
      fallbackCount: "1",
      errorCount: "1",
      businessHoursDecision: JSON.stringify(businessHoursDayDecision.debug)
    });
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NO_AVAILABILITY,
      requestedStartTime: requestedStartTime ?? undefined,
      failureReason: "Salon is closed for the requested day.",
      normalizedRequest: {
        requestedDate: normalized.requestedDate,
        requestedTime: normalized.requestedTime,
        availabilityReasonCode,
        businessHoursDecision: businessHoursDayDecision.debug,
        startTimeIso: requestedStartTime?.toISOString(),
        timezone: salon.timezone
      },
      alternativeSlots: []
    });
    const aiInteraction = await createInteraction({
      outcome: "NO_AVAILABILITY",
      message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        alternatives: [],
        availabilityReasonCode,
        businessHoursDecision: businessHoursDayDecision.debug,
        promptMissingFields: ["requestedDate"],
        slotToElicit: "requestedDate",
        sessionAttributes: lexSessionAttributes
      },
      isValid: true
    });
    await finalizeCall({
      outcome: "NO_AVAILABILITY",
      bookingAttemptId: bookingAttempt.id,
      bookingStatus: bookingAttempt.status,
      parsed,
      message,
      alternatives: [],
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
          slotToElicit: "requestedDate"
        },
        sessionAttributes: lexSessionAttributes
      },
      appointment: null,
      bookingAttempt,
      callSession,
      transcript,
      aiInteraction,
      escalation: null,
      alternatives: [],
      missingFields: ["requestedDate"],
      salonResolutionSource: resolutionSource
    };
  }

  let staffResolution = await resolveStaffCandidates({
    salonId: salon.id,
    requestedStaffName: normalized.staffPreference,
    staffId: normalized.staffId,
    attributes: normalized.attributes,
    excludedStaffIds: staffExclusionState.ids,
    excludedStaffNames: staffExclusionState.names
  });
  if (staffResolution.status === "matched") {
    normalized.staffPreference = staffResolution.matchedStaff.fullName;
    normalized.staffId = staffResolution.matchedStaff.id;
  } else if (staffResolution.status === "explicit_any") {
    normalized.staffPreference = "Any staff";
    normalized.staffId = undefined;
    normalized.unrecognizedStaffUtterance = undefined;
  } else if (normalized.invalidStaffDtmfSelection) {
    normalized.unrecognizedStaffUtterance = normalized.staffPreference;
    normalized.staffPreference = undefined;
    normalized.staffId = undefined;
  } else if (staffResolution.status !== "ambiguous") {
    normalized.unrecognizedStaffUtterance =
      staffResolution.status === "unmatched_specific"
        ? staffResolution.rawStaffPreference
        : normalized.unrecognizedStaffUtterance;
    normalized.staffPreference = undefined;
    normalized.staffId = undefined;
  }
  const ambiguousFirstAvailableStaffProposal =
    !awaitingStaffConfirmation &&
    isAmbiguousFirstAvailableStaffCandidate(
      normalized.currentTurnTranscript ?? normalized.transcriptText,
      normalized.attributes
    );
  const rejectedFirstAvailableStaffCandidate = isRejectedFirstAvailableStaffCandidate(
    normalized.currentTurnTranscript ?? normalized.transcriptText,
    normalized.attributes
  );
  const proposedTodayDate = findProposedTodayDateClarification({
    serviceName: normalized.serviceName,
    requestedDate: normalized.requestedDate,
    requestedTime: normalized.requestedTime,
    currentTurnTranscript: normalized.currentTurnTranscript,
    transcriptText: normalized.transcriptText,
    timezone: salon.timezone
  });
  const alternativeFirstAvailableStaffProposal =
    !ambiguousFirstAvailableStaffProposal
      ? findProposedAnyStaffClarification({
          serviceName: normalized.serviceName,
          requestedDate: normalized.requestedDate,
          proposedRequestedDate: proposedTodayDate?.proposedRequestedDate,
          requestedTime: normalized.requestedTime,
          staffPreference: normalized.staffPreference,
          currentTurnTranscript: normalized.currentTurnTranscript,
          transcriptText: normalized.transcriptText,
          attributes: normalized.attributes
        })
      : null;
  const proposedFirstAvailableStaff = ambiguousFirstAvailableStaffProposal
    ? {
        proposedStaffPreference: "Any staff" as const,
        reason: "ambiguous_first_available_asr",
        confidenceBand: hasLowConfidenceFirstAvailableStaffTail(
          normalized.currentTurnTranscript ?? normalized.transcriptText
        )
          ? "low" as const
          : "medium" as const,
        asrAlternativesUsed: false,
        matchedTranscript: normalized.currentTurnTranscript ?? normalized.transcriptText ?? ""
      }
    : alternativeFirstAvailableStaffProposal;
  const staffProposalRejectedThisTurn =
    readStringAttribute(normalized.attributes, ["staffClarificationReason"]) === "staff_proposal_rejected";
  if (
    awaitingFinalBookingConfirmation &&
    proposedFirstAvailableStaff &&
    staffNameBeforeCurrentTurn &&
    normalizeForMatch(staffNameBeforeCurrentTurn) !== "any staff" &&
    normalized.serviceName &&
    normalized.requestedDate &&
    normalized.requestedTime &&
    requestedStartTime
  ) {
    const replacementRequestedStartTime = requestedStartTime;
    const voiceSlotDecision = buildVoiceSlotDecision({
      slot: "staffPreference",
      action: "propose",
      canonicalValue: proposedFirstAvailableStaff.proposedStaffPreference,
      reason: "final_confirmation_staff_replacement_asr",
      confidenceBand: proposedFirstAvailableStaff.confidenceBand,
      evidence: [proposedFirstAvailableStaff.matchedTranscript],
      source: proposedFirstAvailableStaff.asrAlternativesUsed ? "asr_alternative" : "contextual_repair",
      activeSlot: readStringAttribute(normalized.attributes, ["lastAskedSlot"]) ?? "bookingConfirmation",
      negated: false,
      requiresConfirmation: true,
      alternativesUsed: proposedFirstAvailableStaff.asrAlternativesUsed
    });
    const message = speak(
      `Did you mean first available instead of ${escapeSsml(staffNameBeforeCurrentTurn)}?`
    );
    const lexSessionAttributes = buildKnownSessionAttributes({
      staffPreference: staffNameBeforeCurrentTurn,
      staffId: staffIdBeforeCurrentTurn,
      selectedStaffId: readStringAttribute(normalized.attributes, ["selectedStaffId"]),
      confirmedStaffId: readStringAttribute(normalized.attributes, ["confirmedStaffId"]),
      confirmedStaffName: staffNameBeforeCurrentTurn,
      awaitingStaffConfirmation: "true",
      proposedStaffPreference: proposedFirstAvailableStaff.proposedStaffPreference,
      staffClarificationReason: "final_confirmation_staff_replacement_asr",
      clarificationReason: "final_confirmation_staff_replacement_asr",
      staffProposalConfidenceBand: proposedFirstAvailableStaff.confidenceBand,
      asrAlternativesUsed: proposedFirstAvailableStaff.asrAlternativesUsed ? "true" : "false",
      staffReplacementPreviousStaff: staffNameBeforeCurrentTurn,
      staffReplacementPreviousStaffId: staffIdBeforeCurrentTurn,
      staffReplacementPreviousSelectedStaffId: readStringAttribute(normalized.attributes, ["selectedStaffId"]),
      staffReplacementPreviousConfirmedStaffId: readStringAttribute(normalized.attributes, ["confirmedStaffId"]),
      voiceSlotDecisions: withVoiceSlotDecision(normalized.attributes, voiceSlotDecision),
      awaitingFinalBookingConfirmation: "false",
      bookingConfirmationAsked: "false",
      lastAskedSlot: "staffPreference",
      slotToElicit: "staffPreference",
      askedSlotsCount: "1",
      fallbackCount: "1",
      errorCount: "1"
    });
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: normalized.serviceName,
      staffPreference: staffNameBeforeCurrentTurn,
      requestedDateTime: replacementRequestedStartTime.toISOString(),
      missingFields: ["staffPreference"],
      isReadyToBook: false
    });
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NEEDS_INPUT,
      requestedStartTime: replacementRequestedStartTime,
      failureReason: "Final confirmation staff replacement requires confirmation.",
      normalizedRequest: {
        serviceName: normalized.serviceName,
        requestedDate: normalized.requestedDate,
        requestedTime: normalized.requestedTime,
        trustedStaffPreference: staffNameBeforeCurrentTurn,
        proposedStaffPreference: proposedFirstAvailableStaff.proposedStaffPreference,
        staffReplacementReason: "final_confirmation_staff_replacement_asr",
        startTimeIso: replacementRequestedStartTime.toISOString(),
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
        promptMissingFields: ["staffPreference"],
        slotToElicit: "staffPreference",
        proposedStaffPreference: proposedFirstAvailableStaff.proposedStaffPreference,
        trustedStaffPreference: staffNameBeforeCurrentTurn,
        sessionAttributes: lexSessionAttributes
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
        sessionAttributes: lexSessionAttributes
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
  if (!missingFields.has("preferredDateTime") && requestedStartTimeParseFailed) {
    missingFields.add("preferredDateTime");
  }
  const shouldAskStaffOnce =
    finalConfirmationRequiresStaffSelection ||
    rejectedFirstAvailableStaffCandidate ||
    (staffResolution.status === "missing" && staffResolution.allStaff.length > 0) ||
    staffResolution.status === "invalid_noise" ||
    staffResolution.status === "unmatched_specific";
  if (
    proposedFirstAvailableStaff ||
    normalized.invalidStaffDtmfSelection ||
    staffResolution.status === "ambiguous" ||
    shouldAskStaffOnce
  ) {
    missingFields.add("staffPreference");
    normalized.staffId = undefined;
  }
  if (!missingFields.has("staffPreference") && staffResolution.status === "explicit_any") {
    normalized.staffPreference = "Any staff";
    normalized.staffId = undefined;
  }
  if (proposedTodayDate && proposedFirstAvailableStaff && normalized.serviceName && normalized.requestedTime) {
    const message = buildBookingFrameRepairConfirmationPrompt(
      {
        serviceName: normalized.serviceName,
        proposedRequestedDate: proposedTodayDate.proposedRequestedDate,
        requestedTime: normalized.requestedTime,
        proposedStaffPreference: proposedFirstAvailableStaff.proposedStaffPreference
      },
      salon.timezone
    );
    const voiceSlotDecisions = [
      buildVoiceSlotDecision({
        slot: "requestedDate",
        action: "propose",
        canonicalValue: proposedTodayDate.proposedRequestedDate,
        reason: proposedTodayDate.reason,
        confidenceBand: "medium",
        evidence: [proposedTodayDate.matchedTranscript],
        alternativesUsed: false
      }),
      buildVoiceSlotDecision({
        slot: "staffPreference",
        action: "propose",
        canonicalValue: proposedFirstAvailableStaff.proposedStaffPreference,
        reason: proposedFirstAvailableStaff.reason,
        confidenceBand: proposedFirstAvailableStaff.confidenceBand,
        evidence: [proposedFirstAvailableStaff.matchedTranscript],
        source: proposedFirstAvailableStaff.asrAlternativesUsed ? "asr_alternative" : "contextual_repair",
        activeSlot: readStringAttribute(normalized.attributes, ["lastAskedSlot"]),
        negated: false,
        requiresConfirmation: true,
        alternativesUsed: proposedFirstAvailableStaff.asrAlternativesUsed
      })
    ];
    const lexSessionAttributes = buildKnownSessionAttributes({
      requestedDate: undefined,
      staffPreference: undefined,
      staffId: undefined,
      selectedStaffId: undefined,
      confirmedStaffId: undefined,
      confirmedStaffName: undefined,
      awaitingBookingFrameRepairConfirmation: "true",
      proposedRequestedDate: proposedTodayDate.proposedRequestedDate,
      proposedStaffPreference: proposedFirstAvailableStaff.proposedStaffPreference,
      bookingFrameRepairReason: "dropped_today_and_first_available_asr",
      clarificationReason: "booking_frame_repair_confirmation",
      voiceSlotDecisions: JSON.stringify(voiceSlotDecisions),
      awaitingFinalBookingConfirmation: "false",
      bookingConfirmationAsked: "false",
      lastAskedSlot: "bookingConfirmation",
      askedSlotsCount: "1",
      fallbackCount: "1",
      errorCount: "1"
    });
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: normalized.serviceName,
      staffPreference: undefined,
      requestedDateTime: undefined,
      missingFields: ["preferredDateTime", "staffPreference"],
      isReadyToBook: false
    });
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NEEDS_INPUT,
      failureReason: "Medium-confidence booking frame repair requires confirmation.",
      normalizedRequest: {
        serviceName: normalized.serviceName,
        requestedTime: normalized.requestedTime,
        proposedRequestedDate: proposedTodayDate.proposedRequestedDate,
        proposedStaffPreference: proposedFirstAvailableStaff.proposedStaffPreference,
        bookingFrameRepairReason: "dropped_today_and_first_available_asr",
        timezone: salon.timezone
      }
    });
    const aiInteraction = await createInteraction({
      outcome: "MISSING_INFO",
      message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        missingFields: ["preferredDateTime", "staffPreference"],
        promptMissingFields: ["bookingConfirmation"],
        slotToElicit: "bookingConfirmation",
        bookingFrameRepairReason: "dropped_today_and_first_available_asr",
        sessionAttributes: lexSessionAttributes
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
          slotToElicit: "bookingConfirmation"
        },
        sessionAttributes: lexSessionAttributes
      },
      appointment: null,
      bookingAttempt,
      callSession,
      transcript,
      aiInteraction,
      escalation: null,
      alternatives: [],
      missingFields: ["preferredDateTime", "staffPreference"],
      salonResolutionSource: resolutionSource
    };
  }
  if (missingFields.size > 0 || !requestedStartTime) {
    const elicitDecision = getElicitSlotForMissingFields(
      missingFields,
      normalized,
      servicePromptSessionAttributes
    );
    const shouldPromptStaff = elicitDecision.promptMissingFields.includes("staffPreference");
    const staffPromptCandidates =
      shouldPromptStaff && serviceMatch?.service.id
        ? await getMappedActiveBookableStaffForService({
            salonId: salon.id,
            serviceId: serviceMatch.service.id
          })
        : shouldPromptStaff
          ? await getStaffCandidates({ salonId: salon.id })
          : [];
    const staffPromptOptions = filterExcludedStaff(
      staffPromptCandidates,
      staffExclusionState.ids,
      staffExclusionState.names
    );
    const existingStaffMenuWasSpoken =
      readStringAttribute(normalized.attributes, ["staffMenuWasSpoken"]) === "true";
    const wasStaffSelectionTurn =
      readStringAttribute(normalized.attributes, ["lastAskedSlot"]) === "staffPreference" ||
      readStringAttribute(normalized.attributes, ["activeDtmfMenu"]) === "staff";
    const currentStaffTurnText = (
      normalized.currentTurnTranscript ??
      normalized.transcriptText ??
      ""
    ).trim();
    const hasFailedStaffRecognitionThisTurn =
      shouldPromptStaff &&
      Boolean(currentStaffTurnText) &&
      (staffResolution.status === "unmatched_specific" ||
        staffResolution.status === "invalid_noise" ||
        Boolean(normalized.invalidStaffDtmfSelection) ||
        rejectedFirstAvailableStaffCandidate ||
        (wasStaffSelectionTurn && staffResolution.status === "missing"));
    const staffRecognitionFailureCount = hasFailedStaffRecognitionThisTurn
      ? parseAttemptCount(readStringAttribute(normalized.attributes, ["staffRecognitionFailureCount"])) + 1
      : parseAttemptCount(readStringAttribute(normalized.attributes, ["staffRecognitionFailureCount"]));
    const shouldSpeakNumberedStaffMenu =
      shouldPromptStaff &&
      staffRecognitionFailureCount >= 2 &&
      !existingStaffMenuWasSpoken;
    const collectingServiceName =
      elicitDecision.slotToElicit === "serviceName" &&
      (readStringAttribute(normalized.attributes, ["lastAskedSlot"]) === "serviceName" ||
        readStringAttribute(normalized.attributes, ["activeDtmfMenu"]) === "service" ||
        parseAttemptCount(
          readStringAttribute(normalized.attributes, ["serviceRecognitionFailureCount", "serviceClarificationAttempts"])
        ) > 0);
    const proposedServiceClarification =
      elicitDecision.slotToElicit === "serviceName"
        ? findProposedFullSetServiceClarification({
            serviceName: normalized.serviceName,
            requestedDate: normalized.requestedDate,
            requestedTime: normalized.requestedTime,
            currentTurnTranscript: normalized.currentTurnTranscript,
            transcriptText: normalized.transcriptText,
            attributes: normalized.attributes
          })
        : null;
    const pendingFirstAvailableStaffProposal =
      proposedFirstAvailableStaff ??
      (readStringAttribute(normalized.attributes, ["proposedStaffPreference"])
        ? {
            proposedStaffPreference: "Any staff" as const,
            reason:
              readStringAttribute(normalized.attributes, ["staffClarificationReason"]) ||
              readStringAttribute(normalized.attributes, ["clarificationReason"]) ||
              "pending_first_available_asr",
            confidenceBand:
              (readStringAttribute(normalized.attributes, ["staffProposalConfidenceBand"]) as "medium" | "low") ||
              "medium",
            asrAlternativesUsed:
              readStringAttribute(normalized.attributes, ["asrAlternativesUsed"]) === "true",
            matchedTranscript:
              readStringAttribute(normalized.attributes, ["unrecognizedStaffUtterance"]) ||
              readStringAttribute(normalized.attributes, ["proposedStaffPreference"]) ||
              "Any staff"
          }
        : null);
    const pendingFullSetServiceProposal =
      proposedServiceClarification ??
      (readStringAttribute(normalized.attributes, ["proposedServiceName"])
        ? {
            proposedServiceName: readStringAttribute(normalized.attributes, ["proposedServiceName"])!,
            reason:
              readStringAttribute(normalized.attributes, ["serviceClarificationReason"]) ||
              readStringAttribute(normalized.attributes, ["clarificationReason"]) ||
              "pending_full_set_asr",
            asrAlternativesUsed:
              readStringAttribute(normalized.attributes, ["asrAlternativesUsed"]) === "true",
            matchedTranscript:
              readStringAttribute(normalized.attributes, ["serviceAliasCorrectionRaw"]) ||
              readStringAttribute(normalized.attributes, ["proposedServiceName"]) ||
              "Full Set"
          }
        : null);
    const activeVoiceSlot = readStringAttribute(normalized.attributes, ["lastAskedSlot"]);
    const deferOutOfOrderStaffProposal =
      Boolean(proposedFirstAvailableStaff) &&
      activeVoiceSlot === "serviceName" &&
      elicitDecision.slotToElicit !== "staffPreference";
    if (
      pendingFullSetServiceProposal &&
      pendingFirstAvailableStaffProposal &&
      normalized.requestedDate &&
      normalized.requestedTime &&
      !normalized.staffPreference &&
      !readStringAttribute(normalized.attributes, ["confirmedStaffName"])
    ) {
      const message = buildBookingFrameRepairConfirmationPrompt(
        {
          proposedServiceName: pendingFullSetServiceProposal.proposedServiceName,
          requestedDate: normalized.requestedDate,
          requestedTime: normalized.requestedTime,
          proposedStaffPreference: pendingFirstAvailableStaffProposal.proposedStaffPreference
        },
        salon.timezone
      );
      const voiceSlotDecisions = [
        buildVoiceSlotDecision({
          slot: "serviceName",
          action: "propose",
          canonicalValue: pendingFullSetServiceProposal.proposedServiceName,
          reason: pendingFullSetServiceProposal.reason,
          confidenceBand: "medium",
          evidence: [pendingFullSetServiceProposal.matchedTranscript],
          source: pendingFullSetServiceProposal.asrAlternativesUsed ? "asr_alternative" : "contextual_repair",
          activeSlot: activeVoiceSlot,
          negated: false,
          requiresConfirmation: true,
          alternativesUsed: pendingFullSetServiceProposal.asrAlternativesUsed
        }),
        buildVoiceSlotDecision({
          slot: "staffPreference",
          action: "propose",
          canonicalValue: pendingFirstAvailableStaffProposal.proposedStaffPreference,
          reason: pendingFirstAvailableStaffProposal.reason,
          confidenceBand: pendingFirstAvailableStaffProposal.confidenceBand,
          evidence: [pendingFirstAvailableStaffProposal.matchedTranscript],
          source: pendingFirstAvailableStaffProposal.asrAlternativesUsed ? "asr_alternative" : "contextual_repair",
          activeSlot: activeVoiceSlot,
          negated: false,
          requiresConfirmation: true,
          alternativesUsed: pendingFirstAvailableStaffProposal.asrAlternativesUsed
        })
      ];
      const lexSessionAttributes = buildKnownSessionAttributes({
        serviceName: undefined,
        staffPreference: undefined,
        staffId: undefined,
        selectedStaffId: undefined,
        confirmedStaffId: undefined,
        confirmedStaffName: undefined,
        awaitingBookingFrameRepairConfirmation: "true",
        proposedServiceName: pendingFullSetServiceProposal.proposedServiceName,
        proposedStaffPreference: pendingFirstAvailableStaffProposal.proposedStaffPreference,
        staffProposalConfidenceBand: pendingFirstAvailableStaffProposal.confidenceBand,
        bookingFrameRepairReason: "full_set_and_first_available_asr",
        clarificationReason: "booking_frame_repair_confirmation",
        voiceSlotDecisions: JSON.stringify(voiceSlotDecisions),
        awaitingFinalBookingConfirmation: "false",
        bookingConfirmationAsked: "false",
        lastAskedSlot: "bookingConfirmation",
        askedSlotsCount: "1",
        fallbackCount: "1",
        errorCount: "1"
      });
      const parsed = buildInternalParsedIntent({
        intentType: "BOOK_APPOINTMENT",
        customerName: normalized.customerName,
        customerPhone: normalized.customerPhone,
        serviceName: undefined,
        staffPreference: undefined,
        requestedDateTime: undefined,
        missingFields: ["serviceName", "staffPreference"],
        isReadyToBook: false
      });
      const bookingAttempt = await createAttempt({
        status: BookingAttemptStatus.NEEDS_INPUT,
        failureReason: "Medium-confidence booking frame repair requires confirmation.",
        normalizedRequest: {
          requestedDate: normalized.requestedDate,
          requestedTime: normalized.requestedTime,
          proposedServiceName: pendingFullSetServiceProposal.proposedServiceName,
          proposedStaffPreference: pendingFirstAvailableStaffProposal.proposedStaffPreference,
          bookingFrameRepairReason: "full_set_and_first_available_asr",
          timezone: salon.timezone
        }
      });
      const aiInteraction = await createInteraction({
        outcome: "MISSING_INFO",
        message,
        parsed,
        bookingAttemptId: bookingAttempt.id,
        responsePayload: {
          missingFields: ["serviceName", "staffPreference"],
          promptMissingFields: ["bookingConfirmation"],
          slotToElicit: "bookingConfirmation",
          bookingFrameRepairReason: "full_set_and_first_available_asr",
          sessionAttributes: lexSessionAttributes
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
            slotToElicit: "bookingConfirmation"
          },
          sessionAttributes: lexSessionAttributes
        },
        appointment: null,
        bookingAttempt,
        callSession,
        transcript,
        aiInteraction,
        escalation: null,
        alternatives: [],
        missingFields: ["serviceName", "staffPreference"],
        salonResolutionSource: resolutionSource
      };
    }
    const serviceDtmfConflictProposal =
      elicitDecision.slotToElicit === "serviceName" &&
      readStringAttribute(normalized.attributes, ["awaitingServiceConfirmation"]) === "true" &&
      readStringAttribute(normalized.attributes, ["serviceDtmfConflictWithInitialUtterance"]) &&
      readStringAttribute(normalized.attributes, ["proposedServiceName"])
        ? {
            proposedServiceName: readStringAttribute(normalized.attributes, ["proposedServiceName"])!,
            previousServiceName: readStringAttribute(normalized.attributes, ["serviceDtmfConflictWithInitialUtterance"])!,
            reason: "service_dtmf_conflicts_initial_utterance" as const
          }
        : null;

    const timeConfirmationPrompt =
      readStringAttribute(normalized.attributes, ["awaitingTimeConfirmation"]) === "true" &&
      readStringAttribute(normalized.attributes, ["proposedRequestedTime"])
        ? speak(`Did you mean ${escapeSsml(readStringAttribute(normalized.attributes, ["proposedRequestedTime"])!)}?`)
        : undefined;
    const pastTimeProposalRejectedPrompt =
      readStringAttribute(normalized.attributes, ["pastTimeProposalRejectedThisTurn"]) === "true"
        ? speak("What future day would you like?")
        : undefined;
    const serviceConfirmationPrompt = serviceDtmfConflictProposal
      ? speak(
          `I heard ${escapeSsml(serviceDtmfConflictProposal.proposedServiceName)} from the keypad. Is ${escapeSsml(serviceDtmfConflictProposal.proposedServiceName)} the service you want?`
        )
      : readStringAttribute(normalized.attributes, ["spokenMenuSelectionProposed"]) === "true" &&
        readStringAttribute(normalized.attributes, ["proposedServiceName"]) &&
        readStringAttribute(normalized.attributes, ["spokenDigitCandidate"])
      ? speak(
          `Did you choose option ${escapeSsml(DIGIT_SPEECH_LABELS[readStringAttribute(normalized.attributes, ["spokenDigitCandidate"])!] ?? readStringAttribute(normalized.attributes, ["spokenDigitCandidate"])!)}, ${escapeSsml(readStringAttribute(normalized.attributes, ["proposedServiceName"])!)}? Please say yes, or say the service name.`
        )
      : proposedServiceClarification
      ? buildProposedServicePrompt(normalized, salon.timezone)
      : undefined;
    const staffConfirmationPrompt = proposedFirstAvailableStaff && !deferOutOfOrderStaffProposal
      ? buildAmbiguousStaffConfirmationPrompt(normalized, salon.timezone)
      : staffProposalRejectedThisTurn
        ? buildStaffConfirmationRejectedPrompt(normalized, staffPromptOptions)
        : undefined;
    const currentTurnAcknowledgement = buildCurrentTurnAcknowledgement({
      currentTurnTranscript: normalized.currentTurnTranscript ?? normalized.transcriptText,
      attributes: normalized.attributes,
      knownFields: normalized,
      salonTimezone: salon.timezone
    });
    const freshRestartNeedsService =
      readStringAttribute(normalized.attributes, ["freshBookingRestart"]) === "true" &&
      elicitDecision.slotToElicit === "serviceName" &&
      !currentTurnHasBookingDetails(normalized);
    const message = freshRestartNeedsService
      ? speak("Let's start a new appointment. Which service would you like to book?")
      : serviceConfirmationPrompt ?? staffConfirmationPrompt ?? pastTimeProposalRejectedPrompt ?? timeConfirmationPrompt ?? buildLexMessage({
	      outcome: "MISSING_INFO",
      missingFields: elicitDecision.promptMissingFields,
      staffOptions: staffPromptOptions,
      knownFields: normalized,
      salonTimezone: salon.timezone,
      attemptCount: elicitDecision.attemptCount,
      servicePromptText: servicePromptSessionAttributes.serviceDtmfPromptText,
      collectingServiceName,
      staffMenuPromptText: shouldSpeakNumberedStaffMenu
        ? buildStaffNumberedDtmfPromptText(staffPromptOptions)
        : undefined,
      staffMenuAlreadySpoken: existingStaffMenuWasSpoken,
      knownCallerAcknowledgementName: shouldAcknowledgeKnownCaller
        ? recognizedCustomerNameForSession
        : undefined,
      rejectedCustomerName:
        rejectedCurrentTurnCustomerName || hasIgnoredCustomerNameNoise(normalized.attributes),
      unsupportedServiceRequest: unsupportedServiceRequest
        ? {
            ...unsupportedServiceRequest,
            suggestedServiceName: unsupportedServiceSuggestionName
          }
        : undefined,
      invalidStaffDtmfSelection: normalized.invalidStaffDtmfSelection,
      unmatchedStaffPreference: staffResolution.status === "unmatched_specific",
      partialBookingFragment: isPartialBookingFragment(
        normalized.currentTurnTranscript ?? normalized.transcriptText
      ),
      invalidServiceDtmfSelection: normalized.invalidServiceDtmfSelection,
      hasCurrentTurnTranscript: Boolean(normalized.currentTurnTranscript?.trim()),
      currentTurnAcknowledgement,
      serviceSlotConversationalNoise:
        elicitDecision.slotToElicit === "serviceName" &&
        readStringAttribute(normalized.attributes, ["lastAskedSlot"]) === "serviceName" &&
        isServiceSlotConversationalNoise(normalized.currentTurnTranscript ?? normalized.transcriptText),
      repeatedKnownFieldWhileAskingName:
        elicitDecision.slotToElicit === "customerName" &&
        readStringAttribute(normalized.attributes, ["lastAskedSlot"]) === "customerName" &&
        currentTurnRepeatsKnownBookingField(
          normalized.currentTurnTranscript ?? normalized.transcriptText,
          normalized,
          salon.timezone
        )
	    });
    const staffPromptAttributes = shouldPromptStaff
      ? {
          ...buildStaffPromptSessionAttributes(staffPromptOptions),
          staffRecognitionFailureCount:
            staffRecognitionFailureCount > 0 ? String(staffRecognitionFailureCount) : undefined,
          staffMenuWasSpoken: shouldSpeakNumberedStaffMenu || existingStaffMenuWasSpoken ? "true" : undefined,
          menuWasSpoken: shouldSpeakNumberedStaffMenu ? "true" : undefined
        }
      : {};
    const proposedServiceAttributes = serviceDtmfConflictProposal
      ? {
          awaitingServiceConfirmation: "true",
          proposedServiceName: serviceDtmfConflictProposal.proposedServiceName,
          serviceDtmfConflictWithInitialUtterance: serviceDtmfConflictProposal.previousServiceName,
          clarificationReason: serviceDtmfConflictProposal.reason,
          voiceSlotDecisions: withVoiceSlotDecision(
            normalized.attributes,
            buildVoiceSlotDecision({
              slot: "serviceName",
              action: "propose",
              canonicalValue: serviceDtmfConflictProposal.proposedServiceName,
              reason: serviceDtmfConflictProposal.reason,
              confidenceBand: "medium",
              evidence: [
                `initial=${serviceDtmfConflictProposal.previousServiceName}`,
                `dtmf=${serviceDtmfConflictProposal.proposedServiceName}`
              ],
              alternativesUsed: false
            })
          ),
          proposedSlotMutation: JSON.stringify({
            slotName: "serviceName",
            proposedValue: serviceDtmfConflictProposal.proposedServiceName,
            previousValue: serviceDtmfConflictProposal.previousServiceName,
            reason: serviceDtmfConflictProposal.reason
          })
        }
      : proposedServiceClarification
      ? {
          awaitingServiceConfirmation: "true",
          proposedServiceName: proposedServiceClarification.proposedServiceName,
          clarificationReason: proposedServiceClarification.reason,
          asrAlternativesUsed: proposedServiceClarification.asrAlternativesUsed ? "true" : "false",
          voiceSlotDecisions: withVoiceSlotDecision(
            normalized.attributes,
            buildVoiceSlotDecision({
              slot: "serviceName",
              action: "propose",
              canonicalValue: proposedServiceClarification.proposedServiceName,
              reason: proposedServiceClarification.reason,
              confidenceBand: "medium",
              evidence: [proposedServiceClarification.matchedTranscript],
              source: proposedServiceClarification.asrAlternativesUsed ? "asr_alternative" : "contextual_repair",
              activeSlot: activeVoiceSlot,
              negated: false,
              requiresConfirmation: true,
              alternativesUsed: proposedServiceClarification.asrAlternativesUsed
            })
          ),
          proposedSlotMutation: JSON.stringify({
            slotName: "serviceName",
            proposedValue: proposedServiceClarification.proposedServiceName,
            reason: proposedServiceClarification.reason,
            matchedTranscript: proposedServiceClarification.matchedTranscript
          })
        }
      : readStringAttribute(normalized.attributes, ["spokenMenuSelectionProposed"]) === "true" &&
        readStringAttribute(normalized.attributes, ["proposedServiceName"])
      ? {
          awaitingServiceConfirmation: "true",
          proposedServiceName: readStringAttribute(normalized.attributes, ["proposedServiceName"]),
          spokenMenuSelectionProposed: "true",
          spokenDigitCandidate: readStringAttribute(normalized.attributes, ["spokenDigitCandidate"]),
          dtmfAccepted: "false",
          dtmfRejectedReason:
            readStringAttribute(normalized.attributes, ["dtmfRejectedReason"]) ||
            "input_mode_not_dtmf",
          serviceRecognitionSource: "speech_menu_digit_proposal",
          serviceRecognitionConfidence: "",
          asrConfidenceSource: "unknown",
          ambiguityReason: "spoken_digit_not_genuine_dtmf",
          clarificationReason: "spoken_service_menu_digit_requires_confirmation",
          voiceSlotDecisions: withVoiceSlotDecision(
            normalized.attributes,
            buildVoiceSlotDecision({
              slot: "serviceName",
              action: "propose",
              canonicalValue: readStringAttribute(normalized.attributes, ["proposedServiceName"])!,
              reason: "spoken_service_menu_digit_requires_confirmation",
              confidenceBand: "medium",
              evidence: [`spoken option ${readStringAttribute(normalized.attributes, ["spokenDigitCandidate"]) || ""}`],
              source: "contextual_repair",
              activeSlot: activeVoiceSlot,
              negated: false,
              requiresConfirmation: true,
              alternativesUsed: false
            })
          ),
          proposedSlotMutation: JSON.stringify({
            slotName: "serviceName",
            proposedValue: readStringAttribute(normalized.attributes, ["proposedServiceName"]),
            accepted: false,
            reason: "spoken_service_menu_digit_requires_confirmation"
          })
        }
      : {};
    const proposedStaffAttributes = proposedFirstAvailableStaff
      ? {
          awaitingStaffConfirmation: deferOutOfOrderStaffProposal ? undefined : "true",
          proposedStaffPreference: proposedFirstAvailableStaff.proposedStaffPreference,
          staffClarificationReason: proposedFirstAvailableStaff.reason,
          clarificationReason: deferOutOfOrderStaffProposal
            ? "out_of_order_staff_proposal_preserved"
            : proposedFirstAvailableStaff.reason,
          staffProposalConfidenceBand: proposedFirstAvailableStaff.confidenceBand,
          asrAlternativesUsed: proposedFirstAvailableStaff.asrAlternativesUsed ? "true" : "false",
          voiceSlotDecisions: withVoiceSlotDecision(
            normalized.attributes,
            buildVoiceSlotDecision({
              slot: "staffPreference",
              action: "propose",
              canonicalValue: proposedFirstAvailableStaff.proposedStaffPreference,
              reason: proposedFirstAvailableStaff.reason,
              confidenceBand: proposedFirstAvailableStaff.confidenceBand,
              evidence: [proposedFirstAvailableStaff.matchedTranscript],
              source: proposedFirstAvailableStaff.asrAlternativesUsed ? "asr_alternative" : "contextual_repair",
              activeSlot: readStringAttribute(normalized.attributes, ["lastAskedSlot"]),
              negated: false,
              requiresConfirmation: true,
              alternativesUsed: proposedFirstAvailableStaff.asrAlternativesUsed
            })
          ),
          proposedSlotMutation: JSON.stringify({
            slotName: "staffPreference",
            proposedValue: proposedFirstAvailableStaff.proposedStaffPreference,
            reason: proposedFirstAvailableStaff.reason,
            matchedTranscript: proposedFirstAvailableStaff.matchedTranscript
          })
        }
      : staffProposalRejectedThisTurn
        ? {
            awaitingStaffConfirmation: "false",
            proposedStaffPreference: "",
            staffRecognitionConfirmed: "false",
            staffClarificationReason: "staff_proposal_rejected"
          }
        : {};
    const unresolvedStaffAttributes = shouldPromptStaff
      ? {
          staffPreference: undefined,
          staffId: undefined,
          selectedStaffId: undefined,
          confirmedStaffId: undefined,
          confirmedStaffName: undefined
        }
      : {};
    const unsupportedServiceAttributes = unsupportedServiceRequest
      ? {
          serviceClarificationReason: "unsupported_service",
          serviceClarificationHeard: unsupportedServiceRequest.heardServiceName,
          serviceSuggestionName: unsupportedServiceSuggestionName,
          menuWasSpoken: "true"
        }
      : {};
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
        requestedDateTimeText,
        serviceClarificationReason: unsupportedServiceRequest ? "unsupported_service" : undefined,
        unsupportedServiceRequest,
        suggestedServiceName: unsupportedServiceSuggestionName
      }
    });
    const lexSessionAttributes = buildKnownSessionAttributes({
      ...unsupportedServiceAttributes,
      ...proposedServiceAttributes,
      ...proposedStaffAttributes,
      ...unresolvedStaffAttributes,
      ...elicitDecision.sessionAttributes,
      ...staffPromptAttributes,
      awaitingTimeConfirmation: readStringAttribute(normalized.attributes, ["awaitingTimeConfirmation"]),
      proposedRequestedTime: readStringAttribute(normalized.attributes, ["proposedRequestedTime"]),
      pastTimeProposalConfirmed: readStringAttribute(normalized.attributes, ["pastTimeProposalConfirmed"]),
      pastTimeProposalRejectedThisTurn: readStringAttribute(normalized.attributes, ["pastTimeProposalRejectedThisTurn"]),
      timeRecognitionDiagnostics: readStringAttribute(normalized.attributes, ["timeRecognitionDiagnostics"])
    });
    const aiInteraction = await createInteraction({
      outcome: "MISSING_INFO",
      message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        missingFields: Array.from(missingFields.values()),
        promptMissingFields: elicitDecision.promptMissingFields,
        slotToElicit: elicitDecision.slotToElicit,
        serviceClarificationReason: unsupportedServiceRequest ? "unsupported_service" : undefined,
        unsupportedServiceRequest,
        suggestedServiceName: unsupportedServiceSuggestionName,
        timeRecognition: (() => {
          const raw = readStringAttribute(normalized.attributes, ["timeRecognitionDiagnostics"]);
          if (!raw) {
            return undefined;
          }
          try {
            return JSON.parse(raw);
          } catch {
            return raw;
          }
        })(),
        sessionAttributes: lexSessionAttributes
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
        sessionAttributes: lexSessionAttributes
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

  if (
    serviceMatch &&
    !shouldAutoAcceptServiceMatch(serviceMatch, normalized.serviceName) &&
    !isAffirmative(normalized.serviceName)
  ) {
    const attempts = parseAttemptCount(
      readStringAttribute(normalized.attributes, ["serviceClarificationAttempts"])
    );
    const suggestedServiceName = getCustomerFacingServiceName(serviceMatch.service.name);
    const message = buildServiceClarificationMessage({
      heardServiceName: normalized.serviceName!,
      suggestedServiceName,
      availableServiceNames: activeServiceMenuServices.map((service) => service.name),
      attempts,
      servicePromptText: servicePromptSessionAttributes.serviceDtmfPromptText
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
        suggestedServiceName,
        matchedServiceRecordName: serviceMatch.service.name,
        serviceMatchConfidence: serviceMatch.confidence,
        serviceMatchStrategy: serviceMatch.matchedBy,
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
        serviceName: normalized.serviceName,
        suggestedServiceName,
        matchedServiceRecordName: serviceMatch.service.name,
        serviceMatchConfidence: serviceMatch.confidence,
        serviceMatchStrategy: serviceMatch.matchedBy,
        attempts: attempts + 1,
        slotToElicit: "serviceName"
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
          serviceSuggestionName: suggestedServiceName,
          serviceClarificationAttempts: String(attempts + 1),
          serviceRecognitionFailureCount: String(attempts + 1),
          lastAskedSlot: "serviceName",
          askedSlotsCount: String(attempts + 1),
          fallbackCount: String(attempts + 1),
          errorCount: String(attempts + 1),
          ...servicePromptSessionAttributes
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
    const message = buildServiceClarificationMessage({
      heardServiceName: normalized.serviceName!,
      availableServiceNames: activeServiceMenuServices.map((service) => service.name),
      attempts,
      servicePromptText: servicePromptSessionAttributes.serviceDtmfPromptText
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
      status: BookingAttemptStatus.NEEDS_INPUT,
      requestedStartTime,
      failureReason: "Service not found or inactive.",
      normalizedRequest: {
        serviceName: normalized.serviceName,
        availableServiceNames: activeServiceMenuServices.map((service) => service.name),
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
        serviceName: normalized.serviceName,
        availableServiceNames: activeServiceMenuServices.map((service) => service.name),
        attempts: attempts + 1,
        slotToElicit: "serviceName"
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
          serviceRecognitionFailureCount: String(attempts + 1),
          lastAskedSlot: "serviceName",
          askedSlotsCount: String(attempts + 1),
          fallbackCount: String(attempts + 1),
          errorCount: String(attempts + 1),
          ...servicePromptSessionAttributes
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

  if (
    shouldConfirmManicurePedicureAfterFailure({
      serviceMatch,
      serviceName: normalized.serviceName,
      currentTurnTranscript: normalized.currentTurnTranscript,
      attributes: normalized.attributes
    })
  ) {
    normalized.serviceName = undefined;
    const attempts = parseAttemptCount(
      readStringAttribute(normalized.attributes, [
        "serviceRecognitionFailureCount",
        "serviceClarificationAttempts"
      ])
    );
    const message = speak(
      `I heard Manicure, but I may have misheard Pedicure. ${servicePromptSessionAttributes.serviceDtmfPromptText}`
    );
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: undefined,
      staffPreference: normalized.staffPreference,
      requestedDateTime: requestedStartTime.toISOString(),
      missingFields: ["serviceName"],
      isReadyToBook: false
    });
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NEEDS_INPUT,
      requestedStartTime,
      failureReason: "Service confirmation required after ambiguous Manicure/Pedicure recognition.",
      normalizedRequest: {
        serviceName: "Manicure",
        ambiguousServiceNames: ["Manicure", "Pedicure"],
        startTimeIso: requestedStartTime.toISOString(),
        timezone: salon.timezone
      }
    });
    const lexSessionAttributes = buildKnownSessionAttributes({
      serviceName: undefined,
      confirmedServiceName: undefined,
      serviceClarificationAttempts: String(attempts + 1),
      serviceRecognitionFailureCount: String(attempts + 1),
      lastAskedSlot: "serviceName",
      askedSlotsCount: String(attempts + 1),
      fallbackCount: String(attempts + 1),
      errorCount: String(attempts + 1),
      ...servicePromptSessionAttributes
    });
    const aiInteraction = await createInteraction({
      outcome: "MISSING_INFO",
      message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        serviceName: "Manicure",
        ambiguousServiceNames: ["Manicure", "Pedicure"],
        serviceClarificationReason: "ambiguous_manicure_pedicure",
        slotToElicit: "serviceName",
        sessionAttributes: lexSessionAttributes
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
        sessionAttributes: lexSessionAttributes
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
  const callerServiceName = getCustomerFacingServiceName(service.name) ?? service.name;
  normalized.serviceName = callerServiceName;

  const earlyBusinessHoursDecision = await getBusinessHoursDecision({
    salonId: salon.id,
    timezone: salon.timezone,
    startTime: requestedStartTime,
    durationMinutes: service.durationMinutes
  });
  if (!earlyBusinessHoursDecision.allowed) {
    const availabilityReasonCode =
      earlyBusinessHoursDecision.reason === "closed" ? "SALON_CLOSED" : "OUTSIDE_BUSINESS_HOURS";
    const message = earlyBusinessHoursDecision.message ?? speak(
      "That time is outside our business hours. <break time=\"300ms\"/> What other time works for you?"
    );
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: callerServiceName,
      staffPreference: normalized.staffPreference,
      requestedDateTime: requestedStartTime.toISOString(),
      missingFields: earlyBusinessHoursDecision.reason === "closed" ? ["requestedDate"] : ["requestedTime"],
      isReadyToBook: false
    });
    const lexSessionAttributes = buildKnownSessionAttributes({
      conversationState: "CONTINUE",
      conversationOutcome: "NO_AVAILABILITY",
      conversationComplete: "false",
      availabilityReasonCode,
      aiAlternativeSlots: "[]",
      awaitingAlternativeSelection: "false",
      awaitingFinalBookingConfirmation: "false",
      bookingConfirmationAsked: "false",
      requestedDate: earlyBusinessHoursDecision.reason === "closed" ? undefined : normalized.requestedDate,
      lastAskedSlot: earlyBusinessHoursDecision.reason === "closed" ? "requestedDate" : "requestedTime",
      slotToElicit: earlyBusinessHoursDecision.reason === "closed" ? "requestedDate" : "requestedTime",
      askedSlotsCount: "1",
      fallbackCount: "1",
      errorCount: "1",
      businessHoursDecision: JSON.stringify(earlyBusinessHoursDecision.debug)
    });
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NO_AVAILABILITY,
      requestedStartTime,
      failureReason:
        earlyBusinessHoursDecision.reason === "closed"
          ? "Salon is closed for the requested day."
          : "Requested time is outside business hours.",
      normalizedRequest: {
        serviceId: service.id,
        serviceName: callerServiceName,
        staffPreference: normalized.staffPreference,
        startTimeIso: requestedStartTime.toISOString(),
        timezone: salon.timezone,
        availabilityReasonCode,
        businessHoursDecision: earlyBusinessHoursDecision.debug
      },
      alternativeSlots: []
    });
    const aiInteraction = await createInteraction({
      outcome: "NO_AVAILABILITY",
      message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        alternatives: [],
        availabilityReasonCode,
        businessHoursDecision: earlyBusinessHoursDecision.debug,
        sessionAttributes: lexSessionAttributes
      },
      isValid: true
    });
    await finalizeCall({
      outcome: "NO_AVAILABILITY",
      bookingAttemptId: bookingAttempt.id,
      bookingStatus: bookingAttempt.status,
      parsed,
      message,
      alternatives: [],
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
          slotToElicit: earlyBusinessHoursDecision.reason === "closed" ? "requestedDate" : "requestedTime"
        },
        sessionAttributes: lexSessionAttributes
      },
      appointment: null,
      bookingAttempt,
      callSession,
      transcript,
      aiInteraction,
      escalation: null,
      alternatives: [],
      missingFields: earlyBusinessHoursDecision.reason === "closed" ? ["requestedDate"] : ["requestedTime"],
      salonResolutionSource: resolutionSource
    };
  }

  staffResolution =
    staffResolution.rawStaffPreference === normalized.staffPreference
      ? staffResolution
      : await resolveStaffCandidates({
          salonId: salon.id,
          requestedStaffName: normalized.staffPreference,
          staffId: normalized.staffId,
          attributes: normalized.attributes,
          excludedStaffIds: staffExclusionState.ids,
          excludedStaffNames: staffExclusionState.names
        });

  if (staffResolution.status === "ambiguous") {
    const message = buildStaffClarificationMessage({
      availableStaff: staffResolution.allStaff
    });
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: callerServiceName,
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
        serviceName: callerServiceName,
        serviceRecordName: service.name,
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
        staffPreference: staffResolution.rawStaffPreference,
        ambiguousStaffNames: staffResolution.ambiguousStaffNames,
        slotToElicit: "staffPreference"
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
          staffPreference: undefined,
          staffId: undefined,
          selectedStaffId: undefined,
          confirmedStaffId: undefined,
          confirmedStaffName: undefined,
          lastAskedSlot: "staffPreference",
          askedSlotsCount: "1",
          fallbackCount: "1",
          errorCount: "1",
          ...buildStaffPromptSessionAttributes(staffResolution.allStaff)
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
    normalized.staffId = staffResolution.matchedStaff.id;
  }

  const mappedStaffCandidates = filterExcludedStaff(
    await getMappedActiveBookableStaffForService({
      salonId: salon.id,
      serviceId: service.id
    }),
    staffExclusionState.ids,
    staffExclusionState.names
  );
  const mappedStaffIds = new Set(mappedStaffCandidates.map((staff) => staff.id));

  if (hasActiveStaffExclusions && !mappedStaffCandidates.length) {
    normalized.staffPreference = undefined;
    normalized.staffId = undefined;
    const message = speak(
      `I don't see another technician for ${escapeSsml(callerServiceName)} right now. Which technician would you like instead, or press 0 for a person?`
    );
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: callerServiceName,
      staffPreference: undefined,
      requestedDateTime: requestedStartTime.toISOString(),
      missingFields: ["staffPreference"],
      isReadyToBook: false
    });
    const lexSessionAttributes = buildKnownSessionAttributes({
      staffPreference: undefined,
      staffId: undefined,
      selectedStaffId: undefined,
      confirmedStaffId: undefined,
      confirmedStaffName: undefined,
      lastAskedSlot: "staffPreference",
      askedSlotsCount: "1",
      fallbackCount: "1",
      errorCount: "1",
      ...buildStaffPromptSessionAttributes(mappedStaffCandidates)
    });
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NEEDS_INPUT,
      requestedStartTime,
      failureReason: "No non-excluded technician is mapped to the requested service.",
      normalizedRequest: {
        serviceId: service.id,
        serviceName: callerServiceName,
        excludedStaffIds: Array.from(staffExclusionState.ids.values()),
        excludedStaffNames: Array.from(staffExclusionState.names.values()),
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
        promptMissingFields: ["staffPreference"],
        excludedStaffIds: Array.from(staffExclusionState.ids.values()),
        excludedStaffNames: Array.from(staffExclusionState.names.values()),
        slotToElicit: "staffPreference",
        sessionAttributes: lexSessionAttributes
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
        sessionAttributes: lexSessionAttributes
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

  if (staffResolution.status === "matched" && !mappedStaffIds.has(staffResolution.matchedStaff.id)) {
    const invalidStaffName = staffResolution.matchedStaff.fullName;
    const invalidStaffId = staffResolution.matchedStaff.id;
    normalized.staffPreference = undefined;
    normalized.staffId = undefined;
    const message = speak(
      `${escapeSsml(invalidStaffName)} doesn't provide ${escapeSsml(callerServiceName)}. Please choose another technician, or say first available. Press 0 for a person.`
    );
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: normalized.serviceName,
      staffPreference: undefined,
      requestedDateTime: requestedStartTime.toISOString(),
      missingFields: ["staffPreference"],
      isReadyToBook: false
    });
    const lexSessionAttributes = buildKnownSessionAttributes({
      lastAskedSlot: "staffPreference",
      askedSlotsCount: "1",
      fallbackCount: "1",
      errorCount: "1",
      ...buildStaffPromptSessionAttributes(mappedStaffCandidates)
    });
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NEEDS_INPUT,
      requestedStartTime,
      failureReason: `STAFF_NOT_MAPPED: ${invalidStaffName} is not assigned to ${callerServiceName}.`,
      normalizedRequest: {
        serviceId: service.id,
        serviceName: callerServiceName,
        invalidStaffId,
        invalidStaffName,
        availabilityReasonCode: "STAFF_NOT_MAPPED",
        mappedStaffIds: mappedStaffCandidates.map((staff) => staff.id),
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
        errorCode: "STAFF_NOT_MAPPED",
        availabilityReasonCode: "STAFF_NOT_MAPPED",
        invalidStaffId,
        invalidStaffName,
        serviceId: service.id,
        serviceName: callerServiceName,
        missingFields: ["staffPreference"],
        promptMissingFields: ["staffPreference"],
        slotToElicit: "staffPreference",
        sessionAttributes: lexSessionAttributes
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
        sessionAttributes: lexSessionAttributes
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

  const businessHoursDecision = await getBusinessHoursDecision({
    salonId: salon.id,
    timezone: salon.timezone,
    startTime: requestedStartTime,
    durationMinutes: service.durationMinutes
  });
  if (!businessHoursDecision.allowed) {
    const availabilityReasonCode =
      businessHoursDecision.reason === "closed" ? "SALON_CLOSED" : "OUTSIDE_BUSINESS_HOURS";
    const message = businessHoursDecision.message ?? speak(
      "That time is outside our business hours. <break time=\"300ms\"/> What other time works for you?"
    );
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: callerServiceName,
      staffPreference: normalized.staffPreference,
      requestedDateTime: requestedStartTime.toISOString(),
      missingFields: [],
      isReadyToBook: false
    });
    const lexSessionAttributes = buildKnownSessionAttributes({
      conversationOutcome: "NO_AVAILABILITY",
      aiAlternativeSlots: "[]",
      awaitingAlternativeSelection: "false",
      awaitingFinalBookingConfirmation: "false",
      bookingConfirmationAsked: "false",
      requestedDate: businessHoursDecision.reason === "closed" ? undefined : normalized.requestedDate,
      lastAskedSlot: businessHoursDecision.reason === "closed" ? "requestedDate" : "requestedTime",
      askedSlotsCount: "1",
      fallbackCount: "1",
      errorCount: "1",
      businessHoursDecision: JSON.stringify(businessHoursDecision.debug)
    });
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NO_AVAILABILITY,
      requestedStartTime,
      failureReason:
        businessHoursDecision.reason === "closed"
          ? "Salon is closed for the requested day."
          : "Requested time is outside business hours.",
      normalizedRequest: {
        serviceId: service.id,
        serviceName: callerServiceName,
        staffPreference: normalized.staffPreference,
        startTimeIso: requestedStartTime.toISOString(),
        timezone: salon.timezone,
        availabilityReasonCode,
        businessHoursDecision: businessHoursDecision.debug
      },
      alternativeSlots: []
    });
    const aiInteraction = await createInteraction({
      outcome: "NO_AVAILABILITY",
      message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        alternatives: [],
        availabilityReasonCode,
        businessHoursDecision: businessHoursDecision.debug,
        sessionAttributes: lexSessionAttributes
      },
      isValid: true
    });
    await finalizeCall({
      outcome: "NO_AVAILABILITY",
      bookingAttemptId: bookingAttempt.id,
      bookingStatus: bookingAttempt.status,
      parsed,
      message,
      alternatives: [],
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
        sessionAttributes: lexSessionAttributes
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

  const storedConfirmationFingerprint = readStringAttribute(normalized.attributes, [
    "confirmationFingerprint",
    "bookingConfirmationFingerprint"
  ]);
  if (staffResolution.status === "matched" && isConfirmationAccepted(normalized.confirmationState)) {
    const currentConfirmationFingerprint = buildBookingFingerprint({
      salonId: salon.id,
      customerId: recognizedCustomer?.id,
      customerPhone: normalized.customerPhone,
      serviceId: service.id,
      staffId: staffResolution.matchedStaff.id,
      startTime: requestedStartTime,
      durationMinutes: service.durationMinutes
    });
    if (
      (awaitingFinalBookingConfirmation || storedConfirmationFingerprint) &&
      storedConfirmationFingerprint !== currentConfirmationFingerprint
    ) {
      normalized.confirmationState = undefined;
    }
  }

  if (
    callSession &&
    staffResolution.status === "matched" &&
    isConfirmationAccepted(normalized.confirmationState)
  ) {
    const successfulAttempt = await prisma.bookingAttempt.findFirst({
      where: {
        callSessionId: callSession.id,
        status: BookingAttemptStatus.SUCCESS,
        appointmentId: {
          not: null
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });
    const previousRequest =
      successfulAttempt?.normalizedRequest &&
      typeof successfulAttempt.normalizedRequest === "object" &&
      !Array.isArray(successfulAttempt.normalizedRequest)
        ? (successfulAttempt.normalizedRequest as Record<string, unknown>)
        : {};
    const successfulAppointmentId = successfulAttempt?.appointmentId ?? null;
    const isSameConfirmedBooking =
      Boolean(successfulAppointmentId) &&
      previousRequest.serviceId === service.id &&
      previousRequest.staffId === staffResolution.matchedStaff.id &&
      previousRequest.startTimeIso === requestedStartTime.toISOString();

    if (successfulAttempt && successfulAppointmentId && isSameConfirmedBooking) {
      const appointment = await getAppointmentDetail(salon.id, successfulAppointmentId);
      const persistedRetryServiceName =
        getCustomerFacingServiceName(appointment.service.name) ?? appointment.service.name;
      const message = buildLexMessage({
        outcome: "BOOKED",
        appointmentStartTime: requestedStartTime,
        salonTimezone: salon.timezone,
        serviceName: persistedRetryServiceName,
        staffName: appointment.staff.fullName
      });
      const parsed = buildInternalParsedIntent({
        intentType: "BOOK_APPOINTMENT",
        customerName: normalized.customerName,
        customerPhone: normalized.customerPhone,
        serviceName: persistedRetryServiceName,
        staffPreference: appointment.staff.fullName,
        requestedDateTime: requestedStartTime.toISOString(),
        missingFields: [],
        isReadyToBook: true
      });
      const aiInteraction = await createInteraction({
        outcome: "BOOKED",
        message,
        parsed,
        bookingAttemptId: successfulAttempt.id,
        responsePayload: {
          appointmentId: successfulAppointmentId,
          idempotentRetry: true
        },
        isValid: true
      });
      await finalizeCall({
        outcome: "BOOKED",
        bookingAttemptId: successfulAttempt.id,
        bookingStatus: successfulAttempt.status,
        parsed,
        message,
        appointmentId: successfulAppointmentId
      });

      logger.info(
        {
          callSessionId: callSession.id,
          bookingAttemptId: successfulAttempt.id,
          appointmentId: successfulAppointmentId,
          contactId: normalized.contactId
        },
        "Amazon Connect AI booking retry returned existing appointment before availability validation."
      );

      return {
        outcome: "BOOKED" as const,
        message,
        lexResponse: {
          fulfillmentState: "Fulfilled",
          message,
          messageContentType: "SSML",
          sessionAttributes: buildKnownSessionAttributes({
            bookingOutcome: "BOOKED",
            serviceName: persistedRetryServiceName,
            confirmedServiceName: persistedRetryServiceName,
            staffPreference: appointment.staff.fullName,
            staffId: appointment.staffId,
            selectedStaffId: appointment.staffId,
            confirmedStaffId: appointment.staffId,
            confirmedStaffName: appointment.staff.fullName,
            aiAlternativeSlots: "[]",
            awaitingAlternativeSelection: "false",
            awaitingFinalBookingConfirmation: "false",
            bookingConfirmationAsked: "false"
          })
        },
        appointment,
        bookingAttempt: successfulAttempt,
        callSession,
        transcript,
        aiInteraction,
        escalation: null,
        alternatives: [],
        missingFields: [],
        salonResolutionSource: resolutionSource
      };
    }
  }

  const preferredStaffCandidates =
    staffResolution.status === "matched"
      ? staffResolution.candidates.filter((staff) => mappedStaffIds.has(staff.id))
      : mappedStaffCandidates;
  const allStaffCandidates = mappedStaffCandidates;
  const requestedAnyStaff = staffResolution.status === "explicit_any";

  let chosenStaff: { id: string; fullName: string } | null = null;
  const rejectedReasons: string[] = [];
  const rejectedReasonDetails: Array<{
    staffId: string;
    staffName: string;
    reason?: string;
    reasonCode?: string;
  }> = [];
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
      rejectedReasonDetails.push({
        staffId: staff.id,
        staffName: staff.fullName,
        reason: slotValidation.reason,
        reasonCode: slotValidation.reasonCode
      });
    } catch (error) {
      if (error instanceof AppError && error.statusCode < 500) {
        rejectedReasons.push(error.message);
        rejectedReasonDetails.push({
          staffId: staff.id,
          staffName: staff.fullName,
          reason: error.message,
          reasonCode: error.code
        });
        continue;
      }
      throw error;
    }
  }
  if (chosenStaff && requestedAnyStaff) {
    normalized.staffPreference = chosenStaff.fullName;
  }
  if (chosenStaff) {
    normalized.staffId = chosenStaff.id;
  }

  const confirmationFingerprint = buildBookingFingerprint({
    salonId: salon.id,
    customerId: recognizedCustomer?.id,
    customerPhone: normalized.customerPhone,
    serviceId: service.id,
    staffId: chosenStaff?.id ?? normalized.staffId ?? "",
    startTime: requestedStartTime,
    durationMinutes: service.durationMinutes
  });

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
    const requestedStaffDisplayName = requestedAnyStaff
      ? undefined
      : normalized.staffPreference
      ? preferredStaffCandidates[0]?.fullName ?? normalized.staffPreference
      : undefined;
    const primaryRejectedReason = requestedSpecificStaff
      ? rejectedReasonDetails.find((reason) => reason.staffId === preferredStaffCandidates[0]?.id) ??
        rejectedReasonDetails[0]
      : rejectedReasonDetails[0];
    const message = buildLexMessage({
      outcome: "NO_AVAILABILITY",
      alternatives,
      salonTimezone: salon.timezone,
      appointmentStartTime: requestedStartTime,
      serviceName: normalized.serviceName,
      requestedStaffName: requestedStaffDisplayName,
      availabilityReasonCode: primaryRejectedReason?.reasonCode
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
        availabilityReasonCode: primaryRejectedReason?.reasonCode,
        availabilityRejectedReasons: rejectedReasonDetails,
        alternativeOfferId: createHash("sha256")
          .update(`${salon.id}|${service.id}|${requestedStartTime.toISOString()}|${normalized.staffPreference ?? "ANY"}`)
          .digest("hex")
          .slice(0, 16),
        startTimeIso: requestedStartTime.toISOString(),
        timezone: salon.timezone
      }
    });
    const alternativeOfferId = createHash("sha256")
      .update(`${salon.id}|${service.id}|${requestedStartTime.toISOString()}|${normalized.staffPreference ?? "ANY"}`)
      .digest("hex")
      .slice(0, 16);
    const aiInteraction = await createInteraction({
      outcome: "NO_AVAILABILITY",
      message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        alternatives,
        availabilityReasonCode: primaryRejectedReason?.reasonCode,
        availabilityRejectedReasons: rejectedReasonDetails,
        alternativeOfferId,
        anchorRequestedDate: normalized.requestedDate,
        anchorRequestedTime: normalized.requestedTime,
        anchorRequestedStaff: normalized.staffPreference ?? "Any staff",
        offerAttemptCount: 1
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
          conversationOutcome: "NO_AVAILABILITY",
          aiAlternativeSlots: JSON.stringify(alternatives.slice(0, 2)),
          alternativeOfferId,
          anchorRequestedDate: normalized.requestedDate,
          anchorRequestedTime: normalized.requestedTime,
          anchorRequestedStaff: normalized.staffPreference ?? "Any staff",
          offerAttemptCount: "1",
          rejectedOptionKeys: "[]",
          awaitingAlternativeSelection: "true",
          awaitingFinalBookingConfirmation: "false",
          bookingConfirmationAsked: "false",
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
    const resetKeys = getFinalConfirmationClearKeys();
	    const message = speak("Okay, I won't book that appointment. <break time=\"300ms\"/> Would you like to start a new booking, change a detail, or stop?");
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: callerServiceName,
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
        serviceName: callerServiceName,
        serviceRecordName: service.name,
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
	        confirmationState: normalized.confirmationState,
	        awaitingFinalBookingConfirmation: false,
        awaitingRejectedBookingChoice: true,
        sessionAttributeKeysToClear: resetKeys
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
	        sessionAttributes: buildKnownSessionAttributes({
	          aiAlternativeSlots: "[]",
	          awaitingAlternativeSelection: "false",
	          awaitingFinalBookingConfirmation: "false",
	          bookingConfirmationAsked: "false",
          awaitingRejectedBookingChoice: "true",
          sessionAttributeKeysToClear: JSON.stringify(resetKeys),
          forceHumanEscalation: "false",
          transferToQueue: "false"
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

  if (!isConfirmationAccepted(normalized.confirmationState)) {
    const message =
      awaitingFinalBookingConfirmation && finalConfirmationOutcome === "UNKNOWN"
        ? speak("Please say yes to confirm, or tell me what you would like to change.")
        : buildBookingConfirmationMessage({
            serviceName: callerServiceName,
            appointmentStartTime: requestedStartTime,
            salonTimezone: salon.timezone,
            staffName: chosenStaff.fullName,
            customerName: normalized.customerName,
            requestedAnyStaff,
            customerNameFallbackNotice:
              customerNameSourceOverride === "phone_fallback" &&
              normalized.customerName &&
              normalized.customerName.replace(/\D/g, "").slice(-4)
                ? `I couldn't clearly hear the name, so I'll use Guest ending in ${normalized.customerName.replace(/\D/g, "").slice(-4)} for now.`
                : undefined,
            excludedStaffNames: staffIntent.hasExplicitExclusion
              ? staffIntent.excludedStaff.map((member) => member.fullName)
              : undefined,
            changeAcknowledgement: finalConfirmationStaffChangeAcknowledgement
          });
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: callerServiceName,
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
        serviceName: callerServiceName,
        serviceRecordName: service.name,
        staffName: chosenStaff.fullName,
        startTimeIso: requestedStartTime.toISOString(),
        timezone: salon.timezone
      }
    });
    const confirmationSessionAttributes = buildKnownSessionAttributes({
      aiAlternativeSlots: "[]",
      awaitingAlternativeSelection: "false",
      awaitingFinalBookingConfirmation: "true",
      bookingConfirmationAsked: "true",
      confirmationFingerprint,
      lastAskedSlot: "bookingConfirmation",
      askedSlotsCount: "1",
      fallbackCount: "1",
      errorCount: "1"
    });
    const aiInteraction = await createInteraction({
      outcome: "MISSING_INFO",
      message,
      parsed,
      bookingAttemptId: bookingAttempt.id,
      responsePayload: {
        serviceId: service.id,
        staffId: chosenStaff.id,
        staffName: chosenStaff.fullName,
        startTimeIso: requestedStartTime.toISOString(),
        awaitingFinalBookingConfirmation: true,
        confirmationFingerprint,
        sessionAttributes: confirmationSessionAttributes
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
          slotToElicit: "bookingConfirmation"
        },
        sessionAttributes: confirmationSessionAttributes
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

  if (callSession) {
    const successfulAttempt = await prisma.bookingAttempt.findFirst({
      where: {
        callSessionId: callSession.id,
        status: BookingAttemptStatus.SUCCESS,
        appointmentId: {
          not: null
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });
    const previousRequest =
      successfulAttempt?.normalizedRequest &&
      typeof successfulAttempt.normalizedRequest === "object" &&
      !Array.isArray(successfulAttempt.normalizedRequest)
        ? (successfulAttempt.normalizedRequest as Record<string, unknown>)
        : {};
    const isSameConfirmedBooking =
      successfulAttempt?.appointmentId &&
      previousRequest.customerId === customer.id &&
      previousRequest.serviceId === service.id &&
      previousRequest.staffId === chosenStaff.id &&
      previousRequest.startTimeIso === requestedStartTime.toISOString();

    if (isSameConfirmedBooking) {
      const appointment = await getAppointmentDetail(salon.id, successfulAttempt.appointmentId!);
      const persistedRetryServiceName =
        getCustomerFacingServiceName(appointment.service.name) ?? appointment.service.name;
      const message = buildLexMessage({
        outcome: "BOOKED",
        appointmentStartTime: requestedStartTime,
        salonTimezone: salon.timezone,
        serviceName: persistedRetryServiceName,
        staffName: appointment.staff.fullName
      });
      const parsed = buildInternalParsedIntent({
        intentType: "BOOK_APPOINTMENT",
        customerName: normalized.customerName,
        customerPhone: normalized.customerPhone,
        serviceName: persistedRetryServiceName,
        staffPreference: appointment.staff.fullName,
        requestedDateTime: requestedStartTime.toISOString(),
        missingFields: [],
        isReadyToBook: true
      });

      logger.info(
        {
          callSessionId: callSession.id,
          bookingAttemptId: successfulAttempt.id,
          appointmentId: successfulAttempt.appointmentId,
          contactId: normalized.contactId
        },
        "Amazon Connect AI booking retry returned existing appointment."
      );

      return {
        outcome: "BOOKED" as const,
        message,
        lexResponse: {
          fulfillmentState: "Fulfilled",
          message,
          messageContentType: "SSML",
          sessionAttributes: buildKnownSessionAttributes({
            bookingOutcome: "BOOKED",
            serviceName: persistedRetryServiceName,
            confirmedServiceName: persistedRetryServiceName,
            staffPreference: appointment.staff.fullName,
            staffId: appointment.staffId,
            selectedStaffId: appointment.staffId,
            confirmedStaffId: appointment.staffId,
            confirmedStaffName: appointment.staff.fullName,
            aiAlternativeSlots: "[]",
            awaitingAlternativeSelection: "false",
            awaitingFinalBookingConfirmation: "false",
            bookingConfirmationAsked: "false"
          })
        },
        appointment,
        bookingAttempt: successfulAttempt,
        callSession,
        transcript,
        aiInteraction: null,
        escalation: null,
        alternatives: [],
        missingFields: [],
        salonResolutionSource: resolutionSource
      };
    }
  }

  const appointment = await createAppointmentFromAI(salon.id, actorUserId, {
    customerId: customer.id,
    staffId: chosenStaff.id,
    serviceId: service.id,
    startTime: requestedStartTime
  });
  const persistedStaff = {
    id: appointment.staffId,
    fullName: appointment.staff.fullName
  };
  const persistedServiceName = getCustomerFacingServiceName(appointment.service.name) ?? appointment.service.name;
  if (persistedStaff.id !== chosenStaff.id) {
    logger.error(
      {
        contactId: normalized.contactId,
        callSessionId: callSession?.id,
        appointmentId: appointment.id,
        confirmationStaffId: chosenStaff.id,
        persistedStaffId: persistedStaff.id,
        confirmationStaffName: chosenStaff.fullName,
        persistedStaffName: persistedStaff.fullName
      },
      "Amazon Connect AI appointment staff mismatch after persistence."
    );
    const message = speak("I need to double-check the technician before I confirm this. Which technician would you like?");
    const parsed = buildInternalParsedIntent({
      intentType: "BOOK_APPOINTMENT",
      customerName: normalized.customerName,
      customerPhone: normalized.customerPhone,
      serviceName: persistedServiceName,
      staffPreference: persistedStaff.fullName,
      requestedDateTime: requestedStartTime.toISOString(),
      missingFields: ["staffPreference"],
      isReadyToBook: false
    });
    const bookingAttempt = await createAttempt({
      status: BookingAttemptStatus.NEEDS_INPUT,
      appointmentId: appointment.id,
      requestedStartTime,
      failureReason: "Persisted appointment staff did not match confirmation snapshot.",
      normalizedRequest: {
        serviceId: appointment.serviceId,
        staffId: persistedStaff.id,
        selectedStaffId: persistedStaff.id,
        confirmedStaffId: chosenStaff.id,
        persistedStaffName: persistedStaff.fullName,
        confirmationStaffName: chosenStaff.fullName,
        customerId: customer.id,
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
        appointmentId: appointment.id,
        confirmationStaffId: chosenStaff.id,
        persistedStaffId: persistedStaff.id,
        staffInvariantMismatch: true
      },
      isValid: false
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
          serviceName: persistedServiceName,
          confirmedServiceName: persistedServiceName,
          staffPreference: undefined,
          staffId: undefined,
          selectedStaffId: undefined,
          confirmedStaffId: undefined,
          confirmedStaffName: undefined,
          lastAskedSlot: "staffPreference",
          askedSlotsCount: "1",
          fallbackCount: "1",
          errorCount: "1",
          awaitingFinalBookingConfirmation: "false",
          bookingConfirmationAsked: "false"
        })
      },
      appointment,
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

  const bookingAttempt = await createAttempt({
    status: BookingAttemptStatus.SUCCESS,
    appointmentId: appointment.id,
    requestedStartTime,
    normalizedRequest: {
      serviceId: appointment.serviceId,
      serviceName: persistedServiceName,
      serviceRecordName: appointment.service.name,
      staffId: persistedStaff.id,
      selectedStaffId: persistedStaff.id,
      confirmedStaffId: persistedStaff.id,
      staffName: persistedStaff.fullName,
      customerId: customer.id,
      startTimeIso: requestedStartTime.toISOString(),
      timezone: salon.timezone
    }
  });
  const message = buildLexMessage({
    outcome: "BOOKED",
    appointmentStartTime: requestedStartTime,
    salonTimezone: salon.timezone,
    serviceName: persistedServiceName,
    staffName: persistedStaff.fullName
  });
  const parsed = buildInternalParsedIntent({
    intentType: "BOOK_APPOINTMENT",
    customerName: normalized.customerName,
    customerPhone: normalized.customerPhone,
    serviceName: persistedServiceName,
    staffPreference: persistedStaff.fullName,
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
        bookingOutcome: "BOOKED",
        serviceName: persistedServiceName,
        confirmedServiceName: persistedServiceName,
        staffPreference: persistedStaff.fullName,
        staffId: persistedStaff.id,
        selectedStaffId: persistedStaff.id,
        confirmedStaffId: persistedStaff.id,
        confirmedStaffName: persistedStaff.fullName,
        aiAlternativeSlots: "[]",
        awaitingAlternativeSelection: "false",
        awaitingFinalBookingConfirmation: "false",
        bookingConfirmationAsked: "false"
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
      messageToCaller: OPERATOR_TRANSFER_PROMPT,
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
          : escalation.messageToCaller ?? OPERATOR_BUSY_PROMPT,
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

  const mappedStaffCandidates = await getMappedActiveBookableStaffForService({
    salonId: input.salonId,
    serviceId: service.id
  });
  const mappedStaffIds = new Set(mappedStaffCandidates.map((staff) => staff.id));
  if (
    staffResolutionForText.status === "matched" &&
    !mappedStaffIds.has(staffResolutionForText.matchedStaff.id)
  ) {
    const updated = await prisma.bookingAttempt.update({
      where: { id: bookingAttempt.id },
      data: {
        status: BookingAttemptStatus.NEEDS_INPUT,
        failureReason: `STAFF_NOT_MAPPED: ${staffResolutionForText.matchedStaff.fullName} is not assigned to ${service.name}.`
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
          resolution: updated.failureReason ?? "Requested staff is not mapped to the selected service."
        }),
        routingOutcome: CallRoutingOutcome.AI_RECEPTION,
        finalResolution: updated.failureReason ?? "Requested staff is not mapped to the selected service.",
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

  const staffCandidates =
    staffResolutionForText.status === "matched"
      ? staffResolutionForText.candidates.filter((staff) => mappedStaffIds.has(staff.id))
      : mappedStaffCandidates;

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

  const mappedStaffCandidates = await getMappedActiveBookableStaffForService({
    salonId: input.salonId,
    serviceId: service.id
  });
  const staffResolution: StaffPreferenceResolution = input.staffName
    ? resolveStaffPreferenceFromCandidates(mappedStaffCandidates, input.staffName)
    : {
        status: "missing" as const,
        candidates: mappedStaffCandidates,
        allStaff: mappedStaffCandidates,
        invalidReason: "missing"
      };
  const staffCandidates =
    staffResolution.status === "ambiguous"
      ? []
      : staffResolution.status === "unmatched_specific" || staffResolution.status === "invalid_noise"
        ? []
        : staffResolution.candidates;
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
  input: { page: number; limit: number } & Omit<AIInteractionFilters, "salonId">
) => {
  const skip = (input.page - 1) * input.limit;
  const where = buildAIInteractionWhere({ ...input, salonId });

  const [items, total] = await Promise.all([
    prisma.aiInteractionLog.findMany({
      where,
      skip,
      take: input.limit,
      orderBy: { createdAt: "desc" },
      include: {
        bookingAttempt: true,
        transcript: true,
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

const toAIInteractionExportItem = (interaction: {
  id: string;
  requestText: string | null;
  responseText: string | null;
  requestPayload: Prisma.JsonValue | null;
  responsePayload: Prisma.JsonValue | null;
  parsedOutput: Prisma.JsonValue | null;
  validationErrors: Prisma.JsonValue | null;
  createdAt: Date;
  taskType: string;
  provider: ExternalProvider;
  model: string | null;
  confidence: number | null;
  bookingAttemptId: string | null;
  callSessionId: string | null;
  interactionKey: string | null;
  isSynthetic: boolean;
  salonId?: string;
  salon?: { id: string; name: string } | null;
  callSession?: {
    id: string;
    providerCallId: string;
    callerPhone: string | null;
  } | null;
}) => ({
  id: interaction.id,
  requestText: interaction.requestText,
  responseText: interaction.responseText,
  requestPayload: interaction.requestPayload,
  responsePayload: interaction.responsePayload,
  parsedOutput: interaction.parsedOutput,
  validationErrors: interaction.validationErrors,
  createdAt: interaction.createdAt,
  taskType: interaction.taskType,
  provider: interaction.provider,
  model: interaction.model,
  confidence: interaction.confidence,
  bookingAttemptId: interaction.bookingAttemptId,
  callSessionId: interaction.callSessionId,
  interactionKey: interaction.interactionKey,
  isSynthetic: interaction.isSynthetic,
  salonId: interaction.salonId,
  salon: interaction.salon ?? undefined,
  callSession: interaction.callSession ?? undefined
});

interface AIInteractionFilters {
  salonId?: string;
  taskType?: string;
  callSessionId?: string;
  contactId?: string;
  callerPhone?: string;
  q?: string;
  includeSynthetic?: boolean;
}

const buildPhoneSearchValues = (value?: string): string[] => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return [];
  }

  const digits = trimmed.replace(/\D/g, "");
  const localDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return Array.from(
    new Set(
      [
        trimmed,
        normalizePhoneForMatching(trimmed),
        digits,
        localDigits,
        digits ? `+${digits}` : undefined,
        localDigits?.length === 10 ? `+1${localDigits}` : undefined,
        localDigits?.length === 10 ? `1${localDigits}` : undefined
      ].filter((candidate): candidate is string => Boolean(candidate))
    )
  );
};

const containsInsensitive = (value: string): Prisma.StringFilter => ({
  contains: value,
  mode: "insensitive"
});

const isUuidLike = (value: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );

const buildAIInteractionWhere = (input: AIInteractionFilters): Prisma.AiInteractionLogWhereInput => {
  const and: Prisma.AiInteractionLogWhereInput[] = [];
  if (input.salonId) {
    and.push({ salonId: input.salonId });
  }
  if (input.taskType) {
    and.push({ taskType: input.taskType });
  }
  if (input.includeSynthetic === false) {
    and.push({
      isSynthetic: false,
      NOT: [
        {
          callSession: {
            is: {
              providerCallId: {
                startsWith: "codex-",
                mode: "insensitive"
              }
            }
          }
        },
        {
          requestPayload: {
            path: ["amazonConnectContactId"],
            string_starts_with: "codex-"
          }
        },
        {
          requestPayload: {
            path: ["contactId"],
            string_starts_with: "codex-"
          }
        },
        {
          requestPayload: {
            path: ["attributes", "AmazonConnectContactId"],
            string_starts_with: "codex-"
          }
        },
        {
          requestPayload: {
            path: ["attributes", "contactId"],
            string_starts_with: "codex-"
          }
        }
      ]
    });
  }

  const searchTerms = [input.q, input.callSessionId, input.contactId]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  const or: Prisma.AiInteractionLogWhereInput[] = [];
  for (const term of searchTerms) {
    if (isUuidLike(term)) {
      or.push(
        { id: term },
        { callSessionId: term },
        { bookingAttemptId: term },
        {
          callSession: {
            is: {
              id: term
            }
          }
        },
        {
          bookingAttempt: {
            is: {
              id: term
            }
          }
        }
      );
    }
    or.push(
      { requestText: containsInsensitive(term) },
      { responseText: containsInsensitive(term) },
      {
        callSession: {
          is: {
            providerCallId: containsInsensitive(term)
          }
        }
      }
    );
  }

  for (const phone of buildPhoneSearchValues(input.callerPhone ?? input.q)) {
    or.push(
      {
        callSession: {
          is: {
            callerPhone: containsInsensitive(phone)
          }
        }
      },
      {
        bookingAttempt: {
          is: {
            customerPhone: containsInsensitive(phone)
          }
        }
      },
      { requestText: containsInsensitive(phone) }
    );
  }

  if (or.length) {
    and.push({ OR: or });
  }

  return and.length ? { AND: and } : {};
};

export const exportAIInteractions = async (
  salonId: string,
  input: Omit<AIInteractionFilters, "salonId"> = {}
) => {
  const where = buildAIInteractionWhere({ ...input, salonId });
  const items = await prisma.aiInteractionLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      callSession: {
        select: {
          id: true,
          providerCallId: true,
          callerPhone: true
        }
      }
    }
  });
  return items.map(toAIInteractionExportItem);
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

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const readNestedRecord = (value: unknown, key: string): Record<string, unknown> => asRecord(asRecord(value)[key]);

const readNestedValue = (value: unknown, path: string[]): unknown =>
  path.reduce<unknown>((current, key) => asRecord(current)[key], value);

const compactValues = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim())
    )
  );

const pickRecordFields = (
  value: unknown,
  fields: string[]
): Record<string, unknown> => {
  const record = asRecord(value);
  return Object.fromEntries(
    fields
      .map((field) => [field, record[field]])
      .filter(([, entry]) => entry !== undefined && entry !== null && String(entry).trim() !== "")
  );
};

const bookingDebugFields = [
  "customerName",
  "customerPhone",
  "serviceName",
  "confirmedServiceName",
  "requestedDate",
  "requestedTime",
  "staffPreference",
  "confirmedStaffName",
  "staffId",
  "selectedStaffId"
];

const buildAdminDebugTimelineItem = (
  interaction: Awaited<ReturnType<typeof prisma.aiInteractionLog.findMany>>[number],
  index: number
) => {
  const requestPayload = asRecord(interaction.requestPayload);
  const responsePayload = asRecord(interaction.responsePayload);
  const parsedOutput = asRecord(interaction.parsedOutput);
  const requestAttributes = readNestedRecord(requestPayload, "attributes");
  const responseDebug = readNestedRecord(responsePayload, "lexTurnDebug");
  const requestDebug = asRecord(requestAttributes.lexTurnDebug);
  const debug = Object.keys(responseDebug).length ? responseDebug : requestDebug;
  const sanitization = asRecord(debug.sanitization);
  const lexResponse = readNestedRecord(responsePayload, "lexResponse");
  const dialogAction = readNestedRecord(lexResponse, "dialogAction");
  const sessionAttributesBefore = debug.attributesBefore ?? debug.sessionAttributesBefore;
  const sessionAttributesAfter =
    debug.attributesAfter ?? responsePayload.sessionAttributes ?? lexResponse.sessionAttributes;
  const amazonConnectContactId =
    requestPayload.amazonConnectContactId ??
    requestPayload.contactId ??
    requestAttributes.amazonConnectContactId ??
    requestAttributes.AmazonConnectContactId ??
    debug.contactId;
  const slotToElicit = debug.slotToElicit ?? responsePayload.slotToElicit ?? dialogAction.slotToElicit;
  const inferredDialogAction =
    Object.keys(dialogAction).length
      ? dialogAction
      : slotToElicit
        ? { type: "ElicitSlot", slotToElicit }
        : responsePayload.transferToQueue === "true"
          ? { type: "Close" }
          : undefined;

  return {
    index,
    aiInteractionId: interaction.id,
    createdAt: interaction.createdAt,
    currentTurnTranscript:
      responsePayload.currentTurnTranscript ??
      debug.currentTurnTranscript ??
      debug.inputTranscript ??
      requestPayload.currentTurnTranscript ??
      requestPayload.text,
    aggregatedTranscript:
      responsePayload.aggregatedBookingTranscript ??
      requestPayload.aggregatedBookingTranscript ??
      requestPayload.transcript ??
      interaction.requestText,
    aggregatedRequestText:
      responsePayload.aggregatedBookingTranscript ??
      requestPayload.aggregatedBookingTranscript ??
      requestPayload.transcript ??
      interaction.requestText,
    requestText: interaction.requestText,
    responseText: interaction.responseText,
    contactId: amazonConnectContactId,
    internalCallSessionId: interaction.callSessionId ?? requestPayload.callSessionId,
    amazonConnectContactId,
    intentName: requestPayload.intentName ?? debug.intentName,
    inputMode: debug.inputMode ?? requestPayload.inputMode,
    lastAskedSlotBefore:
      debug.lastAskedSlotBefore ?? asRecord(sessionAttributesBefore).lastAskedSlot ?? requestAttributes.lastAskedSlot,
    lastAskedSlotAfter:
      asRecord(sessionAttributesAfter).lastAskedSlot ??
      asRecord(responsePayload.sessionAttributes).lastAskedSlot ??
      asRecord(lexResponse.sessionAttributes).lastAskedSlot,
    activeDtmfMenuBefore:
      debug.activeDtmfMenuBefore ?? asRecord(sessionAttributesBefore).activeDtmfMenu,
    activeDtmfMenuAfter:
      asRecord(sessionAttributesAfter).activeDtmfMenu ??
      asRecord(responsePayload.sessionAttributes).activeDtmfMenu ??
      asRecord(lexResponse.sessionAttributes).activeDtmfMenu,
    activeDtmfOptionsBefore:
      debug.activeDtmfOptionsBefore ??
      parseDtmfOptionsForHistory(asRecord(sessionAttributesBefore).activeDtmfOptionsJson),
    activeDtmfOptionsAfter:
      debug.activeDtmfOptionsAfter ??
      parseDtmfOptionsForHistory(
        asRecord(sessionAttributesAfter).activeDtmfOptionsJson ??
          asRecord(responsePayload.sessionAttributes).activeDtmfOptionsJson ??
          asRecord(lexResponse.sessionAttributes).activeDtmfOptionsJson
      ),
    dtmfDiagnostics: debug.dtmfDiagnostics,
    dtmfRouting: debug.dtmfRouting,
    slotDecisions: debug.slotDecisions ?? responsePayload.slotDecision,
    slotsOriginalValues: debug.slotsOriginalValues,
    slotsInterpretedValues: debug.slotsInterpretedValues,
    trustedSlotsBefore:
      debug.trustedSlotsBefore ?? pickRecordFields(sessionAttributesBefore, bookingDebugFields),
    trustedSlotsAfter:
      debug.trustedSlotsAfter ?? pickRecordFields(sessionAttributesAfter, bookingDebugFields),
    ignoredUngroundedSlots: sanitization.ignoredUngroundedSlots ?? responsePayload.ignoredUngroundedSlots,
    ignoredPollutedSlots: sanitization.ignoredPollutedSlots ?? responsePayload.ignoredPollutedSlots,
    ignoredNoiseFields: sanitization.ignoredNoiseFields ?? responsePayload.ignoredNoiseFields,
    sessionAttributesBefore,
    sessionAttributesAfter,
    dialogAction: inferredDialogAction,
    slotToElicit,
    missingFields: responsePayload.missingFields ?? readNestedValue(parsedOutput, ["parsed", "missingFields"]),
    promptMissingFields: responsePayload.promptMissingFields,
    fallbackCount:
      asRecord(sessionAttributesAfter).fallbackCount ??
      asRecord(responsePayload.sessionAttributes).fallbackCount ??
      asRecord(lexResponse.sessionAttributes).fallbackCount,
    errorCount:
      asRecord(sessionAttributesAfter).errorCount ??
      asRecord(responsePayload.sessionAttributes).errorCount ??
      asRecord(lexResponse.sessionAttributes).errorCount,
    askedSlotsCount:
      asRecord(sessionAttributesAfter).askedSlotsCount ??
      asRecord(responsePayload.sessionAttributes).askedSlotsCount ??
      asRecord(lexResponse.sessionAttributes).askedSlotsCount,
    transferToQueue:
      asRecord(sessionAttributesAfter).transferToQueue ??
      asRecord(responsePayload.sessionAttributes).transferToQueue ??
      asRecord(lexResponse.sessionAttributes).transferToQueue,
    forceHumanEscalation:
      asRecord(sessionAttributesAfter).forceHumanEscalation ??
      asRecord(responsePayload.sessionAttributes).forceHumanEscalation ??
      asRecord(lexResponse.sessionAttributes).forceHumanEscalation,
    escalationReason:
      asRecord(sessionAttributesAfter).escalationReason ??
      asRecord(responsePayload.sessionAttributes).escalationReason ??
      asRecord(lexResponse.sessionAttributes).escalationReason,
    turnStateDiagnostics: responsePayload.turnStateDiagnostics
  };
};

export const buildAdminDebugTimelineItems = (
  interaction: Awaited<ReturnType<typeof prisma.aiInteractionLog.findMany>>[number],
  index: number
): Array<Record<string, unknown>> => {
  const responsePayload = asRecord(interaction.responsePayload);
  const turnHistory = Array.isArray(responsePayload.turnHistory)
    ? responsePayload.turnHistory.map((turn) => asRecord(turn))
    : [];
  if (!turnHistory.length) {
    return [buildAdminDebugTimelineItem(interaction, index)];
  }

  return turnHistory.map((turn, turnIndex): Record<string, unknown> => {
    const sessionAttributesBefore = turn.sessionAttributesBefore;
    const sessionAttributesAfter = turn.sessionAttributesAfter;
    const turnCreatedAt =
      typeof turn.createdAt === "string" && !Number.isNaN(new Date(turn.createdAt).getTime())
        ? new Date(turn.createdAt)
        : interaction.createdAt;
    return {
      index: Number(turn.index ?? turnIndex + 1) - 1,
      aiInteractionId: interaction.id,
      createdAt: turnCreatedAt,
      currentTurnTranscript: turn.currentTurnTranscript,
      aggregatedTranscript:
        typeof turn.aggregatedBookingTranscript === "string"
          ? turn.aggregatedBookingTranscript
          : undefined,
      aggregatedRequestText:
        typeof turn.aggregatedBookingTranscript === "string"
          ? turn.aggregatedBookingTranscript
          : undefined,
      requestText: undefined,
      responseText:
        typeof turn.responseText === "string" ? turn.responseText : undefined,
      contactId: turn.contactId,
      internalCallSessionId: interaction.callSessionId,
      amazonConnectContactId: turn.contactId,
      intentName: turn.intentName,
      inputMode: turn.inputMode,
      lastAskedSlotBefore: turn.lastAskedSlotBefore,
      lastAskedSlotAfter: turn.lastAskedSlotAfter,
      activeDtmfMenuBefore: turn.activeDtmfMenuBefore,
      activeDtmfMenuAfter: turn.activeDtmfMenuAfter,
      activeDtmfOptionsBefore: recordFromUnknown(turn.activeDtmfOptionsBefore),
      activeDtmfOptionsAfter: recordFromUnknown(turn.activeDtmfOptionsAfter),
      dtmfRouting: turn.dtmfRouting,
      slotsOriginalValues: turn.slotsOriginalValues,
      slotsInterpretedValues: turn.slotsInterpretedValues,
      trustedSlotsBefore: recordFromUnknown(turn.trustedSlotsBefore),
      trustedSlotsAfter: recordFromUnknown(turn.trustedSlotsAfter),
      ignoredUngroundedSlots: turn.ignoredUngroundedSlots,
      ignoredPollutedSlots: turn.ignoredPollutedSlots,
      ignoredNoiseFields: turn.ignoredNoiseFields,
      sessionAttributesBefore,
      sessionAttributesAfter,
      dtmfDiagnostics: turn.dtmfDiagnostics,
      slotDecisions: turn.slotDecisions,
      slotToElicit: turn.slotToElicit,
      missingFields: turn.missingFields,
      promptMissingFields: turn.promptMissingFields,
      providerTranscriptTimestamp: turn.providerTranscriptTimestamp,
      lambdaReceivedAt: turn.lambdaReceivedAt,
      apiStartedAt: turn.apiStartedAt,
      apiCompletedAt: turn.apiCompletedAt,
      lambdaRespondedAt: turn.lambdaRespondedAt,
      lambdaProcessingMs: turn.lambdaProcessingMs,
      apiProcessingMs: turn.apiProcessingMs,
	      connectBranch: turn.connectBranch,
	      promptText: turn.promptText,
	      promptExpectedToPlay: turn.promptExpectedToPlay,
	      promptPlaybackConfirmed: turn.promptPlaybackConfirmed,
	      playbackEvidenceStage: turn.playbackEvidenceStage,
	      lambdaResponseFingerprint: turn.lambdaResponseFingerprint,
	      dialogActionType: turn.dialogActionType,
	      messageContentType: turn.messageContentType,
	      ssmlValidation: turn.ssmlValidation,
	      providerDisconnectedAt: turn.providerDisconnectedAt,
      transferToQueue: turn.transferToQueue,
      forceHumanEscalation: turn.forceHumanEscalation,
      fallbackCount: turn.fallbackCount,
      errorCount: turn.errorCount,
      askedSlotsCount: turn.askedSlotsCount,
      escalationReason: turn.escalationReason,
      dialogAction: turn.dialogAction,
      turnStateDiagnostics: turn.turnStateDiagnostics
    };
  });
};

export const buildAIInteractionCallDebugForAdminPayload = (
  interaction: any,
  callSession: any | null
) => {
  if (!interaction) {
    throw new AppError("AI interaction log not found.", 404, "AI_INTERACTION_NOT_FOUND");
  }

  const aiInteractions: any[] = callSession?.aiInteractions ?? [interaction];
  const contactIds = compactValues([
    callSession?.providerCallId,
    ...aiInteractions.flatMap((item: any) => {
      const requestPayload = asRecord(item.requestPayload);
      const responsePayload = asRecord(item.responsePayload);
      const requestAttributes = readNestedRecord(requestPayload, "attributes");
      return [
        requestPayload.amazonConnectContactId,
        requestPayload.contactId,
        requestAttributes.amazonConnectContactId,
        requestAttributes.AmazonConnectContactId,
        requestAttributes.contactId,
        readNestedValue(responsePayload, ["lexTurnDebug", "contactId"])
      ];
    })
  ]);
  const turnHistories = aiInteractions.flatMap((item: any, index: number) =>
    buildAdminDebugTimelineItems(item, index)
  );

  return {
    callSession,
    aiInteractions,
    bookingAttempts:
      callSession?.bookingAttempts ?? (interaction.bookingAttempt ? [interaction.bookingAttempt] : []),
    transcripts: callSession?.transcripts ?? (interaction.transcript ? [interaction.transcript] : []),
    events: callSession?.events ?? [],
    escalationRecords: callSession?.callEscalations ?? [],
    finalResolution: callSession?.finalResolution ?? null,
    contactIds,
    callerPhone: callSession?.callerPhone ?? interaction.bookingAttempt?.customerPhone ?? null,
    calledNumber: callSession?.dialedPhone ?? callSession?.trackingNumber ?? null,
    turnHistories
  };
};

const redactReleaseEvidenceValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    const phoneRedacted = value.replace(/\+?\d[\d\s().-]{7,}\d/g, (match) => {
      const digits = match.replace(/\D/g, "");
      return digits.length >= 8 ? `[redacted-phone:${createHash("sha256").update(digits).digest("hex").slice(0, 12)}]` : match;
    });
    return phoneRedacted;
  }
  if (Array.isArray(value)) {
    return value.map(redactReleaseEvidenceValue);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
        const lowerKey = key.toLowerCase();
        if (/(phone|caller|customerphone|number)$/.test(lowerKey)) {
          return [key, redactReleaseEvidenceValue(String(entry ?? ""))];
        }
        return [key, redactReleaseEvidenceValue(entry)];
      })
    );
  }
  return value;
};

const collectReleaseIdentitiesFromDebug = (debug: ReturnType<typeof buildAIInteractionCallDebugForAdminPayload>) => {
  const identities = new Map<string, Record<string, unknown>>();
  const addIdentity = (value: unknown) => {
    const record = recordFromUnknown(value);
    const releaseIdentity = recordFromUnknown(record.releaseIdentity);
    const merged = {
      ...record,
      ...releaseIdentity
    };
    const relevant = Object.fromEntries(
      Object.entries(merged).filter(([key, entry]) => key.startsWith("VOICE_") && entry !== undefined && entry !== null && String(entry).trim() !== "")
    );
    if (Object.keys(relevant).length) {
      identities.set(sha256JsonForEvidence(relevant), relevant);
    }
  };
  for (const item of debug.aiInteractions ?? []) {
    addIdentity(item.requestPayload);
    addIdentity(recordFromUnknown(item.requestPayload).attributes);
    addIdentity(item.responsePayload);
    addIdentity(recordFromUnknown(item.responsePayload).sessionAttributes);
    addIdentity(recordFromUnknown(item.responsePayload).turnStateDiagnostics);
  }
  for (const attempt of debug.bookingAttempts ?? []) {
    addIdentity(attempt.normalizedRequest);
    addIdentity(attempt.rawInput);
  }
  for (const turn of debug.turnHistories ?? []) {
    addIdentity(turn.turnStateDiagnostics);
    addIdentity(turn.sessionAttributesAfter);
  }
  return Array.from(identities.values());
};

const sha256JsonForEvidence = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export const getAmazonConnectReleaseEvidenceForInternal = async (contactId: string) => {
  const trimmedContactId = contactId.trim();
  const callSession = await prisma.callSession.findUnique({
    where: {
      provider_providerCallId: {
        provider: ExternalProvider.AMAZON_CONNECT,
        providerCallId: trimmedContactId
      }
    },
    include: {
      events: {
        orderBy: { receivedAt: "asc" }
      },
      transcripts: {
        orderBy: { createdAt: "asc" }
      },
      bookingAttempts: {
        orderBy: { createdAt: "asc" },
        include: {
          appointment: true
        }
      },
      aiInteractions: {
        orderBy: { createdAt: "asc" }
      },
      callEscalations: {
        orderBy: { createdAt: "asc" }
      }
    }
  });
  const fallbackInteraction = callSession
    ? null
    : await prisma.aiInteractionLog.findFirst({
        where: {
          OR: [
            {
              requestPayload: {
                path: ["amazonConnectContactId"],
                equals: trimmedContactId
              }
            },
            {
              requestPayload: {
                path: ["contactId"],
                equals: trimmedContactId
              }
            },
            {
              requestPayload: {
                path: ["attributes", "AmazonConnectContactId"],
                equals: trimmedContactId
              }
            }
          ]
        },
        orderBy: { createdAt: "desc" },
        include: {
          callSession: true,
          bookingAttempt: true,
          transcript: true
        }
      });
  if (!callSession && !fallbackInteraction) {
    throw new AppError("Release evidence contact was not found.", 404, "RELEASE_EVIDENCE_NOT_FOUND");
  }

  const debug = buildAIInteractionCallDebugForAdminPayload(
    fallbackInteraction ?? callSession!.aiInteractions[0] ?? { id: "missing", bookingAttempt: null },
    callSession
  );
  const appointmentRecords = (debug.bookingAttempts ?? [])
    .map((attempt: any) => ({
      bookingAttemptId: attempt.id,
      appointmentId: attempt.appointmentId ?? attempt.appointment?.id ?? null,
      status: attempt.status,
      appointmentStatus: attempt.appointment?.status ?? null,
      createdAt: attempt.createdAt,
      releaseIdentity: recordFromUnknown(attempt.normalizedRequest).releaseIdentity ?? null
    }))
    .filter((item: { appointmentId: string | null }) => Boolean(item.appointmentId));
  const redactedDebug = redactReleaseEvidenceValue(debug);
  return {
    contactId: trimmedContactId,
    exportedAt: new Date().toISOString(),
    found: true,
    releaseIdentities: collectReleaseIdentitiesFromDebug(debug),
    appointmentRecords,
    activeTestAppointmentCount: appointmentRecords.filter(
      (item: { appointmentStatus: string | null }) => item.appointmentStatus && item.appointmentStatus !== AppointmentStatus.CANCELED
    ).length,
    debug: redactedDebug
  };
};

export const getAIInteractionCallDebugForAdmin = async (interactionId: string) => {
  const interaction = await prisma.aiInteractionLog.findUnique({
    where: { id: interactionId },
    include: {
      callSession: true,
      bookingAttempt: true,
      transcript: true,
      salon: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });
  if (!interaction) {
    throw new AppError("AI interaction log not found.", 404, "AI_INTERACTION_NOT_FOUND");
  }

  const callSessionId = interaction.callSessionId ?? interaction.bookingAttempt?.callSessionId;
  const callSession = callSessionId
    ? await prisma.callSession.findUnique({
        where: { id: callSessionId },
        include: {
          events: {
            orderBy: { receivedAt: "asc" }
          },
          transcripts: {
            orderBy: { createdAt: "asc" }
          },
          bookingAttempts: {
            orderBy: { createdAt: "asc" }
          },
          aiInteractions: {
            orderBy: { createdAt: "asc" }
          },
          callEscalations: {
            orderBy: { createdAt: "asc" }
          }
        }
      })
    : null;

  return buildAIInteractionCallDebugForAdminPayload(interaction, callSession);
};

const getAIInteractionCanonicalKey = (interaction: {
  id: string;
  callSessionId: string | null;
  interactionKey: string | null;
  callSession?: {
    id: string;
    providerCallId: string | null;
  } | null;
  requestPayload?: Prisma.JsonValue | null;
  responsePayload?: Prisma.JsonValue | null;
}): string => {
  if (interaction.callSessionId) {
    return `call:${interaction.callSessionId}`;
  }
  if (interaction.callSession?.id) {
    return `call:${interaction.callSession.id}`;
  }
  if (interaction.callSession?.providerCallId) {
    return `provider:${interaction.callSession.providerCallId}`;
  }
  const requestPayload = recordFromUnknown(interaction.requestPayload);
  const responsePayload = recordFromUnknown(interaction.responsePayload);
  const requestAttributes = recordFromUnknown(requestPayload.attributes);
  const responseDebug = recordFromUnknown(responsePayload.lexTurnDebug);
  const contactId =
    asTrimmedString(requestPayload.amazonConnectContactId) ??
    asTrimmedString(requestPayload.contactId) ??
    asTrimmedString(requestAttributes.AmazonConnectContactId) ??
    asTrimmedString(requestAttributes.amazonConnectContactId) ??
    asTrimmedString(responseDebug.contactId);
  if (contactId) {
    return `provider:${contactId}`;
  }
  return `interaction:${interaction.interactionKey ?? interaction.id}`;
};

const canonicalizeAIInteractions = <T extends {
  id: string;
  callSessionId: string | null;
  interactionKey: string | null;
  createdAt: Date;
  callSession?: {
    id: string;
    providerCallId: string | null;
  } | null;
  requestPayload?: Prisma.JsonValue | null;
  responsePayload?: Prisma.JsonValue | null;
}>(items: T[]): T[] => {
  const grouped = new Map<string, T>();
  for (const item of items) {
    const key = getAIInteractionCanonicalKey(item);
    const current = grouped.get(key);
    if (!current || item.createdAt > current.createdAt) {
      grouped.set(key, item);
    }
  }
  return Array.from(grouped.values()).sort(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime()
  );
};

export const listAIInteractionsForAdmin = async (input: {
  page: number;
  limit: number;
  salonId?: string;
  taskType?: string;
  callSessionId?: string;
  contactId?: string;
  callerPhone?: string;
  q?: string;
  includeSynthetic?: boolean;
}) => {
  const skip = (input.page - 1) * input.limit;
  const where = buildAIInteractionWhere(input);

  const rawItems = await prisma.aiInteractionLog.findMany({
    where,
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
  });
  const canonicalItems = canonicalizeAIInteractions(rawItems);
  const items = canonicalItems.slice(skip, skip + input.limit);

  return {
    items,
    pagination: {
      page: input.page,
      limit: input.limit,
      total: canonicalItems.length
    }
  };
};

export const exportAIInteractionsForAdmin = async (input: {
  salonId?: string;
  taskType?: string;
  callSessionId?: string;
  contactId?: string;
  callerPhone?: string;
  q?: string;
  includeSynthetic?: boolean;
} = {}) => {
  const where = buildAIInteractionWhere(input);
  const items = await prisma.aiInteractionLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      salon: {
        select: {
          id: true,
          name: true
        }
      },
      callSession: {
        select: {
          id: true,
          providerCallId: true,
          callerPhone: true
        }
      }
    }
  });
  return canonicalizeAIInteractions(items).map(toAIInteractionExportItem);
};
