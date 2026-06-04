const API_BASE_URL = process.env.FASTAIBOOKING_API_BASE_URL;
const INTERNAL_TOKEN = process.env.FASTAIBOOKING_API_INTERNAL_TOKEN;
const DEFAULT_SALON_ID = process.env.DEFAULT_SALON_ID;
const DEFAULT_QUEUE_ID = process.env.AMAZON_CONNECT_QUEUE_ID_DEFAULT;
const DEFAULT_SALON_TIMEZONE =
  process.env.DEFAULT_SALON_TIMEZONE || process.env.SALON_TIMEZONE || "America/New_York";
const configuredApiTimeoutMs = Number(process.env.BOOKING_HANDLER_API_TIMEOUT_MS);
const API_TIMEOUT_MS =
  Number.isFinite(configuredApiTimeoutMs) && configuredApiTimeoutMs > 0
    ? configuredApiTimeoutMs
    : 3500;

const NUMBER_WORDS = {
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

const SPOKEN_HOUR_PATTERN =
  "one|two|three|tree|tri|four|five|fife|six|seven|eight|nine|ten|eleven|twelve";

const DATE_PHRASE_PATTERN =
  "\\b(?:tomorrow\\s+(?:morning|afternoon|evening|night)|this\\s+(?:morning|afternoon|evening)|tonight|today|tomorrow|(?:this|next)\\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\\b";

const MONTH_DAY_PATTERN =
  "\\b(?:january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sep|sept|october|oct|november|nov|december|dec)\\.?\\s+(?:\\d{1,2}(?:st|nd|rd|th)?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty\\s+first|twenty\\s+second|twenty\\s+third|twenty\\s+fourth|twenty\\s+fifth|twenty\\s+sixth|twenty\\s+seventh|twenty\\s+eighth|twenty\\s+ninth|thirtieth|thirty\\s+first)(?:\\s*,?\\s*\\d{4})?\\b";

const ISO_DATE_PATTERN = "\\b\\d{4}-\\d{2}-\\d{2}\\b";

const MONTH_NUMBERS = {
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

const ORDINAL_DAY_WORDS = {
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

const PEDICURE_ALIASES = [
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
  "pedic care",
  "pedi care",
  "pedicure appointment",
  "toe service",
  "foot service",
  "foot pedicure",
  "toe pedicure"
];

const DEMO_SERVICE_NAMES = ["Manicure", "Pedicure", "Gel Manicure", "Acrylic Full Set", "Dip Powder"];
const DEMO_STAFF_NAMES = ["Trang", "Amy", "Kelly"];
const SERVICE_DTMF_OPTIONS = {
  "1": "Pedicure",
  "2": "Manicure",
  "3": "Gel Manicure",
  "4": "Acrylic Full Set",
  "5": "Dip Powder"
};
const STAFF_DTMF_OPTIONS = {
  "1": "Trang",
  "2": "Amy",
  "3": "Kelly"
};
const SERVICE_DTMF_PROMPT =
  "What service would you like today? You can say Pedicure, Manicure, Gel Manicure, Acrylic Full Set, or Dip Powder. You can also press 1 for Pedicure, 2 for Manicure, 3 for Gel Manicure, 4 for Acrylic Full Set, or 5 for Dip Powder.";
const STAFF_DTMF_PROMPT =
  "Who would you like to book with? You can say Trang, Amy, or Kelly. You can also press 1 for Trang, 2 for Amy, or 3 for Kelly.";
const KNOWN_KIET_CUSTOMER_NAME = "Kiet";
const KNOWN_KIET_PHONE_DIGITS = new Set(["7325956266", "17325956266"]);

const SERVICE_ALIAS_GROUPS = {
  Pedicure: PEDICURE_ALIASES,
  Manicure: [
    "manicure",
    "mani cure",
    "manny cure",
    "many cure",
    "nanny cure",
    "mini cure",
    "manicure appointment",
    "hand service",
    "finger nail service"
  ],
  "Gel Manicure": [
    "gel manicure",
    "gel mani",
    "gel mani cure",
    "gel manny cure",
    "gel many cure",
    "jell manicure",
    "jail manicure",
    "gel nail",
    "gel nails",
    "gel hand service"
  ],
  "Acrylic Full Set": [
    "acrylic full set",
    "acrylic set",
    "acrylic",
    "acrylics",
    "acrilic",
    "acyclic",
    "full set",
    "full acrylic set",
    "fake nails",
    "extension nails"
  ],
  "Dip Powder": [
    "dip powder",
    "dip",
    "dip power",
    "deep powder",
    "dipping powder",
    "de powder",
    "dep powder",
    "powder dip",
    "dip nails"
  ]
};

const SERVICE_ALIASES = Object.values(SERVICE_ALIAS_GROUPS).flat();

const WEEKDAY_INDEXES = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};

const SLOT_ELICIT_PROMPTS = {
  serviceName: [
    SERVICE_DTMF_PROMPT,
    SERVICE_DTMF_PROMPT,
    SERVICE_DTMF_PROMPT
  ],
  staffPreference: [
    STAFF_DTMF_PROMPT,
    STAFF_DTMF_PROMPT,
    STAFF_DTMF_PROMPT
  ],
  requestedDate: [
    "What day would you like to come in?",
    "Could you repeat the appointment date?",
    "Do you want that today, tomorrow, or another day?"
  ],
  requestedTime: [
    "What time would you like?",
    "Could you repeat the appointment time?",
    "What time works best for you?"
  ],
  customerName: [
    "What name should I put the appointment under?",
    "Could you say your name for the booking?",
    "What is your name?"
  ],
  customerPhone: [
    "What phone number should I use for the appointment?",
    "Could you repeat your phone number?",
    "What is the best phone number for you?"
  ]
};

const slotNames = {
  customerName: ["customerName", "CustomerName"],
  customerPhone: ["customerPhone", "CustomerPhone"],
  serviceName: ["serviceName", "ServiceName", "service", "Service"],
  requestedDate: ["requestedDate", "RequestedDate", "preferredDate", "PreferredDate"],
  requestedTime: ["requestedTime", "RequestedTime", "preferredTime", "PreferredTime"],
  staffPreference: ["staffPreference", "StaffPreference"]
};

const attributeNames = {
  contactId: [
    "AmazonConnectContactId",
    "ContactId",
    "InitialContactId",
    "x-amz-connect-contact-id"
  ],
  calledNumber: [
    "CalledNumber",
    "DialedNumber",
    "SystemEndpointAddress",
    "SystemEndpoint",
    "amazonConnectPhoneNumber"
  ],
  customerNumber: [
    "CustomerEndpointAddress",
    "CustomerPhoneNumber",
    "CallerId",
    "ANI"
  ],
  transcript: ["Transcript", "transcript", "inputTranscript"],
  salonId: ["salonId", "SalonId"],
  timezone: ["salonTimezone", "SalonTimezone", "timezone", "Timezone", "timeZone", "TimeZone"]
};

const agentAvailabilityAttributeNames = [
  "agentsAvailable",
  "AgentsAvailable",
  "agentAvailable",
  "AgentAvailable",
  "availableAgents",
  "AvailableAgents",
  "queueAgentsAvailable",
  "QueueAgentsAvailable",
  "onlineAgents",
  "OnlineAgents"
];

const businessHoursAttributeNames = [
  "isBusinessHours",
  "IsBusinessHours",
  "withinBusinessHours",
  "WithinBusinessHours",
  "businessHoursOpen",
  "BusinessHoursOpen",
  "hoursOpen",
  "HoursOpen"
];

function normalizeForMatch(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeCustomerPhoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function stripLeadingCountryCode(value) {
  const digits = normalizeCustomerPhoneDigits(value);
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function isKnownKietCallerPhone(value) {
  const digits = normalizeCustomerPhoneDigits(value);
  const localDigits = stripLeadingCountryCode(value);
  return KNOWN_KIET_PHONE_DIGITS.has(digits) || KNOWN_KIET_PHONE_DIGITS.has(localDigits);
}

function compactForMatch(value) {
  return normalizeForMatch(value).replace(/\s/g, "");
}

function normalizeSpokenNumbers(value) {
  return String(value || "").replace(
    /\b(one|two|three|tree|tri|four|five|fife|six|seven|eight|nine|ten|eleven|twelve)\b/gi,
    (match) => String(NUMBER_WORDS[match.toLowerCase()] || match)
  );
}

function normalizeServiceName(value) {
  const compact = compactForMatch(value);
  if (!compact) {
    return value;
  }
  for (const [serviceName, aliases] of Object.entries(SERVICE_ALIAS_GROUPS)) {
    if (
      aliases.some((alias) => {
      const aliasCompact = compactForMatch(alias);
      return compact === aliasCompact || compact.includes(aliasCompact);
    })
    ) {
      return serviceName;
    }
  }
  return value;
}

function normalizePedicureService(value) {
  return normalizeServiceName(value);
}

function extractServiceFromTranscript(text) {
  const serviceName = normalizeServiceName(text);
  return DEMO_SERVICE_NAMES.includes(serviceName) ? serviceName : "";
}

function extractStaffFromTranscript(text) {
  const normalizedText = normalizeForMatch(text);
  if (!normalizedText) {
    return "";
  }
  return (
    DEMO_STAFF_NAMES.find((staffName) => {
      const fullName = normalizeForMatch(staffName);
      const firstName = normalizeForMatch(staffName.split(/\s+/)[0]);
      return normalizedText.includes(fullName) || normalizedText.includes(firstName);
    }) || ""
  );
}

function readDtmfDigit(value) {
  const match = String(value || "").trim().match(/^(?:dtmf\s*)?([1-5])#?$/i);
  return match?.[1] || "";
}

function readScopedDtmfSelection(event, expectedSlot, options) {
  const previous = event.sessionState?.sessionAttributes || {};
  const lastAskedSlot = previous.lastAskedSlot;
  if (lastAskedSlot !== expectedSlot) {
    return "";
  }
  const slots = event.sessionState?.intent?.slots || {};
  const candidateValues =
    expectedSlot === "serviceName"
      ? [
          event.inputTranscript,
          getSlotValue(slots, slotNames.serviceName, { preferOriginal: true }),
          getSessionAttribute(previous, slotNames.serviceName)
        ]
      : [
          event.inputTranscript,
          getSlotValue(slots, slotNames.staffPreference, { preferOriginal: true }),
          getSessionAttribute(previous, slotNames.staffPreference)
        ];
  for (const value of candidateValues) {
    const digit = readDtmfDigit(value);
    if (digit && options[digit]) {
      return options[digit];
    }
  }
  return "";
}

function extractCustomerNameFromText(text) {
  const match = String(text || "").match(
    /(?:my name is|name is|this is|i am|i'm)\s+([a-zA-Z][a-zA-Z'-]*(?:\s+[a-zA-Z][a-zA-Z'-]*){0,4})(?=\s*(?:[,.!?;]|$|and\s+(?:my\s+)?phone|(?:my\s+)?phone\s+(?:number\s+)?(?:is|should|to)))/i
  );
  return match?.[1]?.trim() || "";
}

function extractCustomerPhoneFromText(text) {
  const raw = String(text || "");
  const explicitPhoneMatch = raw.match(
    /(?:phone number is|phone is|call me at|reach me at)\s*(\+?1?[\s\-()]*[2-9]\d{2}[\s\-()]*[2-9]\d{2}[\s\-()]?\d{4})/i
  );
  const fallbackPhoneMatch = raw.match(
    /(\+?1?[\s\-()]*[2-9]\d{2}[\s\-()]*[2-9]\d{2}[\s\-()]?\d{4})/
  );
  return (explicitPhoneMatch?.[1] || fallbackPhoneMatch?.[1] || "").replace(/\D/g, "");
}

function getZonedDateParts(timeZone, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day)
  };
}

function formatDateParts(parts) {
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0")
  ].join("-");
}

function addDaysToDateParts(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate()
  };
}

function parseMonthDayDateParts(value, timeZone = DEFAULT_SALON_TIMEZONE) {
  const normalized = normalizeForMatch(value);
  const monthNames = Object.keys(MONTH_NUMBERS).join("|");
  const dayNames = Object.keys(ORDINAL_DAY_WORDS).sort((left, right) => right.length - left.length).join("|");
  const match = normalized.match(
    new RegExp(`\\b(${monthNames})\\s+((?:\\d{1,2}(?:st|nd|rd|th)?)|${dayNames})(?:\\s+(\\d{4}))?\\b`)
  );
  if (!match) {
    return null;
  }

  const month = MONTH_NUMBERS[match[1] || ""];
  const dayText = match[2] || "";
  const numericDay = dayText.match(/^\d{1,2}/)?.[0];
  const day = numericDay ? Number(numericDay) : ORDINAL_DAY_WORDS[dayText];
  if (!month || !day) {
    return null;
  }

  const todayParts = getZonedDateParts(timeZone);
  const year = match[3] ? Number(match[3]) : todayParts.year;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

function getZonedWeekdayIndex(timeZone, date = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long"
  }).format(date).toLowerCase();
  return WEEKDAY_INDEXES[weekday] ?? 0;
}

function resolveDatePhrase(value, timeZone = DEFAULT_SALON_TIMEZONE) {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return "";
  }
  const monthDayDateParts = parseMonthDayDateParts(value, timeZone);
  if (monthDayDateParts) {
    return formatDateParts(monthDayDateParts);
  }
  const isoDateMatch = String(value || "").trim().match(/^\d{4}-\d{2}-\d{2}$/);
  if (isoDateMatch) {
    return isoDateMatch[0];
  }
  const todayParts = getZonedDateParts(timeZone);
  if (normalized.startsWith("tomorrow")) {
    return formatDateParts(addDaysToDateParts(todayParts, 1));
  }
  if (
    normalized === "today" ||
    normalized === "this morning" ||
    normalized === "this afternoon" ||
    normalized === "this evening" ||
    normalized === "tonight"
  ) {
    return formatDateParts(todayParts);
  }

  const weekdayMatch = normalized.match(
    /^(?:(this|next)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/
  );
  if (weekdayMatch) {
    const prefix = weekdayMatch[1] || "";
    const targetWeekday = WEEKDAY_INDEXES[weekdayMatch[2]];
    const currentWeekday = getZonedWeekdayIndex(timeZone);
    let daysUntil = (targetWeekday - currentWeekday + 7) % 7;
    if (prefix === "next" || (!prefix && daysUntil === 0)) {
      daysUntil += 7;
    }
    return formatDateParts(addDaysToDateParts(todayParts, daysUntil));
  }
  return normalized;
}

function resolveKnownDateValue(value, timeZone = DEFAULT_SALON_TIMEZONE) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }
  if (new RegExp(MONTH_DAY_PATTERN, "i").test(raw)) {
    return resolveDatePhrase(raw, timeZone);
  }

  const normalized = normalizeForMatch(raw);
  if (
    normalized.startsWith("tomorrow") ||
    normalized === "today" ||
    normalized === "this morning" ||
    normalized === "this afternoon" ||
    normalized === "this evening" ||
    normalized === "tonight" ||
    /^(?:(this|next)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.test(normalized)
  ) {
    return resolveDatePhrase(raw, timeZone);
  }

  return raw;
}

function extractTimeCandidate(value) {
  const segment = String(value || "")
    .replace(/\b([ap])\s*\.?\s*m\.?\b/gi, "$1m")
    .replace(/^\s*(?:at|around|about|for|by)\s+/i, "")
    .split(/[,.!?;]/)[0]
    ?.trim();
  if (!segment) {
    return "";
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
  return leadingBareMatch?.[1] || "";
}

function getPreferredDateCandidate(raw) {
  const collect = (pattern, kind) =>
    Array.from(String(raw || "").matchAll(new RegExp(pattern, "gi")))
      .filter((match) => match[0] && match.index !== undefined)
      .map((match) => ({
        text: match[0],
        index: match.index,
        kind
      }));
  const explicitMatches = [
    ...collect(ISO_DATE_PATTERN, "explicit"),
    ...collect(MONTH_DAY_PATTERN, "explicit")
  ].sort((left, right) => left.index - right.index);
  if (explicitMatches.length) {
    return explicitMatches.at(-1);
  }
  return collect(DATE_PHRASE_PATTERN, "relative").sort((left, right) => left.index - right.index)[0] || null;
}

function normalizeTimePhrase(value, datePhrase = "") {
  const normalized = normalizeSpokenNumbers(value)
    .replace(/\b([ap])\s*\.?\s*m\.?\b/gi, "$1m")
    .replace(/\ba\.?m\.?\b/gi, "am")
    .replace(/\bp\.?m\.?\b/gi, "pm")
    .trim();
  const context = normalizeForMatch(`${datePhrase} ${value}`);
  const hasMorningContext = /\bmorning\b/.test(context);
  const hasAfternoonContext = /\b(afternoon|evening|tonight|night)\b/.test(context);
  const periodMatch = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  let hour;
  let minute = 0;
  let period = "";

  if (periodMatch) {
    hour = Number(periodMatch[1]);
    minute = Number(periodMatch[2] || 0);
    period = periodMatch[3]?.toUpperCase() || "";
  } else {
    const timeMatch = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\b/);
    if (!timeMatch) {
      return "";
    }
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2] || 0);
    if (hour < 1 || hour > 23 || minute > 59) {
      return "";
    }
    if (hour > 12) {
      period = "PM";
      hour -= 12;
    } else if (hasMorningContext) {
      period = "AM";
    } else if (hasAfternoonContext || (hour >= 1 && hour <= 7)) {
      period = "PM";
    } else {
      return "";
    }
  }

  if (hour < 1 || hour > 12 || minute > 59) {
    return "";
  }
  return minute === 0 ? `${hour} ${period}` : `${hour}:${String(minute).padStart(2, "0")} ${period}`;
}

