import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const lambdaPath = path.join(repoRoot, "infra/lambda/booking-handler/index.mjs");
const apiAiServicePath = path.join(repoRoot, "apps/api/src/modules/ai/ai.service.ts");
const lexRoots = ["v7", "v8", "v10"].map((version) => ({
  version,
  root: path.join(repoRoot, `infra/aws/lex/FastAIBookingBot-${version}`)
}));
const connectRoot = path.join(repoRoot, "infra/aws/connect/contact-flows");
const CANONICAL_SERVICE_PROMPT =
  "Hi, thanks for calling Kiet Nails. How can I help? You can say the service, day, time, and technician in one sentence. Press 0 for a person.";
const FIRST_SERVICE_RETRY_PROMPT = "Sorry, what service would you like?";
const SERVICE_MENU_PROMPT =
  "I can list the services once. Press 1 for Pedicure, 2 for Manicure, 3 for Gel Manicure, 4 for Full Set, 5 for Dip Powder, or 0 for a person.";
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

test("production Full Set aliases are present in Lambda, API, and Lex v10 source", () => {
  const requiredAliases = [
    "room set",
    "pull set",
    "pull step",
    "pool set",
    "full step",
    "full said",
    "fall set",
    "phone set"
  ];
  const lambdaSource = readFileSync(lambdaPath, "utf8");
  const apiSource = readFileSync(apiAiServicePath, "utf8");
  const lexSlotType = JSON.parse(
    readFileSync(
      path.join(
        repoRoot,
        "infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/SlotTypes/NailServiceType/SlotType.json"
      ),
      "utf8"
    )
  );
  const fullSetLexValue = lexSlotType.slotTypeValues.find(
    (entry) => entry.sampleValue?.value === "Full Set"
  );
  const lexAliases = new Set(fullSetLexValue.synonyms.map((synonym) => synonym.value));

  for (const alias of requiredAliases) {
    assert.match(lambdaSource, new RegExp(`"${alias}"`), `Lambda missing ${alias}`);
    assert.match(apiSource, new RegExp(`"${alias}"`), `API missing ${alias}`);
    assert.equal(lexAliases.has(alias), true, `Lex v10 missing ${alias}`);
  }
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
        spec.updateResponse.frequencyInSeconds <= (intentName === "BookAppointmentIntent" ? 5 : 3),
        true,
        `${version} ${intentName} progress update cadence`
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

test("Lex customerName failure path invokes the booking dialog hook instead of FallbackIntent", () => {
  for (const { version, root } of lexRoots) {
    const slotExport = JSON.parse(
      readFileSync(
        path.join(
          root,
          "BotLocales/en_US/Intents/BookAppointmentIntent/Slots/customerName/Slot.json"
        ),
        "utf8"
      )
    );
    const failureNextStep =
      slotExport.valueElicitationSetting?.slotCaptureSetting?.failureNextStep;

    assert.equal(
      failureNextStep?.dialogAction?.type,
      "InvokeDialogCodeHook",
      `${version} customerName failure stays in booking dialog`
    );
    assert.notEqual(
      failureNextStep?.intent?.name,
      "FallbackIntent",
      `${version} customerName failure must not start fallback intent`
    );
    assert.equal(
      failureNextStep?.sessionAttributes?.lastAskedSlot,
      "customerName",
      `${version} customerName failure preserves active slot`
    );
    assert.equal(
      slotExport.valueElicitationSetting?.slotCaptureSetting?.codeHook?.active,
      true,
      `${version} customerName failure dialog hook is active`
    );
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

const collectReachableActions = (flow) => {
  const actionsById = new Map(flow.Actions.map((action) => [action.Identifier, action]));
  const reachable = new Set();
  const stack = [flow.StartAction];
  while (stack.length) {
    const id = stack.pop();
    if (!id || reachable.has(id)) {
      continue;
    }
    reachable.add(id);
    const transitions = actionsById.get(id)?.Transitions || {};
    if (transitions.NextAction) {
      stack.push(transitions.NextAction);
    }
    for (const condition of transitions.Conditions || []) {
      if (condition.NextAction) {
        stack.push(condition.NextAction);
      }
    }
    for (const error of transitions.Errors || []) {
      if (error.NextAction) {
        stack.push(error.NextAction);
      }
    }
  }
  return { actionsById, reachable };
};

test("Connect AI reception has one reachable greeting and no outer service prompt loop", () => {
  const aiReceptionFlow = JSON.parse(
    readFileSync(path.join(connectRoot, "ai-reception.json"), "utf8")
  );
  const { actionsById, reachable } = collectReachableActions(aiReceptionFlow);
  const reachableGreetingActions = [...reachable]
    .map((id) => actionsById.get(id))
    .filter((action) => action?.Parameters?.Text === CANONICAL_SERVICE_PROMPT);

  assert.equal(reachableGreetingActions.length, 1);
  for (const id of reachable) {
    const action = actionsById.get(id);
    const next = actionsById.get(action?.Transitions?.NextAction);
    const text = action?.Parameters?.Text || "";
    const asksQuestion = /\?|what service|which service|are you still there|tell me the appointment/i.test(text);
    assert.ok(
      !(action?.Type === "MessageParticipant" && asksQuestion && next?.Type === "ConnectParticipantWithLexBot"),
      `${id} asks outside an input-collecting Lex turn`
    );
  }

  const primary = actionsById.get("3b2877ca-bc16-4019-a8e6-04200c0ded06");
  const recovery = actionsById.get("6fbf4310-c8c6-44a8-a8f5-1d7830974c4d");
  assert.equal(primary.Parameters.Text, CANONICAL_SERVICE_PROMPT);
  assert.doesNotMatch(primary.Parameters.Text, /press 1 for Pedicure/i);
  assert.equal(primary.Parameters.LexSessionAttributes["x-amz-lex:allow-interrupt:*:*"], "true");
  assert.equal(primary.Parameters.LexSessionAttributes["x-amz-lex:audio:end-timeout-ms:*:*"], "1300");
  assert.equal(recovery.Parameters.Text, "Sorry, I missed that. Please tell me what you need, or press 0 for a person.");
  assert.equal(recovery.Transitions.NextAction, "check-transfer-to-queue");
  assert.equal(recovery.Parameters.LexSessionAttributes.confirmationFingerprint, "$.Lex.SessionAttributes.confirmationFingerprint");
  assert.equal(recovery.Parameters.LexSessionAttributes.aiAlternativeSlots, "$.Lex.SessionAttributes.aiAlternativeSlots");
  assert.doesNotMatch(JSON.stringify(recovery.Parameters.LexSessionAttributes), /activeDtmfMenu|Pedicure|Full Set/i);
});

test("Connect AI reception routes only explicit complete conversations to goodbye", () => {
  const aiReceptionFlow = JSON.parse(
    readFileSync(path.join(connectRoot, "ai-reception.json"), "utf8")
  );
  const { actionsById } = collectReachableActions(aiReceptionFlow);
  const primary = actionsById.get("3b2877ca-bc16-4019-a8e6-04200c0ded06");
  const recovery = actionsById.get("6fbf4310-c8c6-44a8-a8f5-1d7830974c4d");
  const transferCheck = actionsById.get("check-transfer-to-queue");
  const completeCheck = actionsById.get("check-conversation-complete");

  assert.equal(primary.Transitions.NextAction, "check-transfer-to-queue");
  assert.equal(recovery.Transitions.NextAction, "check-transfer-to-queue");
  assert.equal(transferCheck.Parameters.ComparisonValue, "$.Lex.SessionAttributes.transferToQueue");
  assert.equal(transferCheck.Transitions.NextAction, "check-conversation-complete");
  assert.equal(transferCheck.Transitions.Conditions[0].NextAction, "transfer-human-escalation-flow");
  assert.equal(completeCheck.Parameters.ComparisonValue, "$.Lex.SessionAttributes.conversationComplete");
  assert.equal(completeCheck.Transitions.NextAction, "6fbf4310-c8c6-44a8-a8f5-1d7830974c4d");
  assert.equal(completeCheck.Transitions.Conditions[0].NextAction, "67ada978-600a-4d39-9965-6230c52810a9");
  assert.equal(primary.Transitions.Errors[0].NextAction, "6fbf4310-c8c6-44a8-a8f5-1d7830974c4d");
});

test("booking prompts are speech-first and service menu is not the greeting", () => {
  const lambdaSource = readFileSync(lambdaPath, "utf8");
  const apiSource = readFileSync(
    path.join(repoRoot, "apps/api/src/modules/ai/ai.service.ts"),
    "utf8"
  );
  const aiReceptionFlow = JSON.parse(
    readFileSync(path.join(connectRoot, "ai-reception.json"), "utf8")
  );
  const flowActionsById = new Map(aiReceptionFlow.Actions.map((action) => [action.Identifier, action]));
  const livePathGreeting = flowActionsById.get("3b2877ca-bc16-4019-a8e6-04200c0ded06");
  const lexSlot = JSON.parse(
    readFileSync(
      path.join(
        repoRoot,
        "infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/BookAppointmentIntent/Slots/serviceName/Slot.json"
      ),
      "utf8"
    )
  );

  assert.ok(lambdaSource.includes(CANONICAL_SERVICE_PROMPT));
  assert.ok(lambdaSource.includes(SERVICE_MENU_PROMPT));
  assert.ok(apiSource.includes(CANONICAL_SERVICE_PROMPT));
  assert.ok(apiSource.includes(SERVICE_MENU_PROMPT));
  assert.equal(livePathGreeting.Parameters.Text, CANONICAL_SERVICE_PROMPT);
  assert.equal(
    lexSlot.valueElicitationSetting.promptSpecification.messageGroupsList[0].message.plainTextMessage.value,
    FIRST_SERVICE_RETRY_PROMPT
  );
  assert.doesNotMatch(CANONICAL_SERVICE_PROMPT, /press 1 for Pedicure/i);
  assert.doesNotMatch(FIRST_SERVICE_RETRY_PROMPT, /press 1 for Pedicure/i);
});

test("Lex booking slot prompt attempts allow interrupt and use phone-friendly audio windows", () => {
  const slotRoot = path.join(
    repoRoot,
    "infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/BookAppointmentIntent/Slots"
  );
  const expected = {
    serviceName: { startMin: 7000, endMin: 1200, endMax: 1500, maxMin: 20000 },
    requestedDate: { startMin: 6000, endMin: 1000, endMax: 1200, maxMin: 15000 },
    requestedTime: { startMin: 6000, endMin: 1000, endMax: 1200, maxMin: 15000 },
    staffPreference: { startMin: 6000, endMin: 1000, endMax: 1200, maxMin: 15000 },
    customerName: { startMin: 7000, endMin: 1500, endMax: 1500, maxMin: 15000 },
    customerPhone: { startMin: 7000, endMin: 1500, endMax: 1500, maxMin: 15000 }
  };

  for (const [slotName, range] of Object.entries(expected)) {
    const slot = JSON.parse(readFileSync(path.join(slotRoot, slotName, "Slot.json"), "utf8"));
    const prompt = slot.valueElicitationSetting.promptSpecification;
    assert.equal(prompt.allowInterrupt, true, `${slotName} prompt allowInterrupt`);
    for (const [attemptName, attempt] of Object.entries(prompt.promptAttemptsSpecification)) {
      const audio = attempt.audioAndDTMFInputSpecification.audioSpecification;
      assert.equal(attempt.allowInterrupt, true, `${slotName}.${attemptName} allowInterrupt`);
      assert.ok(
        attempt.audioAndDTMFInputSpecification.startTimeoutMs >= range.startMin,
        `${slotName}.${attemptName} start timeout`
      );
      assert.ok(audio.endTimeoutMs >= range.endMin && audio.endTimeoutMs <= range.endMax, `${slotName}.${attemptName} end timeout`);
      assert.ok(audio.maxLengthMs >= range.maxMin, `${slotName}.${attemptName} max length`);
    }
    const failureAction = slot.valueElicitationSetting.slotCaptureSetting?.failureNextStep?.dialogAction?.type;
    assert.notEqual(failureAction, "StartIntent", `${slotName} must not jump to FallbackIntent on slot failure`);
  }
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

test("Fulfillment current staff alias overrides stale marvell while preserving Jane", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Jane, just to confirm: Full Set tomorrow at 3 PM with Trang. Is that correct?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ConfirmIntent"
          },
          sessionAttributes: {
            customerId: "89e51525-297d-4b2a-b438-f64c4848683a",
            customerName: "Jane",
            customerPhone: "+84978634886",
            serviceName: "Full Set",
            confirmedServiceName: "Full Set",
            requestedDate: usEasternDate(1),
            requestedTime: "3 PM",
            staffPreference: "Trang",
            confirmedStaffName: "Trang",
            staffId: "staff-trang",
            selectedStaffId: "staff-trang",
            confirmedStaffId: "staff-trang",
            awaitingFinalBookingConfirmation: "true",
            bookingConfirmationAsked: "true",
            lastAskedSlot: "bookingConfirmation",
            discardedStaleStaff: body.attributes.discardedStaleStaff,
            staffSource: body.attributes.staffSource
          }
        },
        missingFields: []
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "FulfillmentCodeHook",
      inputTranscript: "at three p m with chang",
      sessionId: "bb0b6ac3-a5be-4c9d-abac-7297a301d7bc",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CallerId: "+84978634886",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84978634886",
          AmazonConnectContactId: "bb0b6ac3-a5be-4c9d-abac-7297a301d7bc",
          customerId: "89e51525-297d-4b2a-b438-f64c4848683a",
          customerName: "Jane",
          recognizedCustomerName: "Jane",
          customerNameSource: "customer",
          customerPhone: "+84978634886",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(1),
          lastAskedSlot: "requestedTime",
          slotToElicit: "requestedTime",
          staffPreference: "marvell",
          initialBookingUtterance: "it one pull step the marvell"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          confirmationState: "None",
          slots: {
            customerName: null,
            customerPhone: slot("+84978634886"),
            serviceName: slotWith({
              originalValue: "full set",
              interpretedValue: "Full Set",
              resolvedValues: ["Full Set"]
            }),
            requestedDate: slot(usEasternDate(1)),
            requestedTime: slotWith({
              originalValue: "three p m",
              interpretedValue: "15:00",
              resolvedValues: ["15:00"]
            }),
            staffPreference: slot("marvell")
          }
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.currentTurnTranscript, "at three p m with chang");
  assert.equal(fetchCalls[0].body.requestedTime, "3 PM");
  assert.equal(fetchCalls[0].body.staffPreference, "Trang");
  assert.equal(fetchCalls[0].body.customerName, "Jane");
  assert.equal(fetchCalls[0].body.customerPhone, "+84978634886");
  assert.equal(fetchCalls[0].body.attributes.confirmedStaffName, "Trang");
  assert.equal(fetchCalls[0].body.attributes.discardedStaleStaff, "marvell");
  assert.equal(fetchCalls[0].body.attributes.staffSource, "current_turn_alias");
  assert.equal(
    fetchCalls[0].body.attributes.lexTurnDebug.sanitization.currentTurnStaffMention,
    "Trang"
  );
  assert.equal(fetchCalls[0].body.attributes.lexTurnDebug.sanitization.discardedStaleStaff, "marvell");
  assert.notEqual(fetchCalls[0].body.attributes.staffPreference, "marvell");
  assert.notEqual(fetchCalls[0].body.attributes.confirmedStaffName, "marvell");
  assert.equal(response.sessionState.dialogAction.type, "ConfirmIntent");
  assert.equal(response.sessionState.sessionAttributes.staffPreference, "Trang");
  assert.equal(response.sessionState.sessionAttributes.confirmedStaffName, "Trang");
  assert.equal(response.sessionState.sessionAttributes.customerName, "Jane");
  assert.doesNotMatch(response.messages[0].content, /what service|which service|staff would you like|what name/i);
});

test("DialogCodeHook one-shot Full Set phrase captures spoken p m before asking confirmation", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  const fetchCalls = installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Jane, just to confirm: Full Set tomorrow at 3 PM with Trang. Is that correct?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ConfirmIntent"
          },
          sessionAttributes: {
            awaitingFinalBookingConfirmation: "true",
            bookingConfirmationAsked: "true",
            customerName: "Jane",
            customerPhone: "+84978634886",
            serviceName: "Full Set",
            confirmedServiceName: "Full Set",
            requestedDate: usEasternDate(1),
            requestedTime: "3 PM",
            staffPreference: "Trang",
            confirmedStaffName: "Trang"
          }
        },
        missingFields: []
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "Hi, I want to book Full Set tomorrow at three p m with Trang.",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84978634886",
          AmazonConnectContactId: "connect-live-oneshot-spoken-pm",
          customerId: "89e51525-297d-4b2a-b438-f64c4848683a",
          customerName: "Jane",
          recognizedCustomerName: "Jane",
          customerNameSource: "customer",
          customerPhone: "+84978634886"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          state: "InProgress",
          confirmationState: "None",
          slots: {
            serviceName: slot("Full Set")
          }
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.serviceName, "Full Set");
  assert.equal(fetchCalls[0].body.requestedDate, usEasternDate(1));
  assert.equal(fetchCalls[0].body.requestedTime, "3 PM");
  assert.equal(fetchCalls[0].body.staffPreference, "Trang");
  assert.equal(fetchCalls[0].body.customerName, "Jane");
  assert.equal(response.sessionState.dialogAction.type, "ConfirmIntent");
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "3 PM");
  assert.doesNotMatch(response.messages[0].content, /What time|what service|what name|Which staff/i);
});

