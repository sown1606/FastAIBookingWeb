import { createHash } from "node:crypto";

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
    : 5000;

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
const SPOKEN_MINUTE_PATTERN =
  "[0-5]\\d|zero|oh|o|ten|fifteen|twenty(?:\\s+(?:one|two|three|four|five|six|seven|eight|nine))?|thirty(?:\\s+(?:one|two|three|four|five|six|seven|eight|nine))?|forty(?:\\s+(?:one|two|three|four|five|six|seven|eight|nine))?|fourty(?:\\s+(?:one|two|three|four|five|six|seven|eight|nine))?|fifty(?:\\s+(?:one|two|three|four|five|six|seven|eight|nine))?";
const SPOKEN_MINUTE_BASE = {
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
  "eddie here",
  "pedic care",
  "pedi care",
  "pedicure appointment",
  "toe service",
  "foot service",
  "foot pedicure",
  "toe pedicure",
  "p t q",
  "ptq"
];

const DEMO_SERVICE_NAMES = [
  "Manicure",
  "Pedicure",
  "Gel Manicure",
  "Full Set",
  "Dip Powder"
];
const SERVICE_DTMF_OPTIONS = {
  "1": "Pedicure",
  "2": "Manicure",
  "3": "Gel Manicure",
  "4": "Full Set",
  "5": "Dip Powder",
  "0": "__operator__"
};
const STAFF_DTMF_OPTIONS = {
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
const STAFF_ALIAS_GROUPS = {
  Trang: ["trang", "chang", "jang", "jan", "jen", "train", "trangg", "dang"],
  Amy: ["amy", "amie", "aimee", "emmy", "emmie", "a me"],
  Kelly: ["kelly", "kelley", "keli", "ke li"],
  Kevin: ["kevin", "kenvin"]
};
const TRANG_ASR_CONFUSION_ALIASES = new Set(["frank", "jen", "hang"]);
const ANY_STAFF_ALIASES = [
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
  "whoever is available",
  "who is available",
  "anyone is fine",
  "anyone available",
  "first available",
  "the first available",
  "for available",
  "first avaiable",
  "first available one",
  "someone available"
];
const CONTEXTUAL_ANY_STAFF_ALIASES = [
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
];
const ANY_STAFF_TRAILING_FILLER_PATTERN =
  "\\s+(?:is\\s+(?:fine|okay|ok)|works\\s+for\\s+me|if\\s+i|please)$";
const OPERATOR_TRANSFER_PROMPT = "Let me check for an available operator.";
const OPERATOR_BUSY_PROMPT = "All of our operators are currently busy. Please call back later. Goodbye.";
const SERVICE_DTMF_PROMPT =
  "Hi, I can help book your appointment. Tell me the service, day, time, and staff. You can press 0 for a person.";
const SERVICE_KEYPAD_PROMPT =
  "Sure. Which service would you like?";
const SERVICE_DTMF_SHORT_PROMPT =
  "I can list the services once. Please say the service name, or press 0 for a person.";
const STAFF_DTMF_PROMPT =
  "Which staff would you like, Trang, Amy, Kelly, or first available?";
const STAFF_DTMF_SHORT_PROMPT =
  "For staff, press 1 for Trang, 2 for Amy, 3 for Kelly, 4 for first available, or 0 for an operator.";
const NO_INPUT_HUMAN_CONFIRM_PROMPT =
  "Are you still there? Would you like me to connect you to a real person? You can press 0 for an operator.";
const WAIT_PROMPTS = {
  customer_lookup: "Please wait a moment while I pull up your information.",
  service_lookup: "Please wait a moment while I check our services.",
  staff_lookup: "Please wait a moment while I check available staff.",
  staff_dtmf_options: "Please wait a moment while I check available staff.",
  availability_lookup: "Please give me a moment while I check availability.",
  appointment_creation: "Please wait while I create your appointment.",
  appointment_update: "Please wait while I look up your appointment.",
  notification_send: "Please wait while I create your appointment.",
  operator_escalation: OPERATOR_TRANSFER_PROMPT
};

const SERVICE_ALIAS_GROUPS = {
  Pedicure: PEDICURE_ALIASES,
  Manicure: [
    "manicure",
    "mani cure",
    "manny cure",
    "many cure",
    "nanny cure",
    "mini cure",
    "mini q",
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
  "Full Set": [
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
    "fake nails",
    "extension nails",
    "nail extensions",
    "set of nails",
    "full set appointment"
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
  ],
  "Other Services": [
    "other services",
    "other service",
    "others services",
    "something else",
    "different service",
    "custom service"
  ]
};

const SERVICE_ALIASES = Object.values(SERVICE_ALIAS_GROUPS).flat();
const DEDICATED_FULL_SET_ALIASES = [
  "full set",
  "fullset",
  "full-set"
];
const LOW_CONFIDENCE_FULL_SET_ALIASES = new Set(
  DEDICATED_FULL_SET_ALIASES
    .filter((alias) => !["full set", "fullset", "full-set"].includes(alias))
    .map(compactForMatch)
);

const WEEKDAY_INDEXES = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};
const WEEKDAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const SLOT_ELICIT_PROMPTS = {
  serviceName: [
    SERVICE_KEYPAD_PROMPT,
    SERVICE_KEYPAD_PROMPT,
    SERVICE_DTMF_SHORT_PROMPT
  ],
  staffPreference: [
    STAFF_DTMF_PROMPT,
    STAFF_DTMF_PROMPT,
    STAFF_DTMF_PROMPT
  ],
  requestedDate: [
    "What day would you like? You can say today or tomorrow.",
    "What day would you like? You can say today or tomorrow.",
    "What day would you like? You can say today or tomorrow."
  ],
  requestedTime: [
    "What time? You can say 3 PM.",
    "Could you repeat the appointment time?",
    "What time? You can say 3 PM."
  ],
  customerName: [
    "What name should I put on the appointment?",
    "Sorry, could you spell your first name, one letter at a time?",
    "Sorry, could you spell your first name, one letter at a time?"
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
  staffPreference: ["staffPreference", "StaffPreference"],
  bookingConfirmation: ["bookingConfirmation", "BookingConfirmation"]
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

function compactForMatch(value) {
  return normalizeForMatch(value).replace(/\s/g, "");
}

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

function isInvalidServicePlaceholder(value) {
  return INVALID_SERVICE_PLACEHOLDERS.has(normalizeForMatch(value));
}

function toCustomerNameCase(value) {
  return String(value || "")
    .toLocaleLowerCase("en-US")
    .replace(/(^|[\s'-])\p{L}/gu, (match) => match.toLocaleUpperCase("en-US"));
}

function collapseSpokenNameSpelling(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length >= 3 && tokens.every((token) => /^\p{L}$/u.test(token))) {
    return toCustomerNameCase(tokens.join(""));
  }
  return raw.replace(/\s+/g, " ");
}

function isCustomerNameShape(value) {
  return /^\p{L}[\p{L}' -]{0,80}$/u.test(String(value || ""));
}

function normalizeSpokenNumbers(value) {
  return String(value || "").replace(
    /\b(one|two|three|tree|tri|four|five|fife|six|seven|eight|nine|ten|eleven|twelve)\b/gi,
    (match) => String(NUMBER_WORDS[match.toLowerCase()] || match)
  );
}

function digitSequenceFromUtterance(value) {
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
}

function isDigitOnlyOrSequenceUtterance(value) {
  return digitSequenceFromUtterance(value).length > 0;
}

function isMultiDigitOrDigitSequenceUtterance(value) {
  return digitSequenceFromUtterance(value).length > 1;
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

function findDedicatedFullSetAlias(text) {
  const normalized = normalizeForMatch(text);
  const compact = compactForMatch(text);
  if (!normalized || !compact) {
    return "";
  }
  return DEDICATED_FULL_SET_ALIASES.find((alias) => {
    const aliasNormalized = normalizeForMatch(alias);
    const aliasCompact = compactForMatch(alias);
    if (!aliasNormalized || !aliasCompact) {
      return false;
    }
    if (aliasNormalized.includes(" ")) {
      return normalized.includes(aliasNormalized) || compact.includes(aliasCompact);
    }
    return new RegExp(`\\b${escapeRegExp(aliasNormalized)}\\b`).test(normalized);
  }) || "";
}

function hasUnsafeSunsetWithoutExplicitFullSetAlias(text) {
  const normalized = normalizeForMatch(text);
  return Boolean(
    normalized &&
      /\bsun\s*set\b/.test(normalized) &&
      !findDedicatedFullSetAlias(text)
  );
}

function hasFullSetBookingContext(text, sessionAttributes = {}) {
  const normalized = normalizeForMatch(text);
  if (!normalized) {
    return false;
  }
  return Boolean(
    sessionAttributes?.lastAskedSlot === "serviceName" ||
      sessionAttributes?.activeDtmfMenu === "service" ||
      isBookingLikeUtterance(text) ||
      hasCurrentTurnDatePhrase(text) ||
      hasCurrentTurnTimePhrase(text, sessionAttributes) ||
      /\bwith\s+[a-z][a-z'-]*\b/.test(normalized) ||
      /\bat\s+(?:\d{1,2}|one|two|three|tree|tri|four|five|fife|six|seven|eight|nine|ten|eleven|twelve)\b/.test(normalized)
  );
}

function recognizeFullSetFromTranscript(text, sessionAttributes = {}) {
  if (hasUnsafeSunsetWithoutExplicitFullSetAlias(text)) {
    return "";
  }
  const alias = findDedicatedFullSetAlias(text);
  if (!alias) {
    return "";
  }
  const aliasCompact = compactForMatch(alias);
  if (!LOW_CONFIDENCE_FULL_SET_ALIASES.has(aliasCompact)) {
    return "Full Set";
  }
  return hasFullSetBookingContext(text, sessionAttributes) ? "Full Set" : "";
}

function normalizePedicureService(value) {
  return normalizeServiceName(value);
}

function extractServiceFromTranscript(text, sessionAttributes = {}) {
  const fullSet = recognizeFullSetFromTranscript(text, sessionAttributes);
  if (fullSet) {
    return fullSet;
  }
  if (hasUnsafeSunsetWithoutExplicitFullSetAlias(text)) {
    return "";
  }
  const serviceName = normalizeServiceName(text);
  return DEMO_SERVICE_NAMES.includes(serviceName) ? serviceName : "";
}

function isPrincessFullSetAsr(value) {
  return /\bprincess\b/.test(normalizeForMatch(value));
}

function isObservedSunsetFullSetAsr(value) {
  return /\bsun\s*set\b/.test(normalizeForMatch(value));
}

function getObservedSunsetFullSetAsrRaw(value) {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return "";
  }
  return /\bsun\s+set\b/.test(normalized) ? "sun set" : /\bsunset\b/.test(normalized) ? "sunset" : "";
}

function isPayTheBillPedicureAsr(value) {
  return /\bpay\s+the\s+bill\b/.test(normalizeForMatch(value));
}

function hasExactConfiguredServiceName(value, sessionAttributes = {}) {
  const normalized = normalizeForMatch(value);
  return Boolean(
    normalized &&
      getDynamicServiceNames(sessionAttributes).some(
        (serviceName) => normalizeForMatch(serviceName) === normalized
      )
  );
}

function getExactConfiguredServiceName(value, sessionAttributes = {}) {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return "";
  }
  return (
    getDynamicServiceNames(sessionAttributes).find(
      (serviceName) => normalizeForMatch(serviceName) === normalized
    ) || ""
  );
}

function hasStrongObservedSunsetServiceContext(event, text) {
  const previous = event.sessionState?.sessionAttributes || {};
  if (previous.lastAskedSlot === "serviceName" || previous.activeDtmfMenu === "service") {
    return true;
  }
  const normalized = normalizeForMatch(text);
  return Boolean(
    hasCurrentTurnDatePhrase(text) ||
      hasCurrentTurnTimePhrase(text, previous) ||
      /\bwith\s+[a-z][a-z'-]*\b/.test(normalized)
  );
}

function isServiceCollectionContext(event) {
  const previous = event.sessionState?.sessionAttributes || {};
  const transcript = getCurrentTurnTranscript(event);
  return Boolean(
    previous.lastAskedSlot === "serviceName" ||
      previous.activeDtmfMenu === "service" ||
      (!getConfirmedRecognizedService(previous) && isBookingLikeUtterance(transcript))
  );
}

function getScopedServiceAliasCorrectionRaw(event) {
  if (!isServiceCollectionContext(event)) {
    return "";
  }
  const slots = event.sessionState?.intent?.slots || {};
  const candidates = [
    getCurrentTurnTranscript(event),
    getSlotValue(slots, slotNames.serviceName, { preferOriginal: true })
  ];
  if (candidates.some(isPrincessFullSetAsr)) {
    return "princess";
  }
  return "";
}

function currentTurnServiceMention(event) {
  const previous = event.sessionState?.sessionAttributes || {};
  const transcript = getCurrentTurnTranscript(event);
  if (hasUnsafeSunsetWithoutExplicitFullSetAlias(transcript)) {
    return "";
  }
  const fullSet = recognizeFullSetFromTranscript(transcript, previous);
  if (fullSet) {
    return fullSet;
  }
  if (isServiceCollectionContext(event)) {
    if (getScopedServiceAliasCorrectionRaw(event)) {
      return "Full Set";
    }
    if (isPayTheBillPedicureAsr(transcript)) {
      return "Pedicure";
    }
  }
  const transcriptService = extractServiceFromTranscript(transcript, previous);
  if (transcriptService) {
    return transcriptService;
  }
  return "";
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textContainsStaffAlias(normalizedText, alias) {
  const normalizedAlias = normalizeForMatch(alias);
  if (!normalizedAlias) {
    return false;
  }
  if (normalizedAlias.includes(" ")) {
    return normalizedText.includes(normalizedAlias);
  }
  return new RegExp(`\\b${escapeRegExp(normalizedAlias)}\\b`).test(normalizedText);
}

function staffAliasMatchesInText(normalizedText, alias) {
  const normalizedAlias = normalizeForMatch(alias);
  if (!normalizedText || !normalizedAlias) {
    return [];
  }
  const pattern = new RegExp(`(^|\\s)${escapeRegExp(normalizedAlias)}(?=\\s|$)`, "g");
  const matches = [];
  let match;
  while ((match = pattern.exec(normalizedText)) !== null) {
    matches.push(match.index + (match[1] ? match[1].length : 0));
  }
  return matches;
}

function isNegatedStaffAlias(normalizedText, matchIndex) {
  const before = normalizedText.slice(0, matchIndex).trim();
  return /\bnot(?:\s+(?:the|that|this|one|staff|technician|tech))?$/.test(before);
}

function hasExplicitStaffContextCue(normalizedText, sessionAttributes = {}) {
  return Boolean(
    sessionAttributes?.lastAskedSlot === "staffPreference" ||
      sessionAttributes?.activeDtmfMenu === "staff" ||
      /\b(?:with|use|i said|technician|staff|tech)\b/.test(normalizedText) ||
      /\b(?:change|switch)\s+(?:the\s+)?(?:person|staff|technician|tech)\b/.test(normalizedText) ||
      /\b(?:someone else|another person|another staff|another stop|another technician|another tech|different person|different staff|different technician|different tech)\b/.test(
        normalizedText
      ) ||
      /\binstead\b/.test(normalizedText)
  );
}

function isGenericStaffChangePhrase(normalizedText) {
  return Boolean(
    normalizedText &&
      (/\b(?:change|switch)\s+(?:the\s+)?(?:person|staff|technician|tech)\b/.test(normalizedText) ||
        /\b(?:someone else|another person|another staff|another stop|another technician|another tech|different person|different staff|different technician|different tech)\b/.test(
          normalizedText
        ))
  );
}

function isStaffSelectionContext(normalizedText, sessionAttributes = {}) {
  return Boolean(
    sessionAttributes?.lastAskedSlot === "staffPreference" ||
      sessionAttributes?.activeDtmfMenu === "staff" ||
      hasExplicitStaffContextCue(normalizedText, sessionAttributes) ||
      /\b(?:staff|technician|tech)\b/.test(normalizedText) ||
      /\b(?:any\s+staff|any\s+technician|any\s+tech|first\s+avai?lable|the\s+first\s+available|for\s+available)\b/.test(
        normalizedText
      )
  );
}

function stripAnyStaffTrailingFiller(normalizedText) {
  let stripped = normalizedText;
  while (new RegExp(ANY_STAFF_TRAILING_FILLER_PATTERN).test(stripped)) {
    stripped = stripped.replace(new RegExp(ANY_STAFF_TRAILING_FILLER_PATTERN), "").trim();
  }
  return stripped;
}

function normalizeAnyStaffPhrase(text, context = {}) {
  const normalized = normalizeForMatch(text);
  if (!normalized) {
    return "";
  }
  if (/\bnot\s+(?:any\s+staff|first\s+available|the\s+first\s+available)\b/.test(normalized)) {
    return "";
  }

  const strongAlias = ANY_STAFF_ALIASES.find((alias) => {
    const normalizedAlias = normalizeForMatch(alias);
    return normalized === normalizedAlias || textContainsStaffAlias(normalized, normalizedAlias);
  });
  if (strongAlias) {
    return "Any staff";
  }
  if (/\bany\s+time\b/.test(normalized)) {
    return "";
  }

  const staffContext = isStaffSelectionContext(normalized, context);
  if (!staffContext) {
    return "";
  }

  const contextualCandidate = stripAnyStaffTrailingFiller(normalized);
  const contextualCompact = compactForMatch(contextualCandidate);
  return CONTEXTUAL_ANY_STAFF_ALIASES.some((alias) => {
    const aliasNormalized = normalizeForMatch(alias);
    const aliasCompact = compactForMatch(alias);
    return (
      contextualCandidate === aliasNormalized ||
      contextualCompact === aliasCompact ||
      textContainsStaffAlias(contextualCandidate, aliasNormalized)
    );
  })
    ? "Any staff"
    : "";
}

function isScopedDangAliasAllowed(normalizedText, sessionAttributes = {}) {
  return Boolean(
    sessionAttributes?.lastAskedSlot === "staffPreference" ||
      sessionAttributes?.activeDtmfMenu === "staff" ||
      /\b(?:with|use|staff|technician|tech)\s+dang\b/.test(normalizedText) ||
      /\b(?:no\s+)?i\s+want(?:\s+to\s+book)?\s+dang\b/.test(normalizedText) ||
      /\b(?:change|switch)\s+(?:the\s+)?(?:person|staff|technician|tech)(?:\s+(?:to|into))?\s+dang\b/.test(
        normalizedText
      ) ||
      /\bdang\s+instead\b/.test(normalizedText)
  );
}

function shouldSkipStaffAlias(staffName, alias, normalizedText, sessionAttributes = {}) {
  return (
    (normalizeForMatch(staffName) === "trang" &&
      normalizeForMatch(alias) === "dang" &&
      !isScopedDangAliasAllowed(normalizedText, sessionAttributes)) ||
    staffAliasCollidesWithDynamicStaff(staffName, alias, sessionAttributes)
  );
}

function extractTrangAsrConfusionToken(value) {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return "";
  }
  return normalized.split(/\s+/).find((token) => TRANG_ASR_CONFUSION_ALIASES.has(token)) || "";
}

function hasDynamicStaffExactCollision(token, sessionAttributes = {}) {
  if (!token) {
    return false;
  }
  return Object.values(getStaffDtmfOptions(sessionAttributes)).some((staffName) => {
    const fullName = normalizeForMatch(staffName);
    const firstName = normalizeForMatch(String(staffName).split(/\s+/)[0]);
    return token === fullName || token === firstName;
  });
}

function staffAliasCollidesWithDynamicStaff(staffName, alias, sessionAttributes = {}) {
  const normalizedAlias = normalizeForMatch(alias);
  const normalizedStaffName = normalizeForMatch(staffName);
  if (!normalizedAlias || !normalizedStaffName) {
    return false;
  }
  return Object.values(getStaffDtmfOptions(sessionAttributes)).some((dynamicStaffName) => {
    if (normalizeForMatch(dynamicStaffName) === "any staff") {
      return false;
    }
    const dynamicFullName = normalizeForMatch(dynamicStaffName);
    const dynamicFirstName = normalizeForMatch(String(dynamicStaffName).split(/\s+/)[0]);
    if (normalizedStaffName === dynamicFullName || normalizedStaffName === dynamicFirstName) {
      return false;
    }
    return normalizedAlias === dynamicFullName || normalizedAlias === dynamicFirstName;
  });
}

function resolveTrangAsrConfusionFromText(value, sessionAttributes = {}) {
  if (
    sessionAttributes?.lastAskedSlot === "customerName" &&
    sessionAttributes?.activeDtmfMenu !== "staff"
  ) {
    return "";
  }
  const normalized = normalizeForMatch(value);
  const token = extractTrangAsrConfusionToken(normalized);
  if (!token || !hasExplicitStaffContextCue(normalized, sessionAttributes)) {
    return "";
  }
  return hasDynamicStaffExactCollision(token, sessionAttributes) ? "" : "Trang";
}

function isExactKnownStaffAliasText(value, sessionAttributes = {}) {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return false;
  }
  for (const [staffName, aliases] of Object.entries(STAFF_ALIAS_GROUPS)) {
    const candidates = [staffName, ...aliases];
    if (
      candidates.some(
        (alias) =>
          normalizeForMatch(alias) === normalized &&
          !shouldSkipStaffAlias(staffName, alias, normalized, sessionAttributes)
      )
    ) {
      return true;
    }
  }
  return Object.values(getStaffDtmfOptions(sessionAttributes)).some((staffName) => {
    const fullName = normalizeForMatch(staffName);
    const firstName = normalizeForMatch(String(staffName).split(/\s+/)[0]);
    return normalized === fullName || normalized === firstName;
  });
}

function containsKnownStaffAliasText(value, sessionAttributes = {}) {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return false;
  }
  for (const [staffName, aliases] of Object.entries(STAFF_ALIAS_GROUPS)) {
    for (const alias of [staffName, ...aliases]) {
      if (
        !shouldSkipStaffAlias(staffName, alias, normalized, sessionAttributes) &&
        staffAliasMatchesInText(normalized, alias).length
      ) {
        return true;
      }
    }
  }
  return Object.values(getStaffDtmfOptions(sessionAttributes)).some((staffName) => {
    const fullName = normalizeForMatch(staffName);
    const firstName = normalizeForMatch(String(staffName).split(/\s+/)[0]);
    return textContainsStaffAlias(normalized, fullName) || textContainsStaffAlias(normalized, firstName);
  });
}

function isUnsupportedServiceRequestPhrase(value) {
  const normalized = normalizeForMatch(value);
  return Boolean(
    normalized &&
      /\b(?:haircut|hair cut|facial|polish|gel|gel nails|gel service|gel manicure|jell manicure)\b/.test(
        normalized
      )
  );
}

function isServiceMenuRequestPhrase(value) {
  const normalized = normalizeForMatch(value);
  return Boolean(
    normalized &&
      /\b(?:what services|which services|services do you|services you have|service list|list(?: the)? services|available services|what do you offer)\b/.test(
        normalized
      )
  );
}

function normalizeScopedStaffCandidatePhrase(text, sessionAttributes = {}) {
  const normalized = normalizeForMatch(text);
  if (!normalized) {
    return "";
  }
  if (isFinalConfirmationOnlyPhrase(normalized)) {
    return "";
  }
  if (normalizeAnyStaffPhrase(text, sessionAttributes)) {
    return "any staff";
  }
  if (
    /\bnot\s+(?:correct|right|sure|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.test(
      normalized
    ) ||
    /\b(?:do not|don t|dont)\s+book\b|\bcancel it\b|\bwait no\b|\bno that is wrong\b/.test(normalized)
  ) {
    return "";
  }
  const wantMatch = normalized.match(/^(?:no\s+)?i\s+want(?:\s+to\s+book)?\s+(.+)$/);
  const staffContext = hasExplicitStaffContextCue(normalized, sessionAttributes);
  const hasKnownStaffAlias =
    isExactKnownStaffAliasText(normalized, sessionAttributes) ||
    Boolean(wantMatch?.[1] && containsKnownStaffAliasText(wantMatch[1], sessionAttributes));
  if (!staffContext && !hasKnownStaffAlias) {
    return "";
  }
  if (
    wantMatch &&
    !staffContext &&
    !containsKnownStaffAliasText(wantMatch[1], sessionAttributes)
  ) {
    return "";
  }
  if (isUnsupportedServiceRequestPhrase(normalized)) {
    return "";
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
  if (/^(?:am|pm|a m|p m)$/.test(candidate)) {
    return "";
  }
  if (!candidate || candidate.split(/\s+/).length > 2) {
    return "";
  }
  if (
    /^(?:yes|yeah|yep|correct|right|sure|ok|okay|no|nope|nah|wrong)(?:\s+(?:yes|yeah|yep|correct|right|sure|ok|okay|no|nope|nah|wrong))*$/.test(
      candidate
    )
  ) {
    return "";
  }
  if (
    extractServiceFromTranscript(candidate) ||
    isUnsupportedServiceRequestPhrase(candidate) ||
    hasCurrentTurnDatePhrase(candidate) ||
    hasCurrentTurnTimePhrase(candidate)
  ) {
    return "";
  }
  return candidate;
}

function collectStaffAliasMatches(normalizedText, sessionAttributes = {}) {
  const matches = [];
  const addMatches = (staffName, aliases) => {
    const seenAliases = new Set();
    for (const alias of aliases) {
      const normalizedAlias = normalizeForMatch(alias);
      if (
        !normalizedAlias ||
        seenAliases.has(normalizedAlias) ||
        shouldSkipStaffAlias(staffName, alias, normalizedText, sessionAttributes)
      ) {
        continue;
      }
      seenAliases.add(normalizedAlias);
      for (const index of staffAliasMatchesInText(normalizedText, normalizedAlias)) {
        matches.push({
          staffName,
          index,
          negated: isNegatedStaffAlias(normalizedText, index)
        });
      }
    }
  };

  for (const [staffName, aliases] of Object.entries(STAFF_ALIAS_GROUPS)) {
    addMatches(staffName, [staffName, ...aliases]);
  }
  for (const staffName of Object.values(getStaffDtmfOptions(sessionAttributes))) {
    if (normalizeForMatch(staffName) === "any staff") {
      continue;
    }
    addMatches(staffName, [staffName, String(staffName).split(/\s+/)[0]]);
  }

  return matches.sort((left, right) => left.index - right.index);
}

function extractStaffFromTranscript(text, sessionAttributes = {}) {
  const normalizedText = normalizeForMatch(text);
  if (!normalizedText) {
    return "";
  }
  if (normalizeAnyStaffPhrase(text, sessionAttributes)) {
    return "Any staff";
  }
  const scopedCandidate = normalizeScopedStaffCandidatePhrase(text, sessionAttributes);
  const searchText = scopedCandidate && normalizeForMatch(scopedCandidate) !== "any staff"
    ? scopedCandidate
    : normalizedText;
  const positiveMatches = collectStaffAliasMatches(searchText, sessionAttributes)
    .filter((match) => !match.negated);
  const positiveNames = Array.from(new Set(positiveMatches.map((match) => match.staffName)));
  if (positiveNames.length === 1) {
    return positiveNames[0];
  }
  const trangAsrConfusion = resolveTrangAsrConfusionFromText(normalizedText, sessionAttributes);
  if (trangAsrConfusion) {
    return trangAsrConfusion;
  }
  return "";
}

function hasExplicitStaffPhrase(text, sessionAttributes = {}) {
  const normalized = normalizeForMatch(text);
  if (!normalized) {
    return false;
  }
  if (normalizeAnyStaffPhrase(text, sessionAttributes)) {
    return true;
  }
  if (normalizeScopedStaffCandidatePhrase(text, sessionAttributes)) {
    return true;
  }
  if (resolveTrangAsrConfusionFromText(text, sessionAttributes)) {
    return true;
  }
  const matches = collectStaffAliasMatches(normalized, sessionAttributes);
  return matches.length > 0 || /\bnot\s+(?!today\b|tomorrow\b|monday\b|tuesday\b|wednesday\b|thursday\b|friday\b|saturday\b|sunday\b|correct\b|right\b|book\b|it\b|that\b|this\b|my\b|me\b|name\b)[a-z][a-z'-]{1,40}\b/.test(normalized);
}

function readDtmfDigit(value) {
  const trimmed = String(value || "").trim();
  if (/^(?:zero|press zero|pressed zero)$/i.test(trimmed)) {
    return "0";
  }
  const normalized = normalizeForMatch(trimmed);
  const spokenDigitMatch = normalized.match(/^(?:(?:number|option|press|pressed)\s+)?(one|two|three|tree|tri|four|five|six|seven|eight|nine)$/);
  if (spokenDigitMatch) {
    return String(NUMBER_WORDS[spokenDigitMatch[1]] || "");
  }
  const match = trimmed.match(/^(?:dtmf\s*)?([0-9]{1,2})#?$/i);
  return match?.[1] || "";
}

function getTranscriptCandidateValues(event) {
  const values = [event.inputTranscript];
  for (const transcription of event.transcriptions || []) {
    values.push(
      transcription?.transcription,
      transcription?.transcript,
      transcription?.inputTranscript,
      transcription?.resolvedContext?.intent
    );
  }
  for (const interpretation of event.interpretations || []) {
    values.push(interpretation?.transcription, interpretation?.inputTranscript);
  }
  return values.filter((value) => value !== undefined && value !== null && String(value).trim() !== "");
}

function getDtmfSessionValues(sessionAttributes, expectedSlot) {
  const slotPrefix = expectedSlot === "serviceName" ? "service" : "staff";
  return [
    "dtmf",
    "DTMF",
    "dtmfDigit",
    "dtmfDigits",
    "inputDigit",
    "inputDigits",
    "InputDigits",
    "CustomerInput",
    `${expectedSlot}Dtmf`,
    `${expectedSlot}Digit`,
    `${slotPrefix}Dtmf`,
    `${slotPrefix}Digit`
  ].map((name) => sessionAttributes?.[name]);
}

function parseDtmfRecord(value) {
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
}

function getStaffDtmfOptions(sessionAttributes) {
  const dynamicOptions = parseDtmfRecord(sessionAttributes?.staffDtmfOptions);
  return Object.keys(dynamicOptions).length ? dynamicOptions : STAFF_DTMF_OPTIONS;
}

function getStaffDtmfStaffIds(sessionAttributes) {
  return parseDtmfRecord(
    sessionAttributes?.staffDtmfStaffIds || sessionAttributes?.staffDtmfOptionStaffIds
  );
}

function isOperatorZeroValue(value) {
  if (readDtmfDigit(value) === "0") {
    return true;
  }
  const normalized = normalizeForMatch(value);
  return normalized === "zero" || /\b(?:press|pressed|hit|dial)\s+zero\b/.test(normalized);
}

function getScopedDtmfDigit(event, expectedSlot) {
  const previous = event.sessionState?.sessionAttributes || {};
  const lastAskedSlot = previous.lastAskedSlot;
  const activeDtmfMenu = previous.activeDtmfMenu;
  if (expectedSlot === "serviceName" && activeDtmfMenu !== "service") {
    return "";
  }
  if (expectedSlot === "staffPreference" && activeDtmfMenu !== "staff") {
    return "";
  }
  if (activeDtmfMenu === "service" && expectedSlot !== "serviceName") {
    return "";
  }
  if (activeDtmfMenu === "staff" && expectedSlot !== "staffPreference") {
    return "";
  }
  if (lastAskedSlot !== expectedSlot) {
    return "";
  }
  const slots = event.sessionState?.intent?.slots || {};
  const candidateValues =
    expectedSlot === "serviceName"
      ? [
          ...getTranscriptCandidateValues(event),
          getSlotValue(slots, slotNames.serviceName, { preferOriginal: true }),
          getSessionAttribute(previous, slotNames.serviceName),
          ...getDtmfSessionValues(previous, expectedSlot)
        ]
      : [
          ...getTranscriptCandidateValues(event),
          getSlotValue(slots, slotNames.staffPreference, { preferOriginal: true }),
          getSessionAttribute(previous, slotNames.staffPreference),
          ...getDtmfSessionValues(previous, expectedSlot)
        ];
  for (const value of candidateValues) {
    const digit = readDtmfDigit(value);
    if (digit) {
      return digit;
    }
  }
  return "";
}

function readScopedDtmfSelection(event, expectedSlot, options) {
  const digit = getScopedDtmfDigit(event, expectedSlot);
  return digit && options[digit] ? options[digit] : "";
}

function readScopedServiceDtmfId(event) {
  const digit = getScopedDtmfDigit(event, "serviceName");
  const previous = event.sessionState?.sessionAttributes || {};
  const ids = parseDtmfRecord(previous.serviceDtmfServiceIds);
  return digit && ids[digit] ? ids[digit] : "";
}

function getCurrentTurnTranscript(event) {
  return String(event.inputTranscript || "").trim();
}

function isBareDigitUtterance(value) {
  return digitSequenceFromUtterance(value).length === 1;
}

function hasCurrentTurnTimePhrase(transcript, sessionAttributes = {}) {
  const raw = String(transcript || "");
  if (!raw.trim()) {
    return false;
  }
  if (isDigitOnlyOrSequenceUtterance(raw)) {
    return false;
  }
  const timeCandidate = extractTimeCandidate(raw, sessionAttributes);
  return Boolean(normalizeTimePhrase(timeCandidate, "", sessionAttributes));
}

function hasCurrentTurnDatePhrase(transcript) {
  const raw = String(transcript || "");
  return Boolean(getPreferredDateCandidate(raw));
}

function hasExplicitUnresolvedPastDateReference(transcript) {
  const normalized = normalizeForMatch(transcript);
  if (!normalized) {
    return false;
  }
  if (/\b(?:not|dont|do not|don't)\s+(?:for\s+)?(?:yesterday|last\s+(?:night|week|month|year))\b/.test(normalized)) {
    return false;
  }
  return /\b(?:yesterday|last\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|night|week|month|year))\b/.test(
    normalized
  );
}

function getActiveVoiceSlot(sessionAttributes = {}) {
  if (sessionAttributes.lastAskedSlot) {
    return String(sessionAttributes.lastAskedSlot);
  }
  if (sessionAttributes.activeDtmfMenu === "service") {
    return "serviceName";
  }
  if (sessionAttributes.activeDtmfMenu === "staff") {
    return "staffPreference";
  }
  return "";
}

function hasExplicitSlotCorrectionPhrase(text) {
  const normalized = normalizeForMatch(text);
  return Boolean(
    normalized &&
      (/\b(?:actually|change|update|switch|move|make\s+it|instead|rather)\b/.test(normalized) ||
        new RegExp(
          `\\bnot\\s+(?:a\\s+|the\\s+)?(?:${SPOKEN_HOUR_PATTERN}|\\d{1,2})(?::\\d{2})?(?:\\s*(?:am|pm|a\\s*m|p\\s*m))?\\b`,
          "i"
        ).test(normalized))
  );
}

function timeCandidateIsNegated(text, candidate, context = {}) {
  const proposedMinutes = timePhraseToMinutes(candidate, {
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
    const negatedMinutes = timePhraseToMinutes(match[1] || "", {
      ...context,
      lastAskedSlot: "requestedTime"
    });
    return negatedMinutes !== null && negatedMinutes === proposedMinutes;
  });
}

function isBareOrAmbiguousTimeMutation(text, context = {}) {
  const normalized = normalizeForMatch(text);
  if (!normalized) {
    return false;
  }
  if (/\b(?:am|pm|a\s*m|p\s*m|o\s+clock|oclock)\b/.test(normalized)) {
    return false;
  }
  if (hasCurrentTurnDatePhrase(text) || context.currentTurnHasDatePhrase) {
    return false;
  }
  return new RegExp(
    `\\b(?:at\\s+)?(?:${SPOKEN_HOUR_PATTERN}|\\d{1,2})(?::\\d{2})?\\b`,
    "i"
  ).test(normalized);
}

function isClearlyStructuredBookingRequest(text, sessionAttributes = {}) {
  const normalized = normalizeForMatch(text);
  if (!normalized) {
    return false;
  }
  if (!isBookingLikeUtterance(text) && !/\bwith\s+[a-z][a-z'-]*\b/.test(normalized)) {
    return false;
  }
  const details = extractBookingDetailsFromText(text, DEFAULT_SALON_TIMEZONE, {
    ...sessionAttributes,
    currentTurnHasDatePhrase: hasCurrentTurnDatePhrase(text)
  });
  const hasService = Boolean(details.serviceName || currentTranscriptCouldBeFullSet(text, sessionAttributes));
  const hasDate = Boolean(details.requestedDate || hasCurrentTurnDatePhrase(text));
  const hasTime = Boolean(details.requestedTime || hasCurrentTurnTimePhrase(text, sessionAttributes));
  const hasStaff = Boolean(
    extractStaffFromTranscript(text, sessionAttributes) ||
      normalizeAnyStaffPhrase(text, sessionAttributes)
  );
  return hasService && hasDate && hasTime && hasStaff;
}

function currentTranscriptCouldBeFullSet(text, sessionAttributes = {}) {
  if (hasUnsafeSunsetWithoutExplicitFullSetAlias(text)) {
    return false;
  }
  return Boolean(recognizeFullSetFromTranscript(text, sessionAttributes));
}

function buildVoiceSlotMutationPolicy(input) {
  const slotName = input.slotName;
  const proposedValue = String(input.proposedValue || "").trim();
  const trustedValue = String(input.trustedValue || "").trim();
  const transcript = String(input.transcript || "").trim();
  const sessionAttributes = input.sessionAttributes || {};
  const activeSlot = getActiveVoiceSlot(sessionAttributes);
  const proposedSlotMutation = {
    slotName,
    activeSlot,
    previousValue: trustedValue,
    proposedValue
  };
  if (!proposedValue) {
    return {
      ...proposedSlotMutation,
      accepted: false,
      reason: "empty_proposed_value"
    };
  }
  if (trustedValue && valuesEquivalent(slotName, trustedValue, proposedValue, DEFAULT_SALON_TIMEZONE)) {
    return {
      ...proposedSlotMutation,
      accepted: true,
      reason: "same_as_trusted_value"
    };
  }
  const structuredRequest = isClearlyStructuredBookingRequest(transcript, sessionAttributes);
  const explicitCorrection = hasExplicitSlotCorrectionPhrase(transcript);
  const negatesProposed =
    slotName === "requestedTime" && timeCandidateIsNegated(transcript, proposedValue, sessionAttributes);
  if (activeSlot === slotName) {
    return {
      ...proposedSlotMutation,
      accepted: true,
      reason: "active_slot"
    };
  }
  if (explicitCorrection && !negatesProposed) {
    return {
      ...proposedSlotMutation,
      accepted: true,
      reason: "explicit_correction"
    };
  }
  if (structuredRequest) {
    return {
      ...proposedSlotMutation,
      accepted: true,
      reason: "structured_booking_request"
    };
  }
  if (!trustedValue && slotName === "requestedTime" && sessionAttributes.inputMode === "DTMF") {
    return {
      ...proposedSlotMutation,
      accepted: true,
      reason: "dtmf_lex_time"
    };
  }
  if (!trustedValue && slotName === "requestedTime" && !isBareOrAmbiguousTimeMutation(transcript, sessionAttributes)) {
    return {
      ...proposedSlotMutation,
      accepted: true,
      reason: "new_grounded_time"
    };
  }
  return {
    ...proposedSlotMutation,
    accepted: false,
    reason: negatesProposed
      ? "caller_rejected_proposed_value"
      : trustedValue
        ? "protected_trusted_slot"
        : "bare_or_ambiguous_wrong_slot"
  };
}

function canUseMarkedBareTimeCandidate(text, context = {}) {
  if (hasRequestedTimeContext(context)) {
    return true;
  }
  if (context.currentTurnHasDatePhrase || hasCurrentTurnDatePhrase(text)) {
    return true;
  }
  if (hasExplicitSlotCorrectionPhrase(text)) {
    return true;
  }
  const activeSlot = getActiveVoiceSlot(context);
  if (activeSlot && activeSlot !== "requestedTime") {
    return false;
  }
  return true;
}

function isInvalidCustomerNameNoise(value) {
  const normalized = normalizeForMatch(value);
  return Boolean(
    normalized &&
      (CUSTOMER_NAME_NOISE.has(normalized) ||
	        isDigitOnlyOrSequenceUtterance(value) ||
	        extractServiceFromTranscript(value) ||
	        getPreferredDateCandidate(value) ||
        normalizeTimePhrase(extractTimeCandidate(value)) ||
        /(?:phone|number|appointment|book|service|first available|any staff|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|night|am|pm|with|at|on|for|to|by|from|and|the|please|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(
          String(value || "")
        ))
  );
}

function isAcceptableCustomerName(value) {
  const raw = collapseSpokenNameSpelling(value);
  const normalized = normalizeForMatch(raw);
  if (!raw || isInvalidCustomerNameNoise(raw) || readDtmfDigit(raw)) {
    return false;
  }
  if (!isCustomerNameShape(raw) || normalized.split(" ").length > 4) {
    return false;
  }
  return true;
}

function valuesEquivalent(fieldName, left, right, timeZone = DEFAULT_SALON_TIMEZONE) {
  const leftText = String(left || "").trim();
  const rightText = String(right || "").trim();
  if (!leftText || !rightText) {
    return false;
  }
  if (fieldName === "serviceName") {
    return normalizeServiceName(leftText) === normalizeServiceName(rightText);
  }
  if (fieldName === "staffPreference") {
    return normalizeForMatch(leftText) === normalizeForMatch(rightText);
  }
  if (fieldName === "requestedDate") {
    return resolveKnownDateValue(leftText, timeZone) === resolveKnownDateValue(rightText, timeZone);
  }
  if (fieldName === "requestedTime") {
    return normalizeTimePhrase(leftText) === normalizeTimePhrase(rightText);
  }
  return normalizeForMatch(leftText) === normalizeForMatch(rightText);
}

function slotValueIsGroundedInCurrentTranscript(
  fieldName,
  slotValue,
  transcript,
  timeZone = DEFAULT_SALON_TIMEZONE,
  context = {}
) {
  const raw = String(transcript || "").trim();
  const value = String(slotValue || "").trim();
  const normalizedTranscript = normalizeForMatch(raw);
  const normalizedValue = normalizeForMatch(value);
  if (!raw || !value) {
    return false;
  }
  if (normalizedTranscript.includes(normalizedValue) || normalizedValue.includes(normalizedTranscript)) {
    return true;
  }
  const currentDetails = extractBookingDetailsFromText(raw, timeZone, context);
  if (fieldName === "serviceName") {
    return Boolean(currentDetails.serviceName && valuesEquivalent(fieldName, currentDetails.serviceName, value, timeZone));
  }
  if (fieldName === "requestedDate") {
    return Boolean(currentDetails.requestedDate && valuesEquivalent(fieldName, currentDetails.requestedDate, value, timeZone));
  }
  if (fieldName === "requestedTime") {
    return Boolean(currentDetails.requestedTime && valuesEquivalent(fieldName, currentDetails.requestedTime, value, timeZone));
  }
  if (fieldName === "staffPreference") {
    const staff = extractStaffFromTranscript(raw, context);
    return Boolean(staff && valuesEquivalent(fieldName, staff, value, timeZone));
  }
  if (fieldName === "customerName") {
    const explicitName = extractCustomerNameFromText(raw);
    const bareName = extractBareCustomerNameAnswer(raw);
    return Boolean(
      (explicitName && valuesEquivalent(fieldName, explicitName, value, timeZone)) ||
        (bareName && valuesEquivalent(fieldName, bareName, value, timeZone))
    );
  }
  return false;
}

function slotValueAlreadyTrusted(fieldName, slotValue, previous, timeZone = DEFAULT_SALON_TIMEZONE) {
  const previousValue =
    getSessionAttribute(previous, slotNames[fieldName] || [fieldName]) ||
    (fieldName === "serviceName" ? previous.confirmedServiceName : "") ||
    (fieldName === "staffPreference" ? previous.confirmedStaffName : "");
  return valuesEquivalent(fieldName, slotValue, previousValue, timeZone);
}

function parseDtmfOptionsJson(value) {
  const parsed = parseDtmfRecord(value);
  return Object.keys(parsed).length ? parsed : {};
}

function withOperatorDtmfOption(options = {}) {
  return {
    ...options,
    "0": "__operator__"
  };
}

function getServiceDtmfOptions(sessionAttributes = {}) {
  const serviceOptions = parseDtmfRecord(sessionAttributes.serviceDtmfOptions);
  if (Object.keys(serviceOptions).length) {
    return withOperatorDtmfOption(serviceOptions);
  }
  const activeOptions =
    sessionAttributes.activeDtmfMenu === "service"
      ? parseDtmfOptionsJson(sessionAttributes.activeDtmfOptionsJson)
      : {};
  if (Object.keys(activeOptions).some((digit) => digit !== "0")) {
    return withOperatorDtmfOption(activeOptions);
  }
  return SERVICE_DTMF_OPTIONS;
}

function getActiveDtmfOptions(sessionAttributes = {}, activeDtmfMenu = sessionAttributes.activeDtmfMenu) {
  const activeOptions = parseDtmfOptionsJson(sessionAttributes.activeDtmfOptionsJson);
  if (activeDtmfMenu === "service") {
    return getServiceDtmfOptions(sessionAttributes);
  }
  if (Object.keys(activeOptions).length) {
    return activeOptions;
  }
  if (activeDtmfMenu === "staff") {
    return getStaffDtmfOptions(sessionAttributes);
  }
  return {};
}

function readCurrentTurnDigit(event) {
  const currentDigit = readDtmfDigit(getCurrentTurnTranscript(event));
  if (currentDigit && /^[0-9]$/.test(currentDigit)) {
    return currentDigit;
  }
  for (const value of getTranscriptCandidateValues(event)) {
    const digit = readDtmfDigit(value);
    if (digit && /^[0-9]$/.test(digit)) {
      return digit;
    }
  }
  return "";
}

function getCurrentTurnDtmfDiagnostics(event) {
  const previous = event.sessionState?.sessionAttributes || {};
  const transcriptCandidateRecords = [
    { source: "inputTranscript", value: event.inputTranscript }
  ];
  for (const [index, transcription] of (event.transcriptions || []).entries()) {
    transcriptCandidateRecords.push(
      { source: `transcriptions.${index}.transcription`, value: transcription?.transcription },
      { source: `transcriptions.${index}.transcript`, value: transcription?.transcript },
      { source: `transcriptions.${index}.inputTranscript`, value: transcription?.inputTranscript }
    );
  }
  for (const [index, interpretation] of (event.interpretations || []).entries()) {
    transcriptCandidateRecords.push(
      { source: `interpretations.${index}.transcription`, value: interpretation?.transcription },
      { source: `interpretations.${index}.inputTranscript`, value: interpretation?.inputTranscript }
    );
  }

  const sessionAttributeNames = [
    "dtmf",
    "DTMF",
    "dtmfDigit",
    "dtmfDigits",
    "inputDigit",
    "inputDigits",
    "InputDigits",
    "CustomerInput",
    "serviceNameDtmf",
    "serviceNameDigit",
    "serviceDtmf",
    "serviceDigit",
    "staffPreferenceDtmf",
    "staffPreferenceDigit",
    "staffDtmf",
    "staffDigit"
  ];
  const sessionAttributeRecords = sessionAttributeNames.map((name) => ({
    source: `sessionAttributes.${name}`,
    value: previous[name]
  }));
  const candidates = [...transcriptCandidateRecords, ...sessionAttributeRecords]
    .filter((candidate) => candidate.value !== undefined && candidate.value !== null)
    .map((candidate) => ({
      source: candidate.source,
      value: String(candidate.value).trim()
    }))
    .filter((candidate) => candidate.value);

  let digitsExtractedSingle = "";
  let readSource = "none";
  const sequenceValues = [];
  for (const candidate of candidates) {
    const digit = readDtmfDigit(candidate.value);
    if (!digitsExtractedSingle && digit && /^[0-9]$/.test(digit)) {
      digitsExtractedSingle = digit;
      readSource = candidate.source.includes("sessionAttributes")
        ? "sessionAttribute"
        : candidate.source === "inputTranscript"
          ? "inputTranscript"
          : "transcription";
    }
    const sequence = digitSequenceFromUtterance(candidate.value);
    if (sequence.length) {
      sequenceValues.push(...sequence);
    }
  }

  const rawInputTranscript = getCurrentTurnTranscript(event);
  const inputSequence = digitSequenceFromUtterance(rawInputTranscript);
  const digitsExtractedSequence = inputSequence.length
    ? inputSequence
    : Array.from(new Set(sequenceValues));

  return {
    rawInputTranscript,
    inputMode: getInputMode(event),
    transcriptCandidates: transcriptCandidateRecords
      .map((candidate) => candidate.value)
      .filter((value) => value !== undefined && value !== null && String(value).trim() !== "")
      .map(String),
    sessionAttributeCandidates: Object.fromEntries(
      sessionAttributeRecords
        .filter((candidate) => candidate.value !== undefined && candidate.value !== null && String(candidate.value).trim())
        .map((candidate) => [candidate.source.replace("sessionAttributes.", ""), String(candidate.value)])
    ),
    digitsExtractedSingle,
    digitsExtractedSequence,
    isBareDigitUtterance: isBareDigitUtterance(rawInputTranscript),
    isMultiDigitOrDigitSequence: isMultiDigitOrDigitSequenceUtterance(rawInputTranscript),
    readSource,
    activeDtmfMenuBefore: previous.activeDtmfMenu || "",
    lastAskedSlotBefore: previous.lastAskedSlot || ""
  };
}

function buildDtmfRouting(event) {
  const previous = event.sessionState?.sessionAttributes || {};
  const diagnostics = getCurrentTurnDtmfDiagnostics(event);
  const digit = diagnostics.digitsExtractedSingle || readCurrentTurnDigit(event);
  const lastAskedSlotBefore = previous.lastAskedSlot || "";
  const activeDtmfMenuBefore =
    previous.activeDtmfMenu === "service" || previous.activeDtmfMenu === "staff"
      ? previous.activeDtmfMenu
      : "";
  const base = {
    digit,
    lastAskedSlotBefore,
    activeDtmfMenuBefore,
    route: "",
    selection: "",
    accepted: false,
    ignoredReason: "",
    nextSlot: "",
    digitSequence: diagnostics.digitsExtractedSequence,
    isBareDigitUtterance: diagnostics.isBareDigitUtterance,
    isMultiDigitOrDigitSequence: diagnostics.isMultiDigitOrDigitSequence,
    readSource: diagnostics.readSource,
    menuMismatch: Boolean(
      activeDtmfMenuBefore &&
        ((activeDtmfMenuBefore === "service" && lastAskedSlotBefore !== "serviceName") ||
          (activeDtmfMenuBefore === "staff" && lastAskedSlotBefore !== "staffPreference"))
    )
  };
  if (!digit && !diagnostics.isMultiDigitOrDigitSequence) {
    return base;
  }
  if (!digit && diagnostics.isMultiDigitOrDigitSequence) {
    const nextSlot = ["requestedDate", "requestedTime", "customerName", "customerPhone"].includes(lastAskedSlotBefore)
      ? lastAskedSlotBefore
      : "";
    return {
      ...base,
      route: activeDtmfMenuBefore
        ? `${activeDtmfMenuBefore}_menu`
        : lastAskedSlotBefore
          ? "wrong_slot"
          : "no_active_menu",
      ignoredReason: activeDtmfMenuBefore
        ? "multi_digit_sequence_not_valid_for_menu"
        : lastAskedSlotBefore
          ? `digit_sequence_not_valid_for_${lastAskedSlotBefore}`
          : "digit_sequence_without_active_menu",
      nextSlot
    };
  }
  if (digit === "0") {
    return {
      ...base,
      route: "operator_transfer",
      selection: "operator",
      accepted: true,
      nextSlot: "operator"
    };
  }

  const routeByMenu = (menu) => {
    const options = getActiveDtmfOptions(previous, menu);
    const selection = options[digit] || "";
    if (!selection) {
      return {
        ...base,
        route: `${menu}_menu`,
        ignoredReason: "digit_not_in_active_menu",
        nextSlot: menu === "service" ? "serviceName" : "staffPreference"
      };
    }
    return {
      ...base,
      route: `${menu}_menu`,
      selection,
      accepted: true,
      nextSlot: menu === "service" ? "requestedDate" : ""
    };
  };

  if (activeDtmfMenuBefore) {
    return routeByMenu(activeDtmfMenuBefore);
  }

  const nextSlot = ["requestedDate", "requestedTime", "customerName", "customerPhone"].includes(lastAskedSlotBefore)
    ? lastAskedSlotBefore
    : "";
  return {
    ...base,
    route: lastAskedSlotBefore ? "wrong_slot" : "no_active_menu",
    ignoredReason: lastAskedSlotBefore
      ? `digit_not_valid_for_${lastAskedSlotBefore}`
      : "digit_without_active_menu",
    nextSlot
  };
}

function getSlotObject(slots, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(slots || {}, name)) {
      return {
        name,
        slot: slots?.[name]
      };
    }
  }
  return {
    name: names[0],
    slot: undefined
  };
}

function getSlotOriginalValue(slot) {
  return slot?.value?.originalValue ? String(slot.value.originalValue).trim() : "";
}

function getSlotInterpretedValue(slot) {
  return slot?.value?.interpretedValue ? String(slot.value.interpretedValue).trim() : "";
}

function getSlotResolvedValues(slot) {
  return Array.isArray(slot?.value?.resolvedValues)
    ? slot.value.resolvedValues.filter((value) => value !== undefined && value !== null).map(String)
    : [];
}

function collectSlotOriginalValues(slots = {}) {
  return Object.fromEntries(
    Object.entries(slots).map(([name, slot]) => [name, getSlotOriginalValue(slot)])
  );
}

function collectSlotInterpretedValues(slots = {}) {
  return Object.fromEntries(
    Object.entries(slots).map(([name, slot]) => [name, getSlotInterpretedValue(slot)])
  );
}

function collectTrustedBookingSlots(sessionAttributes = {}) {
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
  return Object.fromEntries(
    fields
      .map((field) => [field, sessionAttributes[field]])
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
  );
}

function buildSlotDecisionDebug(event, finalAttributes = {}) {
  const previous = event.sessionState?.sessionAttributes || {};
  const slots = event.sessionState?.intent?.slots || {};
  const timeZone = getAttribute(event, attributeNames.timezone) || DEFAULT_SALON_TIMEZONE;
  const currentTurnTranscript = getCurrentTurnTranscript(event);
  const dtmfDiagnostics = getCurrentTurnDtmfDiagnostics(event);
  const currentRecoveryTranscript = [event.inputTranscript]
    .filter((value) => value && !readDtmfDigit(value))
    .join(" ");
  const recoveryTranscript = [
    event.inputTranscript,
    getAttribute(event, attributeNames.transcript),
    previous.initialBookingUtterance
  ]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(" ");
  const currentRecovered = extractBookingDetailsFromText(currentRecoveryTranscript, timeZone, previous);
  const recovered = extractBookingDetailsFromText(recoveryTranscript, timeZone, previous);
  const decisions = {};
  for (const fieldName of [
    "serviceName",
    "requestedDate",
    "requestedTime",
    "staffPreference",
    "customerName"
  ]) {
    const names = slotNames[fieldName] || [fieldName];
    const lexSlot = getSlotValue(slots, names, {
      preferOriginal: fieldName === "requestedTime"
    });
    const previousValue =
      getSessionAttribute(previous, names) ||
      (fieldName === "serviceName" ? previous.confirmedServiceName : "") ||
      (fieldName === "staffPreference" ? previous.confirmedStaffName : "");
    const currentRecoveredValue = currentRecovered[fieldName] || "";
    const recoveredValue = currentRecoveredValue || recovered[fieldName] || "";
    const finalValue =
      getSessionAttribute(finalAttributes, names) ||
      (fieldName === "serviceName" ? finalAttributes.confirmedServiceName : "") ||
      (fieldName === "staffPreference" ? finalAttributes.confirmedStaffName : "");
    const currentGrounded = slotValueIsGroundedInCurrentTranscript(
      fieldName,
      lexSlot || currentRecoveredValue || finalValue,
      currentTurnTranscript,
      timeZone,
      previous
    );
    const digitNoise =
      dtmfDiagnostics.isBareDigitUtterance || dtmfDiagnostics.isMultiDigitOrDigitSequence;
    let decision = finalValue ? "preserved_or_recovered" : "missing";
    let reason = "";
    let source = finalValue ? "trusted_session" : "missing";
    if (finalValue && previousValue && valuesEquivalent(fieldName, finalValue, previousValue, timeZone)) {
      decision = "preserved_previous";
      source = "trusted_session";
    }
    if (finalValue && lexSlot && currentGrounded && valuesEquivalent(fieldName, finalValue, lexSlot, timeZone)) {
      decision = "accepted_lex_slot";
      source = "current_lex_slot";
    }
    if (finalValue && currentRecoveredValue && valuesEquivalent(fieldName, finalValue, currentRecoveredValue, timeZone)) {
      decision = "recovered_from_current_turn";
      source = "current_turn";
    } else if (finalValue && recoveredValue && valuesEquivalent(fieldName, finalValue, recoveredValue, timeZone)) {
      decision = "recovered_from_transcript";
      source = previousValue ? "trusted_session" : "historical_fill_only";
    }
    if (
      ["requestedDate", "requestedTime"].includes(fieldName) &&
      lexSlot &&
      digitNoise &&
      !currentGrounded &&
      (!previousValue || !valuesEquivalent(fieldName, lexSlot, previousValue, timeZone))
    ) {
      decision = previousValue ? "rejected_lex_preserved_previous" : "rejected_lex";
      reason = `${fieldName}_digit_sequence_not_grounded`;
    } else if (lexSlot && !currentGrounded && previous.lastAskedSlot && !previousValue) {
      reason = `${fieldName}_not_grounded_in_current_turn`;
    }
    decisions[fieldName] = {
      before: previousValue || undefined,
      lexSlot: lexSlot || undefined,
      recovered: recoveredValue || undefined,
      previous: previousValue || undefined,
      final: finalValue || undefined,
      decision,
      reason: reason || undefined,
      source
    };
  }
  return decisions;
}

function slotValueLooksLikeScopedDtmfPollution(slot, digit) {
  if (!slot || !digit) {
    return false;
  }
  const values = [
    getSlotOriginalValue(slot),
    getSlotInterpretedValue(slot),
    ...getSlotResolvedValues(slot)
  ].filter(Boolean);
  return values.some((value) => {
    if (readDtmfDigit(value) === digit) {
      return true;
    }
    return new RegExp(`^\\s*${digit}\\s*(?:a\\s*\\.?m\\.?|p\\s*\\.?m\\.?)?\\s*$`, "i").test(
      String(value || "")
    );
  });
}

function isKnownStaffPreference(value, sessionAttributes = {}) {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return false;
  }
  if (normalizeAnyStaffPhrase(value, sessionAttributes)) {
    return true;
  }
  for (const [staffName, aliases] of Object.entries(STAFF_ALIAS_GROUPS)) {
    if (
      aliases.some(
        (alias) =>
          normalized === normalizeForMatch(alias) &&
          !shouldSkipStaffAlias(staffName, alias, normalized, sessionAttributes)
      )
    ) {
      return true;
    }
  }
  return Object.values(getStaffDtmfOptions(sessionAttributes)).some((staffName) => {
    const fullName = normalizeForMatch(staffName);
    const firstName = normalizeForMatch(String(staffName).split(/\s+/)[0]);
    return normalized === fullName || normalized === firstName;
  });
}

function isExactKnownStaffPreference(value, sessionAttributes = {}) {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return false;
  }
  if (normalizeAnyStaffPhrase(value, sessionAttributes)) {
    return true;
  }
  for (const [staffName, aliases] of Object.entries(STAFF_ALIAS_GROUPS)) {
    const canonical = normalizeForMatch(staffName);
    if (
      normalized === canonical ||
      aliases.some(
        (alias) =>
          normalized === normalizeForMatch(alias) &&
          !shouldSkipStaffAlias(staffName, alias, normalized, sessionAttributes)
      )
    ) {
      return true;
    }
  }
  return Object.values(getStaffDtmfOptions(sessionAttributes)).some((staffName) => {
    const fullName = normalizeForMatch(staffName);
    const firstName = normalizeForMatch(String(staffName).split(/\s+/)[0]);
    return normalized === fullName || normalized === firstName;
  });
}

function previousStaffHasValidatedIdentity(sessionAttributes = {}) {
  return Boolean(
    sessionAttributes.staffId ||
      sessionAttributes.selectedStaffId ||
      sessionAttributes.confirmedStaffId
  );
}

function getAuthoritativePreviousStaffPreference(value, sessionAttributes = {}) {
  const raw = String(value || "").trim();
  if (!raw || isInvalidStaffPreferenceNoise(raw, sessionAttributes)) {
    return "";
  }
  if (previousStaffHasValidatedIdentity(sessionAttributes) || isExactKnownStaffPreference(raw, sessionAttributes)) {
    return raw;
  }
  return "";
}

function isInvalidStaffPreferenceNoise(value, sessionAttributes = {}) {
  const raw = String(value || "").trim();
  if (!raw) {
    return false;
  }
  const normalized = normalizeForMatch(raw);
  if (!normalized) {
    return true;
  }
  if (isFinalConfirmationOnlyPhrase(normalized)) {
    return true;
  }
  if (
    previousStaffHasValidatedIdentity(sessionAttributes) &&
    (normalizeForMatch(sessionAttributes.staffPreference) === normalized ||
      normalizeForMatch(sessionAttributes.confirmedStaffName) === normalized)
  ) {
    return false;
  }
  if (isKnownStaffPreference(raw, sessionAttributes)) {
    return false;
  }
  if (extractServiceFromTranscript(raw)) {
    return true;
  }
  if (/^[a-z]$/.test(normalized) || readDtmfDigit(raw)) {
    return true;
  }
  if (
    /^(?:yes|yeah|yep|correct|right|sure|ok|okay|no|nope|am|pm|a m|p m|time|date|service|phone|phone number)$/.test(
      normalized
    )
  ) {
    return true;
  }
  return false;
}

function sanitizeStaffPreferenceValue(value, sessionAttributes = {}) {
  const anyStaff = normalizeAnyStaffPhrase(value, sessionAttributes);
  if (anyStaff) {
    return anyStaff;
  }
  if (!value || isInvalidStaffPreferenceNoise(value, sessionAttributes)) {
    return "";
  }
  if (isExactKnownStaffPreference(value, sessionAttributes)) {
    return value;
  }
  if (
    previousStaffHasValidatedIdentity(sessionAttributes) &&
    normalizeForMatch(value) === normalizeForMatch(sessionAttributes.staffPreference || sessionAttributes.confirmedStaffName)
  ) {
    return value;
  }
  return "";
}

function getCurrentTurnBookingDetails(event) {
  const previous = event.sessionState?.sessionAttributes || {};
  const timeZone = getAttribute(event, attributeNames.timezone) || DEFAULT_SALON_TIMEZONE;
  const transcript = getTranscriptCandidateValues(event)
    .filter((value) => !readDtmfDigit(value))
    .join(" ");
  return extractBookingDetailsFromText(transcript, timeZone, previous);
}

function currentTurnRecognizedService(event) {
  const previous = event.sessionState?.sessionAttributes || {};
  const slots = event.sessionState?.intent?.slots || {};
  const transcript = getCurrentTurnTranscript(event);
  if (hasUnsafeSunsetWithoutExplicitFullSetAlias(transcript)) {
    return "";
  }
  const timeZone = getAttribute(event, attributeNames.timezone) || DEFAULT_SALON_TIMEZONE;
  const topTranscriptService =
    currentTurnServiceMention(event) ||
    extractBookingDetailsFromText(transcript, timeZone, previous).serviceName;
  const alternativeTranscriptService = getCurrentTurnBookingDetails(event).serviceName;
  const transcriptService =
    topTranscriptService ||
    (normalizeServiceName(alternativeTranscriptService) === "Full Set"
      ? ""
      : alternativeTranscriptService);
  const exactSlotService =
    getExactConfiguredServiceName(getSlotValue(slots, slotNames.serviceName), previous) ||
    getExactConfiguredServiceName(
      getSlotValue(slots, slotNames.serviceName, { preferOriginal: true }),
      previous
    );
  const slotService =
    exactSlotService ||
    normalizeServiceName(getSlotValue(slots, slotNames.serviceName, { preferOriginal: true }));
  const candidate = normalizeServiceName(transcriptService || slotService);
  return DEMO_SERVICE_NAMES.includes(candidate) || isDynamicServiceName(candidate, previous) ? candidate : "";
}

function analyzeLexTurnSanitization(event) {
  const previous = event.sessionState?.sessionAttributes || {};
  const slots = event.sessionState?.intent?.slots || {};
  const dtmfDiagnostics = getCurrentTurnDtmfDiagnostics(event);
  const dtmfRouting = buildDtmfRouting(event);
  const scopedServiceDigit = dtmfRouting.accepted
    ? dtmfRouting.route === "service_menu"
      ? dtmfRouting.digit
      : ""
    : getScopedDtmfDigit(event, "serviceName");
  const scopedStaffDigit = dtmfRouting.accepted
    ? dtmfRouting.route === "staff_menu"
      ? dtmfRouting.digit
      : ""
    : getScopedDtmfDigit(event, "staffPreference");
  const scopedDtmfDigit = dtmfRouting.digit || scopedServiceDigit || scopedStaffDigit || "";
  const ignoredPollutedSlots = [];
  const ignoredUngroundedSlots = [];
  const ignoredNoiseFields = [];
  const fieldsToClear = new Set();
  const sanitizedSlots = { ...slots };
  const currentTurnTranscript = getCurrentTurnTranscript(event);
  const timeZone = getAttribute(event, attributeNames.timezone) || DEFAULT_SALON_TIMEZONE;
  const genericFinalConfirmationStaffChange =
    isFinalBookingConfirmationActive(event) &&
    isGenericStaffChangePhrase(normalizeForMatch(currentTurnTranscript));
  const currentTurnDetails = getCurrentTurnBookingDetails(event);
  const recognizedService = currentTurnServiceMention(event);
  const serviceAliasCorrectionRaw = getScopedServiceAliasCorrectionRaw(event);
  const shouldStrictlyGroundSlots = Boolean(previous.lastAskedSlot);
  const customerNameTurnOwnsTranscript =
    previous.lastAskedSlot === "customerName" &&
    !(dtmfRouting.accepted && dtmfRouting.route === "staff_menu");
  const finalConfirmationOnlyPhrase =
    isFinalBookingConfirmationActive(event) && isFinalConfirmationOnlyPhrase(currentTurnTranscript);
  const currentTurnStaffMention = customerNameTurnOwnsTranscript || finalConfirmationOnlyPhrase
    ? ""
    : extractStaffFromTranscript(currentTurnTranscript, previous);
  const currentTurnHasExplicitStaffPhrase = customerNameTurnOwnsTranscript || finalConfirmationOnlyPhrase
    ? false
    : hasExplicitStaffPhrase(currentTurnTranscript, previous);
  const unsafeSunsetServiceSlot = hasUnsafeSunsetWithoutExplicitFullSetAlias(currentTurnTranscript);
  const previousStaffPreferenceForAnalysis =
    getSessionAttribute(previous, slotNames.staffPreference) || previous.confirmedStaffName;
  const authoritativePreviousStaffPreference = getAuthoritativePreviousStaffPreference(
    previousStaffPreferenceForAnalysis,
    previous
  );
  let clearedStaleRequestedTime = false;
  let preservedConfirmedService = false;
  let replacementInputTranscript = "";
  let discardedStaleStaff = "";
  let discardedPlaceholderService = "";
  let staffSource = "";
  let serviceDtmfConflictWithInitialUtterance = "";
  let changed = false;

  if (
    scopedServiceDigit &&
    scopedServiceDigit !== "0" &&
    (previous.lastAskedSlot === "serviceName" || dtmfRouting.route === "service_menu")
  ) {
    const serviceSelection = getActiveDtmfOptions(previous, "service")[scopedServiceDigit];
    if (serviceSelection) {
      const initialService = recognizeFullSetFromTranscript(previous.initialBookingUtterance, {
        ...previous,
        lastAskedSlot: "serviceName",
        activeDtmfMenu: "service"
      });
      if (
        initialService &&
        !valuesEquivalent("serviceName", initialService, serviceSelection, timeZone)
      ) {
        serviceDtmfConflictWithInitialUtterance = initialService;
      } else {
        const { name: serviceSlotName } = getSlotObject(slots, slotNames.serviceName);
        sanitizedSlots[serviceSlotName || "serviceName"] = buildLexSlot(serviceSelection);
        replacementInputTranscript = serviceSelection;
      }
      changed = true;
    }

    for (const [fieldName, names] of Object.entries(slotNames)) {
      if (fieldName === "serviceName") {
        continue;
      }
      const { name, slot } = getSlotObject(slots, names);
      if (!slot) {
        continue;
      }
      const staffNoise =
        fieldName === "staffPreference" &&
        isInvalidStaffPreferenceNoise(
          getSlotOriginalValue(slot) || getSlotInterpretedValue(slot),
          previous
        );
      if (slotValueLooksLikeScopedDtmfPollution(slot, scopedServiceDigit) || staffNoise) {
        delete sanitizedSlots[name];
        ignoredPollutedSlots.push(name);
        fieldsToClear.add(fieldName);
        changed = true;
      }
    }
  }

  if (recognizedService && !(scopedServiceDigit && scopedServiceDigit !== "0")) {
    const { name: serviceSlotName, slot: serviceSlot } = getSlotObject(slots, slotNames.serviceName);
    const staleSlotValue = serviceSlot
      ? getSlotOriginalValue(serviceSlot) || getSlotInterpretedValue(serviceSlot)
      : "";
    sanitizedSlots[serviceSlotName || "serviceName"] = buildLexSlot(recognizedService);
    if (staleSlotValue && !valuesEquivalent("serviceName", staleSlotValue, recognizedService, timeZone)) {
      ignoredPollutedSlots.push(serviceSlotName || "serviceName");
    }
    if (
      previous.confirmedServiceName &&
      !valuesEquivalent("serviceName", previous.confirmedServiceName, recognizedService, timeZone)
    ) {
      ignoredPollutedSlots.push("sessionAttributes.confirmedServiceName");
    }
    changed = true;
  }

  if (unsafeSunsetServiceSlot) {
    const { name: serviceSlotName, slot: serviceSlot } = getSlotObject(slots, slotNames.serviceName);
    if (serviceSlot && sanitizedSlots[serviceSlotName] !== undefined) {
      delete sanitizedSlots[serviceSlotName];
      ignoredUngroundedSlots.push("serviceName_unsafe_sunset");
      changed = true;
    }
  }

  if (scopedStaffDigit && scopedStaffDigit !== "0" && dtmfRouting.accepted && dtmfRouting.route === "staff_menu") {
    const { name: staffSlotName } = getSlotObject(slots, slotNames.staffPreference);
    sanitizedSlots[staffSlotName || "staffPreference"] = buildLexSlot(dtmfRouting.selection);
    replacementInputTranscript = dtmfRouting.selection;
    staffSource = "current_turn_dtmf";
    changed = true;
    for (const [fieldName, names] of Object.entries(slotNames)) {
      if (fieldName === "staffPreference") {
        continue;
      }
      const { name, slot } = getSlotObject(slots, names);
      if (!slot) {
        continue;
      }
      if (slotValueLooksLikeScopedDtmfPollution(slot, scopedStaffDigit)) {
        delete sanitizedSlots[name];
        ignoredPollutedSlots.push(name);
        fieldsToClear.add(fieldName);
        changed = true;
      }
    }
  }

  if (currentTurnStaffMention && !(dtmfRouting.accepted && dtmfRouting.route === "staff_menu")) {
    const { name: staffSlotName, slot: staffSlot } = getSlotObject(slots, slotNames.staffPreference);
    const staleSlotValue = staffSlot
      ? getSlotOriginalValue(staffSlot) || getSlotInterpretedValue(staffSlot)
      : "";
    sanitizedSlots[staffSlotName || "staffPreference"] = buildLexSlot(currentTurnStaffMention);
    staffSource = normalizeForMatch(currentTurnStaffMention) === "any staff"
      ? "current_turn_any_staff"
      : "current_turn_alias";
    if (staleSlotValue && !valuesEquivalent("staffPreference", staleSlotValue, currentTurnStaffMention, timeZone)) {
      ignoredPollutedSlots.push(staffSlotName || "staffPreference");
      discardedStaleStaff = staleSlotValue;
    }
    if (
      previousStaffPreferenceForAnalysis &&
      !valuesEquivalent("staffPreference", previousStaffPreferenceForAnalysis, currentTurnStaffMention, timeZone)
    ) {
      fieldsToClear.add("staffPreference");
      ignoredPollutedSlots.push("sessionAttributes.staffPreference");
      discardedStaleStaff = discardedStaleStaff || previousStaffPreferenceForAnalysis;
    }
    changed = true;
  }

  for (const [fieldName, names] of Object.entries(slotNames)) {
    if (!shouldStrictlyGroundSlots) {
      break;
    }
    if (!["serviceName", "requestedDate", "requestedTime", "staffPreference", "customerName"].includes(fieldName)) {
      continue;
    }
    const { name, slot } = getSlotObject(slots, names);
    if (!slot || sanitizedSlots[name] === undefined) {
      continue;
    }
    const slotValue = getSlotOriginalValue(slot) || getSlotInterpretedValue(slot);
    if (!slotValue) {
      continue;
    }

    const alreadyTrusted = slotValueAlreadyTrusted(fieldName, slotValue, previous, timeZone);
    const grounded = slotValueIsGroundedInCurrentTranscript(
      fieldName,
      slotValue,
      currentTurnTranscript,
      timeZone,
      previous
    );
    const isCurrentAskedSlot = previous.lastAskedSlot === fieldName;
    const isDtmfAcceptedSlot =
      (fieldName === "serviceName" && dtmfRouting.accepted && dtmfRouting.route === "service_menu") ||
      (fieldName === "staffPreference" && dtmfRouting.accepted && dtmfRouting.route === "staff_menu");
    const currentTurnDigitOnlyOrSequence =
      dtmfDiagnostics.isBareDigitUtterance || dtmfDiagnostics.isMultiDigitOrDigitSequence;

    if (
      fieldName === "requestedTime" &&
      (!hasCurrentTurnTimePhrase(currentTurnTranscript, previous) || currentTurnDigitOnlyOrSequence) &&
      !alreadyTrusted
    ) {
      delete sanitizedSlots[name];
      ignoredUngroundedSlots.push(
        currentTurnDigitOnlyOrSequence
          ? "requestedTime_digit_sequence_not_grounded"
          : fieldName
      );
      changed = true;
      continue;
    }

    if (
      fieldName === "requestedDate" &&
      (!hasCurrentTurnDatePhrase(currentTurnTranscript) || currentTurnDigitOnlyOrSequence) &&
      !alreadyTrusted
    ) {
      delete sanitizedSlots[name];
      ignoredUngroundedSlots.push(
        currentTurnDigitOnlyOrSequence
          ? "requestedDate_digit_sequence_not_grounded"
          : fieldName
      );
      changed = true;
      continue;
    }

    if (
      fieldName === "customerName" &&
      previous.lastAskedSlot === "customerName" &&
      isInvalidCustomerNameNoise(currentTurnTranscript)
    ) {
      delete sanitizedSlots[name];
      ignoredNoiseFields.push(fieldName);
      changed = true;
      continue;
    }

    if (
      fieldName === "staffPreference" &&
      isCurrentAskedSlot &&
      !grounded &&
      !isDtmfAcceptedSlot &&
      !currentTurnStaffMention &&
      (currentTurnHasExplicitStaffPhrase || !alreadyTrusted)
    ) {
      delete sanitizedSlots[name];
      ignoredUngroundedSlots.push(fieldName);
      if (currentTurnHasExplicitStaffPhrase && previousStaffPreferenceForAnalysis) {
        fieldsToClear.add("staffPreference");
        discardedStaleStaff = discardedStaleStaff || previousStaffPreferenceForAnalysis;
      }
      changed = true;
      continue;
    }

    if (!isCurrentAskedSlot && !grounded && !alreadyTrusted && !isDtmfAcceptedSlot) {
      delete sanitizedSlots[name];
      ignoredUngroundedSlots.push(fieldName);
      changed = true;
    }
  }

  if (
    previous.lastAskedSlot === "serviceName" &&
    recognizedService === "Full Set" &&
    !currentTurnDetails.requestedDate &&
    !currentTurnDetails.requestedTime &&
    !getSessionAttribute(previous, slotNames.requestedDate) &&
    getSessionAttribute(previous, slotNames.requestedTime)
  ) {
    fieldsToClear.add("requestedTime");
    ignoredPollutedSlots.push("sessionAttributes.requestedTime");
    clearedStaleRequestedTime = true;
    changed = true;
  }

  if (recognizedService === "Full Set" || normalizeServiceName(previous.confirmedServiceName) === "Full Set") {
    preservedConfirmedService = true;
  }

  const previousServiceForPlaceholder =
    previous.confirmedServiceName || getSessionAttribute(previous, slotNames.serviceName);
  if (
    previousServiceForPlaceholder &&
    isInvalidServicePlaceholder(previousServiceForPlaceholder) &&
    !recognizedService &&
    !(scopedServiceDigit && scopedServiceDigit !== "0")
  ) {
    fieldsToClear.add("serviceName");
    ignoredNoiseFields.push("serviceName");
    discardedPlaceholderService = previousServiceForPlaceholder;
    changed = true;
  }

  const { name: staffSlotName, slot: staffSlot } = getSlotObject(slots, slotNames.staffPreference);
  if (
    staffSlot &&
    isInvalidStaffPreferenceNoise(
      getSlotOriginalValue(staffSlot) || getSlotInterpretedValue(staffSlot),
      previous
    )
  ) {
    delete sanitizedSlots[staffSlotName];
    if (!genericFinalConfirmationStaffChange) {
      fieldsToClear.add("staffPreference");
    }
    ignoredPollutedSlots.push(staffSlotName);
    changed = true;
  }
  if (staffSlot && currentTurnStaffMention === "Any staff") {
    sanitizedSlots[staffSlotName || "staffPreference"] = buildLexSlot("Any staff");
    staffSource = "current_turn_any_staff";
    changed = true;
  }

  const { name: customerNameSlotName, slot: customerNameSlot } = getSlotObject(slots, slotNames.customerName);
  if (
    customerNameSlot &&
    previous.lastAskedSlot === "customerName" &&
    isInvalidCustomerNameNoise(currentTurnTranscript)
  ) {
    delete sanitizedSlots[customerNameSlotName];
    ignoredNoiseFields.push("customerName");
    changed = true;
  }

  const previousCustomerName = getSessionAttribute(previous, slotNames.customerName);
  if (
    previousCustomerName &&
    isInvalidCustomerNameNoise(previousCustomerName) &&
    previous.customerNameSource !== "phone_lookup" &&
    !previous.recognizedCustomerName
  ) {
    fieldsToClear.add("customerName");
    ignoredNoiseFields.push("customerName");
    changed = true;
  }

  if (
    previousStaffPreferenceForAnalysis &&
    !authoritativePreviousStaffPreference &&
    !currentTurnStaffMention
  ) {
    fieldsToClear.add("staffPreference");
    ignoredPollutedSlots.push("sessionAttributes.staffPreference");
    discardedStaleStaff = discardedStaleStaff || previousStaffPreferenceForAnalysis;
    changed = true;
  }

  if (
    previousStaffPreferenceForAnalysis &&
    currentTurnHasExplicitStaffPhrase &&
    !currentTurnStaffMention &&
    !genericFinalConfirmationStaffChange
  ) {
    fieldsToClear.add("staffPreference");
    ignoredPollutedSlots.push("sessionAttributes.staffPreference");
    discardedStaleStaff = discardedStaleStaff || previousStaffPreferenceForAnalysis;
    changed = true;
  }

  return {
    scopedDtmfDigit,
    currentTurnTranscript,
    dtmfDiagnostics,
    dtmfRouting,
    ignoredPollutedSlots: Array.from(new Set(ignoredPollutedSlots)),
    ignoredUngroundedSlots: Array.from(new Set(ignoredUngroundedSlots)),
    ignoredNoiseFields: Array.from(new Set(ignoredNoiseFields)),
    currentTurnStaffMention,
    currentTurnHasExplicitStaffPhrase,
    currentTurnServiceMention: recognizedService || "",
    serviceAliasCorrectionRaw,
    discardedPlaceholderService,
    serviceDtmfConflictWithInitialUtterance,
    discardedStaleStaff,
    staffSource,
    fieldsToClear: Array.from(fieldsToClear),
    sanitizedSlots,
    clearedStaleRequestedTime,
    preservedConfirmedService,
    replacementInputTranscript,
    changed
  };
}

function sanitizeLexEvent(event, analysis) {
  const lexTurnDebug = buildLexTurnDebug(event, analysis);
  if (!analysis?.changed) {
    return {
      ...event,
      lexTurnDebug
    };
  }
  const currentTurnStaffWins =
    analysis.currentTurnStaffMention &&
    !(analysis.dtmfRouting?.accepted && analysis.dtmfRouting.route === "staff_menu");
  const sessionAttributes = {
    ...(event.sessionState?.sessionAttributes || {})
  };
  const serviceSelection = analysis.replacementInputTranscript || "";
  if (analysis.serviceDtmfConflictWithInitialUtterance && analysis.dtmfRouting?.selection) {
    sessionAttributes.awaitingServiceConfirmation = "true";
    sessionAttributes.proposedServiceName = analysis.dtmfRouting.selection;
    sessionAttributes.serviceDtmfConflictWithInitialUtterance = analysis.serviceDtmfConflictWithInitialUtterance;
    sessionAttributes.clarificationReason = "service_dtmf_conflicts_initial_utterance";
    delete sessionAttributes.serviceName;
    delete sessionAttributes.confirmedServiceName;
    delete sessionAttributes.serviceId;
    delete sessionAttributes.confirmedServiceId;
  } else if (serviceSelection && DEMO_SERVICE_NAMES.includes(serviceSelection)) {
    sessionAttributes.serviceName = serviceSelection;
    sessionAttributes.confirmedServiceName = serviceSelection;
    sessionAttributes.scopedServiceDtmfInput = "true";
  }
  if (analysis.currentTurnServiceMention && DEMO_SERVICE_NAMES.includes(analysis.currentTurnServiceMention)) {
    sessionAttributes.serviceName = analysis.currentTurnServiceMention;
    sessionAttributes.confirmedServiceName = analysis.currentTurnServiceMention;
    delete sessionAttributes.activeDtmfMenu;
    delete sessionAttributes.activeDtmfOptionsJson;
    delete sessionAttributes.serviceNameDtmf;
    delete sessionAttributes.serviceNameDigit;
    delete sessionAttributes.serviceDtmf;
    delete sessionAttributes.serviceDigit;
    sessionAttributes.serviceRecognitionFailureCount = "0";
    delete sessionAttributes.serviceFallbackCount;
    delete sessionAttributes.invalidServiceCount;
    delete sessionAttributes.serviceClarificationAttempts;
    delete sessionAttributes.serviceFallbackOffered;
  }
  if (analysis.serviceAliasCorrectionRaw) {
    sessionAttributes.serviceAliasCorrectionRaw = analysis.serviceAliasCorrectionRaw;
  }
  if (analysis.dtmfRouting?.accepted && analysis.dtmfRouting.route === "staff_menu") {
    sessionAttributes.staffPreference = analysis.dtmfRouting.selection;
    sessionAttributes.confirmedStaffName = analysis.dtmfRouting.selection;
    const staffId = getStaffDtmfStaffIds(sessionAttributes)[analysis.dtmfRouting.digit] || "";
    if (staffId && normalizeForMatch(analysis.dtmfRouting.selection) !== "any staff") {
      sessionAttributes.staffId = staffId;
      sessionAttributes.selectedStaffId = staffId;
      sessionAttributes.confirmedStaffId = staffId;
    } else {
      delete sessionAttributes.staffId;
      delete sessionAttributes.selectedStaffId;
      delete sessionAttributes.confirmedStaffId;
    }
  }
  for (const fieldName of analysis.fieldsToClear || []) {
    for (const name of slotNames[fieldName] || [fieldName]) {
      delete sessionAttributes[name];
    }
    if (fieldName === "staffPreference") {
      const previousUnrecognizedStaff =
        sessionAttributes.staffPreference || sessionAttributes.confirmedStaffName || analysis.discardedStaleStaff;
      delete sessionAttributes.confirmedStaffName;
      delete sessionAttributes.staffId;
      delete sessionAttributes.selectedStaffId;
      delete sessionAttributes.confirmedStaffId;
      sessionAttributes.invalidStaffPreferenceIgnored = "true";
      if (previousUnrecognizedStaff) {
        sessionAttributes.unrecognizedStaffUtterance = previousUnrecognizedStaff;
      }
    }
  }
  if (analysis.fieldsToClear?.length) {
    const fieldsToKeepCleared = analysis.fieldsToClear.filter(
      (fieldName) => !(currentTurnStaffWins && fieldName === "staffPreference")
    );
    if (fieldsToKeepCleared.length) {
      sessionAttributes.ignoredPollutedSlotFields = JSON.stringify(fieldsToKeepCleared);
    } else {
      delete sessionAttributes.ignoredPollutedSlotFields;
    }
  }
  if (currentTurnStaffWins) {
    sessionAttributes.staffPreference = analysis.currentTurnStaffMention;
    sessionAttributes.confirmedStaffName = analysis.currentTurnStaffMention;
    sessionAttributes.staffSource = analysis.staffSource || "current_turn_alias";
    delete sessionAttributes.invalidStaffPreferenceIgnored;
    if (analysis.discardedStaleStaff) {
      sessionAttributes.discardedStaleStaff = analysis.discardedStaleStaff;
    }
    if (normalizeForMatch(analysis.currentTurnStaffMention) === "any staff") {
      sessionAttributes.staffPreference = "Any staff";
      sessionAttributes.confirmedStaffName = "Any staff";
      sessionAttributes.staffResolutionStatus = "explicit_any";
      delete sessionAttributes.staffId;
      delete sessionAttributes.selectedStaffId;
      delete sessionAttributes.confirmedStaffId;
      delete sessionAttributes.staffRecognitionFailureCount;
      delete sessionAttributes.invalidStaffPreferenceIgnored;
      delete sessionAttributes.discardedStaleStaff;
      delete sessionAttributes.unrecognizedStaffUtterance;
    }
  }
  if (analysis.discardedStaleStaff && !sessionAttributes.discardedStaleStaff) {
    sessionAttributes.discardedStaleStaff = analysis.discardedStaleStaff;
  }
  if (analysis.ignoredUngroundedSlots?.length) {
    sessionAttributes.ignoredUngroundedSlots = JSON.stringify(analysis.ignoredUngroundedSlots);
  }
  if (analysis.ignoredNoiseFields?.length) {
    sessionAttributes.ignoredNoiseFields = JSON.stringify(analysis.ignoredNoiseFields);
  }

  return {
    ...event,
    lexTurnDebug,
    inputTranscript: event.inputTranscript,
    sessionState: {
      ...(event.sessionState || {}),
      sessionAttributes,
      intent: {
        ...(event.sessionState?.intent || {}),
        slots: analysis.sanitizedSlots
      }
    }
  };
}

function readScopedStaffDtmfSelection(event) {
  const previous = event.sessionState?.sessionAttributes || {};
  const digit = getScopedDtmfDigit(event, "staffPreference");
  if (!digit) {
    return null;
  }
  const options = getStaffDtmfOptions(previous);
  const staffName = options[digit];
  if (!staffName) {
    return {
      digit,
      staffName: "",
      staffId: "",
      invalid: true
    };
  }
  return {
    digit,
    staffName,
    staffId: getStaffDtmfStaffIds(previous)[digit] || "",
    invalid: false
  };
}

function isStaffAnyDtmfZeroRequest(event) {
  const selection = readScopedStaffDtmfSelection(event);
  return selection?.digit === "4" && normalizeForMatch(selection.staffName) === "any staff";
}

function buildInvalidStaffDtmfResponse(event) {
  const previous = event.sessionState?.sessionAttributes || {};
  const prompt = previous.staffDtmfPromptText || STAFF_DTMF_PROMPT;
  return buildElicitSlotResponse(
    event,
    "staffPreference",
    {
      invalidStaffDtmfSelection: getScopedDtmfDigit(event, "staffPreference") || "true"
    },
    `I didn't find that option. Please choose from the list. ${prompt}`
  );
}

function extractCustomerNameFromText(text) {
  const match = String(text || "").match(
    /(?:my name is|name is|this is|i am|i'm|you can call me)\s+(\p{L}[\p{L}'-]*(?:\s+\p{L}[\p{L}'-]*){0,4})(?=\s*(?:[,.!?;]|$|and\s+(?:my\s+)?phone|(?:my\s+)?phone\s+(?:number\s+)?(?:is|should|to)))/iu
  );
  const name = collapseSpokenNameSpelling(match?.[1]);
  return isAcceptableCustomerName(name) ? name : "";
}

function extractBareCustomerNameAnswer(text) {
  const raw = String(text || "").trim();
  const candidate = collapseSpokenNameSpelling(raw);
  const normalized = normalizeForMatch(candidate);
  if (
    !raw ||
    readDtmfDigit(raw) ||
    isInvalidCustomerNameNoise(raw) ||
    isExplicitHumanRequestText(raw) ||
    extractServiceFromTranscript(raw) ||
    getPreferredDateCandidate(raw) ||
    normalizeTimePhrase(extractTimeCandidate(raw)) ||
    /(?:phone|number|appointment|book|service|first available|any staff|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|night|am|pm|with|at|on|for|to|by|from|and|the|please|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(raw)
  ) {
    return "";
  }
  if (!isCustomerNameShape(candidate) || normalized.split(" ").length > 4) {
    return "";
  }
  return candidate;
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

function getReferenceDate() {
  const configured = process.env.FASTAIBOOKING_TEST_NOW_ISO;
  if (!configured || process.env.NODE_ENV !== "test") {
    return new Date();
  }
  const parsed = new Date(configured);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function getZonedDateParts(timeZone, date = getReferenceDate()) {
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

function getZonedClockMinutes(timeZone, date = getReferenceDate()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
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

function parseIsoDateParts(value) {
  const match = String(value || "").match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

function getWeekdayForDateParts(parts) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function findSpokenWeekdayToken(value) {
  const normalized = normalizeForMatch(value);
  const match = normalized.match(/\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  return match?.[1] || "";
}

function formatClarificationDate(parts) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
}

function formatClarificationMonthDay(parts) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric"
  }).format(new Date(Date.UTC(parts.year, parts.month - 1, parts.day)));
}

function findWeekdayDateConflict(value, timeZone = DEFAULT_SALON_TIMEZONE) {
  const weekdayToken = findSpokenWeekdayToken(value);
  if (!weekdayToken) {
    return null;
  }
  const explicitParts = parseMonthDayDateParts(value, timeZone) || parseIsoDateParts(value);
  if (!explicitParts) {
    return null;
  }
  const spokenWeekdayIndex = WEEKDAY_INDEXES[weekdayToken];
  const actualWeekdayIndex = getWeekdayForDateParts(explicitParts);
  if (spokenWeekdayIndex === undefined || spokenWeekdayIndex === actualWeekdayIndex) {
    return null;
  }
  const intendedDate = resolveDatePhrase(weekdayToken, timeZone);
  const intendedParts = parseIsoDateParts(intendedDate);
  return {
    spokenWeekday: WEEKDAY_LABELS[spokenWeekdayIndex],
    explicitDate: formatDateParts(explicitParts),
    explicitMonthDay: formatClarificationMonthDay(explicitParts),
    explicitDateLabel: formatClarificationDate(explicitParts),
    actualWeekday: WEEKDAY_LABELS[actualWeekdayIndex],
    intendedDate,
    intendedDateLabel: intendedParts ? formatClarificationDate(intendedParts) : WEEKDAY_LABELS[spokenWeekdayIndex]
  };
}

function buildWeekdayDateConflictPrompt(conflict) {
  return `${conflict.explicitMonthDay} is ${conflict.actualWeekday}. Did you mean ${conflict.explicitDateLabel}, or ${conflict.intendedDateLabel}?`;
}

function getZonedWeekdayIndex(timeZone, date = getReferenceDate()) {
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

  return "";
}

function normalizeRequestedDateValue(value, timeZone = DEFAULT_SALON_TIMEZONE) {
  const resolved = resolveKnownDateValue(value, timeZone);
  return /^\d{4}-\d{2}-\d{2}$/.test(resolved) ? resolved : "";
}

function readSpokenMinuteValue(value) {
  const normalized = normalizeForMatch(value);
  if (/^[0-5]?\d$/.test(normalized)) {
    return Number(normalized);
  }
  if (Object.prototype.hasOwnProperty.call(SPOKEN_MINUTE_BASE, normalized)) {
    return SPOKEN_MINUTE_BASE[normalized];
  }
  const [base, suffix] = normalized.split(/\s+/);
  if (
    Object.prototype.hasOwnProperty.call(SPOKEN_MINUTE_BASE, base) &&
    NUMBER_WORDS[suffix] !== undefined
  ) {
    const minute = SPOKEN_MINUTE_BASE[base] + NUMBER_WORDS[suffix];
    return minute >= 0 && minute <= 59 ? minute : null;
  }
  return null;
}

function normalizeHourMinuteTimeExpression(value) {
  const source = String(value || "")
    .replace(/\b([ap])\s*\.?\s*m\.?\b/gi, "$1m")
    .replace(/\ba\.?m\.?\b/gi, "am")
    .replace(/\bp\.?m\.?\b/gi, "pm");
  const pattern = new RegExp(
    `\\b(${SPOKEN_HOUR_PATTERN}|\\d{1,2})\\s+(?:and\\s+)?(${SPOKEN_MINUTE_PATTERN})(?:\\s+(am|pm))?\\b`,
    "i"
  );
  return source.replace(pattern, (match, hourText, minuteText, periodText) => {
    const hour = /^\d{1,2}$/.test(hourText)
      ? Number(hourText)
      : NUMBER_WORDS[normalizeForMatch(hourText)];
    const minute = readSpokenMinuteValue(minuteText);
    if (!hour || hour < 1 || hour > 12 || minute === null || minute > 59) {
      return match;
    }
    const period = periodText ? ` ${String(periodText).toUpperCase()}` : "";
    return `${hour}:${String(minute).padStart(2, "0")}${period}`;
  });
}

function hasGpsTimeContext(value, context = {}) {
  const normalized = normalizeForMatch(value);
  return Boolean(
    /\bat\s+g\s+p\s+s\b/.test(normalized) ||
      context?.lastAskedSlot === "requestedTime" ||
      context?.currentTurnSemanticType === "TIME_REQUEST" ||
      context?.semanticType === "TIME_REQUEST"
  );
}

function normalizeGpsTimePhrase(value, context = {}) {
  const normalized = normalizeForMatch(value);
  if (!normalized || !hasGpsTimeContext(value, context)) {
    return "";
  }
  if (/\bat\s+g\s+p\s+s\b/.test(normalized)) {
    return "3 PM";
  }
  return /^(?:g\s+p\s+s)$/.test(normalized) ? "3 PM" : "";
}

function hasRequestedTimeContext(context = {}) {
  return Boolean(
    context?.lastAskedSlot === "requestedTime" ||
      context?.currentTurnSemanticType === "TIME_REQUEST" ||
      context?.semanticType === "TIME_REQUEST"
  );
}

function normalizeBareRequestedTimeAnswer(value) {
  const normalized = normalizeSpokenNumbers(normalizeHourMinuteTimeExpression(value || ""))
    .replace(/\b([ap])\s*\.?\s*m\.?\b/gi, "$1m")
    .trim()
    .toLowerCase();
  return normalizeForMatch(normalized)
    .replace(/\b(\d{1,2})\s+([0-5]\d)\b/g, "$1:$2")
    .replace(/^(?:and\s+)?(?:it\s+is|its|it's)\s+/, "")
    .trim();
}

function isBareRequestedTimeAnswer(value, context = {}) {
  if (!hasRequestedTimeContext(context)) {
    return false;
  }
  return /^([1-9]|1[0-2])(?::[0-5]\d)?$/.test(normalizeBareRequestedTimeAnswer(value));
}

function extractTimeCandidate(value, context = {}) {
  const gpsTime = normalizeGpsTimePhrase(value, context);
  if (gpsTime) {
    return gpsTime;
  }
  const normalizedOriginal = normalizeForMatch(value);
  const source = normalizeHourMinuteTimeExpression(value)
    .replace(/\b([ap])\s*\.?\s*m\.?\b/gi, "$1m")
    .trim();
  const searchable = source;
  const normalizedSearchable = normalizeForMatch(searchable);
  const segment = searchable
    .split(/[,.!?;]/)[0]
    ?.trim();
  if (!searchable) {
    return "";
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

  const normalizedOclockMatch = normalizedOriginal.match(
    new RegExp(`\\b(${SPOKEN_HOUR_PATTERN}|\\d{1,2})\\s+o\\s+clock\\b`, "i")
  );
  if (normalizedOclockMatch?.[1]) {
    return `${normalizedOclockMatch[1]} o clock`;
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

  const markedBareMatch = searchable.match(
    new RegExp(
      `\\bat\\s+((?:${SPOKEN_HOUR_PATTERN}|\\d{1,2})(?::\\d{2})?)\\b`,
      "i"
    )
  );
  if (markedBareMatch?.[1]) {
    if (!canUseMarkedBareTimeCandidate(searchable, context)) {
      return "";
    }
    return `at ${markedBareMatch[1]}`;
  }

  if (!segment) {
    return "";
  }

  return isBareRequestedTimeAnswer(segment, context) ? normalizeBareRequestedTimeAnswer(segment) : "";
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

function normalizeTimePhrase(value, datePhrase = "", context = {}) {
  const gpsTime = normalizeGpsTimePhrase(value, context);
  if (gpsTime) {
    return gpsTime;
  }
  let normalized = normalizeSpokenNumbers(normalizeHourMinuteTimeExpression(value))
    .replace(/\b([ap])\s*\.?\s*m\.?\b/gi, "$1m")
    .replace(/\ba\.?m\.?\b/gi, "am")
    .replace(/\bp\.?m\.?\b/gi, "pm")
    .trim();
  const contextText = normalizeForMatch(value);
  const spokenBareHourMatch =
    contextText.match(new RegExp(`\\bat\\s+(${SPOKEN_HOUR_PATTERN}|\\d{1,2})\\b`, "i")) ||
    contextText.match(new RegExp(`\\b(${SPOKEN_HOUR_PATTERN}|\\d{1,2})\\s+o\\s+clock\\b`, "i")) ||
    contextText.match(
      new RegExp(`^(?:at\\s+)?(${SPOKEN_HOUR_PATTERN}|\\d{1,2})(?:\\s+(?:o\\s*clock|o'clock|oclock))?$`, "i")
    );
  if (spokenBareHourMatch?.[1]) {
    const spokenHourValue = NUMBER_WORDS[spokenBareHourMatch[1]] ?? Number(spokenBareHourMatch[1]);
    if (Number.isFinite(spokenHourValue)) {
      normalized = String(spokenHourValue);
    }
  }
  const hasSpokenBareHourCue = Boolean(spokenBareHourMatch);
  const hasMorningContext = /\bmorning\b/.test(contextText);
  const hasAtHourCue = /^at\s+(?:\d{1,2}|[a-z]+)(?::\d{2})?/.test(contextText);
  const hasOclockCue = /\b(?:o\s+clock|oclock)\b/.test(contextText);
  const requestedTimeAnswer = isBareRequestedTimeAnswer(value, context);
  if (hasSpokenBareHourCue && (hasAtHourCue || hasOclockCue || hasRequestedTimeContext(context))) {
    const spokenHour = NUMBER_WORDS[spokenBareHourMatch[1]] ?? Number(spokenBareHourMatch[1]);
    if (Number.isFinite(spokenHour) && spokenHour >= 1 && spokenHour <= 12) {
      const inferredPeriod = hasMorningContext
        ? "AM"
        : spokenHour === 12 || (spokenHour >= 1 && spokenHour <= 7)
          ? "PM"
          : "AM";
      return `${spokenHour} ${inferredPeriod}`;
    }
  }
  const periodMatch = normalized.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  let hour;
  let minute = 0;
  let period = "";

  if (periodMatch) {
    hour = Number(periodMatch[1]);
    minute = Number(periodMatch[2] || 0);
    period = periodMatch[3]?.toUpperCase() || "";
  } else {
    const timeMatch = normalized.match(/^(?:at\s+)?(\d{1,2})(?::(\d{2}))?(?:\s*(?:o\s*'?clock|oclock))?$/i);
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
    } else if (hasAtHourCue || hasOclockCue || requestedTimeAnswer || (hasSpokenBareHourCue && hasRequestedTimeContext(context))) {
      period = hour === 12 || (hour >= 1 && hour <= 7) ? "PM" : "AM";
    } else {
      return "";
    }
  }

  if (hour < 1 || hour > 12 || minute > 59) {
    return "";
  }
  return minute === 0 ? `${hour} ${period}` : `${hour}:${String(minute).padStart(2, "0")} ${period}`;
}

function timePhraseToMinutes(value, context = {}) {
  const normalized = normalizeTimePhrase(value, "", context);
  if (!normalized) {
    return null;
  }
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s+(AM|PM)$/i);
  if (!match) {
    return null;
  }
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const period = String(match[3] || "").toUpperCase();
  if (period === "PM" && hour < 12) {
    hour += 12;
  }
  if (period === "AM" && hour === 12) {
    hour = 0;
  }
  return hour * 60 + minute;
}

function formatMinutesForPrompt(totalMinutes) {
  if (!Number.isFinite(totalMinutes)) {
    return "";
  }
  let hour = Math.floor(totalMinutes / 60);
  const minute = totalMinutes % 60;
  const period = hour >= 12 ? "PM" : "AM";
  hour %= 12;
  if (hour === 0) {
    hour = 12;
  }
  return minute === 0 ? `${hour} ${period}` : `${hour}:${String(minute).padStart(2, "0")} ${period}`;
}

function addTimeCandidate(candidates, candidate) {
  const minutes = timePhraseToMinutes(candidate.text, candidate.context || {});
  if (minutes === null) {
    return;
  }
  const key = `${minutes}`;
  if (candidates.some((item) => item.key === key)) {
    return;
  }
  candidates.push({
    key,
    text: formatMinutesForPrompt(minutes),
    minutes,
    source: candidate.source,
    confidence: candidate.confidence
  });
}

function collectTimeCandidates(value, context = {}) {
  const raw = String(value || "").trim();
  const candidates = [];
  if (!raw) {
    return candidates;
  }
  const normalized = normalizeForMatch(raw);
  const hourWord = `(?:${SPOKEN_HOUR_PATTERN}|\\d{1,2})`;
  const noisyHourMinute = new RegExp(
    `\\b(${hourWord})\\s+(${hourWord})\\s+(${SPOKEN_MINUTE_PATTERN}|\\d{1,2})\\s*(a\\s*m|p\\s*m|am|pm)\\b`,
    "i"
  );
  const noisyMatch = normalized.match(noisyHourMinute);
  if (noisyMatch) {
    addTimeCandidate(candidates, {
      text: `${noisyMatch[1]} ${String(noisyMatch[4]).replace(/\s+/g, "")}`,
      source: "noisy_leading_hour",
      confidence: 0.7,
      context
    });
    addTimeCandidate(candidates, {
      text: `${noisyMatch[2]} ${noisyMatch[3]} ${String(noisyMatch[4]).replace(/\s+/g, "")}`,
      source: "noisy_hour_minute",
      confidence: 0.55,
      context
    });
  }

  const timeCollectionContext =
    context.lastAskedSlot === "requestedTime" ||
    context.currentTurnSemanticType === "TIME_REQUEST" ||
    /\b(?:at|o\s*clock|o'clock|oclock)\b/.test(normalized);
  if (
    timeCollectionContext &&
    !/\b(?:a\s*m|p\s*m|am|pm)\b/.test(normalized) &&
    !/\b\d{1,2}\s*:\s*\d{2}\b/.test(normalized)
  ) {
    const bareHourMatch = normalized.match(
      new RegExp(`\\b(?:at\\s+)?(${hourWord})(?:\\s+(?:o\\s*clock|o'clock|oclock))?\\b`, "i")
    );
    if (bareHourMatch) {
      addTimeCandidate(candidates, {
        text: bareHourMatch[1],
        source: "time_context_bare_hour",
        confidence: 0.88,
        context
      });
    }
  }

  const explicitCandidate = extractTimeCandidate(raw, context);
  if (explicitCandidate) {
    addTimeCandidate(candidates, {
      text: explicitCandidate,
      source: "extract_time_candidate",
      confidence: noisyMatch ? 0.55 : 0.9,
      context
    });
  }

  return candidates.sort((left, right) => (right.confidence || 0) - (left.confidence || 0));
}

function analyzeTimeGrounding(rawTranscript, lexSlotValue, context = {}) {
  const transcriptCandidates = collectTimeCandidates(rawTranscript, context);
  const slotCandidates = collectTimeCandidates(lexSlotValue, {
    ...context,
    lastAskedSlot: context.lastAskedSlot || "requestedTime"
  });
  const candidates = [];
  const transcriptMinuteSet = new Set(transcriptCandidates.map((candidate) => candidate.minutes));
  for (const candidate of transcriptCandidates) {
    addTimeCandidate(candidates, {
      text: candidate.text,
      source: candidate.source,
      confidence: candidate.confidence,
      context
    });
  }
  for (const candidate of slotCandidates) {
    if (transcriptMinuteSet.has(candidate.minutes)) {
      continue;
    }
    addTimeCandidate(candidates, {
      text: candidate.text,
      source: candidate.source,
      confidence: candidate.confidence,
      context
    });
  }
  candidates.sort((left, right) => (right.confidence || 0) - (left.confidence || 0));
  const selected = candidates[0] || null;
  const lexMinutes = timePhraseToMinutes(lexSlotValue, {
    ...context,
    lastAskedSlot: context.lastAskedSlot || "requestedTime"
  });
  const hasConflictingCandidates = new Set(candidates.map((candidate) => candidate.key)).size > 1;
  const hasAmbiguousTranscriptEvidence = transcriptCandidates.length > 1;
  const lexConflictsWithTranscript =
    lexMinutes !== null &&
    transcriptCandidates.length > 0 &&
    !transcriptCandidates.some((candidate) => candidate.minutes === lexMinutes);
  const noisyMultipleTimeEvidence =
    /\b(?:uh|um|ah)\b/.test(normalizeForMatch(rawTranscript)) && hasAmbiguousTranscriptEvidence;
  const requiresConfirmation = Boolean(
    selected &&
      (hasAmbiguousTranscriptEvidence ||
        noisyMultipleTimeEvidence ||
        (lexConflictsWithTranscript && transcriptCandidates.length !== 1))
  );

  return {
    rawTranscript: rawTranscript || "",
    lexSlotValue: lexSlotValue || "",
    candidates: candidates.map(({ key, ...candidate }) => candidate),
    selectedCandidate: selected ? { text: selected.text, minutes: selected.minutes, source: selected.source } : null,
    requiresConfirmation,
    rejectionReason: hasAmbiguousTranscriptEvidence
      ? "multiple_time_candidates"
      : lexConflictsWithTranscript
        ? "lex_slot_conflicts_with_transcript"
        : noisyMultipleTimeEvidence
          ? "noisy_time_transcript"
          : ""
  };
}

function isClearlyInvalidServiceName(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return false;
  }
  const normalized = normalizeForMatch(raw);
  const digits = raw.replace(/\D/g, "");
  if (isInvalidServicePlaceholder(raw)) {
    return true;
  }
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

function extractBookingDetailsFromText(text, timeZone = DEFAULT_SALON_TIMEZONE, context = {}) {
  const raw = String(text || "");
  const serviceName = extractServiceFromTranscript(raw, context);
  const dateMatch = getPreferredDateCandidate(raw);
  const requestedDate = dateMatch?.text ? resolveDatePhrase(dateMatch.text, timeZone) : "";
  let requestedTime = "";

  if (dateMatch?.text && dateMatch.index !== undefined) {
    const afterDate = raw.slice(dateMatch.index + dateMatch.text.length);
    const beforeDate = raw.slice(0, dateMatch.index);
    const timeContext = {
      ...context,
      currentTurnHasDatePhrase: true
    };
    const timeCandidate =
      extractTimeCandidate(afterDate, timeContext) ||
      extractTimeCandidate(beforeDate.split(/[!?;]/).at(-1) || "", timeContext) ||
      extractTimeCandidate(raw, timeContext);
    requestedTime = normalizeTimePhrase(timeCandidate, "", timeContext);
  } else {
    requestedTime = normalizeTimePhrase(extractTimeCandidate(raw, context), "", context);
  }

  return {
    customerName: extractCustomerNameFromText(raw),
    customerPhone: extractCustomerPhoneFromText(raw),
    serviceName,
    requestedDate,
    requestedTime
  };
}

function getIntentConfidence(event, intentName) {
  const scores = [];
  for (const interpretation of event.interpretations || []) {
    const interpretedIntentName = interpretation?.intent?.name;
    if (intentName && interpretedIntentName && interpretedIntentName !== intentName) {
      continue;
    }
    const score = Number(
      interpretation?.nluConfidence?.score ??
        interpretation?.intent?.nluConfidence?.score ??
        interpretation?.intentConfidence
    );
    if (Number.isFinite(score)) {
      scores.push(score);
    }
  }
  return scores.length ? Math.max(...scores) : null;
}

function isExplicitHumanRequestText(text) {
  const normalized = normalizeForMatch(text);
  return /\b(real person|live person|human|operator|representative|talk to a person|talk with a person|talk to someone|speak to a person|speak with a person|speak to someone|speak with someone|speak to an operator|speak with an operator|speak with an agent|speak to an agent|talk to an agent|representative please)\b/.test(
    normalized
  );
}

function shouldTransferToHuman(event, intentName) {
  if (!isStaffAnyDtmfZeroRequest(event) && isOperatorZeroRequest(event)) {
    return {
      transfer: true,
      reason: "customer_pressed_zero"
    };
  }

  if (isExplicitHumanRequestText(event.inputTranscript)) {
    return {
      transfer: true,
      reason: "caller_requested_human"
    };
  }

  if (intentName === "HumanEscalationIntent") {
    const confidence = getIntentConfidence(event, intentName);
    if (confidence !== null && confidence >= 0.7) {
      return {
        transfer: true,
        reason: "caller_requested_human"
      };
    }
  }

  return {
    transfer: false,
    reason: ""
  };
}

function isOperatorZeroRequest(event) {
  const slots = event.sessionState?.intent?.slots || {};
  const values = [
    event.inputTranscript,
    ...Object.values(slots).map((slot) => slot?.value?.originalValue || slot?.value?.interpretedValue)
  ];
  return values.some(isOperatorZeroValue);
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

function getDynamicServiceNames(sessionAttributes = {}) {
  const names = Object.values(parseDtmfRecord(sessionAttributes.serviceDtmfOptions));
  try {
    const activeNames = JSON.parse(String(sessionAttributes.activeServiceNames || "[]"));
    if (Array.isArray(activeNames)) {
      names.push(...activeNames.filter((name) => typeof name === "string"));
    }
  } catch {
    // Ignore malformed dynamic menu attributes and fall back to static aliases.
  }
  return names.filter(Boolean);
}

function uniqueRuntimeHintNames(values = []) {
  const seen = new Set();
  return values
    .map((value) => String(value || "").trim())
    .filter((value) => value && value !== "__operator__")
    .filter((value) => {
      const key = normalizeForMatch(value);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 25);
}

function buildRuntimeHintsForSlot(slotToElicit, sessionAttributes = {}) {
  if (slotToElicit !== "serviceName" && slotToElicit !== "staffPreference") {
    return undefined;
  }
  const hintValues =
    slotToElicit === "serviceName"
      ? uniqueRuntimeHintNames([
          ...parseStringListAttribute(sessionAttributes.activeServiceNames),
          ...Object.values(getServiceDtmfOptions(sessionAttributes))
        ])
      : uniqueRuntimeHintNames([
          ...Object.values(getStaffDtmfOptions(sessionAttributes)),
          "Any staff",
          "Any staff is fine",
          "Any stuff is fine",
          "Anyone is fine",
          "First available",
          "Whoever is available"
        ]);
  if (!hintValues.length) {
    return undefined;
  }
  return {
    slotHints: {
      BookAppointmentIntent: {
        [slotToElicit]: {
          runtimeHintValues: hintValues.map((phrase) => ({ phrase }))
        }
      }
    }
  };
}

function isDynamicServiceName(value, sessionAttributes = {}) {
  const normalized = normalizeForMatch(value);
  return Boolean(
    normalized &&
      getDynamicServiceNames(sessionAttributes).some(
        (serviceName) => normalizeForMatch(serviceName) === normalized
      )
  );
}

function isRecognizedService(value, sessionAttributes = {}) {
  if (isClearlyInvalidServiceName(value)) {
    return false;
  }
  const serviceName = normalizeServiceName(value);
  if (isDynamicServiceName(serviceName, sessionAttributes)) {
    return true;
  }
  if (!DEMO_SERVICE_NAMES.includes(serviceName)) {
    return false;
  }
  const compact = compactForMatch(value);
  return SERVICE_ALIASES.some((alias) => {
    const aliasCompact = compactForMatch(alias);
    return compact === aliasCompact || compact.includes(aliasCompact);
  });
}

function getConfirmedRecognizedService(sessionAttributes = {}) {
  const serviceName = normalizeServiceName(
    sessionAttributes.confirmedServiceName ||
      getSessionAttribute(sessionAttributes, slotNames.serviceName)
  );
  return serviceName && isRecognizedService(serviceName, sessionAttributes) ? serviceName : "";
}

function isBookingFallbackIntent(intentName) {
  return (
    intentName === "FallbackIntent" ||
    intentName === "AMAZON.FallbackIntent" ||
    intentName === ""
  );
}

function isBookingInProgress(event) {
  const previous = event.sessionState?.sessionAttributes || {};
  return Boolean(
    previous.lastAskedSlot ||
      getConfirmedRecognizedService(previous) ||
      getSessionAttribute(previous, slotNames.requestedDate) ||
      getSessionAttribute(previous, slotNames.requestedTime) ||
      getSessionAttribute(previous, slotNames.customerName) ||
      getSessionAttribute(previous, slotNames.customerPhone)
  );
}

function shouldTreatFallbackAsBooking(event, intentName) {
  if (!isBookingFallbackIntent(intentName)) {
    return false;
  }
  if (isFinalBookingConfirmationActive(event)) {
    return true;
  }
  const transcript = getCurrentTurnTranscript(event);
  const previous = event.sessionState?.sessionAttributes || {};
  const recognizedService = currentTurnRecognizedService(event);
  const staffAnswer = extractStaffFromTranscript(transcript, previous);
  if (!isBookingInProgress(event)) {
    return Boolean(
      transcript &&
        (recognizedService ||
          ((hasCurrentTurnTimePhrase(transcript) ||
            hasCurrentTurnDatePhrase(transcript) ||
            staffAnswer) &&
            isBookingLikeUtterance(transcript)))
    );
  }
  if (
    recognizedService &&
    (previous.lastAskedSlot === "serviceName" || previous.activeDtmfMenu === "service")
  ) {
    return true;
  }
  return Boolean(
    transcript &&
      (hasCurrentTurnTimePhrase(transcript) ||
        hasCurrentTurnDatePhrase(transcript) ||
        extractCustomerNameFromText(transcript) ||
        extractBareCustomerNameAnswer(transcript) ||
        staffAnswer ||
        readCurrentTurnDigit(event) ||
        isBookingLikeUtterance(transcript))
  );
}

function isBookingLikeUtterance(text) {
  return /\b(book|booking|schedule|appointment|service|nail|nails|pedicure|manicure|full\s*set|today|tomorrow|any\s+staff|first\s+available)\b/i.test(
    text || ""
  );
}

function shouldPromptForServiceFallback(event, intentName) {
  const previous = event.sessionState?.sessionAttributes || {};
  if (getConfirmedRecognizedService(previous)) {
    return false;
  }
  if (readScopedDtmfSelection(event, "serviceName", getActiveDtmfOptions(previous, "service"))) {
    return false;
  }
  if (previous.serviceFallbackOffered === "true") {
    return false;
  }

  const transcript = [
    event.inputTranscript,
    getAttribute(event, attributeNames.transcript)
  ].filter(Boolean).join(" ");
  if (isBookingFallbackIntent(intentName)) {
    return isBookingLikeUtterance(transcript);
  }

  if (intentName !== "BookAppointmentIntent") {
    return false;
  }

  const serviceName = getKnownField(event, "serviceName", { preferOriginal: true });
  if (!serviceName || normalizePedicureService(serviceName) === "Pedicure") {
    return false;
  }
  if (isRecognizedService(serviceName, previous)) {
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

function isAffirmativeUtterance(value) {
  return /^(?:yes|yeah|yep|correct|right|sure|ok|okay|confirm|confirmed|go ahead|book it|that is correct|please|connect me|one|1)$/i.test(
    normalizeForMatch(value)
  );
}

function isNegativeUtterance(value) {
  return /^(?:no|nope|not now|no thanks|not correct|change it|update it|do not|dont|don t|two|2)$/i.test(
    normalizeForMatch(value)
  );
}

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
  "one",
  "1",
  "sure",
  "ok",
  "okay",
  "proceed",
  "do it"
]);

function isFinalConfirmationOnlyPhrase(value) {
  return FINAL_CONFIRMATION_ONLY_PHRASES.has(normalizeForMatch(value));
}

const FINAL_CONFIRMATION_OUTCOME = {
  AFFIRMED: "AFFIRMED",
  DENIED: "DENIED",
  CHANGE_REQUEST: "CHANGE_REQUEST",
  UNKNOWN: "UNKNOWN"
};

function classifyFinalBookingConfirmation(value) {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return FINAL_CONFIRMATION_OUTCOME.UNKNOWN;
  }
  if (isFinalConfirmationOnlyPhrase(normalized)) {
    return FINAL_CONFIRMATION_OUTCOME.AFFIRMED;
  }

  const hasChangeRequest =
    /\b(?:change|make it|instead|switch|move it|can we do|could we do|actually)\b/.test(normalized);
  const hasStaffChangeRequest =
    /\b(?:change|switch)\s+(?:the\s+)?(?:person|staff|technician|tech)\b/.test(normalized) ||
    /\b(?:someone else|different person|different staff|different technician|different tech)\b/.test(normalized) ||
    /\bnot\s+(?!correct\b|right\b|book\b|it\b|that\b|my\b|me\b|name\b)[a-z][a-z\s'-]{1,40}\b/.test(normalized) ||
    /\bwith\s+[a-z][a-z\s'-]{1,40}\s+instead\b/.test(normalized);
  const hasNewBookingValue =
    extractServiceFromTranscript(value) ||
    hasCurrentTurnDatePhrase(value) ||
    hasCurrentTurnTimePhrase(value) ||
    extractStaffFromTranscript(value);
  const hasExplicitNegation =
    /\b(?:no|nope|nah|wrong|not correct|not right|change it|update it|do not|don t|dont|cancel it|wait no)\b/.test(normalized) ||
    /^(?:2|two)$/.test(normalized);

  const hasAffirmation =
    /\b(?:yes|yeah|yep|correct|right|sure|ok|okay)\b/.test(normalized) ||
    /^(?:1|one)$/.test(normalized) ||
    /\b(?:that s right|that is right|sounds good|that s fine|that is fine|go ahead|please book it|book it|confirm it)\b/.test(
      normalized
    );

  if (hasStaffChangeRequest) {
    return FINAL_CONFIRMATION_OUTCOME.CHANGE_REQUEST;
  }

  if ((hasExplicitNegation || hasChangeRequest) && hasNewBookingValue) {
    return FINAL_CONFIRMATION_OUTCOME.CHANGE_REQUEST;
  }

  if (
    hasNewBookingValue &&
    hasAffirmation &&
    /\b(?:but|actually|instead|change|make|move|switch|want|need|with|at|for)\b/.test(normalized)
  ) {
    return FINAL_CONFIRMATION_OUTCOME.CHANGE_REQUEST;
  }

  if (hasNewBookingValue && !hasAffirmation) {
    return FINAL_CONFIRMATION_OUTCOME.CHANGE_REQUEST;
  }

  if (hasExplicitNegation) {
    return FINAL_CONFIRMATION_OUTCOME.DENIED;
  }

  if (hasAffirmation) {
    return FINAL_CONFIRMATION_OUTCOME.AFFIRMED;
  }

  return FINAL_CONFIRMATION_OUTCOME.UNKNOWN;
}

function isFinalBookingConfirmationActive(event) {
  const sessionAttributes = event.sessionState?.sessionAttributes || {};
  return Boolean(
    sessionAttributes.awaitingFinalBookingConfirmation === "true" ||
      sessionAttributes.lastAskedSlot === "bookingConfirmation"
  );
}

function withIntentName(event, intentName) {
  return {
    ...event,
    sessionState: {
      ...(event.sessionState || {}),
      intent: {
        ...(event.sessionState?.intent || {}),
        name: intentName
      }
    }
  };
}

function shouldRepairRescheduleToActiveBookingIntent(event, rawIntentName) {
  if (rawIntentName !== "RescheduleAppointmentIntent" || !isFinalBookingConfirmationActive(event)) {
    return false;
  }
  const sessionAttributes = event.sessionState?.sessionAttributes || {};
  if (sessionAttributes.existingAppointmentId || sessionAttributes.rescheduleFlowActive === "true") {
    return false;
  }
  const text = normalizeForMatch(event.inputTranscript);
  if (!text) {
    return false;
  }
  const mentionsExistingAppointment =
    /\b(?:my appointment|existing appointment|current appointment|my booking|existing booking|current booking)\b/.test(text) ||
    /\b(?:reschedule|re schedule|change|move|update)\b.*\b(?:appointment|booking)\b/.test(text);
  return !mentionsExistingAppointment;
}

function shouldRepairToRescheduleIntent(event, rawIntentName) {
  if (rawIntentName === "RescheduleAppointmentIntent" || rawIntentName === "CancelAppointmentIntent") {
    return false;
  }
  const sessionAttributes = event.sessionState?.sessionAttributes || {};
  const text = normalizeForMatch(event.inputTranscript);
  if (!text) {
    return false;
  }
  const mentionsExistingAppointment =
    /\b(?:my appointment|existing appointment|current appointment)\b/.test(text) ||
    /\b(?:reschedule|re schedule|change|move|update)\b.*\bappointment\b/.test(text);
  const hasExistingAppointmentContext = Boolean(sessionAttributes.existingAppointmentId);
  const asksToMoveExistingContext =
    hasExistingAppointmentContext &&
    /\b(?:reschedule|re schedule|change|move|update|different technician|different staff|different person|can i move it)\b/.test(text);
  const bookingConfirmationStaffChange =
    isFinalBookingConfirmationActive(event) &&
    !mentionsExistingAppointment &&
    /\b(?:change|switch)\s+(?:the\s+)?(?:person|staff|technician|tech)\b|\b(?:someone else|different person|different staff|different technician|different tech)\b|\bwith\s+[a-z][a-z\s'-]{1,40}\s+instead\b|\bnot\s+(?!correct\b|right\b|book\b|it\b|that\b)[a-z][a-z\s'-]{1,40}\b/.test(text);
  return !bookingConfirmationStaffChange && (mentionsExistingAppointment || asksToMoveExistingContext);
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
  if (slotName === "serviceName" || slotName === "staffPreference") {
    return prompts[Math.min(Math.max(attemptCount, 1), prompts.length) - 1] || prompts[0];
  }
  return prompts[promptIndexFor(event, slotName, attemptCount, prompts.length)] || prompts[0];
}

function formatDateForPrompt(value, timeZone = DEFAULT_SALON_TIMEZONE) {
  const resolved = normalizeRequestedDateValue(value, timeZone);
  if (!resolved) {
    return "";
  }
  const today = formatDateParts(getZonedDateParts(timeZone));
  const tomorrow = formatDateParts(addDaysToDateParts(getZonedDateParts(timeZone), 1));
  if (resolved === today) {
    return "today";
  }
  if (resolved === tomorrow) {
    return "tomorrow";
  }
  const [year, month, day] = resolved.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "short",
    day: "numeric"
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatTimeForPrompt(value) {
  const normalized = normalizeTimePhrase(value);
  if (normalized) {
    return normalized;
  }
  const raw = String(value || "").trim();
  const match = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) {
    return raw;
  }
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = hour >= 12 ? "PM" : "AM";
  if (hour === 0) {
    hour = 12;
  } else if (hour > 12) {
    hour -= 12;
  }
  return minute === 0 ? `${hour} ${period}` : `${hour}:${String(minute).padStart(2, "0")} ${period}`;
}

function getPastRequestedDateTimeDecision(event, knownAttributes = undefined) {
  const known = knownAttributes || buildKnownBookingSessionAttributes(event);
  const timeZone = getAttribute(event, attributeNames.timezone) || DEFAULT_SALON_TIMEZONE;
  const requestedDate = normalizeRequestedDateValue(known.requestedDate, timeZone);
  const requestedTime = known.requestedTime;
  const requestedMinutes = timePhraseToMinutes(requestedTime, known);
  if (!requestedDate || requestedMinutes === null) {
    return null;
  }

  const today = formatDateParts(getZonedDateParts(timeZone));
  if (requestedDate > today) {
    return null;
  }
  const nowMinutes = getZonedClockMinutes(timeZone);
  if (requestedDate < today || (nowMinutes !== null && requestedMinutes <= nowMinutes)) {
    return {
      requestedDate,
      requestedTime: formatMinutesForPrompt(requestedMinutes),
      timeZone
    };
  }
  return null;
}

function buildPastRequestedDateTimeResponse(event, decision = null) {
  const response = buildElicitSlotResponse(
    event,
    "requestedDate",
    {
      dateTimeValidationReason: "past_requested_time",
      awaitingFinalBookingConfirmation: "false",
      bookingConfirmationAsked: "false",
      forceHumanEscalation: "false",
      transferToQueue: "false"
    },
    "That time has already passed. What future date and time would you like?"
  );
  const attrs = response.sessionState?.sessionAttributes || {};
  for (const key of [
    "requestedDate",
    "RequestedDate",
    "preferredDate",
    "PreferredDate",
    "trustedRequestedDate",
    "requestedTime",
    "RequestedTime",
    "preferredTime",
    "PreferredTime",
    "trustedRequestedTime",
    "awaitingTimeConfirmation",
    "proposedRequestedTime"
  ]) {
    delete attrs[key];
  }
  attrs.dateTimeValidationReason = "past_requested_time";
  if (decision?.requestedDate) {
    attrs.rejectedRequestedDate = decision.requestedDate;
  }
  if (decision?.requestedTime) {
    attrs.rejectedRequestedTime = decision.requestedTime;
  }
  const slots = response.sessionState?.intent?.slots || {};
  for (const key of ["requestedDate", "RequestedDate", "preferredDate", "PreferredDate"]) {
    if (Object.prototype.hasOwnProperty.call(slots, key)) {
      slots[key] = null;
    }
  }
  for (const key of ["requestedTime", "RequestedTime", "preferredTime", "PreferredTime"]) {
    if (Object.prototype.hasOwnProperty.call(slots, key)) {
      slots[key] = null;
    }
  }
  return response;
}

function buildKnownBookingPromptSummary(event, options = {}) {
  const known = buildKnownBookingSessionAttributes(event);
  const timeZone = getAttribute(event, attributeNames.timezone) || DEFAULT_SALON_TIMEZONE;
  const serviceName = normalizeServiceName(known.confirmedServiceName || known.serviceName);
  const date = formatDateForPrompt(known.requestedDate, timeZone);
  const time = formatTimeForPrompt(known.requestedTime);
  const staff = known.staffPreference || known.confirmedStaffName;
  const pieces = [];
  if (serviceName) {
    pieces.push(serviceName);
  }
  if (date && time) {
    pieces.push(options.forPhrase ? `for ${date} at ${time}` : `${date} at ${time}`);
  } else if (date) {
    pieces.push(options.forPhrase ? `for ${date}` : date);
  } else if (time) {
    pieces.push(`at ${time}`);
  }
  if (staff) {
    pieces.push(`with ${staff}`);
  }
  return pieces.join(" ").replace(/\s+/g, " ").trim();
}

function currentTurnRepeatsKnownBookingField(event) {
  const known = buildKnownBookingSessionAttributes(event);
  const transcript = getCurrentTurnTranscript(event);
  const timeZone = getAttribute(event, attributeNames.timezone) || DEFAULT_SALON_TIMEZONE;
  const currentDetails = extractBookingDetailsFromText(transcript, timeZone);
  const knownService = normalizeServiceName(known.confirmedServiceName || known.serviceName);
  if (
    currentDetails.serviceName &&
    knownService &&
    valuesEquivalent("serviceName", currentDetails.serviceName, knownService, timeZone)
  ) {
    return true;
  }
  if (
    currentDetails.requestedDate &&
    known.requestedDate &&
    valuesEquivalent("requestedDate", currentDetails.requestedDate, known.requestedDate, timeZone)
  ) {
    return true;
  }
  if (
    currentDetails.requestedTime &&
    known.requestedTime &&
    valuesEquivalent("requestedTime", currentDetails.requestedTime, known.requestedTime, timeZone)
  ) {
    return true;
  }
  const staff = extractStaffFromTranscript(transcript, known);
  return Boolean(
    staff &&
      (known.staffPreference || known.confirmedStaffName) &&
      valuesEquivalent("staffPreference", staff, known.staffPreference || known.confirmedStaffName, timeZone)
  );
}

function buildCustomerNamePrompt(event, options = {}) {
  const summary = buildKnownBookingPromptSummary(event, {
    forPhrase: options.already
  });
  if (options.spell && !options.already) {
    return "Sorry, could you spell your first name, one letter at a time?";
  }
  if (options.retry && !options.already) {
    return "Sorry, I didn't catch your name. Could you say your first name slowly?";
  }
  if (options.already && summary) {
    return `I already have ${summary}. What name should I put on the appointment?`;
  }
  if (summary) {
    return `I have your ${summary}. May I have your name, please?`;
  }
  return "I'd be happy to help. May I have your name, please?";
}

function getServiceAwareElicitPrompt(event, slotName, attemptCount, knownOverride = undefined) {
  const prompt = getElicitPrompt(event, slotName, attemptCount);
  const known = knownOverride || buildKnownBookingSessionAttributes(event);
  if (slotName === "serviceName") {
    const time = formatTimeForPrompt(known.requestedTime);
    const staff = known.staffPreference || known.confirmedStaffName;
    const date = formatDateForPrompt(
      known.requestedDate,
      getAttribute(event, attributeNames.timezone) || DEFAULT_SALON_TIMEZONE
    );
    if (!known.serviceName && !date && time && staff) {
      return `I caught ${time} with ${staff}. What day and service would you like?`;
    }
    return prompt;
  }
  if (slotName === "customerName") {
    return buildCustomerNamePrompt(event, {
      retry: attemptCount > 1,
      spell: attemptCount > 2
    });
  }
  if (slotName !== "staffPreference") {
    return prompt;
  }
  const serviceName = normalizeServiceName(known.confirmedServiceName || known.serviceName);
  if (!serviceName || /^got it[, ]/i.test(prompt)) {
    return prompt;
  }
  if (currentTurnRepeatsKnownBookingField(event)) {
    return `I already have ${serviceName}. ${prompt}`;
  }
  return `Got it, ${serviceName}. ${prompt}`;
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
  const slots = event.sessionState?.intent?.slots || {};
  const dtmfDiagnostics = getCurrentTurnDtmfDiagnostics(event);
  const eventTranscriptIsDtmf = Boolean(readDtmfDigit(event.inputTranscript));
  const eventInputIsScopedServiceDtmf =
    eventTranscriptIsDtmf || previous.scopedServiceDtmfInput === "true";
  const initial =
    previous.initialBookingUtterance ||
    (eventInputIsScopedServiceDtmf ? "" : event.inputTranscript) ||
    "";
  const timeZone = getAttribute(event, attributeNames.timezone) || DEFAULT_SALON_TIMEZONE;
  const transcriptValues = [event.inputTranscript, getAttribute(event, attributeNames.transcript), initial]
    .filter((value, index, values) => value && values.indexOf(value) === index)
  const transcript = transcriptValues.join(" ");
  const currentTurnTranscript = event.inputTranscript || "";
  const currentRecoveryTranscript = [currentTurnTranscript]
    .filter((value) => value && !readDtmfDigit(value))
    .join(" ");
  const currentTurnIsDigitNoise =
    dtmfDiagnostics.isBareDigitUtterance || dtmfDiagnostics.isMultiDigitOrDigitSequence;
  const ignoreLexTimeFromWrongSlotDigit =
    currentTurnIsDigitNoise &&
    previous.lastAskedSlot &&
    previous.lastAskedSlot !== "requestedTime" &&
    previous.activeDtmfMenu !== "staff";
  const knownDate =
    getSlotValue(slots, slotNames.requestedDate) ||
    getSessionAttribute(previous, slotNames.requestedDate);
  const previousDate = getSessionAttribute(previous, slotNames.requestedDate);
  const previousTime = getSessionAttribute(previous, slotNames.requestedTime);
  const rawLexKnownTime = ignoreLexTimeFromWrongSlotDigit
    ? ""
    : getSlotValue(slots, slotNames.requestedTime, { preferOriginal: true });
  const lexTimeMutationPolicy = buildVoiceSlotMutationPolicy({
    slotName: "requestedTime",
    proposedValue: rawLexKnownTime,
    trustedValue: previousTime,
    transcript: currentTurnTranscript,
    sessionAttributes: {
      ...previous,
      inputMode: getInputMode(event)
    }
  });
  const lexKnownTime = rawLexKnownTime && lexTimeMutationPolicy.accepted ? rawLexKnownTime : "";
  const timeGrounding = analyzeTimeGrounding(currentTurnTranscript, lexKnownTime, previous);
  const knownTime =
    lexKnownTime ||
    getSessionAttribute(previous, slotNames.requestedTime);
  const rawKnownService =
    getSlotValue(slots, slotNames.serviceName, { preferOriginal: true }) ||
    getSessionAttribute(previous, slotNames.serviceName);
  const serviceDtmfSelection = readScopedDtmfSelection(
    event,
    "serviceName",
    getActiveDtmfOptions(previous, "service")
  );
  const serviceDtmfServiceId = serviceDtmfSelection ? readScopedServiceDtmfId(event) : "";
  const staffDtmfSelection = readScopedStaffDtmfSelection(event);
  const recoveryTranscript =
    serviceDtmfSelection || staffDtmfSelection || currentTurnIsDigitNoise
      ? transcriptValues.filter((value) => !readDtmfDigit(value)).join(" ")
      : transcript;
  const currentRecovered = extractBookingDetailsFromText(currentRecoveryTranscript, timeZone, previous);
  const recovered = extractBookingDetailsFromText(recoveryTranscript, timeZone, previous);
  const initialRecoveredService = initial
    ? normalizeServiceName(extractBookingDetailsFromText(initial, timeZone, previous).serviceName)
    : "";
  const normalizedKnownService = normalizeServiceName(rawKnownService);
  const knownService =
    normalizedKnownService && isRecognizedService(normalizedKnownService, previous)
      ? normalizedKnownService
      : "";
  const previousService = normalizeServiceName(
    previous.confirmedServiceName || getSessionAttribute(previous, slotNames.serviceName)
  );
  const stablePreviousService =
    previousService && isRecognizedService(previousService, previous) ? previousService : "";
  const amazonConnectCustomerPhone = getAttribute(event, attributeNames.customerNumber);
  const protectedCustomerName =
    previous.recognizedCustomerName ||
    (previous.customerNameSource === "phone_lookup" ? previous.customerName : "");
  const explicitCustomerName =
    currentRecovered.customerName ||
    (previous.lastAskedSlot === "customerName" ? extractBareCustomerNameAnswer(event.inputTranscript) : "");
  const previousStaffPreference =
    getSessionAttribute(previous, slotNames.staffPreference) || previous.confirmedStaffName;
  const cleanPreviousStaffPreference = getAuthoritativePreviousStaffPreference(
    previousStaffPreference,
    previous
  );
  const knownStaffPreference = sanitizeStaffPreferenceValue(
    getKnownField(event, "staffPreference"),
    previous
  );
  const customerNameTurnOwnsTranscript =
    previous.lastAskedSlot === "customerName" &&
    !(staffDtmfSelection && !staffDtmfSelection.invalid);
  const currentTurnStaffMention = customerNameTurnOwnsTranscript
    ? ""
    : extractStaffFromTranscript(event.inputTranscript, previous);
  const transcriptStaffMention = customerNameTurnOwnsTranscript
    ? ""
    : extractStaffFromTranscript(transcript, previous);
  const currentTurnHasGroundedDate = hasCurrentTurnDatePhrase(event.inputTranscript);
  const currentTurnHasGroundedTime =
    hasCurrentTurnTimePhrase(event.inputTranscript, previous) && !timeGrounding.requiresConfirmation;
  const ignoreUngroundedCurrentLexTime =
    Boolean(lexKnownTime) &&
    !previousTime &&
    Boolean(currentTurnTranscript) &&
    !currentTurnHasGroundedTime &&
    hasRequestedTimeContext(previous);
  const recoveredDateIsGrounded =
    Boolean(currentRecovered.requestedDate) && currentTurnHasGroundedDate;
  const recoveredTimeIsGrounded =
    Boolean(currentRecovered.requestedTime) && currentTurnHasGroundedTime;
  const currentService = currentTurnRecognizedService(event);
  const serviceAliasCorrectionRaw = getScopedServiceAliasCorrectionRaw(event);
  const previousResolvedDate = resolveKnownDateValue(previousDate, timeZone);
  const knownResolvedDate = resolveKnownDateValue(knownDate, timeZone);
  const previousResolvedTime = normalizeTimePhrase(previousTime) || previousTime;
  const knownResolvedTime =
    ignoreUngroundedCurrentLexTime || timeGrounding.requiresConfirmation
      ? ""
      : normalizeTimePhrase(knownTime) || knownTime;
  const serviceDtmfConflictsWithInitial =
    Boolean(serviceDtmfSelection) &&
    Boolean(initialRecoveredService) &&
    isRecognizedService(initialRecoveredService, previous) &&
    !valuesEquivalent("serviceName", serviceDtmfSelection, initialRecoveredService, timeZone);
  const trustedServiceDtmfSelection = serviceDtmfConflictsWithInitial ? "" : serviceDtmfSelection;
  const trustedServiceDtmfServiceId = serviceDtmfConflictsWithInitial ? "" : serviceDtmfServiceId;
  const historicalRecoveredDate =
    !previousResolvedDate && !knownResolvedDate ? recovered.requestedDate : "";
  const historicalRecoveredTime =
    !previousResolvedTime && !knownResolvedTime ? recovered.requestedTime : "";
  const historicalRecoveredService =
    !serviceDtmfConflictsWithInitial && !stablePreviousService && !knownService
      ? recovered.serviceName
      : "";
  const historicalStaffMention =
    !cleanPreviousStaffPreference && !knownStaffPreference ? transcriptStaffMention : "";
  const finalDate = previousResolvedDate && !recoveredDateIsGrounded
    ? previousResolvedDate
    : currentRecovered.requestedDate || previousResolvedDate || knownResolvedDate || historicalRecoveredDate;
  const finalTime = previousResolvedTime && !recoveredTimeIsGrounded
    ? previousResolvedTime
    : (recoveredTimeIsGrounded ? currentRecovered.requestedTime : "") ||
      previousResolvedTime ||
      knownResolvedTime ||
      historicalRecoveredTime;
  const known = {
	    recognizedCustomerName: previous.recognizedCustomerName,
    customerNameSource:
      previous.customerNameSource === "phone_lookup"
        ? "phone_lookup"
        : previous.customerNameSource,
	    customerName:
	      protectedCustomerName ||
	      explicitCustomerName ||
	      getKnownField(event, "customerName"),
    customerPhone:
      amazonConnectCustomerPhone ||
      getKnownField(event, "customerPhone") ||
      recovered.customerPhone ||
      amazonConnectCustomerPhone,
    serviceName: trustedServiceDtmfSelection || currentService || stablePreviousService || knownService || historicalRecoveredService,
    serviceId: trustedServiceDtmfServiceId || previous.serviceId,
    requestedDate: finalDate,
    requestedTime: finalTime,
    staffPreference:
      (staffDtmfSelection && !staffDtmfSelection.invalid ? staffDtmfSelection.staffName : "") ||
      currentTurnStaffMention ||
      cleanPreviousStaffPreference ||
      knownStaffPreference ||
      historicalStaffMention,
    staffId:
      (staffDtmfSelection && !staffDtmfSelection.invalid ? staffDtmfSelection.staffId : "") ||
      (!currentTurnStaffMention && cleanPreviousStaffPreference
        ? previous.staffId || previous.selectedStaffId
        : ""),
    selectedStaffId:
      (staffDtmfSelection && !staffDtmfSelection.invalid ? staffDtmfSelection.staffId : "") ||
      (!currentTurnStaffMention && cleanPreviousStaffPreference
        ? previous.selectedStaffId || previous.staffId
        : ""),
    confirmedServiceName:
      trustedServiceDtmfSelection ||
      currentService ||
      stablePreviousService ||
      knownService ||
      historicalRecoveredService,
    confirmedStaffName:
      (staffDtmfSelection && !staffDtmfSelection.invalid ? staffDtmfSelection.staffName : "") ||
      currentTurnStaffMention ||
      previous.confirmedStaffName,
    confirmedStaffId:
      (staffDtmfSelection && !staffDtmfSelection.invalid ? staffDtmfSelection.staffId : "") ||
      (!currentTurnStaffMention && cleanPreviousStaffPreference ? previous.confirmedStaffId : ""),
    initialBookingUtterance: initial,
    serviceAliasCorrectionRaw,
    timeRecognitionDiagnostics: timeGrounding.requiresConfirmation ? JSON.stringify(timeGrounding) : previous.timeRecognitionDiagnostics
  };

  const merged = {
    ...previous,
    ...Object.fromEntries(
      Object.entries(known).filter(([, value]) => value !== undefined && value !== "")
    )
  };
  const normalizedMergedDate = normalizeRequestedDateValue(merged.requestedDate, timeZone);
  if (normalizedMergedDate) {
    merged.requestedDate = normalizedMergedDate;
  } else {
    delete merged.requestedDate;
  }
  if (
    staffDtmfSelection &&
    !staffDtmfSelection.invalid &&
    normalizeForMatch(staffDtmfSelection.staffName) === "any staff"
  ) {
    delete merged.staffId;
    delete merged.selectedStaffId;
    delete merged.confirmedStaffId;
  }
  if (normalizeForMatch(merged.staffPreference || merged.confirmedStaffName) === "any staff") {
    merged.staffPreference = "Any staff";
    merged.confirmedStaffName = "Any staff";
    merged.staffResolutionStatus = "explicit_any";
    delete merged.staffId;
    delete merged.selectedStaffId;
    delete merged.confirmedStaffId;
    delete merged.staffRecognitionFailureCount;
    delete merged.invalidStaffPreferenceIgnored;
    delete merged.discardedStaleStaff;
  }
  if (isInvalidStaffPreferenceNoise(merged.staffPreference || merged.confirmedStaffName, merged)) {
    const unrecognizedStaffUtterance =
      merged.staffPreference || merged.confirmedStaffName || getCurrentTurnTranscript(event);
    delete merged.staffPreference;
    delete merged.confirmedStaffName;
    delete merged.staffId;
    delete merged.selectedStaffId;
    delete merged.confirmedStaffId;
    if (unrecognizedStaffUtterance) {
      merged.unrecognizedStaffUtterance = unrecognizedStaffUtterance;
    }
  }
  if (isClearlyInvalidServiceName(merged.serviceName || merged.confirmedServiceName)) {
    delete merged.serviceName;
    delete merged.confirmedServiceName;
  }
  if (timeGrounding.requiresConfirmation) {
    delete merged.requestedTime;
    merged.awaitingTimeConfirmation = "true";
    merged.proposedRequestedTime = timeGrounding.selectedCandidate?.text || "";
    merged.timeRecognitionFailureCount = String(parseAttemptCount(previous.timeRecognitionFailureCount) + 1);
  } else if (merged.awaitingTimeConfirmation === "true" && merged.requestedTime) {
    delete merged.awaitingTimeConfirmation;
    delete merged.proposedRequestedTime;
  }
  return removeIgnoredPollutedFields(merged);
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
  const currentTurnTranscript = getCurrentTurnTranscript(event);
  const activeSlot = getActiveVoiceSlot(sessionAttributes);
  if (
    activeSlot === "requestedTime" &&
    Boolean(String(currentTurnTranscript || "").trim()) &&
    !getSessionAttribute(sessionAttributes, slotNames.requestedTime) &&
    !hasCurrentTurnTimePhrase(currentTurnTranscript, sessionAttributes)
  ) {
    return "requestedTime";
  }
  const currentServiceSlot = getSlotValue(event.sessionState?.intent?.slots || {}, slotNames.serviceName, {
    preferOriginal: true
  });
  const unresolvedServiceAnswer =
    sessionAttributes.lastAskedSlot === "serviceName" &&
    sessionAttributes.activeDtmfMenu !== "staff" &&
    Boolean(String(currentTurnTranscript || "").trim()) &&
    !currentTurnRecognizedService(event) &&
    (hasUnsafeSunsetWithoutExplicitFullSetAlias(currentTurnTranscript) ||
      Boolean(currentServiceSlot));
  if (unresolvedServiceAnswer) {
    return "serviceName";
  }
  const customerName = getSessionAttribute(sessionAttributes, slotNames.customerName);
  const hasRecognizedCustomerName =
    Boolean(sessionAttributes.recognizedCustomerName) ||
    sessionAttributes.customerNameSource === "customer" ||
    sessionAttributes.customerNameSource === "phone_lookup";
  if (!customerName && !hasRecognizedCustomerName) {
    return "customerName";
  }

  const serviceName = getSessionAttribute(sessionAttributes, slotNames.serviceName);
  if (!serviceName) {
    return "serviceName";
  }
  if (
    normalizePedicureService(serviceName) !== "Pedicure" &&
    !isRecognizedService(serviceName, sessionAttributes)
  ) {
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
  const staffId = sessionAttributes.staffId || sessionAttributes.selectedStaffId;
  if (isInvalidStaffPreferenceNoise(staffPreference, sessionAttributes)) {
    return "staffPreference";
  }
  if (!staffPreference && !staffId && sessionAttributes.invalidStaffPreferenceIgnored === "true") {
    return "staffPreference";
  }
  if (!staffPreference && !staffId) {
    return "staffPreference";
  }

  if (!customerName) {
    return "customerName";
  }

  const customerPhone = getSessionAttribute(sessionAttributes, slotNames.customerPhone);
  if (!isValidCustomerPhone(customerPhone)) {
    return "customerPhone";
  }

  return "";
}

function buildElicitSlotResponse(event, slotName, extraAttributes = {}, messageOverride = "") {
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
  const confirmedServiceName = normalizeServiceName(
    sessionAttributes.confirmedServiceName || sessionAttributes.serviceName
  );
  if (slotName !== "serviceName" && confirmedServiceName) {
    delete sessionAttributes.serviceFallbackCount;
    delete sessionAttributes.invalidServiceCount;
    delete sessionAttributes.serviceClarificationAttempts;
    delete sessionAttributes.serviceFallbackOffered;
  }

  const responseSessionAttributes = applyActiveDtmfMenuAttributes(
    removeIgnoredPollutedFields({
      ...sessionAttributes,
      ...extraAttributes,
      lastAskedSlot: slotName,
      askedSlotsCount: String(attemptCount),
      fallbackCount: String(attemptCount),
      errorCount: String(attemptCount)
    }),
    slotName
  );

  let responseMessage =
    messageOverride ||
    getServiceAwareElicitPrompt(event, slotName, attemptCount, responseSessionAttributes);
  if (slotName === "serviceName") {
    const time = formatTimeForPrompt(responseSessionAttributes.requestedTime);
    const staff =
      responseSessionAttributes.staffPreference || responseSessionAttributes.confirmedStaffName;
    const date = formatDateForPrompt(
      responseSessionAttributes.requestedDate,
      getAttribute(event, attributeNames.timezone) || DEFAULT_SALON_TIMEZONE
    );
    if (!responseSessionAttributes.serviceName && !date && time && staff) {
      responseMessage = `I caught ${time} with ${staff}. What day and service would you like?`;
    }
  }
  const response = {
    sessionState: {
      sessionAttributes: responseSessionAttributes,
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
	        content: responseMessage
	      }
	    ]
	  };
	  return commitDialogState(response, {
	    slotToElicit: slotName,
	    trustedSlots: responseSessionAttributes,
	    responseMessage,
	    providerTurnId: getProviderTurnId(event),
	    humanTurnId: getHumanTurnId(event)
	  });
	}

function getNoInputPrompt(slotName, noInputCount, event) {
  if (slotName === "staffPreference") {
    const summary = buildKnownBookingPromptSummary(event, { forPhrase: false });
    const prefix = summary ? `I have ${summary}. ` : "";
    if (noInputCount <= 1) {
      return `I'm still here. ${prefix}Which staff would you like, or say first available?`;
    }
    return `${prefix}Which staff would you like, or say first available? You can press 0 for a person.`;
  }
  if (slotName === "customerName" && noInputCount >= 2) {
    return "Sorry, could you spell your first name, one letter at a time?";
  }
  if (slotName === "customerName") {
    return "Sorry, I didn't catch your name. Could you say your first name slowly?";
  }
  if (slotName === "serviceName" && noInputCount <= 1) {
    return SERVICE_KEYPAD_PROMPT;
  }
  if (noInputCount <= 1) {
    return getElicitPrompt(event, slotName, 1);
  }
  if (slotName === "serviceName") {
    return SERVICE_DTMF_SHORT_PROMPT;
  }
  return getElicitPrompt(event, slotName, 2);
}

function buildNoInputResponse(event, slotName) {
  const previous = event.sessionState?.sessionAttributes || {};
  const noInputCount = parseAttemptCount(previous.noInputCount) + 1;

  if (noInputCount >= 3) {
    return buildLexResponse(
      event,
      NO_INPUT_HUMAN_CONFIRM_PROMPT,
      "InProgress",
      {
        noInputCount: String(noInputCount),
        noInputPrompted: "true",
        awaitingNoInputHumanConfirmation: "true",
        forceHumanEscalation: "false",
        transferToQueue: "false"
      },
      {
        dialogAction: {
          type: "ElicitIntent"
        },
        messageContentType: "PlainText"
      }
    );
  }

  return buildElicitSlotResponse(
    event,
    slotName,
    {
      noInputCount: String(noInputCount),
      noInputPrompted: "true",
      awaitingNoInputHumanConfirmation: "false"
    },
    getNoInputPrompt(slotName, noInputCount, event)
  );
}

function getTemporaryCustomerName(event) {
  const phone =
    getKnownField(event, "customerPhone") ||
    getAttribute(event, attributeNames.customerNumber);
  const lastFour = String(phone || "").replace(/\D/g, "").slice(-4);
  return lastFour ? `Guest ${lastFour}` : "Guest";
}

function hasTrustedCustomerName(event) {
  const known = buildKnownBookingSessionAttributes(event);
  return Boolean(
    known.recognizedCustomerName ||
      known.customerNameSource === "phone_lookup" ||
      known.customerNameSource === "customer" ||
      (known.customerName && isAcceptableCustomerName(known.customerName))
  );
}

async function continueWithTemporaryCustomerName(event, intentName, analysis = {}) {
  const temporaryName = getTemporaryCustomerName(event);
  const slots = mergeKnownSlots(event);
  const slotNameToSet =
    slotNames.customerName.find((name) => Object.prototype.hasOwnProperty.call(slots, name)) ||
    slotNames.customerName[0];
  slots[slotNameToSet] = buildLexSlot(temporaryName);
  const sessionAttributes = applyActiveDtmfMenuAttributes(
    {
      ...buildKnownBookingSessionAttributes(event),
      customerName: temporaryName,
      customerNameSource: "phone_fallback",
      customerNameNeedsReview: "true",
      lastAskedSlot: "customerName",
      slotToElicit: "customerName",
      fallbackCount: "2",
      askedSlotsCount: "2",
      errorCount: "2"
    },
    ""
  );
  const eventWithFallbackName = {
    ...event,
    sessionState: {
      ...(event.sessionState || {}),
      sessionAttributes,
      intent: {
        ...(event.sessionState?.intent || {}),
        slots
      }
    },
    lexTurnDebug: {
      ...(event.lexTurnDebug || {}),
      sanitization: {
        ...((event.lexTurnDebug || {}).sanitization || {}),
        ignoredNoiseFields: analysis.ignoredNoiseFields || ["customerName"]
      }
    }
  };
  const result = await postInternalAppointment(
    buildInternalPayload(eventWithFallbackName, intentName, {
      customerNameSource: "phone_fallback",
      customerNameNeedsReview: "true",
      ignoredNoiseFields: JSON.stringify(analysis.ignoredNoiseFields || ["customerName"])
    }),
    {
      operationName: "booking_customer_name_fallback",
      waitPrompt: WAIT_PROMPTS.customer_lookup,
      mechanism: "Lambda temporary customer name fallback"
    }
  );
  if (!result.ok) {
    console.error("Appointment API rejected temporary customer name fallback", result.code);
    return buildBackendFailureElicitResponse(eventWithFallbackName, result);
  }
  const data = extractResultPayload(result);
  return buildLexResponse(
    eventWithFallbackName,
    data.lexResponse?.message ||
      `I couldn't clearly hear the name, so I'll use ${temporaryName} for now.`,
    data.lexResponse?.fulfillmentState || "InProgress",
    buildSessionAttributesFromResult(data),
    data.lexResponse
  );
}

function buildBookServiceElicitResponse(event) {
  return buildElicitSlotResponse(
    event,
    "serviceName",
    {
      serviceFallbackOffered: "true"
    },
    SERVICE_KEYPAD_PROMPT
  );
}

function shouldRequestDynamicServiceMenu(event) {
  const previous = event.sessionState?.sessionAttributes || {};
  const serviceSlot = getKnownField(event, "serviceName", { preferOriginal: true });
  const text = [
    event.inputTranscript,
    getAttribute(event, attributeNames.transcript),
    serviceSlot
  ]
    .filter(Boolean)
    .join(" ");
  return (
    isUnsupportedServiceRequestPhrase(text) ||
    isServiceMenuRequestPhrase(text) ||
    previous.lastAskedSlot === "serviceName" ||
    previous.activeDtmfMenu === "service" ||
    (Boolean(String(text || "").trim()) &&
      !currentTurnRecognizedService(event) &&
      isBookingLikeUtterance(text))
  );
}

async function buildDynamicServiceElicitResponse(event, intentName) {
  const result = await postInternalAppointment(
    buildInternalPayload(event, intentName, {
      currentTurnSemanticType: "SERVICE_REQUEST"
    }),
    {
      operationName: "service_dtmf_options_generation",
      waitPrompt: WAIT_PROMPTS.availability_lookup,
      mechanism: "Lambda unsupported service menu handoff"
    }
  );
  if (!result.ok) {
    console.error("Appointment API rejected dynamic service prompt request", result.code);
    return buildBookServiceElicitResponse(event);
  }

  const data = extractResultPayload(result);
  return buildLexResponse(
    event,
    data.lexResponse?.message || SERVICE_DTMF_SHORT_PROMPT,
    data.lexResponse?.fulfillmentState || "InProgress",
    buildSessionAttributesFromResult(data),
    data.lexResponse
  );
}

async function buildDynamicStaffElicitResponse(event, intentName) {
  const result = await postInternalAppointment(buildInternalPayload(event, intentName), {
    operationName: "staff_dtmf_options_generation",
    waitPrompt: WAIT_PROMPTS.staff_dtmf_options,
    mechanism: "Lambda response / timeout guard"
  });
  if (!result.ok) {
    console.error("Appointment API rejected dynamic staff prompt request", result.code);
    return buildElicitSlotResponse(event, "staffPreference");
  }

  const data = extractResultPayload(result);
  if (data.outcome === "HUMAN_ESCALATION") {
    return buildElicitSlotResponse(event, "staffPreference", {
      forceHumanEscalation: "false",
      transferToQueue: "false",
      backendEscalationSuppressed: "true"
    });
  }

  const lexResponse = data.lexResponse || {};
  if (lexResponse.dialogAction?.type) {
    return buildLexResponse(
      event,
      lexResponse.message || data.message || STAFF_DTMF_PROMPT,
      lexResponse.fulfillmentState || "InProgress",
      buildSessionAttributesFromResult(data),
      lexResponse
    );
  }

  return buildElicitSlotResponse(
    event,
    "staffPreference",
    buildSessionAttributesFromResult(data),
    data.message || lexResponse.message || STAFF_DTMF_PROMPT
  );
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
  if (code === "STAFF_NOT_MAPPED") {
    return "STAFF_NOT_MAPPED";
  }
  if (
    code === "backend_timeout" ||
    code === "backend_unreachable" ||
    code === "backend_not_configured"
  ) {
    return code;
  }
  return "backend_error";
}

function buildBackendFailureEscalationResponse(event, result) {
  const reason = normalizeBackendFailureReason(result?.code);
  return buildLexResponse(
    event,
    OPERATOR_TRANSFER_PROMPT,
    "Fulfilled",
    buildForceHumanEscalationAttributes(reason),
    {
      messageContentType: "PlainText"
    }
  );
}

function buildBackendFailureElicitResponse(event, result) {
  if (result?.code === "STAFF_NOT_MAPPED") {
    const knownAttributes = buildKnownBookingSessionAttributes(event);
    const serviceName =
      getSessionAttribute(knownAttributes, slotNames.serviceName) ||
      knownAttributes.confirmedServiceName ||
      "that service";
    const staffName =
      getSessionAttribute(knownAttributes, slotNames.staffPreference) ||
      knownAttributes.confirmedStaffName ||
      "That technician";
    const message =
      result?.message ||
      `${staffName} doesn't provide ${serviceName}. Please choose another technician, or say first available. Press 0 for a person.`;
    return buildElicitSlotResponse(
      event,
      "staffPreference",
      {
        ignoredPollutedSlotFields: JSON.stringify(["staffPreference"]),
        staffMappingFailure: "true",
        forceHumanEscalation: "false",
        transferToQueue: "false"
      },
      message
    );
  }
  const knownAttributes = buildKnownBookingSessionAttributes(event);
  const confirmedService = getConfirmedRecognizedService(knownAttributes);
  let slotToElicit = getBookingSlotToElicit(event) || "serviceName";
  if (slotToElicit === "serviceName" && confirmedService) {
    slotToElicit = "requestedDate";
  } else if (!slotToElicit && confirmedService) {
    slotToElicit = ["requestedDate", "requestedTime"].includes(knownAttributes.lastAskedSlot)
      ? knownAttributes.lastAskedSlot
      : "requestedTime";
  }
  const waitPrompt =
    slotToElicit === "staffPreference"
      ? WAIT_PROMPTS.staff_lookup
      : slotToElicit === "customerName" || slotToElicit === "customerPhone"
        ? WAIT_PROMPTS.customer_lookup
        : slotToElicit === "serviceName"
          ? WAIT_PROMPTS.service_lookup
          : WAIT_PROMPTS.availability_lookup;
  const servicePrefix = confirmedService && slotToElicit !== "serviceName"
    ? `I still have ${confirmedService}. `
    : "";
  const recoveryPrompt =
    slotToElicit === "requestedTime"
      ? "I had trouble checking the schedule. What time would you like?"
      : slotToElicit === "staffPreference"
        ? "I had trouble checking the schedule. Which staff would you like, Trang, Amy, Kelly, or first available?"
        : slotToElicit === "customerName"
          ? "I had trouble checking the schedule. What name should I put on the appointment?"
          : slotToElicit === "requestedDate"
            ? "I had trouble checking the schedule. What day would you like?"
            : `${waitPrompt} I had trouble checking that right now.`;
  return buildElicitSlotResponse(
    event,
    slotToElicit,
    {
      backendFailureReason: normalizeBackendFailureReason(result?.code),
      forceHumanEscalation: "false",
      transferToQueue: "false"
    },
    `${servicePrefix}${recoveryPrompt}`
  );
}

function buildNoAgentsAvailableResponse(event) {
  return buildLexResponse(
    event,
    OPERATOR_BUSY_PROMPT,
    "Fulfilled",
    {
      forceHumanEscalation: "false",
      transferToQueue: "false",
      escalationReason: "agents_unavailable",
      noAgentsAvailable: "true",
      conversationState: "COMPLETE",
      conversationOutcome: "CALL_CENTER_ESCALATION",
      conversationComplete: "true"
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

function intentSupportsLexSlotElicitation(intentName) {
  return intentName === "BookAppointmentIntent";
}

function inferIntentNameForSlot(slotToElicit) {
  return slotToElicit && Object.prototype.hasOwnProperty.call(slotNames, slotToElicit)
    ? "BookAppointmentIntent"
    : "";
}

function responseStillNeedsCallerInput(message, dialogAction, sessionAttributes = {}) {
  if (dialogAction?.type && dialogAction.type !== "Close") {
    return true;
  }
  const outcome = normalizeForMatch(
    sessionAttributes.conversationOutcome || sessionAttributes.bookingOutcome || ""
  );
  if (["missing info", "needs input", "no availability"].includes(outcome)) {
    return true;
  }
  const text = normalizeForMatch(message);
  if (!text) {
    return false;
  }
  return (
    String(message || "").includes("?") ||
    /\b(?:i can help|what would you like|which time|what time|which staff|what day|would you like|please say yes|tell me what you would like|what other time|which appointment)\b/.test(text)
  );
}

function isTerminalConversationOutcome(sessionAttributes = {}) {
  const bookingOutcome = normalizeForMatch(sessionAttributes.bookingOutcome || "");
  const conversationOutcome = normalizeForMatch(sessionAttributes.conversationOutcome || "");
  return (
    ["booked", "rescheduled", "canceled"].includes(bookingOutcome) ||
    ["booked", "rescheduled", "canceled", "caller goodbye"].includes(conversationOutcome)
  );
}

function buildLexResponse(event, message, state = "Fulfilled", sessionAttributes = {}, lexResponse = {}) {
  const intent = event.sessionState?.intent || {};
  let dialogAction = normalizeDialogAction(lexResponse);
  let requestedSlotToElicit = dialogAction.type === "ElicitSlot" ? dialogAction.slotToElicit || "" : "";
  const knownAttributes = buildKnownBookingSessionAttributes(event);
  let responseMessage = message;
  if (
    dialogAction.type === "ElicitSlot" &&
    dialogAction.slotToElicit === "serviceName" &&
    getConfirmedRecognizedService(knownAttributes)
  ) {
    const nextSlot = getBookingSlotToElicit(event);
    const promptEvent = withSessionAttributes(event, {
      ...knownAttributes,
      ...sessionAttributes,
      ...(lexResponse.sessionAttributes || {})
    });
    responseMessage = nextSlot
      ? getServiceAwareElicitPrompt(promptEvent, nextSlot, 1)
      : "Please give me a moment while I finish your appointment.";
    dialogAction = nextSlot
      ? {
          type: "ElicitSlot",
          slotToElicit: nextSlot
        }
      : {
          type: "Delegate"
        };
    requestedSlotToElicit = dialogAction.type === "ElicitSlot" ? dialogAction.slotToElicit || "" : "";
  }
  let nextState = dialogAction.type === "Close" ? state : "InProgress";
  const contentType =
    lexResponse.messageContentType || (String(responseMessage || "").trim().startsWith("<speak>") ? "SSML" : "PlainText");
  const mergedSessionAttributes = clearExcludedStaffSelection(removeIgnoredPollutedFields({
    ...knownAttributes,
    ...sessionAttributes,
    ...(lexResponse.sessionAttributes || {})
  }));
  if (dialogAction.type === "ElicitSlot" && dialogAction.slotToElicit) {
    mergedSessionAttributes.lastAskedSlot = dialogAction.slotToElicit;
    mergedSessionAttributes.slotToElicit = dialogAction.slotToElicit;
    if (dialogAction.slotToElicit !== "serviceName") {
      const previous = event.sessionState?.sessionAttributes || {};
      const previousCount = parseAttemptCount(previous.askedSlotsCount || previous.fallbackCount);
      const attemptCount = previous.lastAskedSlot === dialogAction.slotToElicit ? previousCount + 1 : 1;
      mergedSessionAttributes.askedSlotsCount = String(attemptCount);
      mergedSessionAttributes.fallbackCount = String(attemptCount);
      mergedSessionAttributes.errorCount = String(attemptCount);
      delete mergedSessionAttributes.serviceFallbackCount;
      delete mergedSessionAttributes.invalidServiceCount;
      delete mergedSessionAttributes.serviceClarificationAttempts;
      delete mergedSessionAttributes.serviceFallbackOffered;
    }
  }
  const inferredIntentName = intent.name || inferIntentNameForSlot(dialogAction.slotToElicit);
  const canElicitSlotInCurrentIntent = intentSupportsLexSlotElicitation(inferredIntentName);
  if (dialogAction.type === "ElicitSlot" && !canElicitSlotInCurrentIntent) {
    dialogAction = {
      type: "ElicitIntent"
    };
    nextState = "InProgress";
  }
  const responseSessionAttributes = clearExcludedStaffSelection(applyActiveDtmfMenuAttributes(
    mergedSessionAttributes,
    dialogAction.type === "ElicitSlot" && canElicitSlotInCurrentIntent ? dialogAction.slotToElicit : ""
  ));
  const needsCallerInput = responseStillNeedsCallerInput(responseMessage, dialogAction, responseSessionAttributes);
  if (needsCallerInput && dialogAction.type === "Close") {
    dialogAction = {
      type: "ElicitIntent"
    };
    nextState = "InProgress";
  }
  if (needsCallerInput && responseSessionAttributes.transferToQueue !== "true") {
    responseSessionAttributes.conversationState = "CONTINUE";
    responseSessionAttributes.conversationOutcome = responseSessionAttributes.conversationOutcome || "NEEDS_INPUT";
    responseSessionAttributes.conversationComplete = "false";
  } else if (!responseSessionAttributes.conversationComplete) {
    if (responseSessionAttributes.transferToQueue === "true") {
      responseSessionAttributes.conversationState = responseSessionAttributes.conversationState || "TRANSFER";
      responseSessionAttributes.conversationOutcome = responseSessionAttributes.conversationOutcome || "NEEDS_INPUT";
      responseSessionAttributes.conversationComplete = "false";
    } else if (
      !needsCallerInput &&
      isTerminalConversationOutcome(responseSessionAttributes) &&
      dialogAction.type === "Close" &&
      nextState === "Fulfilled"
    ) {
      responseSessionAttributes.conversationState = responseSessionAttributes.conversationState || "COMPLETE";
      responseSessionAttributes.conversationOutcome =
        responseSessionAttributes.conversationOutcome ||
        responseSessionAttributes.bookingOutcome ||
        "CALLER_GOODBYE";
      responseSessionAttributes.conversationComplete = "true";
    } else {
      responseSessionAttributes.conversationState = responseSessionAttributes.conversationState || "CONTINUE";
      responseSessionAttributes.conversationOutcome = responseSessionAttributes.conversationOutcome || "NEEDS_INPUT";
      responseSessionAttributes.conversationComplete = "false";
    }
  }
  const response = {
    sessionState: {
      sessionAttributes: responseSessionAttributes,
      dialogAction,
      intent: {
        ...intent,
        ...(inferredIntentName ? { name: inferredIntentName } : {}),
        slots: intent.slots || mergeKnownSlots(event),
        state: nextState
      }
    },
	    messages: [
	      {
	        contentType,
	        content: responseMessage
	      }
	    ]
  };
	  return commitDialogState(response, {
	    slotToElicit: dialogAction.type === "ElicitSlot" ? dialogAction.slotToElicit : requestedSlotToElicit,
	    trustedSlots: responseSessionAttributes,
	    responseMessage,
	    providerTurnId: getProviderTurnId(event),
	    humanTurnId: getHumanTurnId(event),
	    ...(dialogAction.type !== "ElicitSlot" && requestedSlotToElicit ? { activeDtmfMenu: "" } : {})
	  });
	}

function buildDelegateResponse(event) {
  const intent = event.sessionState?.intent || {};
  return {
    sessionState: {
      sessionAttributes: applyActiveDtmfMenuAttributes(
        removeIgnoredPollutedFields(buildKnownBookingSessionAttributes(event)),
        ""
      ),
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

function withSessionAttributes(event, sessionAttributes = {}) {
  return {
    ...event,
    sessionState: {
      ...(event.sessionState || {}),
      sessionAttributes: {
        ...(event.sessionState?.sessionAttributes || {}),
        ...sessionAttributes
      }
    }
  };
}

async function buildKnownCallerLookupResponse(event, intentName) {
  const known = buildKnownBookingSessionAttributes(event);
  if (!known.customerPhone || known.customerName) {
    return null;
  }

  const result = await postInternalAppointment(buildInternalPayload(event, intentName), {
    operationName: "customer_lookup",
    waitPrompt: WAIT_PROMPTS.customer_lookup,
    mechanism: "Lambda customer lookup before local name prompt"
  });
  if (!result.ok) {
    return null;
  }

  const data = extractResultPayload(result);
  const resultAttributes = buildSessionAttributesFromResult(data);
  const isServiceDtmfSelection = Boolean(
    readScopedDtmfSelection(
      event,
      "serviceName",
      getActiveDtmfOptions(event.sessionState?.sessionAttributes || {}, "service")
    )
  );
  const safeResultAttributes = { ...resultAttributes };
  if (isServiceDtmfSelection) {
    delete safeResultAttributes.requestedDate;
    delete safeResultAttributes.requestedTime;
    delete safeResultAttributes.staffPreference;
    delete safeResultAttributes.staffId;
    delete safeResultAttributes.selectedStaffId;
    delete safeResultAttributes.confirmedStaffId;
    delete safeResultAttributes.confirmedStaffName;
  }
  const customerName = safeResultAttributes.customerName || safeResultAttributes.recognizedCustomerName;
  if (!customerName) {
    return null;
  }
  const safeLexResponse = {
    ...(data.lexResponse || {}),
    sessionAttributes: {
      ...((data.lexResponse || {}).sessionAttributes || {}),
      ...safeResultAttributes
    }
  };
  if (isServiceDtmfSelection) {
    delete safeLexResponse.sessionAttributes.requestedDate;
    delete safeLexResponse.sessionAttributes.requestedTime;
    delete safeLexResponse.sessionAttributes.staffPreference;
    delete safeLexResponse.sessionAttributes.staffId;
    delete safeLexResponse.sessionAttributes.selectedStaffId;
    delete safeLexResponse.sessionAttributes.confirmedStaffId;
    delete safeLexResponse.sessionAttributes.confirmedStaffName;
  }

  const enrichedEvent = withSessionAttributes(event, {
    ...safeResultAttributes,
    customerName,
    recognizedCustomerName: safeResultAttributes.recognizedCustomerName || customerName,
    customerNameSource: safeResultAttributes.customerNameSource || "phone_lookup"
  });
  const nextSlot = getBookingSlotToElicit(enrichedEvent);
  if (nextSlot) {
    return buildLexResponse(
      enrichedEvent,
      safeLexResponse.message || getServiceAwareElicitPrompt(enrichedEvent, nextSlot, 1),
      safeLexResponse.fulfillmentState || "InProgress",
      safeResultAttributes,
      {
        ...safeLexResponse,
        dialogAction: safeLexResponse.dialogAction || {
          type: "ElicitSlot",
          slotToElicit: nextSlot
        }
      }
    );
  }
  return buildDelegateResponse(enrichedEvent);
}

async function applyKnownCallerLookupBeforePrompt(event, intentName) {
  const previous = event.sessionState?.sessionAttributes || {};
  const known = buildKnownBookingSessionAttributes(event);
  const hasKnownName = Boolean(
    known.customerName ||
      known.recognizedCustomerName ||
      known.customerNameSource === "phone_lookup" ||
      known.customerNameSource === "active_customer"
  );
  if (
    intentName !== "BookAppointmentIntent" ||
    getInputMode(event) === "DTMF" ||
    Boolean(readCurrentTurnDigit(event)) ||
    previous.knownCallerLookupAttempted === "true" ||
    !known.customerPhone ||
    hasKnownName
  ) {
    return event;
  }

  const markerAttributes = {
    knownCallerLookupAttempted: "true"
  };
  const result = await postInternalAppointment(
    buildInternalPayload(event, intentName, markerAttributes),
    {
      operationName: "customer_lookup",
      waitPrompt: WAIT_PROMPTS.customer_lookup,
      mechanism: "Lambda customer lookup before missing-slot decision"
    }
  );
  if (!result.ok) {
    return withSessionAttributes(event, {
      ...markerAttributes,
      knownCallerLookupStatus: "ERROR"
    });
  }

  const data = extractResultPayload(result);
  const resultAttributes = buildSessionAttributesFromResult(data);
  const customerName = resultAttributes.customerName || resultAttributes.recognizedCustomerName;
  if (!customerName) {
    return withSessionAttributes(event, {
      ...markerAttributes,
      knownCallerLookupStatus: "NOT_FOUND"
    });
  }

  return withSessionAttributes(event, {
    ...markerAttributes,
    knownCallerLookupStatus: "FOUND",
    customerId: resultAttributes.customerId || resultAttributes.recognizedCustomerId,
    recognizedCustomerId: resultAttributes.recognizedCustomerId || resultAttributes.customerId,
    customerName,
    recognizedCustomerName: resultAttributes.recognizedCustomerName || customerName,
    persistedCustomerFirstName: resultAttributes.persistedCustomerFirstName,
    persistedCustomerLastName: resultAttributes.persistedCustomerLastName,
    customerNameSource: "phone_lookup",
    customerProfileSource: "active_customer",
    customerPhone: resultAttributes.customerPhone || known.customerPhone
  });
}

function getCallOrSessionIdFromPayload(payload = {}) {
  return (
    payload.amazonConnectContactId ||
    payload.callSessionId ||
    payload.attributes?.AmazonConnectContactId ||
    payload.attributes?.ContactId ||
    "unknown"
  );
}

function logApiWaitCoverage(payload, coverage, startedAt, result) {
  const durationMs = Date.now() - startedAt;
  const success = Boolean(result?.ok);
  const resultPayload = extractResultPayload(result);
  const logPayload = {
    operationName: coverage.operationName,
    waitPrompt: coverage.waitPrompt,
    mechanism: coverage.mechanism || "Lex fulfillment update / Lambda timeout guard",
    durationMs,
    apiDurationMs: durationMs,
    contactId: payload.amazonConnectContactId || payload.attributes?.AmazonConnectContactId,
    sessionId: payload.callSessionId,
    salonId: payload.salonId,
    serviceName: payload.serviceName || payload.attributes?.serviceName,
    lastAskedSlot: payload.attributes?.lastAskedSlot,
    outcome: resultPayload.outcome,
    success,
    failureCode: success ? undefined : result?.code,
    callOrSessionId: getCallOrSessionIdFromPayload(payload)
  };
  const message = "API wait prompt coverage";
  if (success) {
    console.info(message, logPayload);
  } else {
    console.warn(message, logPayload);
  }
}

async function postInternalAppointment(payload, coverage = {}) {
  const waitCoverage = {
    operationName: coverage.operationName || "backend_api_call",
    waitPrompt: coverage.waitPrompt || WAIT_PROMPTS.availability_lookup,
    mechanism: coverage.mechanism || "Lex fulfillment update / Lambda timeout guard"
  };
  const startedAt = Date.now();
  if (!API_BASE_URL || !INTERNAL_TOKEN) {
    const result = {
      ok: false,
      message: "The booking system is not fully configured yet.",
      code: "backend_not_configured"
    };
    logApiWaitCoverage(payload, waitCoverage, startedAt, result);
    return result;
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
        "X-FastAIBooking-Wait-Operation": waitCoverage.operationName,
        "X-FastAIBooking-Wait-Prompt": waitCoverage.waitPrompt,
        Connection: "keep-alive"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
  } catch (error) {
    const result = {
      ok: false,
      message:
        error?.name === "AbortError"
          ? "The booking system timed out."
          : "The booking system could not be reached.",
      code: error?.name === "AbortError" ? "backend_timeout" : "backend_unreachable"
    };
    logApiWaitCoverage(payload, waitCoverage, startedAt, result);
    return result;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const text = await response.text();
    const result = {
      ok: false,
      message: text || "I could not create the appointment right now.",
      code: "backend_error"
    };
    logApiWaitCoverage(payload, waitCoverage, startedAt, result);
    return result;
  }

  const result = {
    ok: true,
    data: await response.json()
  };
  logApiWaitCoverage(payload, waitCoverage, startedAt, result);
  return result;
}

async function postInternalOperatorQueueOutcome(payload) {
  if (!API_BASE_URL || !INTERNAL_TOKEN) {
    return {
      ok: false,
      code: "backend_not_configured"
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/internal/ai/operator-queue-outcome`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${INTERNAL_TOKEN}`,
        "X-FastAIBooking-Wait-Operation": "operator_queue_outcome",
        "X-FastAIBooking-Wait-Prompt": OPERATOR_BUSY_PROMPT,
        Connection: "keep-alive"
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!response.ok) {
      return {
        ok: false,
        code: "backend_error",
        message: await response.text()
      };
    }
    return {
      ok: true,
      data: await response.json()
    };
  } catch (error) {
    return {
      ok: false,
      code: error?.name === "AbortError" ? "backend_timeout" : "backend_unreachable",
      message: error?.message
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

function isOperatorQueueOutcomeEvent(event) {
  return Boolean(
    event?.Details?.Name === "ContactFlowEvent" &&
      event.Details.Parameters?.fastAiOperatorQueueOutcome
  );
}

async function handleOperatorQueueOutcomeEvent(event) {
  const contactData = event.Details?.ContactData || {};
  const parameters = event.Details?.Parameters || {};
  const attributes = contactData.Attributes || {};
  const outcome = String(parameters.fastAiOperatorQueueOutcome || "CONNECT_FLOW_ERROR");
  const payload = {
    salonId: parameters.salonId || attributes.salonId || DEFAULT_SALON_ID,
    callSessionId: parameters.callSessionId || attributes.callSessionId,
    amazonConnectContactId:
      parameters.amazonConnectContactId ||
      parameters.contactId ||
      attributes.AmazonConnectContactId ||
      attributes.contactId ||
      contactData.ContactId,
    callerPhone:
      parameters.callerPhone ||
      attributes.callerPhone ||
      contactData.CustomerEndpoint?.Address,
    outcome
  };
  const result = await postInternalOperatorQueueOutcome(payload);
  if (!result.ok) {
    console.error("Operator queue outcome callback failed", {
      code: result.code,
      contactId: payload.amazonConnectContactId
    });
  }
  return {
    operatorQueueOutcomeRecorded: result.ok ? "true" : "false",
    operatorQueueOutcome: outcome,
    messageToCaller: OPERATOR_BUSY_PROMPT
  };
}

function buildInternalPayload(event, intentName, extraAttributes = {}) {
  const slots = event.sessionState?.intent?.slots || {};
  const sessionAttributes = buildKnownBookingSessionAttributes(event);
  const knownField = (fieldName, options = {}) =>
    getSessionAttribute(sessionAttributes, slotNames[fieldName] || [fieldName]) ||
    getKnownField(event, fieldName, options);
  const backendIntentName = shouldTransferToHuman(event, intentName).transfer
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
  const currentTurnTranscript = getCurrentTurnTranscript(event);
  const bookingConfirmation =
    getSlotValue(slots, slotNames.bookingConfirmation, { preferOriginal: true }) ||
    getSessionAttribute(sessionAttributes, slotNames.bookingConfirmation);
  const providerTranscriptTimestamp =
    getOptionalAttribute(event, [
      "providerTranscriptTimestamp",
      "ProviderTranscriptTimestamp",
      "transcriptTimestamp",
      "TranscriptTimestamp",
      "providerInputEndedAt",
      "ProviderInputEndedAt"
    ]) || "";
  const connectBranch =
    sessionAttributes.connectRecoveryStage ||
    sessionAttributes.connectLastErrorBranch ||
    sessionAttributes.conversationState ||
    "";

  const payload = {
    intentName: backendIntentName,
    provider: "AMAZON_CONNECT",
    customerName: knownField("customerName"),
    customerPhone,
    serviceName: knownField("serviceName"),
    requestedDate: knownField("requestedDate"),
    requestedTime: knownField("requestedTime", { preferOriginal: true }),
    staffPreference: knownField("staffPreference"),
    staffId: sessionAttributes.staffId || sessionAttributes.selectedStaffId,
    bookingConfirmation,
    confirmationState: event.sessionState?.intent?.confirmationState,
    transcript,
    currentTurnTranscript,
    aggregatedBookingTranscript: transcript,
    source: "amazon_connect_ai",
    amazonConnectContactId,
    callSessionId: sessionAttributes.callSessionId,
    amazonConnectPhoneNumber,
    calledNumber: calledNumber || undefined,
    slots,
    attributes: {
      ...sessionAttributes,
	      ...extraAttributes,
	      currentTurnTranscript,
	      aggregatedBookingTranscript: transcript,
	      providerTurnId: getProviderTurnId(event),
	      humanTurnId: getHumanTurnId(event),
	      providerRequestId: getProviderRequestId(event),
	      lexRequestId: event.requestId || event.invocationId || getProviderRequestId(event) || "",
	      lexPhase: event.invocationSource || "",
	      providerTranscriptTimestamp,
	      lambdaReceivedAt: event.lambdaReceivedAt || "",
	      connectBranch,
	      stateVersionBefore: sessionAttributes.stateVersion || sessionAttributes.turnSequence || "0",
	      turnSequence: sessionAttributes.turnSequence || "0",
	      asrDiagnostics: JSON.stringify(getAsrDiagnostics(event)),
      asrNBestAlternatives: JSON.stringify(getAsrDiagnostics(event).nBestAlternatives),
      ...(event.lexTurnDebug ? { lexTurnDebug: event.lexTurnDebug } : {})
    }
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

function getIgnoredPollutedFieldNames(sessionAttributes = {}) {
  try {
    const parsed = JSON.parse(sessionAttributes.ignoredPollutedSlotFields || "[]");
    return Array.isArray(parsed) ? parsed.filter((fieldName) => slotNames[fieldName]) : [];
  } catch {
    return [];
  }
}

function removeIgnoredPollutedFields(sessionAttributes = {}) {
  const cleaned = { ...sessionAttributes };
  for (const fieldName of getIgnoredPollutedFieldNames(sessionAttributes)) {
    for (const name of slotNames[fieldName] || [fieldName]) {
      delete cleaned[name];
    }
    if (fieldName === "serviceName") {
      delete cleaned.confirmedServiceName;
    }
    if (fieldName === "staffPreference") {
      delete cleaned.confirmedStaffName;
      delete cleaned.staffId;
      delete cleaned.selectedStaffId;
      delete cleaned.confirmedStaffId;
    }
  }
  delete cleaned.ignoredPollutedSlotFields;
  delete cleaned.scopedServiceDtmfInput;
  return cleaned;
}

function parseStringListAttribute(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    // Fall back to comma-separated attributes.
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function clearExcludedStaffSelection(sessionAttributes = {}) {
  const next = { ...sessionAttributes };
  const excludedIds = new Set(parseStringListAttribute(next.excludedStaffIds));
  const excludedNames = new Set(parseStringListAttribute(next.excludedStaffNames).map((name) => normalizeForMatch(name)));
  const selectedIds = [next.staffId, next.selectedStaffId, next.confirmedStaffId]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const selectedNames = [next.staffPreference, next.confirmedStaffName]
    .map((value) => normalizeForMatch(value))
    .filter(Boolean);
  const selectedStaffIsExcluded =
    selectedIds.some((id) => excludedIds.has(id)) ||
    selectedNames.some((name) => excludedNames.has(name));
  if (selectedStaffIsExcluded) {
    delete next.staffPreference;
    delete next.confirmedStaffName;
    delete next.staffId;
    delete next.selectedStaffId;
    delete next.confirmedStaffId;
  }
  return next;
}

function applyActiveDtmfMenuAttributes(sessionAttributes = {}, slotName = "") {
  const next = { ...sessionAttributes };
  if (slotName === "serviceName") {
    next.activeDtmfMenu = "service";
    next.activeDtmfOptionsJson = JSON.stringify(getServiceDtmfOptions(next));
  } else if (slotName === "staffPreference") {
    next.activeDtmfMenu = "staff";
    next.activeDtmfOptionsJson = JSON.stringify({
      ...parseDtmfRecord(next.staffDtmfOptions),
      ...(Object.keys(parseDtmfRecord(next.staffDtmfOptions)).length ? {} : STAFF_DTMF_OPTIONS),
      "0": "__operator__"
    });
  } else {
    delete next.activeDtmfMenu;
    delete next.activeDtmfOptionsJson;
  }
  return next;
}

function commitDialogState(response, options = {}) {
  const slotToElicit =
    options.slotToElicit || response?.sessionState?.dialogAction?.slotToElicit || "";
  const responseMessage =
    options.responseMessage || response?.messages?.[0]?.content || "";
  const sessionAttributes = {
    ...(response?.sessionState?.sessionAttributes || {})
  };
  const trustedSlots = options.trustedSlots || {};

  if (slotToElicit) {
    sessionAttributes.lastAskedSlot = slotToElicit;
    sessionAttributes.slotToElicit = slotToElicit;
  }
  for (const field of [
    "serviceName",
    "confirmedServiceName",
    "requestedDate",
    "requestedTime",
    "staffPreference",
    "customerName",
    "customerPhone"
  ]) {
    const value = trustedSlots[field] ?? sessionAttributes[field];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      sessionAttributes[field] = String(value);
    }
  }

  if (options.activeDtmfMenu !== undefined) {
    if (options.activeDtmfMenu) {
      sessionAttributes.activeDtmfMenu = options.activeDtmfMenu;
      sessionAttributes.activeDtmfOptionsJson = JSON.stringify(options.activeDtmfOptions || {});
    } else {
      delete sessionAttributes.activeDtmfMenu;
      delete sessionAttributes.activeDtmfOptionsJson;
    }
  } else if (slotToElicit === "serviceName") {
    sessionAttributes.activeDtmfMenu = "service";
    sessionAttributes.activeDtmfOptionsJson = JSON.stringify(getServiceDtmfOptions(sessionAttributes));
  } else if (slotToElicit === "staffPreference") {
    sessionAttributes.activeDtmfMenu = "staff";
    sessionAttributes.activeDtmfOptionsJson = JSON.stringify({
      ...getStaffDtmfOptions(sessionAttributes),
      "0": "__operator__"
    });
  } else if (slotToElicit) {
    delete sessionAttributes.activeDtmfMenu;
    delete sessionAttributes.activeDtmfOptionsJson;
  }

  if (
    options.operatorHelpMentioned ||
    sessionAttributes.operatorHelpMentioned === "true" ||
    /\bpress\s+0\b/i.test(responseMessage)
  ) {
    sessionAttributes.operatorHelpMentioned = "true";
  }
  if (responseMessage) {
    sessionAttributes.connectContinuationPrompt = responseMessage;
    sessionAttributes.connectContinuationPromptAvailable = "true";
  } else {
    delete sessionAttributes.connectContinuationPromptAvailable;
  }
  if (response?.sessionState?.dialogAction?.type !== "Close") {
    sessionAttributes.conversationState = "CONTINUE";
    sessionAttributes.conversationOutcome = sessionAttributes.conversationOutcome || "NEEDS_INPUT";
    sessionAttributes.conversationComplete = "false";
  }
  const previousTurnSequence = parseAttemptCount(sessionAttributes.turnSequence);
  sessionAttributes.turnSequence = String(previousTurnSequence + 1);
  if (options.providerTurnId) {
    sessionAttributes.lastProviderTurnId = options.providerTurnId;
  }
  if (options.humanTurnId) {
    sessionAttributes.lastHumanTurnId = options.humanTurnId;
  }

  const finalSessionAttributes = clearExcludedStaffSelection(sessionAttributes);
  const runtimeHints = buildRuntimeHintsForSlot(slotToElicit, finalSessionAttributes);
  const sessionState = {
    ...(response.sessionState || {}),
    sessionAttributes: finalSessionAttributes
  };
  if (runtimeHints) {
    sessionState.runtimeHints = runtimeHints;
  } else {
    delete sessionState.runtimeHints;
  }
  return {
    ...response,
    sessionState
  };
}

function redactLogObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/(?:token|secret|authorization|password)/i.test(key))
      .map(([key, entry]) => [key, typeof entry === "object" ? redactLogObject(entry) : entry])
  );
}

function getResponseMessage(response) {
  return response?.messages?.[0] && typeof response.messages[0] === "object"
    ? response.messages[0]
    : {};
}

function validateSsmlForDiagnostics(contentType, content) {
  if (contentType !== "SSML") {
    return { valid: true, reason: "not_ssml" };
  }
  const trimmed = String(content || "").trim();
  if (!trimmed) {
    return { valid: false, reason: "empty_ssml" };
  }
  if (!/^<speak(?:\s|>)/i.test(trimmed) || !/<\/speak>\s*$/i.test(trimmed)) {
    return { valid: false, reason: "missing_speak_root" };
  }
  const stack = [];
  const tagPattern = /<\/?([a-zA-Z][\w:-]*)(?:\s[^>]*)?>/g;
  for (const match of trimmed.matchAll(tagPattern)) {
    const fullTag = match[0];
    const tagName = match[1].toLowerCase();
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
}

export function validateLexResponseForDiagnostics(response) {
  const errors = [];
  const sessionState = response?.sessionState;
  const dialogAction = sessionState?.dialogAction;
  const intent = sessionState?.intent;
  const message = getResponseMessage(response);
  const content = typeof message.content === "string" ? message.content : "";
  const hasMessage = Boolean(response?.messages?.length);
  const hasContent = content.trim().length > 0;
  const contentType = hasMessage
    ? message.contentType || (content.trim().startsWith("<speak>") ? "SSML" : "PlainText")
    : "None";
  const actionType = dialogAction?.type;
  if (!sessionState || typeof sessionState !== "object") {
    errors.push("missing_sessionState");
  }
  if (!actionType) {
    errors.push("missing_dialogAction_type");
  }
  const messageRequired = ["ElicitSlot", "ConfirmIntent", "ElicitIntent"].includes(actionType);
  if (messageRequired && !hasContent) {
    errors.push("missing_message");
  }
  if (hasMessage && !["PlainText", "SSML"].includes(contentType)) {
    errors.push("unsupported_message_type");
  }
  if (actionType === "ElicitSlot") {
    if (!intent?.name) {
      errors.push("missing_intent_name");
    }
    if (!intent?.state) {
      errors.push("missing_intent_state");
    }
    if (!dialogAction.slotToElicit) {
      errors.push("missing_slotToElicit");
    }
    if (intent?.name === "BookAppointmentIntent" && intent?.state !== "InProgress") {
      errors.push("book_elicit_slot_not_in_progress");
    }
  }
  if (actionType === "Close") {
    if (!intent?.state) {
      errors.push("missing_intent_state");
    } else if (!["Fulfilled", "Failed"].includes(intent.state)) {
      errors.push("close_intent_state_invalid");
    }
  }
  const ssmlValidation = hasMessage
    ? validateSsmlForDiagnostics(contentType, content)
    : { valid: true, reason: "no_message" };
  if (!ssmlValidation.valid) {
    errors.push(`invalid_ssml:${ssmlValidation.reason}`);
  }
  return {
    valid: errors.length === 0,
    errors,
    messageContentType: contentType,
    ssmlValidation
  };
}

function fingerprintLexResponse(response) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        dialogAction: response?.sessionState?.dialogAction,
        intentName: response?.sessionState?.intent?.name,
        intentState: response?.sessionState?.intent?.state,
        messages: response?.messages
      })
    )
    .digest("hex");
}

function getInputMode(event) {
  return event.inputMode || (readDtmfDigit(event.inputTranscript) ? "DTMF" : "Speech");
}

function numberFromLexMetric(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function getTopNluConfidence(event) {
  for (const interpretation of event.interpretations || []) {
    const confidence = numberFromLexMetric(
      interpretation?.nluConfidence?.score ??
        interpretation?.intent?.nluConfidence?.score ??
        interpretation?.intentConfidence
    );
    if (confidence !== undefined) {
      return confidence;
    }
  }
  return undefined;
}

function buildAudioTimeoutProfile(sessionAttributes = {}) {
  return Object.fromEntries(
    Object.entries(sessionAttributes)
      .filter(([key]) => key.startsWith("x-amz-lex:audio:"))
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function buildLexEventShapeDiagnostic(event) {
  const sessionAttributes = event.sessionState?.sessionAttributes || {};
  return {
    hasInputTranscript: typeof event.inputTranscript === "string" && event.inputTranscript.length > 0,
    transcriptionsCount: Array.isArray(event.transcriptions) ? event.transcriptions.length : 0,
    interpretationsCount: Array.isArray(event.interpretations) ? event.interpretations.length : 0,
    hasRequestAttributes: Boolean(event.requestAttributes && Object.keys(event.requestAttributes).length),
    hasRuntimeHints: Boolean(event.sessionState?.runtimeHints),
    hasSessionAttributes: Boolean(Object.keys(sessionAttributes).length),
    hasIntent: Boolean(event.sessionState?.intent?.name),
    invocationSource: event.invocationSource || ""
  };
}

function getProviderRequestId(event) {
  const sessionAttributes = event.sessionState?.sessionAttributes || {};
  const requestAttributes = event.requestAttributes || {};
  return String(
    event.sessionState?.originatingRequestId ||
      requestAttributes["x-amz-lex:originating-request-id"] ||
      requestAttributes["x-amz-lex:request-id"] ||
      event.requestId ||
      event.invocationId ||
      event.invocationSourceRequestId ||
      sessionAttributes["x-amz-lex:request-id"] ||
      ""
  );
}

function getHumanTurnId(event) {
  const sessionAttributes = event.sessionState?.sessionAttributes || {};
  if (sessionAttributes.humanTurnId) {
    return String(sessionAttributes.humanTurnId);
  }
  const contactId =
    getAttribute(event, attributeNames.contactId) ||
    event.sessionId ||
    sessionAttributes.AmazonConnectContactId ||
    "session";
  const providerRequestId = getProviderRequestId(event);
  const transcript = normalizeForMatch(getCurrentTurnTranscript(event) || event.inputTranscript || "");
  if (providerRequestId) {
    return `${contactId}:${providerRequestId}:${transcript || getInputMode(event).toLowerCase() || "empty"}`;
  }
  return `${contactId}:${getInputMode(event)}:${transcript || "empty"}`;
}

function getProviderTurnId(event) {
  const sessionAttributes = event.sessionState?.sessionAttributes || {};
  if (sessionAttributes.providerTurnId) {
    return String(sessionAttributes.providerTurnId);
  }
  const humanTurnId = getHumanTurnId(event);
  return String(
    event.requestId ||
      event.invocationId ||
      event.invocationSourceRequestId ||
      sessionAttributes["x-amz-lex:request-id"] ||
      `${humanTurnId}:${event.invocationSource || "unknown"}`
  );
}

function getAsrDiagnostics(event) {
  const sessionAttributes = event.sessionState?.sessionAttributes || {};
  const transcriptionAlternatives = [];
  const interpretationAlternatives = [];
  const addAlternative = (target, candidate, source) => {
    if (!candidate || typeof candidate !== "object") {
      return;
    }
    const transcript = String(
      candidate.transcription ||
        candidate.transcript ||
        candidate.inputTranscript ||
        candidate.text ||
        ""
    ).trim();
    if (!transcript) {
      return;
    }
    const transcriptionConfidence =
      source === "event.transcriptions"
        ? numberFromLexMetric(candidate.transcriptionConfidence)
        : undefined;
    const nluConfidence =
      source === "interpretations"
        ? numberFromLexMetric(candidate.nluConfidence?.score ?? candidate.intent?.nluConfidence?.score ?? candidate.intentConfidence)
        : undefined;
    target.push({
      transcript,
      source,
      ...(transcriptionConfidence !== undefined ? { transcriptionConfidence } : {}),
      ...(nluConfidence !== undefined ? { nluConfidence } : {})
    });
  };

  for (const transcription of event.transcriptions || []) {
    addAlternative(transcriptionAlternatives, transcription, "event.transcriptions");
  }
  for (const interpretation of event.interpretations || []) {
    addAlternative(interpretationAlternatives, {
      transcription: interpretation?.transcription || interpretation?.inputTranscript,
      nluConfidence: interpretation?.nluConfidence,
      intent: interpretation?.intent,
      intentConfidence: interpretation?.intentConfidence
    }, "interpretations");
  }

  const alternatives =
    transcriptionAlternatives.length > 0
      ? transcriptionAlternatives
      : interpretationAlternatives.length > 0
        ? interpretationAlternatives
        : event.inputTranscript
          ? [{ transcript: String(event.inputTranscript), source: "inputTranscriptFallback" }]
          : [];
  const seen = new Set();
  const alternativeTranscripts = alternatives
    .filter((alternative) => {
      const key = normalizeForMatch(alternative.transcript);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 5);
  const topTranscript = event.inputTranscript || alternativeTranscripts[0]?.transcript || "";
  const topAlternative = alternativeTranscripts.find(
    (alternative) => normalizeForMatch(alternative.transcript) === normalizeForMatch(topTranscript)
  ) || alternativeTranscripts[0];
  const transcriptionConfidence =
    topAlternative?.source === "event.transcriptions" ? topAlternative.transcriptionConfidence : undefined;
  const confidenceSource =
    transcriptionConfidence !== undefined ? "event.transcriptions.transcriptionConfidence" : "none";
  const nluConfidence = getTopNluConfidence(event);

  return {
    topTranscript,
    alternativeTranscripts,
    nBestAlternatives: alternativeTranscripts.map((alternative) => ({
      transcript: alternative.transcript,
      source: alternative.source,
      ...(alternative.transcriptionConfidence !== undefined
        ? { confidence: alternative.transcriptionConfidence, transcriptionConfidence: alternative.transcriptionConfidence }
        : {}),
      ...(alternative.nluConfidence !== undefined ? { nluConfidence: alternative.nluConfidence } : {})
    })),
    transcriptionConfidence,
    nluConfidence,
    confidence: transcriptionConfidence,
    confidenceSource,
    alternativesSource:
      transcriptionAlternatives.length > 0
        ? "event.transcriptions"
        : interpretationAlternatives.length > 0
          ? "interpretations"
          : topTranscript
            ? "inputTranscriptFallback"
            : "none",
    inputMode: getInputMode(event),
    activeSlot: getActiveVoiceSlot(sessionAttributes),
    speechModelPreference: sessionAttributes.speechModelPreference || sessionAttributes.lexSpeechModelPreference || "",
    speechDetectionSensitivity: sessionAttributes.speechDetectionSensitivity || "",
    audioTimeoutProfile: buildAudioTimeoutProfile(sessionAttributes),
    connectBranch: sessionAttributes.connectRecoveryStage || "",
    connectErrorCode: sessionAttributes.connectErrorCode || sessionAttributes.connectLastErrorCode || "",
    clarificationReason: sessionAttributes.clarificationReason || "",
    eventShape: buildLexEventShapeDiagnostic(event)
  };
}

function getAsrDecisionTranscripts(event) {
  const diagnostics = getAsrDiagnostics(event);
  const candidates = [
    diagnostics.topTranscript,
    ...diagnostics.nBestAlternatives.map((alternative) => alternative.transcript)
  ];
  const seen = new Set();
  return candidates
    .map((value) => String(value || "").trim())
    .filter((value) => {
      const key = normalizeForMatch(value);
      if (!key || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function hasScopedFullSetPhoneticCandidate(text) {
  const normalized = normalizeForMatch(text);
  if (!normalized || hasUnsafeSunsetWithoutExplicitFullSetAlias(text)) {
    return false;
  }
  return Boolean(
      /\bwho\s+(?:said|s\s+that|is\s+that|that)\b/.test(normalized) ||
      /\bfull\s+jet\b/.test(normalized) ||
      /\btime\s+to\s+fight\b/.test(normalized) ||
      /\bfun\s+facts?\b/.test(normalized) ||
      /\b(?:phone\s+set|phone\s+chat|food\s+set|pool\s+set|cool\s+set)\b/.test(normalized) ||
      /\b(?:can\s+we|could\s+we|so\s+we\s+ll|we\s+ll)\s+set\b/.test(normalized)
  );
}

function hasStrongServiceSlotFullSetCandidate(text) {
  const normalized = normalizeForMatch(text);
  if (!normalized || hasUnsafeSunsetWithoutExplicitFullSetAlias(text)) {
    return false;
  }
  return Boolean(findDedicatedFullSetAlias(text) || /\bfull\s+jet\b/.test(normalized));
}

function findProposedFullSetServiceClarification(event, knownAttributes = {}) {
  const previous = event.sessionState?.sessionAttributes || {};
  if (getSessionAttribute(knownAttributes, slotNames.serviceName) || knownAttributes.confirmedServiceName) {
    return null;
  }
  const topTranscript = getCurrentTurnTranscript(event);
  if (hasUnsafeSunsetWithoutExplicitFullSetAlias(topTranscript)) {
    return null;
  }
  const timeZone = getAttribute(event, attributeNames.timezone) || DEFAULT_SALON_TIMEZONE;
  const currentDetails = extractBookingDetailsFromText(topTranscript, timeZone, previous);
  const date = knownAttributes.requestedDate || currentDetails.requestedDate;
  const time = knownAttributes.requestedTime || currentDetails.requestedTime;
  const serviceSlotActive =
    getActiveVoiceSlot(previous) === "serviceName" ||
    previous.lastAskedSlot === "serviceName" ||
    previous.activeDtmfMenu === "service";
  const hasBookingContext = Boolean(date && time && isBookingLikeUtterance(topTranscript));
  const hasServiceSlotOnlyContext =
    serviceSlotActive && hasStrongServiceSlotFullSetCandidate(topTranscript);
  if (!hasServiceSlotOnlyContext && !hasBookingContext) {
    return null;
  }

  const transcripts = getAsrDecisionTranscripts(event);
  const alternativeMatch = transcripts.slice(1).find((candidate) =>
    recognizeFullSetFromTranscript(candidate, {
      ...previous,
      lastAskedSlot: "serviceName"
    })
  );
  if (alternativeMatch) {
    return {
      proposedServiceName: "Full Set",
      reason: "asr_alternative_full_set",
      asrAlternativesUsed: true,
      matchedTranscript: alternativeMatch
    };
  }
  if (hasScopedFullSetPhoneticCandidate(topTranscript)) {
    return {
      proposedServiceName: "Full Set",
      reason: "scoped_phonetic_full_set",
      asrAlternativesUsed: transcripts.length > 1,
      matchedTranscript: topTranscript
    };
  }
  return null;
}

function findProposedAnyStaffClarification(event, knownAttributes = {}) {
  const previous = event.sessionState?.sessionAttributes || {};
  const topTranscript = getCurrentTurnTranscript(event);
  const activeStaffSlot = getActiveVoiceSlot(previous) === "staffPreference";
  const hasCompleteBookingFrame =
    Boolean(
      knownAttributes.serviceName &&
        (knownAttributes.requestedDate || knownAttributes.proposedRequestedDate) &&
        knownAttributes.requestedTime
    ) && isBookingLikeUtterance(topTranscript);
  if (!activeStaffSlot && !hasCompleteBookingFrame) {
    return null;
  }
  if (knownAttributes.staffPreference || knownAttributes.confirmedStaffName) {
    return null;
  }
  if (
    !knownAttributes.serviceName ||
    !(knownAttributes.requestedDate || knownAttributes.proposedRequestedDate) ||
    !knownAttributes.requestedTime
  ) {
    return null;
  }
  const transcripts = getAsrDecisionTranscripts(event);
  const staffContext = {
    ...previous,
    ...knownAttributes,
    requestedDate: knownAttributes.requestedDate || knownAttributes.proposedRequestedDate,
    lastAskedSlot: "staffPreference"
  };
  if (normalizeAnyStaffPhrase(transcripts[0], staffContext)) {
    return null;
  }
  if (hasGuardedFirstAvailableStaffTail(transcripts[0])) {
    return {
      proposedStaffPreference: "Any staff",
      reason: "ambiguous_first_available_asr",
      asrAlternativesUsed: transcripts.length > 1,
      matchedTranscript: transcripts[0]
    };
  }
  const alternativeMatch = transcripts.slice(1).find((candidate) =>
    normalizeAnyStaffPhrase(candidate, staffContext)
  );
  if (!alternativeMatch) {
    return null;
  }
  return {
    proposedStaffPreference: "Any staff",
    reason: "asr_alternative_first_available",
    asrAlternativesUsed: true,
    matchedTranscript: alternativeMatch
  };
}

function findProposedTodayDateClarification(event, knownAttributes = {}) {
  if (knownAttributes.requestedDate || !knownAttributes.serviceName || !knownAttributes.requestedTime) {
    return null;
  }
  const text = getCurrentTurnTranscript(event);
  const normalized = normalizeForMatch(text);
  if (!normalized || isNegativeUtterance(text)) {
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
  const normalizedTime = normalizeTimePhrase(timeCandidate, "", { currentTurnHasDatePhrase: true });
  if (!normalizedTime) {
    return null;
  }
  const spokenNumberNormalized = normalizeForMatch(normalizeSpokenNumbers(normalizeHourMinuteTimeExpression(text)));
  if (!/\bday\s+at\s+\d{1,2}(?::\d{2})?\s*(?:a\s*m|p\s*m|am|pm)\b/.test(spokenNumberNormalized)) {
    return null;
  }
  const timeZone = getAttribute(event, attributeNames.timezone) || DEFAULT_SALON_TIMEZONE;
  const today = normalizeRequestedDateValue("today", timeZone);
  return today
    ? {
        proposedRequestedDate: today,
        reason: "dropped_today_day_at_time",
        matchedTranscript: text
      }
    : null;
}

function buildProposedServicePrompt(event, knownAttributes = {}) {
  const timeZone = getAttribute(event, attributeNames.timezone) || DEFAULT_SALON_TIMEZONE;
  const date = formatDateForPrompt(knownAttributes.requestedDate, timeZone);
  const time = formatTimeForPrompt(knownAttributes.requestedTime);
  const heard = [date, time ? `at ${time}` : ""].filter(Boolean).join(" ");
  return heard
    ? `I heard ${heard}, but I'm not sure about the service. Did you say Full Set?`
    : "I'm not sure about the service. Did you say Full Set?";
}

function isAmbiguousFirstAvailableStaffCandidate(text, sessionAttributes = {}) {
  const normalized = normalizeForMatch(text);
  if (!normalized) {
    return false;
  }
  if (getActiveVoiceSlot(sessionAttributes) !== "staffPreference") {
    return false;
  }
  return hasGuardedFirstAvailableStaffTail(normalized);
}

function hasGuardedFirstAvailableStaffTail(text) {
  const normalized = normalizeForMatch(text);
  if (!normalized) {
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
        "anystop",
        "edit stop",
        "edit stop if i",
        "any stop if i",
        "any stuff",
        "any star",
        "any star is fine",
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
}

function buildVoiceSlotDecision({
  slot,
  action,
  canonicalValue,
  entityId,
  reason,
  confidenceBand = "medium",
  evidence = [],
  alternativesUsed = false
}) {
  return {
    slot,
    action,
    ...(canonicalValue ? { canonicalValue } : {}),
    ...(entityId ? { entityId } : {}),
    reason: reason || "unspecified",
    confidenceBand,
    evidence: evidence.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 5),
    alternativesUsed: Boolean(alternativesUsed)
  };
}

function confidenceBandForMutationDecision(decision) {
  if (decision.reason === "bare_or_ambiguous_wrong_slot") {
    return "low";
  }
  if (decision.accepted || decision.reason === "caller_rejected_proposed_value") {
    return "high";
  }
  return "medium";
}

function mutationPolicyToVoiceSlotDecision(decision, evidence = [], alternativesUsed = false) {
  return buildVoiceSlotDecision({
    slot: decision.slotName,
    action: decision.accepted ? "accept" : "reject",
    canonicalValue: decision.accepted ? decision.proposedValue : undefined,
    reason: decision.reason,
    confidenceBand: confidenceBandForMutationDecision(decision),
    evidence: [
      ...evidence,
      decision.proposedValue ? `proposed=${decision.proposedValue}` : "",
      decision.previousValue ? `previous=${decision.previousValue}` : ""
    ],
    alternativesUsed
  });
}

function buildProposedVoiceSlotDecision(slot, canonicalValue, reason, matchedTranscript, alternativesUsed = false) {
  return buildVoiceSlotDecision({
    slot,
    action: "propose",
    canonicalValue,
    reason,
    confidenceBand: "medium",
    evidence: [matchedTranscript],
    alternativesUsed
  });
}

function isStaffConfirmationRejection(text) {
  const normalized = normalizeForMatch(text);
  return Boolean(
    isNegativeUtterance(text) ||
      /\bnot\s+(?:a\s+|the\s+)?(?:five|5)\b/.test(normalized) ||
      /\bnot\s+(?:first\s+available|any\s+staff|that|it)\b/.test(normalized)
  );
}

function buildFocusedStaffChoicePrompt(event) {
  const previous = event.sessionState?.sessionAttributes || {};
  const options = Object.values(getStaffDtmfOptions(previous))
    .filter((value) => normalizeForMatch(value) !== "any staff")
    .filter(Boolean);
  const preferred = options.find((value) => normalizeForMatch(value) === "amy") || options[0];
  return preferred
    ? `Which staff would you like, ${preferred} or first available?`
    : "Which staff would you like, or first available?";
}

function buildStaffClarificationRejectionPrompt(event) {
  const known = buildKnownBookingSessionAttributes(event);
  const time = formatTimeForPrompt(known.requestedTime);
  const prefix = time ? `Understood. I still have ${time}. ` : "Understood. ";
  return `${prefix}${buildFocusedStaffChoicePrompt(event)}`;
}

function buildAmbiguousStaffConfirmationPrompt(event) {
  const summary = buildKnownBookingPromptSummary(event, { forPhrase: false });
  return summary
    ? `I still have ${summary}. Did you mean first available?`
    : "Did you mean first available?";
}

function buildBookingFrameRepairConfirmationPrompt(event, proposal) {
  const timeZone = getAttribute(event, attributeNames.timezone) || DEFAULT_SALON_TIMEZONE;
  const date = formatDateForPrompt(proposal.proposedRequestedDate, timeZone);
  const time = formatTimeForPrompt(proposal.requestedTime);
  const staff = normalizeForMatch(proposal.proposedStaffPreference) === "any staff"
    ? "the first available staff"
    : proposal.proposedStaffPreference;
  return `I heard ${proposal.serviceName} ${date} at ${time} with ${staff}. Is that right?`;
}

function buildSlotMutationDiagnostics(event, finalAttributes = {}) {
  const previous = event.sessionState?.sessionAttributes || {};
  const slots = event.sessionState?.intent?.slots || {};
  const currentTurnTranscript = getCurrentTurnTranscript(event);
  const proposedSlotMutations = [];
  const acceptedSlotMutations = [];
  const preventedSlotMutations = [];
  const addDecision = (slotName, proposedValue, trustedValue) => {
    if (!proposedValue) {
      return;
    }
    const decision = buildVoiceSlotMutationPolicy({
      slotName,
      proposedValue,
      trustedValue,
      transcript: currentTurnTranscript,
      sessionAttributes: previous
    });
    proposedSlotMutations.push(decision);
    if (decision.accepted) {
      acceptedSlotMutations.push(decision);
    } else {
      preventedSlotMutations.push(decision);
    }
  };
  const diagnostics = getAsrDiagnostics(event);
  const alternativesUsed = diagnostics.nBestAlternatives.length > 1;
  addDecision(
    "requestedTime",
    getSlotValue(slots, slotNames.requestedTime, { preferOriginal: true }),
    getSessionAttribute(previous, slotNames.requestedTime)
  );
  addDecision(
    "requestedDate",
    getSlotValue(slots, slotNames.requestedDate),
    getSessionAttribute(previous, slotNames.requestedDate)
  );
  addDecision(
    "serviceName",
    getSlotValue(slots, slotNames.serviceName, { preferOriginal: true }),
    previous.confirmedServiceName || getSessionAttribute(previous, slotNames.serviceName)
  );
  addDecision(
    "staffPreference",
    getSlotValue(slots, slotNames.staffPreference, { preferOriginal: true }),
    previous.confirmedStaffName || getSessionAttribute(previous, slotNames.staffPreference)
  );
  const voiceSlotDecisions = proposedSlotMutations.map((decision) =>
    mutationPolicyToVoiceSlotDecision(decision, [currentTurnTranscript], alternativesUsed)
  );
  if (finalAttributes.proposedServiceName) {
    voiceSlotDecisions.push(
      buildProposedVoiceSlotDecision(
        "serviceName",
        finalAttributes.proposedServiceName,
        finalAttributes.clarificationReason || finalAttributes.serviceClarificationReason || "service_proposal",
        currentTurnTranscript,
        alternativesUsed
      )
    );
  }
  if (finalAttributes.proposedStaffPreference) {
    voiceSlotDecisions.push(
      buildProposedVoiceSlotDecision(
        "staffPreference",
        finalAttributes.proposedStaffPreference,
        finalAttributes.staffClarificationReason || finalAttributes.clarificationReason || "staff_proposal",
        currentTurnTranscript,
        alternativesUsed
      )
    );
  }
  return {
    activeSlot: getActiveVoiceSlot(previous),
    proposedSlotMutation: proposedSlotMutations[0] || null,
    proposedSlotMutations,
    acceptedSlotMutations,
    preventedSlotMutations,
    voiceSlotDecisions,
    clarificationReason:
      finalAttributes.clarificationReason ||
      finalAttributes.serviceClarificationReason ||
      finalAttributes.staffClarificationReason ||
      "",
    asrAlternativesUsed: alternativesUsed,
    trustedSlotsBefore: collectTrustedBookingSlots(previous),
    trustedSlotsAfter: collectTrustedBookingSlots(finalAttributes)
  };
}

function buildLexTurnDebug(event, analysis = {}) {
  const attributesBefore = event.sessionState?.sessionAttributes || {};
  const slots = event.sessionState?.intent?.slots || {};
  const knownAfterSanitization = buildKnownBookingSessionAttributes(event);
  const slotMutationDiagnostics = buildSlotMutationDiagnostics(event, knownAfterSanitization);
  return {
    contactId:
      getAttribute(event, attributeNames.contactId) ||
      event.sessionId ||
      attributesBefore.AmazonConnectContactId,
    initialContactId: attributesBefore.InitialContactId || attributesBefore.initialContactId,
    callerPhone: getAttribute(event, attributeNames.customerNumber),
    calledNumber: getAttribute(event, attributeNames.calledNumber),
    currentTurnTranscript: analysis.currentTurnTranscript ?? getCurrentTurnTranscript(event),
    inputTranscript: event.inputTranscript || "",
    inputMode: getInputMode(event),
    intentName: event.sessionState?.intent?.name || "",
    lastAskedSlotBefore: attributesBefore.lastAskedSlot,
    activeDtmfMenuBefore: attributesBefore.activeDtmfMenu,
    activeDtmfOptionsBefore: getActiveDtmfOptions(attributesBefore),
    slotsOriginalValues: collectSlotOriginalValues(slots),
    slotsInterpretedValues: collectSlotInterpretedValues(slots),
    trustedSlotsBefore: collectTrustedBookingSlots(attributesBefore),
    attributesBefore: redactLogObject(attributesBefore),
    asrDiagnostics: getAsrDiagnostics(event),
    activeSlot: slotMutationDiagnostics.activeSlot,
    proposedSlotMutation: slotMutationDiagnostics.proposedSlotMutation,
    acceptedSlotMutations: slotMutationDiagnostics.acceptedSlotMutations,
    preventedSlotMutations: slotMutationDiagnostics.preventedSlotMutations,
    voiceSlotDecisions: slotMutationDiagnostics.voiceSlotDecisions,
    clarificationReason: slotMutationDiagnostics.clarificationReason,
    asrAlternativesUsed: slotMutationDiagnostics.asrAlternativesUsed,
    dtmfDiagnostics: analysis.dtmfDiagnostics ?? getCurrentTurnDtmfDiagnostics(event),
    dtmfRouting: analysis.dtmfRouting,
    slotDecisions: buildSlotDecisionDebug(event, knownAfterSanitization),
    sanitization: {
      clearedStaleRequestedTime: Boolean(analysis.clearedStaleRequestedTime),
      ignoredPollutedSlots: analysis.ignoredPollutedSlots || [],
      ignoredUngroundedSlots: analysis.ignoredUngroundedSlots || [],
      ignoredNoiseFields: analysis.ignoredNoiseFields || [],
      preservedConfirmedService: Boolean(analysis.preservedConfirmedService),
      currentTurnStaffMention: analysis.currentTurnStaffMention || null,
      currentTurnHasExplicitStaffPhrase: Boolean(analysis.currentTurnHasExplicitStaffPhrase),
      currentTurnServiceMention: analysis.currentTurnServiceMention || null,
      serviceAliasInput: analysis.serviceAliasCorrectionRaw || null,
      discardedPlaceholderService: analysis.discardedPlaceholderService || null,
      discardedStaleStaff: analysis.discardedStaleStaff || null,
      staffSource: analysis.staffSource || null
    },
    trustedSlotsAfter: collectTrustedBookingSlots(knownAfterSanitization)
  };
}

function logStructuredLexTurn(event, response, analysis = {}) {
  const sessionAttributesBefore = event.sessionState?.sessionAttributes || {};
  const sessionAttributesAfter = response?.sessionState?.sessionAttributes || {};
  const slots = event.sessionState?.intent?.slots || {};
  const slotMutationDiagnostics = buildSlotMutationDiagnostics(event, sessionAttributesAfter);
  const responseMessage = getResponseMessage(response);
  const lexResponseDiagnostics = validateLexResponseForDiagnostics(response);
  const logPayload = {
	    contactId:
	      getAttribute(event, attributeNames.contactId) ||
	      event.sessionId ||
	      sessionAttributesAfter.AmazonConnectContactId,
	    providerTurnId: getProviderTurnId(event),
	    humanTurnId: getHumanTurnId(event),
	    providerRequestId: getProviderRequestId(event),
	    lexRequestId: event.requestId || event.invocationId || getProviderRequestId(event) || "",
	    lexPhase: event.invocationSource || "",
	    turnSequenceBefore: sessionAttributesBefore.turnSequence,
	    turnSequenceAfter: sessionAttributesAfter.turnSequence,
	    currentTurnTranscript: analysis.currentTurnTranscript ?? getCurrentTurnTranscript(event),
    inputTranscript: event.inputTranscript || "",
    inputMode: getInputMode(event),
    lastAskedSlotBefore: sessionAttributesBefore.lastAskedSlot,
    lastAskedSlotAfter: sessionAttributesAfter.lastAskedSlot,
    activeDtmfMenuBefore: sessionAttributesBefore.activeDtmfMenu,
    activeDtmfMenuAfter: sessionAttributesAfter.activeDtmfMenu,
    activeDtmfOptionsBefore: getActiveDtmfOptions(sessionAttributesBefore),
    activeDtmfOptionsAfter: getActiveDtmfOptions(sessionAttributesAfter),
    slotsOriginalValues: collectSlotOriginalValues(slots),
    slotsInterpretedValues: collectSlotInterpretedValues(slots),
    scopedDtmfDigit: analysis.scopedDtmfDigit || "",
    asrDiagnostics: getAsrDiagnostics(event),
    activeSlot: slotMutationDiagnostics.activeSlot,
    proposedSlotMutation: slotMutationDiagnostics.proposedSlotMutation,
    acceptedSlotMutations: slotMutationDiagnostics.acceptedSlotMutations,
    preventedSlotMutations: slotMutationDiagnostics.preventedSlotMutations,
    voiceSlotDecisions: slotMutationDiagnostics.voiceSlotDecisions,
    clarificationReason: slotMutationDiagnostics.clarificationReason,
    asrAlternativesUsed: slotMutationDiagnostics.asrAlternativesUsed,
    dtmfDiagnostics: analysis.dtmfDiagnostics ?? getCurrentTurnDtmfDiagnostics(event),
    dtmfRouting: analysis.dtmfRouting,
    slotDecisions: buildSlotDecisionDebug(event, sessionAttributesAfter),
    sanitization: {
      clearedStaleRequestedTime: Boolean(analysis.clearedStaleRequestedTime),
      ignoredPollutedSlots: analysis.ignoredPollutedSlots || [],
      ignoredUngroundedSlots: analysis.ignoredUngroundedSlots || [],
      ignoredNoiseFields: analysis.ignoredNoiseFields || [],
      preservedConfirmedService: Boolean(analysis.preservedConfirmedService),
      currentTurnStaffMention: analysis.currentTurnStaffMention || null,
      discardedStaleStaff: analysis.discardedStaleStaff || null,
      staffSource: analysis.staffSource || null
    },
    trustedSlotsBefore: collectTrustedBookingSlots(sessionAttributesBefore),
    trustedSlotsAfter: collectTrustedBookingSlots(sessionAttributesAfter),
    sessionAttributesBefore: redactLogObject(sessionAttributesBefore),
    sessionAttributesAfter: redactLogObject(sessionAttributesAfter),
    lambdaResponseFingerprint: fingerprintLexResponse(response),
    playbackEvidenceStage: "LAMBDA_RESPONSE_ONLY",
    promptPlaybackConfirmed: false,
    lexResponseSchemaValid: lexResponseDiagnostics.valid,
    lexResponseSchemaErrors: lexResponseDiagnostics.errors,
    dialogActionType: response?.sessionState?.dialogAction?.type,
    slotToElicit: response?.sessionState?.dialogAction?.slotToElicit,
    messageContentType: lexResponseDiagnostics.messageContentType,
    ssmlValidation: lexResponseDiagnostics.ssmlValidation,
    message: responseMessage.content
  };
  console.info(JSON.stringify(logPayload));
}

function buildWrongSlotDtmfPrompt(event, slotName) {
  const known = buildKnownBookingSessionAttributes(event);
  const confirmedService = normalizeServiceName(known.confirmedServiceName || known.serviceName);
  if (slotName === "requestedDate") {
    return "What day would you like? You can say today or tomorrow.";
  }
  if (slotName === "requestedTime") {
    return confirmedService
      ? `I already have ${confirmedService}. What time would you like?`
      : "What time would you like?";
  }
  if (slotName === "customerName") {
    return buildCustomerNamePrompt(event, {
      already: currentTurnRepeatsKnownBookingField(event)
    });
  }
  if (slotName === "customerPhone") {
    return "What phone number should I use for the appointment?";
  }
  return getElicitPrompt(event, slotName || getBookingSlotToElicit(event) || "requestedDate", 1);
}

async function handleLexEvent(event, analysis = {}) {
  try {
    const rawIntentName = event.sessionState?.intent?.name || "";
    const intentName = shouldRepairRescheduleToActiveBookingIntent(event, rawIntentName)
      ? "BookAppointmentIntent"
      : shouldRepairToRescheduleIntent(event, rawIntentName)
      ? "RescheduleAppointmentIntent"
      : shouldTreatFallbackAsBooking(event, rawIntentName)
      ? "BookAppointmentIntent"
      : rawIntentName;
    if (intentName !== rawIntentName) {
      event = withIntentName(event, intentName);
    }
    const transferDecision = shouldTransferToHuman(event, intentName);
    const shouldEscalate = transferDecision.transfer;
    const sessionAttributes = event.sessionState?.sessionAttributes || {};
    const timeZone = getAttribute(event, attributeNames.timezone) || DEFAULT_SALON_TIMEZONE;
    const finalConfirmationOutcome = isFinalBookingConfirmationActive(event)
      ? classifyFinalBookingConfirmation(event.inputTranscript)
      : FINAL_CONFIRMATION_OUTCOME.UNKNOWN;
    const intentConfidence = getIntentConfidence(event, intentName);
    const escalationAttributes = shouldEscalate
      ? buildForceHumanEscalationAttributes(transferDecision.reason, {
          ...(intentConfidence !== null ? { intentConfidence: String(intentConfidence) } : {})
        })
      : {};

    if (
      !shouldEscalate &&
      analysis.ignoredNoiseFields?.includes("customerName") &&
      sessionAttributes.lastAskedSlot === "customerName"
    ) {
      const previousNameAttempts = parseAttemptCount(
        sessionAttributes.askedSlotsCount || sessionAttributes.fallbackCount || sessionAttributes.errorCount
      );
      if (previousNameAttempts >= 2 && !hasTrustedCustomerName(event)) {
        return await continueWithTemporaryCustomerName(event, intentName, analysis);
      }
      const response = buildElicitSlotResponse(
        event,
        "customerName",
        {
          ignoredNoiseFields: JSON.stringify(analysis.ignoredNoiseFields)
        },
        buildCustomerNamePrompt(event, {
          already: currentTurnRepeatsKnownBookingField(event),
          retry: previousNameAttempts >= 1
        })
      );
      await postInternalAppointment(
        buildInternalPayload(event, intentName, {
          ignoredNoiseFields: JSON.stringify(analysis.ignoredNoiseFields)
        }),
        {
          operationName: "booking_turn_logging",
          waitPrompt: WAIT_PROMPTS.customer_lookup,
          mechanism: "Lambda local customer name noise reprompt"
        }
      );
      return response;
    }

    if (
      !shouldEscalate &&
      sessionAttributes.lastAskedSlot === "customerName" &&
      currentTurnRepeatsKnownBookingField(event) &&
      !getKnownField(event, "customerName")
    ) {
      const response = buildElicitSlotResponse(
        event,
        "customerName",
        {
          ignoredNoiseFields: JSON.stringify(["customerName"])
        },
        buildCustomerNamePrompt(event, {
          already: true
        })
      );
      const lexTurnDebug = {
        ...(event.lexTurnDebug || {}),
        sanitization: {
          ...((event.lexTurnDebug || {}).sanitization || {}),
          ignoredNoiseFields: ["customerName"]
        }
      };
      await postInternalAppointment(
        buildInternalPayload(
          {
            ...event,
            lexTurnDebug
          },
          intentName,
          {
            ignoredNoiseFields: JSON.stringify(["customerName"])
          }
        ),
        {
          operationName: "booking_turn_logging",
          waitPrompt: WAIT_PROMPTS.customer_lookup,
          mechanism: "Lambda local repeated known field reprompt"
        }
      );
      return response;
    }

    if (
      !shouldEscalate &&
      (analysis.dtmfRouting?.digit || analysis.dtmfRouting?.isMultiDigitOrDigitSequence) &&
      !analysis.dtmfRouting.accepted &&
      ["wrong_slot", "no_active_menu"].includes(analysis.dtmfRouting.route) &&
      analysis.dtmfRouting.nextSlot
    ) {
      const actualMissingSlot = getBookingSlotToElicit(event);
      const knownValueForWrongSlot = getSessionAttribute(
        buildKnownBookingSessionAttributes(event),
        slotNames[analysis.dtmfRouting.nextSlot] || [analysis.dtmfRouting.nextSlot]
      );
      if (!knownValueForWrongSlot || actualMissingSlot === analysis.dtmfRouting.nextSlot) {
        return buildElicitSlotResponse(
          event,
          analysis.dtmfRouting.nextSlot,
          {
            dtmfRouting: JSON.stringify(analysis.dtmfRouting)
          },
          buildWrongSlotDtmfPrompt(event, analysis.dtmfRouting.nextSlot)
        );
      }
    }

    if (
      !shouldEscalate &&
      intentName === "BookAppointmentIntent" &&
      sessionAttributes.awaitingTimeConfirmation === "true"
    ) {
      if (isAffirmativeUtterance(event.inputTranscript) && sessionAttributes.proposedRequestedTime) {
        event = withSessionAttributes(event, {
          requestedTime: sessionAttributes.proposedRequestedTime,
          awaitingTimeConfirmation: "false",
          proposedRequestedTime: "",
          timeRecognitionConfirmed: "true"
        });
      } else if (isNegativeUtterance(event.inputTranscript)) {
        return buildElicitSlotResponse(
          event,
          "requestedTime",
          {
            awaitingTimeConfirmation: "false",
            proposedRequestedTime: "",
            timeRecognitionConfirmed: "false"
          },
          "No problem. What time would you like?"
        );
      }
    }

    if (
      !shouldEscalate &&
      intentName === "BookAppointmentIntent" &&
      sessionAttributes.awaitingBookingFrameRepairConfirmation === "true"
    ) {
      if (
        isAffirmativeUtterance(event.inputTranscript) &&
        sessionAttributes.proposedRequestedDate &&
        sessionAttributes.proposedStaffPreference
      ) {
        event = withSessionAttributes(event, {
          requestedDate: sessionAttributes.proposedRequestedDate,
          staffPreference: sessionAttributes.proposedStaffPreference,
          confirmedStaffName: sessionAttributes.proposedStaffPreference,
          awaitingBookingFrameRepairConfirmation: "false",
          proposedRequestedDate: "",
          proposedStaffPreference: "",
          bookingFrameRepairConfirmed: "true",
          awaitingFinalBookingConfirmation: "false",
          bookingConfirmationAsked: "false"
        });
      } else if (isNegativeUtterance(event.inputTranscript)) {
        return buildLexResponse(
          event,
          "No problem. Which detail is wrong: service, day, time, or staff?",
          "InProgress",
          {
            awaitingBookingFrameRepairConfirmation: "false",
            proposedRequestedDate: "",
            proposedStaffPreference: "",
            bookingFrameRepairConfirmed: "false",
            bookingFrameRepairRejected: "true",
            awaitingFinalBookingConfirmation: "false",
            bookingConfirmationAsked: "false",
            forceHumanEscalation: "false",
            transferToQueue: "false"
          },
          {
            dialogAction: {
              type: "ElicitIntent"
            },
            messageContentType: "PlainText"
          }
        );
      }
    }

    if (
      !shouldEscalate &&
      intentName === "BookAppointmentIntent" &&
      sessionAttributes.awaitingServiceConfirmation === "true"
    ) {
      if (isAffirmativeUtterance(event.inputTranscript) && sessionAttributes.proposedServiceName) {
        event = withSessionAttributes(event, {
          serviceName: sessionAttributes.proposedServiceName,
          confirmedServiceName: sessionAttributes.proposedServiceName,
          awaitingServiceConfirmation: "false",
          proposedServiceName: "",
          serviceRecognitionConfirmed: "true",
          clarificationReason: "service_proposal_confirmed"
        });
      } else if (isNegativeUtterance(event.inputTranscript)) {
        return buildElicitSlotResponse(
          event,
          "serviceName",
          {
            awaitingServiceConfirmation: "false",
            proposedServiceName: "",
            serviceRecognitionConfirmed: "false",
            clarificationReason: "service_proposal_rejected"
          },
          "No problem. Which service would you like?"
        );
      } else if (
        sessionAttributes.serviceDtmfConflictWithInitialUtterance &&
        sessionAttributes.proposedServiceName
      ) {
        return buildElicitSlotResponse(
          event,
          "serviceName",
          {
            awaitingServiceConfirmation: "true",
            proposedServiceName: sessionAttributes.proposedServiceName,
            serviceDtmfConflictWithInitialUtterance: sessionAttributes.serviceDtmfConflictWithInitialUtterance,
            clarificationReason: "service_dtmf_conflicts_initial_utterance",
            voiceSlotDecisions: JSON.stringify([
              buildProposedVoiceSlotDecision(
                "serviceName",
                sessionAttributes.proposedServiceName,
                "service_dtmf_conflicts_initial_utterance",
                `initial=${sessionAttributes.serviceDtmfConflictWithInitialUtterance}; dtmf=${sessionAttributes.proposedServiceName}`,
                false
              )
            ]),
            proposedSlotMutation: JSON.stringify({
              slotName: "serviceName",
              proposedValue: sessionAttributes.proposedServiceName,
              previousValue: sessionAttributes.serviceDtmfConflictWithInitialUtterance,
              reason: "service_dtmf_conflicts_initial_utterance"
            }),
            forceHumanEscalation: "false",
            transferToQueue: "false"
          },
          `I heard ${sessionAttributes.proposedServiceName} from the keypad. Is ${sessionAttributes.proposedServiceName} the service you want?`
        );
      }
    }

    if (
      !shouldEscalate &&
      intentName === "BookAppointmentIntent" &&
      sessionAttributes.awaitingStaffConfirmation === "true"
    ) {
      if (isAffirmativeUtterance(event.inputTranscript) && sessionAttributes.proposedStaffPreference) {
        event = withSessionAttributes(event, {
          staffPreference: sessionAttributes.proposedStaffPreference,
          confirmedStaffName: sessionAttributes.proposedStaffPreference,
          awaitingStaffConfirmation: "false",
          proposedStaffPreference: "",
          staffRecognitionConfirmed: "true",
          staffClarificationReason: "staff_proposal_confirmed"
        });
      } else if (isStaffConfirmationRejection(event.inputTranscript)) {
        return buildElicitSlotResponse(
          event,
          "staffPreference",
          {
            awaitingStaffConfirmation: "false",
            proposedStaffPreference: "",
            staffRecognitionConfirmed: "false",
            staffClarificationReason: "staff_proposal_rejected",
            forceHumanEscalation: "false",
            transferToQueue: "false"
          },
          buildStaffClarificationRejectionPrompt(event)
        );
      }
    }

    const knownAfterTimeSanitization =
      !shouldEscalate && intentName === "BookAppointmentIntent"
        ? buildKnownBookingSessionAttributes(event)
        : {};
    const weekdayDateConflict =
      !shouldEscalate && intentName === "BookAppointmentIntent"
        ? findWeekdayDateConflict(getCurrentTurnTranscript(event), timeZone)
        : null;
    if (weekdayDateConflict) {
      return buildElicitSlotResponse(
        event,
        "requestedDate",
        {
          requestedDate: undefined,
          dateClarificationReason: "weekday_date_conflict",
          weekdayDateConflict: JSON.stringify(weekdayDateConflict),
          awaitingFinalBookingConfirmation: "false",
          bookingConfirmationAsked: "false",
          forceHumanEscalation: "false",
          transferToQueue: "false"
        },
        buildWeekdayDateConflictPrompt(weekdayDateConflict)
      );
    }
    const pastRequestedDateTime =
      !shouldEscalate && intentName === "BookAppointmentIntent"
        ? getPastRequestedDateTimeDecision(event, knownAfterTimeSanitization)
        : null;
    const unresolvedPastDateReference =
      !shouldEscalate &&
      intentName === "BookAppointmentIntent" &&
      !knownAfterTimeSanitization.requestedDate &&
      hasExplicitUnresolvedPastDateReference(getCurrentTurnTranscript(event));
    if (unresolvedPastDateReference) {
      return buildPastRequestedDateTimeResponse(event, {
        requestedDate: "explicit_past_reference",
        requestedTime: knownAfterTimeSanitization.requestedTime || "",
        timeZone
      });
    }
    if (pastRequestedDateTime) {
      return buildPastRequestedDateTimeResponse(event, pastRequestedDateTime);
    }
    if (
      !shouldEscalate &&
      intentName === "BookAppointmentIntent" &&
      knownAfterTimeSanitization.awaitingTimeConfirmation === "true" &&
      knownAfterTimeSanitization.proposedRequestedTime
    ) {
      const timeRecognitionDiagnostics = (() => {
        try {
          return JSON.parse(knownAfterTimeSanitization.timeRecognitionDiagnostics || "{}");
        } catch {
          return {};
        }
      })();
      return buildElicitSlotResponse(
        event,
        "requestedTime",
        {
          awaitingTimeConfirmation: "true",
          proposedRequestedTime: knownAfterTimeSanitization.proposedRequestedTime,
          timeRecognitionDiagnostics: JSON.stringify(timeRecognitionDiagnostics)
        },
        `Did you mean ${knownAfterTimeSanitization.proposedRequestedTime}?`
      );
    }

    if (!shouldEscalate && intentName === "BookAppointmentIntent") {
      const proposedTodayDate = findProposedTodayDateClarification(event, knownAfterTimeSanitization);
      const proposedFrameStaff = proposedTodayDate
        ? findProposedAnyStaffClarification(event, {
            ...knownAfterTimeSanitization,
            proposedRequestedDate: proposedTodayDate.proposedRequestedDate
          })
        : null;
      if (
        proposedTodayDate &&
        proposedFrameStaff &&
        knownAfterTimeSanitization.serviceName &&
        knownAfterTimeSanitization.requestedTime
      ) {
        const voiceSlotDecisions = [
          buildProposedVoiceSlotDecision(
            "requestedDate",
            proposedTodayDate.proposedRequestedDate,
            proposedTodayDate.reason,
            proposedTodayDate.matchedTranscript,
            false
          ),
          buildProposedVoiceSlotDecision(
            "staffPreference",
            proposedFrameStaff.proposedStaffPreference,
            proposedFrameStaff.reason,
            proposedFrameStaff.matchedTranscript,
            proposedFrameStaff.asrAlternativesUsed
          )
        ];
        return buildElicitSlotResponse(
          event,
          "bookingConfirmation",
          {
            requestedDate: undefined,
            staffPreference: undefined,
            confirmedStaffName: undefined,
            awaitingBookingFrameRepairConfirmation: "true",
            proposedRequestedDate: proposedTodayDate.proposedRequestedDate,
            proposedStaffPreference: proposedFrameStaff.proposedStaffPreference,
            bookingFrameRepairReason: "dropped_today_and_first_available_asr",
            clarificationReason: "booking_frame_repair_confirmation",
            voiceSlotDecisions: JSON.stringify(voiceSlotDecisions),
            proposedSlotMutation: JSON.stringify({
              slotName: "bookingFrame",
              proposedRequestedDate: proposedTodayDate.proposedRequestedDate,
              proposedStaffPreference: proposedFrameStaff.proposedStaffPreference,
              reason: "dropped_today_and_first_available_asr"
            }),
            awaitingFinalBookingConfirmation: "false",
            bookingConfirmationAsked: "false",
            forceHumanEscalation: "false",
            transferToQueue: "false"
          },
          buildBookingFrameRepairConfirmationPrompt(event, {
            serviceName: knownAfterTimeSanitization.serviceName,
            proposedRequestedDate: proposedTodayDate.proposedRequestedDate,
            requestedTime: knownAfterTimeSanitization.requestedTime,
            proposedStaffPreference: proposedFrameStaff.proposedStaffPreference
          })
        );
      }
      const proposedService = findProposedFullSetServiceClarification(event, knownAfterTimeSanitization);
      if (proposedService) {
        return buildElicitSlotResponse(
          event,
          "serviceName",
          {
            awaitingServiceConfirmation: "true",
            proposedServiceName: proposedService.proposedServiceName,
            clarificationReason: proposedService.reason,
            asrAlternativesUsed: proposedService.asrAlternativesUsed ? "true" : "false",
            voiceSlotDecisions: JSON.stringify([
              buildProposedVoiceSlotDecision(
                "serviceName",
                proposedService.proposedServiceName,
                proposedService.reason,
                proposedService.matchedTranscript,
                proposedService.asrAlternativesUsed
              )
            ]),
            proposedSlotMutation: JSON.stringify({
              slotName: "serviceName",
              proposedValue: proposedService.proposedServiceName,
              reason: proposedService.reason,
              matchedTranscript: proposedService.matchedTranscript
            }),
            forceHumanEscalation: "false",
            transferToQueue: "false"
          },
          buildProposedServicePrompt(event, knownAfterTimeSanitization)
        );
      }
      const proposedStaff = findProposedAnyStaffClarification(event, knownAfterTimeSanitization);
      if (proposedStaff) {
        return buildElicitSlotResponse(
          event,
          "staffPreference",
          {
            awaitingStaffConfirmation: "true",
            proposedStaffPreference: proposedStaff.proposedStaffPreference,
            staffClarificationReason: proposedStaff.reason,
            clarificationReason: proposedStaff.reason,
            asrAlternativesUsed: proposedStaff.asrAlternativesUsed ? "true" : "false",
            voiceSlotDecisions: JSON.stringify([
              buildProposedVoiceSlotDecision(
                "staffPreference",
                proposedStaff.proposedStaffPreference,
                proposedStaff.reason,
                proposedStaff.matchedTranscript,
                proposedStaff.asrAlternativesUsed
              )
            ]),
            proposedSlotMutation: JSON.stringify({
              slotName: "staffPreference",
              proposedValue: proposedStaff.proposedStaffPreference,
              reason: proposedStaff.reason,
              matchedTranscript: proposedStaff.matchedTranscript
            }),
            forceHumanEscalation: "false",
            transferToQueue: "false"
          },
          buildAmbiguousStaffConfirmationPrompt(event)
        );
      }
      if (
        isAmbiguousFirstAvailableStaffCandidate(event.inputTranscript, event.sessionState?.sessionAttributes || {})
      ) {
        return buildElicitSlotResponse(
          event,
          "staffPreference",
          {
            awaitingStaffConfirmation: "true",
            proposedStaffPreference: "Any staff",
            staffClarificationReason: "ambiguous_first_available_asr",
            clarificationReason: "ambiguous_first_available_asr",
            voiceSlotDecisions: JSON.stringify([
              buildProposedVoiceSlotDecision(
                "staffPreference",
                "Any staff",
                "ambiguous_first_available_asr",
                event.inputTranscript,
                false
              )
            ]),
            proposedSlotMutation: JSON.stringify({
              slotName: "staffPreference",
              proposedValue: "Any staff",
              reason: "ambiguous_first_available_asr"
            }),
            forceHumanEscalation: "false",
            transferToQueue: "false"
          },
          buildAmbiguousStaffConfirmationPrompt(event)
        );
      }
    }

    if (
      !shouldEscalate &&
      sessionAttributes.awaitingNoInputHumanConfirmation === "true" &&
      isAffirmativeUtterance(event.inputTranscript)
    ) {
      return buildLexResponse(
        event,
        OPERATOR_TRANSFER_PROMPT,
        "Fulfilled",
        buildForceHumanEscalationAttributes("caller_confirmed_human_after_no_input", {
          awaitingNoInputHumanConfirmation: "false"
        }),
        {
          dialogAction: {
            type: "Close"
          },
          messageContentType: "PlainText"
        }
      );
    }

    if (
      !shouldEscalate &&
      sessionAttributes.awaitingNoInputHumanConfirmation === "true" &&
      isNegativeUtterance(event.inputTranscript)
    ) {
      return buildElicitSlotResponse(
        event,
        getBookingSlotToElicit(event) || "serviceName",
        {
          awaitingNoInputHumanConfirmation: "false",
          noInputCount: "0"
        }
      );
    }

    if (
      !shouldEscalate &&
      sessionAttributes.awaitingExistingAppointmentHumanConfirmation === "true" &&
      isAffirmativeUtterance(event.inputTranscript)
    ) {
      return buildLexResponse(
        event,
        OPERATOR_TRANSFER_PROMPT,
        "Fulfilled",
        buildForceHumanEscalationAttributes("caller_confirmed_existing_appointment_handoff", {
          awaitingExistingAppointmentHumanConfirmation: "false"
        }),
        {
          dialogAction: {
            type: "Close"
          },
          messageContentType: "PlainText"
        }
      );
    }

	    if (
	      !shouldEscalate &&
	      sessionAttributes.awaitingExistingAppointmentHumanConfirmation === "true" &&
	      isNegativeUtterance(event.inputTranscript)
	    ) {
      return buildLexResponse(
        event,
        "No problem. How can I help you today?",
        "InProgress",
        {
          awaitingExistingAppointmentHumanConfirmation: "false",
          forceHumanEscalation: "false",
          transferToQueue: "false"
        },
        {
          dialogAction: {
            type: "ElicitIntent"
          },
          messageContentType: "PlainText"
        }
	      );
	    }

	    if (
	      !shouldEscalate &&
	      isFinalBookingConfirmationActive(event) &&
	      finalConfirmationOutcome === FINAL_CONFIRMATION_OUTCOME.AFFIRMED
	    ) {
	      const confirmedEvent = {
	        ...event,
	        sessionState: {
	          ...(event.sessionState || {}),
	          sessionAttributes: {
	            ...(event.sessionState?.sessionAttributes || {}),
	            awaitingFinalBookingConfirmation: "false",
	            bookingConfirmationAsked: "false"
	          },
	          intent: {
	            ...(event.sessionState?.intent || {}),
	            confirmationState: "Confirmed",
	            state: "ReadyForFulfillment"
	          }
	        }
	      };
		      const result = await postInternalAppointment(
		        buildInternalPayload(confirmedEvent, "BookAppointmentIntent", {
		          awaitingFinalBookingConfirmation: "false",
		          bookingConfirmationAsked: "false"
	        }),
	        {
	          operationName: "booking_final_confirmation",
	          waitPrompt: `${WAIT_PROMPTS.availability_lookup} ${WAIT_PROMPTS.appointment_creation}`,
	          mechanism: "Lambda final confirmation DialogCodeHook"
	        }
	      );
	      if (!result.ok) {
	        console.error("Appointment API rejected final confirmation", result.code);
	        return buildBackendFailureElicitResponse(confirmedEvent, result);
	      }
	      const data = extractResultPayload(result);
	      return buildLexResponse(
	        confirmedEvent,
	        data.lexResponse?.message || "Your appointment is booked.",
	        data.lexResponse?.fulfillmentState || "Fulfilled",
	        buildSessionAttributesFromResult(data),
	        data.lexResponse
	      );
	    }

		    if (
		      !shouldEscalate &&
		      isFinalBookingConfirmationActive(event) &&
		      finalConfirmationOutcome === FINAL_CONFIRMATION_OUTCOME.DENIED
		    ) {
	      const deniedEvent = {
	        ...event,
	        sessionState: {
	          ...(event.sessionState || {}),
	          sessionAttributes: {
	            ...(event.sessionState?.sessionAttributes || {}),
	            awaitingFinalBookingConfirmation: "false",
	            bookingConfirmationAsked: "false"
	          },
	          intent: {
	            ...(event.sessionState?.intent || {}),
	            confirmationState: "Denied",
	            state: "InProgress"
	          }
	        }
	      };
		      const result = await postInternalAppointment(
		        buildInternalPayload(deniedEvent, "BookAppointmentIntent", {
		          awaitingFinalBookingConfirmation: "false",
		          bookingConfirmationAsked: "false"
	        }),
	        {
	          operationName: "booking_final_confirmation_denied",
	          waitPrompt: WAIT_PROMPTS.availability_lookup,
	          mechanism: "Lambda final confirmation denial DialogCodeHook"
	        }
	      );
	      if (!result.ok) {
	        console.error("Appointment API rejected final confirmation denial", result.code);
	        return buildBackendFailureElicitResponse(deniedEvent, result);
	      }
	      const data = extractResultPayload(result);
	      return buildLexResponse(
	        deniedEvent,
	        data.lexResponse?.message || "No problem. Which detail would you like to change?",
	        data.lexResponse?.fulfillmentState || "InProgress",
	        buildSessionAttributesFromResult(data),
	        data.lexResponse
	      );
	    }

		    if (
		      !shouldEscalate &&
		      isFinalBookingConfirmationActive(event) &&
		      finalConfirmationOutcome === FINAL_CONFIRMATION_OUTCOME.CHANGE_REQUEST
		    ) {
	      const changeEvent = {
	        ...event,
	        sessionState: {
	          ...(event.sessionState || {}),
	          sessionAttributes: {
	            ...(event.sessionState?.sessionAttributes || {}),
	            awaitingFinalBookingConfirmation: "false",
	            bookingConfirmationAsked: "false"
	          },
	          intent: {
	            ...(event.sessionState?.intent || {}),
	            confirmationState: "None",
	            state: "InProgress"
	          }
	        }
	      };
		      const result = await postInternalAppointment(
		        buildInternalPayload(changeEvent, "BookAppointmentIntent", {
		          awaitingFinalBookingConfirmation: "false",
		          bookingConfirmationAsked: "false",
	          finalConfirmationChangeRequest: "true"
	        }),
	        {
	          operationName: "booking_final_confirmation_change_request",
	          waitPrompt: WAIT_PROMPTS.availability_lookup,
	          mechanism: "Lambda final confirmation change request DialogCodeHook"
	        }
	      );
	      if (!result.ok) {
	        console.error("Appointment API rejected final confirmation change request", result.code);
	        return buildBackendFailureElicitResponse(changeEvent, result);
	      }
	      const data = extractResultPayload(result);
	      return buildLexResponse(
	        changeEvent,
	        data.lexResponse?.message || "No problem. Let me update that.",
	        data.lexResponse?.fulfillmentState || "InProgress",
	        buildSessionAttributesFromResult(data),
	        data.lexResponse
		      );
		    }

	    if (
	      !shouldEscalate &&
	      isFinalBookingConfirmationActive(event) &&
	      finalConfirmationOutcome === FINAL_CONFIRMATION_OUTCOME.UNKNOWN &&
	      isNoInputEvent(event)
	    ) {
	      return buildLexResponse(
	        event,
	        "Please say yes to confirm, or tell me what you would like to change.",
	        "InProgress",
	        {
	          awaitingFinalBookingConfirmation: "true",
	          bookingConfirmationAsked: "true",
	          lastAskedSlot: "bookingConfirmation",
	          forceHumanEscalation: "false",
	          transferToQueue: "false"
	        },
	        {
	          dialogAction: {
	            type: "ElicitSlot",
	            slotToElicit: "bookingConfirmation"
	          },
	          messageContentType: "PlainText"
	        }
	      );
	    }

		    if (event.invocationSource === "DialogCodeHook" && !shouldEscalate && isNoInputEvent(event)) {
	      const slotToElicit = getBookingSlotToElicit(event);
      const noInputCount = parseAttemptCount(sessionAttributes.noInputCount) + 1;
      if (
        slotToElicit === "customerName" &&
        noInputCount >= 2 &&
        !hasTrustedCustomerName(event)
      ) {
        return await continueWithTemporaryCustomerName(event, intentName, {
          ...analysis,
          ignoredNoiseFields: ["customerName"]
        });
      }
      if (slotToElicit) {
        return buildNoInputResponse(event, slotToElicit);
      }
    }

    if (!shouldEscalate && shouldPromptForServiceFallback(event, intentName)) {
      return await buildDynamicServiceElicitResponse(event, intentName || "BookAppointmentIntent");
    }

    if (!shouldEscalate && intentName === "BookAppointmentIntent") {
      event = await applyKnownCallerLookupBeforePrompt(event, intentName);
      const staffDtmfSelection = readScopedStaffDtmfSelection(event);
      if (staffDtmfSelection?.invalid) {
        return buildInvalidStaffDtmfResponse(event);
      }
      const slotToElicit = getBookingSlotToElicit(event);
      if (slotToElicit) {
        if (slotToElicit === "customerName") {
          const lookupResponse = await buildKnownCallerLookupResponse(event, intentName);
          if (lookupResponse) {
            return lookupResponse;
          }
        }
        if (slotToElicit === "staffPreference") {
          return await buildDynamicStaffElicitResponse(event, intentName);
        }
        if (slotToElicit === "serviceName" && shouldRequestDynamicServiceMenu(event)) {
          return await buildDynamicServiceElicitResponse(event, intentName);
        }
        const response = buildElicitSlotResponse(event, slotToElicit);
        const rawDtmfTurn =
          event.inputMode === "DTMF" || /^\s*\d\s*$/.test(String(event.inputTranscript || ""));
        if (analysis.dtmfRouting?.accepted && rawDtmfTurn) {
          await postInternalAppointment(buildInternalPayload(event, intentName), {
            operationName: "booking_turn_logging",
            waitPrompt: WAIT_PROMPTS.availability_lookup,
            mechanism: "Lambda local accepted DTMF reprompt"
          });
        }
        return response;
      }
    }

    if (event.invocationSource === "DialogCodeHook" && !shouldEscalate) {
      const intentState = event.sessionState?.intent?.state || "";
      const confirmationState = event.sessionState?.intent?.confirmationState || "";
      const bookingReadyForFulfillment =
        intentName === "BookAppointmentIntent" &&
        (intentState === "ReadyForFulfillment" || confirmationState === "Confirmed");
      if (intentName !== "BookAppointmentIntent" || bookingReadyForFulfillment) {
        return buildDelegateResponse(event);
      }
    }

    if (event.invocationSource === "DialogCodeHook" && !shouldEscalate) {
      const slotToElicit = getBookingSlotToElicit(event);
      if (slotToElicit) {
        return buildDelegateResponse(event);
      }
    }

    if (shouldEscalate) {
      const result = await postInternalAppointment(
        buildInternalPayload(event, intentName, escalationAttributes),
        {
          operationName: "operator_escalation",
          waitPrompt: WAIT_PROMPTS.operator_escalation,
          mechanism: "Lex fulfillment update / Connect transfer prompt"
        }
      );
      if (!result.ok) {
        console.error("Appointment API rejected escalation request", result.code);
        return buildBackendFailureEscalationResponse(event, result);
      }
      const data = extractResultPayload(result);
      return buildLexResponse(
        event,
        data.lexResponse?.message || OPERATOR_TRANSFER_PROMPT,
        data.lexResponse?.fulfillmentState || "Fulfilled",
        buildSessionAttributesFromResult(data),
        data.lexResponse
      );
    }

    if (intentName === "CancelAppointmentIntent") {
      const result = await postInternalAppointment(buildInternalPayload(event, intentName), {
        operationName: "appointment_cancel_lookup",
        waitPrompt: WAIT_PROMPTS.appointment_update,
        mechanism: "Lex fulfillment update"
      });
      if (!result.ok) {
        console.error("Appointment API rejected cancel request", result.code);
        return buildBackendFailureElicitResponse(event, result);
      }
      const data = extractResultPayload(result);
      return buildLexResponse(
        event,
        data.lexResponse?.message ||
          OPERATOR_TRANSFER_PROMPT,
        data.lexResponse?.fulfillmentState || "Fulfilled",
        buildSessionAttributesFromResult(data),
        data.lexResponse
      );
    }

    if (intentName === "RescheduleAppointmentIntent") {
      const result = await postInternalAppointment(buildInternalPayload(event, intentName), {
        operationName: "appointment_reschedule_lookup",
        waitPrompt: WAIT_PROMPTS.appointment_update,
        mechanism: "Lex fulfillment update"
      });
      if (!result.ok) {
        console.error("Appointment API rejected reschedule request", result.code);
        return buildBackendFailureElicitResponse(event, result);
      }
      const data = extractResultPayload(result);
      return buildLexResponse(
        event,
        data.lexResponse?.message ||
          OPERATOR_TRANSFER_PROMPT,
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

    const result = await postInternalAppointment(buildInternalPayload(event, intentName), {
      operationName: "booking_fulfillment_availability_and_creation",
      waitPrompt: `${WAIT_PROMPTS.availability_lookup} ${WAIT_PROMPTS.appointment_creation}`,
      mechanism: "Lex fulfillment update"
    });

    if (!result.ok) {
      console.error("Appointment API rejected request", result.code);
      return buildBackendFailureElicitResponse(event, result);
    }

    const data = extractResultPayload(result);
    if (
      data.outcome === "HUMAN_ESCALATION" ||
      (data.outcome !== "BOOKED" && data.lexResponse?.sessionAttributes?.transferToQueue === "true")
    ) {
      if (!shouldEscalate) {
        return buildBackendFailureElicitResponse(event, {
          code: data.lexResponse?.sessionAttributes?.escalationReason || "backend_error"
        });
      }
      return buildLexResponse(
        event,
        data.lexResponse?.message ||
          OPERATOR_TRANSFER_PROMPT,
        data.lexResponse?.fulfillmentState || "Fulfilled",
        buildSessionAttributesFromResult(data),
        data.lexResponse
      );
    }

    if (data.outcome === "FAILED") {
      return buildBackendFailureElicitResponse(event, {
        code: data.lexResponse?.sessionAttributes?.escalationReason || "backend_error"
      });
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
        : '<speak>Please wait a moment while I check our services. <break time="300ms"/> I&apos;m having trouble checking that right now. You can press 0 to speak with an operator, or I can take a callback request.</speak>');

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
    if (!shouldTransferToHuman(event, caughtIntentName).transfer) {
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
      `<speak>Something went wrong while creating the appointment. <break time="300ms"/> ${OPERATOR_TRANSFER_PROMPT}</speak>`,
      "Failed",
      buildForceHumanEscalationAttributes("backend_error")
    );
  }
}

export const handler = async (event) => {
  const eventWithTiming = {
    ...event,
    lambdaReceivedAt: event?.lambdaReceivedAt || new Date().toISOString()
  };
  if (isOperatorQueueOutcomeEvent(eventWithTiming)) {
    return handleOperatorQueueOutcomeEvent(eventWithTiming);
  }
  const analysis = analyzeLexTurnSanitization(eventWithTiming);
  const sanitizedEvent = sanitizeLexEvent(eventWithTiming, analysis);
  const response = await handleLexEvent(sanitizedEvent, analysis);
  const responseAttributes = response?.sessionState?.sessionAttributes;
  if (responseAttributes) {
    const lexResponseDiagnostics = validateLexResponseForDiagnostics(response);
    responseAttributes.lambdaResponseFingerprint = fingerprintLexResponse(response);
    responseAttributes.playbackEvidenceStage = "LAMBDA_RESPONSE_ONLY";
    responseAttributes.promptPlaybackConfirmed = "false";
    responseAttributes.lexResponseSchemaValid = String(lexResponseDiagnostics.valid);
    responseAttributes.lexResponseMessageContentType = lexResponseDiagnostics.messageContentType;
    responseAttributes.lexResponseSsmlValid = String(lexResponseDiagnostics.ssmlValidation.valid);
    if (response?.sessionState?.dialogAction?.type !== "Close" && responseAttributes.conversationComplete !== "true") {
      responseAttributes.conversationState = "CONTINUE";
      responseAttributes.conversationOutcome = responseAttributes.conversationOutcome || "NEEDS_INPUT";
      responseAttributes.conversationComplete = "false";
    }
    responseAttributes.lambdaRespondedAt = new Date().toISOString();
    const started = Date.parse(eventWithTiming.lambdaReceivedAt);
    if (Number.isFinite(started)) {
      responseAttributes.lambdaProcessingMs = String(Math.max(0, Date.now() - started));
    }
  }
  logStructuredLexTurn(eventWithTiming, response, analysis);
  return response;
};
