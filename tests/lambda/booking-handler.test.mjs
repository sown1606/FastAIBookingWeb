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
  "Hi, I can help book your appointment. Tell me the service, day, time, and staff. You can press 0 for a person.";
const FIRST_SERVICE_RETRY_PROMPT = "Sure. Which service would you like?";
const SERVICE_MENU_PROMPT =
  "I can list the services once. Please say the service name, or press 0 for a person.";
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
  activeDtmfMenu: "staff",
  activeDtmfOptionsJson: JSON.stringify({
    "1": "Trang",
    "2": "Amy",
    "3": "Kelly",
    "4": "Any staff",
    "0": "__operator__"
  }),
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

test("production Full Set aliases exclude polluted ASR garbage in Lambda, API, and Lex v10 source", () => {
  const requiredAliases = [
    "fool set",
    "foot set",
    "full step",
    "full said",
    "full sit",
    "full sat",
    "full sell",
    "full sad",
    "full cet",
    "fullsat",
    "fall set",
    "set of nails",
    "boom set",
    "book a set",
    "want a set",
    "a nail set"
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
  for (const alias of [
    "sunset",
    "sun set",
    "fun fact",
    "fun facts",
    "food set",
    "phone set",
    "phone chat",
    "pool set",
    "cool set",
    "so we'll set",
    "we'll set",
    "fo set"
  ]) {
    assert.equal(lexAliases.has(alias), false, `Lex v10 must not map ${alias} to Full Set`);
  }
  assert.match(lambdaSource, /hasUnsafeSunsetWithoutExplicitFullSetAlias/, "Lambda missing guarded sunset block");
  assert.match(apiSource, /applyGuardedObservedServiceAsrCorrection/, "API missing guarded service ASR correction");
  assert.equal(
    lexSlotType.slotTypeValues.some((entry) => entry.sampleValue?.value === "Gel Manicure"),
    true
  );
  assert.equal(
    lexSlotType.slotTypeValues.some((entry) => entry.sampleValue?.value === "Other Services"),
    false
  );
  assert.equal(
    lexSlotType.slotTypeValues.some((entry) =>
      entry.synonyms?.some((synonym) => /^[1-9]$/.test(synonym.value))
    ),
    false
  );
});

test("July 15 Lex v10 confirmation and ASR source contracts are present", () => {
  const lambdaSource = readFileSync(lambdaPath, "utf8");
  const apiSource = readFileSync(apiAiServicePath, "utf8");
  const lexRoot = path.join(repoRoot, "infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US");
  const bookIntent = JSON.parse(
    readFileSync(path.join(lexRoot, "Intents/BookAppointmentIntent/Intent.json"), "utf8")
  );
  const confirmationSlot = JSON.parse(
    readFileSync(
      path.join(lexRoot, "Intents/BookAppointmentIntent/Slots/bookingConfirmation/Slot.json"),
      "utf8"
    )
  );
  const confirmationType = JSON.parse(
    readFileSync(path.join(lexRoot, "SlotTypes/BookingConfirmationType/SlotType.json"), "utf8")
  );
  const nailServiceType = JSON.parse(
    readFileSync(path.join(lexRoot, "SlotTypes/NailServiceType/SlotType.json"), "utf8")
  );
  const humanIntent = JSON.parse(
    readFileSync(path.join(lexRoot, "Intents/HumanEscalationIntent/Intent.json"), "utf8")
  );
  const customVocabulary = JSON.parse(
    readFileSync(path.join(lexRoot, "CustomVocabulary.json"), "utf8")
  );
  const staffPreferenceType = JSON.parse(
    readFileSync(path.join(lexRoot, "SlotTypes/StaffPreferenceType/SlotType.json"), "utf8")
  );
  const customVocabularyPhrases = new Set(
    customVocabulary.customVocabularyItems.map((item) => item.phrase)
  );
  const anyStaffSynonyms = new Set(
    staffPreferenceType.slotTypeValues
      .find((entry) => entry.sampleValue?.value === "Any staff")
      ?.synonyms?.map((synonym) => synonym.value) || []
  );

  assert.match(lambdaSource, /"mini q"/);
  assert.match(apiSource, /"mini q"/);
  assert.match(lambdaSource, /"annie stop"/);
  assert.match(apiSource, /"annie stop"/);
  assert.match(lambdaSource, /speak with a person/);
  assert.match(apiSource, /speak with a person/);
  assert.ok(bookIntent.slotPriorities.some((slotPriority) => slotPriority.slotName === "bookingConfirmation"));
  assert.equal(confirmationSlot.slotTypeName, "BookingConfirmationType");
  assert.equal(
    confirmationSlot.valueElicitationSetting.promptSpecification.promptAttemptsSpecification.Initial.allowedInputTypes.allowAudioInput,
    true
  );
  assert.equal(
    confirmationSlot.valueElicitationSetting.promptSpecification.promptAttemptsSpecification.Initial.allowedInputTypes.allowDTMFInput,
    true
  );
  for (const phrase of ["Any staff", "Any staff is fine", "First available", "Whoever is available"]) {
    assert.equal(customVocabularyPhrases.has(phrase), true, `Custom vocabulary missing ${phrase}`);
    assert.equal(anyStaffSynonyms.has(phrase), true, `StaffPreferenceType missing ${phrase}`);
  }
  assert.ok(
    confirmationType.slotTypeValues.some((value) =>
      value.synonyms.some((synonym) => synonym.value === "1")
    )
  );
  const manicureLexValue = nailServiceType.slotTypeValues.find(
    (entry) => entry.sampleValue?.value === "Manicure"
  );
  assert.ok(manicureLexValue.synonyms.some((synonym) => synonym.value === "mini q"));
  assert.ok(
    humanIntent.sampleUtterances.some((utterance) => utterance.utterance === "I want to speak with a person")
  );
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
      start: "Let me check for an available operator.",
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

test("Connect human escalation flow transfers without duplicate wait prompt", () => {
  const humanEscalationFlow = JSON.parse(
    readFileSync(path.join(connectRoot, "human-escalation.json"), "utf8")
  );
  const actionsById = new Map(
    humanEscalationFlow.Actions.map((action) => [action.Identifier, action])
  );
  const startAction = actionsById.get(humanEscalationFlow.StartAction);
  const queueUpdate = actionsById.get(startAction.Transitions.NextAction);
  const customerQueueHook = actionsById.get(queueUpdate.Transitions.NextAction);
  const queueTransfer = actionsById.get(customerQueueHook.Transitions.NextAction);
  const flowErrorCallback = actionsById.get(queueUpdate.Transitions.Errors[0].NextAction);
  const queueAtCapacityCallback = actionsById.get(
    queueTransfer.Transitions.Errors.find((error) => error.ErrorType === "QueueAtCapacity").NextAction
  );
  const fallbackMessage = actionsById.get(flowErrorCallback.Transitions.NextAction);

  assert.equal(startAction.Type, "UpdateContactTextToSpeechVoice");
  assert.equal(queueUpdate.Type, "UpdateContactTargetQueue");
  assert.equal(customerQueueHook.Type, "UpdateContactEventHooks");
  assert.match(customerQueueHook.Parameters.EventHooks.CustomerQueue, /contact-flow\/6bdf546e-4e3a-4bf5-954f-fb78fa6a3d5b$/);
  assert.equal(queueTransfer.Type, "TransferContactToQueue");
  assert.equal(flowErrorCallback.Type, "InvokeLambdaFunction");
  assert.equal(flowErrorCallback.Parameters.LambdaInvocationAttributes.fastAiOperatorQueueOutcome, "CONNECT_FLOW_ERROR");
  assert.equal(queueAtCapacityCallback.Type, "InvokeLambdaFunction");
  assert.equal(queueAtCapacityCallback.Parameters.LambdaInvocationAttributes.fastAiOperatorQueueOutcome, "QUEUE_AT_CAPACITY");
  assert.equal(fallbackMessage.Parameters.Text, "All of our operators are currently busy. Please call back later. Goodbye.");
  assert.equal(
    humanEscalationFlow.Actions.some(
      (action) =>
        action.Type === "CheckMetricData" ||
        action.Parameters?.MetricType === "NumberOfAgentsAvailable"
    ),
    false
  );
  assert.equal(
    humanEscalationFlow.Actions.some(
      (action) => action.Type === "MessageParticipant" && /Please wait while I connect you/i.test(action.Parameters?.Text || "")
    ),
    false
  );
});

test("Connect customer queue flow has bounded wait timeout and disconnect fallback", () => {
  const queueFlow = JSON.parse(
    readFileSync(path.join(connectRoot, "customer-queue-timeout.json"), "utf8")
  );
  const actionsById = new Map(queueFlow.Actions.map((action) => [action.Identifier, action]));
  const entryCallback = actionsById.get(queueFlow.StartAction);
  const loop = actionsById.get(entryCallback.Transitions.NextAction);
  const timeoutActionId = loop.Transitions.Conditions.find(
    (condition) => condition.Condition.Operands.includes("MessagesInterrupted")
  )?.NextAction;
  const timeoutCallback = actionsById.get(timeoutActionId);
  const timeoutMessage = actionsById.get(timeoutCallback.Transitions.NextAction);
  const disconnect = actionsById.get(timeoutMessage.Transitions.NextAction);

  assert.equal(entryCallback.Type, "InvokeLambdaFunction");
  assert.equal(entryCallback.Parameters.LambdaInvocationAttributes.fastAiOperatorQueueOutcome, "AMAZON_CONNECT_ENQUEUED");
  assert.equal(loop.Type, "MessageParticipantIteratively");
  assert.equal(loop.Parameters.InterruptFrequencySeconds, "90");
  assert.equal(
    loop.Parameters.Messages.some((message) => /continue to hold/i.test(message.Text || "")),
    true
  );
  assert.equal(timeoutCallback.Type, "InvokeLambdaFunction");
  assert.equal(timeoutCallback.Parameters.LambdaInvocationAttributes.fastAiOperatorQueueOutcome, "QUEUE_WAIT_TIMEOUT");
  assert.equal(timeoutMessage.Type, "MessageParticipant");
  assert.equal(timeoutMessage.Parameters.Text, "All of our operators are currently busy. Please call back later. Goodbye.");
  assert.equal(disconnect.Type, "DisconnectParticipant");
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

const getTransitionTargets = (action) => [
  action?.Transitions?.NextAction,
  ...(action?.Transitions?.Conditions || []).map((condition) => condition.NextAction),
  ...(action?.Transitions?.Errors || []).map((error) => error.NextAction)
].filter(Boolean);

const findReachablePath = (flow, fromId, predicate, maxDepth = 16) => {
  const actionsById = new Map(flow.Actions.map((action) => [action.Identifier, action]));
  const queue = [[fromId]];
  const seen = new Set();
  while (queue.length) {
    const path = queue.shift();
    const id = path[path.length - 1];
    if (!id || path.length > maxDepth) {
      continue;
    }
    const action = actionsById.get(id);
    if (predicate(action, id, path)) {
      return path;
    }
    const seenKey = `${id}:${path.length}`;
    if (seen.has(seenKey)) {
      continue;
    }
    seen.add(seenKey);
    for (const targetId of getTransitionTargets(action)) {
      if (!path.includes(targetId) || path.length < 3) {
        queue.push([...path, targetId]);
      }
    }
  }
  return null;
};

const assertPathReaches = (flow, fromId, targetId, message) => {
  const path = findReachablePath(flow, fromId, (_action, id) => id === targetId);
  assert.ok(path, message || `${fromId} reaches ${targetId}`);
  return path;
};

const assertPathHasAudibleActionBeforeLex = (flow, fromId, message) => {
  const actionsById = new Map(flow.Actions.map((action) => [action.Identifier, action]));
  const path = findReachablePath(
    flow,
    fromId,
    (action, _id, currentPath) =>
      action?.Type === "ConnectParticipantWithLexBot" &&
      currentPath.slice(0, -1).some((pathId) => {
        const previous = actionsById.get(pathId);
        return previous?.Type === "MessageParticipant" && String(previous.Parameters?.Text || "").trim();
      })
  );
  assert.ok(path, message || `${fromId} reaches Lex through an audible message`);
  return path;
};

test("Connect AI reception has one reachable greeting and no outer service prompt loop", () => {
  const aiReceptionFlow = JSON.parse(
    readFileSync(path.join(connectRoot, "ai-reception.json"), "utf8")
  );
  const { actionsById, reachable } = collectReachableActions(aiReceptionFlow);
  const reachableGreetingActions = [...reachable]
    .map((id) => actionsById.get(id))
    .filter((action) => action?.Parameters?.Text === CANONICAL_SERVICE_PROMPT);
  const flowLogging = actionsById.get("enable-flow-logging");

  assert.equal(aiReceptionFlow.StartAction, "enable-flow-logging");
  assert.equal(flowLogging?.Type, "UpdateFlowLoggingBehavior");
  assert.equal(flowLogging?.Parameters?.FlowLoggingBehavior, "Enabled");
  assert.equal(flowLogging?.Transitions?.NextAction, "f06e4017-1de8-4fbd-a42a-ae434ddca6bf");
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
  const finalRecovery = actionsById.get("41e3f239-5b57-4363-92fc-9d594579fa98");
  assert.equal(primary.Parameters.Text, CANONICAL_SERVICE_PROMPT);
  assert.doesNotMatch(primary.Parameters.Text, /press 1 for Pedicure/i);
  assert.equal(primary.Parameters.LexSessionAttributes["x-amz-lex:allow-interrupt:*:*"], "true");
  assert.equal(primary.Parameters.LexSessionAttributes["x-amz-lex:audio:start-timeout-ms:*:*"], "9000");
  assert.ok(
    Number(primary.Parameters.LexSessionAttributes["x-amz-lex:audio:end-timeout-ms:*:*"]) >= 4200,
    "global audio end timeout must preserve the prior slow-speech floor"
  );
  assert.equal(primary.Parameters.LexSessionAttributes["x-amz-lex:audio:max-length-ms:*:*"], "20000");
  assert.ok(
    Number(primary.Parameters.LexSessionAttributes["x-amz-lex:audio:end-timeout-ms:BookAppointmentIntent:serviceName"]) >= 3200,
    "serviceName end timeout must not regress below the previous safe value"
  );
  assert.equal(primary.Parameters.LexSessionAttributes["x-amz-lex:audio:end-timeout-ms:BookAppointmentIntent:requestedDate"], "2200");
  assert.equal(primary.Parameters.LexSessionAttributes["x-amz-lex:audio:end-timeout-ms:BookAppointmentIntent:requestedTime"], "2200");
  assert.equal(primary.Parameters.LexSessionAttributes["x-amz-lex:audio:end-timeout-ms:BookAppointmentIntent:staffPreference"], "2600");
  assert.equal(primary.Parameters.LexSessionAttributes["x-amz-lex:audio:end-timeout-ms:BookAppointmentIntent:customerName"], "2000");
  assert.equal(primary.Parameters.LexSessionAttributes["x-amz-lex:audio:end-timeout-ms:BookAppointmentIntent:bookingConfirmation"], "900");
  assert.equal(primary.Parameters.LexSessionAttributes.lastAskedSlot, "serviceName");
  assert.equal(primary.Parameters.LexSessionAttributes.initialVoiceBookingContext, "true");
  assert.equal(primary.Parameters.LexSessionAttributes.audioTimeoutProfile, "p0_slow_speech_recovery_initial_v1");
  assert.equal(primary.Parameters.LexSessionAttributes.connectRecoveryStage, "initial");
  assert.equal(primary.Parameters.LexSessionAttributes.connectFlowSourceVersion, "2026-07-17-p0-voice-regression-fix");
  assert.equal(recovery.Parameters.Text, "$.Lex.SessionAttributes.connectContinuationPrompt");
  assert.equal(recovery.Transitions.NextAction, "check-transfer-to-queue");
  assert.equal(recovery.Parameters.LexSessionAttributes.connectRecoveryStage, "$.Attributes.connectRecoveryStage");
  assert.equal(recovery.Parameters.LexSessionAttributes.connectErrorCode, "$.Attributes.connectErrorCode");
  assert.equal(recovery.Parameters.LexSessionAttributes.connectContinuationPrompt, "$.Lex.SessionAttributes.connectContinuationPrompt");
  assert.equal(
    recovery.Parameters.LexSessionAttributes.connectContinuationPromptAvailable,
    "$.Lex.SessionAttributes.connectContinuationPromptAvailable"
  );
  assert.equal(recovery.Parameters.LexSessionAttributes.confirmationFingerprint, "$.Lex.SessionAttributes.confirmationFingerprint");
  assert.equal(recovery.Parameters.LexSessionAttributes.aiAlternativeSlots, "$.Lex.SessionAttributes.aiAlternativeSlots");
  assert.equal(recovery.Parameters.LexSessionAttributes.excludedStaffIds, "$.Lex.SessionAttributes.excludedStaffIds");
  assert.equal(recovery.Parameters.LexSessionAttributes.excludedStaffNames, "$.Lex.SessionAttributes.excludedStaffNames");
  assert.equal(recovery.Parameters.LexSessionAttributes.activeDtmfMenu, "$.Lex.SessionAttributes.activeDtmfMenu");
  assert.equal(finalRecovery.Type, "ConnectParticipantWithLexBot");
  assert.match(finalRecovery.Parameters.Text, /Press 0 for a person, or tell me your appointment again/i);
  assert.equal(finalRecovery.Parameters.LexSessionAttributes.outerRecoveryAttempt, "final");
  assert.equal(finalRecovery.Parameters.LexSessionAttributes.connectContinuationPrompt, "$.Lex.SessionAttributes.connectContinuationPrompt");
  assert.equal(
    finalRecovery.Parameters.LexSessionAttributes.connectContinuationPromptAvailable,
    "$.Lex.SessionAttributes.connectContinuationPromptAvailable"
  );
  assert.equal(finalRecovery.Parameters.LexSessionAttributes.excludedStaffIds, "$.Lex.SessionAttributes.excludedStaffIds");
  assert.equal(finalRecovery.Parameters.LexSessionAttributes.excludedStaffNames, "$.Lex.SessionAttributes.excludedStaffNames");
  assert.doesNotMatch(finalRecovery.Parameters.Text, /next prompt/i);
});

test("Connect AI reception routes only explicit complete conversations to goodbye", () => {
  const aiReceptionFlow = JSON.parse(
    readFileSync(path.join(connectRoot, "ai-reception.json"), "utf8")
  );
  const { actionsById } = collectReachableActions(aiReceptionFlow);
  const primary = actionsById.get("3b2877ca-bc16-4019-a8e6-04200c0ded06");
  const recovery = actionsById.get("6fbf4310-c8c6-44a8-a8f5-1d7830974c4d");
  const finalRecovery = actionsById.get("41e3f239-5b57-4363-92fc-9d594579fa98");
  const transferCheck = actionsById.get("check-transfer-to-queue");
  const completeCheck = actionsById.get("check-conversation-complete");
  const outcomeCheck = actionsById.get("check-terminal-conversation-outcome");
  const continuationPromptCheck = actionsById.get("check-continuation-prompt");

  assert.equal(primary.Transitions.NextAction, "check-transfer-to-queue");
  assert.equal(recovery.Transitions.NextAction, "check-transfer-to-queue");
  assert.equal(transferCheck.Parameters.ComparisonValue, "$.Lex.SessionAttributes.transferToQueue");
  assert.equal(transferCheck.Transitions.NextAction, "check-conversation-complete");
  assert.equal(transferCheck.Transitions.Conditions[0].NextAction, "transfer-human-escalation-flow");
  assert.equal(completeCheck.Parameters.ComparisonValue, "$.Lex.SessionAttributes.conversationComplete");
  assert.equal(completeCheck.Transitions.NextAction, "check-continuation-prompt");
  assert.equal(completeCheck.Transitions.Conditions[0].NextAction, "check-terminal-conversation-outcome");
  assert.equal(outcomeCheck.Parameters.ComparisonValue, "$.Lex.SessionAttributes.conversationOutcome");
  assert.equal(outcomeCheck.Transitions.NextAction, "check-continuation-prompt");
  assert.equal(continuationPromptCheck.Parameters.ComparisonValue, "$.Lex.SessionAttributes.connectContinuationPromptAvailable");
  assert.equal(continuationPromptCheck.Transitions.NextAction, "continuation-fallback-lex");
  assert.deepEqual(
    continuationPromptCheck.Transitions.Conditions,
    [
      {
        NextAction: "6fbf4310-c8c6-44a8-a8f5-1d7830974c4d",
        Condition: {
          Operator: "Equals",
          Operands: ["true"]
        }
      }
    ]
  );
  assert.equal(continuationPromptCheck.Transitions.Errors[0].NextAction, "continuation-fallback-lex");
  assert.deepEqual(
    outcomeCheck.Transitions.Conditions.map((condition) => condition.Condition.Operands[0]),
    ["BOOKED", "RESCHEDULED", "CANCELED", "CALLER_GOODBYE"]
  );
  assert.ok(
    outcomeCheck.Transitions.Conditions.every(
      (condition) => condition.NextAction === "67ada978-600a-4d39-9965-6230c52810a9"
    )
  );
  assert.equal(primary.Transitions.Errors[0].NextAction, "set-recovery-stage-initial-error");
  assert.equal(primary.Transitions.Errors[1].NextAction, "set-recovery-stage-initial-error");
  assert.equal(actionsById.get(primary.Transitions.Errors[0].NextAction).Transitions.NextAction, "initial-lex-error-message");
  assert.equal(actionsById.get(primary.Transitions.Errors[0].NextAction).Parameters.Attributes.connectErrorCode, "$.ErrorCode");
  assert.equal(recovery.Transitions.Errors[0].NextAction, "set-recovery-stage-retry-error");
  assert.equal(recovery.Transitions.Errors[1].NextAction, "set-recovery-stage-retry-error");
  assert.equal(actionsById.get(recovery.Transitions.Errors[0].NextAction).Transitions.NextAction, "retry-lex-error-message");
  assert.equal(actionsById.get(recovery.Transitions.Errors[0].NextAction).Parameters.Attributes.connectErrorCode, "$.ErrorCode");
  assert.notEqual(recovery.Transitions.Errors[0].NextAction, "67ada978-600a-4d39-9965-6230c52810a9");
  assert.notEqual(recovery.Transitions.Errors[1].NextAction, "67ada978-600a-4d39-9965-6230c52810a9");
  assert.equal(finalRecovery.Type, "ConnectParticipantWithLexBot");
  assert.equal(finalRecovery.Transitions.NextAction, "check-transfer-to-queue");
  assert.equal(finalRecovery.Transitions.Errors[0].NextAction, "final-recovery-goodbye");
  assert.equal(finalRecovery.Transitions.Errors[1].NextAction, "final-recovery-goodbye");
  assert.ok(
    recovery.Transitions.Conditions.some((condition) =>
      condition.Condition.Operands.includes("FallbackIntent")
    )
  );
  assert.ok(
    recovery.Transitions.Conditions.some((condition) =>
      condition.Condition.Operands.includes("AMAZON.FallbackIntent")
    )
  );
});

test("Connect AI reception recovery paths do not immediately disconnect after greeting", () => {
  const aiReceptionFlow = JSON.parse(
    readFileSync(path.join(connectRoot, "ai-reception.json"), "utf8")
  );
  const { actionsById, reachable } = collectReachableActions(aiReceptionFlow);
  const primary = actionsById.get("3b2877ca-bc16-4019-a8e6-04200c0ded06");
  const recovery = actionsById.get("6fbf4310-c8c6-44a8-a8f5-1d7830974c4d");
  const finalRecovery = actionsById.get("41e3f239-5b57-4363-92fc-9d594579fa98");

  for (const id of ["initial-lex-error-message", "retry-lex-error-message", "final-recovery-goodbye"]) {
    assert.ok(reachable.has(id), `${id} must be reachable from StartAction`);
    assert.equal(actionsById.get(id)?.Type, "MessageParticipant", `${id} must be audible`);
    assert.ok(String(actionsById.get(id)?.Parameters?.Text || "").trim(), `${id} must have literal text`);
  }

  for (const error of primary.Transitions.Errors) {
    const setRecovery = actionsById.get(error.NextAction);
    assert.equal(setRecovery?.Type, "UpdateContactAttributes");
    assert.equal(setRecovery?.Parameters?.Attributes?.connectErrorCode, "$.ErrorCode");
    assert.equal(setRecovery?.Transitions?.NextAction, "initial-lex-error-message");
    assertPathReaches(aiReceptionFlow, error.NextAction, "initial-lex-error-message");
    assertPathHasAudibleActionBeforeLex(aiReceptionFlow, error.NextAction, `${error.ErrorType} should be audible before retry Lex`);
    assert.notEqual(actionsById.get(error.NextAction)?.Type, "DisconnectParticipant");
  }
  for (const error of recovery.Transitions.Errors) {
    const setRecovery = actionsById.get(error.NextAction);
    assert.equal(setRecovery?.Type, "UpdateContactAttributes");
    assert.equal(setRecovery?.Parameters?.Attributes?.connectErrorCode, "$.ErrorCode");
    assert.equal(setRecovery?.Transitions?.NextAction, "retry-lex-error-message");
    assertPathReaches(aiReceptionFlow, error.NextAction, "retry-lex-error-message");
    assertPathHasAudibleActionBeforeLex(aiReceptionFlow, error.NextAction, `${error.ErrorType} should be audible before final Lex`);
  }
  for (const error of finalRecovery.Transitions.Errors) {
    assert.equal(error.NextAction, "final-recovery-goodbye");
    const path = assertPathReaches(aiReceptionFlow, error.NextAction, "ef8d8054-77ea-40c7-aa4e-800ed784c49c");
    assert.ok(path.includes("final-recovery-goodbye"), `${error.ErrorType} must play goodbye`);
    assert.equal(path.filter((id) => id === "41e3f239-5b57-4363-92fc-9d594579fa98").length, 0);
  }
  for (const id of reachable) {
    const action = actionsById.get(id);
    const text = action?.Parameters?.Text || "";
    const next = actionsById.get(action?.Transitions?.NextAction);
    assert.ok(
      !(/next prompt/i.test(text) && next?.Type === "DisconnectParticipant"),
      `${id} promises a next prompt before disconnect`
    );
    if (action?.Transitions?.Errors) {
      for (const error of action.Transitions.Errors) {
        const errorTarget = actionsById.get(error.NextAction);
        assert.ok(
          !(action.Type === "ConnectParticipantWithLexBot" && errorTarget?.Type === "DisconnectParticipant"),
          `${id} has a Lex error path directly to disconnect`
        );
      }
    }
  }
});

test("Connect AI reception routes operator transfer only through explicit transfer flag", () => {
  const aiReceptionFlow = JSON.parse(
    readFileSync(path.join(connectRoot, "ai-reception.json"), "utf8")
  );
  const { actionsById, reachable } = collectReachableActions(aiReceptionFlow);
  const transferCheck = actionsById.get("check-transfer-to-queue");

  assert.equal(transferCheck.Type, "Compare");
  assert.equal(transferCheck.Parameters.ComparisonValue, "$.Lex.SessionAttributes.transferToQueue");
  assert.equal(transferCheck.Transitions.Conditions[0].Condition.Operands[0], "true");
  assert.equal(transferCheck.Transitions.Conditions[0].NextAction, "transfer-human-escalation-flow");
  for (const id of reachable) {
    const action = actionsById.get(id);
    for (const condition of action?.Transitions?.Conditions || []) {
      assert.ok(
        !(condition.NextAction === "transfer-human-escalation-flow" && condition.Condition.Operands.includes("0")),
        `${id} has a direct DTMF 0 transfer condition`
      );
    }
  }
});

test("Connect AI reception disconnects only after an explicit audible goodbye", () => {
  const aiReceptionFlow = JSON.parse(
    readFileSync(path.join(connectRoot, "ai-reception.json"), "utf8")
  );
  const { actionsById, reachable } = collectReachableActions(aiReceptionFlow);

  for (const id of reachable) {
    const action = actionsById.get(id);
    for (const targetId of [
      action?.Transitions?.NextAction,
      ...(action?.Transitions?.Conditions || []).map((condition) => condition.NextAction),
      ...(action?.Transitions?.Errors || []).map((error) => error.NextAction)
    ].filter(Boolean)) {
      const target = actionsById.get(targetId);
      if (target?.Type !== "DisconnectParticipant") {
        continue;
      }
      assert.equal(action.Type, "MessageParticipant", `${id} must play goodbye before disconnect`);
      assert.match(action.Parameters?.Text || "", /goodbye/i, `${id} goodbye text`);
    }
  }
});

test("Connect AI reception missing fields and no-match paths stay nonterminal", () => {
  const aiReceptionFlow = JSON.parse(
    readFileSync(path.join(connectRoot, "ai-reception.json"), "utf8")
  );
  const { actionsById } = collectReachableActions(aiReceptionFlow);
  const completeCheck = actionsById.get("check-conversation-complete");
  const initialMessage = actionsById.get("initial-lex-error-message");
  const retryMessage = actionsById.get("retry-lex-error-message");

  assert.equal(completeCheck.Transitions.NextAction, "check-continuation-prompt");
  assert.notEqual(actionsById.get(completeCheck.Transitions.NextAction)?.Type, "DisconnectParticipant");
  assert.equal(initialMessage.Type, "MessageParticipant");
  assert.notEqual(actionsById.get(initialMessage.Transitions.NextAction)?.Type, "DisconnectParticipant");
  assert.equal(retryMessage.Type, "MessageParticipant");
  assert.notEqual(actionsById.get(retryMessage.Transitions.NextAction)?.Type, "DisconnectParticipant");
});

test("Connect AI reception dynamic Lex prompts have a reachable literal fallback", () => {
  const aiReceptionFlow = JSON.parse(
    readFileSync(path.join(connectRoot, "ai-reception.json"), "utf8")
  );
  const { actionsById, reachable } = collectReachableActions(aiReceptionFlow);
  const incomingByTarget = new Map();
  for (const action of aiReceptionFlow.Actions) {
    for (const targetId of getTransitionTargets(action)) {
      incomingByTarget.set(targetId, [...(incomingByTarget.get(targetId) || []), action]);
    }
  }

  for (const id of reachable) {
    const action = actionsById.get(id);
    const text = action?.Parameters?.Text;
    if (action?.Type !== "ConnectParticipantWithLexBot" || typeof text !== "string" || !text.startsWith("$.")) {
      continue;
    }
    const fallbackComparisons = (incomingByTarget.get(id) || []).filter((incoming) => {
      if (incoming.Type !== "Compare") {
        return false;
      }
      const explicitlyRoutesToDynamic = (incoming.Transitions?.Conditions || []).some(
        (condition) => condition.NextAction === id
      );
      const hasLiteralLexFallback = getTransitionTargets(incoming).some((targetId) => {
        const target = actionsById.get(targetId);
        return (
          target?.Type === "ConnectParticipantWithLexBot" &&
          target.Identifier !== id &&
          typeof target.Parameters?.Text === "string" &&
          !target.Parameters.Text.startsWith("$.") &&
          target.Parameters.Text.trim().length > 0
        );
      });
      return explicitlyRoutesToDynamic && hasLiteralLexFallback;
    });
    assert.ok(
      fallbackComparisons.length > 0,
      `${id} uses dynamic ${text} without a reachable literal fallback Lex prompt`
    );
  }
});

test("Connect source contract keeps production phone number on AI reception flow", () => {
  const dotenv = readFileSync(path.join(repoRoot, ".env"), "utf8");
  assert.match(dotenv, /AMAZON_CONNECT_PHONE_NUMBER=\+18483487681/);
  assert.match(dotenv, /AMAZON_CONNECT_PHONE_NUMBER_ID=f2e36faa-5264-4955-8a18-e2f53755c102/);
  assert.match(dotenv, /AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION=dcccf542-587c-426c-a644-a4c6f24da6e4/);
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
  const slowSpeechServiceEndTimeoutMinMs = 3200;
  const expected = {
    serviceName: { startMin: 8000, endMin: slowSpeechServiceEndTimeoutMinMs, endMax: 4200, maxMin: 20000 },
    requestedDate: { startMin: 8000, endMin: 2100, endMax: 2300, maxMin: 20000 },
    requestedTime: { startMin: 8000, endMin: 2100, endMax: 2300, maxMin: 20000 },
    staffPreference: { startMin: 8000, endMin: 2500, endMax: 2700, maxMin: 20000 },
    customerName: { startMin: 8000, endMin: 1900, endMax: 2100, maxMin: 20000 },
    customerPhone: { startMin: 8000, endMin: 1900, endMax: 2100, maxMin: 20000 }
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
      assert.ok(
        audio.endTimeoutMs >= range.endMin && audio.endTimeoutMs <= range.endMax,
        `${slotName}.${attemptName} end timeout preserves measured slow-speech floor`
      );
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

test("Lambda asks for confirmation when Lex grounds noisy ten eight ten as 8:10", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  const fetchCalls = installFetchMock(() => {
    throw new Error("API should not be called before ambiguous time is confirmed");
  });

  const response = await handler(
    baseEvent({
      invocationSource: "FulfillmentCodeHook",
      inputTranscript: "uh ten eight ten a m",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-noisy-time-lambda",
          customerName: "Kiet Nguyen",
          customerPhone: "7325956266",
          serviceName: "Manicure",
          requestedDate: usEasternDate(1),
          requestedTime: "8:10 AM",
          staffPreference: "Amy",
          lastAskedSlot: "requestedTime"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          confirmationState: "None",
          slots: {
            customerName: slot("Kiet Nguyen"),
            customerPhone: slot("7325956266"),
            serviceName: slot("Manicure"),
            requestedDate: slot(usEasternDate(1)),
            requestedTime: slotWith({
              originalValue: "uh ten eight ten a m",
              interpretedValue: "08:10",
              resolvedValues: ["08:10"]
            }),
            staffPreference: slot("Amy")
          }
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 0);
  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "requestedTime");
  assert.match(response.messages[0].content, /Did you mean 10 AM/i);
  assert.equal(response.sessionState.sessionAttributes.awaitingTimeConfirmation, "true");
  assert.equal(response.sessionState.sessionAttributes.proposedRequestedTime, "10 AM");
  assert.equal(response.sessionState.sessionAttributes.requestedTime, undefined);
  assert.match(response.sessionState.sessionAttributes.timeRecognitionDiagnostics, /multiple_time_candidates|noisy_time_transcript/);
});

test("Lambda confirmed noisy time posts 10 AM to the backend", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Please confirm.",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitIntent"
          },
          sessionAttributes: {
            serviceName: "Manicure",
            requestedDate: body.requestedDate,
            requestedTime: body.requestedTime,
            staffPreference: "Amy",
            awaitingTimeConfirmation: "false"
          }
        }
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "FulfillmentCodeHook",
      inputTranscript: "yes",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-noisy-time-lambda",
          customerName: "Kiet Nguyen",
          customerPhone: "7325956266",
          serviceName: "Manicure",
          requestedDate: usEasternDate(1),
          staffPreference: "Amy",
          lastAskedSlot: "requestedTime",
          awaitingTimeConfirmation: "true",
          proposedRequestedTime: "10 AM"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          confirmationState: "None",
          slots: {
            customerName: slot("Kiet Nguyen"),
            customerPhone: slot("7325956266"),
            serviceName: slot("Manicure"),
            requestedDate: slot(usEasternDate(1)),
            requestedTime: null,
            staffPreference: slot("Amy")
          }
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.requestedTime, "10 AM");
  assert.equal(fetchCalls[0].body.attributes.awaitingTimeConfirmation, "false");
  assert.equal(response.sessionState.dialogAction.type, "ElicitIntent");
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "10 AM");
});

test("Lambda clear time phrases post deterministic requested times", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Please confirm.",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitIntent"
          },
          sessionAttributes: {
            serviceName: "Manicure",
            requestedDate: body.requestedDate,
            requestedTime: body.requestedTime,
            staffPreference: "Amy"
          }
        }
      })
    )
  );

  for (const [phrase, expected] of [
    ["ten a m", "10 AM"],
    ["10 AM", "10 AM"],
    ["at ten", "10 AM"],
    ["ten o'clock", "10 AM"],
    ["eight ten a m", "8:10 AM"],
    ["8:10 AM", "8:10 AM"]
  ]) {
    const response = await handler(
      baseEvent({
        invocationSource: "FulfillmentCodeHook",
        inputTranscript: phrase,
        sessionState: {
          ...baseEvent().sessionState,
          sessionAttributes: {
            salonId: "salon-explicit",
            CalledNumber: "+18483487681",
            CustomerEndpointAddress: "+17325956266",
            AmazonConnectContactId: `connect-time-${phrase.replace(/[^a-z0-9]+/gi, "-")}`,
            customerName: "Kiet Nguyen",
            customerPhone: "7325956266",
            serviceName: "Manicure",
            requestedDate: usEasternDate(1),
            staffPreference: "Amy",
            lastAskedSlot: "requestedTime"
          },
          intent: {
            ...baseEvent().sessionState.intent,
            confirmationState: "None",
            slots: {
              customerName: slot("Kiet Nguyen"),
              customerPhone: slot("7325956266"),
              serviceName: slot("Manicure"),
              requestedDate: slot(usEasternDate(1)),
              requestedTime: slotWith({
                originalValue: phrase,
                interpretedValue: phrase,
                resolvedValues: [phrase]
              }),
              staffPreference: slot("Amy")
            }
          }
        }
      })
    );
    const latestFetch = fetchCalls.at(-1);

    assert.equal(latestFetch.body.requestedTime, expected, phrase);
    assert.equal(response.sessionState.dialogAction.type, "ElicitIntent", phrase);
    assert.equal(response.sessionState.sessionAttributes.requestedTime, expected, phrase);
  }
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
            type: "ElicitIntent"
          },
          sessionAttributes: {
            customerId: "89e51525-297d-4b2a-b438-f64c4848683a",
            customerName: "Jane",
            customerPhone: "+15555550123",
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
          CallerId: "+15555550123",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "bb0b6ac3-a5be-4c9d-abac-7297a301d7bc",
          customerId: "89e51525-297d-4b2a-b438-f64c4848683a",
          customerName: "Jane",
          recognizedCustomerName: "Jane",
          customerNameSource: "customer",
          customerPhone: "+15555550123",
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
            customerPhone: slot("+15555550123"),
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
  assert.equal(fetchCalls[0].body.customerPhone, "+15555550123");
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
  assert.equal(response.sessionState.dialogAction.type, "ElicitIntent");
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
            type: "ElicitIntent"
          },
          sessionAttributes: {
            awaitingFinalBookingConfirmation: "true",
            bookingConfirmationAsked: "true",
            customerName: "Jane",
            customerPhone: "+15555550123",
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
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-live-oneshot-spoken-pm",
          customerId: "89e51525-297d-4b2a-b438-f64c4848683a",
          customerName: "Jane",
          recognizedCustomerName: "Jane",
          customerNameSource: "customer",
          customerPhone: "+15555550123"
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
  assert.equal(response.sessionState.dialogAction.type, "ElicitIntent");
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
            type: "ElicitIntent"
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
    "I want to book a fool set tomorrow at 3 PM with Trang.",
    "I want to book a foot set tomorrow at 3 PM with Trang.",
    "I want to book a full step tomorrow at 3 PM with Trang.",
    "I want a set of nails tomorrow at 3 PM with Trang."
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
            CustomerEndpointAddress: "+15555550123",
            AmazonConnectContactId: `connect-full-set-${inputTranscript.replace(/\W+/g, "-")}`,
            customerId: "89e51525-297d-4b2a-b438-f64c4848683a",
            customerName: "Jane",
            recognizedCustomerName: "Jane",
            customerNameSource: "customer",
            customerPhone: "+15555550123",
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
      assert.equal(response.sessionState.dialogAction.type, "ElicitIntent", inputTranscript);
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

test("DialogCodeHook confirms known caller Full Set live phrases in one turn", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  const tomorrow = usEasternDate(1);
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Lee, just to confirm: Full Set tomorrow at 3 PM with Amy. Is that correct?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitIntent"
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
    "Full Set tomorrow at 3 PM with Amy.",
    "Full Set... tomorrow at 3 PM... with Amy.",
    "full sets tomorrow at 3 PM with Amy."
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
            CustomerEndpointAddress: "+84798171999",
            AmazonConnectContactId: `connect-known-lee-${inputTranscript.replace(/\W+/g, "-")}`,
            customerId: "customer-lee",
            customerName: "Lee",
            recognizedCustomerName: "Lee",
            customerNameSource: "phone_lookup",
            customerPhone: "+84798171999"
          },
          intent: {
            ...baseEvent().sessionState.intent,
            name: "BookAppointmentIntent",
            state: "InProgress",
            confirmationState: "None",
            slots: {}
          }
        }
      })
    );

    const latestFetch = fetchCalls.at(-1);
    assert.equal(fetchCalls.length, fetchCountBefore + 1, inputTranscript);
    assert.equal(latestFetch.body.serviceName, "Full Set", inputTranscript);
    assert.equal(latestFetch.body.requestedDate, tomorrow, inputTranscript);
    assert.equal(latestFetch.body.requestedTime, "3 PM", inputTranscript);
    assert.equal(latestFetch.body.staffPreference, "Amy", inputTranscript);
    assert.equal(latestFetch.body.customerName, "Lee", inputTranscript);
    assert.equal(response.sessionState.dialogAction.type, "ElicitIntent", inputTranscript);
    assert.equal(
      response.messages[0].content,
      "Lee, just to confirm: Full Set tomorrow at 3 PM with Amy. Is that correct?",
      inputTranscript
    );
    assert.doesNotMatch(response.messages[0].content, /I can help you book or cancel|Which service/i);
  }
});