test("DialogCodeHook recognizes production Full Set speech aliases without DTMF", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Jane, just to confirm: Full Set tomorrow at 3 PM with Trang. Is that correct?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ConfirmIntent"
          },
          sessionAttributes: {
            awaitingFinalBookingConfirmation: "true",
            bookingConfirmationAsked: "true",
            customerName: body.customerName,
            customerPhone: body.customerPhone,
            serviceName: body.serviceName,
            confirmedServiceName: body.serviceName,
            requestedDate: body.requestedDate,
            requestedTime: body.requestedTime,
            staffPreference: body.staffPreference,
            confirmedStaffName: body.staffPreference
          }
        },
        missingFields: []
      })
    )
  );

  for (const inputTranscript of [
    "full set",
    "I want a full set",
    "Hi, I want to book Full Set tomorrow at 3 PM with Trang.",
    "I want to book a room set tomorrow at 3 PM with Trang.",
    "I want to book a pull set tomorrow at 3 PM with Trang.",
    "I want to book a pull step tomorrow at 3 PM with Trang."
  ]) {
    const fetchCountBefore = fetchCalls.length;
    const response = await handler(
      baseEvent({
        invocationSource: "DialogCodeHook",
        inputTranscript,
        sessionState: {
          ...baseEvent().sessionState,
          sessionAttributes: {
            salonId: "salon-explicit",
            CalledNumber: "+18483487681",
            CustomerEndpointAddress: "+84978634886",
            AmazonConnectContactId: `connect-full-set-${inputTranscript.replace(/\W+/g, "-")}`,
            customerId: "89e51525-297d-4b2a-b438-f64c4848683a",
            customerName: "Jane",
            recognizedCustomerName: "Jane",
            customerNameSource: "customer",
            customerPhone: "+84978634886",
            lastAskedSlot: "serviceName"
          },
          intent: {
            ...baseEvent().sessionState.intent,
            name: "BookAppointmentIntent",
            state: "InProgress",
            confirmationState: "None",
            slots: {
              serviceName: slotWith({
                originalValue: inputTranscript,
                interpretedValue: inputTranscript,
                resolvedValues: [inputTranscript]
              })
            }
          }
        }
      })
    );

    if (/tomorrow/i.test(inputTranscript)) {
      const latestFetch = fetchCalls.at(-1);
      assert.equal(fetchCalls.length, fetchCountBefore + 1, inputTranscript);
      assert.equal(latestFetch.body.serviceName, "Full Set", inputTranscript);
      assert.equal(latestFetch.body.requestedDate, usEasternDate(1), inputTranscript);
      assert.equal(latestFetch.body.requestedTime, "3 PM", inputTranscript);
      assert.equal(latestFetch.body.staffPreference, "Trang", inputTranscript);
      assert.equal(response.sessionState.dialogAction.type, "ConfirmIntent", inputTranscript);
    } else {
      assert.equal(fetchCalls.length, fetchCountBefore, inputTranscript);
      assert.equal(response.sessionState.dialogAction.type, "ElicitSlot", inputTranscript);
      assert.notEqual(response.sessionState.dialogAction.slotToElicit, "serviceName", inputTranscript);
    }
    assert.doesNotMatch(response.messages[0].content, /press 4|operator|what service/i, inputTranscript);
    assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set", inputTranscript);
    assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set", inputTranscript);
  }
});

