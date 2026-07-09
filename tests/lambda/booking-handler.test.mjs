import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const lambdaPath = path.join(repoRoot, "infra/lambda/booking-handler/index.mjs");
const lexRoots = ["v7", "v8", "v10"].map((version) => ({
  version,
  root: path.join(repoRoot, `infra/aws/lex/FastAIBookingBot-${version}`)
}));
const connectRoot = path.join(repoRoot, "infra/aws/connect/contact-flows");
let importCounter = 0;

const slot = (value) => ({
  shape: "Scalar",
  value: {
    originalValue: value,
    interpretedValue: value,
    resolvedValues: [value]
  }
});

const slotWith = ({ originalValue, interpretedValue, resolvedValues }) => ({
  shape: "Scalar",
  value: {
    originalValue,
    interpretedValue,
    resolvedValues: resolvedValues || [interpretedValue].filter(Boolean)
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

const dynamicStaffAttributes = () => ({
  staffDtmfOptions: JSON.stringify({
    "1": "Trang",
    "2": "Amy",
    "3": "Kelly",
    "4": "Any staff"
  }),
  staffDtmfStaffIds: JSON.stringify({
    "1": "staff-trang",
    "2": "staff-amy",
    "3": "staff-kelly"
  }),
  staffDtmfPromptText:
    "Do you prefer Trang, Amy, Kelly, or first available? Press 1 for Trang, 2 for Amy, 3 for Kelly, 4 for first available, or 0 for an operator."
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

const delayedJsonResponse = (payload, delayMs) =>
  new Promise((resolve) => {
    setTimeout(() => resolve(jsonResponse(payload)), delayMs);
  });

const abortableDelayedJsonResponse = (payload, delayMs, signal) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => resolve(jsonResponse(payload)), delayMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      },
      { once: true }
    );
  });

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
  assert.equal(fetchCalls[0].body.customerName, "Kiet Nguyen");
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

test("Lex fulfillment progress updates cover slow booking, appointment changes, and handoff waits", () => {
  const expectedPrompts = {
    BookAppointmentIntent: {
      start: "Please give me a moment while I check availability.",
      update: "I’m still checking the schedule."
    },
    HumanEscalationIntent: {
      start: "Please wait while I connect you.",
      update: "Still connecting you. Please wait a moment."
    },
    CancelAppointmentIntent: {
      start: "Please wait while I look up your appointment.",
      update: "Still looking up your appointment. Please wait a moment."
    },
    RescheduleAppointmentIntent: {
      start: "Please wait while I look up your appointment.",
      update: "Still looking up your appointment. Please wait a moment."
    }
  };

  for (const { version, root } of lexRoots) {
    for (const [intentName, prompts] of Object.entries(expectedPrompts)) {
      const intent = JSON.parse(
        readFileSync(
          path.join(root, "BotLocales/en_US/Intents", intentName, "Intent.json"),
          "utf8"
        )
      );
      const spec = intent.fulfillmentCodeHook?.fulfillmentUpdatesSpecification;
      assert.equal(spec?.active, true, `${version} ${intentName} progress updates active`);
      assert.equal(
        spec.startResponse.delayInSeconds <= 1,
        true,
        `${version} ${intentName} starts within 1 second`
      );
      assert.equal(
        spec.updateResponse.frequencyInSeconds <= 3,
        true,
        `${version} ${intentName} repeats within 3 seconds`
      );
      assert.equal(
        spec.startResponse.messageGroups[0].message.plainTextMessage.value,
        prompts.start,
        `${version} ${intentName} start prompt`
      );
      assert.equal(
        spec.updateResponse.messageGroups[0].message.plainTextMessage.value,
        prompts.update,
        `${version} ${intentName} update prompt`
      );
    }
  }
});

test("Connect human escalation flow speaks before queue transfer", () => {
  const humanEscalationFlow = JSON.parse(
    readFileSync(path.join(connectRoot, "human-escalation.json"), "utf8")
  );
  const actionsById = new Map(
    humanEscalationFlow.Actions.map((action) => [action.Identifier, action])
  );
  const startAction = actionsById.get(humanEscalationFlow.StartAction);
  const waitPrompt = actionsById.get(startAction.Transitions.NextAction);
  const queueUpdate = actionsById.get(waitPrompt.Transitions.NextAction);
  const customerQueueHook = actionsById.get(queueUpdate.Transitions.NextAction);
  const queueTransfer = actionsById.get(customerQueueHook.Transitions.NextAction);

  assert.equal(startAction.Type, "UpdateContactTextToSpeechVoice");
  assert.equal(waitPrompt.Type, "MessageParticipant");
  assert.match(waitPrompt.Parameters.Text, /^Please wait while I connect you\./);
  assert.equal(queueUpdate.Type, "UpdateContactTargetQueue");
  assert.equal(customerQueueHook.Type, "UpdateContactEventHooks");
  assert.match(customerQueueHook.Parameters.EventHooks.CustomerQueue, /contact-flow\/6bdf546e-4e3a-4bf5-954f-fb78fa6a3d5b$/);
  assert.equal(queueTransfer.Type, "TransferContactToQueue");
});

test("Connect AI reception Lex error branch reprompts instead of transferring", () => {
  const aiReceptionFlow = JSON.parse(
    readFileSync(path.join(connectRoot, "ai-reception.json"), "utf8")
  );
  const actionsById = new Map(aiReceptionFlow.Actions.map((action) => [action.Identifier, action]));
  const errorPrompt = actionsById.get("41e3f239-5b57-4363-92fc-9d594579fa98");

  assert.equal(errorPrompt.Type, "MessageParticipant");
  assert.match(errorPrompt.Parameters.Text, /press 0 for an operator/i);
  assert.doesNotMatch(errorPrompt.Parameters.Text, /goodbye|call back later|connect you/i);
  assert.notEqual(errorPrompt.Transitions.NextAction, "transfer-human-escalation-flow");
});

test("DialogCodeHook with service and time prompts staff next", async () => {
  const handler = await loadHandler({ BOOKING_HANDLER_API_TIMEOUT_MS: "2800" });
  const startedAt = Date.now();
  const fetchCalls = installFetchMock(() => {
    throw new Error("staff options backend unavailable");
  });

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
          AmazonConnectContactId: "connect-slow-staff",
          customerName: "Kiet",
          recognizedCustomerName: "Kiet",
          customerNameSource: "phone_lookup"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(Date.now() - startedAt < 1000, true);
  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "staffPreference");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Pedicure");
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "3 PM");
});

