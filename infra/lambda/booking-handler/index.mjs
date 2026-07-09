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
    : 2800;

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
  "eddie here",
  "pedic care",
  "pedi care",
  "pedicure appointment",
  "toe service",
  "foot service",
  "foot pedicure",
  "toe pedicure"
];

const DEMO_SERVICE_NAMES = [
  "Manicure",
  "Pedicure",
  "Gel Manicure",
  "Full Set",
  "Dip Powder",
  "Other Services"
];
const SERVICE_DTMF_OPTIONS = {
  "1": "Pedicure",
  "2": "Manicure",
  "3": "Gel Manicure",
  "4": "Full Set",
  "5": "Dip Powder"
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
const STAFF_ALIAS_GROUPS = {
  Trang: ["trang", "chang", "train", "trangg"],
  Amy: ["amy", "amie", "a me"],
  Kelly: ["kelly", "kelley", "keli", "ke li"]
};
const ANY_STAFF_ALIASES = [
  "anyone",
  "anybody",
  "any body",
  "any staff",
  "no preference",
  "whoever is available",
  "first available"
];
const SERVICE_DTMF_PROMPT =
  "Hi, thanks for calling. I can help book your appointment. What service would you like today? You can press 0 for a real person.";
const SERVICE_KEYPAD_PROMPT =
  "I didn't catch the service. You can say Pedicure, Manicure, Gel Manicure, Full Set, Dip Powder, or Other Services. You can also press 1 through 5, or press 0 for an operator.";
const SERVICE_DTMF_SHORT_PROMPT =
  "You can say Pedicure, Manicure, Gel Manicure, Full Set, Dip Powder, or Other Services. You can also press 1 through 5, or press 0 for an operator.";
const STAFF_DTMF_PROMPT =
  "Which staff would you like? You can say Trang, Amy, Kelly, or first available. Press 0 for an operator.";
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
  operator_escalation: "Please wait while I connect you."
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
    "phone set",
    "full said",
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
    SERVICE_KEYPAD_PROMPT,
    SERVICE_KEYPAD_PROMPT
  ],
  staffPreference: [
    STAFF_DTMF_PROMPT,
    STAFF_DTMF_PROMPT,
    STAFF_DTMF_PROMPT
  ],
  requestedDate: [
    "What day would you like to come in? Press 0 to speak with an operator.",
    "Could you repeat the appointment date? Press 0 to speak with an operator.",
    "Do you want that today, tomorrow, or another day? Press 0 to speak with an operator."
  ],
  requestedTime: [
    "What time would you like? Press 0 to speak with an operator.",
    "Could you repeat the appointment time? Press 0 to speak with an operator.",
    "What time works best for you? Press 0 to speak with an operator."
  ],
  customerName: [
    "What name should I put the appointment under? Press 0 to speak with an operator.",
    "Could you say your name for the booking? Press 0 to speak with an operator.",
    "What is your name? Press 0 to speak with an operator."
  ],
  customerPhone: [
    "What phone number should I use for the appointment? Press 0 to speak with an operator.",
    "Could you repeat your phone number? Press 0 to speak with an operator.",
    "What is the best phone number for you? Press 0 to speak with an operator."
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

function extractStaffFromTranscript(text, sessionAttributes = {}) {
  const normalizedText = normalizeForMatch(text);
  if (!normalizedText) {
    return "";
  }
  if (ANY_STAFF_ALIASES.some((alias) => normalizedText.includes(normalizeForMatch(alias)))) {
    return "Any staff";
  }
  for (const [staffName, aliases] of Object.entries(STAFF_ALIAS_GROUPS)) {
    if (aliases.some((alias) => normalizedText.includes(normalizeForMatch(alias)))) {
      return staffName;
    }
  }
  const dynamicStaffNames = Object.values(getStaffDtmfOptions(sessionAttributes))
    .filter((name) => normalizeForMatch(name) !== "any staff");
  return dynamicStaffNames.find((staffName) => {
    const fullName = normalizeForMatch(staffName);
    const firstName = normalizeForMatch(staffName.split(/\s+/)[0]);
    return normalizedText.includes(fullName) || normalizedText.includes(firstName);
  }) || "";
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

function getCurrentTurnTranscript(event) {
  return String(event.inputTranscript || "").trim();
}

function isBareDigitUtterance(value) {
  const normalized = normalizeForMatch(value).replace(/^(?:press|number) /, "");
  return /^(?:[0-9]|zero|one|two|three|four|five|six|seven|eight|nine)$/.test(normalized);
}

function hasCurrentTurnTimePhrase(transcript) {
  const raw = String(transcript || "");
  if (!raw.trim()) {
    return false;
  }
  if (isBareDigitUtterance(raw)) {
    return false;
  }
  return Boolean(normalizeTimePhrase(extractTimeCandidate(raw)));
}

function hasCurrentTurnDatePhrase(transcript) {
  const raw = String(transcript || "");
  return Boolean(getPreferredDateCandidate(raw));
}

function isInvalidCustomerNameNoise(value) {
  const normalized = normalizeForMatch(value);
  return Boolean(normalized && CUSTOMER_NAME_NOISE.has(normalized));
}

function isAcceptableCustomerName(value) {
  const raw = String(value || "").trim();
  const normalized = normalizeForMatch(raw);
  if (!raw || isInvalidCustomerNameNoise(raw) || readDtmfDigit(raw)) {
    return false;
  }
  if (!/^[a-z][a-z' -]{0,80}$/i.test(raw) || normalized.split(" ").length > 4) {
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

function slotValueIsGroundedInCurrentTranscript(fieldName, slotValue, transcript, timeZone = DEFAULT_SALON_TIMEZONE) {
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
  const currentDetails = extractBookingDetailsFromText(raw, timeZone);
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
    const staff = extractStaffFromTranscript(raw);
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

function getActiveDtmfOptions(sessionAttributes = {}, activeDtmfMenu = sessionAttributes.activeDtmfMenu) {
  const activeOptions = parseDtmfOptionsJson(sessionAttributes.activeDtmfOptionsJson);
  if (Object.keys(activeOptions).length) {
    return activeOptions;
  }
  if (activeDtmfMenu === "service") {
    return SERVICE_DTMF_OPTIONS;
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

function buildDtmfRouting(event) {
  const previous = event.sessionState?.sessionAttributes || {};
  const digit = readCurrentTurnDigit(event);
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
    menuMismatch: Boolean(
      activeDtmfMenuBefore &&
        ((activeDtmfMenuBefore === "service" && lastAskedSlotBefore !== "serviceName") ||
          (activeDtmfMenuBefore === "staff" && lastAskedSlotBefore !== "staffPreference"))
    )
  };
  if (!digit) {
    return base;
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
  if (lastAskedSlotBefore === "serviceName") {
    return routeByMenu("service");
  }
  if (lastAskedSlotBefore === "staffPreference") {
    return routeByMenu("staff");
  }
  if (!lastAskedSlotBefore) {
    return routeByMenu("service");
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
  if (ANY_STAFF_ALIASES.some((alias) => normalized === normalizeForMatch(alias))) {
    return true;
  }
  if (normalizeForMatch(value) === "any staff") {
    return true;
  }
  for (const aliases of Object.values(STAFF_ALIAS_GROUPS)) {
    if (aliases.some((alias) => normalized === normalizeForMatch(alias))) {
      return true;
    }
  }
  return Object.values(getStaffDtmfOptions(sessionAttributes)).some((staffName) => {
    const fullName = normalizeForMatch(staffName);
    const firstName = normalizeForMatch(String(staffName).split(/\s+/)[0]);
    return normalized === fullName || normalized === firstName;
  });
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
  if (isKnownStaffPreference(raw, sessionAttributes)) {
    return false;
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
  return isInvalidStaffPreferenceNoise(value, sessionAttributes) ? "" : value;
}

function getCurrentTurnBookingDetails(event) {
  const previous = event.sessionState?.sessionAttributes || {};
  const timeZone = getAttribute(event, attributeNames.timezone) || DEFAULT_SALON_TIMEZONE;
  const transcript = getTranscriptCandidateValues(event)
    .filter((value) => !readDtmfDigit(value))
    .join(" ");
  return extractBookingDetailsFromText(transcript, timeZone);
}

function currentTurnRecognizedService(event) {
  const slots = event.sessionState?.intent?.slots || {};
  const slotService = normalizeServiceName(getSlotValue(slots, slotNames.serviceName, { preferOriginal: true }));
  const transcriptService = getCurrentTurnBookingDetails(event).serviceName;
  const candidate = normalizeServiceName(slotService || transcriptService);
  return DEMO_SERVICE_NAMES.includes(candidate) ? candidate : "";
}

function analyzeLexTurnSanitization(event) {
  const previous = event.sessionState?.sessionAttributes || {};
  const slots = event.sessionState?.intent?.slots || {};
  const dtmfRouting = buildDtmfRouting(event);
  const scopedServiceDigit =
    dtmfRouting.accepted && dtmfRouting.route === "service_menu"
      ? dtmfRouting.digit
      : getScopedDtmfDigit(event, "serviceName");
  const scopedStaffDigit =
    dtmfRouting.accepted && dtmfRouting.route === "staff_menu"
      ? dtmfRouting.digit
      : getScopedDtmfDigit(event, "staffPreference");
  const scopedDtmfDigit = dtmfRouting.digit || scopedServiceDigit || scopedStaffDigit || "";
  const ignoredPollutedSlots = [];
  const ignoredUngroundedSlots = [];
  const ignoredNoiseFields = [];
  const fieldsToClear = new Set();
  const sanitizedSlots = { ...slots };
  const currentTurnTranscript = getCurrentTurnTranscript(event);
  const timeZone = getAttribute(event, attributeNames.timezone) || DEFAULT_SALON_TIMEZONE;
  const currentTurnDetails = getCurrentTurnBookingDetails(event);
  const recognizedService = currentTurnRecognizedService(event);
  const shouldStrictlyGroundSlots = Boolean(previous.lastAskedSlot);
  let clearedStaleRequestedTime = false;
  let preservedConfirmedService = false;
  let replacementInputTranscript = "";
  let changed = false;

  if (
    scopedServiceDigit &&
    scopedServiceDigit !== "0" &&
    (previous.lastAskedSlot === "serviceName" || dtmfRouting.route === "service_menu")
  ) {
    const serviceSelection = SERVICE_DTMF_OPTIONS[scopedServiceDigit];
    if (serviceSelection) {
      const { name: serviceSlotName } = getSlotObject(slots, slotNames.serviceName);
      sanitizedSlots[serviceSlotName || "serviceName"] = buildLexSlot(serviceSelection);
      replacementInputTranscript = serviceSelection;
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

  if (scopedStaffDigit && scopedStaffDigit !== "0" && dtmfRouting.accepted && dtmfRouting.route === "staff_menu") {
    const { name: staffSlotName } = getSlotObject(slots, slotNames.staffPreference);
    sanitizedSlots[staffSlotName || "staffPreference"] = buildLexSlot(dtmfRouting.selection);
    replacementInputTranscript = dtmfRouting.selection;
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
      timeZone
    );
    const isCurrentAskedSlot = previous.lastAskedSlot === fieldName;
    const isDtmfAcceptedSlot =
      (fieldName === "serviceName" && dtmfRouting.accepted && dtmfRouting.route === "service_menu") ||
      (fieldName === "staffPreference" && dtmfRouting.accepted && dtmfRouting.route === "staff_menu");

    if (
      fieldName === "requestedTime" &&
      !hasCurrentTurnTimePhrase(currentTurnTranscript) &&
      previous.lastAskedSlot !== "requestedTime" &&
      !alreadyTrusted
    ) {
      delete sanitizedSlots[name];
      ignoredUngroundedSlots.push(fieldName);
      changed = true;
      continue;
    }

    if (
      fieldName === "requestedDate" &&
      !hasCurrentTurnDatePhrase(currentTurnTranscript) &&
      !isCurrentAskedSlot &&
      !alreadyTrusted
    ) {
      delete sanitizedSlots[name];
      ignoredUngroundedSlots.push(fieldName);
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

  const { name: staffSlotName, slot: staffSlot } = getSlotObject(slots, slotNames.staffPreference);
  if (
    staffSlot &&
    isInvalidStaffPreferenceNoise(
      getSlotOriginalValue(staffSlot) || getSlotInterpretedValue(staffSlot),
      previous
    )
  ) {
    delete sanitizedSlots[staffSlotName];
    fieldsToClear.add("staffPreference");
    ignoredPollutedSlots.push(staffSlotName);
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

  const previousStaffPreference =
    getSessionAttribute(previous, slotNames.staffPreference) || previous.confirmedStaffName;
  if (isInvalidStaffPreferenceNoise(previousStaffPreference, previous)) {
    fieldsToClear.add("staffPreference");
    ignoredPollutedSlots.push("sessionAttributes.staffPreference");
    changed = true;
  }

  return {
    scopedDtmfDigit,
    currentTurnTranscript,
    dtmfRouting,
    ignoredPollutedSlots: Array.from(new Set(ignoredPollutedSlots)),
    ignoredUngroundedSlots: Array.from(new Set(ignoredUngroundedSlots)),
    ignoredNoiseFields: Array.from(new Set(ignoredNoiseFields)),
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
  const sessionAttributes = {
    ...(event.sessionState?.sessionAttributes || {})
  };
  const serviceSelection = analysis.replacementInputTranscript || "";
  if (serviceSelection && DEMO_SERVICE_NAMES.includes(serviceSelection)) {
    sessionAttributes.serviceName = serviceSelection;
    sessionAttributes.confirmedServiceName = serviceSelection;
    sessionAttributes.scopedServiceDtmfInput = "true";
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
      delete sessionAttributes.confirmedStaffName;
      delete sessionAttributes.staffId;
      delete sessionAttributes.selectedStaffId;
      delete sessionAttributes.confirmedStaffId;
      sessionAttributes.invalidStaffPreferenceIgnored = "true";
    }
  }
  if (analysis.fieldsToClear?.length) {
    sessionAttributes.ignoredPollutedSlotFields = JSON.stringify(analysis.fieldsToClear);
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
    inputTranscript: analysis.replacementInputTranscript || event.inputTranscript,
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
    /(?:my name is|name is|this is|i am|i'm)\s+([a-zA-Z][a-zA-Z'-]*(?:\s+[a-zA-Z][a-zA-Z'-]*){0,4})(?=\s*(?:[,.!?;]|$|and\s+(?:my\s+)?phone|(?:my\s+)?phone\s+(?:number\s+)?(?:is|should|to)))/i
  );
  const name = match?.[1]?.trim() || "";
  return isAcceptableCustomerName(name) ? name : "";
}

function extractBareCustomerNameAnswer(text) {
  const raw = String(text || "").trim();
  const normalized = normalizeForMatch(raw);
  if (
    !raw ||
    readDtmfDigit(raw) ||
    isInvalidCustomerNameNoise(raw) ||
    isExplicitHumanRequestText(raw) ||
    extractServiceFromTranscript(raw) ||
    extractStaffFromTranscript(raw) ||
    getPreferredDateCandidate(raw) ||
    normalizeTimePhrase(extractTimeCandidate(raw)) ||
    /(?:phone|number|appointment|book|service|tomorrow|today|morning|afternoon|evening|night|zero|one|two|three|four|five|six|seven|eight|nine|ten)\b/i.test(raw)
  ) {
    return "";
  }
  if (!/^[a-z][a-z' -]{0,80}$/i.test(raw) || normalized.split(" ").length > 4) {
    return "";
  }
  return raw.replace(/\s+/g, " ");
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
  return /\b(real person|live person|human|operator|representative|talk to a person|talk to someone|speak to someone|speak with someone)\b/.test(
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

function getConfirmedRecognizedService(sessionAttributes = {}) {
  const serviceName = normalizeServiceName(
    sessionAttributes.confirmedServiceName ||
      getSessionAttribute(sessionAttributes, slotNames.serviceName)
  );
  return serviceName && isRecognizedService(serviceName) ? serviceName : "";
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
  if (!isBookingFallbackIntent(intentName) || !isBookingInProgress(event)) {
    return false;
  }
  const transcript = getCurrentTurnTranscript(event);
  return Boolean(
    transcript &&
      (hasCurrentTurnTimePhrase(transcript) ||
        hasCurrentTurnDatePhrase(transcript) ||
        extractCustomerNameFromText(transcript) ||
        extractBareCustomerNameAnswer(transcript) ||
        readCurrentTurnDigit(event) ||
        isBookingLikeUtterance(transcript))
  );
}

function isBookingLikeUtterance(text) {
  return /\b(book|booking|schedule|appointment|service|nail|pedicure|manicure|today|tomorrow)\b/i.test(
    text || ""
  );
}

function shouldPromptForServiceFallback(event, intentName) {
  const previous = event.sessionState?.sessionAttributes || {};
  if (getConfirmedRecognizedService(previous)) {
    return false;
  }
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

function isAffirmativeUtterance(value) {
  return /^(?:yes|yeah|yep|correct|right|sure|ok|okay|please|connect me)$/i.test(
    normalizeForMatch(value)
  );
}

function isNegativeUtterance(value) {
  return /^(?:no|nope|not now|no thanks|do not|dont|don t)$/i.test(normalizeForMatch(value));
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

function getServiceAwareElicitPrompt(event, slotName, attemptCount) {
  const prompt = getElicitPrompt(event, slotName, attemptCount);
  if (slotName !== "staffPreference") {
    return prompt;
  }
  const known = buildKnownBookingSessionAttributes(event);
  const serviceName = normalizeServiceName(known.confirmedServiceName || known.serviceName);
  if (!serviceName || /^got it[, ]/i.test(prompt)) {
    return prompt;
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
  const knownDate =
    getSlotValue(slots, slotNames.requestedDate) ||
    getSessionAttribute(previous, slotNames.requestedDate);
  const previousDate = getSessionAttribute(previous, slotNames.requestedDate);
  const knownTime =
    getSlotValue(slots, slotNames.requestedTime, { preferOriginal: true }) ||
    getSessionAttribute(previous, slotNames.requestedTime);
  const previousTime = getSessionAttribute(previous, slotNames.requestedTime);
  const rawKnownService =
    getSlotValue(slots, slotNames.serviceName, { preferOriginal: true }) ||
    getSessionAttribute(previous, slotNames.serviceName);
  const serviceDtmfSelection = readScopedDtmfSelection(event, "serviceName", SERVICE_DTMF_OPTIONS);
  const staffDtmfSelection = readScopedStaffDtmfSelection(event);
  const recoveryTranscript =
    serviceDtmfSelection || staffDtmfSelection
      ? transcriptValues.filter((value) => !readDtmfDigit(value)).join(" ")
      : transcript;
  const recovered = extractBookingDetailsFromText(recoveryTranscript, timeZone);
  const normalizedKnownService = normalizeServiceName(rawKnownService);
  const knownService =
    normalizedKnownService && !isClearlyInvalidServiceName(normalizedKnownService)
      ? normalizedKnownService
      : "";
  const previousService = normalizeServiceName(
    previous.confirmedServiceName || getSessionAttribute(previous, slotNames.serviceName)
  );
  const stablePreviousService =
    previousService && !isClearlyInvalidServiceName(previousService) ? previousService : "";
  const explicitCustomerName =
    recovered.customerName ||
    (previous.lastAskedSlot === "customerName" ? extractBareCustomerNameAnswer(event.inputTranscript) : "");
  const amazonConnectCustomerPhone = getAttribute(event, attributeNames.customerNumber);
  const protectedCustomerName =
    previous.recognizedCustomerName ||
    (previous.customerNameSource === "phone_lookup" ? previous.customerName : "");
  const previousStaffPreference =
    getSessionAttribute(previous, slotNames.staffPreference) || previous.confirmedStaffName;
  const cleanPreviousStaffPreference = sanitizeStaffPreferenceValue(previousStaffPreference, previous);
  const knownStaffPreference = sanitizeStaffPreferenceValue(
    getKnownField(event, "staffPreference"),
    previous
  );
  const suppressBareDigitRecovery =
    isBareDigitUtterance(event.inputTranscript) && previous.lastAskedSlot !== "requestedTime";
  const known = {
    recognizedCustomerName: previous.recognizedCustomerName,
    customerNameSource:
      previous.customerNameSource === "phone_lookup"
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
    serviceName: serviceDtmfSelection || stablePreviousService || recovered.serviceName || knownService,
    requestedDate:
      recovered.requestedDate ||
      resolveKnownDateValue(previousDate, timeZone) ||
      resolveKnownDateValue(knownDate, timeZone),
    requestedTime:
      (suppressBareDigitRecovery ? "" : recovered.requestedTime) ||
      normalizeTimePhrase(previousTime) ||
      previousTime ||
      normalizeTimePhrase(knownTime) ||
      knownTime,
    staffPreference:
      (staffDtmfSelection && !staffDtmfSelection.invalid ? staffDtmfSelection.staffName : "") ||
      cleanPreviousStaffPreference ||
      extractStaffFromTranscript(transcript, previous) ||
      knownStaffPreference,
    staffId:
      (staffDtmfSelection && !staffDtmfSelection.invalid ? staffDtmfSelection.staffId : "") ||
      previous.staffId ||
      previous.selectedStaffId,
    selectedStaffId:
      (staffDtmfSelection && !staffDtmfSelection.invalid ? staffDtmfSelection.staffId : "") ||
      previous.selectedStaffId ||
      previous.staffId,
    confirmedServiceName:
      serviceDtmfSelection ||
      previous.confirmedServiceName ||
      recovered.serviceName ||
      knownService,
    confirmedStaffName:
      (staffDtmfSelection && !staffDtmfSelection.invalid ? staffDtmfSelection.staffName : "") ||
      previous.confirmedStaffName,
    confirmedStaffId:
      (staffDtmfSelection && !staffDtmfSelection.invalid ? staffDtmfSelection.staffId : "") ||
      previous.confirmedStaffId,
    initialBookingUtterance: initial
  };

  const merged = {
    ...previous,
    ...Object.fromEntries(
      Object.entries(known).filter(([, value]) => value !== undefined && value !== "")
    )
  };
  if (
    staffDtmfSelection &&
    !staffDtmfSelection.invalid &&
    normalizeForMatch(staffDtmfSelection.staffName) === "any staff"
  ) {
    delete merged.staffId;
    delete merged.selectedStaffId;
    delete merged.confirmedStaffId;
  }
  if (isInvalidStaffPreferenceNoise(merged.staffPreference || merged.confirmedStaffName, merged)) {
    delete merged.staffPreference;
    delete merged.confirmedStaffName;
    delete merged.staffId;
    delete merged.selectedStaffId;
    delete merged.confirmedStaffId;
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

  const customerName = getSessionAttribute(sessionAttributes, slotNames.customerName);
  if (!customerName) {
    return "customerName";
  }

  const customerPhone = getSessionAttribute(sessionAttributes, slotNames.customerPhone);
  if (!isValidCustomerPhone(customerPhone)) {
    return "customerPhone";
  }

  const staffPreference = getSessionAttribute(sessionAttributes, slotNames.staffPreference);
  const staffId = sessionAttributes.staffId || sessionAttributes.selectedStaffId;
  if (isInvalidStaffPreferenceNoise(staffPreference, sessionAttributes)) {
    return "staffPreference";
  }
  if (!staffPreference && !staffId && sessionAttributes.invalidStaffPreferenceIgnored === "true") {
    return "staffPreference";
  }
  if (!staffPreference && !staffId && sessionAttributes.lastAskedSlot !== "staffPreference") {
    return "staffPreference";
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

  return {
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
	        content: messageOverride || getServiceAwareElicitPrompt(event, slotName, attemptCount)
	      }
	    ]
	  };
	}

function getNoInputPrompt(slotName, noInputCount, event) {
  if (noInputCount <= 1) {
    return getElicitPrompt(event, slotName, 1);
  }
  if (slotName === "staffPreference") {
    return STAFF_DTMF_SHORT_PROMPT;
  }
  if (slotName === "serviceName") {
    return SERVICE_DTMF_SHORT_PROMPT;
  }
  return getElicitPrompt(event, slotName, 2);
}

function buildNoInputResponse(event, slotName) {
  const previous = event.sessionState?.sessionAttributes || {};
  const noInputCount = parseAttemptCount(previous.noInputCount) + 1;

  if (slotName === "staffPreference" && noInputCount >= 2) {
    const intent = event.sessionState?.intent || {};
    const slots = mergeKnownSlots(event);
    const slotNameToSet =
      slotNames.staffPreference.find((name) => Object.prototype.hasOwnProperty.call(slots, name)) ||
      slotNames.staffPreference[0];
    slots[slotNameToSet] = buildLexSlot("Any staff");
    const sessionAttributes = {
      ...buildKnownBookingSessionAttributes(event),
      staffPreference: "Any staff",
      confirmedStaffName: "Any staff",
      noInputCount: String(noInputCount),
      noInputPrompted: "true",
      staffNoInputFallback: "any_staff"
    };
    delete sessionAttributes.staffId;
    delete sessionAttributes.selectedStaffId;
    delete sessionAttributes.confirmedStaffId;
    return {
      sessionState: {
        sessionAttributes: applyActiveDtmfMenuAttributes(sessionAttributes, ""),
        dialogAction: {
          type: "Delegate"
        },
        intent: {
          ...intent,
          slots
        }
      },
      messages: [
        {
          contentType: "PlainText",
          content: "I'll check any available staff."
        }
      ]
    };
  }

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
    "Please wait while I connect you.",
    "Fulfilled",
    buildForceHumanEscalationAttributes(reason),
    {
      messageContentType: "PlainText"
    }
  );
}

function buildBackendFailureElicitResponse(event, result) {
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
    ? `I already have ${confirmedService}. `
    : "";
  return buildElicitSlotResponse(
    event,
    slotToElicit,
    {
      backendFailureReason: normalizeBackendFailureReason(result?.code),
      forceHumanEscalation: "false",
      transferToQueue: "false"
    },
    `${servicePrefix}${waitPrompt} I'm having trouble checking that right now. You can press 0 to speak with an operator, or I can take a callback request.`
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
  let dialogAction = normalizeDialogAction(lexResponse);
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
  }
  const nextState = dialogAction.type === "Close" ? state : "InProgress";
  const contentType =
    lexResponse.messageContentType || (String(responseMessage || "").trim().startsWith("<speak>") ? "SSML" : "PlainText");
  const mergedSessionAttributes = removeIgnoredPollutedFields({
    ...knownAttributes,
    ...sessionAttributes,
    ...(lexResponse.sessionAttributes || {})
  });
  if (dialogAction.type === "ElicitSlot" && dialogAction.slotToElicit) {
    mergedSessionAttributes.lastAskedSlot = dialogAction.slotToElicit;
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
  const responseSessionAttributes = applyActiveDtmfMenuAttributes(
    mergedSessionAttributes,
    dialogAction.type === "ElicitSlot" ? dialogAction.slotToElicit : ""
  );
  return {
    sessionState: {
      sessionAttributes: responseSessionAttributes,
      dialogAction,
      intent: {
        ...intent,
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
  const customerName = resultAttributes.customerName || resultAttributes.recognizedCustomerName;
  if (!customerName) {
    return null;
  }

  const enrichedEvent = withSessionAttributes(event, {
    ...resultAttributes,
    customerName,
    recognizedCustomerName: resultAttributes.recognizedCustomerName || customerName,
    customerNameSource: resultAttributes.customerNameSource || "phone_lookup"
  });
  const nextSlot = getBookingSlotToElicit(enrichedEvent);
  if (nextSlot) {
    return buildElicitSlotResponse(enrichedEvent, nextSlot);
  }
  return buildDelegateResponse(enrichedEvent);
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

function applyActiveDtmfMenuAttributes(sessionAttributes = {}, slotName = "") {
  const next = { ...sessionAttributes };
  if (slotName === "serviceName") {
    next.activeDtmfMenu = "service";
    next.activeDtmfOptionsJson = JSON.stringify(SERVICE_DTMF_OPTIONS);
  } else if (slotName === "staffPreference") {
    next.activeDtmfMenu = "staff";
    next.activeDtmfOptionsJson = next.staffDtmfOptions || JSON.stringify(STAFF_DTMF_OPTIONS);
  } else {
    delete next.activeDtmfMenu;
    delete next.activeDtmfOptionsJson;
  }
  return next;
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

function getInputMode(event) {
  return event.inputMode || (readDtmfDigit(event.inputTranscript) ? "DTMF" : "Speech");
}

function buildLexTurnDebug(event, analysis = {}) {
  const attributesBefore = event.sessionState?.sessionAttributes || {};
  const slots = event.sessionState?.intent?.slots || {};
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
    slotsOriginalValues: collectSlotOriginalValues(slots),
    slotsInterpretedValues: collectSlotInterpretedValues(slots),
    trustedSlotsBefore: collectTrustedBookingSlots(attributesBefore),
    attributesBefore: redactLogObject(attributesBefore),
    dtmfRouting: analysis.dtmfRouting,
    sanitization: {
      clearedStaleRequestedTime: Boolean(analysis.clearedStaleRequestedTime),
      ignoredPollutedSlots: analysis.ignoredPollutedSlots || [],
      ignoredUngroundedSlots: analysis.ignoredUngroundedSlots || [],
      ignoredNoiseFields: analysis.ignoredNoiseFields || [],
      preservedConfirmedService: Boolean(analysis.preservedConfirmedService)
    }
  };
}

function logStructuredLexTurn(event, response, analysis = {}) {
  const sessionAttributesBefore = event.sessionState?.sessionAttributes || {};
  const sessionAttributesAfter = response?.sessionState?.sessionAttributes || {};
  const slots = event.sessionState?.intent?.slots || {};
  const logPayload = {
    contactId:
      getAttribute(event, attributeNames.contactId) ||
      event.sessionId ||
      sessionAttributesAfter.AmazonConnectContactId,
    currentTurnTranscript: analysis.currentTurnTranscript ?? getCurrentTurnTranscript(event),
    inputTranscript: event.inputTranscript || "",
    inputMode: getInputMode(event),
    lastAskedSlotBefore: sessionAttributesBefore.lastAskedSlot,
    lastAskedSlotAfter: sessionAttributesAfter.lastAskedSlot,
    activeDtmfMenuBefore: sessionAttributesBefore.activeDtmfMenu,
    activeDtmfMenuAfter: sessionAttributesAfter.activeDtmfMenu,
    slotsOriginalValues: collectSlotOriginalValues(slots),
    slotsInterpretedValues: collectSlotInterpretedValues(slots),
    scopedDtmfDigit: analysis.scopedDtmfDigit || "",
    dtmfRouting: analysis.dtmfRouting,
    sanitization: {
      clearedStaleRequestedTime: Boolean(analysis.clearedStaleRequestedTime),
      ignoredPollutedSlots: analysis.ignoredPollutedSlots || [],
      ignoredUngroundedSlots: analysis.ignoredUngroundedSlots || [],
      ignoredNoiseFields: analysis.ignoredNoiseFields || [],
      preservedConfirmedService: Boolean(analysis.preservedConfirmedService)
    },
    trustedSlotsBefore: collectTrustedBookingSlots(sessionAttributesBefore),
    trustedSlotsAfter: collectTrustedBookingSlots(sessionAttributesAfter),
    sessionAttributesBefore: redactLogObject(sessionAttributesBefore),
    sessionAttributesAfter: redactLogObject(sessionAttributesAfter),
    slotToElicit: response?.sessionState?.dialogAction?.slotToElicit,
    message: response?.messages?.[0]?.content
  };
  console.info(JSON.stringify(logPayload));
}

function buildWrongSlotDtmfPrompt(event, slotName) {
  const known = buildKnownBookingSessionAttributes(event);
  const confirmedService = normalizeServiceName(known.confirmedServiceName || known.serviceName);
  if (slotName === "requestedDate") {
    return confirmedService
      ? `I already have ${confirmedService}. What day would you like?`
      : "What day would you like?";
  }
  if (slotName === "requestedTime") {
    return confirmedService
      ? `I already have ${confirmedService}. What time would you like?`
      : "What time would you like?";
  }
  if (slotName === "customerName") {
    return "What name should I put on the appointment?";
  }
  if (slotName === "customerPhone") {
    return "What phone number should I use for the appointment?";
  }
  return getElicitPrompt(event, slotName || getBookingSlotToElicit(event) || "requestedDate", 1);
}

async function handleLexEvent(event, analysis = {}) {
  try {
    const rawIntentName = event.sessionState?.intent?.name || "";
    const intentName = shouldTreatFallbackAsBooking(event, rawIntentName)
      ? "BookAppointmentIntent"
      : rawIntentName;
    const transferDecision = shouldTransferToHuman(event, intentName);
    const shouldEscalate = transferDecision.transfer;
    const sessionAttributes = event.sessionState?.sessionAttributes || {};
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
      return buildElicitSlotResponse(
        event,
        "customerName",
        {
          ignoredNoiseFields: JSON.stringify(analysis.ignoredNoiseFields)
        },
        "What name should I put on the appointment?"
      );
    }

    if (
      !shouldEscalate &&
      analysis.dtmfRouting?.digit &&
      !analysis.dtmfRouting.accepted &&
      ["wrong_slot", "no_active_menu"].includes(analysis.dtmfRouting.route) &&
      analysis.dtmfRouting.nextSlot
    ) {
      return buildElicitSlotResponse(
        event,
        analysis.dtmfRouting.nextSlot,
        {
          dtmfRouting: JSON.stringify(analysis.dtmfRouting)
        },
        buildWrongSlotDtmfPrompt(event, analysis.dtmfRouting.nextSlot)
      );
    }

    if (
      !shouldEscalate &&
      sessionAttributes.awaitingNoInputHumanConfirmation === "true" &&
      isAffirmativeUtterance(event.inputTranscript)
    ) {
      return buildLexResponse(
        event,
        "Please wait while I connect you.",
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
        "Please wait while I connect you.",
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

    if (event.invocationSource === "DialogCodeHook" && !shouldEscalate && isNoInputEvent(event)) {
      const slotToElicit = getBookingSlotToElicit(event);
      if (slotToElicit) {
        return buildNoInputResponse(event, slotToElicit);
      }
    }

    if (!shouldEscalate && shouldPromptForServiceFallback(event, intentName)) {
      return buildBookServiceElicitResponse(event);
    }

    if (!shouldEscalate && intentName === "BookAppointmentIntent") {
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
          if (event.invocationSource === "DialogCodeHook" && sessionAttributes.lastAskedSlot !== "staffPreference") {
            return buildDelegateResponse(event);
          }
          return await buildDynamicStaffElicitResponse(event, intentName);
        }
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
        data.lexResponse?.message || "Please wait while I connect you.",
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
          "Please wait while I connect you.",
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
          "Please wait while I connect you.",
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
      '<speak>Something went wrong while creating the appointment. <break time="300ms"/> Please wait while I connect you.</speak>',
      "Failed",
      buildForceHumanEscalationAttributes("backend_error")
    );
  }
}

export const handler = async (event) => {
  const analysis = analyzeLexTurnSanitization(event);
  const sanitizedEvent = sanitizeLexEvent(event, analysis);
  const response = await handleLexEvent(sanitizedEvent, analysis);
  logStructuredLexTurn(event, response, analysis);
  return response;
};