test("Fallback and empty intent service recovery recognize Full Set aliases", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Jane, just to confirm: Full Set tomorrow at 3 PM with Trang. Is that correct?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ConfirmIntent"
          },
          sessionAttributes: {
            awaitingFinalBookingConfirmation: "true",
            bookingConfirmationAsked: "true",
            customerName: body.customerName,
            customerPhone: body.customerPhone,
            serviceName: body.serviceName,
            confirmedServiceName: body.serviceName,
            requestedDate: body.requestedDate,
            requestedTime: body.requestedTime,
            staffPreference: body.staffPreference,
            confirmedStaffName: body.staffPreference
          }
        },
        missingFields: []
      })
    )
  );

  for (const [intentName, inputTranscript] of [
    ["FallbackIntent", "I want to book a pool set tomorrow at 3 PM with Trang."],
    ["", "I want to book a full step tomorrow at 3 PM with Trang."]
  ]) {
    const response = await handler(
      baseEvent({
        invocationSource: "DialogCodeHook",
        inputTranscript,
        sessionState: {
          ...baseEvent().sessionState,
          sessionAttributes: {
            salonId: "salon-explicit",
            CalledNumber: "+18483487681",
            CustomerEndpointAddress: "+84978634886",
            AmazonConnectContactId: `connect-full-set-fallback-${intentName || "empty"}`,
            customerName: "Jane",
            customerPhone: "+84978634886",
            lastAskedSlot: "serviceName"
          },
          intent: {
            ...baseEvent().sessionState.intent,
            name: intentName,
            state: "InProgress",
            confirmationState: "None",
            slots: {}
          }
        }
      })
    );
    const latestFetch = fetchCalls.at(-1);

    assert.equal(latestFetch.body.intentName, "BookAppointmentIntent", inputTranscript);
    assert.equal(latestFetch.body.serviceName, "Full Set", inputTranscript);
    assert.equal(latestFetch.body.requestedDate, usEasternDate(1), inputTranscript);
    assert.equal(latestFetch.body.requestedTime, "3 PM", inputTranscript);
    assert.equal(latestFetch.body.staffPreference, "Trang", inputTranscript);
    assert.equal(response.sessionState.dialogAction.type, "ConfirmIntent", inputTranscript);
    assert.doesNotMatch(response.messages[0].content, /press 4|operator|what service/i, inputTranscript);
  }
});

