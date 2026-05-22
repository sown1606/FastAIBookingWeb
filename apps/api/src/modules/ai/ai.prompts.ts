interface BuildBookingPromptInput {
  text: string;
  salonTimezone: string;
  serviceNames: string[];
  staffNames: string[];
}

const JSON_SCHEMA_DESCRIPTION = `
Return ONLY valid JSON using this exact shape:
{
  "intentType": "BOOK_APPOINTMENT|RESCHEDULE_APPOINTMENT|CANCEL_APPOINTMENT|LIVE_PERSON_REQUEST|GENERAL_INQUIRY|UNKNOWN",
  "customer": {
    "name": "string optional",
    "phone": "string optional"
  },
  "requestedService": "string optional",
  "requestedStaff": "string optional",
  "requestedDateTime": "string optional",
  "notes": "string optional",
  "confidence": 0.0,
  "isReadyToBook": true,
  "missingFields": ["string"],
  "normalizedBookingRequest": {
    "customerName": "string optional",
    "customerPhone": "string optional",
    "serviceName": "string optional",
    "staffName": "string optional",
    "startTimeIso": "ISO-8601 string with timezone offset optional",
    "timezone": "IANA timezone optional",
    "notes": "string optional"
  }
}
`;

export const buildBookingIntentPrompt = (input: BuildBookingPromptInput): string => {
  const services = input.serviceNames.length ? input.serviceNames.join(", ") : "No configured services";
  const staff = input.staffNames.length ? input.staffNames.join(", ") : "No configured staff";

  return `
You are an appointment-intent parser for a salon booking backend.
Parse the user message into structured booking intent.
Do not invent unavailable services or staff.
Only set requestedStaff or normalizedBookingRequest.staffName when the caller explicitly asked for a staff member from the configured staff list.
If the caller did not ask for a staff member, or said any staff, anyone, or whoever is available, leave staff fields empty.
Never use numeric codes, random IDs, phone numbers, or unconfigured names as staff names.
If the caller asks for a real person, an operator, or a live agent, use LIVE_PERSON_REQUEST.
If datetime is ambiguous, keep "isReadyToBook" false and add missing fields.
Prefer extracting an ISO datetime with timezone in "normalizedBookingRequest.startTimeIso".
Interpret relative dates such as "today", "tomorrow", and weekdays in the salon timezone.
Treat spoken times such as "five pm" as 5 PM local salon time, not server time.
Map common speech-recognition mistakes to the closest configured service when clear, for example bettercure -> pedicure, many cure -> manicure, gel many cure -> gel manicure, acrilic -> acrylic, and deep powder -> dip powder.
If the service is uncertain, keep the heard service text and let the backend ask for confirmation.

Salon timezone: ${input.salonTimezone}
Available services: ${services}
Available staff: ${staff}

${JSON_SCHEMA_DESCRIPTION}

User message:
"""${input.text}"""
`;
};