function isClearlyInvalidServiceName(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return false;
  }
  const normalized = normalizeForMatch(raw);
  const digits = raw.replace(/\D/g, "");
  if (/^(?:am|pm|a m|p m)$/.test(normalized)) {
    return true;
  }
  if (/^(?:yes|yeah|yep|correct|right|sure|ok|okay|no|nope)$/.test(normalized)) {
    return true;
  }
  if (/^(?:time|phone|phone number)$/.test(normalized)) {
    return true;
  }
  if (digits.length >= 7) {
    return true;
  }
  if (/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw)) {
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
  if (normalizeTimePhrase(raw)) {
    return true;
  }
  if (new RegExp(`^(?:${DATE_PHRASE_PATTERN}|${MONTH_DAY_PATTERN}|${ISO_DATE_PATTERN})$`, "i").test(raw)) {
    return true;
  }
  return false;
}

function extractBookingDetailsFromText(text, timeZone = DEFAULT_SALON_TIMEZONE) {
  const raw = String(text || "");
  const serviceName = extractServiceFromTranscript(raw);
  const dateMatch = getPreferredDateCandidate(raw);
  const requestedDate = dateMatch?.text ? resolveDatePhrase(dateMatch.text, timeZone) : "";
  let requestedTime = "";

  if (dateMatch?.text && dateMatch.index !== undefined) {
    const afterDate = raw.slice(dateMatch.index + dateMatch.text.length);
    const beforeDate = raw.slice(0, dateMatch.index);
    const timeCandidate =
      extractTimeCandidate(afterDate) ||
      extractTimeCandidate(beforeDate.split(/[!?;]/).at(-1) || "") ||
      extractTimeCandidate(raw);
    requestedTime = normalizeTimePhrase(timeCandidate, dateMatch.text);
  } else {
    requestedTime = normalizeTimePhrase(extractTimeCandidate(raw));
  }

  return {
    customerName: extractCustomerNameFromText(raw),
    customerPhone: extractCustomerPhoneFromText(raw),
    serviceName,
    requestedDate,
    requestedTime
  };
}