test("slow booking fulfillment relies on Lex progress updates and preserves one backend call", async () => {
  const handler = await loadHandler({ BOOKING_HANDLER_API_TIMEOUT_MS: "5000" });
  const fetchCalls = installFetchMock(() => delayedJsonResponse(successfulBackendPayload(), 3200));

  const startedAt = Date.now();
  const response = await handler(baseEvent());

  assert.equal(Date.now() - startedAt >= 3000, true);
  assert.equal(fetchCalls.length, 1);
  assert.equal(
    fetchCalls[0].options.headers["X-FastAIBooking-Wait-Operation"],
    "booking_fulfillment_availability_and_creation"
  );
  assert.match(
    fetchCalls[0].options.headers["X-FastAIBooking-Wait-Prompt"],
    /check availability.*create your appointment/i
  );
  assert.equal(response.sessionState.intent.state, "Fulfilled");
  assert.equal(response.sessionState.sessionAttributes.appointmentId, "appointment-1");
});

test("DialogCodeHook delegates when the utterance is not an escalation", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for non-escalation DialogCodeHook");
  };

  const response = await handler(baseEvent({ invocationSource: "DialogCodeHook" }));

  assert.equal(response.sessionState.dialogAction.type, "Delegate");
  assert.equal(response.sessionState.intent.slots.customerName.value.interpretedValue, "Kiet Nguyen");
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
  assert.equal(response.sessionState.sessionAttributes.customerPhone, "+17325956266");
  assert.match(response.messages[0].content, /say the service, press 4 for Full Set/i);
  assert.match(response.messages[0].content, /4 for Full Set/i);
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
          AmazonConnectContactId: "connect-contact-1",
          ...dynamicStaffAttributes()
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

test("DialogCodeHook known caller with service and time prompts staff without asking name", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock(() => {
    throw new Error("staff options backend unavailable");
  });

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
          AmazonConnectContactId: "connect-contact-1",
          customerName: "Kiet",
          recognizedCustomerName: "Kiet",
          customerNameSource: "phone_lookup"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "staffPreference");
  assert.equal(response.sessionState.sessionAttributes.customerName, "Kiet");
  assert.equal(response.sessionState.sessionAttributes.customerPhone, "+17325956266");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Pedicure");
  assert.equal(response.sessionState.sessionAttributes.requestedDate, usEasternDate(1));
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "3 PM");
});

test("DialogCodeHook recovers logged eddie here pedicure utterance then asks staff", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock(() => {
    throw new Error("staff options backend unavailable");
  });

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "I want to have eddie here tomorrow at seven p.m.",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-contact-1",
          customerName: "Kiet",
          recognizedCustomerName: "Kiet",
          customerNameSource: "phone_lookup"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "staffPreference");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Pedicure");
  assert.equal(response.sessionState.sessionAttributes.requestedDate, usEasternDate(1));
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "7 PM");
  assert.equal(response.sessionState.sessionAttributes.customerName, "Kiet");
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

test("DialogCodeHook voice full set resolves Full Set and asks the next missing slot", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for local Full Set speech recovery");
  };

  for (const inputTranscript of ["full set", "I want to book a full set"]) {
    const response = await handler(
      baseEvent({
        invocationSource: "DialogCodeHook",
        inputTranscript,
        sessionState: {
          ...baseEvent().sessionState,
          sessionAttributes: {
            salonId: "salon-explicit",
            CalledNumber: "+18483487681",
            CustomerEndpointAddress: "+17325956266",
            AmazonConnectContactId: "connect-full-set-voice"
          },
          intent: {
            ...baseEvent().sessionState.intent,
            slots: {}
          }
        }
      })
    );

    assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
    assert.notEqual(response.sessionState.dialogAction.slotToElicit, "serviceName");
    assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
    assert.notEqual(response.sessionState.sessionAttributes.transferToQueue, "true");
    assert.notEqual(response.sessionState.sessionAttributes.forceHumanEscalation, "true");
    assert.equal(response.sessionState.intent.slots.serviceName.value.interpretedValue, "Full Set");
  }
});

test("+84798171999 Full Set speech stays in AI booking flow", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for local Full Set speech recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "I want a full set tomorrow at 3 PM with Trang.",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-thuyet-847-full-set"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      },
      requestAttributes: {
        SystemEndpointAddress: "+18483487681"
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.notEqual(response.sessionState.sessionAttributes.transferToQueue, "true");
  assert.notEqual(response.sessionState.sessionAttributes.forceHumanEscalation, "true");
  assert.notEqual(response.sessionState.dialogAction.type, "Close");
});

