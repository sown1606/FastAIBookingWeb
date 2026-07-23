import assert from "node:assert/strict";
import { rmSync, readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  assertReadbackMatchesManifest,
  buildReleasePlan,
  buildRollbackPlan,
  connectFlowNormalizedSha256,
  computeApiSourceHash,
  computeSourceHash,
  contactMatchesRelease,
  createReleaseId,
  evaluateReleaseCase,
  generateConnectFlowContent,
  lexAliasIdFromConnectFlow,
  normalizeAcceptanceManifest,
  packageLambdaArtifact,
  validateConnectFlow,
  validateEmergencyPromotionAuthorization,
  validatePromotionGate
} from "../../scripts/aws/voice-stack-release.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const metric = (value) => ({ state: "MEASURED", value });
const na = () => ({ state: "NOT_APPLICABLE", value: null });

const passingMetrics = () => ({
  serviceCaptureResult: metric("DIRECT"),
  staffCaptureResult: metric("DIRECT"),
  dateAccuracy: metric("MATCHED"),
  timeAccuracy: metric("MATCHED"),
  clarificationCount: metric(0),
  wrongServiceAutoCommitCount: metric(0),
  wrongStaffAutoCommitCount: metric(0),
  appointmentBeforeFinalConfirmationCount: metric(0),
  silentTurnCount: metric(0),
  groundedFieldLossCount: metric(0),
  repeatedLongMenuCount: metric(0),
  autoTransferWithoutRequestCount: metric(0),
  duplicateAppointmentCount: metric(0),
  lambdaProcessingMs: metric(120),
  apiProcessingMs: metric(220),
  callerTurnToPromptMs: metric(900),
  promptPlaybackEvidence: metric(true)
});

const acceptedCase = ({ caseId, roundId, contactId, testerHash = "tester-a" }) => ({
  caseId,
  roundId,
  contactId,
  testerHash,
  accepted: true,
  evaluation: { passed: true },
  metrics: passingMetrics(),
  observability: { complete: true },
  cleanup: { state: "MEASURED", activeTestAppointmentCount: 0 }
});

const passingManifest = () => ({
  schemaVersion: "fastaibooking.voice-release.v2",
  releaseId: "voice-unit",
  sourceHash: "source-hash",
  sourceCommit: "2a223eb2d996bf162df518bdfe7f00f701fcb34b",
  canaryDeploy: {
    status: "CANARY_READY_FOR_HUMAN_PSTN",
    api: {
      imageTag: "fastaibooking-api:voice-unit",
      canaryReadback: { runtimeReleaseId: "voice-unit" }
    },
    lambda: { publishedVersion: "7", codeSha256Base64: "lambda-code" },
    lex: { botVersion: "52", aliasId: "ALIASNEW" },
    connect: { normalizedSha256: "flow" }
  },
  api: {
    releaseId: "voice-unit",
    imageTag: "fastaibooking-api:voice-unit",
    canaryReadback: { runtimeReleaseId: "voice-unit", imageId: "sha256:image" }
  },
  lambda: { publishedVersion: "7", codeSha256Base64: "lambda-code" },
  lex: { botVersion: "52", alias: { aliasId: "ALIASNEW" } },
  connect: { canary: { normalizedSha256: "flow", marker: "voice-unit-canary" } },
  canaryAcceptance: {
    cases: [
      ...["C01", "C02", "C03", "C04", "C05", "C06"].map((caseId, index) =>
        acceptedCase({ caseId, roundId: "round-1", contactId: `contact-r1-${index}`, testerHash: "tester-a" })
      ),
      ...["C01", "C02", "C03", "C04", "C05", "C06"].map((caseId, index) =>
        acceptedCase({ caseId, roundId: "round-2", contactId: `contact-r2-${index}`, testerHash: "tester-b" })
      ),
      ...["S01", "S02", "S03", "S04"].map((caseId, index) =>
        acceptedCase({ caseId, roundId: "safety", contactId: `contact-s-${index}`, testerHash: index % 2 ? "tester-b" : "tester-a" })
      )
    ]
  }
});

test("voice release production gate reads v2 manifest schema paths", () => {
  const gate = validatePromotionGate(passingManifest());

  assert.equal(gate.ok, true);
  assert.deepEqual(gate.failures, []);
});

