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
  const queueTransfer = actionsById.get(queueUpdate.Transitions.NextAction);

  assert.equal(startAction.Type, "UpdateContactTextToSpeechVoice");
  assert.equal(waitPrompt.Type, "MessageParticipant");
  assert.match(waitPrompt.Parameters.Text, /^Please wait while I connect you\./);
  assert.equal(queueUpdate.Type, "UpdateContactTargetQueue");
  assert.equal(queueTransfer.Type, "TransferContactToQueue");
});

test("Connect AI reception Lex error branch waits and transfers instead of saying goodbye", () => {
  const aiReceptionFlow = JSON.parse(
    readFileSync(path.join(connectRoot, "ai-reception.json"), "utf8")
  );
  const actionsById = new Map(aiReceptionFlow.Actions.map((action) => [action.Identifier, action]));
  const errorPrompt = actionsById.get("41e3f239-5b57-4363-92fc-9d594579fa98");

  assert.equal(errorPrompt.Type, "MessageParticipant");
  assert.match(errorPrompt.Parameters.Text, /Please wait while I connect you to our team/i);
  assert.doesNotMatch(errorPrompt.Parameters.Text, /goodbye|call back later/i);
  assert.equal(errorPrompt.Transitions.NextAction, "transfer-human-escalation-flow");
});

test("DialogCodeHook with service and time does not call backend for staff prompt", async () => {
  const handler = await loadHandler({ BOOKING_HANDLER_API_TIMEOUT_MS: "2800" });
  const startedAt = Date.now();
  const fetchCalls = installFetchMock(() => {
    throw new Error("fetch should not be called for local DialogCodeHook prompts");
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
          AmazonConnectContactId: "connect-slow-staff"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 0);
  assert.equal(Date.now() - startedAt < 1000, true);
  assert.equal(response.sessionState.dialogAction.type, "Delegate");
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
  assert.doesNotMatch(response.messages[0].content, /press 1 for Pedicure/i);
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

test("DialogCodeHook known caller with service and time delegates without staff prompt", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock(() => {
    throw new Error("fetch should not be called for local DialogCodeHook recovery");
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
  assert.equal(response.sessionState.sessionAttributes.customerName, "Kiet");
  assert.equal(response.sessionState.sessionAttributes.customerPhone, "+17325956266");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Pedicure");
  assert.equal(response.sessionState.sessionAttributes.requestedDate, usEasternDate(1));
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "3 PM");
});

test("DialogCodeHook recovers logged eddie here pedicure utterance without staff lookup", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock(() => {
    throw new Error("fetch should not be called for local DialogCodeHook recovery");
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

  assert.equal(response.sessionState.dialogAction.type, "Delegate");
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
    assert.equal(response.sessionState.intent.slots.serviceName.value.interpretedValue, "Full Set");
  }
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
});

test("press 0 from service prompt escalates to operator", async () => {
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

test("BookAppointmentIntent backend human escalation response transfers safely", async () => {
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

  assert.equal(response.sessionState.dialogAction.type, "Close");
  assert.equal(response.sessionState.sessionAttributes.forceHumanEscalation, "true");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "true");
  assert.equal(response.sessionState.sessionAttributes.queueId, "queue-from-backend");
  assert.match(response.messages[0].content, /Please wait/i);
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

test("BookAppointmentIntent backend non-OK response escalates safely", async () => {
  const handler = await loadHandler();
  installFetchMock(() => ({
    ok: false,
    status: 500,
    text: async () => '{"error":"database stack trace with secret debug text"}'
  }));

  const response = await handler(baseEvent());

  assert.equal(response.sessionState.dialogAction.type, "Close");
  assert.equal(response.sessionState.sessionAttributes.forceHumanEscalation, "true");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "true");
  assert.equal(response.sessionState.sessionAttributes.escalationReason, "backend_error");
  assert.match(response.messages[0].content, /taking longer than expected/i);
  assert.doesNotMatch(response.messages[0].content, /database|stack|secret|debug/i);
});

test("BookAppointmentIntent backend thrown error escalates safely", async () => {
  const handler = await loadHandler();
  installFetchMock(() => {
    throw new Error("connection refused with internal host details");
  });

  const response = await handler(baseEvent());

  assert.equal(response.sessionState.dialogAction.type, "Close");
  assert.equal(response.sessionState.sessionAttributes.forceHumanEscalation, "true");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "true");
  assert.equal(response.sessionState.sessionAttributes.escalationReason, "backend_unreachable");
  assert.match(response.messages[0].content, /Please wait/i);
  assert.doesNotMatch(response.messages[0].content, /goodbye/i);
  assert.doesNotMatch(response.messages[0].content, /internal host|connection refused/i);
});

test("BookAppointmentIntent backend timeout escalates with wait prompt and no goodbye", async () => {
  const handler = await loadHandler({ BOOKING_HANDLER_API_TIMEOUT_MS: "5" });
  installFetchMock((url, options) =>
    abortableDelayedJsonResponse(successfulBackendPayload(), 50, options.signal)
  );

  const response = await handler(baseEvent());

  assert.equal(response.sessionState.dialogAction.type, "Close");
  assert.equal(response.sessionState.sessionAttributes.forceHumanEscalation, "true");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "true");
  assert.equal(response.sessionState.sessionAttributes.escalationReason, "backend_timeout");
  assert.match(response.messages[0].content, /Please wait/i);
  assert.doesNotMatch(response.messages[0].content, /goodbye/i);
});

test("BookAppointmentIntent backend not configured escalates with wait prompt and no goodbye", async () => {
  const handler = await loadHandler({
    FASTAIBOOKING_API_BASE_URL: "",
    FASTAIBOOKING_API_INTERNAL_TOKEN: ""
  });

  const response = await handler(baseEvent());

  assert.equal(response.sessionState.dialogAction.type, "Close");
  assert.equal(response.sessionState.sessionAttributes.forceHumanEscalation, "true");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "true");
  assert.equal(response.sessionState.sessionAttributes.escalationReason, "backend_not_configured");
  assert.match(response.messages[0].content, /Please wait/i);
  assert.doesNotMatch(response.messages[0].content, /goodbye/i);
});