test("DialogCodeHook full Full Set utterance then bare name preserves all prior slots", async () => {
  const handler = await loadHandler();
  installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "What name should I put the appointment under?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitSlot",
            slotToElicit: "customerName"
          },
          sessionAttributes: {
            forceHumanEscalation: "false",
            transferToQueue: "false"
          }
        },
        missingFields: ["customerName"]
      })
    )
  );

  const first = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "I want to book a Full Set tomorrow at 3 PM with Trang.",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-thuyet-full-utterance"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(first.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(first.sessionState.dialogAction.slotToElicit, "customerName");
  assert.equal(first.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(first.sessionState.sessionAttributes.requestedDate, usEasternDate(1));
  assert.equal(first.sessionState.sessionAttributes.requestedTime, "3 PM");
  assert.equal(first.sessionState.sessionAttributes.staffPreference, "Trang");

  const second = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "Lee",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: first.sessionState.sessionAttributes,
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(second.sessionState.sessionAttributes.customerName, "Lee");
  assert.equal(second.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(second.sessionState.sessionAttributes.requestedDate, usEasternDate(1));
  assert.equal(second.sessionState.sessionAttributes.requestedTime, "3 PM");
  assert.equal(second.sessionState.sessionAttributes.staffPreference, "Trang");
  assert.notEqual(second.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.notEqual(second.sessionState.dialogAction.slotToElicit, "requestedDate");
  assert.notEqual(second.sessionState.dialogAction.slotToElicit, "requestedTime");
  assert.notEqual(second.sessionState.sessionAttributes.transferToQueue, "true");
});

test("DialogCodeHook known caller lookup avoids asking name", async () => {
  const handler = await loadHandler();
  installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "What day would you like to come in?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitSlot",
            slotToElicit: "requestedDate"
          },
          sessionAttributes: {
            customerName: "Thuyet",
            recognizedCustomerName: "Thuyet",
            customerNameSource: "booking_attempt",
            customerPhone: "+84798171999",
            serviceName: "Full Set",
            confirmedServiceName: "Full Set",
            forceHumanEscalation: "false",
            transferToQueue: "false"
          }
        },
        missingFields: ["requestedDate"]
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "I want a full set tomorrow at 3 PM with Trang.",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-known-caller"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.customerName, "Thuyet");
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "customerName");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "false");
});

test("Fulfillment backend missing service does not ask service after Full Set confirmed", async () => {
  const handler = await loadHandler();
  installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "What service would you like today?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitSlot",
            slotToElicit: "serviceName"
          },
          sessionAttributes: {
            serviceName: "Full Set",
            confirmedServiceName: "Full Set",
            forceHumanEscalation: "false",
            transferToQueue: "false"
          }
        },
        missingFields: ["serviceName"]
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "FulfillmentCodeHook",
      inputTranscript: "3 PM",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-full-set-api-missing-service",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(1),
          requestedTime: "3 PM",
          customerName: "Thuyet",
          customerPhone: "7325956266"
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
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.match(response.messages[0].content, /Got it, Full Set\. Which staff/i);
  assert.doesNotMatch(response.messages[0].content, /What service/i);
});

test("DialogCodeHook canonicalizes stale Lex full-set resolution to Full Set", async () => {
  const handler = await loadHandler();
  const staleFullSetName = ["Acr", "ylic ", "Full Set"].join("");
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for local stale service name recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "full set",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-full-set-stale-lex"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {
            serviceName: {
              shape: "Scalar",
              value: {
                originalValue: "full set",
                interpretedValue: staleFullSetName,
                resolvedValues: [staleFullSetName]
              }
            }
          }
        }
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(response.sessionState.intent.slots.serviceName.value.interpretedValue, "Full Set");
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "serviceName");
});

