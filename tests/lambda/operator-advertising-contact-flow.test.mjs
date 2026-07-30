import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readFlow = async (relativePath) =>
  JSON.parse(await readFile(new URL(`../../${relativePath}`, import.meta.url), "utf8"));

const mainFlowPath = "infra/aws/connect/contact-flows/operator-advertising-main-line.json";
const queueFlowPath = "infra/aws/connect/contact-flows/operator-advertising-customer-queue.json";

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

test("advertising main line is keypad-only and contains no AI integration", async () => {
  const flow = await readFlow(mainFlowPath);
  const actions = actionMap(flow);
  const actionTypes = new Set(flow.Actions.map((action) => action.Type));

  assert.equal(actionTypes.has("ConnectParticipantWithLexBot"), false);
  assert.equal(actionTypes.has("InvokeLambdaFunction"), false);

  const menu = actions.get("language-menu-first-attempt");
  assert.equal(menu.Type, "GetParticipantInput");
  assert.deepEqual(
    menu.Transitions.Conditions.map((condition) => ({
      digit: condition.Condition.Operands[0],
      next: condition.NextAction
    })),
    [
      { digit: "1", next: "set-language-english" },
      { digit: "2", next: "set-language-vietnamese" }
    ]
  );
  assert.equal(actions.get("set-language-english").Parameters.Attributes.operatorLanguage, "en");
  assert.equal(actions.get("set-language-vietnamese").Parameters.Attributes.operatorLanguage, "vi");
});

test("advertising main line checks for an available operator before queueing", async () => {
  const flow = await readFlow(mainFlowPath);
  const actions = actionMap(flow);
  const staffing = actions.get("check-available-operators");

  assert.equal(staffing.Type, "CheckMetricData");
  assert.equal(staffing.Parameters.MetricType, "NumberOfAgentsAvailable");
  assert.equal(staffing.Transitions.NextAction, "main-busy-language-branch");
  assert.deepEqual(staffing.Transitions.Conditions[0], {
    NextAction: "connecting-language-branch",
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
    assert.equal(recordingActions.length, 2);
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

  assert.equal(loopActions.length, 2);
  for (const action of loopActions) {
    assert.equal(action.Parameters.InterruptFrequencySeconds, "15");
    assert.equal(
      action.Transitions.Conditions[0].NextAction,
      "queue-busy-language-branch"
    );
  }
});