test("DialogCodeHook clarifies scoped who-said Full Set ASR without committing service", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  const fetchCalls = installFetchMock(() => {
    throw new Error("fetch should not be called before service clarification");
  });

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "who said tomorrow at three p m and it's time to fight",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "1771efd3-27a4-4e2b-8a36-02a27705b8b2",
          customerName: "Lee",
          customerPhone: "+84798171999"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          name: "BookAppointmentIntent",
          state: "InProgress",
          confirmationState: "None",
          slots: {}
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 0);
  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.equal(response.sessionState.sessionAttributes.requestedDate, usEasternDate(1));
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "3 PM");
  assert.equal(response.sessionState.sessionAttributes.serviceName, undefined);
  assert.equal(response.sessionState.sessionAttributes.proposedServiceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.awaitingServiceConfirmation, "true");
  assert.deepEqual(JSON.parse(response.sessionState.sessionAttributes.voiceSlotDecisions), [
    {
      slot: "serviceName",
      action: "propose",
      canonicalValue: "Full Set",
      reason: "scoped_phonetic_full_set",
      confidenceBand: "medium",
      evidence: ["who said tomorrow at three p m and it's time to fight"],
      alternativesUsed: false
    }
  ]);
  assert.match(response.messages[0].content, /I heard tomorrow at 3 PM.*Did you say Full Set\?/i);
});