function isHumanEscalationRequest(intentName, text) {
  return intentName === "HumanEscalationIntent";
}

function getOptionalAttribute(event, names) {
  const sources = [
    event.sessionState?.sessionAttributes,
    event.requestAttributes,
    event.inputTranscript ? { inputTranscript: event.inputTranscript } : null
  ].filter(Boolean);

  for (const source of sources) {
    for (const name of names) {
      if (!Object.prototype.hasOwnProperty.call(source, name)) {
        continue;
      }
      const value = source?.[name];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        return String(value).trim();
      }
    }
  }
  return "";
}

function isNegativeAvailabilityValue(value) {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return false;
  }
  if (/^(false|no|none|zero|closed|offline|off|unavailable|not available)$/.test(normalized)) {
    return true;
  }
  const numeric = Number(String(value).trim());
  return Number.isFinite(numeric) && numeric <= 0;
}

function isHumanAvailabilityBlocked(event) {
  const agentAvailability = getOptionalAttribute(event, agentAvailabilityAttributeNames);
  if (isNegativeAvailabilityValue(agentAvailability)) {
    return true;
  }

  const businessHours = getOptionalAttribute(event, businessHoursAttributeNames);
  return isNegativeAvailabilityValue(businessHours);
}

function isRecognizedService(value) {
  if (isClearlyInvalidServiceName(value)) {
    return false;
  }
  const compact = compactForMatch(value);
  return SERVICE_ALIASES.some((alias) => {
    const aliasCompact = compactForMatch(alias);
    return compact === aliasCompact || compact.includes(aliasCompact);
  });
}