test("serviceName turn maps scoped princess ASR to Full Set with correction marker", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Jane, just to confirm: Full Set tomorrow at 3 PM with Trang. Is that correct?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ConfirmIntent"
          },
          sessionAttributes: {
            awaitingFinalBookingConfirmation: "true",
            bookingConfirmationAsked: "true",
            customerName: body.customerName,
            customerPhone: body.customerPhone,
            serviceName: body.serviceName,
            confirmedServiceName: body.serviceName,
            requestedDate: body.requestedDate,
            requestedTime: body.requestedTime,
            staffPreference: body.staffPreference,
            confirmedStaffName: body.staffPreference
          }
        },
        missingFields: []
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "princess",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84978634886",
          AmazonConnectContactId: "connect-princess-asr",
          customerName: "Jane",
          customerPhone: "+84978634886",
          requestedDate: usEasternDate(1),
          requestedTime: "3 PM",
          staffPreference: "Trang",
          confirmedServiceName: "princess",
          lastAskedSlot: "serviceName"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          name: "BookAppointmentIntent",
          state: "InProgress",
          confirmationState: "None",
          slots: {
            serviceName: slotWith({
              originalValue: "princess",
              interpretedValue: "princess",
              resolvedValues: ["princess"]
            })
          }
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.serviceName, "Full Set");
  assert.equal(fetchCalls[0].body.attributes.confirmedServiceName, "Full Set");
  assert.equal(fetchCalls[0].body.attributes.serviceAliasCorrectionRaw, "princess");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
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
  assert.match(response.messages[0].content, /Sorry, what service would you like/i);
  assert.doesNotMatch(response.messages[0].content, /1 for Pedicure/i);
  assert.doesNotMatch(response.messages[0].content, /2 for Manicure/i);
  assert.doesNotMatch(response.messages[0].content, /3 for Gel Manicure/i);
  assert.doesNotMatch(response.messages[0].content, /4 for Full Set/i);
  assert.doesNotMatch(response.messages[0].content, /5 for Dip Powder/i);
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
  assert.match(response.messages[0].content, /1 for Pedicure/i);
  assert.match(response.messages[0].content, /5 for Dip Powder/i);
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

  for (const inputTranscript of ["full set", "I want to book a full set", "full said", "fall set"]) {
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

test("live-shaped FallbackIntent full set turn resumes BookAppointmentIntent and asks date", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for service fallback recovery");
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
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-live-real-call",
          lastAskedSlot: "serviceName",
          activeDtmfMenu: "service",
          activeDtmfOptionsJson: JSON.stringify({
            "1": "Pedicure",
            "2": "Manicure",
            "3": "Gel Manicure",
            "4": "Full Set",
            "5": "Dip Powder",
            "0": "__operator__"
          })
        },
        intent: {
          name: "FallbackIntent",
          state: "InProgress",
          confirmationState: "None",
          slots: {}
        }
      },
      requestAttributes: {
        SystemEndpointAddress: "+18483487681"
      }
    })
  );

  assert.equal(response.sessionState.intent.name, "BookAppointmentIntent");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "requestedDate");
  assert.equal(response.sessionState.sessionAttributes.lastAskedSlot, "requestedDate");
  assert.equal(response.sessionState.sessionAttributes.activeDtmfMenu, undefined);
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, undefined);
  assert.equal(response.sessionState.sessionAttributes.forceHumanEscalation, undefined);
  assert.doesNotMatch(response.messages[0].content, /didn.t catch the service/i);
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

