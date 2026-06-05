import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const lambdaPath = path.join(repoRoot, "infra/lambda/booking-handler/index.mjs");
let importCounter = 0;

const slot = (value) => ({
  shape: "Scalar",
  value: {
    originalValue: value,
    interpretedValue: value,
    resolvedValues: [value]
  }
});

const usEasternDate = (daysToAdd = 0) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  const date = new Date(
    Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + daysToAdd)
  );
  return [
    String(date.getUTCFullYear()).padStart(4, "0"),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0")
  ].join("-");
};

const baseEvent = (overrides = {}) => ({
  invocationSource: "FulfillmentCodeHook",
  inputTranscript: "I want to book a pedicure tomorrow at five PM.",
  sessionId: "lex-session-1",
  sessionState: {
    sessionAttributes: {
      salonId: "salon-explicit",
      CalledNumber: "+18483487681",
      CustomerEndpointAddress: "+17325956266",
      AmazonConnectContactId: "connect-contact-1",
      initialBookingUtterance: "I want to book a pedicure."
    },
    intent: {
      name: "BookAppointmentIntent",
      state: "ReadyForFulfillment",
      confirmationState: "Confirmed",
      slots: {
        customerName: slot("Kiet Nguyen"),
        customerPhone: slot("7325956266"),
        serviceName: slot("Pedicure"),
        requestedDate: slot("tomorrow"),
        requestedTime: slot("five PM"),
        staffPreference: slot("Trang")
      }
    }
  },
  requestAttributes: {
    SystemEndpointAddress: "+18483487681"
  },
  ...overrides
});

const successfulBackendPayload = (overrides = {}) => ({
  outcome: "BOOKED",
  appointment: {
    id: "appointment-1"
  },
  bookingAttemptId: "attempt-1",
  callSessionId: "call-session-1",
  escalationId: "escalation-1",
  lexResponse: {
    fulfillmentState: "Fulfilled",
    message: "Booked.",
    messageContentType: "PlainText",
    sessionAttributes: {}
  },
  ...overrides
});

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => ({
    success: true,
    data: payload
  }),
  text: async () => JSON.stringify(payload)
});

const loadHandler = async (env = {}) => {
  process.env.FASTAIBOOKING_API_BASE_URL = "https://api.example.test";
  process.env.FASTAIBOOKING_API_INTERNAL_TOKEN = "unit-internal-token";
  process.env.DEFAULT_SALON_ID = "salon-default";
  process.env.AMAZON_CONNECT_QUEUE_ID_DEFAULT = "queue-default";
  Object.assign(process.env, env);

  const url = pathToFileURL(lambdaPath);
  url.searchParams.set("test", String(importCounter++));
  const module = await import(url.href);
  return module.handler;
};

const installFetchMock = (implementation) => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    const parsedBody = options?.body ? JSON.parse(String(options.body)) : null;
    calls.push({
      url: String(url),
      options,
      body: parsedBody
    });
    return implementation(url, options, parsedBody);
  };
  return calls;
};

afterEach(() => {
  delete globalThis.fetch;
});

