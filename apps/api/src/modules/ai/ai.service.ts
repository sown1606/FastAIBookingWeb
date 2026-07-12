import { createHash } from "crypto";
import { DateTime } from "luxon";
import {
  AppointmentStatus,
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

type ServiceMenuCandidate = {
  id: string;
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
    "toe pedicure"
  ],
  manicure: [
    "many cure",
    "manny cure",
    "mani cure",
    "nanny cure",
    "mini cure",
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
    "phone set",
    "room set",
    "pull set",
    "pull step",
    "pool set",
    "food set",
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
    "full send",
    "fo set",
    "fuel set",
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

const DATE_PHRASE_PATTERN =
  "\\b(?:tomorrow\\s+(?:morning|afternoon|evening|night)|this\\s+(?:morning|afternoon|evening)|tonight|today|tomorrow|(?:this|next)\\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\\b";

const SPOKEN_HOUR_PATTERN =
  "one|two|three|tree|tri|four|five|fife|six|seven|eight|nine|ten|eleven|twelve";

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
  "any staff",
  "any technician",
  "any tech",
  "no preference",
  "no staff preference",
  "no specific staff",
  "first available",
  "someone available",
  "whoever is available",
  "whoever s available",
  "whoever's available",
  "who is available"
]);

const SERVICE_DTMF_OPTIONS: Record<string, string> = {
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
const SERVICE_DTMF_PROMPT =
  "Hi, thanks for calling Kiet Nails. How can I help? You can say the service, day, time, and technician in one sentence. Press 0 for a person.";
const SERVICE_DTMF_OPTIONS_PROMPT =
  "I can list the services once. Please say the service name, or press 0 for a person.";
const SERVICE_FIRST_RETRY_PROMPT = "Sure. Which service would you like?";
const STAFF_DTMF_PROMPT =
  "Which staff would you like, Trang, Amy, Kelly, or first available?";

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

const extractCustomerNameFromText = (text?: string): string | undefined => {
  const match = text?.match(
    /(?:my name is|name is|this is|i am|i'm|you can call me)\s+(\p{L}[\p{L}'-]*(?:\s+\p{L}[\p{L}'-]*){0,4})(?=\s*(?:[,.!?;]|$|and\s+(?:my\s+)?phone|(?:my\s+)?phone\s+(?:number\s+)?(?:is|should|to)))/iu
  );
  const name = collapseSpokenNameSpelling(match?.[1]);
  return isAcceptableCustomerName(name) ? name : undefined;
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
  return /^(yes|yeah|yep|correct|right|that is right|that's right|sure|ok|okay)$/i.test(
    normalizeForMatch(value)
  );
};

const isNegative = (value?: string | null): boolean => {
  return /^(no|nope|not that|wrong)$/i.test(normalizeForMatch(value));
};

type FinalBookingConfirmationOutcome = "AFFIRMED" | "DENIED" | "CHANGE_REQUEST" | "UNKNOWN";

const hasStaticServiceAliasInText = (value?: string | null): boolean => {
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

const classifyFinalBookingConfirmation = (
  value?: string | null,
  options: { hasExplicitStaffChange?: boolean } = {}
): FinalBookingConfirmationOutcome => {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return "UNKNOWN";
  }
  if (/^(?:ok|okay)$/.test(normalized)) {
    return "UNKNOWN";
  }

  const hasChangeRequest =
    /\b(?:change|make it|instead|switch|move it|can we do|could we do|actually)\b/.test(normalized);
  const hasStaffChangeRequest =
    /\b(?:change|switch)\s+(?:the\s+)?(?:person|staff|technician|tech)\b/.test(normalized) ||
    /\b(?:someone else|different person|different staff|different technician|different tech)\b/.test(normalized) ||
    /\bnot\s+(?!correct\b|right\b|book\b|it\b|that\b)[a-z][a-z\s'-]{1,40}\b/.test(normalized) ||
    /\bwith\s+[a-z][a-z\s'-]{1,40}\s+instead\b/.test(normalized);
  const hasNewBookingValue =
    hasStaticServiceAliasInText(value) ||
    new RegExp(DATE_PHRASE_PATTERN, "i").test(value ?? "") ||
    Boolean(extractTimeCandidate(value ?? "")) ||
    Boolean(options.hasExplicitStaffChange);
  const hasExplicitNegation =
    /\b(?:no|nope|nah|wrong|not correct|not right|do not|don t|dont|cancel it|wait no)\b/.test(normalized);
  const hasAffirmation =
    /\b(?:yes|yeah|yep|correct|right|sure|ok|okay)\b/.test(normalized) ||
    /\b(?:that s right|that is right|sounds good|that s fine|that is fine|go ahead|please book it|book it|confirm it)\b/.test(
      normalized
    );

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
  if (/^(?:zero|press zero|pressed zero)$/i.test(trimmed)) {
    return "0";
  }
  const normalized = normalizeForMatch(trimmed);
  const spokenDigitMatch = normalized.match(
    /^(?:(?:number|option|press|pressed)\s+)?(one|two|three|tree|tri|four|five|six|seven|eight|nine)$/
  );
  if (spokenDigitMatch?.[1]) {
    return String(NUMBER_WORDS[spokenDigitMatch[1]] ?? "");
  }
  const match = trimmed.match(/^(?:dtmf\s*)?([0-9]{1,2})#?$/i);
  return match?.[1];
};

const readScopedDtmfSelection = (
  isScoped: boolean,
  values: Array<string | undefined>,
  options: Record<string, string>
): string | undefined => {
  if (!isScoped) {
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

const isAnyStaffPreference = (value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  return Boolean(normalized && ANY_STAFF_PHRASES.has(normalized));
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
  return Object.keys(dynamicOptions).length ? dynamicOptions : STAFF_DTMF_OPTIONS;
};

const readStaffDtmfStaffIds = (
  attributes: Record<string, unknown> | undefined
): Record<string, string> => {
  return parseJsonStringRecord(
    readStringAttribute(attributes, ["staffDtmfStaffIds", "staffDtmfOptionStaffIds"])
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

const isReusableCallerName = (value?: string | null): value is string => {
  return Boolean(extractBareCustomerNameAnswer(value));
};

const STAFF_ALIAS_PHRASES: Record<string, string[]> = {
  trang: ["trang", "chang", "train", "trangg"],
  amy: ["amy", "amie", "emmy", "emmie", "a me"],
  kelly: ["kelly", "kelley", "keli", "ke li"]
};

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

const isNegatedStaffAlias = (normalizedText: string, matchIndex: number): boolean => {
  const before = normalizedText.slice(0, matchIndex).trim();
  return /\bnot(?:\s+(?:the|that|this|one|staff|technician|tech))?$/.test(before);
};

const normalizeScopedStaffCandidatePhrase = (value?: string | null): string | undefined => {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return undefined;
  }
  if (isAnyStaffPreference(normalized)) {
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
  if (Array.from(ANY_STAFF_PHRASES).some((phrase) => textContainsStaffAlias(normalized, phrase))) {
    return "any staff";
  }

  let candidate = normalized
    .replace(/\b(?:technician|tech|staff|please|actually|instead)\b/g, " ")
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
      /\b(?:with|book|use|i|want|to|said|change|switch|it|instead|no|please|actually|technician|staff|tech|the|a|an)\b/g,
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
    new RegExp(DATE_PHRASE_PATTERN, "i").test(candidate) ||
    Boolean(extractTimeCandidate(candidate))
  ) {
    return undefined;
  }
  return candidate;
};

const hasExplicitStaffPhrase = (value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  return Boolean(
    normalized &&
      (normalizeScopedStaffCandidatePhrase(value) ||
        /\bnot\s+(?!today\b|tomorrow\b|monday\b|tuesday\b|wednesday\b|thursday\b|friday\b|saturday\b|sunday\b|correct\b|right\b|book\b|it\b|that\b|this\b)[a-z][a-z'-]{1,40}\b/.test(normalized))
  );
};

const hasStaffCuePhrase = (value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  return Boolean(
    normalized &&
      (/\b(?:with|use|i said|technician|staff|tech)\b/.test(normalized) ||
        /\b(?:change|switch)(?:\s+it)?\s+to\b/.test(normalized) ||
        /\b(?:no\s+)?i\s+want(?:\s+to\s+book)?\b/.test(normalized) ||
        /\binstead\b/.test(normalized) ||
        /\bnot\s+(?!today\b|tomorrow\b|monday\b|tuesday\b|wednesday\b|thursday\b|friday\b|saturday\b|sunday\b|correct\b|right\b|book\b|it\b|that\b|this\b)[a-z][a-z'-]{1,40}\b/.test(normalized))
  );
};

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

  const now = DateTime.now().setZone(timezone);
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

const parseLocalDateText = (value: string, timezone: string): DateTime | null => {
  const cleaned = normalizeForMatch(value);
  const now = DateTime.now().setZone(timezone);

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

  const weekdayMatch = cleaned.match(
    /^(?:(this|next)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/
  );
  const weekday = weekdayMatch ? WEEKDAY_INDEXES[weekdayMatch[2]!] : WEEKDAY_INDEXES[cleaned];
  if (weekday) {
    let daysUntil = weekday - now.weekday;
    if (daysUntil < 0 || (daysUntil === 0 && weekdayMatch?.[1] === "next")) {
      daysUntil += 7;
    }
    return now.plus({ days: daysUntil }).startOf("day");
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

const parseLocalTimeText = (value: string): { hour: number; minute: number; ambiguous: boolean } | null => {
  const normalized = normalizeSpokenNumbers(value)
    .replace(/\b([ap])\s*\.?\s*m\.?\b/gi, "$1m")
    .replace(/\ba\.?m\.?\b/gi, "am")
    .replace(/\bp\.?m\.?\b/gi, "pm")
    .trim();
  const normalizedWords = normalizeForMatch(normalized);
  const hasMorningContext = /\bmorning\b/.test(normalizedWords);
  const hasAfternoonContext = /\b(afternoon|evening|tonight|night)\b/.test(normalizedWords);

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
    return { hour, minute, ambiguous: false };
  }

  const applyContext = (hour: number): { hour: number; ambiguous: boolean } => {
    if (hasMorningContext) {
      return { hour: hour === 12 ? 0 : hour, ambiguous: false };
    }
    if (hasAfternoonContext) {
      return { hour: hour < 12 ? hour + 12 : hour, ambiguous: false };
    }
    if (hour >= 1 && hour <= 7) {
      return { hour: hour + 12, ambiguous: false };
    }
    return { hour, ambiguous: true };
  };

  const bareHourMatch = normalized.match(/\b(\d{1,2})\b/);
  if (bareHourMatch) {
    const hour = Number(bareHourMatch[1]);
    if (hour >= 1 && hour <= 12) {
      const contextual = applyContext(hour);
      return { hour: contextual.hour, minute: 0, ambiguous: contextual.ambiguous };
    }
    if (hour >= 13 && hour <= 23) {
      return { hour, minute: 0, ambiguous: false };
    }
  }

  return null;
};

const extractTimeCandidate = (value: string): string | undefined => {
  const source = value
    .replace(/\b([ap])\s*\.?\s*m\.?\b/gi, "$1m")
    .trim();
  const searchable = source.replace(/^\s*(?:at|around|about|for|by)\s+/i, "");
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

  const markedBareMatch = searchable.match(
    new RegExp(
      `\\b(?:at|around|about|for|by)\\s+((?:${SPOKEN_HOUR_PATTERN}|\\d{1,2})(?::\\d{2})?)\\b`,
      "i"
    )
  );
  if (markedBareMatch?.[1]) {
    return markedBareMatch[1];
  }

  if (!segment) {
    return undefined;
  }

  const leadingBareMatch = segment.match(
    new RegExp(`^\\s*((?:${SPOKEN_HOUR_PATTERN}|\\d{1,2})(?::\\d{2})?)\\b`, "i")
  );
  return leadingBareMatch?.[1];
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

  const explicitMatches = [
    ...collect(ISO_DATE_PATTERN, "explicit"),
    ...collect(MONTH_DAY_PATTERN, "explicit")
  ].sort((left, right) => left.index - right.index);
  if (explicitMatches.length) {
    return explicitMatches[explicitMatches.length - 1] ?? null;
  }

  const relativeMatches = collect(DATE_PHRASE_PATTERN, "relative").sort(
    (left, right) => left.index - right.index
  );
  return relativeMatches[0] ?? null;
};

const hasGroundedDatePhrase = (value?: string | null): boolean =>
  Boolean(value?.trim() && getPreferredDateCandidate(value));

const hasGroundedTimePhrase = (value?: string | null): boolean => {
  if (!value?.trim() || isDigitOnlyOrSequenceUtterance(value)) {
    return false;
  }
  const timeCandidate = extractTimeCandidate(value);
  const parsed = timeCandidate ? parseLocalTimeText(timeCandidate) : null;
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

const extractExplicitTime = (value: string | undefined): string | undefined => {
  if (!value?.trim() || isDigitOnlyOrSequenceUtterance(value)) {
    return undefined;
  }
  const timeCandidate = extractTimeCandidate(value);
  const parsed = timeCandidate ? parseLocalTimeText(timeCandidate) : null;
  if (!parsed || parsed.ambiguous) {
    return undefined;
  }
  return `${String(parsed.hour).padStart(2, "0")}:${String(parsed.minute).padStart(2, "0")}`;
};

const rejectsMentionedDate = (value?: string | null): boolean => {
  const normalized = normalizeForMatch(value);
  return /\b(?:not\s+on|no|not)\s+(?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(
    normalized
  );
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

  const dateCandidate = getPreferredDateCandidate(raw);
  if (dateCandidate) {
    const localDate = parseLocalDateText(dateCandidate.text, timezone);
    const afterDate = raw.slice(dateCandidate.index + dateCandidate.text.length);
    const beforeDate = raw.slice(0, dateCandidate.index);
    const timeCandidate =
      extractTimeCandidate(afterDate) ??
      extractTimeCandidate(beforeDate.split(/[!?;]/).at(-1) ?? "") ??
      extractTimeCandidate(raw);
    const localTime = timeCandidate
      ? parseLocalTimeText(`${dateCandidate.text} ${timeCandidate}`)
      : null;

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
  confidence?: number;
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
    trustedSlotsAfter: responseDebug.trustedSlotsAfter ?? null,
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
	    isValid: input.interactionInput.isValid,
	    transferToQueue:
      sessionAttributesAfter.transferToQueue ?? responsePayload.transferToQueue ?? null,
    forceHumanEscalation:
      sessionAttributesAfter.forceHumanEscalation ?? responsePayload.forceHumanEscalation ?? null
  };
  return {
    idempotencyKey: stableHash({
      interactionKey: input.interactionKey,
      currentTurnTranscript: turn.currentTurnTranscript,
      intentName: turn.intentName,
      inputMode: turn.inputMode,
      lastAskedSlotBefore: turn.lastAskedSlotBefore,
      activeDtmfMenuBefore: turn.activeDtmfMenuBefore,
      slotToElicit: turn.slotToElicit,
      serviceNameAfter: recordFromUnknown(turn.sessionAttributesAfter).serviceName,
      confirmedServiceNameAfter: recordFromUnknown(turn.sessionAttributesAfter).confirmedServiceName,
      requestedDateAfter: recordFromUnknown(turn.sessionAttributesAfter).requestedDate,
      requestedTimeAfter: recordFromUnknown(turn.sessionAttributesAfter).requestedTime,
      staffPreferenceAfter: recordFromUnknown(turn.sessionAttributesAfter).staffPreference,
      customerNameAfter: recordFromUnknown(turn.sessionAttributesAfter).customerName,
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
  const serviceLooksLikePrincess = normalizeForMatch(serviceName) === "princess";
  const correctionLooksLikePrincess = normalizeForMatch(correctionRaw) === "princess";
  const transcriptLooksLikePrincess = normalizeForMatch(currentTurnTranscript) === "princess";
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

  if (
    isAnyStaffPreference(normalizedText) ||
    Array.from(ANY_STAFF_PHRASES).some((phrase) => textContainsStaffAlias(normalizedText, phrase))
  ) {
    return "Any staff";
  }

  const staff = await getStaffCandidates({ salonId });
  const scopedCandidate = normalizeScopedStaffCandidatePhrase(text);
  const searchText = scopedCandidate && scopedCandidate !== "any staff" ? scopedCandidate : normalizedText;
  const aliasMatches = staff.flatMap((member) => {
    const aliases = new Set(getStaffAliasPhrases(member.fullName).map((alias) => normalizeForMatch(alias)));
    return Array.from(aliases.values()).flatMap((alias) =>
      staffAliasMatchesInText(searchText, alias).map((index) => ({
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

  if (scopedCandidate && scopedCandidate !== "any staff") {
    const candidateResolution = resolveStaffPreferenceFromCandidates(staff, scopedCandidate);
    if (candidateResolution.status === "matched") {
      return candidateResolution.matchedStaff.fullName;
    }
    return undefined;
  }

  const tokens = normalizedText.split(/\s+/).filter((token) => token.length >= 5);
  const fuzzyMatches = staff.filter((member) =>
    getStaffAliasPhrases(member.fullName).some((alias) =>
      tokens.some((token) => isConservativeStaffFuzzyMatch(alias, token))
    )
  );
  if (fuzzyMatches.length === 1) {
    return fuzzyMatches[0]!.fullName;
  }

  return staff.find((member) => {
    const fullName = normalizeForMatch(member.fullName);
    const firstName = normalizeForMatch(member.fullName.split(/\s+/)[0]);
    return textContainsStaffAlias(normalizedText, fullName) || textContainsStaffAlias(normalizedText, firstName);
  })?.fullName;
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
  requestedStaffName?: string
): StaffPreferenceResolution => {
  const allStaff = orderStaffForPrompt(dedupeStaffById(staff));
  const rawStaffPreference = requestedStaffName?.trim();
  const scopedStaffPreference = normalizeScopedStaffCandidatePhrase(rawStaffPreference);
  const requested = normalizeForMatch(scopedStaffPreference ?? rawStaffPreference);

  if (!requested) {
    return {
      status: "missing",
      candidates: allStaff,
      allStaff,
      invalidReason: "missing"
    };
  }
  if (isAnyStaffPreference(requested)) {
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
    return aliases.has(requested);
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
      ].filter(Boolean);
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
}): Promise<StaffPreferenceResolution> => {
  const allStaff = await getActiveBookableStaff(input.salonId);
  const matchedById = await getActiveBookableStaffById(input.salonId, input.staffId);
  if (matchedById) {
    return {
      status: "matched",
      candidates: [matchedById],
      allStaff,
      rawStaffPreference: input.requestedStaffName || matchedById.fullName,
      matchedStaff: matchedById
    };
  }
  return resolveStaffPreferenceFromCandidates(allStaff, input.requestedStaffName);
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
        gte: new Date()
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

const asTrimmedString = (value?: unknown): string | undefined => {
  const trimmed = typeof value === "string" ? value.trim() : undefined;
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
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
  const serviceDtmfScoped = activeDtmfMenu === "service" || lastAskedSlot === "serviceName";
  const staffDtmfScoped = activeDtmfMenu === "staff" || lastAskedSlot === "staffPreference";
  const serviceDtmfSelection =
    readScopedDtmfSelection(
      serviceDtmfScoped,
      [
        transcriptText,
        asTrimmedString(input.serviceName),
        asTrimmedString(input.service),
        readBookingFieldAttribute(attributes, "serviceName")
      ],
      readServiceDtmfOptions(attributes)
    );
  const staffDtmfSelection =
    readScopedDtmfSelection(
      staffDtmfScoped,
      [
        transcriptText,
        asTrimmedString(input.staffPreference),
        readBookingFieldAttribute(attributes, "staffPreference")
      ],
      readStaffDtmfOptions(attributes)
    );
  const staffDtmfDigit =
    staffDtmfScoped
      ? [
          transcriptText,
          asTrimmedString(input.staffPreference),
          readBookingFieldAttribute(attributes, "staffPreference")
        ]
          .map((value) => readDtmfDigit(value))
          .find((value): value is string => Boolean(value))
      : undefined;
  const staffDtmfStaffId =
    staffDtmfDigit && staffDtmfSelection
      ? readStaffDtmfStaffIds(attributes)[staffDtmfDigit]
      : undefined;
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
  const rawServiceName =
    serviceDtmfSelection ??
    (currentTurnIsDigitNoise && confirmedServiceName ? confirmedServiceName : undefined) ??
    inputServiceName ??
    readBookingFieldAttribute(attributes, "serviceName");
  const serviceCandidate =
    rawServiceName && isAffirmative(rawServiceName) && suggestedServiceName
      ? suggestedServiceName
      : rawServiceName;
  const serviceName =
    serviceCandidate && !isClearlyInvalidServiceName(serviceCandidate)
      ? getCustomerFacingServiceName(serviceCandidate)
      : undefined;
  const previousRequestedDate = readBookingFieldAttribute(attributes, "requestedDate");
  const previousRequestedTime = readBookingFieldAttribute(attributes, "requestedTime");
  const inputRequestedDate =
    asTrimmedString(input.requestedDate) ?? asTrimmedString(input.preferredDateTime);
  const inputRequestedTime = asTrimmedString(input.requestedTime);
  const currentTurnHasDate = hasGroundedDatePhrase(transcriptText);
  const currentTurnHasTime = hasGroundedTimePhrase(transcriptText);
  const requestedDate =
    currentTurnIsDigitNoise && previousRequestedDate
      ? previousRequestedDate
      : inputRequestedDate && previousRequestedDate && !currentTurnHasDate
        ? previousRequestedDate
        : currentTurnIsDigitNoise
          ? previousRequestedDate
          : inputRequestedDate ?? previousRequestedDate;
  const requestedTime =
    currentTurnIsDigitNoise && previousRequestedTime
      ? previousRequestedTime
      : inputRequestedTime && previousRequestedTime && !currentTurnHasTime
        ? previousRequestedTime
        : currentTurnIsDigitNoise
          ? previousRequestedTime
          : inputRequestedTime ?? previousRequestedTime;
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
    /\b(real person|live person|human|operator|representative|talk to a person|talk to someone|speak to someone|speak with someone)\b/.test(text)
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

const buildStaffPromptSessionAttributes = (staff: StaffCandidate[]): Record<string, string> => {
  const { options, staffIds } = buildStaffDtmfOptionMaps(staff);
  return {
    staffDtmfOptions: JSON.stringify(options),
    staffDtmfStaffIds: JSON.stringify(staffIds),
    staffDtmfPromptText: buildStaffDtmfPromptText(staff),
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
      isActive: true
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
  return services
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
};

const buildServiceDtmfOptionMaps = (services: ServiceMenuCandidate[]) => {
  const options: Record<string, string> = {};
  const serviceIds: Record<string, string> = {};
  services.slice(0, 9).forEach((service, index) => {
    const digit = String(index + 1);
    options[digit] = service.name;
    serviceIds[digit] = service.id;
  });
  return { options, serviceIds };
};

const buildServiceDtmfPromptText = (services: ServiceMenuCandidate[]): string => {
  const { options } = buildServiceDtmfOptionMaps(services);
  const optionPhrases = Object.entries(options).map(
    ([digit, serviceName]) => `Press ${digit} for ${serviceName}`
  );
  return optionPhrases.length
    ? `I can list the services once. ${optionPhrases.join(", ")}, or 0 for a person.`
    : SERVICE_DTMF_OPTIONS_PROMPT;
};

const buildServicePromptSessionAttributes = (services: ServiceMenuCandidate[]): Record<string, string> => {
  const { options, serviceIds } = buildServiceDtmfOptionMaps(services);
  const activeServiceIds = services.map((service) => service.id);
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
  const now = DateTime.now().setZone(timezone);
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
  const parsed = parseLocalDateText(value, timezone);
  if (!parsed?.isValid) {
    return value;
  }
  const today = DateTime.now().setZone(timezone).startOf("day");
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
  } else if (time) {
    pieces.push(`at ${time}`);
  }
  if (knownFields.staffPreference) {
    pieces.push(`with ${knownFields.staffPreference}`);
  }
  return pieces.join(" ").replace(/\s+/g, " ").trim();
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
  const today = DateTime.now().setZone(timezone).startOf("day");
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
}): string => {
  const service = input.serviceName;
  const appointmentTime = formatFinalConfirmationDateTimeForSpeech(
    input.appointmentStartTime,
    input.salonTimezone
  );
  const selectedStaffPrefix = input.requestedAnyStaff
    ? `I found ${escapeSsml(input.staffName)} available. <break time="300ms"/> `
    : "";
  const fallbackNotice = input.customerNameFallbackNotice
    ? `${escapeSsml(input.customerNameFallbackNotice)} <break time="300ms"/> `
    : "";
  const customerPrefix = input.customerName ? `${escapeSsml(input.customerName)}, ` : "";
  return speak(
    `${fallbackNotice}${selectedStaffPrefix}${customerPrefix}just to confirm: ${escapeSsml(service)} ${escapeSsml(appointmentTime)} with ${escapeSsml(input.staffName)}. <break time="300ms"/> Is that correct?`
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
  invalidStaffDtmfSelection?: boolean;
  unmatchedStaffPreference?: boolean;
  repeatedKnownFieldWhileAskingName?: boolean;
  partialBookingFragment?: boolean;
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
      `I'm having trouble getting that clearly. <break time="300ms"/> Please wait while I connect you.`
    );
  }

  if (input.outcome === "MISSING_INFO") {
    const isRetry = (input.attemptCount ?? 1) > 1;
    const intro = input.invalidStaffDtmfSelection
      ? "I didn't find that option. Please choose from the list."
      : input.unmatchedStaffPreference
        ? "I didn't find that technician."
        : isRetry
          ? "Sorry, I did not catch that."
          : "Got it.";
    if (input.missingFields?.includes("staffPreference")) {
      const prompt = buildStaffDtmfPromptText(input.staffOptions ?? []);
      const serviceIntro = input.knownFields?.serviceName
        ? `Got it, ${escapeSsml(input.knownFields.serviceName)}. `
        : "";
      return speak(
        input.invalidStaffDtmfSelection
          ? `${intro} <break time="300ms"/> ${prompt}`
          : input.unmatchedStaffPreference
            ? `${intro} <break time="300ms"/> ${prompt}`
            : `${serviceIntro}${prompt}`
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
          ? `I already have ${escapeSsml(summary)}. <break time="300ms"/> May I have your name, please?`
          : (input.attemptCount ?? 1) >= 3
          ? "Could you spell your first name, one letter at a time?"
          : isRetry
          ? "Sorry, I didn't catch your name. Could you say your first name slowly?"
          : summary
            ? `I have your ${escapeSsml(summary)}. <break time="300ms"/> May I have your name, please?`
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
      if (input.partialBookingFragment) {
        return speak(SERVICE_FIRST_RETRY_PROMPT);
      }
      const firstName = input.knownFields?.customerName?.split(/\s+/)[0];
      const servicePrompt = isRetry
        ? input.servicePromptText ?? SERVICE_DTMF_OPTIONS_PROMPT
        : SERVICE_FIRST_RETRY_PROMPT;
      return speak(
        firstName && !isRetry
          ? `Welcome back, ${escapeSsml(firstName)}. How may I help you today?`
          : servicePrompt
      );
    }
    if (input.missingFields?.includes("preferredDateTime")) {
      return input.knownFields?.requestedDate
        ? speak(
            `${intro} <break time="300ms"/> What time works best?`
          )
        : speak(
            `${intro} <break time="300ms"/> What day would you like?`
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
      if (dedupedAlternatives.length === 1) {
        const [alternative] = dedupedAlternatives;
        const alternativeTime = formatLocalTimeForSpeech(alternative.startTime, timezone);
        return speak(
          `${escapeSsml(input.requestedStaffName)} is not available at ${escapeSsml(requestedTime)}. <break time="300ms"/> ${escapeSsml(alternative.staffName)} is available at ${escapeSsml(alternativeTime)}. Would you like ${escapeSsml(alternativeTime)} with ${escapeSsml(alternative.staffName)}?`
        );
      }
      const formattedChoices = formatAlternativeChoicePrompt(dedupedAlternatives, timezone);
      return speak(
        `${escapeSsml(input.requestedStaffName)} is not available at ${escapeSsml(requestedTime)}. <break time="300ms"/> ${escapeSsml(formattedChoices)}`
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
  let slotToElicit = "serviceName";
  if (missingFields.has("customerName")) {
    slotToElicit = "customerName";
  } else if (missingFields.has("serviceName")) {
    slotToElicit = "serviceName";
  } else if (missingFields.has("preferredDateTime")) {
    slotToElicit = normalized.requestedDate ? "requestedTime" : "requestedDate";
  } else if (missingFields.has("staffPreference")) {
    slotToElicit = "staffPreference";
  } else if (missingFields.has("customerPhone")) {
    slotToElicit = "customerPhone";
  }

  const lastAskedSlot = readStringAttribute(normalized.attributes, ["lastAskedSlot"]);
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
    ? speak(input.attempts >= 1 ? input.servicePromptText ?? SERVICE_DTMF_OPTIONS_PROMPT : SERVICE_FIRST_RETRY_PROMPT)
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
    message = buildLexMessage({
      outcome: "MISSING_INFO",
      missingFields: elicitDecision.promptMissingFields,
      knownFields: normalized,
      salonTimezone: salon.timezone,
      attemptCount: elicitDecision.attemptCount,
      servicePromptText: servicePromptSessionAttributes.serviceDtmfPromptText
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
      type: "ConfirmIntent"
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
      recoverableErrorReason: options.reason,
      recoverableErrorCode: errorCode
    }),
    failureReason: `Recoverable backend error: ${errorCode}`,
    rawInput: toJson({
      ...input,
      authorization: undefined,
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
      slotToElicit: dialogAction.slotToElicit
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
  const normalized = normalizeAmazonConnectAppointmentInput(input);
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
  normalized.requestedTime ??= readStringAttribute(activeNormalizedRequest, ["requestedTime"]);
  normalized.staffId ??= readStringAttribute(activeNormalizedRequest, ["staffId", "selectedStaffId"]);

  if (normalized.staffDtmfDigit && (!normalized.staffPreference || !normalized.staffId)) {
    const currentStaff = await getActiveBookableStaff(salon.id);
    const currentStaffOptions = buildStaffDtmfOptionMaps(currentStaff);
    const selectedStaffName = currentStaffOptions.options[normalized.staffDtmfDigit];
    if (selectedStaffName) {
      normalized.staffPreference = selectedStaffName;
      normalized.staffId = currentStaffOptions.staffIds[normalized.staffDtmfDigit];
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

  const explicitCustomerName = normalized.transcriptText
    ? extractCustomerNameFromText(normalized.transcriptText)
    : undefined;
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
  if (normalized.customerName && !isAcceptableCustomerName(normalized.customerName)) {
    normalized.customerName = undefined;
  }
  const trustedCustomerNameBeforeLookup = normalized.customerName;
  const currentTurnAcceptedCustomerName = explicitCustomerName || bareCustomerName;
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
    normalized.customerName =
      currentTurnAcceptedCustomerName ||
      recognizedCustomerReusableName ||
      trustedCustomerNameBeforeLookup;
    if (normalized.customerName && !isAcceptableCustomerName(normalized.customerName)) {
      normalized.customerName = undefined;
    }
    normalized.customerPhone = normalizePhoneForMatching(normalized.customerPhone) ?? recognizedCustomer.phone;
    if (currentTurnAcceptedCustomerName && normalized.customerName) {
      customerNameSourceOverride = "current_turn_explicit";
      customerNameNeedsReview = false;
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
  if (normalized.transcriptText && normalized.requestedDate && !normalized.requestedTime) {
    const transcriptTimeCandidate = extractTimeCandidate(normalized.transcriptText);
    const transcriptTime = transcriptTimeCandidate
      ? parseLocalTimeText(transcriptTimeCandidate)
      : null;
    if (transcriptTime && !transcriptTime.ambiguous) {
      normalized.requestedTime = `${String(transcriptTime.hour).padStart(2, "0")}:${String(
        transcriptTime.minute
      ).padStart(2, "0")}`;
    }
  }
  const currentTurnExplicitDate = extractExplicitDate(normalized.currentTurnTranscript, salon.timezone);
  const currentTurnExplicitTime = extractExplicitTime(normalized.currentTurnTranscript);
  if (currentTurnExplicitDate) {
    normalized.requestedDate = currentTurnExplicitDate;
  }
  if (currentTurnExplicitTime && !localTimesEquivalent(normalized.requestedTime, currentTurnExplicitTime)) {
    normalized.requestedTime = currentTurnExplicitTime;
  }

  if (!normalized.serviceName && normalized.transcriptText) {
    const serviceMention = await findServiceMentionInText(salon.id, normalized.transcriptText);
    if (serviceMention) {
      normalized.serviceName = getCustomerFacingServiceName(serviceMention.service.name);
    }
  }

  const awaitingAlternativeSelection =
    readStringAttribute(normalized.attributes, ["awaitingAlternativeSelection"]) === "true";
  const awaitingFinalBookingConfirmation =
    readStringAttribute(normalized.attributes, [
      "awaitingFinalBookingConfirmation",
      "bookingConfirmationAsked",
      "finalBookingConfirmationAsked"
    ]) === "true" ||
    readStringAttribute(normalized.attributes, ["lastAskedSlot"]) === "bookingConfirmation";
  const customerNameTurnOwnsTranscript =
    readStringAttribute(normalized.attributes, ["lastAskedSlot"]) === "customerName" &&
    readStringAttribute(normalized.attributes, ["activeDtmfMenu"]) !== "staff";
  const currentTurnStaffMention = normalized.currentTurnTranscript && !customerNameTurnOwnsTranscript
    ? await findStaffMentionInText(salon.id, normalized.currentTurnTranscript)
    : undefined;
  const currentTurnAllowsUnmatchedStaff =
    Boolean(normalized.currentTurnTranscript) &&
    !customerNameTurnOwnsTranscript &&
    (readStringAttribute(normalized.attributes, ["lastAskedSlot"]) === "staffPreference" ||
      readStringAttribute(normalized.attributes, ["activeDtmfMenu"]) === "staff" ||
      awaitingFinalBookingConfirmation ||
      hasStaffCuePhrase(normalized.currentTurnTranscript));
  const currentTurnStaffCandidate = currentTurnAllowsUnmatchedStaff
    ? normalizeScopedStaffCandidatePhrase(normalized.currentTurnTranscript)
    : undefined;
  const currentTurnHasExplicitStaffPhrase = currentTurnAllowsUnmatchedStaff
    ? hasExplicitStaffPhrase(normalized.currentTurnTranscript)
    : false;
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
    normalized.staffPreference = await findStaffMentionInText(salon.id, normalized.transcriptText);
  }

  let finalConfirmationRequiresStaffSelection = false;
  const finalConfirmationText = normalized.currentTurnTranscript ?? normalized.transcriptText;
  const finalConfirmationOutcome = awaitingFinalBookingConfirmation
    ? classifyFinalBookingConfirmation(finalConfirmationText, {
        hasExplicitStaffChange: Boolean(currentTurnStaffMention)
      })
    : "UNKNOWN";
  if (awaitingFinalBookingConfirmation && finalConfirmationOutcome === "AFFIRMED") {
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
      (!clearedDate && /\bnot\s+(?!correct\b|right\b|book\b|it\b|that\b)[a-z][a-z\s'-]{1,40}\b/.test(
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
      const changedStaff = genericStaffChangeWithoutName
        ? undefined
        : currentTurnStaffMention ?? await findStaffMentionInText(salon.id, finalConfirmationText);
      if (changedStaff) {
        normalized.staffPreference = changedStaff;
        normalized.staffId = undefined;
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

  let staffResolution = await resolveStaffCandidates({
    salonId: salon.id,
    requestedStaffName: normalized.staffPreference,
    staffId: normalized.staffId
  });
  if (staffResolution.status === "matched") {
    normalized.staffPreference = staffResolution.matchedStaff.fullName;
    normalized.staffId = staffResolution.matchedStaff.id;
  } else if (staffResolution.status === "explicit_any") {
    normalized.staffPreference = "Any staff";
    normalized.staffId = undefined;
  } else if (normalized.invalidStaffDtmfSelection) {
    normalized.staffPreference = undefined;
    normalized.staffId = undefined;
  } else if (staffResolution.status !== "ambiguous") {
    normalized.staffPreference = staffResolution.status === "unmatched_specific"
      ? staffResolution.rawStaffPreference
      : undefined;
    normalized.staffId = undefined;
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
	      customerPhone:
	        normalizeCustomerPhone(normalized.customerPhone) ??
	        normalizePhoneForMatching(normalized.customerPhone),
      requestedService: normalized.serviceName,
      requestedStaff: normalized.staffPreference,
      requestedDateTimeText:
        inputForAttempt.requestedStartTime?.toISOString() ?? normalized.requestedDate,
      normalizedRequest: toJson({
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
    const turnStateDiagnostics = {
      turnDirective:
        responsePayloadBase.turnDirective ??
        responsePayloadBase.confirmationOutcome ??
        responsePayloadBase.errorCode ??
        inputForInteraction.outcome,
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
      conversationCompleteAfter: inferredResponseSessionAttributes.conversationComplete
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
      confidence: 1,
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
    return Object.fromEntries(
      Object.entries({
        conversationState: defaultConversationState,
        conversationOutcome: defaultConversationOutcome,
        conversationComplete: terminalBooking ? "true" : "false",
        customerId: recognizedCustomer?.id,
        recognizedCustomerId: recognizedCustomer?.id,
        spokenCustomerName,
        persistedCustomerFirstName: recognizedCustomer?.firstName,
        persistedCustomerLastName: recognizedCustomer?.lastName,
        recognizedCustomerName: recognizedCustomerReusableName ?? knownCallerMemory?.customerName,
        customerNameSource: recognizedCustomerReusableName
          ? "customer"
          : customerNameSourceOverride ?? knownCallerMemory?.source,
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
    const canTransferToQueue = escalation?.routingOutcome === CallRoutingOutcome.QUEUED;
    return buildKnownSessionAttributes({
      conversationState: canTransferToQueue ? "TRANSFER" : "RECOVERABLE_ERROR",
      conversationOutcome: canTransferToQueue ? "NEEDS_INPUT" : "ERROR",
      conversationComplete: "false",
      forceHumanEscalation: canTransferToQueue ? "true" : "false",
      transferToQueue: canTransferToQueue ? "true" : "false",
      escalationReason: reason,
      fallbackMode: escalation?.routingOutcome ?? "operator_queue",
      queueId: canTransferToQueue ? escalation?.queueId : undefined,
      ...extra
    });
  };

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
        staffId: storedRescheduleStaffId
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
      dialogAction: { type: "ConfirmIntent" },
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
          messageToCaller: "Please wait while I connect you.",
          metadata: {
            bookingAttemptId: bookingAttempt.id,
            transcriptId: transcript?.id,
            intentName: normalized.intentName,
            contactId: normalized.contactId
          }
        })
      : null;
    const message =
      escalation?.routingOutcome === CallRoutingOutcome.QUEUED
        ? "Please wait while I connect you."
        : "No agents available.";
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
  const shouldAskStaffOnce =
    finalConfirmationRequiresStaffSelection ||
    (staffResolution.status === "missing" && staffResolution.allStaff.length > 0) ||
    staffResolution.status === "invalid_noise" ||
    staffResolution.status === "unmatched_specific";
  if (normalized.invalidStaffDtmfSelection || staffResolution.status === "ambiguous" || shouldAskStaffOnce) {
    missingFields.add("staffPreference");
    normalized.staffId = undefined;
  }
  if (!missingFields.has("staffPreference") && staffResolution.status === "explicit_any") {
    normalized.staffPreference = "Any staff";
    normalized.staffId = undefined;
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
    const elicitDecision = getElicitSlotForMissingFields(
      missingFields,
      normalized,
      servicePromptSessionAttributes
    );
    const shouldPromptStaff = elicitDecision.promptMissingFields.includes("staffPreference");
    const staffPromptOptions =
      shouldPromptStaff && serviceMatch?.service.id
        ? await getMappedActiveBookableStaffForService({
            salonId: salon.id,
            serviceId: serviceMatch.service.id
          })
        : shouldPromptStaff
          ? await getStaffCandidates({ salonId: salon.id })
          : [];

    const message = buildLexMessage({
      outcome: "MISSING_INFO",
      missingFields: elicitDecision.promptMissingFields,
      staffOptions: staffPromptOptions,
      knownFields: normalized,
      salonTimezone: salon.timezone,
      attemptCount: elicitDecision.attemptCount,
      servicePromptText: servicePromptSessionAttributes.serviceDtmfPromptText,
      invalidStaffDtmfSelection: normalized.invalidStaffDtmfSelection,
      unmatchedStaffPreference: staffResolution.status === "unmatched_specific",
      partialBookingFragment: isPartialBookingFragment(
        normalized.currentTurnTranscript ?? normalized.transcriptText
      ),
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
      ? buildStaffPromptSessionAttributes(staffPromptOptions)
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
    const lexSessionAttributes = buildKnownSessionAttributes({
      ...unresolvedStaffAttributes,
      ...elicitDecision.sessionAttributes,
      ...staffPromptAttributes
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

  const service = serviceMatch.service;
  const callerServiceName = getCustomerFacingServiceName(service.name) ?? service.name;
  normalized.serviceName = callerServiceName;

  staffResolution =
    staffResolution.rawStaffPreference === normalized.staffPreference
      ? staffResolution
      : await resolveStaffCandidates({
          salonId: salon.id,
          requestedStaffName: normalized.staffPreference,
          staffId: normalized.staffId
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

  const mappedStaffCandidates = await getMappedActiveBookableStaffForService({
    salonId: salon.id,
    serviceId: service.id
  });
  const mappedStaffIds = new Set(mappedStaffCandidates.map((staff) => staff.id));

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
    const message = speak("No problem. <break time=\"300ms\"/> Which detail would you like to change?");
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
        awaitingFinalBookingConfirmation: false
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
          bookingConfirmationAsked: "false"
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
                : undefined
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
          type: "ConfirmIntent"
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
  if (!input.includeSynthetic) {
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
    parsedOutput: interaction.parsedOutput,
    requestPayload: interaction.requestPayload,
    responsePayload: interaction.responsePayload
  };
};

const buildAdminDebugTimelineItems = (
  interaction: Awaited<ReturnType<typeof prisma.aiInteractionLog.findMany>>[number],
  index: number
): Array<ReturnType<typeof buildAdminDebugTimelineItem>> => {
  const responsePayload = asRecord(interaction.responsePayload);
  const turnHistory = Array.isArray(responsePayload.turnHistory)
    ? responsePayload.turnHistory.map((turn) => asRecord(turn))
    : [];
  if (!turnHistory.length) {
    return [buildAdminDebugTimelineItem(interaction, index)];
  }

  const base = buildAdminDebugTimelineItem(interaction, index);
  return turnHistory.map((turn, turnIndex): ReturnType<typeof buildAdminDebugTimelineItem> => {
    const sessionAttributesBefore = turn.sessionAttributesBefore;
    const sessionAttributesAfter = turn.sessionAttributesAfter;
    const turnCreatedAt =
      typeof turn.createdAt === "string" && !Number.isNaN(new Date(turn.createdAt).getTime())
        ? new Date(turn.createdAt)
        : base.createdAt;
    return {
      ...base,
      index: Number(turn.index ?? turnIndex + 1) - 1,
      aiInteractionId: interaction.id,
      createdAt: turnCreatedAt,
      currentTurnTranscript: turn.currentTurnTranscript,
      aggregatedRequestText:
        typeof turn.aggregatedBookingTranscript === "string"
          ? turn.aggregatedBookingTranscript
          : base.aggregatedRequestText,
      requestText: interaction.requestText,
      responseText:
        typeof turn.responseText === "string" ? turn.responseText : interaction.responseText,
      intentName: turn.intentName ?? base.intentName,
      inputMode: turn.inputMode ?? base.inputMode,
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
      slotToElicit: turn.slotToElicit,
      missingFields: turn.missingFields,
      promptMissingFields: turn.promptMissingFields,
      transferToQueue: turn.transferToQueue,
      forceHumanEscalation: turn.forceHumanEscalation,
      requestPayload: interaction.requestPayload,
      responsePayload: interaction.responsePayload
    };
  });
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
          transcripts: {
            orderBy: { createdAt: "asc" }
          },
          bookingAttempts: {
            orderBy: { createdAt: "asc" }
          },
          aiInteractions: {
            orderBy: { createdAt: "asc" }
          }
        }
      })
    : null;

  const aiInteractions = callSession?.aiInteractions ?? [interaction];
  const contactIds = compactValues([
    callSession?.providerCallId,
    ...aiInteractions.flatMap((item) => {
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

  return {
    callSession,
    aiInteractions,
    bookingAttempts: callSession?.bookingAttempts ?? (interaction.bookingAttempt ? [interaction.bookingAttempt] : []),
    transcripts: callSession?.transcripts ?? (interaction.transcript ? [interaction.transcript] : []),
    contactIds,
    callerPhone: callSession?.callerPhone ?? interaction.bookingAttempt?.customerPhone ?? null,
    calledNumber: callSession?.dialedPhone ?? callSession?.trackingNumber ?? null,
    timeline: aiInteractions.flatMap((item, index) => buildAdminDebugTimelineItems(item, index))
  };
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
  return items.map(toAIInteractionExportItem);
};