test("DialogCodeHook handles live distorted Full Set transcripts without silent service commit", async () => {
  for (const [phrase, expected] of [
    [
      "the pool set tomorrow at three p m",
      {
        proposed: "Full Set",
        date: usEasternDate(1),
        time: "3 PM",
        staff: undefined,
        prompt: /Did you say Full Set/i
      }
    ],
    [
      "food set tomorrow at two pm and it's top a five",
      {
        proposed: "Full Set",
        date: usEasternDate(1),
        time: "2 PM",
        staff: undefined,
        prompt: /Did you say Full Set/i
      }
    ],
    [
      "who's that tomorrow at two p m",
      {
        proposed: "Full Set",
        date: usEasternDate(1),
        time: "2 PM",
        staff: undefined,
        prompt: /Did you say Full Set/i
      }
    ],
    [
      "who's that tomorrow at three p m",
      {
        proposed: "Full Set",
        date: usEasternDate(1),
        time: "3 PM",
        staff: undefined,
        prompt: /Did you say Full Set/i
      }
    ],
    [
      "sunset is it food",
      {
        proposed: undefined,
        date: undefined,
        time: undefined,
        staff: undefined,
        prompt: /Which service would you like/i
      }
    ],
    [
      "The sunset is beautiful",
      {
        proposed: undefined,
        date: undefined,
        time: undefined,
        staff: undefined,
        prompt: /Which service would you like/i
      }
    ],
    [
      "Fun facts are interesting",
      {
        proposed: undefined,
        date: undefined,
        time: undefined,
        staff: undefined,
        prompt: /Which service would you like/i
      }
    ],
    [
      "food set",
      {
        proposed: undefined,
        date: undefined,
        time: undefined,
        staff: undefined,
        prompt: /Which service would you like/i
      }
    ],
    [
      "fun fact today",
      {
        proposed: undefined,
        date: usEasternDate(0),
        time: undefined,
        staff: undefined,
        prompt: /Which service would you like/i
      }
    ],
    [
      "fun fact today at gpm with amy",
      {
        proposed: undefined,
        date: usEasternDate(0),
        time: undefined,
        staff: "Amy",
        prompt: /Which service would you like/i
      }
    ],
    [
      "fun fact tomorrow at three p m with amy",
      {
        proposed: "Full Set",
        date: usEasternDate(1),
        time: "3 PM",
        staff: "Amy",
        prompt: /Did you say Full Set/i
      }
    ],
    [
      "phone set tomorrow at three pm with amy",
      {
        proposed: "Full Set",
        date: usEasternDate(1),
        time: "3 PM",
        staff: "Amy",
        prompt: /Did you say Full Set/i
      }
    ],
    [
      "cool set tomorrow at three pm",
      {
        proposed: "Full Set",
        date: usEasternDate(1),
        time: "3 PM",
        staff: undefined,
        prompt: /Did you say Full Set/i
      }
    ],
    [
      "can we set tomorrow at three pm with emmy",
      {
        proposed: "Full Set",
        date: usEasternDate(1),
        time: "3 PM",
        staff: "Amy",
        prompt: /Did you say Full Set/i
      }
    ],
    [
      "today at gpm with angie",
      {
        proposed: undefined,
        date: usEasternDate(0),
        time: undefined,
        staff: undefined,
        prompt: /Which service would you like/i
      }
    ]
  ]) {
    const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
    globalThis.fetch = async () => {
      throw new Error(`fetch should not be called for distorted local transcript ${phrase}`);
    };

    const response = await handler(
      baseEvent({
        invocationSource: "DialogCodeHook",
        inputTranscript: phrase,
        sessionId: `connect-distorted-${phrase.replace(/\W+/g, "-")}`,
        sessionState: {
          ...baseEvent().sessionState,
          sessionAttributes: {
            salonId: "salon-explicit",
            CalledNumber: "+18483487681",
            CustomerEndpointAddress: "+84798171999",
            AmazonConnectContactId: `connect-distorted-${phrase.replace(/\W+/g, "-")}`,
            customerName: "Lee",
            customerPhone: "+84798171999"
          },
          intent: {
            ...baseEvent().sessionState.intent,
            name: "BookAppointmentIntent",
            state: "InProgress",
            confirmationState: "None",
            slots: {}
          }
        }
      })
    );

    assert.equal(response.sessionState.sessionAttributes.serviceName, undefined, phrase);
    assert.equal(response.sessionState.sessionAttributes.proposedServiceName, expected.proposed, phrase);
    assert.equal(response.sessionState.sessionAttributes.requestedDate, expected.date, phrase);
    assert.equal(response.sessionState.sessionAttributes.requestedTime, expected.time, phrase);
    assert.equal(response.sessionState.sessionAttributes.staffPreference, expected.staff, phrase);
    assert.equal(response.sessionState.dialogAction.slotToElicit, "serviceName", phrase);
    assert.match(response.messages?.[0]?.content || "", expected.prompt, phrase);
    if (expected.proposed) {
      const decisions = JSON.parse(response.sessionState.sessionAttributes.voiceSlotDecisions);
      assert.equal(decisions[0].slot, "serviceName", phrase);
      assert.equal(decisions[0].action, "propose", phrase);
      assert.equal(decisions[0].canonicalValue, "Full Set", phrase);
      assert.equal(decisions[0].confidenceBand, "medium", phrase);
    } else {
      assert.equal(response.sessionState.sessionAttributes.voiceSlotDecisions, undefined, phrase);
    }
  }
});

test("DialogCodeHook uses N-best Full Set alternative as a proposed service only", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  installFetchMock(() => {
    throw new Error("fetch should not be called before N-best service confirmation");
  });

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "who said today at three p m",
      transcriptions: [
        { transcription: "who said today at three p m", confidence: 0.73 },
        { transcription: "Full Set today at three p m", confidence: 0.69 }
      ],
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-nbest-full-set-service",
          customerName: "Lee",
          customerPhone: "+84798171999"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          name: "BookAppointmentIntent",
          state: "InProgress",
          confirmationState: "None",
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.serviceName, undefined);
  assert.equal(response.sessionState.sessionAttributes.proposedServiceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.awaitingServiceConfirmation, "true");
  assert.equal(response.sessionState.sessionAttributes.asrAlternativesUsed, "true");
  assert.match(response.messages[0].content, /Did you say Full Set\?/i);
});

test("DialogCodeHook staff-turn stopped-at-five does not overwrite trusted 3 PM", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  installFetchMock(() => {
    throw new Error("fetch should not be called before ambiguous staff confirmation");
  });

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "and it stopped at five",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "88a5a00a-ee09-4055-b73f-7c3909b2c784",
          customerName: "Lee",
          customerPhone: "+84798171999",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(0),
          requestedTime: "3 PM",
          lastAskedSlot: "staffPreference",
          ...dynamicStaffAttributes()
        },
        intent: {
          ...baseEvent().sessionState.intent,
          name: "BookAppointmentIntent",
          state: "InProgress",
          confirmationState: "None",
          slots: {
            requestedTime: slot("5 PM")
          }
        }
      }
    })
  );

  const attrs = response.sessionState.sessionAttributes;
  assert.equal(attrs.requestedTime, "3 PM");
  assert.equal(attrs.proposedStaffPreference, "Any staff");
  assert.equal(attrs.awaitingStaffConfirmation, "true");
  assert.equal(attrs.staffPreference, undefined);
  assert.notEqual(response.sessionState.intent.slots.requestedTime?.value?.interpretedValue, "5 PM");
  assert.match(response.messages[0].content, /I still have Full Set today at 3 PM\. Did you mean first available\?/i);
});

test("DialogCodeHook uses N-best first-available staff alternative as a proposal only", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  installFetchMock(() => {
    throw new Error("fetch should not be called before N-best staff confirmation");
  });

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "and it sounded okay",
      transcriptions: [
        { transcription: "and it sounded okay", confidence: 0.74 },
        { transcription: "first available", confidence: 0.68 }
      ],
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-nbest-first-available-staff",
          customerName: "Lee",
          customerPhone: "+84798171999",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(0),
          requestedTime: "3 PM",
          lastAskedSlot: "staffPreference",
          ...dynamicStaffAttributes()
        },
        intent: {
          ...baseEvent().sessionState.intent,
          name: "BookAppointmentIntent",
          state: "InProgress",
          confirmationState: "None",
          slots: {}
        }
      }
    })
  );

  const attrs = response.sessionState.sessionAttributes;
  assert.equal(attrs.requestedTime, "3 PM");
  assert.equal(attrs.staffPreference, undefined);
  assert.equal(attrs.proposedStaffPreference, "Any staff");
  assert.equal(attrs.awaitingStaffConfirmation, "true");
  assert.equal(attrs.asrAlternativesUsed, "true");
  assert.match(response.messages[0].content, /I still have Full Set today at 3 PM\. Did you mean first available\?/i);
});

test("DialogCodeHook proposes first available for edit stop if i without mutating time", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called before staff clarification");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "edit stop if i",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-edit-stop-if-i",
          customerName: "Lee",
          customerPhone: "+84798171999",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(1),
          requestedTime: "3 PM",
          lastAskedSlot: "staffPreference",
          ...dynamicStaffAttributes()
        },
        intent: {
          ...baseEvent().sessionState.intent,
          state: "InProgress",
          confirmationState: "None",
          slots: {}
        }
      }
    })
  );

  const attrs = response.sessionState.sessionAttributes;
  assert.equal(attrs.requestedTime, "3 PM");
  assert.equal(attrs.serviceName, "Full Set");
  assert.equal(attrs.proposedStaffPreference, "Any staff");
  assert.equal(attrs.awaitingStaffConfirmation, "true");
  assert.equal(attrs.staffPreference, undefined);
  assert.match(response.messages[0].content, /Did you mean first available\?/i);
});

test("DialogCodeHook not-a-five rejects ambiguous staff proposal without setting time or staff", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  installFetchMock(() => {
    throw new Error("fetch should not be called for rejected staff proposal");
  });

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "and it's not a five",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "88a5a00a-ee09-4055-b73f-7c3909b2c784",
          customerName: "Lee",
          customerPhone: "+84798171999",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(0),
          requestedTime: "3 PM",
          lastAskedSlot: "staffPreference",
          awaitingStaffConfirmation: "true",
          proposedStaffPreference: "Any staff",
          ...dynamicStaffAttributes()
        },
        intent: {
          ...baseEvent().sessionState.intent,
          name: "BookAppointmentIntent",
          state: "InProgress",
          confirmationState: "None",
          slots: {
            requestedTime: slot("5 PM"),
            staffPreference: slot("five")
          }
        }
      }
    })
  );

  const attrs = response.sessionState.sessionAttributes;
  assert.equal(attrs.requestedTime, "3 PM");
  assert.equal(attrs.staffPreference, undefined);
  assert.ok(!attrs.proposedStaffPreference);
  assert.ok(!attrs.awaitingStaffConfirmation || attrs.awaitingStaffConfirmation === "false");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "staffPreference");
  assert.match(response.messages[0].content, /Understood\. I still have 3 PM\. Which staff would you like, Amy or first available\?/i);
});

test("DialogCodeHook explicit staff-turn time correction may replace trusted time", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Lee, just to confirm: Full Set today at 5 PM with Amy. Is that correct?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitSlot",
            slotToElicit: "bookingConfirmation"
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
            awaitingFinalBookingConfirmation: "true",
            bookingConfirmationAsked: "true"
          }
        },
        missingFields: []
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "Actually change it to 5 PM with Amy",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-explicit-valid-time-correction",
          customerName: "Lee",
          customerPhone: "+84798171999",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(0),
          requestedTime: "3 PM",
          lastAskedSlot: "staffPreference",
          ...dynamicStaffAttributes()
        },
        intent: {
          ...baseEvent().sessionState.intent,
          name: "BookAppointmentIntent",
          state: "InProgress",
          confirmationState: "None",
          slots: {}
        }
      }
    })
  );

  assert.equal(fetchCalls.at(-1).body.requestedTime, "5 PM");
  assert.equal(fetchCalls.at(-1).body.staffPreference, "Amy");
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "5 PM");
});