test("Fulfillment accepts international caller Jane at customerName stage", async () => {
  const handler = await loadHandler();
  const tomorrow = usEasternDate(1);
  const fetchCalls = installFetchMock((url, options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message:
            "Thanks, Jane. Just to confirm, Full Set tomorrow at 3 PM with the first available technician. Is that correct?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ConfirmIntent"
          },
          sessionAttributes: {
            customerName: body.customerName,
            customerPhone: body.customerPhone,
            serviceName: body.serviceName,
            confirmedServiceName: body.serviceName,
            requestedDate: body.requestedDate,
            requestedTime: body.requestedTime,
            staffPreference: body.staffPreference,
            forceHumanEscalation: "false",
            transferToQueue: "false"
          }
        }
      })
    )
  );

  const response = await handler(
    baseEvent({
      inputTranscript: "Jane",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84978634886",
          AmazonConnectContactId: "7a82c651-5091-4f32-84f0-bf37d004317c",
          lastAskedSlot: "customerName",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: tomorrow,
          requestedTime: "3 PM",
          staffPreference: "Any staff",
          confirmedStaffName: "Any staff",
          customerPhone: "+84978634886"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          state: "ReadyForFulfillment",
          confirmationState: "None",
          slots: {
            serviceName: slot("Full Set"),
            requestedDate: slot("tomorrow"),
            requestedTime: slotWith({
              originalValue: "three p m",
              interpretedValue: "3 PM"
            }),
            staffPreference: slot("Any staff"),
            customerName: slot("Jane")
          }
        }
      },
      requestAttributes: {
        SystemEndpointAddress: "+18483487681"
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.customerName, "Jane");
  assert.equal(fetchCalls[0].body.customerPhone, "+84978634886");
  assert.equal(fetchCalls[0].body.calledNumber, "+18483487681");
  assert.equal(
    fetchCalls[0].body.amazonConnectContactId,
    "7a82c651-5091-4f32-84f0-bf37d004317c"
  );
  assert.equal(fetchCalls[0].body.serviceName, "Full Set");
  assert.equal(fetchCalls[0].body.requestedDate, tomorrow);
  assert.equal(fetchCalls[0].body.requestedTime, "3 PM");
  assert.equal(fetchCalls[0].body.staffPreference, "Any staff");
  assert.equal(fetchCalls[0].body.currentTurnTranscript, "Jane");
  assert.equal(response.sessionState.dialogAction.type, "ConfirmIntent");
  assert.notEqual(response.sessionState.dialogAction.type, "ElicitIntent");
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.equal(response.sessionState.sessionAttributes.customerName, "Jane");
  assert.equal(response.sessionState.sessionAttributes.customerPhone, "+84978634886");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.requestedDate, tomorrow);
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "3 PM");
  assert.equal(response.sessionState.sessionAttributes.staffPreference, "Any staff");
  assert.notEqual(response.sessionState.sessionAttributes.transferToQueue, "true");
  assert.notEqual(response.sessionState.sessionAttributes.forceHumanEscalation, "true");
  assert.doesNotMatch(response.messages[0].content, /trouble|checking our services/i);
});