test("DialogCodeHook maps service DTMF 4 to Full Set and preserves it for name and date turns", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for local Full Set DTMF recovery");
  };
  const commonAttributes = {
    salonId: "salon-explicit",
    CalledNumber: "+18483487681",
    CustomerEndpointAddress: "+18483487681",
    AmazonConnectContactId: "connect-full-set-dtmf",
    lastAskedSlot: "serviceName"
  };

  const dtmfResponse = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "4",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: commonAttributes,
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(dtmfResponse.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(dtmfResponse.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.notEqual(dtmfResponse.sessionState.sessionAttributes.transferToQueue, "true");
  assert.notEqual(dtmfResponse.sessionState.sessionAttributes.forceHumanEscalation, "true");
  assert.equal(dtmfResponse.sessionState.intent.slots.serviceName.value.interpretedValue, "Full Set");
  assert.notEqual(dtmfResponse.sessionState.dialogAction.slotToElicit, "serviceName");

  const nameResponse = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "my name is Thuyet",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          ...dtmfResponse.sessionState.sessionAttributes,
          lastAskedSlot: "customerName"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(nameResponse.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(nameResponse.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(nameResponse.sessionState.sessionAttributes.customerName, "Thuyet");
  assert.notEqual(nameResponse.sessionState.sessionAttributes.transferToQueue, "true");
  assert.notEqual(nameResponse.sessionState.sessionAttributes.forceHumanEscalation, "true");

  const outOfOrderNameResponse = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "My name is Thuyet",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          ...dtmfResponse.sessionState.sessionAttributes,
          lastAskedSlot: "requestedDate"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(outOfOrderNameResponse.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(outOfOrderNameResponse.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(outOfOrderNameResponse.sessionState.sessionAttributes.customerName, "Thuyet");
  assert.notEqual(outOfOrderNameResponse.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.notEqual(outOfOrderNameResponse.sessionState.sessionAttributes.transferToQueue, "true");

  const dateResponse = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "tomorrow at 3 PM",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          ...dtmfResponse.sessionState.sessionAttributes,
          lastAskedSlot: "requestedDate"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(dateResponse.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(dateResponse.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(dateResponse.sessionState.sessionAttributes.requestedDate, usEasternDate(1));
  assert.equal(dateResponse.sessionState.sessionAttributes.requestedTime, "3 PM");
  assert.notEqual(dateResponse.sessionState.sessionAttributes.transferToQueue, "true");
  assert.notEqual(dateResponse.sessionState.sessionAttributes.forceHumanEscalation, "true");
});

test("DialogCodeHook scopes polluted ViberOut service DTMF 4 to serviceName only", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "What name should I put the appointment under?",
          messageContentType: "PlainText",
          sessionAttributes: {
            customerName: "Kiet",
            recognizedCustomerName: "Kiet",
            customerNameSource: "customer",
            requestedDate: "2027-04-01",
            requestedTime: "4 PM",
            staffPreference: "m",
            forceHumanEscalation: "false",
            transferToQueue: "false"
          }
        },
        missingFields: ["customerName"]
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputMode: "DTMF",
      inputTranscript: "4",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "9fed7297-a05f-4862-bb34-372e84f74825",
          lastAskedSlot: "serviceName"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {
            serviceName: slotWith({
              originalValue: "4",
              interpretedValue: "Full Set",
              resolvedValues: ["Full Set"]
            }),
            requestedDate: slotWith({
              originalValue: "4",
              interpretedValue: "2027-04-01",
              resolvedValues: ["2027-04-01"]
            }),
            requestedTime: slotWith({
              originalValue: "4 PM",
              interpretedValue: "4 PM",
              resolvedValues: ["4 PM"]
            }),
            staffPreference: slotWith({
              originalValue: "m",
              interpretedValue: "m",
              resolvedValues: ["m"]
            })
          }
        }
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.requestedDate, undefined);
  assert.equal(response.sessionState.sessionAttributes.requestedTime, undefined);
  assert.equal(response.sessionState.sessionAttributes.staffPreference, undefined);
  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.ok(["customerName", "requestedDate"].includes(response.sessionState.dialogAction.slotToElicit));
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.notEqual(response.sessionState.sessionAttributes.transferToQueue, "true");
  assert.notEqual(response.sessionState.sessionAttributes.forceHumanEscalation, "true");
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.currentTurnTranscript, "4");
  assert.equal(fetchCalls[0].body.attributes.lexTurnDebug.dtmfRouting.accepted, true);
  assert.equal(fetchCalls[0].body.attributes.lexTurnDebug.dtmfRouting.selection, "Full Set");
});

test("DialogCodeHook clears stale requestedTime when Full Set speech is recognized from service prompt", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called before requestedDate is collected");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "ah i want full set",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "a1738e9e-fd50-493f-a7ce-2afaff660573",
          lastAskedSlot: "serviceName",
          requestedTime: "4 PM",
          errorCount: "3",
          fallbackCount: "3",
          askedSlotsCount: "3"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {
            serviceName: slotWith({
              originalValue: "full set",
              interpretedValue: "Full Set",
              resolvedValues: ["Full Set"]
            })
          }
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "requestedDate");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.requestedTime, undefined);
  assert.equal(response.sessionState.sessionAttributes.lastAskedSlot, "requestedDate");
  assert.equal(response.sessionState.sessionAttributes.askedSlotsCount, "1");
  assert.equal(response.sessionState.sessionAttributes.fallbackCount, "1");
  assert.equal(response.sessionState.sessionAttributes.errorCount, "1");
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.notEqual(response.sessionState.sessionAttributes.transferToQueue, "true");
});

test("DialogCodeHook Full Set then tomorrow preserves service and asks next missing slot", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called before local date recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "tomorrow",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-full-set-tomorrow",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          lastAskedSlot: "requestedDate"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.requestedDate, usEasternDate(1));
  assert.equal(response.sessionState.dialogAction.slotToElicit, "requestedTime");
  assert.equal(response.sessionState.sessionAttributes.lastAskedSlot, "requestedTime");
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "serviceName");
});

test("DialogCodeHook Full Set then tomorrow ignores ungrounded Lex requestedTime", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called before local date recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "tomorrow",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-full-set-tomorrow-polluted-time",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          lastAskedSlot: "requestedDate"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {
            requestedDate: slotWith({
              originalValue: "tomorrow",
              interpretedValue: usEasternDate(1),
              resolvedValues: [usEasternDate(1)]
            }),
            requestedTime: slotWith({
              originalValue: "4 PM",
              interpretedValue: "4 PM",
              resolvedValues: ["4 PM"]
            })
          }
        }
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.requestedDate, usEasternDate(1));
  assert.equal(response.sessionState.sessionAttributes.requestedTime, undefined);
  assert.equal(response.sessionState.dialogAction.slotToElicit, "requestedTime");
  assert.equal(response.sessionState.sessionAttributes.lastAskedSlot, "requestedTime");
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.deepEqual(JSON.parse(response.sessionState.sessionAttributes.ignoredUngroundedSlots), [
    "requestedTime"
  ]);
});

test("DialogCodeHook Full Set then tomorrow then 3 PM never asks service again", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called before local time recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "3 PM",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-full-set-time",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(1),
          lastAskedSlot: "requestedTime"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.requestedDate, usEasternDate(1));
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "3 PM");
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "serviceName");
});

