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
        staffPreference: slot("Mia Carter")
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
    sessionAttributes: {
      transferToQueue: "true",
      fallbackMode: "operator_queue",
      queueId: "queue-from-backend"
    }
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
  assert.equal(fetchCalls[0].body.customerName, "Kiet Nguyen");
  assert.equal(fetchCalls[0].body.customerPhone, "7325956266");
  assert.equal(fetchCalls[0].body.serviceName, "Pedicure");
  assert.equal(fetchCalls[0].body.requestedDate, "tomorrow");
  assert.equal(fetchCalls[0].body.requestedTime, "five PM");
  assert.equal(fetchCalls[0].body.staffPreference, "Mia Carter");
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
      transferToQueue: "true",
      fallbackMode: "operator_queue",
      queueId: "queue-from-backend"
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
  assert.equal(response.sessionState.intent.slots.customerName.value.interpretedValue, "Kiet Nguyen");
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

test("human escalation utterance overrides a different Lex intent", async () => {
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
            forceHumanEscalation: "true",
            transferToQueue: "true"
          }
        }
      })
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

  assert.equal(fetchCalls[0].body.intentName, "HumanEscalationIntent");
});

test("cancel and reschedule intents hand off to backend-driven human flow", async () => {
  for (const intentName of ["CancelAppointmentIntent", "RescheduleAppointmentIntent"]) {
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
              forceHumanEscalation: "true",
              transferToQueue: "true",
              escalationReason: "caller_requested_human"
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
    assert.equal(response.messages[0].content, "Please wait while I connect you.");
    delete globalThis.fetch;
  }
});

test("backend non-OK response returns caller-safe escalation without exposing debug text", async () => {
  const handler = await loadHandler();
  installFetchMock(() => ({
    ok: false,
    status: 500,
    text: async () => '{"error":"database stack trace with secret debug text"}'
  }));

  const response = await handler(baseEvent());

  assert.equal(response.sessionState.intent.state, "Failed");
  assert.equal(response.sessionState.sessionAttributes.forceHumanEscalation, "true");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "true");
  assert.equal(response.sessionState.sessionAttributes.escalationReason, "backend_error");
  assert.equal(response.sessionState.sessionAttributes.queueId, "queue-default");
  assert.doesNotMatch(response.messages[0].content, /database|stack|secret|debug/i);
});

test("backend thrown error returns caller-safe human escalation", async () => {
  const handler = await loadHandler();
  installFetchMock(() => {
    throw new Error("connection refused with internal host details");
  });

  const response = await handler(baseEvent());

  assert.equal(response.sessionState.intent.state, "Failed");
  assert.equal(response.sessionState.sessionAttributes.forceHumanEscalation, "true");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "true");
  assert.equal(response.sessionState.sessionAttributes.escalationReason, "backend_error");
  assert.doesNotMatch(response.messages[0].content, /internal host|connection refused/i);
});