test("DialogCodeHook customer names colliding with staff names remain customerName", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called while delegating accepted customer names");
  };

  for (const name of ["Amy", "Kelly", "Trang", "Jane"]) {
    const response = await handler(
      baseEvent({
        invocationSource: "DialogCodeHook",
        inputTranscript: name,
        sessionState: {
          ...baseEvent().sessionState,
          sessionAttributes: {
            salonId: "salon-explicit",
            CalledNumber: "+18483487681",
            CustomerEndpointAddress: "+84978634886",
            AmazonConnectContactId: `connect-customer-name-${name.toLowerCase()}`,
            lastAskedSlot: "customerName",
            serviceName: "Full Set",
            confirmedServiceName: "Full Set",
            requestedDate: usEasternDate(1),
            requestedTime: "3 PM",
            staffPreference: "Trang",
            confirmedStaffName: "Trang",
            customerPhone: "+84978634886",
            ...dynamicStaffAttributes()
          },
          intent: {
            ...baseEvent().sessionState.intent,
            slots: {
              serviceName: slot("Full Set"),
              requestedDate: slot("tomorrow"),
              requestedTime: slot("3 PM"),
              staffPreference: slot("Trang"),
              customerName: slot(name)
            }
          }
        }
      })
    );

    assert.equal(response.sessionState.dialogAction.type, "Delegate");
    assert.equal(response.sessionState.sessionAttributes.customerName, name);
    assert.equal(response.sessionState.intent.slots.customerName.value.interpretedValue, name);
    assert.equal(response.sessionState.sessionAttributes.staffPreference, "Trang");
    assert.equal(response.sessionState.intent.slots.staffPreference.value.interpretedValue, "Trang");
    assert.notEqual(response.sessionState.sessionAttributes.transferToQueue, "true");
    assert.notEqual(response.sessionState.sessionAttributes.forceHumanEscalation, "true");
  }
});

test("Fulfillment collapses spoken spelling for customerName", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock((url, options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: `Thanks, ${body.customerName}. Just to confirm.`,
          messageContentType: "PlainText",
          dialogAction: {
            type: "ConfirmIntent"
          },
          sessionAttributes: {
            customerName: body.customerName,
            customerPhone: body.customerPhone,
            serviceName: body.serviceName,
            requestedDate: body.requestedDate,
            requestedTime: body.requestedTime,
            staffPreference: body.staffPreference,
            forceHumanEscalation: "false",
            transferToQueue: "false"
          }
        }
      })
    )
  );

  for (const [spokenName, expectedName] of [
    ["J A N E", "Jane"],
    ["K I E T", "Kiet"]
  ]) {
    const response = await handler(
      baseEvent({
        inputTranscript: spokenName,
        sessionState: {
          ...baseEvent().sessionState,
          sessionAttributes: {
            salonId: "salon-explicit",
            CalledNumber: "+18483487681",
            CustomerEndpointAddress: "+84978634886",
            AmazonConnectContactId: `connect-spelled-${expectedName.toLowerCase()}`,
            lastAskedSlot: "customerName",
            serviceName: "Full Set",
            confirmedServiceName: "Full Set",
            requestedDate: usEasternDate(1),
            requestedTime: "3 PM",
            staffPreference: "Any staff",
            customerPhone: "+84978634886"
          },
          intent: {
            ...baseEvent().sessionState.intent,
            confirmationState: "None",
            slots: {
              serviceName: slot("Full Set"),
              requestedDate: slot("tomorrow"),
              requestedTime: slot("3 PM"),
              staffPreference: slot("Any staff"),
              customerName: slot(spokenName)
            }
          }
        }
      })
    );

    assert.equal(response.sessionState.dialogAction.type, "ConfirmIntent");
    assert.equal(response.sessionState.sessionAttributes.customerName, expectedName);
  }

  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[0].body.customerName, "Jane");
  assert.equal(fetchCalls[1].body.customerName, "Kiet");
});