test("DialogCodeHook blocks sunset from Full Set while preserving date and time", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Which service would you like?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitSlot",
            slotToElicit: "serviceName"
          },
          sessionAttributes: {
            ...dynamicStaffAttributes(),
            customerName: body.customerName,
            customerPhone: body.customerPhone,
            serviceName: body.serviceName,
            confirmedServiceName: body.serviceName,
            requestedDate: body.requestedDate,
            requestedTime: body.requestedTime,
            staffPreference: body.staffPreference,
            lastAskedSlot: "serviceName"
          }
        },
        missingFields: ["serviceName"]
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "sunset today at three p m with a",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-sunset-with-a",
          customerName: "Jane",
          customerPhone: "+17325956266",
          ...dynamicStaffAttributes()
        },
        intent: {
          ...baseEvent().sessionState.intent,
          name: "BookAppointmentIntent",
          state: "InProgress",
          confirmationState: "None",
          slots: {
            serviceName: slotWith({
              originalValue: "sunset",
              interpretedValue: "sunset",
              resolvedValues: ["sunset"]
            })
          }
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.serviceName, undefined);
  assert.equal(fetchCalls[0].body.requestedDate, usEasternDate(0));
  assert.equal(fetchCalls[0].body.requestedTime, "3 PM");
  assert.equal(fetchCalls[0].body.staffPreference, undefined);
  assert.match(
    JSON.stringify(
      fetchCalls[0].body.attributes.lexTurnDebug?.sanitization?.ignoredUngroundedSlots ??
        fetchCalls[0].body.attributes.lexTurnDebug?.ignoredUngroundedSlots ??
        []
    ),
    /serviceName_unsafe_sunset/
  );
  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.equal(response.sessionState.sessionAttributes.serviceName, undefined);
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "3 PM");
  assert.equal(response.sessionState.sessionAttributes.staffPreference, undefined);
  assert.doesNotMatch(response.messages[0].content, /Full Set|just to confirm/i);
});

test("DialogCodeHook blocks sunset from Full Set when staff phrase is bare with", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Which service would you like?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitSlot",
            slotToElicit: "serviceName"
          },
          sessionAttributes: {
            customerName: body.customerName,
            customerPhone: body.customerPhone,
            serviceName: body.serviceName,
            confirmedServiceName: body.serviceName,
            requestedDate: body.requestedDate,
            requestedTime: body.requestedTime,
            staffPreference: body.staffPreference,
            lastAskedSlot: "serviceName"
          }
        },
        missingFields: ["serviceName"]
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "sunset today at three pm with",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-sunset-bare-with",
          customerName: "Jane",
          customerPhone: "+17325956266",
          ...dynamicStaffAttributes()
        },
        intent: {
          ...baseEvent().sessionState.intent,
          name: "BookAppointmentIntent",
          state: "InProgress",
          confirmationState: "None",
          slots: {
            serviceName: slotWith({
              originalValue: "sunset",
              interpretedValue: "sunset",
              resolvedValues: ["sunset"]
            })
          }
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.serviceName, undefined);
  assert.equal(fetchCalls[0].body.requestedDate, usEasternDate(0));
  assert.equal(fetchCalls[0].body.requestedTime, "3 PM");
  assert.equal(fetchCalls[0].body.staffPreference, undefined);
  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.equal(response.sessionState.sessionAttributes.serviceName, undefined);
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "3 PM");
  assert.doesNotMatch(response.messages[0].content, /Full Set|just to confirm/i);
});

test("DialogCodeHook keeps safe fields but asks service for sunset today with Amy", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Which service would you like?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitSlot",
            slotToElicit: "serviceName"
          },
          sessionAttributes: {
            customerName: body.customerName,
            customerPhone: body.customerPhone,
            serviceName: body.serviceName,
            confirmedServiceName: body.serviceName,
            requestedDate: body.requestedDate,
            requestedTime: body.requestedTime,
            staffPreference: body.staffPreference,
            lastAskedSlot: "serviceName"
          }
        },
        missingFields: ["serviceName"]
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "sunset today at three p m with Amy",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-sunset-today-amy",
          customerName: "Jane",
          customerPhone: "+17325956266"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          name: "BookAppointmentIntent",
          state: "InProgress",
          confirmationState: "None",
          slots: {
            serviceName: slotWith({
              originalValue: "sunset",
              interpretedValue: "sunset",
              resolvedValues: ["sunset"]
            })
          }
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.serviceName, undefined);
  assert.equal(fetchCalls[0].body.requestedDate, usEasternDate(0));
  assert.equal(fetchCalls[0].body.requestedTime, "3 PM");
  assert.equal(fetchCalls[0].body.staffPreference, "Amy");
  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.doesNotMatch(response.messages[0].content, /Full Set|just to confirm/i);
});

test("DialogCodeHook adds compact staff runtime hints only for staff elicitation", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Which staff would you like?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitSlot",
            slotToElicit: "staffPreference"
          },
          sessionAttributes: {
            customerName: body.customerName,
            customerPhone: body.customerPhone,
            serviceName: body.serviceName,
            confirmedServiceName: body.serviceName,
            requestedDate: body.requestedDate,
            requestedTime: body.requestedTime,
            lastAskedSlot: "staffPreference",
            staffDtmfOptions: JSON.stringify({
              "1": "Alice",
              "2": "Kelly",
              "3": "Any staff"
            }),
            staffDtmfStaffIds: JSON.stringify({
              "1": "staff-alice",
              "2": "staff-kelly"
            })
          }
        },
        missingFields: ["staffPreference"]
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "sunset today at three p m with a",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-staff-runtime-hints",
          customerName: "Jane",
          customerPhone: "+17325956266",
          staffDtmfOptions: JSON.stringify({
            "1": "Amy",
            "2": "Any staff"
          })
        },
        intent: {
          ...baseEvent().sessionState.intent,
          name: "BookAppointmentIntent",
          state: "InProgress",
          confirmationState: "None",
          slots: {
            serviceName: slotWith({
              originalValue: "sunset",
              interpretedValue: "sunset",
              resolvedValues: ["sunset"]
            })
          }
        }
      }
    })
  );

  const slotHints = response.sessionState.runtimeHints.slotHints.BookAppointmentIntent;
  const phrases = slotHints.staffPreference.runtimeHintValues.map((item) => item.phrase);
  assert.deepEqual(phrases, [
    "Alice",
    "Kelly",
    "Any staff",
    "Any staff is fine",
    "Any stuff is fine",
    "Anyone is fine",
    "First available",
    "Whoever is available"
  ]);
  assert.equal(slotHints.serviceName, undefined);
  assert.doesNotMatch(JSON.stringify(response.sessionState.runtimeHints), /Amy/);
});

test("DialogCodeHook adds compact service runtime hints only for service elicitation", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Which service would you like?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitSlot",
            slotToElicit: "serviceName"
          },
          sessionAttributes: {
            customerName: "Jane",
            customerPhone: "+17325956266",
            requestedDate: usEasternDate(0),
            requestedTime: "3 PM",
            staffPreference: "Amy",
            lastAskedSlot: "serviceName",
            activeServiceNames: JSON.stringify(["Pedicure", "Full Set"]),
            serviceDtmfOptions: JSON.stringify({
              "1": "Pedicure",
              "2": "Full Set"
            })
          }
        },
        missingFields: ["serviceName"]
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "today at three p m with Amy",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-service-runtime-hints",
          customerName: "Jane",
          customerPhone: "+17325956266"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          name: "BookAppointmentIntent",
          state: "InProgress",
          confirmationState: "None",
          slots: {}
        }
      }
    })
  );

  const slotHints = response.sessionState.runtimeHints.slotHints.BookAppointmentIntent;
  const phrases = slotHints.serviceName.runtimeHintValues.map((item) => item.phrase);
  assert.deepEqual(phrases, ["Pedicure", "Full Set"]);
  assert.equal(slotHints.staffPreference, undefined);
});

test("DialogCodeHook does not map sunset while serviceName was last asked", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  installFetchMock(() => {
    throw new Error("unsafe sunset service slot should not call the booking API yet");
  });

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "sunset",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-sunset-service-slot",
          lastAskedSlot: "serviceName"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          name: "BookAppointmentIntent",
          state: "InProgress",
          confirmationState: "None",
          slots: {
            serviceName: slotWith({
              originalValue: "sunset",
              interpretedValue: "sunset",
              resolvedValues: ["sunset"]
            })
          }
        }
      }
    })
  );

  assert.notEqual(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.notEqual(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.doesNotMatch(response.messages[0].content, /Full Set|just to confirm/i);
});

test("DialogCodeHook does not treat non-booking fun fact as Full Set", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  const fetchCalls = installFetchMock(() => {
    throw new Error("non-booking fun fact should not call the booking API");
  });

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "tell me a fun fact",
      sessionState: {
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-nonbooking-fun-fact"
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

  assert.equal(fetchCalls.length, 0);
  assert.notEqual(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.notEqual(response.sessionState.dialogAction?.slotToElicit, "serviceName");
  assert.doesNotMatch(response.messages?.[0]?.content || "", /Full Set/i);
});

test("DialogCodeHook does not treat unrelated sunset sentence as Full Set", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  const fetchCalls = installFetchMock(() => {
    throw new Error("non-booking sunset should not call the booking API");
  });

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "The sunset is beautiful",
      sessionState: {
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-nonbooking-sunset"
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

  assert.equal(fetchCalls.length, 0);
  assert.notEqual(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.doesNotMatch(response.messages?.[0]?.content || "", /Full Set/i);
  assert.doesNotMatch(response.messages?.[0]?.content || "", /just to confirm/i);
});

test("DialogCodeHook blocks sunset even when Lex resolves a service slot", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Which service would you like?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitSlot",
            slotToElicit: "serviceName"
          },
          sessionAttributes: {
            serviceName: body.serviceName,
            confirmedServiceName: body.serviceName,
            requestedDate: body.requestedDate,
            requestedTime: body.requestedTime,
            lastAskedSlot: "serviceName"
          }
        },
        missingFields: ["serviceName"]
      })
    )
  );

  await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "sunset tomorrow at three pm",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-active-sunset-service",
          activeServiceNames: JSON.stringify(["Pedicure", "Full Set"])
        },
        intent: {
          ...baseEvent().sessionState.intent,
          name: "BookAppointmentIntent",
          state: "InProgress",
          confirmationState: "None",
          slots: {
            serviceName: slotWith({
              originalValue: "sunset",
              interpretedValue: "Sunset",
              resolvedValues: ["Sunset"]
            })
          }
        }
      }
    })
  );

  const bookingCall = fetchCalls.at(-1);
  assert.equal(bookingCall.body.serviceName, undefined);
  assert.notEqual(bookingCall.body.serviceName, "Full Set");
  assert.equal(bookingCall.body.requestedDate, usEasternDate(1));
  assert.equal(bookingCall.body.requestedTime, "3 PM");
});

test("DialogCodeHook resolves pay the bill tomorrow at two p m with any staff in one turn", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Please confirm Pedicure tomorrow at 2 PM with first available.",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitIntent"
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
      inputTranscript: "pay the bill tomorrow at two p m with any staff",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-pay-bill-any-staff",
          customerName: "Jane",
          customerPhone: "+15555550123"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          name: "BookAppointmentIntent",
          state: "InProgress",
          confirmationState: "None",
          slots: {}
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.serviceName, "Pedicure");
  assert.equal(fetchCalls[0].body.requestedDate, usEasternDate(1));
  assert.equal(fetchCalls[0].body.requestedTime, "2 PM");
  assert.equal(fetchCalls[0].body.staffPreference, "Any staff");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Pedicure");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Pedicure");
});

test("DialogCodeHook stale service digit cannot replace spoken Manicure after menu closes", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Please confirm Manicure tomorrow at 2 PM with Amy.",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitIntent"
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

  await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "1",
      inputMode: "Text",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-stale-service-digit",
          customerName: "Jane",
          customerPhone: "+15555550123",
          serviceName: "Manicure",
          confirmedServiceName: "Manicure",
          requestedDate: usEasternDate(1),
          requestedTime: "2 PM",
          staffPreference: "Amy",
          confirmedStaffName: "Amy",
          lastAskedSlot: "serviceName",
          serviceDtmfOptions: JSON.stringify({ "1": "Pedicure", "2": "Manicure", "0": "__operator__" })
        },
        intent: {
          ...baseEvent().sessionState.intent,
          name: "BookAppointmentIntent",
          state: "InProgress",
          confirmationState: "None",
          slots: {
            serviceName: null
          }
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.serviceName, "Manicure");
  assert.notEqual(fetchCalls[0].body.serviceName, "Pedicure");
  assert.equal(fetchCalls[0].body.attributes.lexTurnDebug.dtmfRouting.accepted, false);
});

test("DialogCodeHook production Full Set and Trang ASR confusions preserve collected slots", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Jane, just to confirm: Full Set tomorrow at 2 PM with Trang. Is that correct?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitIntent"
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
            staffId: "staff-trang",
            selectedStaffId: "staff-trang",
            confirmedStaffId: "staff-trang",
            confirmedStaffName: body.staffPreference
          }
        },
        missingFields: []
      })
    )
  );

  for (const inputTranscript of [
    "book full set tomorrow at two pm with frank",
    "book princess tomorrow at two pm with jen",
    "full set tomorrow at two p m with hang",
    "book full set tomorrow at two pm with trang"
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
            CustomerEndpointAddress: "+84798171999",
            AmazonConnectContactId: `connect-${inputTranscript.replace(/\W+/g, "-")}`,
            customerName: "Jane",
            customerPhone: "+84798171999"
          },
          intent: {
            ...baseEvent().sessionState.intent,
            name: "BookAppointmentIntent",
            state: "InProgress",
            confirmationState: "None",
            slots: {}
          }
        }
      })
    );

    const latestFetch = fetchCalls.at(-1);
    assert.equal(latestFetch.body.serviceName, "Full Set", inputTranscript);
    assert.equal(latestFetch.body.requestedDate, usEasternDate(1), inputTranscript);
    assert.equal(latestFetch.body.requestedTime, "2 PM", inputTranscript);
    assert.equal(latestFetch.body.staffPreference, "Trang", inputTranscript);
    assert.equal(latestFetch.body.customerName, "Jane", inputTranscript);
    assert.equal(latestFetch.body.customerPhone, "+84798171999", inputTranscript);
    if (inputTranscript.includes("princess")) {
      assert.equal(latestFetch.body.attributes.serviceAliasCorrectionRaw, "princess", inputTranscript);
    }
    assert.equal(response.sessionState.dialogAction.type, "ElicitIntent", inputTranscript);
    assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set", inputTranscript);
    assert.equal(response.sessionState.sessionAttributes.requestedDate, usEasternDate(1), inputTranscript);
    assert.equal(response.sessionState.sessionAttributes.requestedTime, "2 PM", inputTranscript);
    assert.equal(response.sessionState.sessionAttributes.staffPreference, "Trang", inputTranscript);
  }
  assert.equal(fetchCalls.length, 4);
});

test("DialogCodeHook exact dynamic Frank Jen Hang staff names win over Trang ASR confusion", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });

  for (const staffName of ["Frank", "Jen", "Hang"]) {
    const fetchCalls = installFetchMock((_url, _options, body) =>
      jsonResponse(
        successfulBackendPayload({
          outcome: "MISSING_INFO",
          appointment: null,
          lexResponse: {
            fulfillmentState: "InProgress",
            message: `Jane, just to confirm: Full Set tomorrow at 2 PM with ${body.staffPreference}. Is that correct?`,
            messageContentType: "PlainText",
            dialogAction: {
              type: "ElicitIntent"
            },
            sessionAttributes: {
              customerName: body.customerName,
              customerPhone: body.customerPhone,
              serviceName: body.serviceName,
              requestedDate: body.requestedDate,
              requestedTime: body.requestedTime,
              staffPreference: body.staffPreference,
              confirmedStaffName: body.staffPreference
            }
          }
        })
      )
    );

    const response = await handler(
      baseEvent({
        invocationSource: "DialogCodeHook",
        inputTranscript: `with ${staffName.toLowerCase()}`,
        sessionState: {
          ...baseEvent().sessionState,
          sessionAttributes: {
            salonId: "salon-explicit",
            CalledNumber: "+18483487681",
            CustomerEndpointAddress: "+84798171999",
            AmazonConnectContactId: `connect-dynamic-${staffName.toLowerCase()}`,
            customerName: "Jane",
            customerPhone: "+84798171999",
            serviceName: "Full Set",
            confirmedServiceName: "Full Set",
            requestedDate: usEasternDate(1),
            requestedTime: "2 PM",
            lastAskedSlot: "staffPreference",
            activeDtmfMenu: "staff",
            staffDtmfOptions: JSON.stringify({
              "1": staffName,
              "2": "Trang",
              "3": "Any staff"
            }),
            staffDtmfStaffIds: JSON.stringify({
              "1": `staff-${staffName.toLowerCase()}`,
              "2": "staff-trang"
            })
          },
          intent: {
            ...baseEvent().sessionState.intent,
            name: "BookAppointmentIntent",
            state: "InProgress",
            confirmationState: "None",
            slots: {}
          }
        }
      })
    );

    assert.equal(fetchCalls.length, 1, staffName);
    assert.equal(fetchCalls[0].body.staffPreference, staffName, staffName);
    assert.notEqual(fetchCalls[0].body.staffPreference, "Trang", staffName);
    assert.equal(response.sessionState.sessionAttributes.staffPreference, staffName, staffName);
  }
});