function isBookingLikeUtterance(text) {
  return /\b(book|booking|schedule|appointment|service|nail|pedicure|manicure|today|tomorrow)\b/i.test(
    text || ""
  );
}

function shouldPromptForServiceFallback(event, intentName) {
  const previous = event.sessionState?.sessionAttributes || {};
  if (readScopedDtmfSelection(event, "serviceName", SERVICE_DTMF_OPTIONS)) {
    return false;
  }
  if (previous.serviceFallbackOffered === "true") {
    return false;
  }

  const transcript = [
    event.inputTranscript,
    getAttribute(event, attributeNames.transcript)
  ].filter(Boolean).join(" ");
  const fallbackIntent =
    intentName === "FallbackIntent" ||
    intentName === "AMAZON.FallbackIntent" ||
    intentName === "";
  if (fallbackIntent) {
    return isBookingLikeUtterance(transcript);
  }

  if (intentName !== "BookAppointmentIntent") {
    return false;
  }

  const serviceName = getKnownField(event, "serviceName", { preferOriginal: true });
  if (!serviceName || normalizePedicureService(serviceName) === "Pedicure") {
    return false;
  }
  if (isRecognizedService(serviceName)) {
    return false;
  }
  return isBookingLikeUtterance(`${transcript} ${serviceName}`);
}