test("Repeated no-input customerName uses temporary phone fallback and continues", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock((url, options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message:
            "I couldn't clearly hear the name, so I'll use Guest ending in 4886 for now. Just to confirm, Full Set tomorrow at 3 PM with the first available technician. Is that correct?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ConfirmIntent"
          },
          sessionAttributes: {
            customerName: body.customerName,
            customerNameSource: "phone_fallback",
            customerNameNeedsReview: "true",
            customerPhone: body.customerPhone,
            serviceName: body.serviceName,
            requestedDate: body.requestedDate,
            requestedTime: body.requestedTime,
            staffPreference: body.staffPreference,
            forceHumanEscalation: "false",
            transferToQueue: "false"
          }
        }
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "no input",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84978634886",
          AmazonConnectContactId: "connect-customer-name-no-input-fallback",
          lastAskedSlot: "customerName",
          noInputCount: "1",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(1),
          requestedTime: "3 PM",
          staffPreference: "Any staff",
          customerPhone: "+84978634886"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {
            serviceName: slot("Full Set"),
            requestedDate: slot("tomorrow"),
            requestedTime: slot("3 PM"),
            staffPreference: slot("Any staff")
          }
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.customerName, "Guest 4886");
  assert.equal(fetchCalls[0].body.customerPhone, "+84978634886");
  assert.equal(fetchCalls[0].body.attributes.customerNameSource, "phone_fallback");
  assert.equal(fetchCalls[0].body.attributes.customerNameNeedsReview, "true");
  assert.equal(fetchCalls[0].body.currentTurnTranscript, "no input");
  assert.equal(response.sessionState.dialogAction.type, "ConfirmIntent");
  assert.equal(response.sessionState.sessionAttributes.customerName, "Guest 4886");
  assert.equal(response.sessionState.sessionAttributes.customerNameSource, "phone_fallback");
  assert.equal(response.sessionState.sessionAttributes.customerNameNeedsReview, "true");
  assert.match(response.messages[0].content, /Guest ending in 4886/i);
  assert.notEqual(response.sessionState.sessionAttributes.transferToQueue, "true");
  assert.notEqual(response.sessionState.sessionAttributes.forceHumanEscalation, "true");
});

test("DialogCodeHook final confirmation yes posts confirmed booking", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock((url, options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "BOOKED",
        appointment: {
          id: "appointment-final-confirmed"
        },
        lexResponse: {
          fulfillmentState: "Fulfilled",
          message: "Booked.",
          messageContentType: "PlainText",
          dialogAction: {
            type: "Close"
          },
          sessionAttributes: {
            customerName: body.customerName,
            customerPhone: body.customerPhone,
            serviceName: body.serviceName,
            requestedDate: body.requestedDate,
            requestedTime: body.requestedTime,
            staffPreference: body.staffPreference,
            awaitingFinalBookingConfirmation: "false",
            bookingConfirmationAsked: "false",
            forceHumanEscalation: "false",
            transferToQueue: "false"
          }
        }
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "yes",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84978634886",
          AmazonConnectContactId: "connect-final-confirmation-84",
          customerName: "Jane",
          customerPhone: "+84978634886",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(1),
          requestedTime: "3 PM",
          staffPreference: "Kelly",
          staffId: "staff-kelly",
          selectedStaffId: "staff-kelly",
          confirmedStaffName: "Kelly",
          confirmedStaffId: "staff-kelly",
          awaitingFinalBookingConfirmation: "true",
          bookingConfirmationAsked: "true",
          lastAskedSlot: "bookingConfirmation"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          confirmationState: "None",
          slots: {
            serviceName: slot("Full Set"),
            requestedDate: slot("tomorrow"),
            requestedTime: slot("3 PM"),
            staffPreference: slot("Kelly"),
            customerName: slot("Jane"),
            customerPhone: slot("+84978634886")
          }
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.confirmationState, "Confirmed");
  assert.equal(fetchCalls[0].body.customerName, "Jane");
  assert.equal(fetchCalls[0].body.customerPhone, "+84978634886");
  assert.equal(fetchCalls[0].body.serviceName, "Full Set");
  assert.equal(fetchCalls[0].body.requestedTime, "3 PM");
  assert.equal(fetchCalls[0].body.staffPreference, "Kelly");
  assert.equal(response.sessionState.dialogAction.type, "Close");
  assert.equal(response.sessionState.intent.state, "Fulfilled");
  assert.equal(response.sessionState.sessionAttributes.bookingOutcome, "BOOKED");
  assert.equal(response.sessionState.sessionAttributes.appointmentId, "appointment-final-confirmed");
  assert.equal(response.sessionState.sessionAttributes.awaitingFinalBookingConfirmation, "false");
  assert.notEqual(response.sessionState.sessionAttributes.transferToQueue, "true");
});

test("DialogCodeHook natural final confirmations post confirmed booking once", async () => {
  const handler = await loadHandler();
  const acceptedPhrases = [
    "yes this is correct",
    "yeah correct",
    "correct yes yes correct yes",
    "that's right",
    "please book it",
    "correct"
  ];

  for (const phrase of acceptedPhrases) {
    const fetchCalls = installFetchMock((_url, _options, body) =>
      jsonResponse(
        successfulBackendPayload({
          outcome: "BOOKED",
          appointment: {
            id: `appointment-${phrase.replace(/\W+/g, "-")}`
          },
          lexResponse: {
            fulfillmentState: "Fulfilled",
            message: "Booked.",
            messageContentType: "PlainText",
            dialogAction: {
              type: "Close"
            },
            sessionAttributes: {
              customerName: body.customerName,
              customerPhone: body.customerPhone,
              serviceName: body.serviceName,
              requestedDate: body.requestedDate,
              requestedTime: body.requestedTime,
              staffPreference: body.staffPreference,
              awaitingFinalBookingConfirmation: "false",
              bookingConfirmationAsked: "false",
              forceHumanEscalation: "false",
              transferToQueue: "false"
            }
          }
        })
      )
    );

    const response = await handler(
      baseEvent({
        invocationSource: "DialogCodeHook",
        inputTranscript: phrase,
        sessionId: `fef46abd-f101-475a-97d0-${phrase.replace(/\W+/g, "").slice(0, 12)}`,
        sessionState: {
          ...baseEvent().sessionState,
          sessionAttributes: {
            salonId: "salon-explicit",
            CalledNumber: "+18483487681",
            CustomerEndpointAddress: "+84978634886",
            AmazonConnectContactId: `fef46abd-f101-475a-97d0-${phrase.replace(/\W+/g, "").slice(0, 12)}`,
            customerName: "Jane",
            customerPhone: "+84978634886",
            serviceName: "Full Set",
            confirmedServiceName: "Full Set",
            requestedDate: usEasternDate(1),
            requestedTime: "3 PM",
            staffPreference: "Trang",
            staffId: "staff-trang",
            selectedStaffId: "staff-trang",
            confirmedStaffName: "Trang",
            confirmedStaffId: "staff-trang",
            awaitingFinalBookingConfirmation: "true",
            bookingConfirmationAsked: "true",
            lastAskedSlot: "bookingConfirmation"
          },
          intent: {
            ...baseEvent().sessionState.intent,
            confirmationState: "None",
            slots: {
              serviceName: slot("Full Set"),
              requestedDate: slot("tomorrow"),
              requestedTime: slot("3 PM"),
              staffPreference: slot("Trang"),
              customerName: slot("Jane"),
              customerPhone: slot("+84978634886")
            }
          }
        }
      })
    );

    assert.equal(fetchCalls.length, 1, phrase);
    assert.equal(fetchCalls[0].body.confirmationState, "Confirmed", phrase);
    assert.equal(fetchCalls[0].body.currentTurnTranscript, phrase, phrase);
    assert.equal(fetchCalls[0].body.serviceName, "Full Set", phrase);
    assert.equal(fetchCalls[0].body.requestedDate, usEasternDate(1), phrase);
    assert.equal(fetchCalls[0].body.requestedTime, "3 PM", phrase);
    assert.equal(fetchCalls[0].body.staffPreference, "Trang", phrase);
    assert.equal(response.sessionState.dialogAction.type, "Close", phrase);
    assert.equal(response.sessionState.intent.state, "Fulfilled", phrase);
    assert.ok(response.sessionState.sessionAttributes.appointmentId, phrase);
    assert.doesNotMatch(response.messages[0].content, /Is that correct/i, phrase);
  }
});