test("DialogCodeHook current food set does not overwrite stale placeholder service", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called before date is collected");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "food set",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-food-set-placeholder",
          customerName: "Jane",
          customerPhone: "+15555550123",
          serviceName: "test service",
          confirmedServiceName: "test service",
          lastAskedSlot: "serviceName"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          state: "InProgress",
          confirmationState: "None",
          slots: {
            serviceName: slotWith({
              originalValue: "food set",
              interpretedValue: "food set",
              resolvedValues: []
            })
          }
        }
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.serviceName, undefined);
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, undefined);
  assert.equal(response.sessionState.sessionAttributes.proposedServiceName, undefined);
  assert.equal(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.notEqual(response.sessionState.sessionAttributes.serviceName, "test service");
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
            type: "ElicitIntent"
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
    ["FallbackIntent", "I want to book a Full Set tomorrow at 3 PM with Trang."],
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
            CustomerEndpointAddress: "+15555550123",
            AmazonConnectContactId: `connect-full-set-fallback-${intentName || "empty"}`,
            customerName: "Jane",
            customerPhone: "+15555550123",
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
    assert.equal(response.sessionState.dialogAction.type, "ElicitIntent", inputTranscript);
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
            type: "ElicitIntent"
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
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-princess-asr",
          customerName: "Jane",
          customerPhone: "+15555550123",
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

test("DialogCodeHook no input asks unknown caller name before service menu", async () => {
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
  assert.equal(response.sessionState.dialogAction.slotToElicit, "customerName");
  assert.equal(response.sessionState.sessionAttributes.noInputPrompted, "true");
  assert.equal(response.sessionState.sessionAttributes.noInputCount, "1");
  assert.equal(response.sessionState.sessionAttributes.awaitingNoInputHumanConfirmation, "false");
  assert.equal(response.sessionState.sessionAttributes.customerPhone, "+17325956266");
  assert.match(response.messages[0].content, /say your first name slowly/i);
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
  assert.match(response.messages[0].content, /say the service name/i);
  assert.doesNotMatch(response.messages[0].content, /1 for Pedicure/i);
  assert.doesNotMatch(response.messages[0].content, /5 for Dip Powder/i);
  assert.doesNotMatch(response.messages[0].content, /You can also press 1 for Pedicure/i);
});

test("DialogCodeHook no input while staff is missing repeats trusted booking state", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for staff no-input DialogCodeHook");
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
          AmazonConnectContactId: "connect-staff-no-input",
          customerName: "Kiet",
          customerPhone: "+17325956266",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(0),
          requestedTime: "3 PM",
          lastAskedSlot: "staffPreference"
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
  assert.equal(response.sessionState.sessionAttributes.noInputCount, "1");
  assert.match(response.messages[0].content, /I'm still here\. I have Full Set today at 3 PM\. Which staff would you like, or say first available\?/i);
  assert.doesNotMatch(response.messages[0].content, /Press 1 for Trang/i);
  assert.notEqual(response.sessionState.sessionAttributes.conversationComplete, "true");
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

  assert.equal(response.messages[0].content, "Let me check for an available operator.");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "true");
  assert.equal(response.sessionState.sessionAttributes.awaitingNoInputHumanConfirmation, "false");
});

test("DialogCodeHook recovers pedicure aliases and cued PM time from transcript", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for DialogCodeHook recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript:
        "I need a better cure tomorrow at five PM with Trang. My name is Kiet Nguyen. My phone number is 7325956266.",
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
          activeDtmfMenu: "service",
          activeDtmfOptionsJson: JSON.stringify({ "1": "Pedicure", "0": "__operator__" }),
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

test("live-shaped FallbackIntent full set turn resumes BookAppointmentIntent and asks name first", async () => {
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
            "3": "Dip Powder",
            "4": "Full Set",
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
  assert.equal(response.sessionState.dialogAction.slotToElicit, "customerName");
  assert.equal(response.sessionState.sessionAttributes.lastAskedSlot, "customerName");
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
  assert.notEqual(response.sessionState.sessionAttributes.transferToQueue, "true");
});

test("DialogCodeHook known caller enrichment elicits next slot without asking name", async () => {
  const handler = await loadHandler();
  installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: '<speak>Welcome back, Lee. Got it. <break time="300ms"/> What time works best?</speak>',
          messageContentType: "SSML",
          dialogAction: {
            type: "ElicitSlot",
            slotToElicit: "requestedTime"
          },
          sessionAttributes: {
            customerName: "Lee",
            recognizedCustomerName: "Lee",
            knownCallerAcknowledged: "true",
            customerNameSource: "customer",
            customerPhone: "+84798171999",
            serviceName: "Pedicure",
            confirmedServiceName: "Pedicure",
            requestedDate: usEasternDate(1),
            forceHumanEscalation: "false",
            transferToQueue: "false"
          }
        },
        missingFields: ["preferredDateTime"]
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "I want pedicure tomorrow",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-known-caller-welcome"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {
            serviceName: slot("Pedicure"),
            requestedDate: slot("tomorrow")
          }
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "requestedTime");
  assert.equal(response.sessionState.sessionAttributes.customerName, "Lee");
  assert.equal(response.sessionState.sessionAttributes.customerNameSource, "phone_lookup");
  assert.equal(response.sessionState.sessionAttributes.knownCallerLookupStatus, "FOUND");
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "customerName");
});

test("Fulfillment preserves dynamic service DTMF options from backend", async () => {
  const handler = await loadHandler();
  installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message:
            "We don't currently have Gel Manicure listed. Press 1 for Full Set, press 2 for Builder Gel Fill Update, or 0 for a person.",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitSlot",
            slotToElicit: "serviceName"
          },
          sessionAttributes: {
            activeDtmfMenu: "service",
            activeDtmfOptionsJson: JSON.stringify({
              "1": "Full Set",
              "2": "Builder Gel Fill Update",
              "0": "__operator__"
            }),
            serviceDtmfOptions: JSON.stringify({
              "1": "Full Set",
              "2": "Builder Gel Fill Update"
            }),
            serviceDtmfServiceIds: JSON.stringify({
              "1": "service-full-set",
              "2": "service-builder-gel"
            }),
            serviceClarificationReason: "unsupported_service"
          }
        },
        missingFields: ["serviceName"]
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "FulfillmentCodeHook",
      inputTranscript: "I want gel",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-gel-service-menu",
          customerName: "Lee",
          recognizedCustomerName: "Lee",
          customerNameSource: "phone_lookup",
          customerPhone: "+84798171999"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          confirmationState: "Confirmed",
          slots: {
            serviceName: slot("gel")
          }
        }
      }
    })
  );

  const activeOptions = JSON.parse(response.sessionState.sessionAttributes.activeDtmfOptionsJson);
  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.equal(response.sessionState.sessionAttributes.activeDtmfMenu, "service");
  assert.equal(activeOptions["1"], "Full Set");
  assert.equal(activeOptions["2"], "Builder Gel Fill Update");
  assert.equal(activeOptions["0"], "__operator__");
  assert.equal(response.sessionState.sessionAttributes.staffPreference, undefined);
  assert.equal(response.sessionState.sessionAttributes.staffId, undefined);
});

test("DialogCodeHook forwards compact ASR alternatives for verified Pedicure ASR correction", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Please choose a service. Press 1 for Pedicure, 2 for Manicure, 3 for Gel Manicure, 4 for Full Set, 5 for Dip Powder, or 0 for an operator.",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitSlot",
            slotToElicit: "serviceName"
          },
          sessionAttributes: {
            activeDtmfMenu: "service",
            activeDtmfOptionsJson: JSON.stringify({
              "1": "Pedicure",
              "2": "Manicure",
              "3": "Gel Manicure",
              "4": "Full Set",
              "5": "Dip Powder",
              "0": "__operator__"
            }),
            serviceDtmfOptions: JSON.stringify({
              "1": "Pedicure",
              "2": "Manicure",
              "3": "Gel Manicure",
              "4": "Full Set",
              "5": "Dip Powder"
            }),
            serviceDtmfServiceIds: JSON.stringify({
              "1": "service-pedicure",
              "2": "service-manicure",
              "4": "service-full-set",
              "5": "service-dip-powder"
            }),
            serviceRecognitionFailureCount: "1"
          }
        },
        missingFields: ["serviceName"]
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "fifty kill",
      transcriptions: [
        { transcription: "fifty kill", transcriptionConfidence: 0.61 },
        { transcription: "pedicure", transcriptionConfidence: 0.57 }
      ],
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-fifty-kill-service",
          lastAskedSlot: "serviceName",
          customerName: "Kiet Nguyen",
          customerPhone: "7325956266",
          requestedDate: usEasternDate(1),
          requestedTime: "11 AM"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          confirmationState: "None",
          slots: {
            serviceName: slotWith({
              originalValue: "fifty kill",
              interpretedValue: "fifty kill",
              resolvedValues: ["fifty kill"]
            }),
            requestedDate: slot("tomorrow"),
            requestedTime: slot("11 AM")
          }
        }
      }
    })
  );

  const asrDiagnostics = JSON.parse(fetchCalls[0].body.attributes.asrDiagnostics);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.serviceName, "Pedicure");
  assert.equal(asrDiagnostics.topTranscript, "fifty kill");
  assert.equal(asrDiagnostics.nBestAlternatives[1].transcript, "pedicure");
  assert.equal(asrDiagnostics.nBestAlternatives[1].transcriptionConfidence, 0.57);
  assert.equal(asrDiagnostics.transcriptionConfidence, 0.61);
  assert.equal(asrDiagnostics.confidenceSource, "event.transcriptions.transcriptionConfidence");
  assert.equal(asrDiagnostics.alternativesSource, "event.transcriptions");
  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "staffPreference");
  assert.equal(response.sessionState.sessionAttributes.activeDtmfMenu, "staff");
  assert.equal(JSON.parse(response.sessionState.sessionAttributes.serviceDtmfOptions)["1"], "Pedicure");
});

test("DialogCodeHook does not synthesize ASR confidence from NLU confidence", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Which service would you like?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitSlot",
            slotToElicit: "serviceName"
          },
          sessionAttributes: {
            lastAskedSlot: "serviceName"
          }
        },
        missingFields: ["serviceName"]
      })
    )
  );

  await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "sunset is it food",
      interpretations: [
        {
          inputTranscript: "sunset is it food",
          nluConfidence: { score: 1 },
          intent: {
            name: "BookAppointmentIntent",
            nluConfidence: { score: 1 }
          }
        }
      ],
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-nlu-not-asr-confidence"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  const asrDiagnostics = JSON.parse(fetchCalls[0].body.attributes.asrDiagnostics);
  assert.equal(asrDiagnostics.topTranscript, "sunset is it food");
  assert.equal(asrDiagnostics.nluConfidence, 1);
  assert.equal(asrDiagnostics.transcriptionConfidence, undefined);
  assert.equal(asrDiagnostics.confidence, undefined);
  assert.equal(asrDiagnostics.confidenceSource, "none");
  assert.equal(asrDiagnostics.alternativesSource, "interpretations");
  assert.equal(asrDiagnostics.eventShape.transcriptionsCount, 0);
  assert.equal(asrDiagnostics.eventShape.interpretationsCount, 1);
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
  assert.match(response.messages[0].content, /I already have Full Set\. Which staff/i);
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

test("DialogCodeHook maps staff DTMF 4 to staff option instead of Full Set", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Lee, just to confirm: Full Set tomorrow at 3 PM with first available. Is that correct?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitIntent"
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
            staffPreference: body.staffPreference
          }
        },
        missingFields: []
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "4",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-staff-dtmf-4",
          lastAskedSlot: "staffPreference",
          activeDtmfMenu: "staff",
          ...dynamicStaffAttributes(),
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(1),
          requestedTime: "3 PM",
          customerName: "Lee",
          customerPhone: "+84798171999"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          name: "BookAppointmentIntent",
          state: "InProgress",
          confirmationState: "None",
          slots: {}
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.serviceName, "Full Set");
  assert.equal(fetchCalls[0].body.staffPreference, "Any staff");
  assert.equal(fetchCalls[0].body.attributes.lexTurnDebug.dtmfRouting.route, "staff_menu");
  assert.equal(fetchCalls[0].body.attributes.lexTurnDebug.dtmfRouting.accepted, true);
  assert.equal(fetchCalls[0].body.attributes.lexTurnDebug.dtmfRouting.selection, "Any staff");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.notEqual(response.sessionState.sessionAttributes.serviceName, "Any staff");
});

test("DialogCodeHook production service DTMF 1 selects Pedicure and preserves known fields", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for local Pedicure DTMF recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "1",
      inputMode: "DTMF",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-service-dtmf-1",
          lastAskedSlot: "serviceName",
          activeDtmfMenu: "service",
          activeDtmfOptionsJson: JSON.stringify({
            "0": "__operator__",
            "1": "Pedicure",
            "2": "Manicure",
            "3": "Gel Manicure",
            "4": "Full Set",
            "5": "Dip Powder"
          }),
          serviceDtmfOptions: JSON.stringify({
            "1": "Pedicure",
            "2": "Manicure",
            "3": "Gel Manicure",
            "4": "Full Set",
            "5": "Dip Powder"
          }),
          serviceDtmfServiceIds: JSON.stringify({
            "1": "service-pedicure",
            "2": "service-manicure",
            "4": "service-full-set",
            "5": "service-dip-powder"
          }),
          customerName: "Kiet Nguyen",
          customerPhone: "7325956266",
          requestedDate: usEasternDate(1),
          requestedTime: "11 AM",
          staffPreference: "Amy",
          staffId: "staff-amy",
          confirmedStaffName: "Amy"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.serviceName, "Pedicure");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Pedicure");
  assert.equal(response.sessionState.sessionAttributes.serviceId, "service-pedicure");
  assert.equal(response.sessionState.sessionAttributes.requestedDate, usEasternDate(1));
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "11 AM");
  assert.equal(response.sessionState.sessionAttributes.staffPreference, "Amy");
  assert.notEqual(response.sessionState.sessionAttributes.transferToQueue, "true");
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
  assert.equal(response.sessionState.dialogAction.slotToElicit, "customerName");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.requestedTime, undefined);
  assert.equal(response.sessionState.sessionAttributes.lastAskedSlot, "customerName");
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
  assert.equal(response.sessionState.dialogAction.slotToElicit, "customerName");
  assert.equal(response.sessionState.sessionAttributes.lastAskedSlot, "customerName");
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
  assert.equal(response.sessionState.dialogAction.slotToElicit, "customerName");
  assert.equal(response.sessionState.sessionAttributes.lastAskedSlot, "customerName");
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
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "customerName");
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "serviceName");
});

test("DialogCodeHook initial DTMF 4 does not map service without active service menu", async () => {
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

  assert.notEqual(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.notEqual(response.sessionState.sessionAttributes.confirmedServiceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "4 PM");
  assert.ok(["customerName", "serviceName"].includes(response.sessionState.dialogAction.slotToElicit));
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
          activeDtmfOptionsJson: JSON.stringify({
            "1": "Pedicure",
            "2": "Manicure",
            "3": "Gel Manicure",
            "4": "Full Set",
            "5": "Dip Powder"
          })
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

test("DialogCodeHook phone set alone does not resolve to Full Set", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for unsafe phone set service recovery");
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
          AmazonConnectContactId: "connect-phone-set-alone",
          customerName: "Jane",
          customerPhone: "+17325956266"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.serviceName, undefined);
  assert.equal(response.sessionState.sessionAttributes.proposedServiceName, undefined);
  assert.equal(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.notEqual(response.sessionState.sessionAttributes.transferToQueue, "true");
});

test("DialogCodeHook proposes Full Set for full jet only while service slot is active", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called before full jet service clarification");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "full jet",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-full-jet-service-slot",
          customerName: "Jane",
          customerPhone: "+17325956266",
          lastAskedSlot: "serviceName"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          state: "InProgress",
          confirmationState: "None",
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.serviceName, undefined);
  assert.equal(response.sessionState.sessionAttributes.proposedServiceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.awaitingServiceConfirmation, "true");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.match(response.messages?.[0]?.content || "", /Did you say Full Set/i);
});

test("DialogCodeHook proposes Full Set for contextual phone set without committing service", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called before phone set service clarification");
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

  assert.equal(response.sessionState.sessionAttributes.serviceName, undefined);
  assert.equal(response.sessionState.sessionAttributes.proposedServiceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.awaitingServiceConfirmation, "true");
  assert.equal(response.sessionState.sessionAttributes.requestedDate, usEasternDate(1));
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "3 PM");
  assert.equal(response.sessionState.sessionAttributes.staffPreference, "Trang");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.match(response.messages?.[0]?.content || "", /Did you say Full Set/i);
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
    "I have your Full Set tomorrow at 3 PM. May I have your name, please?"
  );
});

