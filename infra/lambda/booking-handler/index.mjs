const API_BASE_URL = process.env.FASTAIBOOKING_API_BASE_URL;
const INTERNAL_TOKEN = process.env.FASTAIBOOKING_API_INTERNAL_TOKEN;
const DEFAULT_SALON_ID = process.env.DEFAULT_SALON_ID;
const DEFAULT_QUEUE_ID = process.env.AMAZON_CONNECT_QUEUE_ID_DEFAULT;
const API_TIMEOUT_MS = 6000;

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
  const known = {
    customerName: getKnownField(event, "customerName"),
    customerPhone:
      getKnownField(event, "customerPhone") ||
      getAttribute(event, attributeNames.customerNumber),
    serviceName: getKnownField(event, "serviceName"),
    requestedDate: getKnownField(event, "requestedDate"),
    requestedTime: getKnownField(event, "requestedTime", { preferOriginal: true }),
    staffPreference: getKnownField(event, "staffPreference"),
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
    const value = currentValue || getKnownField(event, field, {
      preferOriginal: field === "requestedTime"
    });
    if (!value) {
      continue;
    }
    const slotName = names.find((name) => Object.prototype.hasOwnProperty.call(slots, name)) || names[0];
    slots[slotName] = slots[slotName]?.value ? slots[slotName] : buildLexSlot(value);
  }

  return slots;
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
        Authorization: `Bearer ${INTERNAL_TOKEN}`
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
  const backendIntentName = isHumanEscalationRequest(intentName, event.inputTranscript)
    ? "HumanEscalationIntent"
    : intentName;
  const calledNumber = getAttribute(event, attributeNames.calledNumber);
  const amazonConnectContactId =
    getAttribute(event, attributeNames.contactId) || event.sessionId || undefined;
  const amazonConnectPhoneNumber = calledNumber || undefined;
  const customerPhone =
    getKnownField(event, "customerPhone") ||
    getAttribute(event, attributeNames.customerNumber);
  const initialUtterance = getAttribute(event, ["initialBookingUtterance"]);
  const transcript = [initialUtterance, event.inputTranscript || getAttribute(event, attributeNames.transcript)]
    .filter((value, index, values) => value && values.indexOf(value) === index)
    .join(" ");

  const payload = {
    intentName: backendIntentName,
    provider: "AMAZON_CONNECT",
    customerName: getKnownField(event, "customerName"),
    customerPhone,
    serviceName: getKnownField(event, "serviceName"),
    requestedDate: getKnownField(event, "requestedDate"),
    requestedTime: getKnownField(event, "requestedTime", { preferOriginal: true }),
    staffPreference: getKnownField(event, "staffPreference"),
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

export const handler = async (event) => {
  try {
    const intentName = event.sessionState?.intent?.name || "";
    const shouldEscalate = isHumanEscalationRequest(intentName, event.inputTranscript);

    if (event.invocationSource === "DialogCodeHook" && !shouldEscalate) {
      return buildDelegateResponse(event);
    }

    if (shouldEscalate) {
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
      return buildBackendFailureEscalationResponse(event, result);
    }

    const data = extractResultPayload(result);
    const state = data.lexResponse?.fulfillmentState || (data.outcome === "BOOKED" ? "Fulfilled" : "Failed");
    const message =
      data.lexResponse?.message ||
      (data.outcome === "BOOKED"
        ? "<speak>You're all set. <break time=\"300ms\"/> Your appointment is booked. Thank you for calling.</speak>"
        : '<speak>I could not confirm the booking yet. <break time="300ms"/> Please hold while I connect you with our team.</speak>');

    return buildLexResponse(
      event,
      message,
      state,
      {
        ...buildSessionAttributesFromResult(data),
        ...(data.outcome === "FAILED"
          ? buildForceHumanEscalationAttributes("backend_failed")
          : {})
      },
      data.lexResponse
    );
  } catch (error) {
    console.error("Booking handler error", error);
    return buildLexResponse(
      event,
      '<speak>Something went wrong while creating the appointment. <break time="300ms"/> Please hold while I connect you with our team.</speak>',
      "Failed",
      buildForceHumanEscalationAttributes("backend_error")
    );
  }
};