test("FallbackIntent 3 PM continues booking with confirmed Full Set", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called before local fallback time recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "3 PM",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-fallback-time-full-set",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(1),
          lastAskedSlot: "requestedTime"
        },
        intent: {
          name: "FallbackIntent",
          state: "InProgress",
          confirmationState: "None",
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.requestedDate, usEasternDate(1));
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "3 PM");
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.doesNotMatch(response.messages?.[0]?.content || "", /service/i);
});

test("DialogCodeHook number four maps to Full Set when serviceName was last asked", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for local spoken DTMF recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "number four",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-number-four-service",
          lastAskedSlot: "serviceName"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "requestedDate");
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "serviceName");
});

test("DialogCodeHook initial DTMF 4 maps to Full Set without lastAskedSlot", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for initial service DTMF recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputMode: "DTMF",
      inputTranscript: "4",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-initial-dtmf4"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {
            requestedTime: slot("4 PM")
          }
        }
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.requestedTime, undefined);
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "serviceName");
});

test("DialogCodeHook active service DTMF menu routes 4 to Full Set", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for active service DTMF recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputMode: "Text",
      inputTranscript: "4",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-active-menu-service-4",
          lastAskedSlot: "serviceName",
          activeDtmfMenu: "service",
          activeDtmfOptionsJson: JSON.stringify({ "4": "Full Set" })
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {
            requestedTime: slot("4 PM")
          }
        }
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.requestedTime, undefined);
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "serviceName");
});

test("DialogCodeHook phone set resolves to canonical Full Set while booking service", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for local phone set service recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "phone set",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-phone-set-alias"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.intent.slots.serviceName.value.interpretedValue, "Full Set");
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.notEqual(response.sessionState.sessionAttributes.transferToQueue, "true");
});

test("DialogCodeHook keeps date time and Trang when full utterance says phone set", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for local phone set full utterance recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "I want to book a phone set tomorrow at 3 PM with Trang",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-phone-set-full-utterance"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.requestedDate, usEasternDate(1));
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "3 PM");
  assert.equal(response.sessionState.sessionAttributes.staffPreference, "Trang");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "customerName");
  assert.notEqual(response.sessionState.sessionAttributes.transferToQueue, "true");
});

test("DialogCodeHook clears one-letter staff noise and asks staff again without API staffPreference", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message:
            "Do you prefer Trang, Amy, Kelly, or first available? Press 1 for Trang, 2 for Amy, 3 for Kelly, 4 for first available, or 0 for an operator.",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitSlot",
            slotToElicit: "staffPreference"
          },
          sessionAttributes: dynamicStaffAttributes()
        },
        missingFields: ["staffPreference"]
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "m",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-staff-noise",
          lastAskedSlot: "staffPreference",
          customerName: "Kiet Nguyen",
          customerPhone: "7325956266",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(1),
          requestedTime: "3 PM",
          ...dynamicStaffAttributes()
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {
            staffPreference: slot("m")
          }
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "staffPreference");
  assert.equal(response.sessionState.sessionAttributes.staffPreference, undefined);
  assert.equal(response.sessionState.sessionAttributes.staffId, undefined);
  assert.equal(fetchCalls[0].body.staffPreference, undefined);
  assert.equal(fetchCalls[0].body.attributes.staffPreference, undefined);
});

test("DialogCodeHook customerName noise does not persist sorry", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for customer name noise");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "sorry",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-customer-name-sorry",
          lastAskedSlot: "customerName",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(1),
          requestedTime: "3 PM",
          customerPhone: "7325956266"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {
            customerName: slot("sorry")
          }
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "customerName");
  assert.equal(response.sessionState.sessionAttributes.customerName, undefined);
  assert.deepEqual(JSON.parse(response.sessionState.sessionAttributes.ignoredNoiseFields), [
    "customerName"
  ]);
  assert.equal(
    response.messages[0].content,
    "Got it: Full Set tomorrow at 3 PM. What name should I put on the appointment?"
  );
});

test("Full utterance asks only for customer name with persisted slot state", async () => {
  const handler = await loadHandler();
  installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "No known caller name.",
          messageContentType: "PlainText",
          sessionAttributes: {}
        },
        missingFields: ["customerName"]
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "i want to book a full set tomorrow at two p m with trang",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-full-utterance-name",
          operatorHelpMentioned: "true"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "customerName");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.requestedDate, usEasternDate(1));
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "2 PM");
  assert.equal(response.sessionState.sessionAttributes.staffPreference, "Trang");
  assert.equal(response.sessionState.sessionAttributes.customerPhone, "+84798171999");
  assert.equal(response.sessionState.sessionAttributes.lastAskedSlot, "customerName");
  assert.equal(response.sessionState.sessionAttributes.slotToElicit, "customerName");
  assert.match(response.messages[0].content, /Got it: Full Set tomorrow at 2 PM with Trang/i);
  assert.doesNotMatch(response.messages[0].content, /service|Press 0|press 0/i);
});