test("DialogCodeHook customerName noise does not persist with Kevin", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for customer name noise");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "with Kevin",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-customer-name-with-kevin",
          lastAskedSlot: "customerName",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(1),
          requestedTime: "3 PM",
          staffPreference: "Trang",
          customerPhone: "7325956266"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {
            customerName: slot("with Kevin")
          }
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "customerName");
  assert.equal(response.sessionState.sessionAttributes.customerName, undefined);
  assert.equal(response.sessionState.sessionAttributes.staffPreference, "Trang");
  assert.deepEqual(JSON.parse(response.sessionState.sessionAttributes.ignoredNoiseFields), [
    "customerName"
  ]);
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
  assert.match(response.messages[0].content, /I have your Full Set tomorrow at 2 PM with Trang/i);
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
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "7a82c651-5091-4f32-84f0-bf37d004317c",
          lastAskedSlot: "customerName",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: tomorrow,
          requestedTime: "3 PM",
          staffPreference: "Any staff",
          confirmedStaffName: "Any staff",
          customerPhone: "+15555550123"
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
  assert.equal(fetchCalls[0].body.customerPhone, "+15555550123");
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
  assert.equal(response.sessionState.dialogAction.type, "ElicitIntent");
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.equal(response.sessionState.sessionAttributes.customerName, "Jane");
  assert.equal(response.sessionState.sessionAttributes.customerPhone, "+15555550123");
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

  for (const name of ["Amy", "Kelly", "Trang", "Jane", "Jen"]) {
    const response = await handler(
      baseEvent({
        invocationSource: "DialogCodeHook",
        inputTranscript: name,
        sessionState: {
          ...baseEvent().sessionState,
          sessionAttributes: {
            salonId: "salon-explicit",
            CalledNumber: "+18483487681",
            CustomerEndpointAddress: "+15555550123",
            AmazonConnectContactId: `connect-customer-name-${name.toLowerCase()}`,
            lastAskedSlot: "customerName",
            serviceName: "Full Set",
            confirmedServiceName: "Full Set",
            requestedDate: usEasternDate(1),
            requestedTime: "3 PM",
            staffPreference: "Trang",
            confirmedStaffName: "Trang",
            customerPhone: "+15555550123",
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

test("DialogCodeHook time correction does not trigger Trang ASR confusion", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Which staff would you like?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitSlot",
            slotToElicit: "staffPreference"
          },
          sessionAttributes: {
            customerName: body.customerName,
            customerPhone: body.customerPhone,
            serviceName: body.serviceName,
            requestedDate: body.requestedDate,
            requestedTime: body.requestedTime
          }
        }
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "change it to two PM",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-time-change-not-staff",
          customerName: "Jane",
          customerPhone: "+15555550123",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(1),
          requestedTime: "3 PM",
          lastAskedSlot: "requestedTime"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          state: "InProgress",
          confirmationState: "None",
          slots: {
            serviceName: slot("Full Set"),
            requestedDate: slot("tomorrow"),
            requestedTime: slot("two PM")
          }
        }
      }
    })
  );

  assert.notEqual(response.sessionState.sessionAttributes.staffPreference, "Trang");
  assert.notEqual(response.sessionState.intent.slots.staffPreference?.value?.interpretedValue, "Trang");
  if (fetchCalls.length) {
    assert.notEqual(fetchCalls[0].body.staffPreference, "Trang");
    assert.equal(fetchCalls[0].body.requestedTime, "2 PM");
  } else {
    assert.equal(response.sessionState.sessionAttributes.requestedTime, "2 PM");
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
            type: "ElicitIntent"
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
            CustomerEndpointAddress: "+15555550123",
            AmazonConnectContactId: `connect-spelled-${expectedName.toLowerCase()}`,
            lastAskedSlot: "customerName",
            serviceName: "Full Set",
            confirmedServiceName: "Full Set",
            requestedDate: usEasternDate(1),
            requestedTime: "3 PM",
            staffPreference: "Any staff",
            customerPhone: "+15555550123"
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

    assert.equal(response.sessionState.dialogAction.type, "ElicitIntent");
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
            "I couldn't clearly hear the name, so I'll use Guest ending in 0123 for now. Just to confirm, Full Set tomorrow at 3 PM with the first available technician. Is that correct?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitIntent"
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
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-customer-name-no-input-fallback",
          lastAskedSlot: "customerName",
          noInputCount: "1",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(1),
          requestedTime: "3 PM",
          staffPreference: "Any staff",
          customerPhone: "+15555550123"
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
  assert.equal(fetchCalls[0].body.customerName, "Guest 0123");
  assert.equal(fetchCalls[0].body.customerPhone, "+15555550123");
  assert.equal(fetchCalls[0].body.attributes.customerNameSource, "phone_fallback");
  assert.equal(fetchCalls[0].body.attributes.customerNameNeedsReview, "true");
  assert.equal(fetchCalls[0].body.currentTurnTranscript, "no input");
  assert.equal(response.sessionState.dialogAction.type, "ElicitIntent");
  assert.equal(response.sessionState.sessionAttributes.customerName, "Guest 0123");
  assert.equal(response.sessionState.sessionAttributes.customerNameSource, "phone_fallback");
  assert.equal(response.sessionState.sessionAttributes.customerNameNeedsReview, "true");
  assert.match(response.messages[0].content, /Guest ending in 0123/i);
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
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-final-confirmation-84",
          customerName: "Jane",
          customerPhone: "+15555550123",
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
            customerPhone: slot("+15555550123")
          }
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.confirmationState, "Confirmed");
  assert.equal(fetchCalls[0].body.customerName, "Jane");
  assert.equal(fetchCalls[0].body.customerPhone, "+15555550123");
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
    "yes",
    "yeah",
    "yep",
    "yes this is correct",
    "yeah correct",
    "correct yes yes correct yes",
    "that's right",
    "that is correct",
    "right",
    "sure",
    "okay",
    "confirm",
    "confirmed",
    "go ahead",
    "please book it",
    "book it",
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
            CustomerEndpointAddress: "+15555550123",
            AmazonConnectContactId: `fef46abd-f101-475a-97d0-${phrase.replace(/\W+/g, "").slice(0, 12)}`,
            customerName: "Jane",
            customerPhone: "+15555550123",
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
              customerPhone: slot("+15555550123")
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

test("DialogCodeHook final confirmation-only phrases preserve trusted staff", async () => {
  const handler = await loadHandler();

  for (const phrase of [
    "yes",
    "go ahead",
    "please go ahead",
    "book it",
    "please book it",
    "confirm it",
    "sounds good",
    "that's right",
    "proceed"
  ]) {
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
              staffId: body.staffId,
              selectedStaffId: body.attributes.selectedStaffId,
              confirmedStaffId: body.attributes.confirmedStaffId,
              confirmedStaffName: body.attributes.confirmedStaffName,
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
        sessionId: `connect-affirm-alex-${phrase.replace(/\W+/g, "-")}`,
        sessionState: {
          ...baseEvent().sessionState,
          sessionAttributes: {
            salonId: "salon-explicit",
            CalledNumber: "+18483487681",
            CustomerEndpointAddress: "+15555550123",
            AmazonConnectContactId: `connect-affirm-alex-${phrase.replace(/\W+/g, "-")}`,
            customerName: "Lee",
            customerPhone: "+15555550123",
            serviceName: "Full Set",
            confirmedServiceName: "Full Set",
            requestedDate: usEasternDate(1),
            requestedTime: "2 PM",
            staffPreference: "Alex",
            staffId: "staff-alex",
            selectedStaffId: "staff-alex",
            confirmedStaffName: "Alex",
            confirmedStaffId: "staff-alex",
            awaitingFinalBookingConfirmation: "true",
            bookingConfirmationAsked: "true",
            lastAskedSlot: "bookingConfirmation",
            confirmationFingerprint: "trusted-alex-fingerprint"
          },
          intent: {
            ...baseEvent().sessionState.intent,
            confirmationState: "None",
            slots: {
              serviceName: slot("Full Set"),
              requestedDate: slot("tomorrow"),
              requestedTime: slot("2 PM"),
              staffPreference: slot("Alex"),
              customerName: slot("Lee"),
              customerPhone: slot("+15555550123")
            }
          }
        }
      })
    );

    assert.equal(fetchCalls.length, 1, phrase);
    assert.equal(fetchCalls[0].body.confirmationState, "Confirmed", phrase);
    assert.equal(fetchCalls[0].body.currentTurnTranscript, phrase, phrase);
    assert.equal(fetchCalls[0].body.serviceName, "Full Set", phrase);
    assert.equal(fetchCalls[0].body.requestedTime, "2 PM", phrase);
    assert.equal(fetchCalls[0].body.staffPreference, "Alex", phrase);
    assert.equal(fetchCalls[0].body.staffId, "staff-alex", phrase);
    assert.equal(fetchCalls[0].body.attributes.selectedStaffId, "staff-alex", phrase);
    assert.equal(fetchCalls[0].body.attributes.confirmedStaffId, "staff-alex", phrase);
    assert.equal(fetchCalls[0].body.attributes.confirmedStaffName, "Alex", phrase);
    assert.notEqual(fetchCalls[0].body.staffPreference, phrase, phrase);
    assert.notEqual(fetchCalls[0].body.requestedStaff, phrase, phrase);
    assert.notEqual(fetchCalls[0].body.attributes.discardedStaleStaff, "Alex", phrase);
    assert.equal(response.sessionState.dialogAction.type, "Close", phrase);
    assert.doesNotMatch(response.messages[0].content, /technician|didn't find/i, phrase);
  }
});

test("DialogCodeHook final confirmation value-only changes route as draft updates", async () => {
  const handler = await loadHandler();

  for (const phrase of ["Monday at two PM", "with Kelly"]) {
    const fetchCalls = installFetchMock((_url, _options, body) =>
      jsonResponse(
        successfulBackendPayload({
          outcome: "MISSING_INFO",
          appointment: null,
          lexResponse: {
            fulfillmentState: "InProgress",
            message: "Sure. Just to confirm the updated appointment.",
            messageContentType: "PlainText",
            dialogAction: {
              type: "ElicitIntent"
            },
            sessionAttributes: {
              customerName: body.customerName,
              customerPhone: body.customerPhone,
              serviceName: body.serviceName,
              requestedDate: body.requestedDate,
              requestedTime: body.requestedTime,
              staffPreference: body.staffPreference,
              awaitingFinalBookingConfirmation: "true",
              bookingConfirmationAsked: "true",
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
            CustomerEndpointAddress: "+15555550123",
            AmazonConnectContactId: `connect-final-change-${phrase.replace(/\W+/g, "-")}`,
            customerName: "Jane",
            customerPhone: "+15555550123",
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
              customerPhone: slot("+15555550123")
            }
          }
        }
      })
    );

    assert.equal(fetchCalls.length, 1, phrase);
    assert.equal(fetchCalls[0].body.confirmationState, "None", phrase);
    assert.equal(fetchCalls[0].body.attributes.finalConfirmationChangeRequest, "true", phrase);
    assert.equal(fetchCalls[0].body.currentTurnTranscript, phrase, phrase);
    assert.equal(response.sessionState.dialogAction.type, "ElicitIntent", phrase);
  }
});

test("DialogCodeHook canonicalizes with emmy to Amy while staffPreference is being asked", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Sure. Pedicure tomorrow at 11 AM with Amy. Is that correct?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitIntent"
          },
          sessionAttributes: {
            serviceName: body.serviceName,
            requestedDate: body.requestedDate,
            requestedTime: body.requestedTime,
            staffPreference: "Amy",
            staffId: "staff-amy",
            selectedStaffId: "staff-amy",
            confirmedStaffId: "staff-amy",
            confirmedStaffName: "Amy",
            awaitingFinalBookingConfirmation: "true",
            bookingConfirmationAsked: "true",
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
      inputTranscript: "with emmy",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-with-emmy",
          customerName: "Jane",
          customerPhone: "+15555550123",
          serviceName: "Pedicure",
          confirmedServiceName: "Pedicure",
          requestedDate: usEasternDate(1),
          requestedTime: "11 AM",
          lastAskedSlot: "staffPreference",
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
          })
        },
        intent: {
          ...baseEvent().sessionState.intent,
          confirmationState: "None",
          slots: {
            serviceName: slot("Pedicure"),
            requestedDate: slot("tomorrow"),
            requestedTime: slot("11 AM"),
            staffPreference: slotWith({
              originalValue: "with emmy",
              interpretedValue: "withemmy",
              resolvedValues: ["withemmy"]
            }),
            customerName: slot("Jane"),
            customerPhone: slot("+15555550123")
          }
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 0);
  assert.equal(response.sessionState.intent.slots.staffPreference.value.interpretedValue, "Amy");
  assert.equal(response.sessionState.sessionAttributes.staffPreference, "Amy");
  assert.equal(response.sessionState.sessionAttributes.confirmedStaffName, "Amy");
  assert.equal(response.sessionState.sessionAttributes.staffSource, "current_turn_alias");
  assert.equal(response.sessionState.sessionAttributes.discardedStaleStaff, "with emmy");
});

test("DialogCodeHook maps scoped dang to Trang only in staff context", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for local staff alias recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "dang",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-dang-trang",
          customerName: "Jane",
          customerPhone: "+15555550123",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(1),
          requestedTime: "1 PM",
          lastAskedSlot: "staffPreference",
          activeDtmfMenu: "staff",
          ...dynamicStaffAttributes()
        },
        intent: {
          ...baseEvent().sessionState.intent,
          confirmationState: "None",
          slots: {
            serviceName: slot("Full Set"),
            requestedDate: slot("tomorrow"),
            requestedTime: slot("1 PM"),
            staffPreference: slot("dang"),
            customerName: slot("Jane"),
            customerPhone: slot("+15555550123")
          }
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "Delegate");
  assert.equal(response.sessionState.intent.slots.staffPreference.value.interpretedValue, "Trang");
  assert.equal(response.sessionState.sessionAttributes.staffPreference, "Trang");
  assert.equal(response.sessionState.sessionAttributes.confirmedStaffName, "Trang");
  assert.equal(response.sessionState.sessionAttributes.staffId, undefined);
  assert.notEqual(response.sessionState.sessionAttributes.staffPreference, "dang");

  const outsideStaffContext = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "dang",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-dang-not-scoped"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          confirmationState: "None",
          slots: {}
        }
      }
    })
  );

  assert.notEqual(outsideStaffContext.sessionState.sessionAttributes.staffPreference, "Trang");
});

test("DialogCodeHook final confirmation correction no i want emmy not chang replaces stale Trang", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Sure. Pedicure tomorrow at 11 AM with Amy. Is that correct?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitIntent"
          },
          sessionAttributes: {
            serviceName: body.serviceName,
            requestedDate: body.requestedDate,
            requestedTime: body.requestedTime,
            staffPreference: "Amy",
            staffId: "staff-amy",
            selectedStaffId: "staff-amy",
            confirmedStaffId: "staff-amy",
            confirmedStaffName: "Amy",
            confirmationFingerprint: "new-amy-fingerprint",
            awaitingFinalBookingConfirmation: "true",
            bookingConfirmationAsked: "true",
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
      inputTranscript: "no i want emmy not chang",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-emmy-not-chang",
          customerName: "Jane",
          customerPhone: "+15555550123",
          serviceName: "Pedicure",
          confirmedServiceName: "Pedicure",
          requestedDate: usEasternDate(1),
          requestedTime: "11 AM",
          staffPreference: "Trang",
          staffId: "staff-trang",
          selectedStaffId: "staff-trang",
          confirmedStaffName: "Trang",
          confirmedStaffId: "staff-trang",
          confirmationFingerprint: "old-trang-fingerprint",
          awaitingFinalBookingConfirmation: "true",
          bookingConfirmationAsked: "true",
          lastAskedSlot: "bookingConfirmation"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          confirmationState: "None",
          slots: {
            serviceName: slot("Pedicure"),
            requestedDate: slot("tomorrow"),
            requestedTime: slot("11 AM"),
            staffPreference: slot("Trang"),
            customerName: slot("Jane"),
            customerPhone: slot("+15555550123")
          }
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.confirmationState, "None");
  assert.equal(fetchCalls[0].body.attributes.finalConfirmationChangeRequest, "true");
  assert.equal(fetchCalls[0].body.staffPreference, "Amy");
  assert.equal(fetchCalls[0].body.staffId, undefined);
  assert.equal(fetchCalls[0].body.attributes.staffPreference, "Amy");
  assert.equal(fetchCalls[0].body.attributes.confirmedStaffName, "Amy");
  assert.equal(fetchCalls[0].body.attributes.staffId, undefined);
  assert.equal(fetchCalls[0].body.attributes.selectedStaffId, undefined);
  assert.equal(fetchCalls[0].body.attributes.confirmedStaffId, undefined);
  assert.equal(fetchCalls[0].body.attributes.discardedStaleStaff, "Trang");
  assert.equal(
    fetchCalls[0].body.attributes.lexTurnDebug.sanitization.currentTurnStaffMention,
    "Amy"
  );
  assert.equal(response.sessionState.dialogAction.type, "ElicitIntent");
  assert.equal(response.sessionState.sessionAttributes.staffPreference, "Amy");
  assert.equal(response.sessionState.sessionAttributes.staffId, "staff-amy");
  assert.equal(response.sessionState.sessionAttributes.confirmationFingerprint, "new-amy-fingerprint");
  assert.doesNotMatch(response.messages[0].content, /Trang/i);
});

test("DialogCodeHook unknown explicit staff clears stale Trang instead of sending Any staff", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "I didn't find that technician. Which staff would you like, Trang, Amy, Kelly, or first available?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitSlot",
            slotToElicit: "staffPreference"
          },
          sessionAttributes: {
            serviceName: body.serviceName,
            requestedDate: body.requestedDate,
            requestedTime: body.requestedTime,
            awaitingFinalBookingConfirmation: "false",
            bookingConfirmationAsked: "false",
            forceHumanEscalation: "false",
            transferToQueue: "false",
            lastAskedSlot: "staffPreference"
          }
        }
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "with Emily",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-with-emily",
          customerName: "Jane",
          customerPhone: "+15555550123",
          serviceName: "Pedicure",
          confirmedServiceName: "Pedicure",
          requestedDate: usEasternDate(1),
          requestedTime: "11 AM",
          staffPreference: "Trang",
          staffId: "staff-trang",
          selectedStaffId: "staff-trang",
          confirmedStaffName: "Trang",
          confirmedStaffId: "staff-trang",
          lastAskedSlot: "staffPreference"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          confirmationState: "None",
          slots: {
            serviceName: slot("Pedicure"),
            requestedDate: slot("tomorrow"),
            requestedTime: slot("11 AM"),
            staffPreference: slot("Trang"),
            customerName: slot("Jane"),
            customerPhone: slot("+15555550123")
          }
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.staffPreference, undefined);
  assert.equal(fetchCalls[0].body.staffId, undefined);
  assert.equal(fetchCalls[0].body.attributes.staffPreference, undefined);
  assert.equal(fetchCalls[0].body.attributes.confirmedStaffName, undefined);
  assert.equal(fetchCalls[0].body.attributes.staffId, undefined);
  assert.equal(fetchCalls[0].body.attributes.selectedStaffId, undefined);
  assert.equal(fetchCalls[0].body.attributes.confirmedStaffId, undefined);
  assert.equal(fetchCalls[0].body.attributes.discardedStaleStaff, "Trang");
  assert.equal(
    fetchCalls[0].body.attributes.lexTurnDebug.sanitization.currentTurnHasExplicitStaffPhrase,
    true
  );
  assert.notEqual(fetchCalls[0].body.staffPreference, "Any staff");
  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "staffPreference");
});

test("DialogCodeHook maps p t q to Pedicure in booking context and not staff", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called before required slots are complete");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "hi i want to book a p t q tomorrow",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-ptq-service"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          confirmationState: "None",
          slots: {
            requestedDate: slot("tomorrow"),
            staffPreference: slot("ptq")
          }
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "customerName");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Pedicure");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Pedicure");
  assert.equal(response.sessionState.sessionAttributes.requestedDate, usEasternDate(1));
  assert.equal(response.sessionState.sessionAttributes.staffPreference, undefined);
  assert.equal(response.sessionState.intent.slots.serviceName.value.interpretedValue, "Pedicure");
  assert.equal(response.sessionState.intent.slots.staffPreference, undefined);
});