test("BookAppointmentIntent with complete slots posts the backend contract and maps session attributes", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock(() => jsonResponse(successfulBackendPayload()));

  const response = await handler(baseEvent());

  assert.equal(fetchCalls.length, 1);
  assert.equal(
    fetchCalls[0].url,
    "https://api.example.test/api/v1/internal/ai/appointments"
  );
  assert.equal(fetchCalls[0].options.method, "POST");
  assert.equal(fetchCalls[0].options.headers.Authorization, "Bearer unit-internal-token");
  assert.equal(fetchCalls[0].body.intentName, "BookAppointmentIntent");
  assert.equal(fetchCalls[0].body.provider, "AMAZON_CONNECT");
  assert.equal(fetchCalls[0].body.customerName, "Kiet");
  assert.equal(fetchCalls[0].body.customerPhone, "+17325956266");
  assert.equal(fetchCalls[0].body.serviceName, "Pedicure");
  assert.equal(fetchCalls[0].body.requestedDate, usEasternDate(1));
  assert.equal(fetchCalls[0].body.requestedTime, "5 PM");
  assert.equal(fetchCalls[0].body.staffPreference, "Trang");
  assert.equal(fetchCalls[0].body.calledNumber, "+18483487681");
  assert.equal(fetchCalls[0].body.amazonConnectPhoneNumber, "+18483487681");
  assert.equal(fetchCalls[0].body.amazonConnectContactId, "connect-contact-1");
  assert.equal(fetchCalls[0].body.salonId, "salon-explicit");
  assert.equal(fetchCalls[0].body.source, "amazon_connect_ai");
  assert.match(fetchCalls[0].body.transcript, /I want to book a pedicure\./);
  assert.match(fetchCalls[0].body.transcript, /tomorrow at five PM/);
  assert.equal(fetchCalls[0].body.slots.serviceName.value.interpretedValue, "Pedicure");

  assert.equal(response.sessionState.intent.state, "Fulfilled");
  assert.equal(response.messages[0].content, "Booked.");
  assert.deepEqual(
    {
      bookingOutcome: response.sessionState.sessionAttributes.bookingOutcome,
      appointmentId: response.sessionState.sessionAttributes.appointmentId,
      bookingAttemptId: response.sessionState.sessionAttributes.bookingAttemptId,
      callSessionId: response.sessionState.sessionAttributes.callSessionId,
      escalationId: response.sessionState.sessionAttributes.escalationId,
      transferToQueue: response.sessionState.sessionAttributes.transferToQueue,
      fallbackMode: response.sessionState.sessionAttributes.fallbackMode,
      queueId: response.sessionState.sessionAttributes.queueId
    },
    {
      bookingOutcome: "BOOKED",
      appointmentId: "appointment-1",
      bookingAttemptId: "attempt-1",
      callSessionId: "call-session-1",
      escalationId: "escalation-1",
      transferToQueue: undefined,
      fallbackMode: undefined,
      queueId: undefined
    }
  );
});

test("DialogCodeHook delegates when the utterance is not an escalation", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for non-escalation DialogCodeHook");
  };

  const response = await handler(baseEvent({ invocationSource: "DialogCodeHook" }));

  assert.equal(response.sessionState.dialogAction.type, "Delegate");
  assert.equal(response.sessionState.intent.slots.customerName.value.interpretedValue, "Kiet");
});

test("DialogCodeHook no input prompts service menu and keeps known caller", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for no-input DialogCodeHook");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-contact-1"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.equal(response.sessionState.sessionAttributes.noInputPrompted, "true");
  assert.equal(response.sessionState.sessionAttributes.noInputCount, "1");
  assert.equal(response.sessionState.sessionAttributes.awaitingNoInputHumanConfirmation, "false");
  assert.equal(response.sessionState.sessionAttributes.customerName, "Kiet");
  assert.equal(response.sessionState.sessionAttributes.recognizedCustomerName, "Kiet");
  assert.equal(response.sessionState.sessionAttributes.customerNameSource, "phone_lookup");
  assert.equal(response.sessionState.sessionAttributes.customerPhone, "+17325956266");
  assert.match(response.messages[0].content, /What service would you like today/i);
  assert.match(response.messages[0].content, /press 1 for Pedicure/i);
});

test("DialogCodeHook second no input uses shorter prompt without transfer", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for second no-input DialogCodeHook");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-contact-1",
          customerName: "Kiet",
          customerPhone: "+17325956266",
          noInputCount: "1"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.equal(response.sessionState.sessionAttributes.noInputCount, "2");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, undefined);
  assert.match(response.messages[0].content, /press 1 through 5/i);
  assert.doesNotMatch(response.messages[0].content, /You can also press 1 for Pedicure/i);
});

test("DialogCodeHook third no input asks for human confirmation without transfer", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for third no-input DialogCodeHook");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-contact-1",
          customerName: "Kiet",
          customerPhone: "+17325956266",
          noInputCount: "2"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "ElicitIntent");
  assert.equal(response.sessionState.sessionAttributes.noInputCount, "3");
  assert.equal(response.sessionState.sessionAttributes.awaitingNoInputHumanConfirmation, "true");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "false");
  assert.match(response.messages[0].content, /connect you to a real person/i);
});

test("yes after no-input human offer transfers only after confirmation", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for no-input human confirmation");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "yes",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          ...baseEvent().sessionState.sessionAttributes,
          awaitingNoInputHumanConfirmation: "true",
          noInputCount: "3"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.messages[0].content, "Please wait while I connect you.");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "true");
  assert.equal(response.sessionState.sessionAttributes.awaitingNoInputHumanConfirmation, "false");
});