function isNoInputEvent(event) {
  const transcript = String(event.inputTranscript || "").trim();
  if (!transcript) {
    return true;
  }

  const normalized = normalizeForMatch(transcript);
  return /^(no input|noinput|silence|silent|timeout|timed out)$/.test(normalized);
}

function parseAttemptCount(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function promptIndexFor(event, slotName, attemptCount, promptCount) {
  const seed = `${event.sessionId || ""}:${event.inputTranscript || ""}:${slotName}:${attemptCount}`;
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return promptCount > 0 ? hash % promptCount : 0;
}

function getElicitPrompt(event, slotName, attemptCount) {
  const prompts = SLOT_ELICIT_PROMPTS[slotName] || SLOT_ELICIT_PROMPTS.serviceName;
  return prompts[promptIndexFor(event, slotName, attemptCount, prompts.length)] || prompts[0];
}

function isValidCustomerPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10;
}

function getSlotValue(slots, names, options = {}) {
  for (const name of names) {
    const slot = slots?.[name];
    const value = options.preferOriginal
      ? slot?.value?.originalValue || slot?.value?.interpretedValue
      : slot?.value?.interpretedValue || slot?.value?.originalValue;
    if (value) {
      return String(value).trim();
    }
  }
  return "";
}

function getAttribute(event, names) {
  const sources = [
    event.sessionState?.sessionAttributes,
    event.requestAttributes,
    event.inputTranscript ? { inputTranscript: event.inputTranscript } : null
  ].filter(Boolean);

  for (const source of sources) {
    for (const name of names) {
      const value = source?.[name];
      if (value) {
        return String(value).trim();
      }
    }
  }
  return "";
}

function getSessionAttribute(sessionAttributes, names) {
  for (const name of names) {
    const value = sessionAttributes?.[name];
    if (value) {
      return String(value).trim();
    }
  }
  return "";
}

function getKnownField(event, fieldName, options = {}) {
  const slots = event.sessionState?.intent?.slots || {};
  const sessionAttributes = event.sessionState?.sessionAttributes || {};
  const names = slotNames[fieldName] || [fieldName];
  return (
    getSlotValue(slots, names, options) ||
    getSessionAttribute(sessionAttributes, names)
  );
}

function buildKnownBookingSessionAttributes(event) {
  const previous = event.sessionState?.sessionAttributes || {};
  const initial = previous.initialBookingUtterance || event.inputTranscript || "";
  const timeZone = getAttribute(event, attributeNames.timezone) || DEFAULT_SALON_TIMEZONE;
  const transcript = [event.inputTranscript, getAttribute(event, attributeNames.transcript), initial]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(" ");
  const recovered = extractBookingDetailsFromText(transcript, timeZone);
  const knownDate = getKnownField(event, "requestedDate");
  const knownTime = getKnownField(event, "requestedTime", { preferOriginal: true });
  const rawKnownService = getKnownField(event, "serviceName");
  const serviceDtmfSelection = readScopedDtmfSelection(event, "serviceName", SERVICE_DTMF_OPTIONS);
  const staffDtmfSelection = readScopedDtmfSelection(event, "staffPreference", STAFF_DTMF_OPTIONS);
  const normalizedKnownService = normalizeServiceName(rawKnownService);
  const knownService =
    normalizedKnownService && !isClearlyInvalidServiceName(normalizedKnownService)
      ? normalizedKnownService
      : "";
  const explicitCustomerName = recovered.customerName;
  const amazonConnectCustomerPhone = getAttribute(event, attributeNames.customerNumber);
  const knownCallerName = isKnownKietCallerPhone(amazonConnectCustomerPhone)
    ? KNOWN_KIET_CUSTOMER_NAME
    : "";
  const protectedCustomerName =
    previous.recognizedCustomerName ||
    (previous.customerNameSource === "phone_lookup" ? previous.customerName : "") ||
    knownCallerName;
  const known = {
    recognizedCustomerName: knownCallerName || previous.recognizedCustomerName,
    customerNameSource:
      knownCallerName || previous.customerNameSource === "phone_lookup"
        ? "phone_lookup"
        : previous.customerNameSource,
    customerName:
      explicitCustomerName ||
      protectedCustomerName ||
      getKnownField(event, "customerName"),
    customerPhone:
      amazonConnectCustomerPhone ||
      getKnownField(event, "customerPhone") ||
      recovered.customerPhone ||
      amazonConnectCustomerPhone,
    serviceName: serviceDtmfSelection || knownService || recovered.serviceName,
    requestedDate: recovered.requestedDate || resolveKnownDateValue(knownDate, timeZone),
    requestedTime:
      recovered.requestedTime ||
      normalizeTimePhrase(knownTime) ||
      knownTime,
    staffPreference:
      staffDtmfSelection ||
      getKnownField(event, "staffPreference") ||
      extractStaffFromTranscript(transcript),
    confirmedServiceName:
      serviceDtmfSelection ||
      previous.confirmedServiceName,
    confirmedStaffName:
      staffDtmfSelection ||
      previous.confirmedStaffName,
    initialBookingUtterance: initial
  };

  return {
    ...previous,
    ...Object.fromEntries(
      Object.entries(known).filter(([, value]) => value !== undefined && value !== "")
    )
  };
}