test("DialogCodeHook unsupported service words do not become staff", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called before required slots are complete");
  };

  for (const phrase of ["I want haircut", "I want gel", "I want gel nails", "I want a facial"]) {
    const response = await handler(
      baseEvent({
        invocationSource: "DialogCodeHook",
        inputTranscript: phrase,
        sessionState: {
          ...baseEvent().sessionState,
          sessionAttributes: {
            salonId: "salon-explicit",
            CalledNumber: "+18483487681",
            CustomerEndpointAddress: "+84798171999",
            AmazonConnectContactId: `connect-unsupported-${phrase.replace(/\W+/g, "-")}`
          },
          intent: {
            ...baseEvent().sessionState.intent,
            confirmationState: "None",
            slots: {}
          }
        }
      })
    );

    assert.equal(response.sessionState.dialogAction.type, "ElicitSlot", phrase);
    assert.notEqual(response.sessionState.sessionAttributes.staffPreference, "haircut", phrase);
    assert.notEqual(response.sessionState.sessionAttributes.staffPreference, "gel", phrase);
    assert.equal(response.sessionState.sessionAttributes.staffId, undefined, phrase);
    assert.equal(response.sessionState.sessionAttributes.selectedStaffId, undefined, phrase);
    assert.equal(response.sessionState.sessionAttributes.confirmedStaffId, undefined, phrase);
  }
});

test("DialogCodeHook customer name turn preserves accepted Pedicure service", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called before time and staff are complete");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "Thuyet",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-ptq-name-preserve",
          serviceName: "Pedicure",
          confirmedServiceName: "Pedicure",
          requestedDate: usEasternDate(1),
          lastAskedSlot: "customerName"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          confirmationState: "None",
          slots: {
            serviceName: slot("Pedicure"),
            requestedDate: slot("tomorrow"),
            customerName: slot("Thuyet")
          }
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "serviceName");
  assert.equal(response.sessionState.sessionAttributes.customerName, "Thuyet");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Pedicure");
  assert.equal(response.sessionState.sessionAttributes.confirmedServiceName, "Pedicure");
});

test("DialogCodeHook time-only final correction preserves Alex staff identity", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Lee, just to confirm: Full Set tomorrow at 4 PM with Alex. Is that correct?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitIntent"
          },
          sessionAttributes: {
            ...body.attributes,
            requestedTime: body.requestedTime,
            staffPreference: "Alex",
            staffId: "staff-alex",
            selectedStaffId: "staff-alex",
            confirmedStaffId: "staff-alex",
            confirmedStaffName: "Alex",
            confirmationFingerprint: "new-alex-four-pm",
            awaitingFinalBookingConfirmation: "true",
            bookingConfirmationAsked: "true",
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
      inputTranscript: "no uh change it into four p m",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-alex-time-only",
          customerName: "Lee",
          customerPhone: "+15555550123",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(1),
          requestedTime: "2 PM",
          staffPreference: "Alex",
          staffId: "staff-alex",
          selectedStaffId: "staff-alex",
          confirmedStaffName: "Alex",
          confirmedStaffId: "staff-alex",
          confirmationFingerprint: "old-alex-two-pm",
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
            requestedTime: slot("2 PM"),
            staffPreference: slot("Alex"),
            customerName: slot("Lee"),
            customerPhone: slot("+15555550123")
          }
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.requestedTime, "4 PM");
  assert.equal(fetchCalls[0].body.staffPreference, "Alex");
  assert.equal(fetchCalls[0].body.staffId, "staff-alex");
  assert.equal(fetchCalls[0].body.attributes.staffPreference, "Alex");
  assert.equal(fetchCalls[0].body.attributes.staffId, "staff-alex");
  assert.equal(fetchCalls[0].body.attributes.selectedStaffId, "staff-alex");
  assert.equal(fetchCalls[0].body.attributes.confirmedStaffId, "staff-alex");
  assert.equal(fetchCalls[0].body.attributes.confirmedStaffName, "Alex");
  assert.notEqual(fetchCalls[0].body.attributes.staffPreference, "Trang");
  assert.equal(response.sessionState.dialogAction.type, "ElicitIntent");
  assert.equal(response.sessionState.sessionAttributes.staffId, "staff-alex");
});

test("DialogCodeHook Alex time correction then go ahead books with trusted Alex", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      body.confirmationState === "Confirmed"
        ? successfulBackendPayload({
            outcome: "BOOKED",
            appointment: {
              id: "appointment-alex-go-ahead"
            },
            lexResponse: {
              fulfillmentState: "Fulfilled",
              message: "Booked Full Set with Alex.",
              messageContentType: "PlainText",
              dialogAction: {
                type: "Close"
              },
              sessionAttributes: {
                ...body.attributes,
                bookingOutcome: "BOOKED",
                staffPreference: body.staffPreference,
                staffId: body.staffId,
                selectedStaffId: body.attributes.selectedStaffId,
                confirmedStaffId: body.attributes.confirmedStaffId,
                confirmedStaffName: body.attributes.confirmedStaffName,
                conversationState: "COMPLETE",
                conversationOutcome: "BOOKED",
                conversationComplete: "true",
                awaitingFinalBookingConfirmation: "false",
                bookingConfirmationAsked: "false"
              }
            }
          })
        : successfulBackendPayload({
            outcome: "MISSING_INFO",
            appointment: null,
            lexResponse: {
              fulfillmentState: "InProgress",
              message: "Lee, just to confirm: Full Set tomorrow at 2 PM with Alex. Is that correct?",
              messageContentType: "PlainText",
              dialogAction: {
                type: "ElicitIntent"
              },
              sessionAttributes: {
                ...body.attributes,
                requestedTime: body.requestedTime,
                staffPreference: "Alex",
                staffId: "staff-alex",
                selectedStaffId: "staff-alex",
                confirmedStaffId: "staff-alex",
                confirmedStaffName: "Alex",
                confirmationFingerprint: "new-alex-two-pm",
                awaitingFinalBookingConfirmation: "true",
                bookingConfirmationAsked: "true",
                forceHumanEscalation: "false",
                transferToQueue: "false"
              }
            }
          })
    )
  );

  const correction = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "no change it into two pm",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-production-alex-go-ahead",
          customerName: "Lee",
          customerPhone: "+15555550123",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(1),
          requestedTime: "11 AM",
          staffPreference: "Alex",
          staffId: "staff-alex",
          selectedStaffId: "staff-alex",
          confirmedStaffName: "Alex",
          confirmedStaffId: "staff-alex",
          confirmationFingerprint: "old-alex-eleven-am",
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
            requestedTime: slot("11 AM"),
            staffPreference: slot("Alex"),
            customerName: slot("Lee"),
            customerPhone: slot("+15555550123")
          }
        }
      }
    })
  );

  const correctedAttrs = correction.sessionState.sessionAttributes;
  assert.equal(fetchCalls[0].body.requestedTime, "2 PM");
  assert.equal(fetchCalls[0].body.staffPreference, "Alex");
  assert.equal(fetchCalls[0].body.staffId, "staff-alex");
  assert.equal(correctedAttrs.staffId, "staff-alex");
  assert.equal(correction.sessionState.dialogAction.type, "ElicitIntent");

  const booked = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "go ahead",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          ...correctedAttrs,
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-production-alex-go-ahead",
          customerName: "Lee",
          customerPhone: "+15555550123",
          lastAskedSlot: "bookingConfirmation"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          confirmationState: "None",
          slots: {
            serviceName: slot("Full Set"),
            requestedDate: slot("tomorrow"),
            requestedTime: slot("2 PM"),
            staffPreference: slot("Alex"),
            customerName: slot("Lee"),
            customerPhone: slot("+15555550123")
          }
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 2);
  assert.equal(fetchCalls[1].body.confirmationState, "Confirmed");
  assert.equal(fetchCalls[1].body.currentTurnTranscript, "go ahead");
  assert.equal(fetchCalls[1].body.staffPreference, "Alex");
  assert.equal(fetchCalls[1].body.staffId, "staff-alex");
  assert.equal(fetchCalls[1].body.attributes.selectedStaffId, "staff-alex");
  assert.equal(fetchCalls[1].body.attributes.confirmedStaffId, "staff-alex");
  assert.equal(fetchCalls[1].body.attributes.confirmedStaffName, "Alex");
  assert.notEqual(fetchCalls[1].body.staffPreference, "go ahead");
  assert.notEqual(fetchCalls[1].body.attributes.discardedStaleStaff, "Alex");
  assert.equal(booked.sessionState.dialogAction.type, "Close");
  assert.doesNotMatch(booked.messages[0].content, /technician|didn't find/i);
});

test("DialogCodeHook spoken minute correction preserves Alex staff identity", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Lee, just to confirm: Full Set tomorrow at 3:50 PM with Alex. Is that correct?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitIntent"
          },
          sessionAttributes: {
            ...body.attributes,
            requestedTime: body.requestedTime,
            staffPreference: "Alex",
            staffId: "staff-alex",
            selectedStaffId: "staff-alex",
            confirmedStaffId: "staff-alex",
            confirmedStaffName: "Alex",
            awaitingFinalBookingConfirmation: "true",
            bookingConfirmationAsked: "true",
            forceHumanEscalation: "false",
            transferToQueue: "false"
          }
        }
      })
    )
  );

  await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "change it to three fifty PM",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-alex-minutes",
          customerName: "Lee",
          customerPhone: "+15555550123",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(1),
          requestedTime: "2 PM",
          staffPreference: "Alex",
          staffId: "staff-alex",
          selectedStaffId: "staff-alex",
          confirmedStaffName: "Alex",
          confirmedStaffId: "staff-alex",
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
            requestedTime: slot("2 PM"),
            staffPreference: slot("Alex"),
            customerName: slot("Lee"),
            customerPhone: slot("+15555550123")
          }
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.requestedTime, "3:50 PM");
  assert.equal(fetchCalls[0].body.staffPreference, "Alex");
  assert.equal(fetchCalls[0].body.staffId, "staff-alex");
  assert.equal(fetchCalls[0].body.attributes.staffId, "staff-alex");
});

test("DialogCodeHook for available maps to Any staff while asking staff", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock(() => {
    throw new Error("fetch should not be called while canonicalizing staff slot");
  });

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "for available",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-for-available",
          customerName: "Lee",
          customerPhone: "+15555550123",
          serviceName: "Manicure",
          confirmedServiceName: "Manicure",
          requestedDate: usEasternDate(0),
          requestedTime: "5 PM",
          lastAskedSlot: "staffPreference"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          confirmationState: "None",
          slots: {
            serviceName: slot("Manicure"),
            requestedDate: slot("today"),
            requestedTime: slot("5 PM"),
            staffPreference: slot("for available"),
            customerName: slot("Lee"),
            customerPhone: slot("+15555550123")
          }
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 0);
  assert.equal(response.sessionState.intent.slots.staffPreference.value.interpretedValue, "Any staff");
  assert.equal(response.sessionState.sessionAttributes.staffPreference, "Any staff");
  assert.equal(response.sessionState.sessionAttributes.staffSource, "current_turn_any_staff");
});

test("DialogCodeHook today and Tuesday resolve while requestedDate is active", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called before date turn completes");
  };

  for (const phrase of ["today", "Tuesday"]) {
    const response = await handler(
      baseEvent({
        invocationSource: "DialogCodeHook",
        inputTranscript: phrase,
        sessionState: {
          ...baseEvent().sessionState,
          sessionAttributes: {
            salonId: "salon-explicit",
            CalledNumber: "+18483487681",
            CustomerEndpointAddress: "+15555550123",
            AmazonConnectContactId: `connect-date-${phrase}`,
            customerName: "Lee",
            customerPhone: "+15555550123",
            serviceName: "Full Set",
            confirmedServiceName: "Full Set",
            lastAskedSlot: "requestedDate"
          },
          intent: {
            ...baseEvent().sessionState.intent,
            confirmationState: "None",
            slots: {
              serviceName: slot("Full Set"),
              requestedDate: slot(phrase),
              customerName: slot("Lee"),
              customerPhone: slot("+15555550123")
            }
          }
        }
      })
    );

    assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set", phrase);
    assert.match(response.sessionState.sessionAttributes.requestedDate, /^\d{4}-\d{2}-\d{2}$/, phrase);
  }
});

test("DialogCodeHook bare p m does not clear trusted draft fields", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for incomplete time fragment");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "p m",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-bare-pm",
          customerName: "Lee",
          customerPhone: "+15555550123",
          serviceName: "Manicure",
          confirmedServiceName: "Manicure",
          requestedDate: usEasternDate(0),
          staffPreference: "Kevin",
          staffId: "staff-kevin",
          selectedStaffId: "staff-kevin",
          confirmedStaffName: "Kevin",
          confirmedStaffId: "staff-kevin",
          lastAskedSlot: "requestedTime"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          confirmationState: "None",
          slots: {
            serviceName: slot("Manicure"),
            requestedDate: slot("today"),
            requestedTime: slot("p m"),
            staffPreference: slot("Kevin"),
            customerName: slot("Lee"),
            customerPhone: slot("+15555550123")
          }
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "ElicitSlot");
  assert.equal(response.sessionState.dialogAction.slotToElicit, "requestedTime");
  assert.equal(response.sessionState.sessionAttributes.customerName, "Lee");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Manicure");
  assert.equal(response.sessionState.sessionAttributes.requestedDate, usEasternDate(0));
  assert.equal(response.sessionState.sessionAttributes.staffPreference, "Kevin");
  assert.equal(response.sessionState.sessionAttributes.staffId, "staff-kevin");
});

test("DialogCodeHook repairs reschedule NLU to booking draft change during final confirmation", async () => {
  const handler = await loadHandler();
  const phrase = "change it to Monday at two PM with Kelly";
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Sure. Just to confirm the updated appointment.",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitIntent"
          },
          sessionAttributes: {
            customerName: body.customerName,
            customerPhone: body.customerPhone,
            serviceName: body.serviceName,
            requestedDate: body.requestedDate,
            requestedTime: body.requestedTime,
            staffPreference: body.staffPreference,
            awaitingFinalBookingConfirmation: "true",
            bookingConfirmationAsked: "true",
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
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-final-change-reschedule-nlu",
          customerName: "Jane",
          customerPhone: "+15555550123",
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
          name: "RescheduleAppointmentIntent",
          confirmationState: "None",
          slots: {
            serviceName: slot("Full Set"),
            requestedDate: slot("tomorrow"),
            requestedTime: slot("3 PM"),
            staffPreference: slot("Trang"),
            customerName: slot("Jane"),
            customerPhone: slot("+15555550123")
          }
        }
      }
    })
  );

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.intentName, "BookAppointmentIntent");
  assert.equal(fetchCalls[0].body.attributes.finalConfirmationChangeRequest, "true");
  assert.equal(fetchCalls[0].body.currentTurnTranscript, phrase);
  assert.equal(response.sessionState.intent.name, "BookAppointmentIntent");
  assert.equal(response.sessionState.dialogAction.type, "ElicitIntent");
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
            CustomerEndpointAddress: "+15555550123",
            AmazonConnectContactId: `connect-final-denied-${phrase.replace(/\W+/g, "-")}`,
            customerName: "Jane",
            customerPhone: "+15555550123",
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
              customerPhone: slot("+15555550123")
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

test("DialogCodeHook final-confirmation another staff preserves selected staff for exclusion parsing", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock((_url, _options, body) =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Okay, I'll exclude Amy. I found Kelly available.",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitIntent"
          },
          sessionAttributes: {
            serviceName: body.serviceName,
            requestedDate: body.requestedDate,
            requestedTime: body.requestedTime,
            staffPreference: "Kelly",
            staffId: "staff-kelly",
            selectedStaffId: "staff-kelly",
            confirmedStaffId: "staff-kelly",
            excludedStaffIds: JSON.stringify(["staff-trang", "staff-amy"]),
            excludedStaffNames: JSON.stringify(["trang", "amy"]),
            awaitingFinalBookingConfirmation: "true",
            conversationComplete: "false"
          }
        }
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "i want another staff",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+15555550123",
          AmazonConnectContactId: "connect-final-another-staff",
          customerName: "Jane",
          customerPhone: "+15555550123",
          serviceName: "Manicure",
          confirmedServiceName: "Manicure",
          requestedDate: usEasternDate(0),
          requestedTime: "11 AM",
          staffPreference: "Amy",
          staffId: "staff-amy",
          selectedStaffId: "staff-amy",
          confirmedStaffName: "Amy",
          confirmedStaffId: "staff-amy",
          excludedStaffIds: JSON.stringify(["staff-trang"]),
          excludedStaffNames: JSON.stringify(["trang"]),
          awaitingFinalBookingConfirmation: "true",
          bookingConfirmationAsked: "true",
          lastAskedSlot: "bookingConfirmation"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          confirmationState: "None",
          slots: {
            serviceName: slot("Manicure"),
            requestedDate: slot(usEasternDate(0)),
            requestedTime: slot("11 AM"),
            customerName: slot("Jane"),
            customerPhone: slot("+15555550123")
          }
        }
      }
    })
  );

  if (fetchCalls.length > 0) {
    assert.equal(fetchCalls[0].body.currentTurnTranscript, "i want another staff");
    assert.equal(fetchCalls[0].body.staffPreference, "Amy");
    assert.equal(fetchCalls[0].body.staffId, "staff-amy");
    assert.match(fetchCalls[0].body.attributes.excludedStaffIds, /staff-trang/);
  }
  assert.equal(response.sessionState.sessionAttributes.staffPreference, "Amy");
  assert.equal(response.sessionState.sessionAttributes.staffId, "staff-amy");
  assert.equal(response.sessionState.sessionAttributes.selectedStaffId, "staff-amy");
  assert.equal(response.sessionState.sessionAttributes.discardedStaleStaff, undefined);
  assert.match(response.sessionState.sessionAttributes.excludedStaffIds, /staff-trang/);
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
          message: "Let me check for an available operator.",
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
          message: "Let me check for an available operator.",
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
          message: "Let me check for an available operator.",
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

  assert.equal(response.messages[0].content, "Let me check for an available operator.");
  assert.equal(response.messages[0].contentType, "PlainText");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "true");
});