test("DialogCodeHook recovers pedicure aliases and bare PM time from transcript", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for DialogCodeHook recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript:
        "I need a better cure tomorrow at five with Trang. My name is Kiet Nguyen. My phone number is 7325956266.",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-contact-1"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "Delegate");
  assert.equal(response.sessionState.intent.slots.customerName.value.interpretedValue, "Kiet Nguyen");
  assert.equal(response.sessionState.intent.slots.customerPhone.value.interpretedValue, "+17325956266");
  assert.equal(response.sessionState.intent.slots.serviceName.value.interpretedValue, "Pedicure");
  assert.equal(response.sessionState.intent.slots.requestedDate.value.interpretedValue, usEasternDate(1));
  assert.equal(response.sessionState.intent.slots.requestedTime.value.interpretedValue, "5 PM");
  assert.equal(response.sessionState.intent.slots.staffPreference.value.interpretedValue, "Trang");
});

test("DialogCodeHook transcript relative date overrides incorrect Lex date slot", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for DialogCodeHook recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "Tomorrow at 3pm.",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-contact-1",
          initialBookingUtterance: "I want to book a pedicure."
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {
            customerName: slot("Kiet Nguyen"),
            customerPhone: slot("7325956266"),
            serviceName: slot("Pedicure"),
            requestedDate: slot(usEasternDate(0)),
            requestedTime: slot("3 PM"),
            staffPreference: slot("Trang")
          }
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "Delegate");
  assert.equal(response.sessionState.intent.slots.requestedDate.value.interpretedValue, usEasternDate(1));
  assert.equal(response.sessionState.intent.slots.requestedTime.value.interpretedValue, "3 PM");
});

test("DialogCodeHook known caller with service and time asks staff only", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called before staff selection");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "I want pedicure tomorrow at 3 PM.",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-contact-1"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "staffPreference");
  assert.equal(response.sessionState.sessionAttributes.customerName, "Kiet");
  assert.equal(response.sessionState.sessionAttributes.customerPhone, "+17325956266");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Pedicure");
  assert.equal(response.sessionState.sessionAttributes.requestedDate, usEasternDate(1));
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "3 PM");
  assert.match(response.messages[0].content, /Who would you like to book with/i);
  assert.doesNotMatch(response.messages[0].content, /name|phone/i);
});

test("DialogCodeHook maps service DTMF only when serviceName was last asked", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for DialogCodeHook DTMF recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "1",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-contact-1",
          lastAskedSlot: "serviceName",
          customerName: "Kiet Nguyen",
          customerPhone: "7325956266",
          requestedDate: usEasternDate(1),
          requestedTime: "3 PM"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "staffPreference");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Pedicure");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Pedicure");
  assert.equal(response.sessionState.intent.slots.serviceName.value.interpretedValue, "Pedicure");
});

test("DialogCodeHook maps staff DTMF only when staffPreference was last asked", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for DialogCodeHook DTMF recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "1",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-contact-1",
          lastAskedSlot: "staffPreference",
          customerName: "Kiet Nguyen",
          customerPhone: "7325956266",
          serviceName: "Pedicure",
          requestedDate: usEasternDate(1),
          requestedTime: "3 PM"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "Delegate");
  assert.equal(response.sessionState.intent.slots.staffPreference.value.interpretedValue, "Trang");
  assert.equal(response.sessionState.intent.slots.serviceName.value.interpretedValue, "Pedicure");
  assert.equal(response.sessionState.sessionAttributes.confirmedStaffName, "Trang");
});

test("DialogCodeHook maps staff DTMF 3 to Kelly when staffPreference was last asked", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for DialogCodeHook DTMF recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "3",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-contact-1",
          lastAskedSlot: "staffPreference",
          customerName: "Kiet Nguyen",
          customerPhone: "7325956266",
          serviceName: "Pedicure",
          requestedDate: usEasternDate(1),
          requestedTime: "3 PM"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "Delegate");
  assert.equal(response.sessionState.intent.slots.staffPreference.value.interpretedValue, "Kelly");
  assert.equal(response.sessionState.sessionAttributes.confirmedStaffName, "Kelly");
});

test("DialogCodeHook maps staff DTMF 4 to Any staff when staffPreference was last asked", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for DialogCodeHook DTMF recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "4",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-contact-1",
          lastAskedSlot: "staffPreference",
          customerName: "Kiet Nguyen",
          customerPhone: "7325956266",
          serviceName: "Pedicure",
          requestedDate: usEasternDate(1),
          requestedTime: "3 PM"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "Delegate");
  assert.equal(response.sessionState.intent.slots.staffPreference.value.interpretedValue, "Any staff");
  assert.equal(response.sessionState.sessionAttributes.confirmedStaffName, "Any staff");
});