function buildLexSlot(value) {
  return {
    shape: "Scalar",
    value: {
      originalValue: value,
      interpretedValue: value,
      resolvedValues: [value]
    }
  };
}

function mergeKnownSlots(event) {
  const slots = { ...(event.sessionState?.intent?.slots || {}) };
  const sessionAttributes = buildKnownBookingSessionAttributes(event);
  const fields = [
    "customerName",
    "customerPhone",
    "serviceName",
    "requestedDate",
    "requestedTime",
    "staffPreference"
  ];

  for (const field of fields) {
    const names = slotNames[field] || [field];
    const currentValue = getSlotValue(slots, names, {
      preferOriginal: field === "requestedTime"
    });
    const sessionValue = getSessionAttribute(sessionAttributes, names);
    const preferSessionValue =
      ["serviceName", "requestedDate", "requestedTime"].includes(field) ||
      (["customerName", "customerPhone"].includes(field) &&
        Boolean(sessionAttributes.recognizedCustomerName || sessionAttributes.customerNameSource === "phone_lookup"));
    const value = preferSessionValue
      ? sessionValue ||
        currentValue ||
        getKnownField(event, field, {
          preferOriginal: field === "requestedTime"
        })
      : currentValue ||
        sessionValue ||
        getKnownField(event, field, {
          preferOriginal: field === "requestedTime"
        });
    if (!value) {
      continue;
    }
    const slotName = names.find((name) => Object.prototype.hasOwnProperty.call(slots, name)) || names[0];
    slots[slotName] = slots[slotName]?.value && value === currentValue ? slots[slotName] : buildLexSlot(value);
  }

  return slots;
}

function getBookingSlotToElicit(event) {
  const sessionAttributes = buildKnownBookingSessionAttributes(event);
  const serviceName = getSessionAttribute(sessionAttributes, slotNames.serviceName);
  if (!serviceName) {
    return "serviceName";
  }
  if (normalizePedicureService(serviceName) !== "Pedicure" && !isRecognizedService(serviceName)) {
    return "serviceName";
  }

  const requestedDate = getSessionAttribute(sessionAttributes, slotNames.requestedDate);
  if (!requestedDate || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    return "requestedDate";
  }

  const requestedTime = getSessionAttribute(sessionAttributes, slotNames.requestedTime);
  if (!requestedTime) {
    return "requestedTime";
  }

  const staffPreference = getSessionAttribute(sessionAttributes, slotNames.staffPreference);
  if (!staffPreference) {
    return "staffPreference";
  }

  const customerName = getSessionAttribute(sessionAttributes, slotNames.customerName);
  if (!customerName) {
    return "customerName";
  }

  const customerPhone = getSessionAttribute(sessionAttributes, slotNames.customerPhone);
  if (!isValidCustomerPhone(customerPhone)) {
    return "customerPhone";
  }

  return "";
}

function buildElicitSlotResponse(event, slotName, extraAttributes = {}) {
  const slots = mergeKnownSlots(event);
  const sessionAttributes = buildKnownBookingSessionAttributes(event);
  const names = slotNames[slotName] || [slotName];
  const slotToElicit =
    names.find((name) => Object.prototype.hasOwnProperty.call(slots, name)) || slotName;
  for (const name of names) {
    delete sessionAttributes[name];
  }
  slots[slotToElicit] = null;
  const previous = event.sessionState?.sessionAttributes || {};
  const previousCount = parseAttemptCount(previous.askedSlotsCount || previous.fallbackCount);
  const attemptCount = previous.lastAskedSlot === slotName ? previousCount + 1 : 1;

  return {
    sessionState: {
      sessionAttributes: {
        ...sessionAttributes,
        ...extraAttributes,
        lastAskedSlot: slotName,
        askedSlotsCount: String(attemptCount),
        fallbackCount: String(attemptCount),
        errorCount: String(attemptCount)
      },
      dialogAction: {
        type: "ElicitSlot",
        slotToElicit
      },
      intent: {
        name: "BookAppointmentIntent",
        state: "InProgress",
        confirmationState: "None",
        slots
      }
    },
    messages: [
      {
        contentType: "PlainText",
        content: getElicitPrompt(event, slotName, attemptCount)
      }
    ]
  };
}

function buildBookServiceElicitResponse(event) {
  return buildElicitSlotResponse(event, "serviceName", {
    serviceFallbackOffered: "true"
  });
}

function buildForceHumanEscalationAttributes(reason, extra = {}) {
  return {
    forceHumanEscalation: "true",
    transferToQueue: "true",
    escalationReason: reason,
    fallbackMode: "operator_queue",
    ...(DEFAULT_QUEUE_ID ? { queueId: DEFAULT_QUEUE_ID } : {}),
    ...extra
  };
}

function normalizeBackendFailureReason(code) {
  return code === "backend_timeout" ? "backend_timeout" : "backend_error";
}

function buildBackendFailureEscalationResponse(event, result) {
  const reason = normalizeBackendFailureReason(result?.code);
  return buildLexResponse(
    event,
    reason === "backend_timeout"
      ? '<speak>The booking system is taking too long to respond. <break time="300ms"/> Please hold while I connect you with our team.</speak>'
      : '<speak>I cannot reach the booking system right now. <break time="300ms"/> Please hold while I connect you with our team.</speak>',
    "Failed",
    buildForceHumanEscalationAttributes(reason)
  );
}

