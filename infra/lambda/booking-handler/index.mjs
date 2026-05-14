const API_BASE_URL = process.env.FASTAIBOOKING_API_BASE_URL;
const INTERNAL_TOKEN = process.env.FASTAIBOOKING_API_INTERNAL_TOKEN;
const DEFAULT_SALON_ID = process.env.DEFAULT_SALON_ID;

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

function buildLexResponse(event, message, state = "Fulfilled", sessionAttributes = {}) {
  const intent = event.sessionState?.intent || {};
  return {
    sessionState: {
      sessionAttributes: {
        ...(event.sessionState?.sessionAttributes || {}),
        ...sessionAttributes
      },
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

async function postInternalAppointment(payload) {
  if (!API_BASE_URL || !INTERNAL_TOKEN) {
    return {
      ok: false,
      message: "The booking system is not fully configured yet."
    };
  }

  const response = await fetch(`${API_BASE_URL}/api/v1/internal/ai/appointments`, {
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

function buildInternalPayload(event, intentName) {
  const slots = event.sessionState?.intent?.slots || {};
  const calledNumber = getAttribute(event, attributeNames.calledNumber);
  const amazonConnectContactId =
    getAttribute(event, attributeNames.contactId) || event.sessionId || undefined;
  const amazonConnectPhoneNumber = calledNumber || undefined;
  const customerPhone =
    getSlotValue(slots, slotNames.customerPhone) ||
    getAttribute(event, attributeNames.customerNumber);

  const payload = {
    intentName,
    provider: "AMAZON_CONNECT",
    customerName: getSlotValue(slots, slotNames.customerName),
    customerPhone,
    serviceName: getSlotValue(slots, slotNames.serviceName),
    requestedDate: getSlotValue(slots, slotNames.requestedDate),
    requestedTime: getSlotValue(slots, slotNames.requestedTime),
    staffPreference: getSlotValue(slots, slotNames.staffPreference),
    transcript: event.inputTranscript || getAttribute(event, attributeNames.transcript),
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

function extractResultPayload(result) {
  const data = result?.data?.data || result?.data;
  return data && typeof data === "object" ? data : {};
}

function buildSessionAttributesFromResult(data) {
  return Object.fromEntries(
    Object.entries({
      bookingOutcome: data.outcome,
      appointmentId: data.appointment?.id,
      bookingAttemptId: data.bookingAttemptId,
      callSessionId: data.callSessionId,
      escalationId: data.escalationId
    }).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

export const handler = async (event) => {
  try {
    const intentName = event.sessionState?.intent?.name || "";

    if (intentName === "HumanEscalationIntent") {
      const result = await postInternalAppointment(buildInternalPayload(event, intentName));
      const data = extractResultPayload(result);
      return buildLexResponse(
        event,
        data.lexResponse?.message || "Please wait while I connect you to a real person.",
        data.lexResponse?.fulfillmentState || "Fulfilled",
        buildSessionAttributesFromResult(data)
      );
    }

    if (intentName === "CancelAppointmentIntent") {
      const result = await postInternalAppointment(buildInternalPayload(event, intentName));
      const data = extractResultPayload(result);
      return buildLexResponse(
        event,
        data.lexResponse?.message ||
          "I can help with cancellation by connecting you to our team. Please wait while I transfer you.",
        data.lexResponse?.fulfillmentState || "Fulfilled",
        buildSessionAttributesFromResult(data)
      );
    }

    if (intentName === "RescheduleAppointmentIntent") {
      const result = await postInternalAppointment(buildInternalPayload(event, intentName));
      const data = extractResultPayload(result);
      return buildLexResponse(
        event,
        data.lexResponse?.message ||
          "I can help reschedule by connecting you to our team. Please wait while I transfer you.",
        data.lexResponse?.fulfillmentState || "Fulfilled",
        buildSessionAttributesFromResult(data)
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
      console.error("Appointment API rejected request", result.message);
      return buildLexResponse(
        event,
        "I collected your appointment details, but I could not confirm the booking yet. Please wait while I connect you to our team.",
        "Failed"
      );
    }

    const data = extractResultPayload(result);
    const state = data.lexResponse?.fulfillmentState || (data.outcome === "BOOKED" ? "Fulfilled" : "Failed");
    const message =
      data.lexResponse?.message ||
      (data.outcome === "BOOKED"
        ? "Your appointment is booked. You will receive a confirmation shortly. Thank you."
        : "I could not confirm the booking yet. Please wait while I connect you to our team.");

    return buildLexResponse(
      event,
      message,
      state,
      buildSessionAttributesFromResult(data)
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
