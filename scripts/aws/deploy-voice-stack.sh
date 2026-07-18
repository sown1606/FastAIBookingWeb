#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/aws/deploy-voice-stack.sh --target canary --dry-run
  scripts/aws/deploy-voice-stack.sh --target canary
  scripts/aws/deploy-voice-stack.sh --target production --dry-run
  scripts/aws/deploy-voice-stack.sh --target production
EOF
}

TARGET=""
DRY_RUN="false"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --target)
      TARGET="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
done

if [ "$TARGET" != "canary" ] && [ "$TARGET" != "production" ]; then
  usage >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGETS_FILE="$ROOT/infra/aws/deployment/voice-stack.targets.json"
SOURCE_FLOW="$ROOT/infra/aws/connect/contact-flows/ai-reception.json"
VERIFY_SCRIPT="$ROOT/scripts/aws/verify-fastaibooking-aws-identity.sh"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
WORK_DIR="$ROOT/.tmp/voice-stack-deploy/$TIMESTAMP-$TARGET"
GENERATED_FLOW="$WORK_DIR/$TARGET-ai-reception.generated.json"
LIVE_META="$WORK_DIR/$TARGET-live-flow.json"
LIVE_CONTENT="$WORK_DIR/$TARGET-live-flow.content.json"
ROLLBACK_DIR="$ROOT/.tmp/voice-stack-rollback/$TIMESTAMP-$TARGET"

mkdir -p "$WORK_DIR"

identity_output="$("$VERIFY_SCRIPT")"
printf '%s\n' "$identity_output"

target_values="$(
  node - "$TARGETS_FILE" "$TARGET" <<'NODE'
const fs = require("node:fs");
const [targetsPath, target] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
const flow = data.connect?.flows?.[target];
const alias = data.lex?.aliases?.[target];
const lambdaFn = data.lambda?.functions?.[target];
if (!flow || !alias || !lambdaFn) {
  throw new Error(`Missing target configuration for ${target}`);
}
console.log([
  data.profile,
  data.region,
  data.accountId,
  data.expectedPrincipalArn,
  data.connect.instanceId,
  flow.id,
  flow.name,
  flow.marker,
  data.lex.botId,
  alias.id,
  alias.name,
  lambdaFn.name
].join("\t"));
NODE
)"

IFS=$'\t' read -r PROFILE REGION ACCOUNT_ID EXPECTED_ARN CONNECT_INSTANCE_ID FLOW_ID FLOW_NAME FLOW_MARKER LEX_BOT_ID LEX_ALIAS_ID LEX_ALIAS_NAME LAMBDA_FUNCTION_NAME <<EOF
$target_values
EOF

if [ "$PROFILE" != "nailnew" ] || [ "$REGION" != "us-east-1" ]; then
  printf 'Target config attempted to use unsupported AWS context: profile=%s region=%s\n' "$PROFILE" "$REGION" >&2
  exit 1
fi

ALIAS_ARN="arn:aws:lex:$REGION:$ACCOUNT_ID:bot-alias/$LEX_BOT_ID/$LEX_ALIAS_ID"

node - "$TARGETS_FILE" "$SOURCE_FLOW" "$GENERATED_FLOW" "$TARGET" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");
const [targetsPath, sourcePath, outputPath, target] = process.argv.slice(2);
const targets = JSON.parse(fs.readFileSync(targetsPath, "utf8"));
const flow = targets.connect.flows[target];
const alias = targets.lex.aliases[target];
const botId = targets.lex.botId;
const aliasArn = `arn:aws:lex:${targets.region}:${targets.accountId}:bot-alias/${botId}/${alias.id}`;
const content = JSON.parse(fs.readFileSync(sourcePath, "utf8"));

function walk(value, parentKey = "") {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, parentKey);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === "AliasArn" && typeof entry === "string" && entry.includes(`bot-alias/${botId}/`)) {
      value[key] = aliasArn;
    } else if (key === "connectFlowSourceVersion") {
      value[key] = flow.marker;
    } else if (key === "lexV2BotAliasName") {
      value[key] = alias.name;
    } else if (key === "displayName" && parentKey === "AliasArn") {
      value[key] = alias.name;
    }
    walk(value[key], key);
  }
}

function nextIds(action) {
  const transitions = action.Transitions ?? {};
  const ids = [];
  if (transitions.NextAction) {
    ids.push(transitions.NextAction);
  }
  for (const condition of transitions.Conditions ?? []) {
    if (condition.NextAction) {
      ids.push(condition.NextAction);
    }
  }
  for (const error of transitions.Errors ?? []) {
    if (error.NextAction) {
      ids.push(error.NextAction);
    }
  }
  return ids;
}