test("Repeat service while asking customerName keeps context and does not reset", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock(() =>
    jsonResponse({
      outcome: "MISSING_INFO",
      lexResponse: {
        fulfillmentState: "InProgress",
        message: "Logged.",
        sessionAttributes: {}
      }
    })
  );

  for (const slots of [{ customerName: slot("full set") }, { serviceName: slot("Full Set") }]) {
    const response = await handler(
      baseEvent({
        invocationSource: "DialogCodeHook",
        inputTranscript: "full set",
        sessionState: {
          ...baseEvent().sessionState,
          sessionAttributes: {
            salonId: "salon-explicit",
            CalledNumber: "+18483487681",
            CustomerEndpointAddress: "+84798171999",
            AmazonConnectContactId: "connect-repeat-service-name",
            lastAskedSlot: "customerName",
            serviceName: "Full Set",
            confirmedServiceName: "Full Set",
            requestedDate: usEasternDate(1),
            requestedTime: "2 PM",
            staffPreference: "Trang",
            customerPhone: "+84798171999",
            operatorHelpMentioned: "true"
          },
          intent: {
            ...baseEvent().sessionState.intent,
            slots
          }
        }
      })
    );

    assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
    assert.equal(response.sessionState.dialogAction.slotToElicit, "customerName");
    assert.equal(response.sessionState.sessionAttributes.lastAskedSlot, "customerName");
    assert.equal(response.sessionState.sessionAttributes.slotToElicit, "customerName");
    assert.equal(
      response.messages[0].content,
      "I already have Full Set for tomorrow at 2 PM with Trang. What name should I put on the appointment?"
    );
    assert.doesNotMatch(response.messages[0].content, /Sorry|service/i);
    assert.equal(response.sessionState.sessionAttributes.customerName, undefined);
  }
  assert.equal(fetchCalls.length, 2);
  for (const call of fetchCalls) {
    assert.equal(call.body.currentTurnTranscript, "full set");
    assert.equal(call.body.attributes.lastAskedSlot, "customerName");
    assert.equal(call.body.attributes.ignoredNoiseFields, JSON.stringify(["customerName"]));
  }
});

test("DialogCodeHook digit 4 at requestedDate does not become time or service", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for wrong-slot DTMF");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputMode: "Speech",
      inputTranscript: "4",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-wrong-slot-4",
          lastAskedSlot: "requestedDate",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {
            requestedTime: slotWith({
              originalValue: "4 PM",
              interpretedValue: "4 PM",
              resolvedValues: ["4 PM"]
            })
          }
        }
      }
    })
  );

  const routing = JSON.parse(response.sessionState.sessionAttributes.dtmfRouting);
  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "requestedDate");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.requestedTime, undefined);
  assert.equal(routing.digit, "4");
  assert.equal(routing.route, "wrong_slot");
  assert.equal(routing.accepted, false);
  assert.equal(routing.nextSlot, "requestedDate");
  assert.equal(response.messages[0].content, "What day would you like? You can say today or tomorrow.");
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "serviceName");
});

test("DialogCodeHook preserves Full Set tomorrow 3 PM when next turn is spoken digit noise", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message:
            "Which staff would you like? You can say Trang, Amy, Kelly, or first available. For staff, press 1 for Trang, 2 for Amy, 3 for Kelly, 4 for first available. Press 0 for an operator.",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitSlot",
            slotToElicit: "staffPreference"
          },
          sessionAttributes: dynamicStaffAttributes()
        },
        missingFields: ["staffPreference"]
      })
    )
  );

  for (const inputTranscript of ["two, three.", "two three", "2 3", "23"]) {
    const response = await handler(
      baseEvent({
        invocationSource: "DialogCodeHook",
        inputMode: "Speech",
        inputTranscript,
        sessionState: {
          ...baseEvent().sessionState,
          sessionAttributes: {
            salonId: "salon-explicit",
            CalledNumber: "+18483487681",
            CustomerEndpointAddress: "+84798171999",
            AmazonConnectContactId: `connect-live-noise-${inputTranscript.replace(/\W+/g, "-")}`,
            lastAskedSlot: "requestedDate",
            serviceName: "Full Set",
            confirmedServiceName: "Full Set",
            requestedDate: usEasternDate(1),
            requestedTime: "3 PM",
            customerName: "Thuyet",
            recognizedCustomerName: "Thuyet",
            customerNameSource: "phone_lookup",
            customerPhone: "+84798171999"
          },
          intent: {
            ...baseEvent().sessionState.intent,
            slots: {
              requestedDate: slotWith({
                originalValue: inputTranscript,
                interpretedValue: "2027-02-03",
                resolvedValues: ["2027-02-03"]
              }),
              requestedTime: slotWith({
                originalValue: inputTranscript,
                interpretedValue: "2 PM",
                resolvedValues: ["2 PM"]
              })
            }
          }
        }
      })
    );

    const latestFetch = fetchCalls.at(-1);
    assert.equal(latestFetch.body.requestedDate, usEasternDate(1), inputTranscript);
    assert.equal(latestFetch.body.requestedTime, "3 PM", inputTranscript);
    assert.notEqual(latestFetch.body.requestedDate, "2027-02-03", inputTranscript);
    assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set", inputTranscript);
    assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set", inputTranscript);
    assert.equal(response.sessionState.sessionAttributes.requestedDate, usEasternDate(1), inputTranscript);
    assert.equal(response.sessionState.sessionAttributes.requestedTime, "3 PM", inputTranscript);
    assert.equal(response.sessionState.dialogAction.type, "ElicitSlot", inputTranscript);
    assert.equal(response.sessionState.dialogAction.slotToElicit, "staffPreference", inputTranscript);
    assert.equal(response.sessionState.sessionAttributes.lastAskedSlot, "staffPreference", inputTranscript);
    assert.notEqual(response.sessionState.dialogAction.slotToElicit, "serviceName", inputTranscript);
    assert.notEqual(response.sessionState.dialogAction.slotToElicit, "requestedDate", inputTranscript);
    assert.notEqual(response.sessionState.dialogAction.slotToElicit, "requestedTime", inputTranscript);
    assert.deepEqual(
      latestFetch.body.attributes.lexTurnDebug.dtmfDiagnostics.digitsExtractedSequence,
      ["2", "3"],
      inputTranscript
    );
    assert.ok(
      latestFetch.body.attributes.lexTurnDebug.sanitization.ignoredUngroundedSlots.includes(
        "requestedDate_digit_sequence_not_grounded"
      ),
      inputTranscript
    );
  }
});

