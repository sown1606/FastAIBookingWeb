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

function isHumanEscalationRequest(intentName, text) {
  if (intentName === "HumanEscalationIntent") {
    return true;
  }
  return /\b(speak|talk|connect|transfer)\s+(to\s+)?(a\s+)?(real\s+person|live\s+person|human|operator|representative|agent)\b|\b(real\s+person|live\s+person|human\s+operator|live\s+agent)\b/i.test(
    text || ""
  );
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
  return {
    sessionState: {
      sessionAttributes: {
        ...(event.sessionState?.sessionAttributes || {}),
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
        contentType: "PlainText",
        content: message
      }
    ]
  };
}

function buildDelegateResponse(event) {
  const previous = event.sessionState?.sessionAttributes || {};
  const initial = previous.initialBookingUtterance || event.inputTranscript || "";
  return {
    sessionState: {
      sessionAttributes: {
        ...previous,
        initialBookingUtterance: initial
      },
      dialogAction: {
        type: "Delegate"
      },
      intent: event.sessionState?.intent || {}
    }
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
  const backendIntentName = isHumanEscalationRequest(intentName, event.inputTranscript)
    ? "HumanEscalationIntent"
    : intentName;
  const calledNumber = getAttribute(event, attributeNames.calledNumber);
  const amazonConnectContactId =
    getAttribute(event, attributeNames.contactId) || event.sessionId || undefined;
  const amazonConnectPhoneNumber = calledNumber || undefined;
  const customerPhone =
    getSlotValue(slots, slotNames.customerPhone) ||
    getAttribute(event, attributeNames.customerNumber);
  const initialUtterance = getAttribute(event, ["initialBookingUtterance"]);
  const transcript = [initialUtterance, event.inputTranscript || getAttribute(event, attributeNames.transcript)]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(" ");

  const payload = {
    intentName: backendIntentName,
    provider: "AMAZON_CONNECT",
    customerName: getSlotValue(slots, slotNames.customerName),
    customerPhone,
    serviceName: getSlotValue(slots, slotNames.serviceName),
    requestedDate: getSlotValue(slots, slotNames.requestedDate),
    requestedTime: getSlotValue(slots, slotNames.requestedTime, { preferOriginal: true }),
    staffPreference: getSlotValue(slots, slotNames.staffPreference),
    confirmationState: event.sessionState?.intent?.confirmationState,
    transcript,
    source: "amazon_connect_ai",
    amazonConnectContactId,
    amazonConnectPhoneNumber,
    calledNumber: calledNumber || undefined,
    slots,
    attributes: event.sessionState?.sessionAttributes || {}
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
      escalationId: data.escalationId,
      serviceSuggestionName: data.lexResponse?.sessionAttributes?.serviceSuggestionName,
      serviceClarificationAttempts:
        data.lexResponse?.sessionAttributes?.serviceClarificationAttempts,
      humanEscalationOffer: data.lexResponse?.sessionAttributes?.humanEscalationOffer,
      aiAlternativeSlots: data.lexResponse?.sessionAttributes?.aiAlternativeSlots
    }).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

export const handler = async (event) => {
  try {
    const intentName = event.sessionState?.intent?.name || "";
    const shouldEscalate = isHumanEscalationRequest(intentName, event.inputTranscript);

    if (event.invocationSource === "DialogCodeHook" && !shouldEscalate) {
      return buildDelegateResponse(event);
    }

    if (shouldEscalate) {
      const result = await postInternalAppointment(buildInternalPayload(event, intentName));
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
        ? "You're all set. Your appointment is booked. Thank you for calling."
        : "I could not confirm the booking yet. Please wait while I connect you to our team.");

    return buildLexResponse(
      event,
      message,
      state,
      buildSessionAttributesFromResult(data),
      data.lexResponse
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