test("HumanEscalationIntent still sends explicit request when availability attributes are blocked", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "HUMAN_ESCALATION",
        appointment: null,
        lexResponse: {
          fulfillmentState: "Fulfilled",
          message: "Let me check for an available operator.",
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

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].body.intentName, "HumanEscalationIntent");
  assert.equal(response.messages[0].content, "Let me check for an available operator.");
  assert.equal(response.messages[0].contentType, "PlainText");
  assert.equal(response.sessionState.sessionAttributes.transferToQueue, "true");
  assert.equal(response.sessionState.sessionAttributes.noAgentsAvailable, undefined);
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
          message: "Let me check for an available operator.",
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
          message: "Let me check for an available operator.",
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

test("reschedule backend slot prompt is downgraded for slotless Lex intent", async () => {
  const handler = await loadHandler();
  installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "What phone number should I use to find your appointment?",
          messageContentType: "PlainText",
          dialogAction: {
            type: "ElicitSlot",
            slotToElicit: "customerPhone"
          },
          sessionAttributes: {
            rescheduleFlowActive: "true",
            forceHumanEscalation: "false",
            transferToQueue: "false"
          }
        }
      })
    )
  );

  const response = await handler(
    baseEvent({
      inputTranscript: "I want to change my existing appointment",
      sessionState: {
        ...baseEvent().sessionState,
        intent: {
          ...baseEvent().sessionState.intent,
          name: "RescheduleAppointmentIntent",
          slots: null
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.type, "ElicitIntent");
  assert.equal(response.sessionState.sessionAttributes.lastAskedSlot, "customerPhone");
  assert.equal(response.sessionState.sessionAttributes.slotToElicit, "customerPhone");
  assert.equal(response.sessionState.sessionAttributes.activeDtmfMenu, undefined);
  delete globalThis.fetch;
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

  assert.equal(response.messages[0].content, "Let me check for an available operator.");
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

test("DialogCodeHook accepts exact Any staff phrase without staff prompt", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for local Any staff recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "I want to book a Pedicure tomorrow at 2 PM. Any staff is fine.",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-any-staff-exact",
          customerName: "Kiet Nguyen",
          customerPhone: "7325956266"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.staffPreference, "Any staff");
  assert.equal(response.sessionState.sessionAttributes.staffResolutionStatus, "explicit_any");
  assert.equal(response.sessionState.sessionAttributes.staffId, undefined);
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "staffPreference");
});

test("DialogCodeHook accepts live Any staff ASR variants only in staff context", async () => {
  const variants = [
    "first available",
    "first avaiable",
    "what available",
    "who available",
    "one available",
    "which available",
    "for available",
    "available"
  ];

  for (const phrase of variants) {
    const handler = await loadHandler();
    globalThis.fetch = async () => {
      throw new Error(`fetch should not be called for ${phrase}`);
    };

    const response = await handler(
      baseEvent({
        invocationSource: "DialogCodeHook",
        inputTranscript: phrase,
        sessionId: `connect-any-staff-${phrase.replace(/\W+/g, "-")}`,
        sessionState: {
          ...baseEvent().sessionState,
          sessionAttributes: {
            salonId: "salon-explicit",
            CalledNumber: "+18483487681",
            CustomerEndpointAddress: "+17325956266",
            AmazonConnectContactId: `connect-any-staff-${phrase.replace(/\W+/g, "-")}`,
            lastAskedSlot: "staffPreference",
            activeDtmfMenu: "staff",
            staffRecognitionFailureCount: "2",
            invalidStaffPreferenceIgnored: "true",
            discardedStaleStaff: "anystop",
            customerName: "Kiet Nguyen",
            customerPhone: "7325956266",
            serviceName: "Pedicure",
            requestedDate: usEasternDate(1),
            requestedTime: "2 PM",
            ...dynamicStaffAttributes()
          },
          intent: {
            ...baseEvent().sessionState.intent,
            slots: {
              staffPreference: slotWith({
                originalValue: phrase,
                interpretedValue: phrase.replace(/\s+/g, ""),
                resolvedValues: [phrase.replace(/\s+/g, "")]
              })
            }
          }
        }
      })
    );

    assert.equal(response.sessionState.sessionAttributes.staffPreference, "Any staff", phrase);
    assert.equal(response.sessionState.sessionAttributes.confirmedStaffName, "Any staff", phrase);
    assert.equal(response.sessionState.sessionAttributes.staffResolutionStatus, "explicit_any", phrase);
    assert.equal(response.sessionState.sessionAttributes.staffId, undefined, phrase);
    assert.equal(response.sessionState.sessionAttributes.selectedStaffId, undefined, phrase);
    assert.equal(response.sessionState.sessionAttributes.confirmedStaffId, undefined, phrase);
    assert.equal(response.sessionState.sessionAttributes.staffRecognitionFailureCount, undefined, phrase);
    assert.equal(response.sessionState.sessionAttributes.invalidStaffPreferenceIgnored, undefined, phrase);
    assert.equal(response.sessionState.sessionAttributes.discardedStaleStaff, undefined, phrase);
    assert.doesNotMatch(response.messages?.[0]?.content || "", /didn.t find that technician/i, phrase);
    assert.notEqual(response.sessionState.dialogAction.slotToElicit, "staffPreference", phrase);
  }
});

test("DialogCodeHook asks confirmation for malformed first-available ASR tails", async () => {
  for (const phrase of [
    "any stop",
    "anystop",
    "any stop if i",
    "any stuff",
    "any star",
    "and is up for hire able",
    "and he's up for hire able",
    "and it's thirty five",
    "and its thirty five",
    "and it's top a five",
    "and it's top e five",
    "and it's top five",
    "it's top five",
    "and it stopped at five",
    "any top five"
  ]) {
    const handler = await loadHandler();
    globalThis.fetch = async () => {
      throw new Error(`fetch should not be called before staff proposal confirmation for ${phrase}`);
    };

    const response = await handler(
      baseEvent({
        invocationSource: "DialogCodeHook",
        inputTranscript: phrase,
        sessionId: `connect-any-staff-proposed-${phrase.replace(/\W+/g, "-")}`,
        sessionState: {
          ...baseEvent().sessionState,
          sessionAttributes: {
            salonId: "salon-explicit",
            CalledNumber: "+18483487681",
            CustomerEndpointAddress: "+17325956266",
            AmazonConnectContactId: `connect-any-staff-proposed-${phrase.replace(/\W+/g, "-")}`,
            lastAskedSlot: "staffPreference",
            activeDtmfMenu: "staff",
            customerName: "Kiet Nguyen",
            customerPhone: "7325956266",
            serviceName: "Pedicure",
            requestedDate: usEasternDate(1),
            requestedTime: "2 PM",
            ...dynamicStaffAttributes()
          },
          intent: {
            ...baseEvent().sessionState.intent,
            slots: {}
          }
        }
      })
    );

    assert.equal(response.sessionState.sessionAttributes.staffPreference, undefined, phrase);
    assert.equal(response.sessionState.sessionAttributes.proposedStaffPreference, "Any staff", phrase);
    assert.equal(response.sessionState.sessionAttributes.awaitingStaffConfirmation, "true", phrase);
    assert.equal(response.sessionState.sessionAttributes.staffClarificationReason, "ambiguous_first_available_asr", phrase);
    assert.match(response.messages?.[0]?.content || "", /Did you mean first available/i, phrase);
    assert.equal(response.sessionState.dialogAction.slotToElicit, "staffPreference", phrase);
    const decisions = JSON.parse(response.sessionState.sessionAttributes.voiceSlotDecisions);
    assert.equal(decisions[0].slot, "staffPreference", phrase);
    assert.equal(decisions[0].action, "propose", phrase);
    assert.equal(decisions[0].canonicalValue, "Any staff", phrase);
    assert.equal(decisions[0].confidenceBand, "medium", phrase);
  }
});

test("DialogCodeHook explicit first-available rejections do not propose Any staff", async () => {
  for (const phrase of ["not first available", "and it's not a five"]) {
    const handler = await loadHandler();
    globalThis.fetch = async () => {
      throw new Error(`fetch should not be called for rejected Any staff phrase ${phrase}`);
    };

    const response = await handler(
      baseEvent({
        invocationSource: "DialogCodeHook",
        inputTranscript: phrase,
        sessionId: `connect-any-staff-rejected-${phrase.replace(/\W+/g, "-")}`,
        sessionState: {
          ...baseEvent().sessionState,
          sessionAttributes: {
            salonId: "salon-explicit",
            CalledNumber: "+18483487681",
            CustomerEndpointAddress: "+17325956266",
            AmazonConnectContactId: `connect-any-staff-rejected-${phrase.replace(/\W+/g, "-")}`,
            lastAskedSlot: "staffPreference",
            activeDtmfMenu: "staff",
            customerName: "Kiet Nguyen",
            customerPhone: "7325956266",
            serviceName: "Pedicure",
            requestedDate: usEasternDate(1),
            requestedTime: "2 PM",
            ...dynamicStaffAttributes()
          },
          intent: {
            ...baseEvent().sessionState.intent,
            slots: {}
          }
        }
      })
    );

    assert.equal(response.sessionState.sessionAttributes.staffPreference, undefined, phrase);
    assert.equal(response.sessionState.sessionAttributes.proposedStaffPreference, undefined, phrase);
    assert.equal(response.sessionState.sessionAttributes.voiceSlotDecisions, undefined, phrase);
    assert.equal(response.sessionState.dialogAction.slotToElicit, "staffPreference", phrase);
    assert.match(response.messages?.[0]?.content || "", /Which staff would you like/i, phrase);
  }
});

test("DialogCodeHook does not convert any time is fine into Any staff", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for negative Any time guard");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "I want a Pedicure tomorrow afternoon. Any time is fine.",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-any-time-negative",
          customerName: "Kiet Nguyen",
          customerPhone: "7325956266"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.sessionAttributes.serviceName, "Pedicure");
  assert.equal(response.sessionState.sessionAttributes.requestedDate, usEasternDate(1));
  assert.notEqual(response.sessionState.sessionAttributes.staffPreference, "Any staff");
});

test("DialogCodeHook known caller lookup runs before first name prompt", async () => {
  const handler = await loadHandler();
  const fetchCalls = installFetchMock(() =>
    jsonResponse(
      successfulBackendPayload({
        outcome: "MISSING_INFO",
        appointment: null,
        lexResponse: {
          fulfillmentState: "InProgress",
          message: "Please say yes to confirm, or tell me what you would like to change.",
          messageContentType: "PlainText",
          sessionAttributes: {
            customerId: "customer-lee",
            recognizedCustomerId: "customer-lee",
            customerName: "Lee",
            recognizedCustomerName: "Lee",
            customerNameSource: "phone_lookup",
            customerProfileSource: "active_customer",
            customerPhone: "+84798171999",
            forceHumanEscalation: "false",
            transferToQueue: "false"
          }
        },
        missingFields: []
      })
    )
  );

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "I want to book a Pedicure tomorrow at 2 PM with any staff.",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-known-caller-initial"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.equal(fetchCalls[0].body.serviceName, "Pedicure");
  assert.equal(fetchCalls[0].body.requestedTime, "2 PM");
  assert.equal(fetchCalls[0].body.staffPreference, "Any staff");
  assert.equal(response.sessionState.sessionAttributes.customerName, "Lee");
  assert.equal(response.sessionState.sessionAttributes.knownCallerLookupAttempted, "true");
  assert.equal(response.sessionState.sessionAttributes.knownCallerLookupStatus, "FOUND");
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "customerName");
  assert.doesNotMatch(response.messages?.[0]?.content || "", /name/i);
});

test("DialogCodeHook captures exact any-staff one-shot booking fields", async () => {
  for (const [index, phrase] of [
    "Full Set today at 3 PM, any staff is fine."
  ].entries()) {
    const handler = await loadHandler();
    const fetchCalls = installFetchMock(() => {
      throw new Error(`fetch should not be called before API staff selection for ${phrase}`);
    });

    const response = await handler(
      baseEvent({
        invocationSource: "DialogCodeHook",
        inputTranscript: phrase,
        sessionId: `connect-any-staff-one-shot-${index}`,
        sessionState: {
          ...baseEvent().sessionState,
          sessionAttributes: {
            salonId: "salon-explicit",
            CalledNumber: "+18483487681",
            CustomerEndpointAddress: "+84798171999",
            AmazonConnectContactId: `connect-any-staff-one-shot-${index}`,
            customerName: "Lee",
            customerPhone: "+84798171999"
          },
          intent: {
            ...baseEvent().sessionState.intent,
            slots: {}
          }
        }
      })
    );

    assert.equal(fetchCalls.length, 0, phrase);
    assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set", phrase);
    assert.equal(response.sessionState.sessionAttributes.requestedDate, usEasternDate(0), phrase);
    assert.equal(response.sessionState.sessionAttributes.requestedTime, "3 PM", phrase);
    assert.equal(response.sessionState.sessionAttributes.staffPreference, "Any staff", phrase);
    assert.equal(response.sessionState.sessionAttributes.conversationComplete, "false", phrase);
    assert.notEqual(response.sessionState.dialogAction.slotToElicit, "staffPreference", phrase);
  }
});

test("DialogCodeHook recovers g p s as 3 PM only in time context", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for local g p s recovery");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "book full set tomorrow at g p s with chang",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-gps-time",
          customerName: "Lee",
          recognizedCustomerName: "Lee",
          customerNameSource: "phone_lookup",
          customerPhone: "+84798171999"
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
  assert.equal(response.sessionState.sessionAttributes.staffPreference, "Trang");
  assert.notEqual(response.sessionState.dialogAction.slotToElicit, "requestedTime");

  const negative = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "Tell me about GPS",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+17325956266",
          AmazonConnectContactId: "connect-gps-negative",
          customerName: "Kiet Nguyen",
          customerPhone: "7325956266",
          serviceName: "Pedicure",
          requestedDate: usEasternDate(1)
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  assert.notEqual(negative.sessionState.sessionAttributes.requestedTime, "3 PM");
});

test("DialogCodeHook clipped time and staff fragments never corrupt requestedDate", async () => {
  const handler = await loadHandler();
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for clipped local recovery");
  };

  const first = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "at g p m",
      sessionId: "connect-clipped-gpm-emmy",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-clipped-gpm-emmy",
          customerName: "Lee",
          recognizedCustomerName: "Lee",
          customerNameSource: "phone_lookup",
          customerPhone: "+84798171999",
          lastAskedSlot: "requestedTime"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {}
        }
      }
    })
  );

  const firstAttrs = first.sessionState.sessionAttributes;
  assert.equal(firstAttrs.requestedTime, undefined);
  assert.equal(first.sessionState.dialogAction.slotToElicit, "requestedTime");
  assert.match(first.messages?.[0]?.content || "", /What time.*3 PM/i);

  const second = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "the emmy",
      sessionId: "connect-clipped-gpm-emmy",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          ...first.sessionState.sessionAttributes,
          lastAskedSlot: "staffPreference"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          slots: {
            staffPreference: slotWith({
              originalValue: "the emmy",
              interpretedValue: "emmy",
              resolvedValues: ["Amy"]
            })
          }
        }
      }
    })
  );

  const attrs = second.sessionState.sessionAttributes;
  assert.equal(attrs.requestedTime, undefined);
  assert.equal(attrs.requestedDate, undefined);
  assert.equal(attrs.serviceName, undefined);
  assert.equal(attrs.staffPreference, "Amy");
  assert.equal(attrs.conversationComplete, "false");
  assert.doesNotMatch(second.messages?.[0]?.content || "", /3 PM/i);
  assert.notEqual(second.sessionState.dialogAction.type, "Close");
});

test("DialogCodeHook rejects contradictory weekday and explicit date without losing other slots", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for weekday/date conflict");
  };
  const explicitDate = usEasternDate(1);
  const [year, month, day] = explicitDate.split("-").map(Number);
  const explicitDateObject = new Date(Date.UTC(year, month - 1, day));
  const monthName = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long" }).format(explicitDateObject);
  const actualWeekday = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(explicitDateObject);
  const wrongWeekday = actualWeekday === "Monday" ? "Tuesday" : "Monday";

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: `put that on ${wrongWeekday} ${monthName} ${day}`,
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-weekday-date-conflict",
          customerName: "Lee",
          customerPhone: "+84798171999",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedTime: "3 PM",
          staffPreference: "Amy",
          confirmedStaffName: "Amy"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          state: "InProgress",
          confirmationState: "None",
          slots: {}
        }
      }
    })
  );

  assert.equal(response.sessionState.dialogAction.slotToElicit, "requestedDate");
  assert.equal(response.sessionState.sessionAttributes.requestedDate, undefined);
  assert.equal(response.sessionState.sessionAttributes.requestedTime, "3 PM");
  assert.equal(response.sessionState.sessionAttributes.serviceName, "Full Set");
  assert.equal(response.sessionState.sessionAttributes.staffPreference, "Amy");
  assert.match(response.messages[0].content, new RegExp(`${monthName} ${day} is ${actualWeekday}`));
});

test("DialogCodeHook rejects past requested date before customer name prompt", async () => {
  const handler = await loadHandler({ DEFAULT_SALON_TIMEZONE: "America/New_York" });
  globalThis.fetch = async () => {
    throw new Error("fetch should not be called for past date before customer name");
  };

  const response = await handler(
    baseEvent({
      invocationSource: "DialogCodeHook",
      inputTranscript: "yes",
      sessionState: {
        ...baseEvent().sessionState,
        sessionAttributes: {
          salonId: "salon-explicit",
          CalledNumber: "+18483487681",
          CustomerEndpointAddress: "+84798171999",
          AmazonConnectContactId: "connect-past-before-name",
          customerPhone: "+84798171999",
          serviceName: "Full Set",
          confirmedServiceName: "Full Set",
          requestedDate: usEasternDate(-1),
          requestedTime: "3 PM",
          staffPreference: "Amy",
          confirmedStaffName: "Amy"
        },
        intent: {
          ...baseEvent().sessionState.intent,
          state: "InProgress",
          confirmationState: "None",
          slots: {}
        }
      }
    })
  );

  const attrs = response.sessionState.sessionAttributes;
  assert.equal(response.sessionState.dialogAction.slotToElicit, "requestedDate");
  assert.match(response.messages[0].content, /That time has already passed/i);
  assert.equal(attrs.serviceName, "Full Set");
  assert.equal(attrs.staffPreference, "Amy");
  assert.equal(attrs.requestedDate, undefined);
  assert.equal(attrs.requestedTime, undefined);
  assert.equal(response.sessionState.intent.slots.requestedDate, null);
  assert.equal(response.sessionState.intent.slots.requestedTime, null);
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