test("press 0 from service prompt escalates to operator", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "HUMAN_ESCALATION",
        appointment: null,
        lexResponse: {
          fulfillmentState: "Fulfilled",
          message: "Please wait while I connect you.",
          messageContentType: "PlainText",
          sessionAttributes: {
            transferToQueue: "true",
            forceHumanEscalation: "true",
            escalationReason: "customer_pressed_zero"
          }
        }
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "0",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          ...baseEvent().sessionState.sessionAttributes,
          lastAskedSlot: "serviceName"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "Close");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "true");
  assert.equal(response.sessionState.sessionAttributes.escalationReason, "customer_pressed_zero");
  assert.equal(fetchCalls[0].body.attributes.lexTurnDebug.dtmfRouting.digit, "0");
  assert.equal(fetchCalls[0].body.attributes.lexTurnDebug.dtmfRouting.route, "operator_transfer");
  assert.equal(fetchCalls[0].body.attributes.lexTurnDebug.dtmfRouting.accepted, true);
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
          requestedTime: "3 PM",
          ...dynamicStaffAttributes()
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
  assert.equal(response.sessionState.sessionAttributes.staffId, "staff-trang");
  assert.equal(response.sessionState.sessionAttributes.selectedStaffId, "staff-trang");
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
          requestedTime: "3 PM",
          ...dynamicStaffAttributes()
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
  assert.equal(response.sessionState.sessionAttributes.staffId, "staff-kelly");
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
          requestedTime: "3 PM",
          ...dynamicStaffAttributes()
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
  assert.equal(response.sessionState.sessionAttributes.staffId, undefined);
  assert.equal(response.sessionState.sessionAttributes.selectedStaffId, undefined);
});

test("DialogCodeHook active staff DTMF menu routes 4 before stale lastAskedSlot", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for active staff DTMF recovery");
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
          AmazonConnectContactId: "connect-active-menu-staff-4",
          lastAskedSlot: "serviceName",
          activeDtmfMenu: "staff",
          activeDtmfOptionsJson: JSON.stringify({
            "1": "Trang",
            "2": "Amy",
            "3": "Kelly",
            "4": "Any staff"
          }),
          customerName: "Kiet Nguyen",
          customerPhone: "7325956266",
          serviceName: "Pedicure",
          requestedDate: usEasternDate(1),
          requestedTime: "3 PM",
          ...dynamicStaffAttributes()
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
  assert.equal(response.sessionState.intent.slots.serviceName.value.interpretedValue, "Pedicure");
  assert.equal(response.sessionState.sessionAttributes.confirmedStaffName, "Any staff");
  assert.notEqual(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.staffId, undefined);
});

test("press 0 from staff prompt escalates to operator", async () => {
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
            transferToQueue: "true",
            forceHumanEscalation: "true",
            escalationReason: "customer_pressed_zero"
          }
        }
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "0",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          ...baseEvent().sessionState.sessionAttributes,
          lastAskedSlot: "staffPreference",
          ...dynamicStaffAttributes()
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "Close");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "true");
  assert.equal(response.sessionState.sessionAttributes.escalationReason, "customer_pressed_zero");
});

test("DialogCodeHook invalid staff DTMF repeats the dynamic staff list once", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for invalid staff DTMF");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "9",
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
          requestedTime: "3 PM",
          ...dynamicStaffAttributes()
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
  assert.match(response.messages[0].content, /I didn't find that option/i);
  assert.match(response.messages[0].content, /press 1 for Trang/i);
  assert.equal(response.sessionState.sessionAttributes.invalidStaffDtmfSelection, "9");
});

test("DialogCodeHook recovers Kelly staff alias from transcript", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock(() => {
    throw new Error("fetch should not be called for local DialogCodeHook recovery");
  });

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

  assert.equal(fetchCalls.length, 0);
  assert.equal(response.sessionState.dialogAction.type, "Delegate");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Pedicure");
  assert.equal(response.sessionState.sessionAttributes.requestedDate, usEasternDate(1));
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "2 PM");
  assert.equal(response.sessionState.sessionAttributes.staffPreference, "Kelly");
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

test("explicit human utterance transfers even when Lex intent is booking", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "HUMAN_ESCALATION",
        appointment: null,
        lexResponse: {
          fulfillmentState: "Fulfilled",
          message: "Please wait while I connect you.",
          messageContentType: "PlainText",
          sessionAttributes: {
            transferToQueue: "true",
            forceHumanEscalation: "true",
            escalationReason: "caller_requested_human"
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
          name: "BookAppointmentIntent"
        }
      }
    })
  );

  assert.equal(fetchCalls[0].body.intentName, "HumanEscalationIntent");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "true");
});