test("DialogCodeHook denied final confirmations preserve slots and ask what to change", async () => {
  const handler = await loadHandler();

  for (const phrase of ["no", "nope", "no that is wrong", "that's not correct", "do not book it", "don't book it", "cancel it", "wait no"]) {
    const fetchCalls = installFetchMock((_url, _options, body) =>
      jsonResponse(
        successfulBackendPayload({
          outcome: "MISSING_INFO",
          appointment: null,
          lexResponse: {
            fulfillmentState: "InProgress",
            message: "No problem. Which detail would you like to change?",
            messageContentType: "PlainText",
            dialogAction: {
              type: "ElicitIntent"
            },
            sessionAttributes: {
              customerName: body.customerName,
              customerPhone: body.customerPhone,
              serviceName: body.serviceName,
              confirmedServiceName: body.serviceName,
              requestedDate: body.requestedDate,
              requestedTime: body.requestedTime,
              staffPreference: body.staffPreference,
              confirmedStaffName: body.staffPreference,
              awaitingFinalBookingConfirmation: "false",
              bookingConfirmationAsked: "false",
              forceHumanEscalation: "false",
              transferToQueue: "false"
            }
          }
        })
      )
    );

    const response = await handler(
      baseEvent({
        invocationSource: "DialogCodeHook",
        inputTranscript: phrase,
        sessionState: {
          ...baseEvent().sessionState,
          sessionAttributes: {
            salonId: "salon-explicit",
            CalledNumber: "+18483487681",
            CustomerEndpointAddress: "+84978634886",
            AmazonConnectContactId: `connect-final-denied-${phrase.replace(/\W+/g, "-")}`,
            customerName: "Jane",
            customerPhone: "+84978634886",
            serviceName: "Full Set",
            confirmedServiceName: "Full Set",
            requestedDate: usEasternDate(1),
            requestedTime: "3 PM",
            staffPreference: "Trang",
            staffId: "staff-trang",
            selectedStaffId: "staff-trang",
            confirmedStaffName: "Trang",
            confirmedStaffId: "staff-trang",
            awaitingFinalBookingConfirmation: "true",
            bookingConfirmationAsked: "true",
            lastAskedSlot: "bookingConfirmation"
          },
          intent: {
            ...baseEvent().sessionState.intent,
            confirmationState: "None",
            slots: {
              serviceName: slot("Full Set"),
              requestedDate: slot("tomorrow"),
              requestedTime: slot("3 PM"),
              staffPreference: slot("Trang"),
              customerName: slot("Jane"),
              customerPhone: slot("+84978634886")
            }
          }
        }
      })
    );

    assert.equal(fetchCalls.length, 1, phrase);
    assert.equal(fetchCalls[0].body.confirmationState, "Denied", phrase);
    assert.equal(fetchCalls[0].body.serviceName, "Full Set", phrase);
    assert.equal(fetchCalls[0].body.requestedTime, "3 PM", phrase);
    assert.equal(fetchCalls[0].body.staffPreference, "Trang", phrase);
    assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set", phrase);
    assert.equal(response.sessionState.sessionAttributes.requestedTime, "3 PM", phrase);
    assert.equal(response.sessionState.sessionAttributes.staffPreference, "Trang", phrase);
    assert.match(response.messages[0].content, /Which detail would you like to change/i, phrase);
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

test("BookAppointmentIntent STAFF_NOT_MAPPED response elicits staff without backend retry", async () => {
  const handler = await loadHandler();
  installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "FAILED",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Trang doesn't provide Pedicure. Please choose another technician, or say first available.",
          messageContentType: "PlainText",
          sessionAttributes: {
            escalationReason: "STAFF_NOT_MAPPED"
          }
        }
      })
    )
  );

  const response = await handler(baseEvent());

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "staffPreference");
  assert.equal(response.sessionState.sessionAttributes.forceHumanEscalation, "false");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "false");
  assert.equal(response.sessionState.sessionAttributes.backendFailureReason, undefined);
  assert.equal(response.sessionState.sessionAttributes.awaitingBackendRetryConfirmation, undefined);
  assert.equal(response.sessionState.sessionAttributes.staffMappingFailure, "true");
  assert.match(response.messages[0].content, /Trang doesn't provide Pedicure/i);
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