function buildBackendFailureElicitResponse(event, result) {
  return buildElicitSlotResponse(
    event,
    getBookingSlotToElicit(event) || "serviceName",
    {
      backendFailureReason: normalizeBackendFailureReason(result?.code),
      forceHumanEscalation: "false",
      transferToQueue: "false"
    }
  );
}

function buildNoAgentsAvailableResponse(event) {
  return buildLexResponse(
    event,
    "No agents available.",
    "Fulfilled",
    {
      forceHumanEscalation: "false",
      transferToQueue: "false",
      escalationReason: "agents_unavailable",
      noAgentsAvailable: "true"
    },
    {
      messageContentType: "PlainText"
    }
  );
}

function normalizeDialogAction(lexResponse) {
  const action = lexResponse?.dialogAction;
  if (action?.type) {
    return action;
  }
  return {
    type: "Close"
  };
}

function buildLexResponse(event, message, state = "Fulfilled", sessionAttributes = {}, lexResponse = {}) {
  const intent = event.sessionState?.intent || {};
  const dialogAction = normalizeDialogAction(lexResponse);
  const nextState = dialogAction.type === "Close" ? state : "InProgress";
  const contentType =
    lexResponse.messageContentType || (String(message || "").trim().startsWith("<speak>") ? "SSML" : "PlainText");
  return {
    sessionState: {
      sessionAttributes: {
        ...buildKnownBookingSessionAttributes(event),
        ...sessionAttributes,
        ...(lexResponse.sessionAttributes || {})
      },
      dialogAction,
      intent: {
        ...intent,
        state: nextState
      }
    },
    messages: [
      {
        contentType,
        content: message
      }
    ]
  };
}

function buildDelegateResponse(event) {
  const intent = event.sessionState?.intent || {};
  return {
    sessionState: {
      sessionAttributes: buildKnownBookingSessionAttributes(event),
      dialogAction: {
        type: "Delegate"
      },
      intent: {
        ...intent,
        slots: mergeKnownSlots(event)
      }
    }
  };
}