test("BookAppointmentIntent backend human escalation response is suppressed without explicit request", async () => {
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
  assert.equal(response.sessionState.sessionAttributes.forceHumanEscalation, "false");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "false");
  assert.equal(response.sessionState.sessionAttributes.queueId, undefined);
  assert.doesNotMatch(response.messages[0].content, /press 0 to speak with an operator/i);
  assert.doesNotMatch(response.messages[0].content, /goodbye/i);
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

test("BookAppointmentIntent backend non-OK response reprompts without auto transfer", async () => {
  const handler = await loadHandler();
  installFetchMock(() => ({
    ok: false,
    status: 500,
    text: async () => '{"error":"database stack trace with secret debug text"}'
  }));

  const response = await handler(baseEvent());

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.sessionAttributes.forceHumanEscalation, "false");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "false");
  assert.equal(response.sessionState.sessionAttributes.backendFailureReason, "backend_error");
  assert.match(response.messages[0].content, /I still have Pedicure/i);
  assert.doesNotMatch(response.messages[0].content, /press 0 to speak with an operator/i);
  assert.doesNotMatch(response.messages[0].content, /database|stack|secret|debug/i);
});

test("BookAppointmentIntent backend failure after Full Set does not ask service again", async () => {
  const handler = await loadHandler();
  installFetchMock(() => ({
    ok: false,
    status: 500,
    text: async () => '{"error":"database stack trace with secret debug text"}'
  }));

  const response = await handler(
    baseEvent({
      invocationSource: "FulfillmentCodeHook",
      inputTranscript: "3 PM",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-backend-failure-full-set",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(1),
          requestedTime: "3 PM",
          customerName: "Thuyet",
          customerPhone: "7325956266",
          staffPreference: "Trang"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.forceHumanEscalation, "false");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "false");
  assert.match(response.messages[0].content, /I still have Full Set/i);
  assert.doesNotMatch(response.messages[0].content, /What service/i);
});

test("BookAppointmentIntent backend thrown error reprompts without auto transfer", async () => {
  const handler = await loadHandler();
  installFetchMock(() => {
    throw new Error("connection refused with internal host details");
  });

  const response = await handler(baseEvent());

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.sessionAttributes.forceHumanEscalation, "false");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "false");
  assert.equal(response.sessionState.sessionAttributes.backendFailureReason, "backend_unreachable");
  assert.match(response.messages[0].content, /I still have Pedicure/i);
  assert.doesNotMatch(response.messages[0].content, /press 0 to speak with an operator/i);
  assert.doesNotMatch(response.messages[0].content, /goodbye/i);
  assert.doesNotMatch(response.messages[0].content, /internal host|connection refused/i);
});

test("BookAppointmentIntent backend timeout reprompts with wait prompt and no auto transfer", async () => {
  const handler = await loadHandler({ BOOKING_HANDLER_API_TIMEOUT_MS: "5" });
  installFetchMock((url, options) =>
    abortableDelayedJsonResponse(successfulBackendPayload(), 50, options.signal)
  );

  const response = await handler(baseEvent());

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.sessionAttributes.forceHumanEscalation, "false");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "false");
  assert.equal(response.sessionState.sessionAttributes.backendFailureReason, "backend_timeout");
  assert.match(response.messages[0].content, /I still have Pedicure/i);
  assert.doesNotMatch(response.messages[0].content, /goodbye/i);
});

test("BookAppointmentIntent backend not configured reprompts with wait prompt and no auto transfer", async () => {
  const handler = await loadHandler({
    FASTAIBOOKING_API_BASE_URL: "",
    FASTAIBOOKING_API_INTERNAL_TOKEN: ""
  });

  const response = await handler(baseEvent());

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.sessionAttributes.forceHumanEscalation, "false");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "false");
  assert.equal(response.sessionState.sessionAttributes.backendFailureReason, "backend_not_configured");
  assert.match(response.messages[0].content, /I still have Pedicure/i);
  assert.doesNotMatch(response.messages[0].content, /goodbye/i);
});

test("Lex exports route first-turn service digits through BookAppointmentIntent", () => {
  for (const { version, root } of lexRoots) {
    const bookIntent = JSON.parse(
      readFileSync(
        path.join(root, "BotLocales/en_US/Intents/BookAppointmentIntent/Intent.json"),
        "utf8"
      )
    );
    const humanIntent = JSON.parse(
      readFileSync(
        path.join(root, "BotLocales/en_US/Intents/HumanEscalationIntent/Intent.json"),
        "utf8"
      )
    );
    const bookUtterances = new Set(bookIntent.sampleUtterances.map((item) => item.utterance));
    const humanUtterances = new Set(humanIntent.sampleUtterances.map((item) => item.utterance));

    for (const digit of ["1", "2", "3", "4", "5"]) {
      assert.ok(bookUtterances.has(digit), `${version} BookAppointmentIntent missing ${digit}`);
      assert.ok(bookUtterances.has(`press ${digit}`), `${version} BookAppointmentIntent missing press ${digit}`);
      assert.ok(bookUtterances.has(`number ${digit}`), `${version} BookAppointmentIntent missing number ${digit}`);
    }
    assert.ok(bookUtterances.has("{serviceName}"), `${version} BookAppointmentIntent missing service-only utterance`);
    assert.equal(
      bookIntent.initialResponseSetting.nextStep.dialogAction.type,
      "InvokeDialogCodeHook"
    );
    assert.equal(bookIntent.initialResponseSetting.codeHook.isActive, true);
    assert.equal(bookIntent.initialResponseSetting.codeHook.enableCodeHookInvocation, true);
    assert.ok(humanUtterances.has("0"), `${version} HumanEscalationIntent missing 0`);
    assert.ok(humanUtterances.has("press 0"), `${version} HumanEscalationIntent missing press 0`);
    assert.ok(humanUtterances.has("number 0"), `${version} HumanEscalationIntent missing number 0`);
  }
});
