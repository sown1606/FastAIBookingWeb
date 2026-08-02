import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readFlow = async (relativePath) =>
  JSON.parse(await readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8"));

const mainFlowPath = "infra/aws/connect/contact-flows/operator-advertising-main-line.json";
const queueFlowPath = "infra/aws/connect/contact-flows/operator-advertising-customer-queue.json";
const manifestPath = "infra/aws/connect/operator-advertising-source-manifest.json";

const actionMap = (flow) => new Map(flow.Actions.map((action) => [action.Identifier, action]));

const referencedActions = (flow) => [
  flow.StartAction,
  ...flow.Actions.flatMap((action) => [
    action.Transitions?.NextAction,
    ...(action.Transitions?.Errors ?? []).map((error) => error.NextAction),
    ...(action.Transitions?.Conditions ?? []).map((condition) => condition.NextAction)
  ])
].filter(Boolean);

test("advertising operator flows have complete action graphs", async () => {
  for (const path of [mainFlowPath, queueFlowPath]) {
    const flow = await readFlow(path);
    const identifiers = flow.Actions.map((action) => action.Identifier);
    assert.equal(new Set(identifiers).size, identifiers.length);
    for (const referencedAction of referencedActions(flow)) {
      assert.ok(identifiers.includes(referencedAction), `${path} references ${referencedAction}`);
    }
  }
});

test("Anh Kiet advertising main line is English-only with no menu or AI integration", async () => {
  const flow = await readFlow(mainFlowPath);
  const actions = actionMap(flow);
  const actionTypes = new Set(flow.Actions.map((action) => action.Type));
  const serialized = JSON.stringify(flow);

  assert.equal(actionTypes.has("ConnectParticipantWithLexBot"), false);
  assert.equal(actionTypes.has("InvokeLambdaFunction"), false);
  assert.equal(actionTypes.has("GetParticipantInput"), false);
  assert.equal(actionTypes.has("Compare"), false);
  assert.equal(serialized.includes("press 1"), false);
  assert.equal(serialized.includes("press 2"), false);
  assert.equal(serialized.includes("vietnamese"), false);
  assert.equal(serialized.includes("operatorLanguage\":\"vi"), false);
  assert.equal(actions.get("set-hotline-attributes").Parameters.Attributes.operatorLanguage, "en");
  assert.equal(
    actions.get("set-hotline-attributes").Parameters.Attributes.operatorHotline,
    "anh-kiet-advertising"
  );
});

test("Anh Kiet hotline uses Joanna Neural Conversational at ninety percent speed", async () => {
  const flows = await Promise.all([readFlow(mainFlowPath), readFlow(queueFlowPath)]);

  for (const flow of flows) {
    const voiceActions = flow.Actions.filter(
      (action) => action.Type === "UpdateContactTextToSpeechVoice"
    );
    assert.equal(voiceActions.length, 1);
    assert.deepEqual(voiceActions[0].Parameters, {
      TextToSpeechVoice: "Joanna",
      TextToSpeechEngine: "Neural",
      TextToSpeechStyle: "Conversational"
    });

    const directMessages = flow.Actions
      .filter((action) => action.Type === "MessageParticipant")
      .map((action) => action.Parameters);
    const iterativeMessages = flow.Actions
      .filter((action) => action.Type === "MessageParticipantIteratively")
      .flatMap((action) => action.Parameters.Messages);
    const synthesizedMessages = [...directMessages, ...iterativeMessages].filter(
      (message) => message.SSML
    );

    assert.ok(synthesizedMessages.length > 0);
    assert.equal(
      [...directMessages, ...iterativeMessages].some((message) => message.Text),
      false
    );
    for (const message of synthesizedMessages) {
      assert.match(
        message.SSML,
        /^<speak><prosody rate="90%">.+<\/prosody><\/speak>$/
      );
    }
  }
});

test("advertising main line checks for an available operator before queueing", async () => {
  const flow = await readFlow(mainFlowPath);
  const actions = actionMap(flow);
  const staffing = actions.get("check-available-operators");

  assert.equal(staffing.Type, "CheckMetricData");
  assert.equal(staffing.Parameters.MetricType, "NumberOfAgentsAvailable");
  assert.equal(staffing.Transitions.NextAction, "main-enable-voicemail");
  assert.deepEqual(staffing.Transitions.Conditions[0], {
    NextAction: "english-connecting-message",
    Condition: {
      Operator: "NumberGreaterThan",
      Operands: ["0"]
    }
  });
});

test("busy paths enable IVR recording and provide a 60-second voicemail window", async () => {
  const flows = await Promise.all([readFlow(mainFlowPath), readFlow(queueFlowPath)]);
  const voicemailPromptId =
    "arn:aws:connect:us-east-1:197452633989:instance/74f78377-766f-46b7-a745-4bc97b68a8dc/prompt/612e4046-24b4-4efc-b175-9d50a026dbd2";

  for (const flow of flows) {
    const recordingActions = flow.Actions.filter(
      (action) => action.Type === "UpdateContactRecordingBehavior"
    );
    assert.equal(recordingActions.length, 1);
    for (const action of recordingActions) {
      assert.equal(action.Parameters.RecordingBehavior.IVRRecordingBehavior, "Enabled");
      assert.deepEqual(action.Parameters.RecordingBehavior.RecordedParticipants, []);
    }
    assert.ok(
      flow.Actions.some(
        (action) =>
          action.Type === "MessageParticipant" &&
          action.Parameters.PromptId === voicemailPromptId
      )
    );
  }
});

test("advertising customer queue falls back after fifteen seconds", async () => {
  const flow = await readFlow(queueFlowPath);
  const loopActions = flow.Actions.filter(
    (action) => action.Type === "MessageParticipantIteratively"
  );

  assert.equal(loopActions.length, 1);
  for (const action of loopActions) {
    assert.equal(action.Parameters.InterruptFrequencySeconds, "15");
    assert.equal(
      action.Transitions.Conditions[0].NextAction,
      "queue-enable-voicemail"
    );
  }
});

test("Anh Kiet hotline manifest pins the claimed number and English-only release", async () => {
  const manifest = await readFlow(manifestPath);

  assert.equal(manifest.deploymentStatus, "PROMOTED_PENDING_POST_PSTN");
  assert.equal(manifest.owner, "Anh Kiet");
  assert.equal(manifest.language, "en-US");
  assert.equal(manifest.keypadMenuEnabled, false);
  assert.deepEqual(manifest.textToSpeech, {
    voice: "Joanna",
    engine: "Neural",
    style: "Conversational",
    ssmlRate: "90%"
  });
  assert.equal(manifest.phoneNumber.e164, "+19739542668");
  assert.equal(
    manifest.phoneNumber.associatedMainContactFlowId,
    manifest.resources.mainContactFlowId
  );
  assert.deepEqual(
    manifest.resources.operatorUsers.map((user) => user.username),
    ["ken-operator01", "ken-operator02"]
  );
});