test("voice release IDs are neutral v2 IDs", () => {
  assert.equal(
    createReleaseId({ timestamp: "20260719T010203Z", sourceHash: "abcdef1234567890" }),
    "voice-20260719T010203Z-abcdef123456"
  );
});

test("voice release source hash includes Lex intent source", () => {
  const script = readFileSync(path.join(repoRoot, "scripts/aws/voice-stack-release.mjs"), "utf8");
  for (const intentName of [
    "BookAppointmentIntent",
    "CancelAppointmentIntent",
    "FallbackIntent",
    "HumanEscalationIntent",
    "RescheduleAppointmentIntent"
  ]) {
    assert.match(
      script,
      new RegExp(`infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/${intentName}/Intent\\.json`),
      `${intentName} must affect VOICE_SOURCE_SHA256`
    );
  }
});

test("voice release deploy syncs Lex intent source before build", () => {
  const script = readFileSync(path.join(repoRoot, "scripts/aws/voice-stack-release.mjs"), "utf8");

  assert.match(script, /function syncLexIntents/);
  assert.match(script, /function syncLexSlots/);
  assert.match(script, /lexv2-models", "update-intent"/);
  assert.match(script, /lexv2-models", "update-slot"/);
  assert.match(script, /validateIntentReadback/);
  assert.match(script, /const slots = syncLexSlots\(targets, releaseId\);/);
  assert.match(script, /const intents = syncLexIntents\(targets, releaseId\);/);
  assert.match(
    script,
    /waitForLexLocale\(targets, "DRAFT", \["Built", "ReadyExpressTesting", "NotBuilt", "Failed"\]\)/,
    "a failed DRAFT must be reopened by update-bot-locale before source synchronization"
  );
  assert.match(
    script,
    /actualSlotConstraint !== expectedSlotConstraint/,
    "slot recovery deployment must verify the required constraint before build"
  );
  assert.ok(
    script.indexOf("const slots = syncLexSlots(targets, releaseId);") <
      script.indexOf("\"lexv2-models\", \"build-bot-locale\""),
    "slot source must be applied before building the Lex locale"
  );
  assert.ok(
    script.indexOf("const intents = syncLexIntents(targets, releaseId);") <
      script.indexOf("\"lexv2-models\", \"build-bot-locale\""),
    "intent source must be applied before building the Lex locale"
  );
});

test("voice release acceptance rejects stale and missing fingerprints", () => {
  const manifest = {
    connect: { canary: { marker: "v49-human-asr-unit-canary" } },
    lex: { aliasId: "ALIASNEW", botVersion: "52" },
    lambda: { codeSha256Base64: "lambda-new" },
    api: { releaseId: "v49-human-asr-unit" }
  };

  assert.deepEqual(
    contactMatchesRelease(
      {
        fingerprints: {
          connectFlowMarker: "2026-07-17-thuyet-voice-hotfix",
          lexAliasId: "JVIPIZDYE3",
          lexBotVersion: "41",
          lambdaCodeSha256: "lambda-old",
          apiReleaseId: "old",
          voiceVariant: "canary"
        }
      },
      manifest
    ).ok,
    false
  );

  const missing = contactMatchesRelease({ fingerprints: {} }, manifest);
  assert.equal(missing.ok, false);
  assert.ok(missing.failures.includes("connect_marker_mismatch"));
  assert.ok(missing.failures.includes("lambda_identity_missing"));
  assert.ok(missing.failures.includes("api_identity_missing"));
});

test("voice release dry-run plan has zero writes but canary plan covers Lambda Lex and Connect", () => {
  const plan = buildReleasePlan({ target: "canary", dryRun: true });

  assert.deepEqual(plan.awsWrites, []);
  assert.ok(plan.plannedWrites.some((item) => item.startsWith("lambda:")));
  assert.ok(plan.plannedWrites.some((item) => item.startsWith("lex:")));
  assert.ok(plan.plannedWrites.some((item) => item.startsWith("connect:")));
  assert.ok(plan.plannedWrites.includes("lex:update-intent"));
  assert.ok(plan.plannedWrites.includes("connect:associate-lex-bot-alias"));
  assert.ok(
    plan.plannedWrites.indexOf("lex:update-intent") < plan.plannedWrites.indexOf("lex:build-bot-locale")
  );
  assert.ok(
    plan.plannedWrites.indexOf("connect:associate-lex-bot-alias") <
      plan.plannedWrites.indexOf("connect:update-contact-flow-content")
  );
});

test("voice release production plan reuses accepted hashes instead of rebuilding", () => {
  const plan = buildReleasePlan({
    target: "production",
    dryRun: false,
    acceptedManifest: {
      lambda: { sha256: "accepted-lambda" },
      lex: { botVersion: "52" }
    }
  });

  assert.equal(plan.rebuildsArtifacts, false);
  assert.equal(plan.reusesAcceptedHashes, true);
  assert.ok(plan.plannedWrites.includes("lambda:update-function-code"));
  assert.ok(plan.plannedWrites.includes("lambda:publish-version"));
  assert.ok(plan.plannedWrites.includes("api:switch-production-upstream"));
  assert.ok(plan.plannedWrites.includes("connect:associate-lex-bot-alias"));
  assert.ok(
    plan.plannedWrites.indexOf("connect:associate-lex-bot-alias") <
      plan.plannedWrites.indexOf("connect:update-contact-flow-content")
  );
});

test("voice release rollback plan restores exact prior flow content and alias when required", () => {
  const snapshot = {
    lexAliasRestoreRequired: true,
    connect: {
      flowId: "flow-123",
      normalizedSha256: "sha-before",
      content: { StartAction: "start", Actions: [] }
    }
  };

  const plan = buildRollbackPlan(snapshot);
  assert.equal(plan.restoresConnectFlowId, "flow-123");
  assert.equal(plan.expectedConnectSha256, "sha-before");
  assert.deepEqual(plan.exactContent, snapshot.connect.content);
  assert.ok(plan.writes.includes("connect:update-contact-flow-content"));
  assert.ok(plan.writes.includes("lex:update-bot-alias"));
});

test("voice release rollback snapshots the Lex alias actually referenced by the live Connect flow", () => {
  const content = {
    StartAction: "lex",
    Actions: [{
      Identifier: "lex",
      Type: "ConnectParticipantWithLexBot",
      Parameters: { LexV2Bot: { AliasArn: "arn:aws:lex:us-east-1:197452633989:bot-alias/KHMIXGA2US/ACTIVE123" } },
      Transitions: {}
    }]
  };
  assert.equal(lexAliasIdFromConnectFlow(content, "CONFIGURED"), "ACTIVE123");
  assert.equal(lexAliasIdFromConnectFlow({ StartAction: "end", Actions: [] }, "CONFIGURED"), "CONFIGURED");
});

test("voice release production promotion reuses the snapshotted active Lex alias only when alias quota is exhausted", () => {
  const script = readFileSync(path.join(repoRoot, "scripts/aws/voice-stack-release.mjs"), "utf8");
  assert.match(script, /error\.details\.code !== "ServiceQuotaExceededException" \|\| !clone/);
  assert.match(script, /cloneAliasId: lexAliasIdFrom\(beforeProduction\.lexAlias\)/);
  assert.match(script, /"--bot-alias-id",\s*cloneAliasId,\s*"--bot-alias-name",\s*lexAliasNameFrom\(clone\)/);
});

test("voice release dynamic marker is injected into every reachable Lex path", () => {
  const sourceFlow = JSON.parse(
    readFileSync(path.join(repoRoot, "infra/aws/connect/contact-flows/ai-reception.json"), "utf8")
  );
  const targets = JSON.parse(
    readFileSync(path.join(repoRoot, "infra/aws/deployment/voice-stack.targets.json"), "utf8")
  );
  const aliasArn = "arn:aws:lex:us-east-1:197452633989:bot-alias/KHMIXGA2US/RELALIAS";
  const marker = "v49-human-asr-unit-canary";

  const generated = generateConnectFlowContent(sourceFlow, {
    targets,
    target: "canary",
    aliasArn,
    aliasName: "canary-v49-human-asr-unit",
    marker,
    releaseId: "v49-human-asr-unit",
    sourceHash: "source-hash",
    variant: "canary",
    lexAliasId: "RELALIAS",
    lexBotVersion: "52",
    lambdaFunctionName: "booking-handler-canary",
    lambdaFunctionVersion: "7",
    lambdaCodeSha256: "lambda-code",
    apiReleaseId: "v49-human-asr-unit",
    apiVariant: "canary"
  });

  assert.deepEqual(validateConnectFlow(generated, { aliasArn, marker }), []);
  const generatedHash = connectFlowNormalizedSha256(generated);
  for (const action of generated.Actions) {
    const attrs = action.Parameters?.LexSessionAttributes ?? action.Parameters?.Attributes;
    if (!attrs?.connectFlowSourceVersion) {
      continue;
    }
    assert.equal(attrs.connectFlowSourceVersion, marker);
    assert.equal(attrs.connectFlowNormalizedHash, generatedHash);
    assert.equal(attrs.VOICE_CONNECT_FLOW_NORMALIZED_HASH, generatedHash);
  }
});

test("voice release Lambda ZIP has index.mjs at root with matching hash", () => {
  const releaseId = `unit-release-${Date.now()}`;
  const releaseDir = path.join(repoRoot, "diagnostics/releases", releaseId);
  try {
    const artifact = packageLambdaArtifact({
      releaseId,
      sourceHash: computeSourceHash(repoRoot),
      variant: "unit"
    });
    const entries = execFileSync("unzip", ["-Z1", artifact.path], { encoding: "utf8" })
      .trim()
      .split(/\n+/);
    assert.deepEqual(entries, ["index.mjs"]);
    assert.equal(artifact.sha256, execFileSync("shasum", ["-a", "256", artifact.path], { encoding: "utf8" }).split(/\s+/)[0]);
  } finally {
    rmSync(releaseDir, { recursive: true, force: true });
  }
});

test("voice release failed readback aborts", () => {
  assert.throws(
    () =>
      assertReadbackMatchesManifest(
        {
          lambda: { codeSha256Base64: "actual" },
          lex: { botVersion: "52" },
          connect: { normalizedSha256: "flow", marker: "marker" }
        },
        {
          lambda: { codeSha256Base64: "expected" },
          lex: { botVersion: "52" },
          connect: { normalizedSha256: "flow", marker: "marker" }
        }
      ),
    /Readback did not match manifest/
  );
});

test("voice release Lex source keeps noisy Any staff repairs out of auto-resolving synonyms", () => {
  const staffType = JSON.parse(
    readFileSync(
      path.join(
        repoRoot,
        "infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/SlotTypes/StaffPreferenceType/SlotType.json"
      ),
      "utf8"
    )
  );
  const synonyms = new Set(
    staffType.slotTypeValues
      .find((entry) => entry.sampleValue?.value === "Any staff")
      .synonyms.map((synonym) => synonym.value.toLowerCase())
  );

  for (const phrase of ["any stop if i", "edit stop if i", "at least happy five", "i need stop if i"]) {
    assert.equal(synonyms.has(phrase), false, phrase);
  }
});

const releaseIdentity = {
  VOICE_RELEASE_ID: "voice-unit",
  VOICE_VARIANT: "canary",
  VOICE_SOURCE_SHA256: "source-hash",
  VOICE_CONNECT_FLOW_ID: "flow-canary",
  VOICE_CONNECT_MARKER: "voice-unit-canary",
  VOICE_LEX_ALIAS_ID: "ALIASNEW",
  VOICE_LEX_ALIAS_ARN: "arn:aws:lex:us-east-1:197452633989:bot-alias/KHMIXGA2US/ALIASNEW",
  VOICE_LEX_BOT_VERSION: "52",
  VOICE_LAMBDA_FUNCTION_NAME: "booking-handler-canary",
  VOICE_LAMBDA_FUNCTION_VERSION: "7",
  VOICE_LAMBDA_CODE_SHA256: "lambda-code",
  VOICE_API_RELEASE_ID: "voice-unit",
  VOICE_API_VARIANT: "canary"
};

const rawEvidence = ({ caseId = "C01", turns = [], serviceName = "Full Set", staffPreference = "Any staff" } = {}) => ({
  contactDetails: {
    Contact: {
      Id: `contact-${caseId}`,
      InitiationTimestamp: "2026-07-19T12:00:00Z"
    }
  },
  connectAttributes: {
    Attributes: {
      connectFlowSourceVersion: "voice-unit-canary",
      ...releaseIdentity
    }
  },
  appEvidence: {
    activeTestAppointmentCount: 0,
    releaseIdentities: [releaseIdentity]
  },
  debug: {
    turnHistories: turns.length
      ? turns
      : [
          {
            currentTurnTranscript: "Full Set tomorrow at 3 PM, any staff is fine",
            responseText: "Just to confirm: Full Set tomorrow at 3 PM with Any staff. Is that correct?",
            promptPlaybackConfirmed: true,
            lambdaProcessingMs: 120,
            apiProcessingMs: 220,
            callerTurnToPromptMs: 900,
            trustedSlotsAfter: {
              serviceName,
              requestedDate: "2026-07-20",
              requestedTime: "15:00",
              staffPreference
            },
            sessionAttributesAfter: {
              ...releaseIdentity,
              serviceName,
              requestedDate: "2026-07-20",
              requestedTime: "15:00",
              staffPreference
            },
            slotDecisions: [
              { slot: "serviceName", action: "accept", canonicalValue: serviceName, source: "exact_catalog" },
              { slot: "staffPreference", action: "accept", canonicalValue: staffPreference, source: "transcript" }
            ]
          }
        ],
    bookingAttempts: []
  }
});

test("voice release evaluator passes C01 from trusted raw evidence", () => {
  const evaluation = evaluateReleaseCase({
    releaseId: "voice-unit",
    caseId: "C01",
    rawEvidence: rawEvidence(),
    manifest: passingManifest()
  });
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.metrics.serviceCaptureResult.value, "DIRECT");
});

test("voice release evaluator passes C03 out-of-order Any staff retention", () => {
  const evaluation = evaluateReleaseCase({
    releaseId: "voice-unit",
    caseId: "C03",
    rawEvidence: rawEvidence({
      caseId: "C03",
      turns: [
        {
          currentTurnTranscript: "Any staff is fine",
          responseText: "What service would you like?",
          promptPlaybackConfirmed: true,
          lambdaProcessingMs: 100,
          apiProcessingMs: 130,
          callerTurnToPromptMs: 700,
          trustedSlotsAfter: { staffPreference: "Any staff" },
          sessionAttributesAfter: { ...releaseIdentity, staffPreference: "Any staff" },
          slotDecisions: [{ slot: "staffPreference", action: "accept", canonicalValue: "Any staff", source: "transcript" }]
        },
        {
          currentTurnTranscript: "I need a Full Set tomorrow at 3 PM",
          responseText: "Just to confirm: Full Set tomorrow at 3 PM with Any staff. Is that correct?",
          promptPlaybackConfirmed: true,
          lambdaProcessingMs: 110,
          apiProcessingMs: 150,
          callerTurnToPromptMs: 750,
          trustedSlotsAfter: {
            serviceName: "Full Set",
            requestedDate: "2026-07-20",
            requestedTime: "15:00",
            staffPreference: "Any staff"
          },
          sessionAttributesAfter: {
            ...releaseIdentity,
            serviceName: "Full Set",
            requestedDate: "2026-07-20",
            requestedTime: "15:00",
            staffPreference: "Any staff"
          }
        }
      ]
    }),
    manifest: passingManifest()
  });
  assert.equal(evaluation.passed, true);
});

test("voice release evaluator rejects unsafe safety false positives", () => {
  const s01 = evaluateReleaseCase({
    releaseId: "voice-unit",
    caseId: "S01",
    rawEvidence: rawEvidence({ caseId: "S01", serviceName: "Full Set", staffPreference: "" }),
    manifest: passingManifest()
  });
  assert.equal(s01.passed, false);
  assert.ok(s01.failures.includes("forbidden_service_resolved"));

  const s02 = evaluateReleaseCase({
    releaseId: "voice-unit",
    caseId: "S02",
    rawEvidence: rawEvidence({ caseId: "S02", serviceName: "", staffPreference: "Any staff" }),
    manifest: passingManifest()
  });
  assert.equal(s02.passed, false);
  assert.ok(s02.failures.includes("forbidden_staff_resolved"));
});

test("voice release evaluator catches silent turns, repeated menu, appointments before confirmation, and duplicates", () => {
  const evidence = rawEvidence({
    caseId: "C01",
    turns: [
      {
        currentTurnTranscript: "Full Set",
        responseText: "",
        promptPlaybackConfirmed: false,
        lambdaProcessingMs: 100,
        apiProcessingMs: 100,
        callerTurnToPromptMs: 1000,
        trustedSlotsAfter: { serviceName: "Full Set" },
        sessionAttributesAfter: releaseIdentity
      },
      {
        currentTurnTranscript: "tomorrow at 3",
        responseText: "Press 1 for Pedicure, press 4 for Full Set",
        promptPlaybackConfirmed: true,
        lambdaProcessingMs: 100,
        apiProcessingMs: 100,
        callerTurnToPromptMs: 1000,
        trustedSlotsAfter: { serviceName: "Full Set", requestedDate: "2026-07-20", requestedTime: "15:00", staffPreference: "Any staff" },
        sessionAttributesAfter: releaseIdentity
      },
      {
        currentTurnTranscript: "any staff",
        responseText: "Press 1 for Pedicure, press 4 for Full Set",
        promptPlaybackConfirmed: true,
        lambdaProcessingMs: 100,
        apiProcessingMs: 100,
        callerTurnToPromptMs: 1000,
        trustedSlotsAfter: { serviceName: "Full Set", requestedDate: "2026-07-20", requestedTime: "15:00", staffPreference: "Any staff" },
        sessionAttributesAfter: releaseIdentity
      }
    ]
  });
  evidence.debug.bookingAttempts = [
    { id: "attempt-1", appointmentId: "apt-1" },
    { id: "attempt-2", appointmentId: "apt-1" }
  ];
  const evaluation = evaluateReleaseCase({
    releaseId: "voice-unit",
    caseId: "C01",
    rawEvidence: evidence,
    manifest: passingManifest()
  });
  assert.equal(evaluation.metrics.silentTurnCount.value, 1);
  assert.equal(evaluation.metrics.repeatedLongMenuCount.value, 1);
  assert.equal(evaluation.metrics.appointmentBeforeFinalConfirmationCount.value, 1);
  assert.equal(evaluation.metrics.duplicateAppointmentCount.value, 1);
});

test("voice release gate fails closed for missing mandatory evidence", () => {
  const manifest = passingManifest();
  delete manifest.api;
  delete manifest.canaryAcceptance.cases[0].metrics.lambdaProcessingMs;
  manifest.canaryAcceptance.cases[1].observability.complete = false;
  manifest.canaryAcceptance.cases[2].cleanup = { state: "MISSING" };
  const gate = validatePromotionGate(manifest);
  assert.equal(gate.ok, false);
  assert.ok(gate.failures.includes("api_identity_missing"));
  assert.ok(gate.failures.includes("metric_missing:lambdaProcessingMs"));
  assert.ok(gate.failures.includes("observability_missing"));
  assert.ok(gate.failures.includes("cleanup_evidence_missing"));
});

const missingPstnManifest = () => {
  const manifest = passingManifest();
  manifest.canaryAcceptance = { cases: [] };
  return manifest;
};

const emergencyAuthorization = (manifest, overrides = {}) =>
  validateEmergencyPromotionAuthorization({
    manifest,
    acknowledgedReleaseId: manifest.releaseId,
    acknowledgedSourceCommit: manifest.sourceCommit,
    authorizationReason: "Owner-authorized audited emergency production promotion",
    identityValid: true,
    artifactsValid: true,
    canaryReadbackValid: true,
    sourceValidationPassed: true,
    rollbackSnapshotComplete: true,
    ...overrides
  });

test("voice release normal promotion gate remains blocked when PSTN evidence is missing", () => {
  const gate = validatePromotionGate(missingPstnManifest());
  assert.equal(gate.ok, false);
  assert.ok(gate.failures.includes("tester_diversity_missing"));
  assert.ok(gate.failures.includes("metric_missing:callerTurnToPromptMs"));
});

test("voice release emergency promotion requires every explicit acknowledgment", () => {
  const manifest = missingPstnManifest();
  assert.equal(emergencyAuthorization(manifest).ok, true);
  assert.ok(emergencyAuthorization(manifest, { acknowledgedReleaseId: "" }).failures.includes("release_acknowledgment_mismatch"));
  assert.ok(emergencyAuthorization(manifest, { acknowledgedSourceCommit: "" }).failures.includes("source_commit_acknowledgment_mismatch"));
  assert.ok(emergencyAuthorization(manifest, { authorizationReason: "" }).failures.includes("authorization_reason_missing"));
  assert.ok(emergencyAuthorization(manifest, { acknowledgedReleaseId: "wrong-release" }).failures.includes("release_acknowledgment_mismatch"));
  assert.ok(emergencyAuthorization(manifest, { acknowledgedSourceCommit: "0".repeat(40) }).failures.includes("source_commit_acknowledgment_mismatch"));
});

test("voice release emergency authorization cannot bypass identity artifact readback source or snapshot failures", () => {
  const manifest = missingPstnManifest();
  assert.ok(emergencyAuthorization(manifest, { identityValid: false }).failures.includes("aws_identity_invalid"));
  assert.ok(emergencyAuthorization(manifest, { artifactsValid: false }).failures.includes("accepted_artifact_mismatch"));
  assert.ok(emergencyAuthorization(manifest, { canaryReadbackValid: false }).failures.includes("canary_readback_mismatch"));
  assert.ok(emergencyAuthorization(manifest, { sourceValidationPassed: false }).failures.includes("source_validation_failed"));
  assert.ok(emergencyAuthorization(manifest, { rollbackSnapshotComplete: false }).failures.includes("rollback_snapshot_incomplete"));
});

test("voice release emergency authorization cannot bypass measured safety failures", () => {
  for (const [metricName, failure] of [
    ["wrongServiceAutoCommitCount", "wrong_service_auto_commit"],
    ["wrongStaffAutoCommitCount", "wrong_staff_auto_commit"],
    ["appointmentBeforeFinalConfirmationCount", "appointment_before_confirmation"],
    ["silentTurnCount", "silent_turn"],
    ["autoTransferWithoutRequestCount", "unauthorized_auto_transfer"],
    ["duplicateAppointmentCount", "duplicate_appointment"]
  ]) {
    const manifest = passingManifest();
    manifest.canaryAcceptance.cases[0].metrics[metricName] = metric(1);
    const authorization = emergencyAuthorization(manifest);
    assert.equal(authorization.ok, false, metricName);
    assert.ok(authorization.failures.includes(failure), metricName);
  }
});

test("voice release emergency authorization proceeds only when failures are missing PSTN evidence", () => {
  const authorization = emergencyAuthorization(missingPstnManifest());
  assert.equal(authorization.ok, true);
  assert.deepEqual(authorization.hardGateFailures, []);
  assert.ok(authorization.bypassedFailures.includes("observability_missing"));
  assert.ok(authorization.bypassedFailures.includes("cleanup_evidence_missing"));
});

test("voice release gate rejects duplicate contacts, duplicate round cases, one tester, and incomplete rounds", () => {
  const duplicateContact = passingManifest();
  duplicateContact.canaryAcceptance.cases[1].contactId = duplicateContact.canaryAcceptance.cases[0].contactId;
  assert.ok(validatePromotionGate(duplicateContact).failures.includes("duplicate_contact_id"));

  const duplicateRoundCase = passingManifest();
  duplicateRoundCase.canaryAcceptance.cases.push({ ...duplicateRoundCase.canaryAcceptance.cases[0], contactId: "new-contact" });
  assert.ok(validatePromotionGate(duplicateRoundCase).failures.includes("duplicate_case_round"));

  const oneTester = passingManifest();
  oneTester.canaryAcceptance.cases.forEach((item) => {
    item.testerHash = "same-tester";
  });
  assert.ok(validatePromotionGate(oneTester).failures.includes("tester_diversity_missing"));

  const incomplete = passingManifest();
  incomplete.canaryAcceptance.cases = incomplete.canaryAcceptance.cases.filter((item) => !(item.roundId === "round-2" && item.caseId === "C06"));
  assert.ok(validatePromotionGate(incomplete).failures.includes("round_incomplete"));
});

test("voice release readback keeps source hash and Lambda CodeSha256 separate", () => {
  assert.doesNotThrow(() =>
    assertReadbackMatchesManifest(
      {
        api: { runtimeReleaseId: "voice-unit", runtimeSourceSha256: "source-hash", imageId: "sha256:image" },
        lambda: { codeSha256Base64: "lambda-code" },
        lex: { botVersion: "52" },
        connect: { normalizedSha256: "flow", marker: "voice-unit-canary" }
      },
      {
        releaseId: "voice-unit",
        sourceHash: "source-hash",
        api: { releaseId: "voice-unit", apiSourceHash: "api-source", canaryReadback: { imageId: "sha256:image" } },
        lambda: { codeSha256Base64: "lambda-code" },
        lex: { botVersion: "52" },
        connect: { normalizedSha256: "flow", marker: "voice-unit-canary" }
      }
    )
  );
  assert.notEqual(computeApiSourceHash(repoRoot), "lambda-code");
});

test("voice release verify is listed and reachable from CLI parsing", () => {
  const result = spawnSync("bash", ["scripts/aws/deploy-voice-stack.sh"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /verify --release <release-id>/);
});