test("DialogCodeHook recovers Kelly staff alias from transcript", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for DialogCodeHook transcript recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript:
        "I want to book a pedicure tomorrow at two PM with Kelly. My name is Kiet Nguyen. My phone number is 7325956266.",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-contact-1"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "Delegate");
  assert.equal(response.sessionState.intent.slots.serviceName.value.interpretedValue, "Pedicure");
  assert.equal(response.sessionState.intent.slots.requestedDate.value.interpretedValue, usEasternDate(1));
  assert.equal(response.sessionState.intent.slots.requestedTime.value.interpretedValue, "2 PM");
  assert.equal(response.sessionState.intent.slots.staffPreference.value.interpretedValue, "Kelly");
});

test("DialogCodeHook preserves recognized customer name over bad Lex name slot", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for DialogCodeHook recognized customer preservation");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "I want a pedicure tomorrow at three PM.",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-contact-1",
          customerName: "Kiet",
          recognizedCustomerName: "Kiet",
          customerNameSource: "phone_lookup",
          customerPhone: "+17325956266"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {
            customerName: slot("chang"),
            customerPhone: slot("1111156266"),
            serviceName: slot("Pedicure"),
            requestedDate: slot(usEasternDate(1)),
            requestedTime: slot("3 PM"),
            staffPreference: slot("Trang")
          }
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "Delegate");
  assert.equal(response.sessionState.sessionAttributes.customerName, "Kiet");
  assert.equal(response.sessionState.sessionAttributes.customerPhone, "+17325956266");
  assert.equal(response.sessionState.intent.slots.customerName.value.interpretedValue, "Kiet");
});

test("unknown booking service elicits service before backend escalation", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called before service clarification");
  };

  const response = await handler(
    baseEvent({
      inputTranscript: "I want to book a readykid tomorrow at three PM.",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-contact-1"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {
            customerName: slot("Kiet Nguyen"),
            customerPhone: slot("7325956266"),
            serviceName: slot("readykid"),
            requestedDate: slot(usEasternDate(1)),
            requestedTime: slot("3 PM")
          }
        }
      }
    })
  );

  assert.equal(response.sessionState.intent.name, "BookAppointmentIntent");
  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.equal(response.sessionState.intent.slots.serviceName, null);
  assert.equal(response.sessionState.sessionAttributes.serviceFallbackOffered, "true");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, undefined);
  assert.match(response.messages[0].content, /service|Manicure|Pedicure/i);
});

test("HumanEscalationIntent returns the exact handoff message", async () => {
  const handler = await loadHandler();
  installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "HUMAN_ESCALATION",
        appointment: null,
        lexResponse: {
          fulfillmentState: "Fulfilled",
          message: "Please wait while I connect you.",
          messageContentType: "PlainText",
          sessionAttributes: {
            forceHumanEscalation: "true",
            transferToQueue: "true",
            escalationReason: "caller_requested_human",
            queueId: "queue-from-backend"
          }
        }
      })
    )
  );

  const response = await handler(
    baseEvent({
      inputTranscript: "I want to speak to a real person.",
      sessionState: {
        ...baseEvent().sessionState,
        intent: {
          ...baseEvent().sessionState.intent,
          name: "HumanEscalationIntent"
        }
      }
    })
  );

  assert.equal(response.messages[0].content, "Please wait while I connect you.");
  assert.equal(response.messages[0].contentType, "PlainText");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "true");
});

test("HumanEscalationIntent returns no-agent message when availability is blocked", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called when no agents are available");
  };

  const response = await handler(
    baseEvent({
      inputTranscript: "I want to speak to a real person.",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          ...baseEvent().sessionState.sessionAttributes,
          AgentsAvailable: "0"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          name: "HumanEscalationIntent"
        }
      }
    })
  );

  assert.equal(response.messages[0].content, "No agents available.");
  assert.equal(response.messages[0].contentType, "PlainText");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "false");
  assert.equal(response.sessionState.sessionAttributes.noAgentsAvailable, "true");
});

test("human escalation utterance does not override a different Lex intent", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload()
    )
  );

  await handler(
    baseEvent({
      inputTranscript: "I want to speak to a real person.",
      sessionState: {
        ...baseEvent().sessionState,
        intent: {
          ...baseEvent().sessionState.intent,
          name: "BookAppointmentIntent"
        }
      }
    })
  );

  assert.equal(fetchCalls[0].body.intentName, "BookAppointmentIntent");
});

