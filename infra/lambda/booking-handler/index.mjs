const API_BASE_URL = process.env.FASTAIBOOKING_API_BASE_URL;
const INTERNAL_TOKEN = process.env.FASTAIBOOKING_API_INTERNAL_TOKEN;
const DEFAULT_SALON_ID = process.env.DEFAULT_SALON_ID;

const slotNames = {
  customerName: ["customerName", "CustomerName"],
  customerPhone: ["customerPhone", "CustomerPhone"],
  serviceName: ["serviceName", "ServiceName"],
  requestedDate: ["requestedDate", "RequestedDate"],
  requestedTime: ["requestedTime", "RequestedTime"],
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
  salonId: ["salonId", "SalonId"]
};

function getSlotValue(slots, names) {
  for (const name of names) {
    const slot = slots?.[name];
    const value = slot?.value?.interpretedValue || slot?.value?.originalValue;
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

function buildLexResponse(event, message, state = "Fulfilled") {
  const intent = event.sessionState?.intent || {};
  return {
    sessionState: {
      sessionAttributes: event.sessionState?.sessionAttributes || {},
      dialogAction: {
        type: "Close"
      },
      intent: {
        ...intent,
        state
      }
    },
    messages: [
      {
        contentType: "PlainText",
        content: message
      }
    ]
  };
}

async function createAppointment(payload) {
  if (!API_BASE_URL || !INTERNAL_TOKEN) {
    return {
      ok: false,
      message: "The booking system is not fully configured yet."
    };
  }

  const response = await fetch(`${API_BASE_URL}/api/v1/ai/appointments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${INTERNAL_TOKEN}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      ok: false,
      message: text || "I could not create the appointment right now."
    };
  }

  return {
    ok: true,
    data: await response.json()
  };
}

function buildAppointmentPayload(event) {
  const slots = event.sessionState?.intent?.slots || {};
  const calledNumber = getAttribute(event, attributeNames.calledNumber);
  const amazonConnectContactId =
    getAttribute(event, attributeNames.contactId) || event.sessionId || undefined;
  const amazonConnectPhoneNumber = calledNumber || undefined;
  const customerPhone =
    getSlotValue(slots, slotNames.customerPhone) ||
    getAttribute(event, attributeNames.customerNumber);

  const payload = {
    customerName: getSlotValue(slots, slotNames.customerName),
    customerPhone,
    serviceName: getSlotValue(slots, slotNames.serviceName),
    requestedDate: getSlotValue(slots, slotNames.requestedDate),
    requestedTime: getSlotValue(slots, slotNames.requestedTime),
    staffPreference: getSlotValue(slots, slotNames.staffPreference),
    source: "amazon_connect_ai",
    amazonConnectContactId,
    amazonConnectPhoneNumber,
    calledNumber: calledNumber || undefined
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

export const handler = async (event) => {
  try {
    const intentName = event.sessionState?.intent?.name || "";

    if (intentName === "HumanEscalationIntent") {
      return buildLexResponse(
        event,
        "Please wait while I connect you to a real person."
      );
    }

    if (intentName === "CancelAppointmentIntent") {
      return buildLexResponse(
        event,
        "I can help with cancellation by connecting you to our team. Please wait while I transfer you."
      );
    }

    if (intentName === "RescheduleAppointmentIntent") {
      return buildLexResponse(
        event,
        "I can help reschedule by connecting you to our team. Please wait while I transfer you."
      );
    }

    if (intentName !== "BookAppointmentIntent") {
      return buildLexResponse(
        event,
        "I can help you book, update, or cancel an appointment."
      );
    }

    const result = await createAppointment(buildAppointmentPayload(event));

    if (!result.ok) {
      console.error("Appointment API rejected request", result.message);
      return buildLexResponse(
        event,
        "I collected your appointment details, but I could not confirm the booking yet. Please wait while I connect you to our team.",
        "Failed"
      );
    }

    return buildLexResponse(
      event,
      "Your appointment is booked. You will receive a confirmation shortly. Thank you."
    );
  } catch (error) {
    console.error("Booking handler error", error);
    return buildLexResponse(
      event,
      "Something went wrong while creating the appointment. Please wait while I connect you to our team.",
      "Failed"
    );
  }
};