function collectReachable(content) {
  const actionsById = new Map(content.Actions.map((action) => [action.Identifier, action]));
  const reachable = new Set();
  const stack = [content.StartAction];
  while (stack.length) {
    const id = stack.pop();
    if (!id || reachable.has(id)) {
      continue;
    }
    const action = actionsById.get(id);
    if (!action) {
      continue;
    }
    reachable.add(id);
    for (const nextId of nextIds(action)) {
      stack.push(nextId);
    }
  }
  return { actionsById, reachable };
}

function isLiteralAudible(action) {
  if (!action || action.Type !== "MessageParticipant") {
    return false;
  }
  const text = action.Parameters?.Text;
  return typeof text === "string" && text.trim() && !text.trim().startsWith("$.");
}

function hasLiteralBeforeLex(startId, actionsById) {
  const queue = [{ id: startId, heard: false }];
  const seen = new Set();
  while (queue.length) {
    const { id, heard } = queue.shift();
    const key = `${id}:${heard ? "1" : "0"}`;
    if (!id || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const action = actionsById.get(id);
    if (!action) {
      continue;
    }
    if (action.Type === "ConnectParticipantWithLexBot" && !heard) {
      return false;
    }
    const nextHeard = heard || isLiteralAudible(action);
    if (nextHeard) {
      return true;
    }
    for (const nextId of nextIds(action)) {
      queue.push({ id: nextId, heard: nextHeard });
    }
  }
  return false;
}

walk(content);

const failures = [];
const { actionsById, reachable } = collectReachable(content);
if (!reachable.has(content.StartAction)) {
  failures.push(`StartAction ${content.StartAction} is unreachable`);
}

function inspect(value, path = "$") {
  if (!value || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspect(item, `${path}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key.includes("x-amz-lex:audio:max-length-ms")) {
      const parsed = Number(entry);
      if (!Number.isFinite(parsed) || parsed > 15000) {
        failures.push(`${path}.${key}=${entry} exceeds 15000`);
      }
    }
    if (key === "x-amz-lex:allow-interrupt:*:*" && String(entry).toLowerCase() === "true") {
      failures.push(`${path}.${key}=true uses unsafe wildcard barge-in`);
    }
    inspect(entry, `${path}.${key}`);
  }
}

inspect(content);

for (const id of reachable) {
  const action = actionsById.get(id);
  if (!action) {
    continue;
  }
  if (nextIds(action).includes(id)) {
    failures.push(`${id} self-loops`);
  }
  if (/recovery|lex-error|goodbye/i.test(id) && !reachable.has(id)) {
    failures.push(`${id} recovery action is unreachable`);
  }
  if (action.Type !== "ConnectParticipantWithLexBot") {
    continue;
  }
  const actionAliasArn = action.Parameters?.LexV2Bot?.AliasArn;
  if (actionAliasArn !== aliasArn) {
    failures.push(`${id} uses ${actionAliasArn ?? "missing alias"} instead of ${aliasArn}`);
  }
  if (/TSTALIASID|DRAFT/i.test(String(actionAliasArn))) {
    failures.push(`${id} uses draft/test Lex alias ${actionAliasArn}`);
  }
  for (const error of action.Transitions?.Errors ?? []) {
    if (!hasLiteralBeforeLex(error.NextAction, actionsById)) {
      failures.push(`${id} ${error.ErrorType} reaches Lex or terminal path without literal audible recovery`);
    }
  }
}

for (const action of content.Actions) {
  if (/recovery|lex-error|goodbye/i.test(action.Identifier) && !reachable.has(action.Identifier)) {
    failures.push(`${action.Identifier} recovery action is unreachable from StartAction`);
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}

fs.writeFileSync(outputPath, `${JSON.stringify(content, null, 2)}\n`);
const sha = crypto.createHash("sha256").update(JSON.stringify(content)).digest("hex");
console.log(JSON.stringify({
  target,
  flowId: flow.id,
  marker: flow.marker,
  aliasArn,
  normalizedSha256: sha,
  lexBlocks: content.Actions.filter((action) => action.Type === "ConnectParticipantWithLexBot").length
}, null, 2));
NODE

aws connect describe-contact-flow \
  --profile "$PROFILE" \
  --region "$REGION" \
  --instance-id "$CONNECT_INSTANCE_ID" \
  --contact-flow-id "$FLOW_ID" \
  --output json > "$LIVE_META"

node - "$LIVE_META" "$LIVE_CONTENT" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");
const [metaPath, outputPath] = process.argv.slice(2);
const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
const content = JSON.parse(meta.ContactFlow.Content);
fs.writeFileSync(outputPath, `${JSON.stringify(content, null, 2)}\n`);
console.log(JSON.stringify({
  liveFlowId: meta.ContactFlow.Id,
  liveStatus: meta.ContactFlow.Status,
  liveState: meta.ContactFlow.State,
  liveNormalizedSha256: crypto.createHash("sha256").update(JSON.stringify(content)).digest("hex")
}, null, 2));
NODE

generated_sha="$(node -e 'const crypto=require("node:crypto"),fs=require("node:fs"); const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(crypto.createHash("sha256").update(JSON.stringify(c)).digest("hex"));' "$GENERATED_FLOW")"
live_sha="$(node -e 'const crypto=require("node:crypto"),fs=require("node:fs"); const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); console.log(crypto.createHash("sha256").update(JSON.stringify(c)).digest("hex"));' "$LIVE_CONTENT")"

printf '\nDeployment plan\n'
printf '  target: %s\n' "$TARGET"
printf '  dryRun: %s\n' "$DRY_RUN"
printf '  flow: %s (%s)\n' "$FLOW_ID" "$FLOW_NAME"
printf '  marker: %s\n' "$FLOW_MARKER"
printf '  lexAlias: %s (%s)\n' "$LEX_ALIAS_ID" "$LEX_ALIAS_NAME"
printf '  lambda: %s\n' "$LAMBDA_FUNCTION_NAME"
printf '  liveSha256: %s\n' "$live_sha"
printf '  generatedSha256: %s\n' "$generated_sha"
printf '  generatedContent: %s\n' "$GENERATED_FLOW"

printf '\nRedacted flow diff preview\n'
if diff -u "$LIVE_CONTENT" "$GENERATED_FLOW" \
  | sed -E 's/\+[0-9][0-9 ().-]{7,}[0-9]/[REDACTED_PHONE]/g; s/\b[0-9]{10,15}\b/[REDACTED_PHONE]/g' \
  | sed -n '1,220p'; then
  true
fi

if [ "$DRY_RUN" = "true" ]; then
  printf '\nDry-run complete. No AWS writes performed.\n'
  exit 0
fi

if [ "$TARGET" = "production" ]; then
  ACCEPTANCE_MANIFEST="$ROOT/docs/P0_VOICE_FINAL_DEPLOYMENT_MANIFEST_2026-07-18.json"
  node - "$ACCEPTANCE_MANIFEST" <<'NODE'
const fs = require("node:fs");
const manifestPath = process.argv[2];
if (!fs.existsSync(manifestPath)) {
  console.error(`Refusing production deploy: missing acceptance manifest ${manifestPath}`);
  process.exit(1);
}
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const accepted =
  manifest.productionPromotionApproved === true &&
  manifest.canaryAcceptance?.criticalConsecutiveRoundsPassed >= 3 &&
  manifest.canaryAcceptance?.extendedMatrixPassed === true &&
  manifest.canaryAcceptance?.observabilityCaptured === true &&
  manifest.canaryAcceptance?.activeAppointmentCountFor4886 === 0;
if (!accepted) {
  console.error("Refusing production deploy: canary acceptance gates are not complete in the manifest.");
  process.exit(1);
}
NODE
fi

mkdir -p "$ROLLBACK_DIR"
cp "$LIVE_META" "$ROLLBACK_DIR/$TARGET-contact-flow-before.json"
aws lexv2-models describe-bot-alias \
  --profile "$PROFILE" \
  --region "$REGION" \
  --bot-id "$LEX_BOT_ID" \
  --bot-alias-id "$LEX_ALIAS_ID" \
  --output json > "$ROLLBACK_DIR/$TARGET-lex-alias-before.json"
aws lambda get-function-configuration \
  --profile "$PROFILE" \
  --region "$REGION" \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --query '{FunctionName:FunctionName,CodeSha256:CodeSha256,RevisionId:RevisionId,Runtime:Runtime,Handler:Handler,Timeout:Timeout,MemorySize:MemorySize,Architectures:Architectures,LastModified:LastModified}' \
  --output json > "$ROLLBACK_DIR/$TARGET-lambda-config-before.json"

printf '\nRollback snapshot: %s\n' "$ROLLBACK_DIR"

aws connect update-contact-flow-content \
  --profile "$PROFILE" \
  --region "$REGION" \
  --instance-id "$CONNECT_INSTANCE_ID" \
  --contact-flow-id "$FLOW_ID" \
  --content "file://$GENERATED_FLOW" >/dev/null

aws connect describe-contact-flow \
  --profile "$PROFILE" \
  --region "$REGION" \
  --instance-id "$CONNECT_INSTANCE_ID" \
  --contact-flow-id "$FLOW_ID" \
  --output json > "$WORK_DIR/$TARGET-live-flow-after.json"

after_sha="$(
  node - "$WORK_DIR/$TARGET-live-flow-after.json" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");
const meta = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const content = JSON.parse(meta.ContactFlow.Content);
console.log(crypto.createHash("sha256").update(JSON.stringify(content)).digest("hex"));
NODE
)"

if [ "$after_sha" != "$generated_sha" ]; then
  printf 'Deploy verification failed: expected %s, got %s\n' "$generated_sha" "$after_sha" >&2
  exit 1
fi

printf 'Deployment complete: target=%s flow=%s sha256=%s rollback=%s\n' \
  "$TARGET" "$FLOW_ID" "$after_sha" "$ROLLBACK_DIR"
