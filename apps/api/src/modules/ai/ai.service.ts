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
import { createAppointmentFromAI, getAppointmentDetail } from "../appointments/appointments.service";
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
    "full said",
    "full sat",
    "full sad",
    "full send",
    "fuel set",
    "fake nails",
    "extension nails",
    "nail extensions",
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
  "any",
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
  "whoever",
  "whoever is available",
  "whoever s available",
  "whoever's available",
  "who is available"
]);

const DEMO_SERVICE_NAMES = [
  "Manicure",
  "Pedicure",
  "Gel Manicure",
  "Full Set",
  "Dip Powder",
  "Other Services"
];
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
  "okay",
  "ok",
  "yes",
  "no",
  "toss",
  "full set",
  "tomorrow",
  "today",
  "operator",
  "zero",
  "four"
]);
const SERVICE_DTMF_PROMPT =
  "Hi, I can help book your appointment. You can say the service, press 4 for Full Set, or press 0 for a real person.";
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

const extractCustomerNameFromText = (text?: string): string | undefined => {
  const match = text?.match(
    /(?:my name is|name is|this is|i am|i'm)\s+([a-zA-Z][a-zA-Z'-]*(?:\s+[a-zA-Z][a-zA-Z'-]*){0,4})(?=\s*(?:[,.!?;]|$|and\s+(?:my\s+)?phone|(?:my\s+)?phone\s+(?:number\s+)?(?:is|should|to)))/i
  );
  const name = match?.[1]?.trim();
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
        /\b(book|booking|appointment|service|pedicure|manicure|full set|dip|powder|tomorrow|today|morning|afternoon|evening|night|phone|number|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/.test(
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
  if (!/^[a-z][a-z' -]{0,80}$/i.test(raw) || normalized.split(" ").length > 4) {
    return false;
  }
  return true;
};

const extractBareCustomerNameAnswer = (value?: string | null): string | undefined => {
  const raw = value?.trim();
  const normalized = normalizeForMatch(raw);
  if (
    !raw ||
    readDtmfDigit(raw) ||
    isOperatorZeroRequest(raw) ||
    isInvalidCustomerNameNoise(raw) ||
    /\b(real person|live person|human|operator|representative|talk to a person|talk to someone|speak to someone|speak with someone)\b/.test(normalized) ||
    /\b(book|booking|appointment|service|pedicure|manicure|full set|dip|powder|tomorrow|today|morning|afternoon|evening|night|phone|number|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/.test(normalized)
  ) {
    return undefined;
  }
  if (!/^[a-z][a-z' -]{0,80}$/i.test(raw) || normalized.split(" ").length > 4) {
    return undefined;
  }
  return raw.replace(/\s+/g, " ");
};

const isReusableCallerName = (value?: string | null): value is string => {
  return Boolean(extractBareCustomerNameAnswer(value));
};

const STAFF_ALIAS_PHRASES: Record<string, string[]> = {
  trang: ["trang", "chang", "train", "trangg"],
  amy: ["amy", "amie", "a me"],
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
  return customer.firstName.trim() || [customer.firstName, customer.lastName].filter(Boolean).join(" ").trim();
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
  const segment = value
    .replace(/\b([ap])\s*\.?\s*m\.?\b/gi, "$1m")
    .replace(/^\s*(?:at|around|about|for|by)\s+/i, "")
    .split(/[,.!?;]/)[0]
    ?.trim();
  if (!segment) {
    return undefined;
  }

  const explicitMatch = segment.match(
    new RegExp(
      `\\b(?:${SPOKEN_HOUR_PATTERN}|\\d{1,2})(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)\\b`,
      "i"
    )
  );
  if (explicitMatch?.[0]) {
    return explicitMatch[0];
  }

  const markedBareMatch = segment.match(
    new RegExp(
      `\\b(?:at|around|about|for|by)\\s+((?:${SPOKEN_HOUR_PATTERN}|\\d{1,2})(?::\\d{2})?)\\b`,
      "i"
    )
  );
  if (markedBareMatch?.[1]) {
    return markedBareMatch[1];
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
    } else if (staffResolution.invalidReason === "explicit_any") {
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

  return {
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
    transferToQueue:
      sessionAttributesAfter.transferToQueue ?? responsePayload.transferToQueue ?? null,
    forceHumanEscalation:
      sessionAttributesAfter.forceHumanEscalation ?? responsePayload.forceHumanEscalation ?? null
  };
};

const getAmazonConnectTurnHistory = (responsePayload: unknown): unknown[] => {
  const payload = recordFromUnknown(responsePayload);
  return arrayFromUnknown(payload.turnHistory);
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
  const existing =
    input.callSessionId
      ? await prisma.aiInteractionLog.findFirst({
          where: {
            salonId: input.salonId,
            provider: ExternalProvider.AMAZON_CONNECT,
            taskType: "amazon_connect_booking_fulfillment",
            callSessionId: input.callSessionId
          },
          orderBy: {
            createdAt: "asc"
          }
        })
      : null;
  const existingHistory = existing ? getAmazonConnectTurnHistory(existing.responsePayload) : [];
  const turn = buildAmazonConnectTurnHistoryItem({
    index: existingHistory.length + 1,
    createdAt: new Date().toISOString(),
    interactionInput: input
  });
  const responsePayload = withAmazonConnectTurnHistory(input.responsePayload, [
    ...existingHistory,
    turn
  ]);

  if (existing) {
    return prisma.aiInteractionLog.update({
      where: {
        id: existing.id
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
        createdByUserId: input.actorUserId
      }
    });
  }

  return createAIInteractionLog({
    ...input,
    responsePayload
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
    Array.from(ANY_STAFF_PHRASES).some((phrase) => normalizedText.includes(phrase))
  ) {
    return "Any staff";
  }

  const staff = await getStaffCandidates({ salonId });
  for (const member of staff) {
    const aliasMatch = getStaffAliasPhrases(member.fullName).some((alias) =>
      normalizedText.includes(normalizeForMatch(alias))
    );
    if (aliasMatch) {
      return member.fullName;
    }
  }

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
    const existingByPhone = await findExistingCustomerByPhone({
      salonId: input.salonId,
      customerPhone: input.customerPhone
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
  return orderStaffForPrompt(await prisma.staff.findMany({
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
      isBookable: true
    },
    select: {
      id: true,
      fullName: true
    }
  });
};

const resolveStaffPreferenceFromCandidates = (
  staff: StaffCandidate[],
  requestedStaffName?: string
): StaffPreferenceResolution => {
  const allStaff = orderStaffForPrompt(dedupeStaffById(staff));
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

const readNestedString = (value: unknown, paths: string[][]): string | undefined => {
  for (const path of paths) {
    let cursor = value;
    for (const key of path) {
      if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) || !(key in cursor)) {
        cursor = undefined;
        break;
      }
      cursor = (cursor as Record<string, unknown>)[key];
    }
    if (typeof cursor === "string" && cursor.trim()) {
      return cursor.trim();
    }
  }
  return undefined;
};

const findKnownCallerMemoryByPhone = async (input: {
  salonId: string;
  customerPhone?: string | null;
}): Promise<{ customerName: string; customerPhone?: string; source: string } | null> => {
  const lookupValues = buildPhoneLookupValues(input.customerPhone);
  if (!lookupValues.length) {
    return null;
  }

  const existingCustomer = await findExistingCustomerByPhone(input);
  if (existingCustomer) {
    const existingCustomerName = customerDisplayName(existingCustomer);
    if (isReusableCallerName(existingCustomerName)) {
      return {
        customerName: existingCustomerName,
        customerPhone: existingCustomer.phone,
        source: "customer"
      };
    }
  }

  const latestAttempts = await prisma.bookingAttempt.findMany({
    where: {
      salonId: input.salonId,
      customerPhone: {
        in: lookupValues
      },
      customerName: {
        not: null
      }
    },
    select: {
      customerName: true,
      customerPhone: true
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 20
  });
  const latestAttempt = latestAttempts.find((attempt) => isReusableCallerName(attempt.customerName));
  if (latestAttempt?.customerName?.trim()) {
    return {
      customerName: latestAttempt.customerName.trim(),
      customerPhone: latestAttempt.customerPhone ?? undefined,
      source: "booking_attempt"
    };
  }

  const recentCalls = await prisma.callSession.findMany({
    where: {
      salonId: input.salonId,
      callerPhone: {
        in: lookupValues
      }
    },
    select: {
      callerPhone: true,
      aiSummary: true,
      bookingResult: true
    },
    orderBy: {
      createdAt: "desc"
    },
    take: 25
  });
  for (const call of recentCalls) {
    const customerName = readNestedString(call.aiSummary, [
      ["customer", "name"],
      ["parsed", "customer", "name"],
      ["normalizedRequest", "customerName"]
    ]) ?? readNestedString(call.bookingResult, [
      ["customer", "name"],
      ["normalizedRequest", "customerName"]
    ]);
    if (isReusableCallerName(customerName)) {
      return {
        customerName,
        customerPhone: call.callerPhone ?? input.customerPhone ?? undefined,
        source: "call_session"
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
  const currentTurnTranscript =
    asTrimmedString(input.currentTurnTranscript) ??
    readStringAttribute(attributes, ["currentTurnTranscript"]) ??
    asTrimmedString(
      input.attributes &&
        typeof input.attributes.lexTurnDebug === "object" &&
        input.attributes.lexTurnDebug !== null &&
        !Array.isArray(input.attributes.lexTurnDebug)
        ? (input.attributes.lexTurnDebug as Record<string, unknown>).currentTurnTranscript
        : undefined
    ) ??
    asTrimmedString(input.text);
  const aggregatedBookingTranscript =
    asTrimmedString(input.aggregatedBookingTranscript) ??
    readStringAttribute(attributes, ["aggregatedBookingTranscript"]) ??
    asTrimmedString(input.transcript) ??
    currentTurnTranscript;
  const transcriptText = currentTurnTranscript ?? aggregatedBookingTranscript;
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
      SERVICE_DTMF_OPTIONS
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

const getServicePromptNames = (serviceNames: string[]): string[] => {
  const customerFacingNames = Array.from(
    new Set(
      serviceNames
        .map((name) => getCustomerFacingServiceName(name))
        .filter((name): name is string => Boolean(name))
    )
  );
  const available = new Set(customerFacingNames.map((name) => normalizeForMatch(name)));
  const demoNames = DEMO_SERVICE_NAMES.filter((name) => available.has(normalizeForMatch(name)));
  return demoNames.length === DEMO_SERVICE_NAMES.length ? demoNames : customerFacingNames.slice(0, 5);
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
  requestedAnyStaff?: boolean;
}): string => {
  const service = input.serviceName;
  const appointmentTime = formatFinalConfirmationDateTimeForSpeech(
    input.appointmentStartTime,
    input.salonTimezone
  );
  const selectedStaffPrefix = input.requestedAnyStaff
    ? `I found ${escapeSsml(input.staffName)} available. <break time="300ms"/> `
    : "";
  return speak(
    `${selectedStaffPrefix}Just to confirm, ${escapeSsml(service)} with ${escapeSsml(input.staffName)} ${escapeSsml(appointmentTime)}. <break time="300ms"/> Is that correct?`
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
  repeatedKnownFieldWhileAskingName?: boolean;
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
      `I'm having trouble getting that clearly. <break time="300ms"/> Please wait while I connect you.`
    );
  }

  if (input.outcome === "MISSING_INFO") {
    const isRetry = (input.attemptCount ?? 1) > 1;
    const intro = input.invalidStaffDtmfSelection
      ? "I didn't find that option. Please choose from the list."
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
        isRetry && input.repeatedKnownFieldWhileAskingName && summary
          ? `I already have ${escapeSsml(summary)}. <break time="300ms"/> What name should I put on the appointment?`
          : isRetry
          ? "Sorry, could you spell the name for me?"
          : summary
            ? `Got it: ${escapeSsml(summary)}. <break time="300ms"/> What name should I put on the appointment?`
            : "What name should I put on the appointment?"
      );
    }
    if (input.missingFields?.includes("customerPhone")) {
      const name = input.knownFields?.customerName;
      return speak(
        `${name ? `Thanks, ${escapeSsml(name)}.` : intro} <break time="300ms"/> What phone number should we keep on the appointment?`
      );
    }
    if (input.missingFields?.includes("serviceName")) {
      const firstName = input.knownFields?.customerName?.split(/\s+/)[0];
      return speak(
        firstName
          ? `Hi ${escapeSsml(firstName)}, I can help book your appointment. ${SERVICE_DTMF_PROMPT}`
          : SERVICE_DTMF_PROMPT
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
  normalized: ReturnType<typeof normalizeAmazonConnectAppointmentInput>
): {
  slotToElicit: string;
  promptMissingFields: string[];
  attemptCount: number;
  sessionAttributes: Record<string, string>;
} => {
  let slotToElicit = "serviceName";
  if (missingFields.has("serviceName")) {
    slotToElicit = "serviceName";
  } else if (missingFields.has("preferredDateTime")) {
    slotToElicit = normalized.requestedDate ? "requestedTime" : "requestedDate";
  } else if (missingFields.has("staffPreference")) {
    slotToElicit = "staffPreference";
  } else if (missingFields.has("customerName")) {
    slotToElicit = "customerName";
  } else if (missingFields.has("customerPhone")) {
    slotToElicit = "customerPhone";
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

  const sessionAttributes: Record<string, string> = {
    lastAskedSlot: slotToElicit,
    askedSlotsCount: String(attemptCount),
    fallbackCount: String(attemptCount),
    errorCount: String(attemptCount)
  };
  if (slotToElicit === "serviceName") {
    sessionAttributes.activeDtmfMenu = "service";
    sessionAttributes.activeDtmfOptionsJson = JSON.stringify(SERVICE_DTMF_OPTIONS);
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
}): string => {
  const options = formatNameList(getServicePromptNames(input.availableServiceNames));
  return options
    ? speak(SERVICE_DTMF_PROMPT)
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

export const createAmazonConnectAIAppointment = async (
  input: CreateAmazonConnectAIAppointmentInput
) => {
  const normalized = normalizeAmazonConnectAppointmentInput(input);
  const normalizedBeforeDebug = pickNormalizedAppointmentDebug(normalized);
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
  if (normalized.customerName && !isAcceptableCustomerName(normalized.customerName)) {
    normalized.customerName = undefined;
  }

  const recognizedCustomer = normalized.customerPhone
    ? await findExistingCustomerByPhone({
        salonId: salon.id,
        customerPhone: normalized.customerPhone
      })
    : null;
  if (recognizedCustomer && !explicitCustomerName && !bareCustomerName) {
    normalized.customerName = customerDisplayName(recognizedCustomer);
    normalized.customerPhone = normalizePhoneForMatching(normalized.customerPhone) ?? recognizedCustomer.phone;
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

  if (!normalized.serviceName && normalized.transcriptText) {
    const serviceMention = await findServiceMentionInText(salon.id, normalized.transcriptText);
    if (serviceMention) {
      normalized.serviceName = getCustomerFacingServiceName(serviceMention.service.name);
    }
  }

  if (!normalized.staffPreference && normalized.transcriptText) {
    normalized.staffPreference = await findStaffMentionInText(salon.id, normalized.transcriptText);
  }

  const awaitingAlternativeSelection =
    readStringAttribute(normalized.attributes, ["awaitingAlternativeSelection"]) === "true";
  const awaitingFinalBookingConfirmation =
    readStringAttribute(normalized.attributes, [
      "awaitingFinalBookingConfirmation",
      "bookingConfirmationAsked",
      "finalBookingConfirmationAsked"
    ]) === "true";
  if (
    awaitingFinalBookingConfirmation &&
    (isAffirmative(normalized.transcriptText) ||
      isAffirmative(normalized.serviceName) ||
      isAffirmative(normalized.requestedTime))
  ) {
    normalized.confirmationState = "Confirmed";
  } else if (
    awaitingFinalBookingConfirmation &&
    (isNegative(normalized.transcriptText) ||
      isNegative(normalized.serviceName) ||
      isNegative(normalized.requestedTime))
  ) {
    normalized.confirmationState = "Denied";
  }

  const selectedAlternative = selectAlternativeSlotFromText({
    alternatives: awaitingAlternativeSelection
      ? parseAlternativeSlotsAttribute(normalized.attributes)
      : [],
    transcriptText: normalized.transcriptText,
    requestedTime: normalized.requestedTime,
    staffPreference: normalized.staffPreference,
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
  const staffWasAlreadyAsked =
    readStringAttribute(normalized.attributes, ["lastAskedSlot"]) === "staffPreference";
  if (staffResolution.status === "matched") {
    normalized.staffPreference = staffResolution.matchedStaff.fullName;
    normalized.staffId = staffResolution.matchedStaff.id;
  } else if (staffResolution.status === "all" && staffResolution.invalidReason === "explicit_any") {
    normalized.staffPreference = "Any staff";
    normalized.staffId = undefined;
  } else if (normalized.invalidStaffDtmfSelection) {
    normalized.staffPreference = undefined;
    normalized.staffId = undefined;
  } else if (staffResolution.status !== "ambiguous") {
    normalized.staffPreference = staffWasAlreadyAsked ? "Any staff" : undefined;
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
      customerPhone: normalizePhoneForMatching(normalized.customerPhone),
      requestedService: normalized.serviceName,
      requestedStaff: normalized.staffPreference,
      requestedDateTimeText:
        inputForAttempt.requestedStartTime?.toISOString() ?? normalized.requestedDate,
      normalizedRequest: toJson({
        salonId: salon.id,
        salonResolutionSource: resolutionSource,
        customerId: recognizedCustomer?.id,
        customerName: normalized.customerName,
        customerPhone: normalized.customerPhone,
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
      Object.assign(inferredResponseSessionAttributes, {
        activeDtmfMenu: "service",
        activeDtmfOptionsJson: JSON.stringify(SERVICE_DTMF_OPTIONS)
      });
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
          lexTurnDebug: responsePayloadDebug
        }
      : {
          currentTurnTranscript: normalized.currentTurnTranscript ?? normalized.transcriptText,
          aggregatedBookingTranscript: normalized.aggregatedBookingTranscript ?? normalized.transcriptText,
          normalizedBefore: normalizedBeforeDebug,
          normalizedAfter: pickNormalizedAppointmentDebug(normalized),
          ...responsePayloadBase,
          sessionAttributes:
            responsePayloadBase.sessionAttributes ?? inferredResponseSessionAttributes
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
      confidence: 1
    });
  };

  const buildKnownSessionAttributes = (
    extra: Record<string, string | number | null | undefined> = {}
  ): Record<string, string> => {
    return Object.fromEntries(
      Object.entries({
        customerId: recognizedCustomer?.id,
        recognizedCustomerId: recognizedCustomer?.id,
        recognizedCustomerName: recognizedCustomer
          ? customerDisplayName(recognizedCustomer)
          : knownCallerMemory?.customerName,
        customerNameSource: recognizedCustomer
          ? "customer"
          : knownCallerMemory?.source,
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
    staffResolution.status === "all" &&
    staffResolution.invalidReason !== "explicit_any" &&
    !staffWasAlreadyAsked;
  if (normalized.invalidStaffDtmfSelection || staffResolution.status === "ambiguous" || shouldAskStaffOnce) {
    missingFields.add("staffPreference");
    normalized.staffId = undefined;
  }
  if (!missingFields.has("staffPreference") && staffResolution.status !== "matched") {
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
    const elicitDecision = getElicitSlotForMissingFields(missingFields, normalized);
    const staffPromptOptions = elicitDecision.promptMissingFields.includes("staffPreference")
      ? await getStaffCandidates({ salonId: salon.id })
      : [];

    const message = buildLexMessage({
      outcome: "MISSING_INFO",
      missingFields: elicitDecision.promptMissingFields,
      staffOptions: staffPromptOptions,
      knownFields: normalized,
      salonTimezone: salon.timezone,
      attemptCount: elicitDecision.attemptCount,
      invalidStaffDtmfSelection: normalized.invalidStaffDtmfSelection,
      repeatedKnownFieldWhileAskingName:
        elicitDecision.slotToElicit === "customerName" &&
        readStringAttribute(normalized.attributes, ["lastAskedSlot"]) === "customerName" &&
        currentTurnRepeatsKnownBookingField(
          normalized.currentTurnTranscript ?? normalized.transcriptText,
          normalized,
          salon.timezone
        )
    });
    const staffPromptAttributes = elicitDecision.promptMissingFields.includes("staffPreference")
      ? buildStaffPromptSessionAttributes(staffPromptOptions)
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
    const services = await prisma.service.findMany({
      where: {
        salonId: salon.id,
        isActive: true
      },
      select: { name: true },
      orderBy: { createdAt: "asc" }
    });
    const suggestedServiceName = getCustomerFacingServiceName(serviceMatch.service.name);
    const message = buildServiceClarificationMessage({
      heardServiceName: normalized.serviceName!,
      suggestedServiceName,
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
      status: BookingAttemptStatus.NEEDS_INPUT,
      requestedStartTime,
      failureReason: "Service not found or inactive.",
      normalizedRequest: {
        serviceName: normalized.serviceName,
        availableServiceNames: services.map((service) => service.name),
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
        availableServiceNames: services.map((service) => service.name),
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

  const preferredStaffCandidates = staffResolution.candidates;
  const allStaffCandidates = staffResolution.allStaff;
  const requestedAnyStaff = staffResolution.status === "all" && staffResolution.invalidReason === "explicit_any";

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
    const message = buildBookingConfirmationMessage({
      serviceName: callerServiceName,
      appointmentStartTime: requestedStartTime,
      salonTimezone: salon.timezone,
      staffName: chosenStaff.fullName,
      requestedAnyStaff
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
        awaitingFinalBookingConfirmation: true
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
        sessionAttributes: buildKnownSessionAttributes({
          aiAlternativeSlots: "[]",
          awaitingAlternativeSelection: "false",
          awaitingFinalBookingConfirmation: "true",
          bookingConfirmationAsked: "true",
          lastAskedSlot: "bookingConfirmation",
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
      const message = buildLexMessage({
        outcome: "BOOKED",
        appointmentStartTime: requestedStartTime,
        salonTimezone: salon.timezone,
        serviceName: callerServiceName,
        staffName: chosenStaff.fullName
      });
      const parsed = buildInternalParsedIntent({
        intentType: "BOOK_APPOINTMENT",
        customerName: normalized.customerName,
        customerPhone: normalized.customerPhone,
        serviceName: callerServiceName,
        staffPreference: chosenStaff.fullName,
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
    serviceName: callerServiceName,
    staffName: chosenStaff.fullName
  });
  const parsed = buildInternalParsedIntent({
    intentType: "BOOK_APPOINTMENT",
    customerName: normalized.customerName,
    customerPhone: normalized.customerPhone,
    serviceName: callerServiceName,
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
        bookingOutcome: "BOOKED",
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