async function postInternalAppointment(payload) {
  if (!API_BASE_URL || !INTERNAL_TOKEN) {
    return {
      ok: false,
      message: "The booking system is not fully configured yet.",
      code: "backend_not_configured"
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/internal/ai/appointments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${INTERNAL_TOKEN}`,
        Connection: "keep-alive"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (error) {
    return {
      ok: false,
      message:
        error?.name === "AbortError"
          ? "The booking system timed out."
          : "The booking system could not be reached.",
      code: error?.name === "AbortError" ? "backend_timeout" : "backend_unreachable"
    };
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text();
    return {
      ok: false,
      message: text || "I could not create the appointment right now.",
      code: "backend_error"
    };
  }

  return {
    ok: true,
    data: await response.json()
  };
}

function buildInternalPayload(event, intentName) {
  const slots = event.sessionState?.intent?.slots || {};
  const sessionAttributes = buildKnownBookingSessionAttributes(event);
  const knownField = (fieldName, options = {}) =>
    getSessionAttribute(sessionAttributes, slotNames[fieldName] || [fieldName]) ||
    getKnownField(event, fieldName, options);
  const backendIntentName = isHumanEscalationRequest(intentName)
    ? "HumanEscalationIntent"
    : intentName;
  const calledNumber = getAttribute(event, attributeNames.calledNumber);
  const amazonConnectContactId =
    getAttribute(event, attributeNames.contactId) || event.sessionId || undefined;
  const amazonConnectPhoneNumber = calledNumber || undefined;
  const customerPhone =
    knownField("customerPhone") ||
    getAttribute(event, attributeNames.customerNumber);
  const initialUtterance =
    getAttribute(event, ["initialBookingUtterance"]) ||
    sessionAttributes.initialBookingUtterance;
  const transcript = [initialUtterance, event.inputTranscript || getAttribute(event, attributeNames.transcript)]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(" ");

  const payload = {
    intentName: backendIntentName,
    provider: "AMAZON_CONNECT",
    customerName: knownField("customerName"),
    customerPhone,
    serviceName: knownField("serviceName"),
    requestedDate: knownField("requestedDate"),
    requestedTime: knownField("requestedTime", { preferOriginal: true }),
    staffPreference: knownField("staffPreference"),
    confirmationState: event.sessionState?.intent?.confirmationState,
    transcript,
    source: "amazon_connect_ai",
    amazonConnectContactId,
    callSessionId: sessionAttributes.callSessionId,
    amazonConnectPhoneNumber,
    calledNumber: calledNumber || undefined,
    slots,
    attributes: sessionAttributes
  };

  const explicitSalonId = getAttribute(event, attributeNames.salonId);
  if (explicitSalonId) {
    payload.salonId = explicitSalonId;
  } else if (!calledNumber && DEFAULT_SALON_ID) {
    payload.salonId = DEFAULT_SALON_ID;
  }

  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined && value !== "")
  );
}

function extractResultPayload(result) {
  const data = result?.data?.data || result?.data;
  return data && typeof data === "object" ? data : {};
}

function buildSessionAttributesFromResult(data) {
  const lexAttributes =
    data.lexResponse?.sessionAttributes && typeof data.lexResponse.sessionAttributes === "object"
      ? data.lexResponse.sessionAttributes
      : {};
  return {
    ...lexAttributes,
    ...Object.fromEntries(
      Object.entries({
        bookingOutcome: data.outcome,
        appointmentId: data.appointment?.id,
        bookingAttemptId: data.bookingAttemptId,
        callSessionId: data.callSessionId,
        escalationId: data.escalationId
      }).filter(([, value]) => value !== undefined && value !== null && value !== "")
    )
  };
}

function removeTransferSessionAttributes(lexResponse) {
  if (!lexResponse || typeof lexResponse !== "object") {
    return lexResponse;
  }
  const sessionAttributes = {
    ...(lexResponse.sessionAttributes || {})
  };
  for (const key of ["forceHumanEscalation", "transferToQueue", "queueId", "fallbackMode"]) {
    delete sessionAttributes[key];
  }
  return {
    ...lexResponse,
    sessionAttributes
  };
}

export const handler = async (event) => {
  try {
    const intentName = event.sessionState?.intent?.name || "";
    const shouldEscalate = isHumanEscalationRequest(intentName);

    if (event.invocationSource === "DialogCodeHook" && !shouldEscalate && isNoInputEvent(event)) {
      const slotToElicit = getBookingSlotToElicit(event);
      if (slotToElicit) {
        return buildElicitSlotResponse(event, slotToElicit, {
          noInputPrompted: "true"
        });
      }
    }

    if (!shouldEscalate && shouldPromptForServiceFallback(event, intentName)) {
      return buildBookServiceElicitResponse(event);
    }

    if (!shouldEscalate && intentName === "BookAppointmentIntent") {
      const slotToElicit = getBookingSlotToElicit(event);
      if (slotToElicit) {
        return buildElicitSlotResponse(event, slotToElicit);
      }
    }

    if (event.invocationSource === "DialogCodeHook" && !shouldEscalate) {
      return buildDelegateResponse(event);
    }

    if (shouldEscalate) {
      if (isHumanAvailabilityBlocked(event)) {
        return buildNoAgentsAvailableResponse(event);
      }
      const result = await postInternalAppointment(buildInternalPayload(event, intentName));
      if (!result.ok) {
        console.error("Appointment API rejected escalation request", result.code);
        return buildBackendFailureEscalationResponse(event, result);
      }
      const data = extractResultPayload(result);
      return buildLexResponse(
        event,
        data.lexResponse?.message || "Please wait while I connect you.",
        data.lexResponse?.fulfillmentState || "Fulfilled",
        buildSessionAttributesFromResult(data),
        data.lexResponse
      );
    }

    if (intentName === "CancelAppointmentIntent") {
      const result = await postInternalAppointment(buildInternalPayload(event, intentName));
      if (!result.ok) {
        console.error("Appointment API rejected cancel request", result.code);
        return buildBackendFailureEscalationResponse(event, result);
      }
      const data = extractResultPayload(result);
      return buildLexResponse(
        event,
        data.lexResponse?.message ||
          "Please wait while I connect you.",
        data.lexResponse?.fulfillmentState || "Fulfilled",
        buildSessionAttributesFromResult(data),
        data.lexResponse
      );
    }

    if (intentName === "RescheduleAppointmentIntent") {
      const result = await postInternalAppointment(buildInternalPayload(event, intentName));
      if (!result.ok) {
        console.error("Appointment API rejected reschedule request", result.code);
        return buildBackendFailureEscalationResponse(event, result);
      }
      const data = extractResultPayload(result);
      return buildLexResponse(
        event,
        data.lexResponse?.message ||
          "Please wait while I connect you.",
        data.lexResponse?.fulfillmentState || "Fulfilled",
        buildSessionAttributesFromResult(data),
        data.lexResponse
      );
    }

    if (intentName !== "BookAppointmentIntent") {
      return buildLexResponse(
        event,
        "I can help you book, update, or cancel an appointment."
      );
    }

    const result = await postInternalAppointment(buildInternalPayload(event, intentName));

    if (!result.ok) {
      console.error("Appointment API rejected request", result.code);
      return buildBackendFailureElicitResponse(event, result);
    }

    const data = extractResultPayload(result);
    if (
      data.outcome === "HUMAN_ESCALATION" ||
      data.outcome === "FAILED" ||
      (data.outcome !== "BOOKED" && data.lexResponse?.sessionAttributes?.transferToQueue === "true")
    ) {
      return buildElicitSlotResponse(
        event,
        getBookingSlotToElicit(event) || "serviceName",
        {
          forceHumanEscalation: "false",
          transferToQueue: "false",
          blockedEscalationOutcome: data.outcome || "backend_transfer"
        }
      );
    }

    const lexResponse = removeTransferSessionAttributes(data.lexResponse);
    const safeData = {
      ...data,
      lexResponse
    };
    const state = data.lexResponse?.fulfillmentState || (data.outcome === "BOOKED" ? "Fulfilled" : "Failed");
    const message =
      lexResponse?.message ||
      (data.outcome === "BOOKED"
        ? "<speak>You're all set. <break time=\"300ms\"/> Your appointment is booked. Thank you for calling.</speak>"
        : '<speak>I could not confirm the booking yet. <break time="300ms"/> Please hold while I connect you with our team.</speak>');

    return buildLexResponse(
      event,
      message,
      state,
      buildSessionAttributesFromResult(safeData),
      lexResponse
    );
  } catch (error) {
    console.error("Booking handler error", error);
    const caughtIntentName = event.sessionState?.intent?.name || "";
    if (!isHumanEscalationRequest(caughtIntentName)) {
      return buildElicitSlotResponse(
        event,
        getBookingSlotToElicit(event) || "serviceName",
        {
          forceHumanEscalation: "false",
          transferToQueue: "false",
          handlerError: "true"
        }
      );
    }
    return buildLexResponse(
      event,
      '<speak>Something went wrong while creating the appointment. <break time="300ms"/> Please hold while I connect you with our team.</speak>',
      "Failed",
      buildForceHumanEscalationAttributes("backend_error")
    );
  }
};