test("BookAppointmentIntent backend human escalation response is blocked", async () => {
  const handler = await loadHandler();
  installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "HUMAN_ESCALATION",
        appointment: null,
        lexResponse: {
          fulfillmentState: "Fulfilled",
          message: "Please wait while I connect you.",
          messageContentType: "PlainText",
          sessionAttributes: {
            forceHumanEscalation: "true",
            transferToQueue: "true",
            queueId: "queue-from-backend"
          }
        }
      })
    )
  );

  const response = await handler(baseEvent());

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.equal(response.sessionState.sessionAttributes.forceHumanEscalation, "false");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "false");
  assert.equal(response.sessionState.sessionAttributes.queueId, undefined);
  assert.equal(response.sessionState.sessionAttributes.blockedEscalationOutcome, "HUMAN_ESCALATION");
});

test("cancel and reschedule intents pass through backend appointment context without transfer", async () => {
  for (const intentName of ["CancelAppointmentIntent", "RescheduleAppointmentIntent"]) {
    const handler = await loadHandler();
    const fetchCalls = installFetchMock(() =>
      jsonResponse(
        successfulBackendPayload({
          outcome: "MISSING_INFO",
          appointment: null,
          lexResponse: {
            fulfillmentState: "InProgress",
            message:
              "<speak>I see your upcoming pedicure with Trang tomorrow at 3 PM. <break time=\"300ms\"/> Would you like me to connect you with our team to update that appointment?</speak>",
            messageContentType: "SSML",
            dialogAction: {
              type: "ElicitIntent"
            },
            sessionAttributes: {
              customerId: "customer-kiet",
              customerName: "Kiet",
              customerPhone: "+17325956266",
              awaitingExistingAppointmentHumanConfirmation: "true",
              forceHumanEscalation: "false",
              transferToQueue: "false"
            }
          }
        })
      )
    );

    const response = await handler(
      baseEvent({
        inputTranscript:
          intentName === "CancelAppointmentIntent"
            ? "I want to cancel my appointment."
            : "I want to reschedule my appointment.",
        sessionState: {
          ...baseEvent().sessionState,
          intent: {
            ...baseEvent().sessionState.intent,
            name: intentName
          }
        }
      })
    );

    assert.equal(fetchCalls[0].body.intentName, intentName);
    assert.match(response.messages[0].content, /upcoming pedicure with Trang/i);
    assert.equal(response.messages[0].contentType, "SSML");
    assert.equal(response.sessionState.dialogAction.type, "ElicitIntent");
    assert.equal(
      response.sessionState.sessionAttributes.awaitingExistingAppointmentHumanConfirmation,
      "true"
    );
    assert.equal(response.sessionState.sessionAttributes.transferToQueue, "false");
    delete globalThis.fetch;
  }
});

test("yes after existing appointment handoff offer transfers only after confirmation", async () => {
  const handler = await loadHandler();
  const response = await handler(
    baseEvent({
      inputTranscript: "yes",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          ...baseEvent().sessionState.sessionAttributes,
          awaitingExistingAppointmentHumanConfirmation: "true",
          existingAppointmentId: "appointment-1"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          name: "BookAppointmentIntent"
        }
      }
    })
  );

  assert.equal(response.messages[0].content, "Please wait while I connect you.");
  assert.equal(response.messages[0].contentType, "PlainText");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "true");
  assert.equal(
    response.sessionState.sessionAttributes.awaitingExistingAppointmentHumanConfirmation,
    "false"
  );
  assert.equal(
    response.sessionState.sessionAttributes.escalationReason,
    "caller_confirmed_existing_appointment_handoff"
  );
});

test("BookAppointmentIntent backend non-OK response elicits a slot without escalation", async () => {
  const handler = await loadHandler();
  installFetchMock(() => ({
    ok: false,
    status: 500,
    text: async () => '{"error":"database stack trace with secret debug text"}'
  }));

  const response = await handler(baseEvent());

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.equal(response.sessionState.sessionAttributes.forceHumanEscalation, "false");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "false");
  assert.equal(response.sessionState.sessionAttributes.backendFailureReason, "backend_error");
  assert.doesNotMatch(response.messages[0].content, /database|stack|secret|debug/i);
});

test("BookAppointmentIntent backend thrown error elicits a slot without escalation", async () => {
  const handler = await loadHandler();
  installFetchMock(() => {
    throw new Error("connection refused with internal host details");
  });

  const response = await handler(baseEvent());

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.equal(response.sessionState.sessionAttributes.forceHumanEscalation, "false");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "false");
  assert.equal(response.sessionState.sessionAttributes.backendFailureReason, "backend_error");
  assert.doesNotMatch(response.messages[0].content, /internal host|connection refused/i);
});
