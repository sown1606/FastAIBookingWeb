#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  CASE_DEFINITIONS,
  CRITICAL_CASE_IDS,
  MANDATORY_METRICS,
  SAFETY_CASE_IDS,
  isKnownReleaseCase
} from "./voice-release-cases.mjs";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), "../..");
const TARGETS_FILE = path.join(ROOT, "infra/aws/deployment/voice-stack.targets.json");
const SOURCE_FLOW = path.join(ROOT, "infra/aws/connect/contact-flows/ai-reception.json");
const LAMBDA_SOURCE = path.join(ROOT, "infra/lambda/booking-handler/index.mjs");
const LEX_ROOT = path.join(ROOT, "infra/aws/lex/FastAIBookingBot-v10");
const LOCALE_ROOT = path.join(LEX_ROOT, "BotLocales/en_US");
const VERIFY_SCRIPT = path.join(ROOT, "scripts/aws/verify-fastaibooking-aws-identity.sh");
const RELEASES_ROOT = path.join(ROOT, "diagnostics/releases");
const RELEASE_SCHEMA_VERSION = "fastaibooking.voice-release.v2";
const OLD_PRODUCTION_MARKER = "2026-07-17-thuyet-voice-hotfix";
const OLD_PRODUCTION_LEX_VERSION = "41";
const EMERGENCY_AUTHORIZATION_FILE = "emergency-production-authorization.json";
const REQUIRED_CUSTOM_VOCABULARY = [
  "Full Set",
  "Fullset",
  "Nail full set",
  "Pedicure",
  "Manicure",
  "Gel Manicure",
  "Any staff",
  "Any staff is fine",
  "First available",
  "No preference"
];
const FORBIDDEN_REPAIR_VOCABULARY = [
  "pool set",
  "phone set",
  "food set",
  "set tomorrow",
  "and it's top",
  "and it's not a fight",
  "at least happy five",
  "i need stop if i"
];
const SOURCE_HASH_FILES = [
  "infra/lambda/booking-handler/index.mjs",
  "apps/api/src/modules/ai/ai.service.ts",
  "apps/api/src/modules/ai/ai.routes.ts",
  "apps/api/src/modules/health/health.routes.ts",
  "apps/api/src/config/env.ts",
  "apps/api/Dockerfile",
  ".dockerignore",
  "docker-compose.yml",
  "infra/nginx/default.conf",
  "infra/nginx/default-ssl.conf",
  "infra/aws/connect/contact-flows/ai-reception.json",
  "infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/BotLocale.json",
  "infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/CustomVocabulary.json",
  "infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/BookAppointmentIntent/Intent.json",
  "infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/CancelAppointmentIntent/Intent.json",
  "infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/FallbackIntent/Intent.json",
  "infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/HumanEscalationIntent/Intent.json",
  "infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/RescheduleAppointmentIntent/Intent.json",
  "infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/SlotTypes/NailServiceType/SlotType.json",
  "infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/SlotTypes/StaffPreferenceType/SlotType.json"
];
const API_SOURCE_HASH_FILES = [
  "apps/api/package.json",
  "apps/api/tsconfig.json",
  "apps/api/Dockerfile",
  "apps/api/src/app.ts",
  "apps/api/src/server.ts",
  "apps/api/src/config/env.ts",
  "apps/api/src/modules/ai/ai.service.ts",
  "apps/api/src/modules/ai/ai.routes.ts",
  "apps/api/src/modules/health/health.routes.ts",
  ".dockerignore",
  "docker-compose.yml",
  "infra/nginx/default.conf",
  "infra/nginx/default-ssl.conf"
];
const SOURCE_GATE_COMMANDS = [
  ["npx", ["npm@10", "ci"]],
  ["npm", ["--prefix", "apps/api", "run", "prisma:generate"]],
  ["npm", ["run", "test:lambda"]],
  ["npm", ["run", "test:api"]],
  ["npm", ["run", "typecheck:api"]],
  ["npm", ["run", "typecheck:admin"]],
  ["npm", ["run", "typecheck:app"]],
  ["npm", ["run", "build:api"]],
  ["npm", ["run", "build:admin"]],
  ["npm", ["run", "build:app"]],
  ["node", ["scripts/secret-scan.mjs"]],
  ["git", ["diff", "--check"]]
];

class ReleaseError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ReleaseError";
    this.details = details;
  }
}

class AwsOperationError extends ReleaseError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "AwsOperationError";
  }
}

class ExternalPermissionError extends ReleaseError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "ExternalPermissionError";
  }
}

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

const pick = (value, ...keys) => {
  for (const key of keys) {
    if (value?.[key] !== undefined) {
      return value[key];
    }
  }
  return undefined;
};

const lexLocaleStatus = (locale) => pick(locale, "botLocaleStatus", "BotLocaleStatus");
const lexAliasIdFrom = (alias) => pick(alias, "botAliasId", "BotAliasId");
const lexAliasNameFrom = (alias) => pick(alias, "botAliasName", "BotAliasName");
const lexAliasBotVersionFrom = (alias) => pick(alias, "botVersion", "BotVersion");
const lexAliasLocaleSettingsFrom = (alias) => pick(alias, "botAliasLocaleSettings", "BotAliasLocaleSettings");

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const writeText = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${value.trimEnd()}\n`);
};

const sha256Buffer = (buffer, encoding = "hex") =>
  crypto.createHash("sha256").update(buffer).digest(encoding);

const sha256File = (filePath, encoding = "hex") => sha256Buffer(fs.readFileSync(filePath), encoding);

const sha256Json = (value) => sha256Buffer(Buffer.from(JSON.stringify(value)), "hex");

const CONNECT_FLOW_HASH_ATTRIBUTE_KEYS = new Set([
  "connectFlowNormalizedHash",
  "VOICE_CONNECT_FLOW_NORMALIZED_HASH"
]);

const withoutConnectFlowHashAttributes = (value) => {
  if (Array.isArray(value)) {
    return value.map((entry) => withoutConnectFlowHashAttributes(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !CONNECT_FLOW_HASH_ATTRIBUTE_KEYS.has(key))
      .map(([key, entry]) => [key, withoutConnectFlowHashAttributes(entry)])
  );
};

export const connectFlowNormalizedSha256 = (content) =>
  sha256Json(withoutConnectFlowHashAttributes(content));

const setConnectFlowHashAttributes = (content, normalizedHash) => {
  const walk = (value) => {
    if (!value || typeof value !== "object") {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value.LexSessionAttributes && typeof value.LexSessionAttributes === "object") {
      value.LexSessionAttributes.connectFlowNormalizedHash = normalizedHash;
      value.LexSessionAttributes.VOICE_CONNECT_FLOW_NORMALIZED_HASH = normalizedHash;
    }
    if (value.Attributes && typeof value.Attributes === "object") {
      value.Attributes.connectFlowNormalizedHash = normalizedHash;
      value.Attributes.VOICE_CONNECT_FLOW_NORMALIZED_HASH = normalizedHash;
    }
    Object.values(value).forEach(walk);
  };
  walk(content);
};

const safeAliasName = (value) =>
  String(value)
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 90);

const nowUtcStamp = () =>
  new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

export function computeSourceHash(root = ROOT, files = SOURCE_HASH_FILES) {
  const entries = files.map((relativePath) => {
    const bytes = fs.readFileSync(path.join(root, relativePath));
    return {
      path: relativePath,
      sha256: sha256Buffer(bytes)
    };
  });
  return sha256Json(entries);
}

export function computeApiSourceHash(root = ROOT, files = API_SOURCE_HASH_FILES) {
  return computeSourceHash(root, files);
}

export function computeDirtyTreeHash() {
  const diff = run("git", ["diff", "--binary"]).stdout;
  const staged = run("git", ["diff", "--cached", "--binary"]).stdout;
  const untracked = run("git", ["ls-files", "--others", "--exclude-standard"]).stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((relativePath) => ({
      path: relativePath,
      sha256: fs.existsSync(path.join(ROOT, relativePath)) && fs.statSync(path.join(ROOT, relativePath)).isFile()
        ? sha256File(path.join(ROOT, relativePath))
        : null
    }));
  const payload = JSON.stringify({ diff, staged, untracked });
  return sha256Buffer(Buffer.from(payload), "hex");
}

export function createReleaseId({ timestamp = nowUtcStamp(), sourceHash = computeSourceHash() } = {}) {
  return `voice-${timestamp}-${sourceHash.slice(0, 12)}`;
}

const resolveReleaseId = (requestedReleaseId) =>
  requestedReleaseId || createReleaseId();

const releaseDirFor = (releaseId) => path.join(RELEASES_ROOT, releaseId);

const readTargets = () => readJson(TARGETS_FILE);

const loadExistingManifest = (releaseId) => {
  const manifestPath = path.join(releaseDirFor(releaseId), "manifest.json");
  return fs.existsSync(manifestPath) ? readJson(manifestPath) : null;
};

const writeReleaseFile = (releaseId, name, value) =>
  writeJson(path.join(releaseDirFor(releaseId), name), value);

const appendReleaseOperation = (releaseId, entry) => {
  if (!releaseId) return;
  const operationPath = path.join(releaseDirFor(releaseId), "operation-log.json");
  const current = fs.existsSync(operationPath) ? readJson(operationPath) : [];
  const next = [
    ...(Array.isArray(current) ? current : []),
    {
      at: new Date().toISOString(),
      ...entry
    }
  ];
  writeJson(operationPath, next);
  updateManifest(releaseId, { operationLog: next });
};

const updateManifest = (releaseId, patch) => {
  const manifestPath = path.join(releaseDirFor(releaseId), "manifest.json");
  const current = fs.existsSync(manifestPath) ? readJson(manifestPath) : {};
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString()
  };
  writeJson(manifestPath, next);
  return next;
};

const targetConfig = (targets, target) => {
  const flow = targets.connect?.flows?.[target];
  const alias = targets.lex?.aliases?.[target];
  const lambdaFn = targets.lambda?.functions?.[target];
  if (!flow || !alias || !lambdaFn) {
    throw new ReleaseError(`Missing target configuration for ${target}`);
  }
  return { flow, alias, lambdaFn };
};

const lexAliasArn = (targets, aliasId) =>
  `arn:aws:lex:${targets.region}:${targets.accountId}:bot-alias/${targets.lex.botId}/${aliasId}`;

const lambdaAliasArn = (targets, functionName, aliasName) =>
  `arn:aws:lambda:${targets.region}:${targets.accountId}:function:${functionName}:${aliasName}`;

const normalizeResolutionStrategy = (value) => {
  if (value === "TOP_RESOLUTION") {
    return "TopResolution";
  }
  if (value === "ORIGINAL_VALUE") {
    return "OriginalValue";
  }
  return value;
};

const normalizedSlotTypeInput = (sourceSlotType) => {
  const valueSelectionSetting = sourceSlotType.valueSelectionSetting
    ? {
        ...sourceSlotType.valueSelectionSetting,
        resolutionStrategy: normalizeResolutionStrategy(sourceSlotType.valueSelectionSetting.resolutionStrategy)
      }
    : undefined;
  if (valueSelectionSetting?.regexFilter === null) {
    delete valueSelectionSetting.regexFilter;
  }
  return {
    slotTypeId: sourceSlotType.identifier,
    slotTypeName: sourceSlotType.name,
    ...(sourceSlotType.description ? { description: sourceSlotType.description } : {}),
    ...(sourceSlotType.slotTypeValues ? { slotTypeValues: sourceSlotType.slotTypeValues } : {}),
    ...(valueSelectionSetting ? { valueSelectionSetting } : {}),
    ...(sourceSlotType.parentSlotTypeSignature
      ? { parentSlotTypeSignature: sourceSlotType.parentSlotTypeSignature }
      : {})
  };
};

const parseAwsErrorCode = (stderr) => {
  const match = String(stderr || "").match(/\(([^)]+)\)/);
  return match?.[1] || "unknown";
};

const isPermissionError = (code) =>
  /AccessDenied|Unauthorized|UnrecognizedClient|ExpiredToken|InvalidClientToken|Forbidden/i.test(code);

const hmac = (key, value, encoding) =>
  crypto.createHmac("sha256", key).update(value).digest(encoding);

const signatureKey = (secretAccessKey, dateStamp, region, service) => {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, "aws4_request");
};

function awsExportedCredentials(targets) {
  const result = run("aws", [
    "configure",
    "export-credentials",
    "--profile",
    targets.profile,
    "--format",
    "env-no-export"
  ]);
  requireCommandSuccess(result, { operation: "aws:configure:export-credentials" });
  const parsed = {};
  for (const line of result.stdout.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) {
      continue;
    }
    parsed[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  const credentials = {
    AccessKeyId: parsed.AWS_ACCESS_KEY_ID,
    SecretAccessKey: parsed.AWS_SECRET_ACCESS_KEY,
    SessionToken: parsed.AWS_SESSION_TOKEN
  };
  if (!credentials.AccessKeyId || !credentials.SecretAccessKey) {
    throw new ReleaseError("AWS profile did not provide signable credentials");
  }
  return credentials;
}

function signedAwsHttpJson(targets, { service, endpointPrefix, method, requestPath, body = null, details = {} }) {
  const credentials = awsExportedCredentials(targets);
  const host = `${endpointPrefix}.${targets.region}.amazonaws.com`;
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payload = body === null ? "" : JSON.stringify(body);
  const payloadHash = sha256Buffer(Buffer.from(payload), "hex");
  const headers = {
    "content-type": "application/json",
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate
  };
  if (credentials.SessionToken) {
    headers["x-amz-security-token"] = credentials.SessionToken;
  }
  const signedHeaders = Object.keys(headers).sort().join(";");
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((name) => `${name}:${headers[name]}\n`)
    .join("");
  const canonicalRequest = [
    method,
    requestPath,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join("\n");
  const credentialScope = `${dateStamp}/${targets.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Buffer(Buffer.from(canonicalRequest), "hex")
  ].join("\n");
  const signature = hmac(
    signatureKey(credentials.SecretAccessKey, dateStamp, targets.region, service),
    stringToSign,
    "hex"
  );
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${credentials.AccessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`
  ].join(", ");
  const curlArgs = [
    "--silent",
    "--show-error",
    "--fail-with-body",
    "--connect-timeout",
    "10",
    "--max-time",
    "60",
    "--request",
    method,
    `https://${host}${requestPath}`,
    "--header",
    `Authorization: ${authorization}`
  ];
  for (const [name, value] of Object.entries(headers)) {
    curlArgs.push("--header", `${name}: ${value}`);
  }
  if (payload) {
    curlArgs.push("--data-binary", payload);
  }
  const result = run("curl", curlArgs);
  if (result.status !== 0) {
    const code = parseAwsErrorCode(result.stderr) || "HttpRequestFailed";
    throw new AwsOperationError(`AWS ${service} raw HTTP ${method} failed`, {
      service,
      operation: details.operation || `${method} ${requestPath}`,
      code,
      permissionError: isPermissionError(code),
      stderr: `${result.stderr}${result.stdout ? `\n${result.stdout}` : ""}`.slice(0, 4000),
      ...details
    });
  }
  const text = result.stdout.trim();
  if (!text) {
    return null;
  }
  const parsed = JSON.parse(text);
  if (parsed.__type || parsed.code || parsed.Code || parsed.message || parsed.Message) {
    const code = String(parsed.__type || parsed.code || parsed.Code || "ServiceError").split("#").pop();
    throw new AwsOperationError(`AWS ${service} raw HTTP ${method} failed`, {
      service,
      operation: details.operation || `${method} ${requestPath}`,
      code,
      permissionError: isPermissionError(code),
      stderr: JSON.stringify(parsed).slice(0, 4000),
      ...details
    });
  }
  return parsed;
}

function lexLocalePath(targets, botVersion = "DRAFT") {
  return `/bots/${encodeURIComponent(targets.lex.botId)}/botversions/${encodeURIComponent(botVersion)}/botlocales/en_US/`;
}

function describeLexLocaleRaw(targets, botVersion = "DRAFT") {
  return signedAwsHttpJson(targets, {
    service: "lex",
    endpointPrefix: "models-v2-lex",
    method: "GET",
    requestPath: lexLocalePath(targets, botVersion),
    details: {
      operation: "lex:DescribeBotLocaleRaw",
      resourceArn: `arn:aws:lex:${targets.region}:${targets.accountId}:bot/${targets.lex.botId}`,
      requiredAction: "lex:DescribeBotLocale"
    }
  });
}

function updateLexLocaleSpeechSettings(targets, localeSource) {
  const current = describeLexLocaleRaw(targets, "DRAFT");
  const body = {
    ...(current.description ? { description: current.description } : {}),
    nluIntentConfidenceThreshold: Number(localeSource.nluConfidenceThreshold ?? current.nluIntentConfidenceThreshold ?? 0.4),
    ...(current.voiceSettings ? { voiceSettings: current.voiceSettings } : {}),
    ...(current.generativeAISettings ? { generativeAISettings: current.generativeAISettings } : {}),
    ...(localeSource.audioFillerSettings
      ? { audioFillerSettings: localeSource.audioFillerSettings }
      : {}),
    ...(localeSource.unifiedSpeechSettings
      ? { unifiedSpeechSettings: localeSource.unifiedSpeechSettings }
      : {}),
    ...(!localeSource.unifiedSpeechSettings && localeSource.speechRecognitionSettings
      ? { speechRecognitionSettings: localeSource.speechRecognitionSettings }
      : {}),
    speechDetectionSensitivity: localeSource.speechDetectionSensitivity || "Default"
  };
  return signedAwsHttpJson(targets, {
    service: "lex",
    endpointPrefix: "models-v2-lex",
    method: "PUT",
    requestPath: lexLocalePath(targets, "DRAFT"),
    body,
    details: {
      operation: "lex:UpdateBotLocaleRaw",
      resourceArn: `arn:aws:lex:${targets.region}:${targets.accountId}:bot/${targets.lex.botId}`,
      requiredAction: "lex:UpdateBotLocale"
    }
  });
}

const run = (cmd, args, options = {}) => {
  const rootBin = path.join(ROOT, "node_modules", ".bin");
  const optionEnv = options.env || {};
  const optionPath = optionEnv.PATH || process.env.PATH || "";
  const env = {
    ...process.env,
    ...optionEnv,
    PATH: [rootBin, optionPath].filter(Boolean).join(path.delimiter)
  };
  const spawnOptions = {
    ...options
  };
  delete spawnOptions.env;
  const result = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 50,
    ...spawnOptions,
    env
  });
  return {
    cmd,
    args,
    status: result.status,
    signal: result.signal,
    error: result.error?.message || "",
    stdout: result.stdout || "",
    stderr: result.stderr || ""
  };
};

function requireCommandSuccess(result, details = {}) {
  if (result.status === 0) {
    return result;
  }
  throw new ReleaseError(`${result.cmd} ${result.args.join(" ")} failed`, {
    ...details,
    exitCode: result.status,
    stderr: result.stderr.slice(0, 4000)
  });
}

function verifyIdentity(targets) {
  const result = run("bash", [VERIFY_SCRIPT]);
  requireCommandSuccess(result, { operation: "aws:verify-identity" });
  const output = result.stdout.trim();
  if (!output.includes("profile=nailnew") || !output.includes("region=us-east-1")) {
    throw new ReleaseError("AWS identity guard failed: unsupported profile or region", { output });
  }
  if (!output.includes(`account=${targets.accountId}`) || !output.includes(`principal=${targets.expectedPrincipalArn}`)) {
    throw new ReleaseError("AWS identity guard failed: unexpected account or principal", { output });
  }
  return output;
}

function awsJson(targets, service, operation, args = [], details = {}) {
  if (/^(update-|create-|publish-|add-|associate-|build-|batch-)/.test(operation)) {
    verifyIdentity(targets);
  }
  const fullArgs = [
    service,
    operation,
    ...args,
    "--profile",
    targets.profile,
    "--region",
    targets.region,
    "--output",
    "json",
    "--no-cli-pager"
  ];
  const result = run("aws", fullArgs);
  if (result.status !== 0) {
    const code = parseAwsErrorCode(result.stderr);
    throw new AwsOperationError(`AWS ${service} ${operation} failed`, {
      service,
      operation,
      code,
      permissionError: isPermissionError(code),
      stderr: result.stderr.slice(0, 4000),
      ...details
    });
  }
  const text = result.stdout.trim();
  return text ? JSON.parse(text) : null;
}

function awsRaw(targets, service, operation, args = [], details = {}) {
  const fullArgs = [
    service,
    operation,
    ...args,
    "--profile",
    targets.profile,
    "--region",
    targets.region,
    "--no-cli-pager"
  ];
  const result = run("aws", fullArgs);
  if (result.status !== 0) {
    const code = parseAwsErrorCode(result.stderr);
    throw new AwsOperationError(`AWS ${service} ${operation} failed`, {
      service,
      operation,
      code,
      permissionError: isPermissionError(code),
      stderr: result.stderr.slice(0, 4000),
      ...details
    });
  }
  return result.stdout.trim();
}

const sanitizeLambdaConfig = (config) => {
  if (!config) {
    return null;
  }
  const { Environment, ...rest } = config;
  const environment = Environment?.Variables || {};
  const secretNamePattern = /(SECRET|TOKEN|PASSWORD|KEY|CREDENTIAL|PRIVATE)/i;
  return {
    ...rest,
    configurationFingerprint: sha256Json({
      runtime: config.Runtime,
      handler: config.Handler,
      timeout: config.Timeout,
      memorySize: config.MemorySize,
      architectures: config.Architectures || [],
      layers: (config.Layers || []).map((layer) => layer.Arn),
      vpcConfig: config.VpcConfig || {},
      environmentKeyNames: Object.keys(environment).sort(),
      apiBaseUrlHost: environment.FASTAIBOOKING_API_BASE_URL
        ? new URL(environment.FASTAIBOOKING_API_BASE_URL).host
        : ""
    }),
    releaseEnvironment: {
      VOICE_RELEASE_ID: environment.VOICE_RELEASE_ID || "",
      VOICE_SOURCE_SHA256: environment.VOICE_SOURCE_SHA256 || "",
      VOICE_VARIANT: environment.VOICE_VARIANT || "",
      VOICE_LAMBDA_CODE_SHA256: environment.VOICE_LAMBDA_CODE_SHA256 || "",
      VOICE_API_RELEASE_ID: environment.VOICE_API_RELEASE_ID || "",
      VOICE_API_VARIANT: environment.VOICE_API_VARIANT || "",
      FASTAIBOOKING_API_BASE_URL: environment.FASTAIBOOKING_API_BASE_URL || ""
    },
    environmentKeyNames: Object.keys(environment).sort(),
    redactedEnvironment: Object.fromEntries(
      Object.entries(environment)
        .filter(([key]) => key.startsWith("VOICE_") || key.startsWith("FASTAIBOOKING_API_"))
        .map(([key, value]) => [key, secretNamePattern.test(key) ? "[redacted]" : value])
    )
  };
};

const safeUrlJoin = (base, suffix) => `${String(base).replace(/\/+$/, "")}${suffix}`;

const defaultEc2Config = () => ({
  host: process.env.EC2_HOST || "32.194.150.135",
  user: process.env.EC2_USER || "ubuntu",
  key: process.env.EC2_KEY || path.join(ROOT, "fastAibooking.pem"),
  appDir: process.env.EC2_APP_DIR || "/home/ubuntu/fastAibooking",
  publicApiBaseUrl: process.env.FASTAIBOOKING_PUBLIC_API_BASE_URL || "https://api-new-nail.kendemo.com"
});

function assertSshAvailable(ec2 = defaultEc2Config()) {
  if (!fs.existsSync(ec2.key)) {
    throw new ExternalPermissionError("EC2 SSH key is missing; cannot deploy or read back API containers", {
      operation: "ssh:connect",
      resource: `${ec2.user}@${ec2.host}:${ec2.appDir}`,
      requiredPermission: `SSH private key at ${ec2.key} with access to ${ec2.user}@${ec2.host}`
    });
  }
}

const shellQuote = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;

function sshRun(args, { input = null, details = {} } = {}) {
  const ec2 = defaultEc2Config();
  assertSshAvailable(ec2);
  const remoteArgs =
    args.length >= 3 && args[0] === "bash" && args[1] === "-lc"
      ? [`bash -lc ${shellQuote(args.slice(2).join(" "))}`]
      : args;
  const result = run("ssh", [
    "-i",
    ec2.key,
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=15",
    `${ec2.user}@${ec2.host}`,
    ...remoteArgs
  ], input ? { input } : {});
  if (result.status !== 0) {
    throw new ExternalPermissionError("EC2 SSH operation failed", {
      operation: details.operation || "ssh",
      resource: `${ec2.user}@${ec2.host}:${ec2.appDir}`,
      requiredPermission: "SSH access and Docker permissions on the EC2 host",
      stderr: result.stderr.slice(0, 4000)
    });
  }
  return result.stdout.trim();
}

function rsyncSourceToEc2(releaseId) {
  const ec2 = defaultEc2Config();
  assertSshAvailable(ec2);
  appendReleaseOperation(releaseId, {
    action: "api:rsync-source",
    target: `${ec2.user}@${ec2.host}:${ec2.appDir}`,
    status: "started"
  });
  const result = run("rsync", [
    "-az",
    "--delete",
    "-e",
    `ssh -i ${ec2.key} -o StrictHostKeyChecking=accept-new`,
    "--exclude",
    ".git",
    "--exclude",
    ".idea",
    "--exclude",
    ".tmp",
    "--exclude",
    "diagnostics",
    "--exclude",
    "logs",
    "--exclude",
    ".env",
    "--exclude",
    "secrets",
    "--exclude",
    "*.pem",
    "--exclude",
    "*.zip",
    "--exclude",
    "node_modules",
    "--exclude",
    "apps/*/node_modules",
    `${ROOT}/`,
    `${ec2.user}@${ec2.host}:${ec2.appDir}/`
  ]);
  if (result.status !== 0) {
    appendReleaseOperation(releaseId, {
      action: "api:rsync-source",
      target: `${ec2.user}@${ec2.host}:${ec2.appDir}`,
      status: "failed"
    });
    throw new ExternalPermissionError("EC2 source sync failed", {
      operation: "rsync:source",
      resource: `${ec2.user}@${ec2.host}:${ec2.appDir}`,
      requiredPermission: "SSH and rsync write access to the EC2 app directory",
      stderr: result.stderr.slice(0, 4000)
    });
  }
  appendReleaseOperation(releaseId, {
    action: "api:rsync-source",
    target: `${ec2.user}@${ec2.host}:${ec2.appDir}`,
    status: "completed"
  });
}

function remoteJson(command, details = {}) {
  const output = sshRun(["bash", "-lc", command], { details });
  return output ? JSON.parse(output) : null;
}

function readRemoteEnvValue(key) {
  const ec2 = defaultEc2Config();
  const output = sshRun([
    "bash",
    "-lc",
    `cd ${JSON.stringify(ec2.appDir)} && python3 - <<'PY'
import os
import sys

key = ${JSON.stringify(key)}
env_path = ".env"
value = ""

if os.path.exists(env_path):
    with open(env_path, "r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            name, entry = line.split("=", 1)
            if name.strip() != key:
                continue
            entry = entry.strip()
            if len(entry) >= 2 and entry[0] == entry[-1] and entry[0] in ("'", '"'):
                entry = entry[1:-1]
            value = entry
            break

sys.stdout.write(value)
PY`
  ], { details: { operation: "ec2:read-env-value" } });
  return output.trim();
}

function readApiInternalTokenFromEc2() {
  const token = readRemoteEnvValue("FASTAIBOOKING_API_INTERNAL_TOKEN");
  if (!token) {
    throw new ReleaseError("EC2 API internal token is missing; cannot keep Lambda/API canary parity", {
      reason: "api_internal_token_missing",
      source: ".env"
    });
  }
  return token;
}

export function packageLambdaArtifact({ releaseId, sourceHash, variant }) {
  const releaseDir = releaseDirFor(releaseId);
  const stagingDir = path.join(releaseDir, "lambda-staging");
  const zipPath = path.join(releaseDir, `${releaseId}-${variant}-booking-handler.zip`);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.copyFileSync(LAMBDA_SOURCE, path.join(stagingDir, "index.mjs"));
  const fixedTime = new Date("2024-01-01T00:00:00Z");
  fs.utimesSync(path.join(stagingDir, "index.mjs"), fixedTime, fixedTime);
  fs.rmSync(zipPath, { force: true });
  execFileSync("zip", ["-X", "-q", zipPath, "index.mjs"], { cwd: stagingDir });
  const listing = execFileSync("unzip", ["-Z1", zipPath], { encoding: "utf8" }).trim().split(/\n+/);
  fs.rmSync(stagingDir, { recursive: true, force: true });
  if (listing.length !== 1 || listing[0] !== "index.mjs") {
    throw new ReleaseError("Lambda ZIP must contain only index.mjs at the root", { listing });
  }
  const artifact = {
    releaseId,
    variant,
    path: zipPath,
    sourcePath: LAMBDA_SOURCE,
    sourceHash,
    sha256: sha256File(zipPath, "hex"),
    codeSha256Base64: sha256File(zipPath, "base64"),
    rootEntries: listing
  };
  writeReleaseFile(releaseId, "lambda-artifact.json", artifact);
  return artifact;
}

function readbackApiContainer({ releaseId, variant, serviceName, containerName, baseUrl, imageTag }) {
  const ec2 = defaultEc2Config();
  const remote = remoteJson(
    `python3 - <<'PY'
import json
import subprocess

container = ${JSON.stringify(containerName)}
image_tag = ${JSON.stringify(imageTag)}

def out(args):
    try:
        return subprocess.check_output(args, text=True).strip()
    except Exception:
        return ""

repo_digests_raw = out(["docker", "image", "inspect", image_tag, "--format", "{{json .RepoDigests}}"]) or "[]"
try:
    repo_digests = json.loads(repo_digests_raw)
except Exception:
    repo_digests = []

print(json.dumps({
    "container": container,
    "serviceName": ${JSON.stringify(serviceName)},
    "imageTag": image_tag,
    "containerImageId": out(["docker", "inspect", container, "--format", "{{.Image}}"]),
    "configuredImage": out(["docker", "inspect", container, "--format", "{{.Config.Image}}"]),
    "health": out(["docker", "inspect", container, "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}"]),
    "imageId": out(["docker", "image", "inspect", image_tag, "--format", "{{.Id}}"]),
    "repoDigests": repo_digests,
}))
PY`,
    { operation: "docker:inspect-api-container" }
  );
  const health = String(baseUrl).startsWith("docker://")
    ? remoteJson(
        `docker exec ${JSON.stringify(containerName)} node -e "fetch('http://localhost:3000/health/release').then(async r=>{if(!r.ok)process.exit(1); console.log(JSON.stringify(await r.json()))}).catch(()=>process.exit(1))"`,
        { operation: "api:health-release-readback" }
      )
    : remoteJson(
        `curl --silent --show-error --fail --max-time 15 ${JSON.stringify(safeUrlJoin(baseUrl, "/health/release"))}`,
        { operation: "api:health-release-readback" }
      );
  return {
    releaseId,
    variant,
    serviceName,
    containerName,
    baseUrl,
    imageTag,
    ...remote,
    healthReadback: health?.data ?? health,
    runtimeReleaseId: (health?.data ?? health)?.release?.releaseId ?? "",
    runtimeSourceSha256: (health?.data ?? health)?.release?.sourceSha256 ?? "",
    runtimeVariant: (health?.data ?? health)?.release?.variant ?? ""
  };
}

function buildApiArtifact({ releaseId, sourceHash, apiSourceHash }) {
  const imageTag = `fastaibooking-api:${releaseId}`;
  rsyncSourceToEc2(releaseId);
  const ec2 = defaultEc2Config();
  appendReleaseOperation(releaseId, {
    action: "api:docker-build-immutable-image",
    target: imageTag,
    status: "started"
  });
  try {
    remoteJson(
      `docker build -f ${JSON.stringify(path.posix.join(ec2.appDir, "apps/api/Dockerfile"))} -t ${JSON.stringify(imageTag)} ${JSON.stringify(ec2.appDir)} >/dev/null && python3 - <<'PY'
import json
import subprocess

image_tag = ${JSON.stringify(imageTag)}

def out(args):
    return subprocess.check_output(args, text=True).strip()

repo_digests_raw = out(["docker", "image", "inspect", image_tag, "--format", "{{json .RepoDigests}}"]) or "[]"
try:
    repo_digests = json.loads(repo_digests_raw)
except Exception:
    repo_digests = []

print(json.dumps({
    "imageTag": image_tag,
    "imageId": out(["docker", "image", "inspect", image_tag, "--format", "{{.Id}}"]),
    "repoDigests": repo_digests,
}))
PY`,
      { operation: "docker:build-api-image" }
    );
  } catch (error) {
    appendReleaseOperation(releaseId, {
      action: "api:docker-build-immutable-image",
      target: imageTag,
      status: "failed"
    });
    throw error;
  }
  appendReleaseOperation(releaseId, {
    action: "api:docker-build-immutable-image",
    target: imageTag,
    status: "completed"
  });
  const artifact = {
    releaseId,
    sourceHash,
    apiSourceHash,
    imageTag,
    builtAt: new Date().toISOString()
  };
  writeReleaseFile(releaseId, "api-artifact.json", artifact);
  updateManifest(releaseId, { api: artifact });
  return artifact;
}

function deployCanaryApi({ releaseId, sourceHash, apiArtifact }) {
  const ec2 = defaultEc2Config();
  const canaryBaseUrl = safeUrlJoin(ec2.publicApiBaseUrl, `/voice-canary/${releaseId}`);
  const envPrefix = [
    `FASTAIBOOKING_API_CANARY_IMAGE=${apiArtifact.imageTag}`,
    `FASTAIBOOKING_API_RELEASE_ID=${releaseId}`,
    `FASTAIBOOKING_API_SOURCE_SHA256=${sourceHash}`,
    "FASTAIBOOKING_API_VARIANT=canary"
  ].join(" ");
  appendReleaseOperation(releaseId, {
    action: "api:docker-compose-up-canary",
    target: "api-voice-canary",
    status: "started"
  });
  try {
    sshRun([
      "bash",
      "-lc",
      `cd ${JSON.stringify(ec2.appDir)} && ${envPrefix} docker compose --profile voice-canary up -d --no-build api-voice-canary && cp infra/nginx/default-ssl.conf infra/nginx/default.conf && (docker rm -f fastaibooking-nginx >/dev/null 2>&1 || true) && docker compose up -d --no-build --no-deps nginx && docker compose exec -T nginx nginx -t && docker compose exec -T nginx nginx -s reload`
    ], { details: { operation: "docker-compose:deploy-api-canary" } });
  } catch (error) {
    appendReleaseOperation(releaseId, {
      action: "api:docker-compose-up-canary",
      target: "api-voice-canary",
      status: "failed"
    });
    throw error;
  }
  appendReleaseOperation(releaseId, {
    action: "api:docker-compose-up-canary",
    target: "api-voice-canary",
    status: "completed"
  });
  const readback = readbackApiContainer({
    releaseId,
    variant: "canary",
    serviceName: "api-voice-canary",
    containerName: "fastaibooking-api-voice-canary",
    baseUrl: "docker://fastaibooking-api-voice-canary",
    imageTag: apiArtifact.imageTag
  });
  if (readback.runtimeReleaseId !== releaseId || readback.runtimeVariant !== "canary") {
    throw new ReleaseError("Canary API release identity readback mismatch", { readback });
  }
  writeReleaseFile(releaseId, "api-canary-readback.json", readback);
  updateManifest(releaseId, {
    api: {
      ...apiArtifact,
      canaryBaseUrl,
      canaryReadback: readback
    }
  });
  return { ...apiArtifact, canaryBaseUrl, canaryReadback: readback };
}

function snapshotApiProduction(releaseId) {
  const ec2 = defaultEc2Config();
  const snapshot = remoteJson(
    `python3 - <<'PY'
import json
import subprocess
from datetime import datetime, timezone

def out(args):
    try:
        return subprocess.check_output(args, text=True).strip()
    except Exception:
        return ""

def shell(command):
    try:
        return subprocess.check_output(["sh", "-lc", command], text=True).strip()
    except Exception:
        return ""

print(json.dumps({
    "capturedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "serviceName": "api",
    "containerName": "fastaibooking-api",
    "containerImageId": out(["docker", "inspect", "fastaibooking-api", "--format", "{{.Image}}"]),
    "configuredImage": out(["docker", "inspect", "fastaibooking-api", "--format", "{{.Config.Image}}"]),
    "health": out(["docker", "inspect", "fastaibooking-api", "--format", "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}"]),
    "nginxApiProxyPass": shell("docker exec fastaibooking-nginx nginx -T 2>/dev/null | grep -m1 'proxy_pass http://api:3000' || true"),
}))
PY`,
    { operation: "docker:inspect-production-api" }
  );
  writeReleaseFile(releaseId, "before-production-api.json", snapshot);
  return snapshot;
}

function deployProductionApiNext({ releaseId, sourceHash, apiArtifact }) {
  const ec2 = defaultEc2Config();
  const envPrefix = [
    `FASTAIBOOKING_API_PRODUCTION_NEXT_IMAGE=${apiArtifact.imageTag}`,
    `FASTAIBOOKING_API_RELEASE_ID=${releaseId}`,
    `FASTAIBOOKING_API_SOURCE_SHA256=${sourceHash}`,
    "FASTAIBOOKING_API_VARIANT=production"
  ].join(" ");
  sshRun([
    "bash",
    "-lc",
    `cd ${JSON.stringify(ec2.appDir)} && ${envPrefix} docker compose --profile voice-production up -d --no-build api-production-next`
  ], { details: { operation: "docker-compose:deploy-api-production-next" } });
  return readbackApiContainer({
    releaseId,
    variant: "production",
    serviceName: "api-production-next",
    containerName: "fastaibooking-api-production-next",
    baseUrl: "docker://fastaibooking-api-production-next",
    imageTag: apiArtifact.imageTag
  });
}

function switchProductionApi({ releaseId, sourceHash, apiArtifact }) {
  const ec2 = defaultEc2Config();
  const envPrefix = [
    `FASTAIBOOKING_API_IMAGE=${apiArtifact.imageTag}`,
    `FASTAIBOOKING_API_RELEASE_ID=${releaseId}`,
    `FASTAIBOOKING_API_SOURCE_SHA256=${sourceHash}`,
    "FASTAIBOOKING_API_VARIANT=production"
  ].join(" ");
  sshRun([
    "bash",
    "-lc",
    `cd ${JSON.stringify(ec2.appDir)} && ${envPrefix} docker compose up -d --no-build api && cp infra/nginx/default-ssl.conf infra/nginx/default.conf && (docker rm -f fastaibooking-nginx >/dev/null 2>&1 || true) && docker compose up -d --no-build --no-deps nginx && docker compose exec -T nginx nginx -t && docker compose exec -T nginx nginx -s reload`
  ], { details: { operation: "docker-compose:switch-production-api" } });
  const readback = readbackApiContainer({
    releaseId,
    variant: "production",
    serviceName: "api",
    containerName: "fastaibooking-api",
    baseUrl: ec2.publicApiBaseUrl,
    imageTag: apiArtifact.imageTag
  });
  if (readback.runtimeReleaseId !== releaseId || readback.runtimeVariant !== "production") {
    throw new ReleaseError("Production API release identity readback mismatch", { readback });
  }
  return readback;
}

export function generateConnectFlowContent(sourceContent, options) {
  const {
    targets,
    target,
    aliasArn,
    aliasName,
    marker,
    releaseId,
    sourceHash,
    variant,
    flowId,
    lexAliasId,
    lexBotVersion,
    lambdaFunctionName,
    lambdaFunctionVersion,
    lambdaCodeSha256,
    apiReleaseId,
    apiVariant
  } = options;
  const content = JSON.parse(JSON.stringify(sourceContent));
  const botId = targets.lex.botId;
  const addReleaseAttributes = (attrs) => {
    attrs.connectFlowSourceVersion = marker;
    attrs.VOICE_RELEASE_ID = releaseId;
    attrs.VOICE_SOURCE_SHA256 = sourceHash;
    attrs.VOICE_VARIANT = variant;
    attrs.VOICE_CONNECT_FLOW_ID = flowId || targetConfig(targets, target).flow.id;
    attrs.VOICE_CONNECT_MARKER = marker;
    attrs.connectFlowNormalizedHash = "";
    attrs.VOICE_CONNECT_FLOW_NORMALIZED_HASH = "";
    attrs.VOICE_LEX_ALIAS_ID = lexAliasId || aliasArn.split("/").pop();
    attrs.VOICE_LEX_ALIAS_ARN = aliasArn;
    attrs.VOICE_LEX_BOT_VERSION = lexBotVersion || "";
    attrs.VOICE_LAMBDA_FUNCTION_NAME = lambdaFunctionName || "";
    attrs.VOICE_LAMBDA_FUNCTION_VERSION = lambdaFunctionVersion || "";
    attrs.VOICE_LAMBDA_CODE_SHA256 = lambdaCodeSha256 || "";
    attrs.VOICE_API_RELEASE_ID = apiReleaseId || releaseId;
    attrs.VOICE_API_VARIANT = apiVariant || variant;
    attrs.speechModelPreference = "Neural";
    attrs.speechDetectionSensitivity = "Default";
  };
  const walk = (value, parentKey = "") => {
    if (!value || typeof value !== "object") {
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, parentKey));
      return;
    }
    if (value.LexSessionAttributes && typeof value.LexSessionAttributes === "object") {
      addReleaseAttributes(value.LexSessionAttributes);
    }
    if (value.Attributes && typeof value.Attributes === "object") {
      addReleaseAttributes(value.Attributes);
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key === "AliasArn" && typeof entry === "string" && entry.includes(`bot-alias/${botId}/`)) {
        value[key] = aliasArn;
      } else if (key === "connectFlowSourceVersion") {
        value[key] = marker;
      } else if (key === "lexV2BotAliasName") {
        value[key] = aliasName;
      } else if (key === "displayName" && parentKey === "AliasArn") {
        value[key] = aliasName;
      }
      walk(value[key], key);
    }
  };
  walk(content);
  setConnectFlowHashAttributes(content, connectFlowNormalizedSha256(content));
  return content;
}

const nextActionIds = (action) => {
  const transitions = action.Transitions ?? {};
  return [
    transitions.NextAction,
    ...(transitions.Conditions ?? []).map((condition) => condition.NextAction),
    ...(transitions.Errors ?? []).map((error) => error.NextAction)
  ].filter(Boolean);
};

export function reachableActions(content) {
  const actionsById = new Map((content.Actions ?? []).map((action) => [action.Identifier, action]));
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
    for (const nextId of nextActionIds(action)) {
      stack.push(nextId);
    }
  }
  return Array.from(reachable).map((id) => actionsById.get(id)).filter(Boolean);
}

export function lexAliasIdFromConnectFlow(content, fallbackAliasId = "") {
  const aliasArn = reachableActions(content)
    .filter((action) => action.Type === "ConnectParticipantWithLexBot")
    .map((action) => action.Parameters?.LexV2Bot?.AliasArn)
    .find(Boolean);
  return aliasArn?.split("/").at(-1) || fallbackAliasId;
}

export function validateConnectFlow(content, { aliasArn, marker }) {
  const failures = [];
  const reachable = reachableActions(content);
  for (const action of reachable) {
    if (nextActionIds(action).includes(action.Identifier)) {
      failures.push(`${action.Identifier} self-loops`);
    }
    if (action.Type !== "ConnectParticipantWithLexBot") {
      continue;
    }
    const actualAliasArn = action.Parameters?.LexV2Bot?.AliasArn;
    if (actualAliasArn !== aliasArn) {
      failures.push(`${action.Identifier} uses ${actualAliasArn || "missing alias"} instead of ${aliasArn}`);
    }
    const attrs = action.Parameters?.LexSessionAttributes ?? {};
    if (attrs.connectFlowSourceVersion !== marker) {
      failures.push(`${action.Identifier} missing dynamic marker`);
    }
    for (const requiredAttribute of [
      "VOICE_RELEASE_ID",
      "VOICE_SOURCE_SHA256",
      "VOICE_VARIANT",
      "VOICE_CONNECT_FLOW_ID",
      "VOICE_CONNECT_MARKER",
      "connectFlowNormalizedHash",
      "VOICE_CONNECT_FLOW_NORMALIZED_HASH",
      "VOICE_LEX_ALIAS_ID",
      "VOICE_LEX_ALIAS_ARN",
      "VOICE_LEX_BOT_VERSION",
      "VOICE_LAMBDA_FUNCTION_NAME",
      "VOICE_LAMBDA_FUNCTION_VERSION",
      "VOICE_LAMBDA_CODE_SHA256",
      "VOICE_API_RELEASE_ID",
      "VOICE_API_VARIANT"
    ]) {
      if (!attrs[requiredAttribute]) {
        failures.push(`${action.Identifier} missing ${requiredAttribute}`);
      }
    }
    if (!attrs.VOICE_RELEASE_ID || !attrs.VOICE_SOURCE_SHA256 || !attrs.VOICE_VARIANT) {
      failures.push(`${action.Identifier} missing release identity attributes`);
    }
  }
  return failures;
}

function generateConnectArtifact({
  releaseId,
  target,
  aliasArn,
  aliasName,
  marker,
  sourceHash,
  variant,
  lexAliasId,
  lexBotVersion,
  lambdaFunctionName,
  lambdaFunctionVersion,
  lambdaCodeSha256,
  apiReleaseId,
  apiVariant
}) {
  const targets = readTargets();
  const { flow } = targetConfig(targets, target);
  const sourceContent = readJson(SOURCE_FLOW);
  const content = generateConnectFlowContent(sourceContent, {
    targets,
    target,
    aliasArn,
    aliasName,
    marker,
    releaseId,
    sourceHash,
    variant,
    flowId: flow.id,
    lexAliasId,
    lexBotVersion,
    lambdaFunctionName,
    lambdaFunctionVersion,
    lambdaCodeSha256,
    apiReleaseId,
    apiVariant
  });
  const failures = validateConnectFlow(content, { aliasArn, marker });
  if (failures.length) {
    throw new ReleaseError("Generated Connect flow failed validation", { failures });
  }
  const generatedPath = path.join(releaseDirFor(releaseId), `${target}-ai-reception.generated.json`);
  writeJson(generatedPath, content);
  const artifact = {
    releaseId,
    target,
    path: generatedPath,
    marker,
    aliasArn,
    aliasName,
    normalizedSha256: connectFlowNormalizedSha256(content),
    lexBlocks: (content.Actions ?? []).filter((action) => action.Type === "ConnectParticipantWithLexBot").length
  };
  writeReleaseFile(releaseId, "connect-artifact.json", artifact);
  return { artifact, content };
}

export function buildReleasePlan({ target, dryRun = false, acceptedManifest = null } = {}) {
  const plannedWrites =
    target === "canary"
      ? [
          "api:rsync-source",
          "api:docker-build-immutable-image",
          "api:docker-compose-up-canary",
          "api:nginx-reload",
          "api:health-readback",
          "lambda:update-function-code",
          "lambda:update-function-configuration",
          "lambda:publish-version",
          "lambda:create-or-update-alias",
          "lex:update-bot-locale",
          "lex:update-intent",
          "lex:create-slot-type",
          "lex:update-slot-type",
          "lex:batch-create-custom-vocabulary-item",
          "lex:batch-update-custom-vocabulary-item",
          "lex:batch-delete-custom-vocabulary-item",
          "lex:build-bot-locale",
          "lex:create-bot-version",
          "lex:create-or-update-bot-alias",
          "lambda:add-permission",
          "connect:associate-lex-bot-alias",
          "connect:update-contact-flow-content"
        ]
      : [
          "api:snapshot-production-upstream",
          "api:docker-compose-up-production-next",
          "api:switch-production-upstream",
          "api:health-readback",
          "lambda:update-function-code",
          "lambda:update-function-configuration",
          "lambda:publish-version",
          "lambda:create-or-update-alias",
          "lex:create-or-update-bot-alias",
          "lambda:add-permission",
          "connect:associate-lex-bot-alias",
          "connect:update-contact-flow-content"
        ];
  return {
    target,
    dryRun,
    awsWrites: dryRun ? [] : plannedWrites,
    plannedWrites,
    rebuildsArtifacts: target === "production" ? false : !acceptedManifest,
    reusesAcceptedHashes: target === "production" && Boolean(acceptedManifest)
  };
}

export function normalizeAcceptanceManifest(manifest) {
  const cases = (manifest.canaryAcceptance?.cases || manifest.acceptance?.cases || [])
    .filter((item) => item && typeof item === "object");
  const acceptedCases = cases.filter((item) => item.accepted === true || item.evaluation?.passed === true);
  const metricFailures = [];
  const metricValues = new Map();
  const getMetric = (inputCase, name) => {
    const metric = inputCase.metrics?.[name];
    if (!metric || typeof metric !== "object") {
      metricFailures.push(`metric_missing:${name}`);
      return { state: "MISSING", value: null };
    }
    if (!["MEASURED", "NOT_APPLICABLE", "MISSING"].includes(metric.state)) {
      metricFailures.push(`metric_missing:${name}`);
      return { state: "MISSING", value: null };
    }
    if (metric.state === "MISSING") {
      metricFailures.push(`metric_missing:${name}`);
    }
    return metric;
  };
  for (const inputCase of acceptedCases) {
    for (const metricName of MANDATORY_METRICS) {
      const metric = getMetric(inputCase, metricName);
      const key = `${inputCase.contactId}:${metricName}`;
      metricValues.set(key, metric);
    }
  }
  const contacts = acceptedCases.map((item) => item.contactId).filter(Boolean);
  const uniqueContacts = new Set(contacts);
  const roundCaseKeys = acceptedCases.map((item) => `${item.roundId || ""}:${item.caseId || ""}`);
  const uniqueRoundCases = new Set(roundCaseKeys);
  const testerHashes = new Set(acceptedCases.map((item) => item.testerHash).filter(Boolean));
  const roundIds = Array.from(new Set(acceptedCases.map((item) => item.roundId).filter(Boolean))).sort();
  const completeCriticalRounds = roundIds.filter((roundId) =>
    CRITICAL_CASE_IDS.every((caseId) =>
      acceptedCases.some((item) => item.roundId === roundId && item.caseId === caseId && item.evaluation?.passed === true)
    )
  );
  const safetyPassed = SAFETY_CASE_IDS.every((caseId) =>
    acceptedCases.some((item) => item.caseId === caseId && item.evaluation?.passed === true)
  );
  const sumMetric = (name) => {
    let total = 0;
    let measured = false;
    for (const inputCase of acceptedCases) {
      const metric = inputCase.metrics?.[name];
      if (metric?.state === "MEASURED") {
        measured = true;
        total += Number(metric.value);
      }
    }
    return measured ? total : null;
  };
  const ratioMetric = (name) => {
    let numerator = 0;
    let denominator = 0;
    for (const inputCase of acceptedCases) {
      const metric = inputCase.metrics?.[name];
      if (metric?.state !== "MEASURED") {
        continue;
      }
      denominator += 1;
      if (["DIRECT", "ONE_CLARIFICATION", true].includes(metric.value)) {
        numerator += 1;
      }
    }
    return denominator ? numerator / denominator : null;
  };
  const measuredNumbers = (name) =>
    acceptedCases
      .map((inputCase) => inputCase.metrics?.[name])
      .filter((metric) => metric?.state === "MEASURED")
      .map((metric) => Number(metric.value))
      .filter((value) => Number.isFinite(value));
  const p95 = (values) => {
    if (!values.length) return null;
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
  };
  const activeCleanupCounts = acceptedCases
    .map((item) => item.cleanup?.activeTestAppointmentCount)
    .filter((value) => Number.isFinite(Number(value)))
    .map(Number);
  const manifestComponent = (name) => manifest[name] || manifest.canaryDeploy?.[name];
  return {
    releaseId: manifest.releaseId,
    schemaVersion: manifest.schemaVersion,
    canaryReady: manifest.canaryDeploy?.status === "CANARY_READY_FOR_HUMAN_PSTN",
    apiIdentityPresent: Boolean(manifest.api?.imageTag && manifest.api?.canaryReadback?.runtimeReleaseId),
    lambdaIdentityPresent: Boolean(manifestComponent("lambda")?.publishedVersion && manifestComponent("lambda")?.codeSha256Base64),
    lexIdentityPresent: Boolean(
      manifestComponent("lex")?.botVersion &&
        (manifestComponent("lex")?.alias?.aliasId || manifestComponent("lex")?.aliasId)
    ),
    connectIdentityPresent: Boolean(manifest.connect?.canary?.normalizedSha256 || manifest.canaryDeploy?.connect?.normalizedSha256),
    observabilityComplete: acceptedCases.length > 0 && acceptedCases.every((item) => item.observability?.complete === true),
    cleanupEvidenceComplete: acceptedCases.length > 0 && acceptedCases.every((item) => item.cleanup?.state === "MEASURED"),
    activeTestAppointmentCount: activeCleanupCounts.length === acceptedCases.length
      ? activeCleanupCounts.reduce((sum, value) => sum + value, 0)
      : null,
    acceptedCaseCount: acceptedCases.length,
    duplicateContact: contacts.length !== uniqueContacts.size,
    duplicateRoundCase: roundCaseKeys.length !== uniqueRoundCases.size,
    testerCount: testerHashes.size,
    completeCriticalRounds,
    criticalRoundsPassed: completeCriticalRounds.length,
    safetyPassed,
    serviceCaptureRate: ratioMetric("serviceCaptureResult"),
    staffCaptureRate: ratioMetric("staffCaptureResult"),
    wrongServiceAutoCommitCount: sumMetric("wrongServiceAutoCommitCount"),
    wrongStaffAutoCommitCount: sumMetric("wrongStaffAutoCommitCount"),
    appointmentBeforeFinalConfirmationCount: sumMetric("appointmentBeforeFinalConfirmationCount"),
    silentTurnCount: sumMetric("silentTurnCount"),
    groundedFieldLossCount: sumMetric("groundedFieldLossCount"),
    repeatedLongMenuCount: sumMetric("repeatedLongMenuCount"),
    autoTransferWithoutRequestCount: sumMetric("autoTransferWithoutRequestCount"),
    duplicateAppointmentCount: sumMetric("duplicateAppointmentCount"),
    callerTurnToPromptP95Ms: p95(measuredNumbers("callerTurnToPromptMs")),
    baselineCallerTurnToPromptP95Ms: manifest.baseline?.callerTurnToPromptP95Ms ?? null,
    metricFailures: Array.from(new Set(metricFailures))
  };
}

export function contactMatchesRelease(contact, manifest) {
  const fingerprints = contact.fingerprints ?? contact;
  const expectedMarker = manifest.connect?.canary?.marker || manifest.connect?.production?.marker;
  const expectedAliasId = manifest.lex?.aliasId || manifest.lex?.canaryAliasId || manifest.lex?.productionAliasId;
  const expectedBotVersion = manifest.lex?.botVersion;
  const expectedLambdaFingerprint =
    manifest.lambda?.codeSha256Base64 || manifest.lambda?.publishedCodeSha256 || manifest.lambda?.codeSha256;
  const expectedApiReleaseId = manifest.api?.releaseId || manifest.releaseId;
  const failures = [];
  if (!fingerprints.connectFlowMarker || fingerprints.connectFlowMarker !== expectedMarker) {
    failures.push("connect_marker_mismatch");
  }
  if (fingerprints.connectFlowMarker === OLD_PRODUCTION_MARKER) {
    failures.push("old_production_marker");
  }
  if (expectedAliasId && fingerprints.lexAliasId !== expectedAliasId) {
    failures.push("lex_alias_mismatch");
  }
  if (fingerprints.lexBotVersion === OLD_PRODUCTION_LEX_VERSION) {
    failures.push("old_production_lex_version");
  }
  if (expectedBotVersion && String(fingerprints.lexBotVersion) !== String(expectedBotVersion)) {
    failures.push("lex_version_mismatch");
  }
  if (
    expectedLambdaFingerprint &&
    fingerprints.lambdaCodeSha256 &&
    fingerprints.lambdaCodeSha256 !== expectedLambdaFingerprint
  ) {
    failures.push("lambda_fingerprint_mismatch");
  }
  if (expectedLambdaFingerprint && !fingerprints.lambdaCodeSha256) {
    failures.push("lambda_identity_missing");
  }
  if (expectedApiReleaseId && fingerprints.apiReleaseId !== expectedApiReleaseId) {
    failures.push("api_identity_missing");
  }
  const expectedVariant = manifest.expectedVariant || "canary";
  if (!fingerprints.voiceVariant) {
    failures.push("voice_variant_missing");
  } else if (fingerprints.voiceVariant !== expectedVariant) {
    failures.push("voice_variant_mismatch");
  }
  return {
    ok: failures.length === 0,
    failures
  };
}

export function validatePromotionGate(manifest) {
  const normalized = normalizeAcceptanceManifest(manifest);
  const failures = [];
  if (!normalized.canaryReady) failures.push("canary_not_ready");
  if (!normalized.apiIdentityPresent) failures.push("api_identity_missing");
  if (!normalized.lambdaIdentityPresent) failures.push("lambda_identity_missing");
  if (!normalized.lexIdentityPresent) failures.push("lex_identity_missing");
  if (!normalized.connectIdentityPresent) failures.push("connect_identity_missing");
  if (!normalized.observabilityComplete) failures.push("observability_missing");
  if (normalized.duplicateContact) failures.push("duplicate_contact_id");
  if (normalized.duplicateRoundCase) failures.push("duplicate_case_round");
  if (normalized.testerCount < 2) failures.push("tester_diversity_missing");
  if (normalized.criticalRoundsPassed < 2) failures.push("round_incomplete");
  if (!normalized.safetyPassed) failures.push("safety_cases_missing");
  if (normalized.serviceCaptureRate === null || normalized.serviceCaptureRate < 0.95) failures.push("service_capture_below_threshold");
  if (normalized.staffCaptureRate === null || normalized.staffCaptureRate < 0.95) failures.push("staff_capture_below_threshold");
  if (normalized.wrongServiceAutoCommitCount !== 0) failures.push("wrong_service_auto_commit");
  if (normalized.wrongStaffAutoCommitCount !== 0) failures.push("wrong_staff_auto_commit");
  if (normalized.appointmentBeforeFinalConfirmationCount !== 0) failures.push("appointment_before_confirmation");
  if (normalized.duplicateAppointmentCount !== 0) failures.push("duplicate_appointment");
  if (normalized.silentTurnCount !== 0) failures.push("silent_turn");
  if (normalized.groundedFieldLossCount !== 0) failures.push("grounded_field_loss");
  if (normalized.autoTransferWithoutRequestCount !== 0) failures.push("unauthorized_auto_transfer");
  if (normalized.repeatedLongMenuCount !== 0) failures.push("repeated_long_menu");
  if (!normalized.cleanupEvidenceComplete) failures.push("cleanup_evidence_missing");
  if (normalized.activeTestAppointmentCount !== 0) failures.push("unclean_test_appointments");
  if (normalized.callerTurnToPromptP95Ms === null) {
    failures.push("metric_missing:callerTurnToPromptMs");
  } else {
    if (normalized.callerTurnToPromptP95Ms > 4500) failures.push("caller_turn_to_prompt_latency_high");
    if (
      normalized.baselineCallerTurnToPromptP95Ms !== null &&
      normalized.baselineCallerTurnToPromptP95Ms !== undefined &&
      Number.isFinite(Number(normalized.baselineCallerTurnToPromptP95Ms)) &&
      normalized.callerTurnToPromptP95Ms > Number(normalized.baselineCallerTurnToPromptP95Ms) * 1.1
    ) {
      failures.push("caller_turn_to_prompt_latency_regressed");
    }
  }
  failures.push(...normalized.metricFailures);
  return {
    ok: Array.from(new Set(failures)).length === 0,
    failures: Array.from(new Set(failures)),
    normalized
  };
}

const missingOnlyEmergencyFailures = (gate) => {
  const normalized = gate.normalized;
  const missingCountFailures = new Map([
    ["service_capture_below_threshold", normalized.serviceCaptureRate],
    ["staff_capture_below_threshold", normalized.staffCaptureRate],
    ["wrong_service_auto_commit", normalized.wrongServiceAutoCommitCount],
    ["wrong_staff_auto_commit", normalized.wrongStaffAutoCommitCount],
    ["appointment_before_confirmation", normalized.appointmentBeforeFinalConfirmationCount],
    ["duplicate_appointment", normalized.duplicateAppointmentCount],
    ["silent_turn", normalized.silentTurnCount],
    ["grounded_field_loss", normalized.groundedFieldLossCount],
    ["unauthorized_auto_transfer", normalized.autoTransferWithoutRequestCount],
    ["repeated_long_menu", normalized.repeatedLongMenuCount],
    ["unclean_test_appointments", normalized.activeTestAppointmentCount]
  ]);
  const unconditionalMissingEvidence = new Set([
    "observability_missing",
    "tester_diversity_missing",
    "round_incomplete",
    "safety_cases_missing",
    "cleanup_evidence_missing",
    "metric_missing:callerTurnToPromptMs"
  ]);
  return gate.failures.filter((failure) =>
    unconditionalMissingEvidence.has(failure) ||
    failure.startsWith("metric_missing:") ||
    (missingCountFailures.has(failure) && missingCountFailures.get(failure) === null)
  );
};

export function validateEmergencyPromotionAuthorization({
  manifest,
  acknowledgedReleaseId,
  acknowledgedSourceCommit,
  authorizationReason,
  identityValid,
  artifactsValid,
  canaryReadbackValid,
  sourceValidationPassed,
  rollbackSnapshotComplete = true
}) {
  const gate = validatePromotionGate(manifest);
  const bypassedFailures = missingOnlyEmergencyFailures(gate);
  const hardGateFailures = gate.failures.filter((failure) => !bypassedFailures.includes(failure));
  const failures = [];
  if (acknowledgedReleaseId !== manifest.releaseId) failures.push("release_acknowledgment_mismatch");
  if (!/^[0-9a-f]{40}$/.test(String(acknowledgedSourceCommit || "")) || acknowledgedSourceCommit !== manifest.sourceCommit) {
    failures.push("source_commit_acknowledgment_mismatch");
  }
  if (!String(authorizationReason || "").trim()) failures.push("authorization_reason_missing");
  if (!identityValid) failures.push("aws_identity_invalid");
  if (!artifactsValid) failures.push("accepted_artifact_mismatch");
  if (!canaryReadbackValid) failures.push("canary_readback_mismatch");
  if (!sourceValidationPassed) failures.push("source_validation_failed");
  if (!rollbackSnapshotComplete) failures.push("rollback_snapshot_incomplete");
  failures.push(...hardGateFailures);
  return {
    ok: failures.length === 0,
    failures: Array.from(new Set(failures)),
    originalGateFailures: gate.failures,
    bypassedFailures,
    hardGateFailures,
    hardGatesPassed: [
      "aws_identity",
      "accepted_artifacts",
      "canary_readback",
      "source_validation",
      "rollback_snapshot"
    ].filter((name) => !failures.some((failure) => failure.startsWith(name.replaceAll("_", " "))))
  };
}

export function buildRollbackPlan(snapshot) {
  if (!snapshot?.connect?.flowId || !snapshot.connect.normalizedSha256 || !snapshot.connect.content) {
    throw new ReleaseError("Rollback snapshot is missing Connect flow content or hash");
  }
  const writes = [];
  if (snapshot.connect) {
    writes.push("connect:update-contact-flow-content");
  }
  if (snapshot.lexAliasRestoreRequired || snapshot.lexAlias) {
    writes.push("lex:update-bot-alias");
  }
  if (snapshot.lambda) {
    writes.push("lambda:restore-code-or-alias");
  }
  if (snapshot.api) {
    writes.push("api:restore-image-upstream");
  }
  return {
    writes,
    restoresApi: Boolean(snapshot.api),
    restoresLambda: Boolean(snapshot.lambda),
    restoresConnectFlowId: snapshot.connect.flowId,
    expectedConnectSha256: snapshot.connect.normalizedSha256,
    restoresLexAlias: Boolean(snapshot.lexAliasRestoreRequired || snapshot.lexAlias),
    exactContent: snapshot.connect.content
  };
}

export function assertReadbackMatchesManifest(readback, manifest) {
  const failures = [];
  if (!manifest.api && !readback.api) {
    failures.push("api_identity_missing");
  } else if (manifest.api && !readback.api) {
    failures.push("api_identity_missing");
  } else if (manifest.api) {
    if (readback.api?.imageId && manifest.api?.canaryReadback?.imageId && readback.api.imageId !== manifest.api.canaryReadback.imageId) {
      failures.push("api_image_id_mismatch");
    }
    if (readback.api?.runtimeReleaseId !== manifest.api?.releaseId) {
      failures.push("api_release_id_mismatch");
    }
    if (manifest.api?.apiSourceHash && readback.api?.runtimeSourceSha256 !== manifest.sourceHash) {
      failures.push("api_source_hash_mismatch");
    }
  }
  if (readback.lambda?.codeSha256Base64 !== manifest.lambda?.codeSha256Base64) {
    failures.push("lambda_code_sha_mismatch");
  }
  if (String(readback.lex?.botVersion) !== String(manifest.lex?.botVersion)) {
    failures.push("lex_bot_version_mismatch");
  }
  if (readback.connect?.normalizedSha256 !== manifest.connect?.normalizedSha256) {
    failures.push("connect_hash_mismatch");
  }
  if (readback.connect?.marker !== manifest.connect?.marker) {
    failures.push("connect_marker_mismatch");
  }
  if (failures.length) {
    throw new ReleaseError("Readback did not match manifest", { failures });
  }
}

function sourceLexConfigurationHash() {
  const files = [
    "BotLocales/en_US/BotLocale.json",
    "BotLocales/en_US/CustomVocabulary.json",
    "BotLocales/en_US/SlotTypes/NailServiceType/SlotType.json",
    "BotLocales/en_US/SlotTypes/StaffPreferenceType/SlotType.json",
    "BotLocales/en_US/SlotTypes/BookingConfirmationType/SlotType.json"
  ];
  return sha256Json(
    files.map((relativePath) => ({
      path: relativePath,
      sha256: sha256File(path.join(LEX_ROOT, relativePath))
    }))
  );
}

function validateLexSource() {
  const locale = readJson(path.join(LOCALE_ROOT, "BotLocale.json"));
  const serviceSlot = readJson(path.join(LOCALE_ROOT, "SlotTypes/NailServiceType/SlotType.json"));
  const staffSlot = readJson(path.join(LOCALE_ROOT, "SlotTypes/StaffPreferenceType/SlotType.json"));
  const vocabulary = readJson(path.join(LOCALE_ROOT, "CustomVocabulary.json"));
  const vocabularyPhrases = new Set((vocabulary.customVocabularyItems ?? []).map((item) => item.phrase));
  const staffAny = staffSlot.slotTypeValues.find((value) => value.sampleValue?.value === "Any staff");
  const staffSynonyms = new Set((staffAny?.synonyms ?? []).map((synonym) => synonym.value.toLowerCase()));
  const failures = [];
  const unifiedSpeechModel = locale.unifiedSpeechSettings?.speechFoundationModel;
  const usesUnifiedSpeech = Boolean(unifiedSpeechModel?.modelArn);
  if (!usesUnifiedSpeech && locale.speechRecognitionSettings?.speechModelPreference !== "Neural") {
    failures.push("source speechModelPreference is not Neural");
  }
  if (
    usesUnifiedSpeech &&
    (unifiedSpeechModel.modelArn !==
      "arn:aws:bedrock:us-east-1::foundation-model/amazon.nova-2-sonic-v1:0" ||
      unifiedSpeechModel.voiceId !== "tiffany")
  ) {
    failures.push("source unified speech model or voice is not approved");
  }
  if (
    usesUnifiedSpeech &&
    (locale.audioFillerSettings?.enabled !== true ||
      locale.audioFillerSettings?.audioType !== "MELODY_PATIENT_PING" ||
      locale.audioFillerSettings?.startDelayInMilliseconds !== 1000 ||
      locale.audioFillerSettings?.minimumPlayDurationInMilliseconds !== 1000 ||
      locale.audioFillerSettings?.responseDeliveryDelayInMilliseconds !== 200)
  ) {
    failures.push("source audio filler settings are not approved");
  }
  if (locale.speechDetectionSensitivity !== "Default") {
    failures.push("source speechDetectionSensitivity is not Default");
  }
  for (const [name, slot] of [
    ["NailServiceType", serviceSlot],
    ["StaffPreferenceType", staffSlot]
  ]) {
    const actual = slot.valueSelectionSetting?.advancedRecognitionSetting?.audioRecognitionStrategy;
    if (actual !== "UseSlotValuesAsCustomVocabulary") {
      failures.push(`${name} missing UseSlotValuesAsCustomVocabulary`);
    }
  }
  for (const phrase of REQUIRED_CUSTOM_VOCABULARY) {
    if (!vocabularyPhrases.has(phrase)) {
      failures.push(`custom vocabulary missing ${phrase}`);
    }
  }
  for (const phrase of FORBIDDEN_REPAIR_VOCABULARY) {
    if (vocabularyPhrases.has(phrase)) {
      failures.push(`unsafe repair phrase in custom vocabulary: ${phrase}`);
    }
  }
  for (const phrase of ["any stop if i", "edit stop if i", "at least happy five", "i need stop if i"]) {
    if (staffSynonyms.has(phrase)) {
      failures.push(`unsafe repair phrase in StaffPreferenceType synonym: ${phrase}`);
    }
  }
  if (failures.length) {
    throw new ReleaseError("Lex source validation failed", { failures });
  }
  return {
    speechMode: usesUnifiedSpeech ? "unified" : "neural_stt",
    speechModelPreference: usesUnifiedSpeech ? null : "Neural",
    unifiedSpeechSettings: locale.unifiedSpeechSettings || null,
    audioFillerSettings: locale.audioFillerSettings || null,
    speechDetectionSensitivity: "Default",
    serviceSlotAudioRecognitionStrategy:
      serviceSlot.valueSelectionSetting.advancedRecognitionSetting.audioRecognitionStrategy,
    staffSlotAudioRecognitionStrategy:
      staffSlot.valueSelectionSetting.advancedRecognitionSetting.audioRecognitionStrategy,
    customVocabularyRequired: REQUIRED_CUSTOM_VOCABULARY,
    forbiddenRepairVocabulary: FORBIDDEN_REPAIR_VOCABULARY
  };
}

function runSourceGates(releaseId) {
  const startedAt = new Date().toISOString();
  const results = [];
  for (const [command, args] of SOURCE_GATE_COMMANDS) {
    let result = run(command, args);
    const attempts = [{
      exitCode: result.status,
      signal: result.signal || null,
      error: result.error || ""
    }];
    if (result.status === null && result.signal) {
      result = run(command, args);
      attempts.push({
        exitCode: result.status,
        signal: result.signal || null,
        error: result.error || ""
      });
    }
    results.push({
      command: [command, ...args].join(" "),
      status: result.status === 0 ? "passed" : "failed",
      exitCode: result.status,
      signal: result.signal || null,
      attempts,
      stdoutTail: result.stdout.slice(-4000),
      stderrTail: result.stderr.slice(-4000)
    });
    if (result.status !== 0) {
      const validation = {
        startedAt,
        completedAt: new Date().toISOString(),
        status: "failed",
        results
      };
      writeReleaseFile(releaseId, "source-validation.json", validation);
      throw new ReleaseError("Source gate failed", { command: [command, ...args].join(" ") });
    }
  }
  const validation = {
    startedAt,
    completedAt: new Date().toISOString(),
    status: "passed",
    results
  };
  writeReleaseFile(releaseId, "source-validation.json", validation);
  return validation;
}

function captureTargetSnapshot(targets, target, outputName) {
  const { flow, alias, lambdaFn } = targetConfig(targets, target);
  const connectFlow = awsJson(targets, "connect", "describe-contact-flow", [
    "--instance-id",
    targets.connect.instanceId,
    "--contact-flow-id",
    flow.id
  ]);
  const flowContent = JSON.parse(connectFlow.ContactFlow.Content);
  const activeLexAliasId = lexAliasIdFromConnectFlow(flowContent, alias.id);
  const lexAlias = awsJson(targets, "lexv2-models", "describe-bot-alias", [
    "--bot-id",
    targets.lex.botId,
    "--bot-alias-id",
    activeLexAliasId
  ]);
  const lambdaArn = lexAliasLocaleSettingsFrom(lexAlias)?.en_US?.codeHookSpecification?.lambdaCodeHook?.lambdaARN || "";
  const lambdaQualifier = lambdaArn.split(":").length > 7 ? lambdaArn.split(":").at(-1) : "";
  const lambdaConfigArgs = [
    "--function-name",
    lambdaFn.name
  ];
  if (lambdaQualifier) lambdaConfigArgs.push("--qualifier", lambdaQualifier);
  const lambdaConfig = awsJson(targets, "lambda", "get-function-configuration", lambdaConfigArgs);
  const lambdaAlias = lambdaQualifier
    ? awsJson(targets, "lambda", "get-alias", [
        "--function-name",
        lambdaFn.name,
        "--name",
        lambdaQualifier
      ])
    : null;
  const snapshot = {
    target,
    capturedAt: new Date().toISOString(),
    connect: {
      flowId: flow.id,
      name: flow.name,
      marker: findConnectMarker(flowContent),
      normalizedSha256: connectFlowNormalizedSha256(flowContent),
      status: connectFlow.ContactFlow.Status,
      state: connectFlow.ContactFlow.State,
      content: flowContent
    },
    lexAlias,
    lambda: {
      ...sanitizeLambdaConfig(lambdaConfig),
      ...(lambdaAlias || {})
    }
  };
  writeReleaseFile(outputName.releaseId, outputName.file, snapshot);
  return snapshot;
}

function findConnectMarker(flowContent) {
  const markers = [];
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key === "connectFlowSourceVersion") {
        markers.push(String(entry));
      }
      walk(entry);
    }
  };
  walk(flowContent);
  return markers[0] || "";
}

function waitForLambdaUpdated(targets, functionName) {
  awsRaw(targets, "lambda", "wait", ["function-updated", "--function-name", functionName], {
    resourceArn: `arn:aws:lambda:${targets.region}:${targets.accountId}:function:${functionName}`,
    requiredAction: "lambda:GetFunctionConfiguration"
  });
}

function deployLambdaArtifact({
  targets,
  releaseId,
  lambdaFunctionName,
  artifact,
  variant,
  apiBaseUrl,
  apiReleaseId = releaseId,
  apiInternalToken
}) {
  const functionArn = `arn:aws:lambda:${targets.region}:${targets.accountId}:function:${lambdaFunctionName}`;
  awsJson(targets, "lambda", "update-function-code", [
    "--function-name",
    lambdaFunctionName,
    "--zip-file",
    `fileb://${artifact.path}`
  ], {
    resourceArn: functionArn,
    requiredAction: "lambda:UpdateFunctionCode"
  });
  waitForLambdaUpdated(targets, lambdaFunctionName);
  const current = awsJson(targets, "lambda", "get-function-configuration", [
    "--function-name",
    lambdaFunctionName
  ]);
  if (current.CodeSha256 !== artifact.codeSha256Base64) {
    throw new ReleaseError("Lambda code SHA readback mismatch after update", {
      expected: artifact.codeSha256Base64,
      actual: current.CodeSha256
    });
  }
  const envVars = {
    ...(current.Environment?.Variables || {}),
    VOICE_RELEASE_ID: releaseId,
    VOICE_SOURCE_SHA256: artifact.sourceHash,
    VOICE_VARIANT: variant,
    VOICE_LAMBDA_CODE_SHA256: artifact.codeSha256Base64,
    VOICE_API_RELEASE_ID: apiReleaseId,
    VOICE_API_VARIANT: variant,
    ...(apiBaseUrl ? { FASTAIBOOKING_API_BASE_URL: apiBaseUrl } : {}),
    ...(apiInternalToken ? { FASTAIBOOKING_API_INTERNAL_TOKEN: apiInternalToken } : {})
  };
  awsJson(targets, "lambda", "update-function-configuration", [
    "--function-name",
    lambdaFunctionName,
    "--cli-input-json",
    JSON.stringify({
      FunctionName: lambdaFunctionName,
      Environment: {
        Variables: envVars
      }
    })
  ], {
    resourceArn: functionArn,
    requiredAction: "lambda:UpdateFunctionConfiguration"
  });
  waitForLambdaUpdated(targets, lambdaFunctionName);
  const published = awsJson(targets, "lambda", "publish-version", [
    "--function-name",
    lambdaFunctionName,
    "--description",
    `FastAIBooking ${releaseId} ${variant}`
  ], {
    resourceArn: functionArn,
    requiredAction: "lambda:PublishVersion"
  });
  const aliasName = safeAliasName(releaseId);
  const aliasArn = lambdaAliasArn(targets, lambdaFunctionName, aliasName);
  try {
    awsJson(targets, "lambda", "create-alias", [
      "--function-name",
      lambdaFunctionName,
      "--name",
      aliasName,
      "--function-version",
      published.Version,
      "--description",
      `FastAIBooking ${releaseId} ${variant}`
    ], {
      resourceArn: aliasArn,
      requiredAction: "lambda:CreateAlias"
    });
  } catch (error) {
    if (!(error instanceof AwsOperationError) || error.details.code !== "ResourceConflictException") {
      throw error;
    }
    awsJson(targets, "lambda", "update-alias", [
      "--function-name",
      lambdaFunctionName,
      "--name",
      aliasName,
      "--function-version",
      published.Version,
      "--description",
      `FastAIBooking ${releaseId} ${variant}`
    ], {
      resourceArn: aliasArn,
      requiredAction: "lambda:UpdateAlias"
    });
  }
  const publishedConfiguration = awsJson(targets, "lambda", "get-function-configuration", [
    "--function-name",
    lambdaFunctionName,
    "--qualifier",
    published.Version
  ]);
  const deployedToken = publishedConfiguration.Environment?.Variables?.FASTAIBOOKING_API_INTERNAL_TOKEN || "";
  if (apiInternalToken && deployedToken !== apiInternalToken) {
    throw new ReleaseError("Lambda/API internal token parity check failed after Lambda publish", {
      functionName: lambdaFunctionName,
      variant,
      reason: "lambda_api_internal_token_mismatch"
    });
  }
  const release = {
    ...artifact,
    functionName: lambdaFunctionName,
    functionArn,
    publishedVersion: published.Version,
    publishedVersionArn: published.FunctionArn,
    aliasName,
    aliasArn,
    codeSha256Base64: published.CodeSha256,
    apiBaseUrl,
    apiInternalTokenParity: apiInternalToken ? "matched" : "not_checked",
    configuration: sanitizeLambdaConfig(publishedConfiguration)
  };
  writeReleaseFile(releaseId, "lambda-artifact.json", release);
  updateManifest(releaseId, { lambda: release });
  return release;
}

function waitForLexLocale(targets, botVersion = "DRAFT", allowedStatuses = ["Built", "ReadyExpressTesting", "NotBuilt"]) {
  const allowed = new Set(allowedStatuses);
  for (let attempt = 0; attempt < 90; attempt += 1) {
    let locale;
    try {
      locale = awsJson(targets, "lexv2-models", "describe-bot-locale", [
        "--bot-id",
        targets.lex.botId,
        "--bot-version",
        botVersion,
        "--locale-id",
        "en_US"
      ]);
    } catch (error) {
      if (error instanceof AwsOperationError && error.details.code === "ResourceNotFoundException") {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
        continue;
      }
      throw error;
    }
    const status = lexLocaleStatus(locale);
    if (status === "Failed") {
      throw new ReleaseError("Lex locale build failed", { locale });
    }
    if (allowed.has(status)) {
      return locale;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
  }
  throw new ReleaseError("Timed out waiting for Lex locale", { botVersion });
}

function syncLexSlotTypes(targets, releaseId) {
  const slotTypeDir = path.join(LOCALE_ROOT, "SlotTypes");
  const liveSlotTypes = listLexSlotTypeSummaries(targets);
  const liveByName = new Map(liveSlotTypes.map((slotType) => [slotType.slotTypeName, slotType]));
  const updated = [];
  for (const name of fs.readdirSync(slotTypeDir)) {
    const slotTypePath = path.join(slotTypeDir, name, "SlotType.json");
    if (!fs.existsSync(slotTypePath)) {
      continue;
    }
    const source = readJson(slotTypePath);
    const input = normalizedSlotTypeInput(source);
    const liveSlotType = liveByName.get(input.slotTypeName);
    const slotTypeId = liveSlotType?.slotTypeId || input.slotTypeId;
    const slotValuesPath = path.join(releaseDirFor(releaseId), `lex-${source.name}-slot-values.json`);
    const valueSelectionPath = path.join(releaseDirFor(releaseId), `lex-${source.name}-value-selection.json`);
    writeJson(slotValuesPath, input.slotTypeValues || []);
    writeJson(valueSelectionPath, input.valueSelectionSetting || { resolutionStrategy: "OriginalValue" });
    const commonArgs = [
      "--slot-type-name",
      input.slotTypeName,
      "--bot-id",
      targets.lex.botId,
      "--bot-version",
      "DRAFT",
      "--locale-id",
      "en_US",
      "--slot-type-values",
      `file://${slotValuesPath}`,
      "--value-selection-setting",
      `file://${valueSelectionPath}`
    ];
    if (input.description) {
      commonArgs.push("--description", input.description);
    }
    if (input.parentSlotTypeSignature) {
      commonArgs.push("--parent-slot-type-signature", input.parentSlotTypeSignature);
    }
    let deployedSlotTypeId = slotTypeId;
    if (liveSlotType) {
      awsJson(targets, "lexv2-models", "update-slot-type", [
        "--slot-type-id",
        slotTypeId,
        ...commonArgs
      ], {
        resourceArn: `arn:aws:lex:${targets.region}:${targets.accountId}:bot/${targets.lex.botId}`,
        requiredAction: "lex:UpdateSlotType"
      });
    } else {
      const created = awsJson(targets, "lexv2-models", "create-slot-type", commonArgs, {
        resourceArn: `arn:aws:lex:${targets.region}:${targets.accountId}:bot/${targets.lex.botId}`,
        requiredAction: "lex:CreateSlotType"
      });
      deployedSlotTypeId = pick(created, "slotTypeId", "SlotTypeId");
    }
    updated.push({
      name: input.slotTypeName,
      id: deployedSlotTypeId,
      sourceId: input.slotTypeId,
      reconciledByName: Boolean(liveSlotType && deployedSlotTypeId !== input.slotTypeId),
      valueSelectionSetting: input.valueSelectionSetting
    });
  }
  return updated;
}

function listLexSlotTypeSummaries(targets) {
  const summaries = [];
  let nextToken = "";
  do {
    const args = [
      "--bot-id",
      targets.lex.botId,
      "--bot-version",
      "DRAFT",
      "--locale-id",
      "en_US",
      "--max-results",
      "100"
    ];
    if (nextToken) {
      args.push("--next-token", nextToken);
    }
    const data = awsJson(targets, "lexv2-models", "list-slot-types", args);
    summaries.push(...(data.slotTypeSummaries ?? []));
    nextToken = data.nextToken || "";
  } while (nextToken);
  return summaries;
}

function listCustomVocabularyItems(targets, botVersion = "DRAFT") {
  const items = [];
  let nextToken = "";
  do {
    const args = [
      "--bot-id",
      targets.lex.botId,
      "--bot-version",
      botVersion,
      "--locale-id",
      "en_US",
      "--max-results",
      "100"
    ];
    if (nextToken) {
      args.push("--next-token", nextToken);
    }
    const data = awsJson(targets, "lexv2-models", "list-custom-vocabulary-items", args);
    items.push(...(data.customVocabularyItems ?? []));
    nextToken = data.nextToken || "";
  } while (nextToken);
  return items;
}

const batch = (values, size = 100) => {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};

function syncCustomVocabulary(targets, releaseId) {
  const source = readJson(path.join(LOCALE_ROOT, "CustomVocabulary.json"));
  const desired = source.customVocabularyItems ?? [];
  const current = listCustomVocabularyItems(targets, "DRAFT");
  const byPhrase = new Map(current.map((item) => [String(item.phrase).toLowerCase(), item]));
  const creates = [];
  const updates = [];
  const deletes = [];
  for (const item of desired) {
    const existing = byPhrase.get(String(item.phrase).toLowerCase());
    if (!existing) {
      creates.push(item);
      continue;
    }
    if (existing.displayAs !== item.displayAs || Number(existing.weight ?? 1) !== Number(item.weight ?? 1)) {
      updates.push({
        itemId: existing.itemId,
        phrase: item.phrase,
        weight: item.weight,
        displayAs: item.displayAs
      });
    }
  }
  for (const phrase of FORBIDDEN_REPAIR_VOCABULARY) {
    const existing = byPhrase.get(phrase.toLowerCase());
    if (existing?.itemId) {
      deletes.push({ itemId: existing.itemId });
    }
  }
  for (const chunk of batch(creates)) {
    awsJson(targets, "lexv2-models", "batch-create-custom-vocabulary-item", [
      "--bot-id",
      targets.lex.botId,
      "--bot-version",
      "DRAFT",
      "--locale-id",
      "en_US",
      "--custom-vocabulary-item-list",
      JSON.stringify(chunk)
    ], {
      requiredAction: "lex:BatchCreateCustomVocabularyItem"
    });
  }
  for (const chunk of batch(updates)) {
    awsJson(targets, "lexv2-models", "batch-update-custom-vocabulary-item", [
      "--bot-id",
      targets.lex.botId,
      "--bot-version",
      "DRAFT",
      "--locale-id",
      "en_US",
      "--custom-vocabulary-item-list",
      JSON.stringify(chunk)
    ], {
      requiredAction: "lex:BatchUpdateCustomVocabularyItem"
    });
  }
  for (const chunk of batch(deletes)) {
    awsJson(targets, "lexv2-models", "batch-delete-custom-vocabulary-item", [
      "--bot-id",
      targets.lex.botId,
      "--bot-version",
      "DRAFT",
      "--locale-id",
      "en_US",
      "--custom-vocabulary-item-list",
      JSON.stringify(chunk)
    ], {
      requiredAction: "lex:BatchDeleteCustomVocabularyItem"
    });
  }
  return { creates: creates.length, updates: updates.length, deletes: deletes.length };
}

function listLexIntentSummaries(targets) {
  const summaries = [];
  let nextToken = "";
  do {
    const args = [
      "--bot-id",
      targets.lex.botId,
      "--bot-version",
      "DRAFT",
      "--locale-id",
      "en_US",
      "--max-results",
      "100"
    ];
    if (nextToken) {
      args.push("--next-token", nextToken);
    }
    const data = awsJson(targets, "lexv2-models", "list-intents", args);
    summaries.push(...(data.intentSummaries ?? []));
    nextToken = data.nextToken || "";
  } while (nextToken);
  return summaries;
}

function listLexSlotsForIntent(targets, intentId) {
  const slots = [];
  let nextToken = "";
  do {
    const args = [
      "--bot-id",
      targets.lex.botId,
      "--bot-version",
      "DRAFT",
      "--locale-id",
      "en_US",
      "--intent-id",
      intentId,
      "--max-results",
      "100"
    ];
    if (nextToken) {
      args.push("--next-token", nextToken);
    }
    const data = awsJson(targets, "lexv2-models", "list-slots", args);
    slots.push(...(data.slotSummaries ?? []));
    nextToken = data.nextToken || "";
  } while (nextToken);
  return slots;
}

function normalizeLexUpdateValue(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeLexUpdateValue(entry))
      .filter((entry) => entry !== undefined);
  }
  if (!value || typeof value !== "object") {
    return value === null ? undefined : value;
  }
  const normalized = {};
  for (const [rawKey, rawEntry] of Object.entries(value)) {
    const entry = normalizeLexUpdateValue(rawEntry);
    if (entry === undefined) {
      continue;
    }
    const key =
      rawKey === "isActive" ? "active" :
      rawKey === "messageGroupsList" ? "messageGroups" :
      rawKey;
    normalized[key] = entry;
  }
  return normalized;
}

function normalizedIntentSlotPriorities(targets, intentId, sourcePriorities = []) {
  if (!sourcePriorities.length) {
    return [];
  }
  const liveSlots = listLexSlotsForIntent(targets, intentId);
  const slotsByName = new Map(liveSlots.map((slot) => [slot.slotName, slot.slotId]));
  return sourcePriorities.map((entry) => {
    const slotId = entry.slotId || slotsByName.get(entry.slotName);
    if (!slotId) {
      throw new ReleaseError("Unable to map Lex intent slot priority to live slot ID", {
        intentId,
        slotName: entry.slotName || "",
        priority: entry.priority
      });
    }
    return {
      priority: entry.priority,
      slotId
    };
  });
}

function extractLexResponseText(response) {
  return (response?.messageGroups || response?.messageGroupsList || [])
    .map((group) => {
      const message = group?.message || {};
      return (
        message?.plainTextMessage?.value ||
        message?.ssmlMessage?.value ||
        message?.customPayload?.value ||
        ""
      ).trim();
    })
    .filter(Boolean)
    .join(" ");
}

function validateIntentReadback({ source, readback }) {
  const failures = [];
  const sourceUtterances = (source.sampleUtterances || []).map((entry) => entry.utterance).filter(Boolean);
  const readbackUtterances = new Set((readback.sampleUtterances || []).map((entry) => entry.utterance));
  for (const utterance of sourceUtterances) {
    if (!readbackUtterances.has(utterance)) {
      failures.push(`missing sample utterance: ${utterance}`);
    }
  }
  const sourceClosingText = extractLexResponseText(source.intentClosingSetting?.closingResponse);
  if (sourceClosingText) {
    const readbackClosingText = extractLexResponseText(readback.intentClosingSetting?.closingResponse);
    if (readbackClosingText !== sourceClosingText) {
      failures.push(`closing response mismatch: expected ${sourceClosingText}, got ${readbackClosingText || "(empty)"}`);
    }
  }
  if (failures.length) {
    throw new ReleaseError("Lex intent readback mismatch after update", {
      intentName: source.name,
      failures
    });
  }
}

function syncLexIntents(targets, releaseId) {
  const intentRoot = path.join(LOCALE_ROOT, "Intents");
  const liveIntents = listLexIntentSummaries(targets);
  const liveByName = new Map(liveIntents.map((intent) => [intent.intentName, intent]));
  const updated = [];
  for (const name of fs.readdirSync(intentRoot)) {
    const intentPath = path.join(intentRoot, name, "Intent.json");
    if (!fs.existsSync(intentPath)) {
      continue;
    }
    const source = readJson(intentPath);
    const liveIntent = liveByName.get(source.name);
    const intentId = liveIntent?.intentId || source.identifier;
    if (!intentId) {
      throw new ReleaseError("Lex source intent is missing a live intent ID", { intentName: source.name });
    }
    const input = {
      intentId,
      intentName: source.name,
      botId: targets.lex.botId,
      botVersion: "DRAFT",
      localeId: "en_US"
    };
    for (const [sourceKey, targetKey] of [
      ["description", "description"],
      ["parentIntentSignature", "parentIntentSignature"],
      ["sampleUtterances", "sampleUtterances"],
      ["dialogCodeHook", "dialogCodeHook"],
      ["fulfillmentCodeHook", "fulfillmentCodeHook"],
      ["intentConfirmationSetting", "intentConfirmationSetting"],
      ["intentClosingSetting", "intentClosingSetting"],
      ["initialResponseSetting", "initialResponseSetting"],
      ["inputContexts", "inputContexts"],
      ["outputContexts", "outputContexts"],
      ["kendraConfiguration", "kendraConfiguration"],
      ["qnAIntentConfiguration", "qnAIntentConfiguration"],
      ["bedrockAgentIntentConfiguration", "bedrockAgentIntentConfiguration"],
      ["qInConnectIntentConfiguration", "qInConnectIntentConfiguration"]
    ]) {
      const value = normalizeLexUpdateValue(source[sourceKey]);
      if (value !== undefined) {
        input[targetKey] = value;
      }
    }
    const slotPriorities = normalizedIntentSlotPriorities(targets, intentId, source.slotPriorities || []);
    if (slotPriorities.length) {
      input.slotPriorities = slotPriorities;
    }
    const inputPath = path.join(releaseDirFor(releaseId), `lex-${source.name}-intent-update.json`);
    writeJson(inputPath, input);
    awsJson(targets, "lexv2-models", "update-intent", [
      "--cli-input-json",
      `file://${inputPath}`
    ], {
      resourceArn: `arn:aws:lex:${targets.region}:${targets.accountId}:bot/${targets.lex.botId}`,
      requiredAction: "lex:UpdateIntent"
    });
    const readback = awsJson(targets, "lexv2-models", "describe-intent", [
      "--bot-id",
      targets.lex.botId,
      "--bot-version",
      "DRAFT",
      "--locale-id",
      "en_US",
      "--intent-id",
      intentId
    ]);
    validateIntentReadback({ source, readback });
    updated.push({
      name: source.name,
      id: intentId,
      sampleUtteranceCount: source.sampleUtterances?.length || 0,
      hasClosingResponse: Boolean(extractLexResponseText(source.intentClosingSetting?.closingResponse))
    });
  }
  return updated;
}

function cloneConversationLogs(sourceAlias) {
  return pick(sourceAlias, "conversationLogSettings", "ConversationLogSettings") || undefined;
}

function findBotAliasByName(targets, aliasName) {
  let nextToken = "";
  do {
    const args = ["--bot-id", targets.lex.botId, "--max-results", "50"];
    if (nextToken) {
      args.push("--next-token", nextToken);
    }
    const data = awsJson(targets, "lexv2-models", "list-bot-aliases", args);
    const match = (data.botAliasSummaries ?? []).find((alias) => alias.botAliasName === aliasName);
    if (match) {
      return match;
    }
    nextToken = data.nextToken || "";
  } while (nextToken);
  return null;
}

function waitForLexAliasAvailable(targets, aliasId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const alias = awsJson(targets, "lexv2-models", "describe-bot-alias", [
      "--bot-id",
      targets.lex.botId,
      "--bot-alias-id",
      aliasId
    ]);
    const status = pick(alias, "botAliasStatus", "BotAliasStatus");
    if (status === "Available") {
      return alias;
    }
    if (status === "Failed") {
      throw new ReleaseError("Lex alias update failed", { aliasId, alias });
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5000);
  }
  throw new ReleaseError("Timed out waiting for Lex alias to become Available", { aliasId });
}

function createOrUpdateLexAlias({ targets, releaseId, target, botVersion, lambdaArn, cloneAliasId }) {
  const aliasName = safeAliasName(`${target}-${releaseId}`);
  const existing = findBotAliasByName(targets, aliasName);
  const clone = cloneAliasId
    ? awsJson(targets, "lexv2-models", "describe-bot-alias", [
        "--bot-id",
        targets.lex.botId,
        "--bot-alias-id",
        cloneAliasId
      ])
    : null;
  const localeSettings = {
    en_US: {
      enabled: true,
      codeHookSpecification: {
        lambdaCodeHook: {
          lambdaARN: lambdaArn,
          codeHookInterfaceVersion: "1.0"
        }
      }
    }
  };
  const commonArgs = [
    "--bot-version",
    String(botVersion),
    "--bot-alias-locale-settings",
    JSON.stringify(localeSettings),
    "--description",
    `FastAIBooking ${releaseId} ${target}`
  ];
  const conversationLogs = cloneConversationLogs(clone);
  if (conversationLogs) {
    commonArgs.push("--conversation-log-settings", JSON.stringify(conversationLogs));
  }
  let alias;
  if (existing) {
    alias = awsJson(targets, "lexv2-models", "update-bot-alias", [
      "--bot-id",
      targets.lex.botId,
      "--bot-alias-id",
      existing.botAliasId,
      "--bot-alias-name",
      aliasName,
      ...commonArgs
    ], {
      requiredAction: "lex:UpdateBotAlias"
    });
  } else {
    try {
      alias = awsJson(targets, "lexv2-models", "create-bot-alias", [
        "--bot-id",
        targets.lex.botId,
        "--bot-alias-name",
        aliasName,
        ...commonArgs
      ], {
        requiredAction: "lex:CreateBotAlias"
      });
    } catch (error) {
      if (!(error instanceof AwsOperationError) || error.details.code !== "ServiceQuotaExceededException" || !clone) {
        throw error;
      }
      alias = awsJson(targets, "lexv2-models", "update-bot-alias", [
        "--bot-id",
        targets.lex.botId,
        "--bot-alias-id",
        cloneAliasId,
        "--bot-alias-name",
        lexAliasNameFrom(clone),
        ...commonArgs
      ], {
        requiredAction: "lex:UpdateBotAlias"
      });
    }
  }
  const readyAlias = waitForLexAliasAvailable(targets, lexAliasIdFrom(alias));
  return {
    aliasId: lexAliasIdFrom(readyAlias),
    aliasName: lexAliasNameFrom(readyAlias),
    aliasArn: lexAliasArn(targets, lexAliasIdFrom(readyAlias)),
    status: pick(readyAlias, "botAliasStatus", "BotAliasStatus"),
    botVersion: lexAliasBotVersionFrom(readyAlias),
    lambdaArn: lexAliasLocaleSettingsFrom(readyAlias)?.en_US?.codeHookSpecification?.lambdaCodeHook?.lambdaARN
  };
}

function addLexLambdaPermission({ targets, lambdaFunctionName, lambdaAliasName, lexAliasArnValue }) {
  const statementId = safeAliasName(`lex-${lexAliasArnValue.split("/").pop()}-${lambdaAliasName}`).slice(0, 90);
  try {
    awsJson(targets, "lambda", "add-permission", [
      "--function-name",
      lambdaFunctionName,
      "--qualifier",
      lambdaAliasName,
      "--statement-id",
      statementId,
      "--action",
      "lambda:InvokeFunction",
      "--principal",
      "lexv2.amazonaws.com",
      "--source-arn",
      lexAliasArnValue,
      "--source-account",
      targets.accountId
    ], {
      resourceArn: lambdaAliasArn(targets, lambdaFunctionName, lambdaAliasName),
      requiredAction: "lambda:AddPermission"
    });
  } catch (error) {
    if (!(error instanceof AwsOperationError) || error.details.code !== "ResourceConflictException") {
      throw error;
    }
  }
}

function associateLexAliasWithConnect({ targets, lexAliasArnValue }) {
  const listed = awsJson(targets, "connect", "list-bots", [
    "--instance-id",
    targets.connect.instanceId,
    "--lex-version",
    "V2",
    "--max-results",
    "100"
  ], {
    requiredAction: "connect:ListBots"
  });
  const alreadyAssociated = (listed.LexBots || []).some(
    (entry) => entry?.LexV2Bot?.AliasArn === lexAliasArnValue
  );
  if (alreadyAssociated) {
    return { associated: true, alreadyAssociated: true, aliasArn: lexAliasArnValue };
  }
  awsJson(targets, "connect", "associate-bot", [
    "--instance-id",
    targets.connect.instanceId,
    "--lex-v2-bot",
    `AliasArn=${lexAliasArnValue}`
  ], {
    resourceArn: `arn:aws:connect:${targets.region}:${targets.accountId}:instance/${targets.connect.instanceId}`,
    requiredAction: "connect:AssociateBot"
  });
  return { associated: true, alreadyAssociated: false, aliasArn: lexAliasArnValue };
}

function applyLexDraftAndPublish({ targets, releaseId, lambdaRelease, sourceHash }) {
  const lexSource = validateLexSource();
  waitForLexLocale(targets, "DRAFT");
  const localeSource = readJson(path.join(LOCALE_ROOT, "BotLocale.json"));
  const draftLocaleUpdate = updateLexLocaleSpeechSettings(targets, localeSource);
  waitForLexLocale(targets, "DRAFT");
  const draftLocaleSpeechReadback = describeLexLocaleRaw(targets, "DRAFT");
  if (
    localeSource.unifiedSpeechSettings &&
    (draftLocaleSpeechReadback.unifiedSpeechSettings?.speechFoundationModel?.modelArn !==
      localeSource.unifiedSpeechSettings.speechFoundationModel.modelArn ||
      draftLocaleSpeechReadback.unifiedSpeechSettings?.speechFoundationModel?.voiceId !==
        localeSource.unifiedSpeechSettings.speechFoundationModel.voiceId ||
      draftLocaleSpeechReadback.audioFillerSettings?.enabled !== true ||
      draftLocaleSpeechReadback.audioFillerSettings?.audioType !==
        localeSource.audioFillerSettings.audioType)
  ) {
    throw new ReleaseError("Lex DRAFT unified speech or audio filler readback mismatch", {
      expectedUnifiedSpeech: localeSource.unifiedSpeechSettings,
      actualUnifiedSpeech: draftLocaleSpeechReadback.unifiedSpeechSettings || null,
      expectedAudioFiller: localeSource.audioFillerSettings,
      actualAudioFiller: draftLocaleSpeechReadback.audioFillerSettings || null
    });
  }
  if (
    !localeSource.unifiedSpeechSettings &&
    draftLocaleSpeechReadback.speechRecognitionSettings?.speechModelPreference !== "Neural"
  ) {
    throw new ReleaseError("Lex DRAFT speech model readback mismatch", {
      expected: "Neural",
      actual: draftLocaleSpeechReadback.speechRecognitionSettings?.speechModelPreference || null
    });
  }
  if (
    !localeSource.unifiedSpeechSettings &&
    (draftLocaleSpeechReadback.unifiedSpeechSettings ||
      draftLocaleSpeechReadback.audioFillerSettings?.enabled === true)
  ) {
    throw new ReleaseError("Lex DRAFT retained incompatible unified speech settings", {
      actualUnifiedSpeech: draftLocaleSpeechReadback.unifiedSpeechSettings || null,
      actualAudioFiller: draftLocaleSpeechReadback.audioFillerSettings || null
    });
  }
  if (draftLocaleSpeechReadback.speechDetectionSensitivity !== "Default") {
    throw new ReleaseError("Lex DRAFT speech detection sensitivity readback mismatch", {
      expected: "Default",
      actual: draftLocaleSpeechReadback.speechDetectionSensitivity || null
    });
  }
  const slotTypes = syncLexSlotTypes(targets, releaseId);
  const vocabularySync = syncCustomVocabulary(targets, releaseId);
  const intents = syncLexIntents(targets, releaseId);
  awsJson(targets, "lexv2-models", "build-bot-locale", [
    "--bot-id",
    targets.lex.botId,
    "--bot-version",
    "DRAFT",
    "--locale-id",
    "en_US"
  ], {
    requiredAction: "lex:BuildBotLocale"
  });
  const draftLocale = waitForLexLocale(targets, "DRAFT", ["Built", "ReadyExpressTesting"]);
  const version = awsJson(targets, "lexv2-models", "create-bot-version", [
    "--bot-id",
    targets.lex.botId,
    "--description",
    `FastAIBooking ${releaseId}`,
    "--bot-version-locale-specification",
    JSON.stringify({ en_US: { sourceBotVersion: "DRAFT" } })
  ], {
    requiredAction: "lex:CreateBotVersion"
  });
  const botVersion = pick(version, "botVersion", "BotVersion");
  const versionLocale = waitForLexLocale(targets, botVersion, ["Built", "ReadyExpressTesting"]);
  const versionLocaleSpeechReadback = describeLexLocaleRaw(targets, botVersion);
  const speechModelPreferenceReadback =
    versionLocaleSpeechReadback.speechRecognitionSettings?.speechModelPreference || "";
  const unifiedSpeechSettingsReadback = versionLocaleSpeechReadback.unifiedSpeechSettings || null;
  const audioFillerSettingsReadback = versionLocaleSpeechReadback.audioFillerSettings || null;
  const speechDetectionSensitivityReadback = versionLocaleSpeechReadback.speechDetectionSensitivity || "";
  if (
    localeSource.unifiedSpeechSettings &&
    (unifiedSpeechSettingsReadback?.speechFoundationModel?.modelArn !==
      localeSource.unifiedSpeechSettings.speechFoundationModel.modelArn ||
      unifiedSpeechSettingsReadback?.speechFoundationModel?.voiceId !==
        localeSource.unifiedSpeechSettings.speechFoundationModel.voiceId ||
      audioFillerSettingsReadback?.enabled !== true ||
      audioFillerSettingsReadback?.audioType !== localeSource.audioFillerSettings.audioType)
  ) {
    throw new ReleaseError("Lex version unified speech or audio filler readback mismatch", {
      expectedUnifiedSpeech: localeSource.unifiedSpeechSettings,
      actualUnifiedSpeech: unifiedSpeechSettingsReadback,
      expectedAudioFiller: localeSource.audioFillerSettings,
      actualAudioFiller: audioFillerSettingsReadback,
      botVersion
    });
  }
  if (!localeSource.unifiedSpeechSettings && speechModelPreferenceReadback !== "Neural") {
    throw new ReleaseError("Lex version speech model readback mismatch", {
      expected: "Neural",
      actual: speechModelPreferenceReadback || null,
      botVersion
    });
  }
  if (
    !localeSource.unifiedSpeechSettings &&
    (unifiedSpeechSettingsReadback || audioFillerSettingsReadback?.enabled === true)
  ) {
    throw new ReleaseError("Lex version retained incompatible unified speech settings", {
      actualUnifiedSpeech: unifiedSpeechSettingsReadback,
      actualAudioFiller: audioFillerSettingsReadback,
      botVersion
    });
  }
  if (speechDetectionSensitivityReadback !== "Default") {
    throw new ReleaseError("Lex version speech detection sensitivity readback mismatch", {
      expected: "Default",
      actual: speechDetectionSensitivityReadback || null,
      botVersion
    });
  }
  const alias = createOrUpdateLexAlias({
    targets,
    releaseId,
    target: "canary",
    botVersion,
    lambdaArn: lambdaRelease.aliasArn,
    cloneAliasId: targets.lex.aliases.canary.id
  });
  addLexLambdaPermission({
    targets,
    lambdaFunctionName: lambdaRelease.functionName,
    lambdaAliasName: lambdaRelease.aliasName,
    lexAliasArnValue: alias.aliasArn
  });
  const connectAssociation = associateLexAliasWithConnect({
    targets,
    lexAliasArnValue: alias.aliasArn
  });
  const serviceSlotTypeId = slotTypes.find((slotType) => slotType.name === "NailServiceType")?.id;
  const staffSlotTypeId = slotTypes.find((slotType) => slotType.name === "StaffPreferenceType")?.id;
  if (!serviceSlotTypeId || !staffSlotTypeId) {
    throw new ReleaseError("Missing deployed service or staff slot type ID", { slotTypes });
  }
  const readbackServiceSlot = awsJson(targets, "lexv2-models", "describe-slot-type", [
    "--bot-id",
    targets.lex.botId,
    "--bot-version",
    botVersion,
    "--locale-id",
    "en_US",
    "--slot-type-id",
    serviceSlotTypeId
  ]);
  const readbackStaffSlot = awsJson(targets, "lexv2-models", "describe-slot-type", [
    "--bot-id",
    targets.lex.botId,
    "--bot-version",
    botVersion,
    "--locale-id",
    "en_US",
    "--slot-type-id",
    staffSlotTypeId
  ]);
  const readbackVocabulary = listCustomVocabularyItems(targets, botVersion);
  const lexArtifact = {
    releaseId,
    botId: targets.lex.botId,
    sourceConfigurationHash: sourceLexConfigurationHash(),
    sourceHash,
    sourceSettings: lexSource,
    draftLocaleUpdate,
    draftLocaleSpeechReadback: {
      speechRecognitionSettings: draftLocaleSpeechReadback.speechRecognitionSettings,
      unifiedSpeechSettings: draftLocaleSpeechReadback.unifiedSpeechSettings,
      audioFillerSettings: draftLocaleSpeechReadback.audioFillerSettings,
      speechDetectionSensitivity: draftLocaleSpeechReadback.speechDetectionSensitivity
    },
    draftLocaleStatus: lexLocaleStatus(draftLocale),
    botVersion,
    versionLocaleBuildStatus: lexLocaleStatus(versionLocale),
    speechMode: localeSource.unifiedSpeechSettings ? "unified" : "neural_stt",
    speechModelPreference: localeSource.speechRecognitionSettings?.speechModelPreference || null,
    speechModelPreferenceReadback,
    unifiedSpeechSettings: localeSource.unifiedSpeechSettings || null,
    unifiedSpeechSettingsReadback,
    audioFillerSettings: localeSource.audioFillerSettings || null,
    audioFillerSettingsReadback,
    speechDetectionSensitivity: speechDetectionSensitivityReadback,
    slotTypes,
    intents,
    vocabularySync,
    serviceSlotReadback: {
      id: pick(readbackServiceSlot, "slotTypeId", "SlotTypeId"),
      valueSelectionSetting: pick(readbackServiceSlot, "valueSelectionSetting", "ValueSelectionSetting")
    },
    staffSlotReadback: {
      id: pick(readbackStaffSlot, "slotTypeId", "SlotTypeId"),
      valueSelectionSetting: pick(readbackStaffSlot, "valueSelectionSetting", "ValueSelectionSetting")
    },
    customVocabularyReadbackPhrases: readbackVocabulary.map((item) => item.phrase),
    alias,
    connectAssociation
  };
  writeReleaseFile(releaseId, "lex-artifact.json", lexArtifact);
  updateManifest(releaseId, { lex: lexArtifact });
  return lexArtifact;
}

function updateConnectFlow({
  targets,
  releaseId,
  target,
  lexAlias,
  sourceHash,
  variant,
  lambdaRelease,
  apiRelease
}) {
  const { flow } = targetConfig(targets, target);
  const marker = `${releaseId}-${target}`;
  const { artifact, content } = generateConnectArtifact({
    releaseId,
    target,
    aliasArn: lexAlias.aliasArn,
    aliasName: lexAlias.aliasName,
    marker,
    sourceHash,
    variant,
    lexAliasId: lexAlias.aliasId,
    lexBotVersion: lexAlias.botVersion,
    lambdaFunctionName: lambdaRelease?.functionName,
    lambdaFunctionVersion: lambdaRelease?.publishedVersion,
    lambdaCodeSha256: lambdaRelease?.codeSha256Base64,
    apiReleaseId: apiRelease?.releaseId,
    apiVariant: apiRelease?.variant || variant
  });
  awsJson(targets, "connect", "update-contact-flow-content", [
    "--instance-id",
    targets.connect.instanceId,
    "--contact-flow-id",
    flow.id,
    "--content",
    `file://${artifact.path}`
  ], {
    resourceArn: `arn:aws:connect:${targets.region}:${targets.accountId}:instance/${targets.connect.instanceId}/contact-flow/${flow.id}`,
    requiredAction: "connect:UpdateContactFlowContent"
  });
  return { artifact, content };
}

function readbackConnectFlow(targets, flowId) {
  const live = awsJson(targets, "connect", "describe-contact-flow", [
    "--instance-id",
    targets.connect.instanceId,
    "--contact-flow-id",
    flowId
  ]);
  const content = JSON.parse(live.ContactFlow.Content);
  return {
    flowId: live.ContactFlow.Id,
    name: live.ContactFlow.Name,
    status: live.ContactFlow.Status,
    state: live.ContactFlow.State,
    marker: findConnectMarker(content),
    normalizedSha256: connectFlowNormalizedSha256(content),
    aliasArns: Array.from(
      new Set(
        reachableActions(content)
          .filter((action) => action.Type === "ConnectParticipantWithLexBot")
          .map((action) => action.Parameters?.LexV2Bot?.AliasArn)
        .filter(Boolean)
      )
    ),
    releaseAttributes: reachableActions(content)
      .filter((action) => action.Type === "ConnectParticipantWithLexBot")
      .map((action) => action.Parameters?.LexSessionAttributes || {})
  };
}

function readbackCanary({ targets, releaseId, apiRelease, lambdaRelease, lexArtifact, connectArtifact }) {
  const { flow } = targetConfig(targets, "canary");
  const lambdaConfig = awsJson(targets, "lambda", "get-function-configuration", [
    "--function-name",
    lambdaRelease.functionName,
    "--qualifier",
    lambdaRelease.aliasName
  ]);
  const alias = awsJson(targets, "lexv2-models", "describe-bot-alias", [
    "--bot-id",
    targets.lex.botId,
    "--bot-alias-id",
    lexArtifact.alias.aliasId
  ]);
  const locale = awsJson(targets, "lexv2-models", "describe-bot-locale", [
    "--bot-id",
    targets.lex.botId,
    "--bot-version",
    lexArtifact.botVersion,
    "--locale-id",
    "en_US"
  ]);
  const connect = readbackConnectFlow(targets, flow.id);
  const readback = {
    releaseId,
    status: "CANARY_READY_FOR_HUMAN_PSTN",
    api: apiRelease?.canaryReadback,
    lambda: {
      functionName: lambdaRelease.functionName,
      aliasName: lambdaRelease.aliasName,
      aliasArn: lambdaRelease.aliasArn,
      version: lambdaConfig.Version,
      codeSha256Base64: lambdaConfig.CodeSha256,
      lastModified: lambdaConfig.LastModified
    },
    lex: {
      botId: targets.lex.botId,
      aliasId: lexAliasIdFrom(alias),
      aliasName: lexAliasNameFrom(alias),
      aliasArn: lexArtifact.alias.aliasArn,
      botVersion: lexAliasBotVersionFrom(alias),
      status: pick(alias, "botAliasStatus", "BotAliasStatus"),
      localeBuildStatus: lexLocaleStatus(locale),
      speechMode: lexArtifact.speechMode,
      speechModelPreference: lexArtifact.speechModelPreference,
      speechModelPreferenceReadback: lexArtifact.speechModelPreferenceReadback,
      unifiedSpeechSettings: lexArtifact.unifiedSpeechSettingsReadback,
      audioFillerSettings: lexArtifact.audioFillerSettingsReadback,
      speechDetectionSensitivity: lexArtifact.speechDetectionSensitivity,
      lambdaArn: lexAliasLocaleSettingsFrom(alias)?.en_US?.codeHookSpecification?.lambdaCodeHook?.lambdaARN
    },
    connect,
    connectArtifactSha256: connectArtifact.normalizedSha256
  };
  assertReadbackMatchesManifest(
    {
      api: readback.api,
      lambda: readback.lambda,
      lex: readback.lex,
      connect: readback.connect
    },
    {
      releaseId,
      sourceHash: lambdaRelease.sourceHash,
      api: apiRelease,
      lambda: lambdaRelease,
      lex: { botVersion: lexArtifact.botVersion },
      connect: {
        normalizedSha256: connectArtifact.normalizedSha256,
        marker: connectArtifact.marker
      }
    }
  );
  writeReleaseFile(releaseId, "canary-readback.json", readback);
  updateManifest(releaseId, {
    status: "CANARY_READY_FOR_HUMAN_PSTN",
    canaryDeploy: readback,
    api: apiRelease,
    connect: { canary: connectArtifact }
  });
  return readback;
}

function initializeReleaseFiles(releaseId) {
  for (const [file, value] of [
    ["canary-acceptance.json", { releaseId, status: "PENDING_HUMAN_PSTN", cases: [] }],
    ["production-promotion.json", { releaseId, status: "NOT_STARTED" }],
    ["production-readback.json", { releaseId, status: "NOT_STARTED" }],
    ["post-production-acceptance.json", { releaseId, status: "NOT_STARTED", cases: [] }],
    ["rollback.json", { releaseId, status: "NOT_REQUIRED", restored: false }]
  ]) {
    const filePath = path.join(releaseDirFor(releaseId), file);
    if (!fs.existsSync(filePath)) {
      writeJson(filePath, value);
    }
  }
}

function writeFinalReport({ releaseId, status, canaryReadback, blocker = null }) {
  const manifest = loadExistingManifest(releaseId) || {};
  const sourceValidationPath = path.join(releaseDirFor(releaseId), "source-validation.json");
  const sourceValidation = fs.existsSync(sourceValidationPath) ? readJson(sourceValidationPath) : null;
  const operationLogPath = path.join(releaseDirFor(releaseId), "operation-log.json");
  const operationLog = fs.existsSync(operationLogPath) ? readJson(operationLogPath) : [];
  const sourceValidationLines = Array.isArray(sourceValidation?.results)
    ? sourceValidation.results
        .map((result) => `- ${result.status}: \`${result.command}\``)
        .join("\n")
    : "Not run for this release.";
  const operationLogLines = Array.isArray(operationLog) && operationLog.length
    ? operationLog
        .map((entry) => `- ${entry.status}: \`${entry.action}\`${entry.target ? ` -> \`${entry.target}\`` : ""}`)
        .join("\n")
    : "None recorded.";
  const changedFiles = run("git", ["status", "--short"]).stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `- \`${line}\``)
    .join("\n") || "None.";
  const writeStatus =
    manifest.canaryDeploy?.status === "CANARY_READY_FOR_HUMAN_PSTN"
      ? "Canary API/Lambda/Lex/Connect writes completed; see canary-deploy.json."
      : manifest.productionPromotion?.status === "PROMOTED_PENDING_POST_PSTN"
        ? "Production promotion writes completed; see production-promotion.json."
        : "No API/Lambda/Lex/Connect deployment write completed for this release.";
  const instructions = canaryReadback
    ? `
## Human PSTN Test Instructions

Canary flow ID: \`${canaryReadback.connect.flowId}\`
Canary marker: \`${canaryReadback.connect.marker}\`
Lex alias: \`${canaryReadback.lex.aliasName}\` / \`${canaryReadback.lex.aliasId}\`
Lex bot version: \`${canaryReadback.lex.botVersion}\`
Lambda alias: \`${canaryReadback.lambda.aliasName}\`

Use a controlled Amazon Connect outbound test only for an authorized tester. Do not route general production traffic to this flow.

\`\`\`bash
aws connect start-outbound-voice-contact \\
  --profile nailnew \\
  --region us-east-1 \\
  --instance-id ${readTargets().connect.instanceId} \\
  --contact-flow-id ${canaryReadback.connect.flowId} \\
  --destination-phone-number '<AUTHORIZED_TESTER_E164>' \\
  --source-phone-number '<AUTHORIZED_CONNECT_SOURCE_NUMBER>' \\
  --attributes VOICE_RELEASE_ID=${releaseId},VOICE_VARIANT=canary
\`\`\`

After each call, import evidence:

\`\`\`bash
bash scripts/aws/deploy-voice-stack.sh record-canary-case \\
  --release ${releaseId} \\
  --contact-id '<CONTACT_ID>' \\
  --case-id C01 \\
  --round-id round-1 \\
  --tester-id '<TESTER_ID>'
\`\`\`

For batch import:

\`\`\`bash
bash scripts/aws/deploy-voice-stack.sh record-canary-case --release ${releaseId} --evidence diagnostics/releases/${releaseId}/human-pstn-evidence.json
\`\`\`
`
    : "";
  writeText(
    path.join(releaseDirFor(releaseId), "final-report.md"),
    `# FastAIBooking Voice Release ${releaseId}

Final status: \`${status}\`

Schema: \`${manifest.schemaVersion || ""}\`
Source hash: \`${manifest.sourceHash || ""}\`
Dirty-tree hash: \`${manifest.dirtyTreeHash || ""}\`
API source hash: \`${manifest.apiSourceHash || ""}\`
API image: \`${manifest.api?.imageTag || ""}\`
API canary readback: \`${manifest.api?.canaryReadback?.runtimeReleaseId || ""}\` / \`${manifest.api?.canaryReadback?.runtimeVariant || ""}\`
Lambda artifact: \`${manifest.lambda?.path || ""}\`
Lambda SHA-256: \`${manifest.lambda?.sha256 || ""}\`
Lambda CodeSha256: \`${manifest.lambda?.codeSha256Base64 || ""}\`
Lex bot version: \`${manifest.lex?.botVersion || ""}\`
Lex alias: \`${manifest.lex?.alias?.aliasName || ""}\` / \`${manifest.lex?.alias?.aliasId || ""}\`
Canary Connect marker: \`${manifest.connect?.canary?.marker || ""}\`
Canary Connect SHA-256: \`${manifest.connect?.canary?.normalizedSha256 || ""}\`

## Source Gates

Status: \`${sourceValidation?.status || "not_run"}\`

${sourceValidationLines}

## Modified Files

${changedFiles}

## Deployment Writes

${writeStatus}

Recorded operation log:

${operationLogLines}

Production status: \`${manifest.productionPromotion?.status || status}\`
Post-production verification status: \`${manifest.postProductionVerification?.status || manifest.postProductionAcceptance?.status || "NOT_STARTED"}\`
Rollback status: \`${manifest.rollback?.status || "NOT_REQUIRED"}\`

${blocker ? `## Blocker\n\n${blocker}\n` : ""}
${instructions}
Production was not changed unless \`production-promotion.json\` says otherwise.
`
  );
}

function deployCanary({ releaseId: requestedReleaseId, dryRun = false }) {
  const targets = readTargets();
  verifyIdentity(targets);
  const sourceHash = computeSourceHash();
  const apiSourceHash = computeApiSourceHash();
  const releaseId = resolveReleaseId(requestedReleaseId);
  fs.mkdirSync(releaseDirFor(releaseId), { recursive: true });
  const startedAt = new Date().toISOString();
  const plan = buildReleasePlan({ target: "canary", dryRun });
  const baseManifest = {
    schemaVersion: RELEASE_SCHEMA_VERSION,
    releaseId,
    status: dryRun ? "PLAN_ONLY" : "STARTED",
    startedAt,
    sourceCommit: run("git", ["rev-parse", "HEAD"]).stdout.trim(),
    dirtyTreeHash: computeDirtyTreeHash(),
    sourceHash,
    apiSourceHash,
    plan,
    targets: {
      accountId: targets.accountId,
      region: targets.region,
      connectInstanceId: targets.connect.instanceId,
      lexBotId: targets.lex.botId
    }
  };
  updateManifest(releaseId, baseManifest);
  initializeReleaseFiles(releaseId);
  const lexSource = validateLexSource();
  const lambdaArtifact = packageLambdaArtifact({ releaseId, sourceHash, variant: "canary" });
  updateManifest(releaseId, { lambda: lambdaArtifact });
  const provisionalAliasArn = lexAliasArn(targets, targets.lex.aliases.canary.id);
  const provisionalConnect = generateConnectArtifact({
    releaseId,
    target: "canary",
    aliasArn: provisionalAliasArn,
    aliasName: targets.lex.aliases.canary.name,
    marker: `${releaseId}-canary`,
    sourceHash,
    variant: "canary",
    lexAliasId: targets.lex.aliases.canary.id,
    lexBotVersion: "PLAN_ONLY",
    lambdaFunctionName: targets.lambda.functions.canary.name,
    lambdaFunctionVersion: "PLAN_ONLY",
    lambdaCodeSha256: lambdaArtifact.codeSha256Base64,
    apiReleaseId: releaseId,
    apiVariant: "canary"
  });
  updateManifest(releaseId, { connect: { canary: provisionalConnect.artifact } });
  if (dryRun) {
    writeReleaseFile(releaseId, "canary-deploy.json", {
      releaseId,
      status: "DRY_RUN",
      writes: [],
      plannedWrites: plan.plannedWrites
    });
    writeFinalReport({ releaseId, status: "PLAN_ONLY" });
    console.log(JSON.stringify({ releaseId, status: "DRY_RUN", releaseDir: releaseDirFor(releaseId), plannedWrites: plan.plannedWrites }, null, 2));
    return { releaseId, status: "DRY_RUN" };
  }
  assertSshAvailable(defaultEc2Config());
  const sourceValidation = runSourceGates(releaseId);
  const beforeProduction = captureTargetSnapshot(targets, "production", { releaseId, file: "before-production.json" });
  const beforeCanary = captureTargetSnapshot(targets, "canary", { releaseId, file: "before-canary.json" });
  const apiArtifact = buildApiArtifact({ releaseId, sourceHash, apiSourceHash });
  const canaryApi = deployCanaryApi({ releaseId, sourceHash, apiArtifact });
  const apiInternalToken = readApiInternalTokenFromEc2();
  updateManifest(releaseId, {
    before: {
      production: {
        connectMarker: beforeProduction.connect.marker,
        connectSha256: beforeProduction.connect.normalizedSha256,
        lexAliasId: lexAliasIdFrom(beforeProduction.lexAlias),
        lexBotVersion: lexAliasBotVersionFrom(beforeProduction.lexAlias),
        lambdaCodeSha256: beforeProduction.lambda?.CodeSha256
      },
      canary: {
        connectMarker: beforeCanary.connect.marker,
        connectSha256: beforeCanary.connect.normalizedSha256,
        lexAliasId: lexAliasIdFrom(beforeCanary.lexAlias),
        lexBotVersion: lexAliasBotVersionFrom(beforeCanary.lexAlias),
        lambdaCodeSha256: beforeCanary.lambda?.CodeSha256
      }
    }
  });
  const canaryLambda = deployLambdaArtifact({
    targets,
    releaseId,
    lambdaFunctionName: targets.lambda.functions.canary.name,
    artifact: lambdaArtifact,
    variant: "canary",
    apiBaseUrl: canaryApi.canaryBaseUrl,
    apiReleaseId: releaseId,
    apiInternalToken
  });
  const lexArtifact = applyLexDraftAndPublish({
    targets,
    releaseId,
    lambdaRelease: canaryLambda,
    sourceHash
  });
  const { artifact: connectArtifact } = updateConnectFlow({
    targets,
    releaseId,
    target: "canary",
    lexAlias: lexArtifact.alias,
    sourceHash,
    variant: "canary",
    lambdaRelease: canaryLambda,
    apiRelease: {
      releaseId,
      variant: "canary"
    }
  });
  const canaryReadback = readbackCanary({
    targets,
    releaseId,
    apiRelease: canaryApi,
    lambdaRelease: canaryLambda,
    lexArtifact,
    connectArtifact
  });
  const canaryDeploy = {
    releaseId,
    status: "CANARY_READY_FOR_HUMAN_PSTN",
    sourceValidation: sourceValidation.status,
    startedAt,
    completedAt: new Date().toISOString(),
    plannedWrites: plan.plannedWrites,
    api: canaryApi,
    lambda: canaryLambda,
    lex: lexArtifact,
    connect: connectArtifact
  };
  writeReleaseFile(releaseId, "canary-deploy.json", canaryDeploy);
  updateManifest(releaseId, {
    canaryDeploy,
    canaryReadyForHumanPstnAt: canaryDeploy.completedAt
  });
  writeFinalReport({ releaseId, status: "CANARY_READY_FOR_HUMAN_PSTN", canaryReadback });
  console.log(JSON.stringify({ releaseId, status: "CANARY_READY_FOR_HUMAN_PSTN", releaseDir: releaseDirFor(releaseId), canaryReadback }, null, 2));
  return { releaseId, status: "CANARY_READY_FOR_HUMAN_PSTN", canaryReadback };
}

function parseAcceptanceArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--contact-id") parsed.contactId = args[++index];
    else if (arg === "--case-id") parsed.caseId = args[++index];
    else if (arg === "--round-id") parsed.roundId = args[++index];
    else if (arg === "--tester-id") parsed.testerId = args[++index];
    else if (arg === "--result") parsed.result = args[++index];
    else if (arg === "--evidence") parsed.evidence = args[++index];
  }
  return parsed;
}

function fetchContactAttributes(targets, contactId) {
  return awsJson(targets, "connect", "get-contact-attributes", [
    "--instance-id",
    targets.connect.instanceId,
    "--initial-contact-id",
    contactId
  ]);
}

function fetchContactDetails(targets, contactId) {
  return awsJson(targets, "connect", "describe-contact", [
    "--instance-id",
    targets.connect.instanceId,
    "--contact-id",
    contactId
  ]);
}

const metric = (state, value = null, evidence = []) => ({ state, value, evidence });
const measured = (value, evidence = []) => metric("MEASURED", value, evidence);
const notApplicable = (evidence = []) => metric("NOT_APPLICABLE", null, evidence);
const missingMetric = (evidence = []) => metric("MISSING", null, evidence);

const normalizeMetricTime = (value) => {
  if (typeof value !== "string") return "";
  const match = value.match(/\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?\b/i);
  if (!match) return value.trim();
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

const evidenceRecord = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const latestTrustedSlots = (turns) => {
  const slots = {};
  for (const turn of turns) {
    Object.assign(slots, evidenceRecord(turn.trustedSlotsAfter), evidenceRecord(turn.sessionAttributesAfter));
  }
  return slots;
};

const turnText = (turn) =>
  String(turn.currentTurnTranscript || turn.aggregatedTranscript || turn.requestText || "").toLowerCase();

const responseText = (turn) =>
  String(turn.responseText || turn.promptText || evidenceRecord(turn.turnStateDiagnostics).promptText || "");

const parseVoiceDecisions = (turn) => {
  const value = turn.slotDecisions || evidenceRecord(turn.turnStateDiagnostics).voiceSlotDecisions;
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
};

const hasPromptPlaybackEvidence = (turns, index) => {
  const turn = turns[index];
  if (turn.promptPlaybackConfirmed === true || turn.promptPlaybackConfirmed === "true") {
    return true;
  }
  return Boolean(responseText(turn).trim() && turns[index + 1]?.currentTurnTranscript);
};

export function evaluateReleaseCase({ releaseId, caseId, rawEvidence, manifest, startedAfter }) {
  const definition = CASE_DEFINITIONS[caseId];
  if (!definition) {
    return {
      passed: false,
      failures: ["unknown_case_id"],
      metrics: Object.fromEntries(MANDATORY_METRICS.map((name) => [name, missingMetric(["unknown case"])]))
    };
  }
  const debug = evidenceRecord(rawEvidence.debug);
  const appEvidencePayload = evidenceRecord(rawEvidence.appEvidence?.data || rawEvidence.appEvidence);
  const turns = Array.isArray(debug.turnHistories) ? debug.turnHistories.map(evidenceRecord) : [];
  const bookingAttempts = Array.isArray(debug.bookingAttempts) ? debug.bookingAttempts.map(evidenceRecord) : [];
  const contactAttributes = evidenceRecord(rawEvidence.connectAttributes?.Attributes);
  const identities = Array.isArray(appEvidencePayload.releaseIdentities)
    ? appEvidencePayload.releaseIdentities.map(evidenceRecord)
    : [];
  const finalSlots = latestTrustedSlots(turns);
  const allTexts = turns.map(turnText).join(" ");
  const finalService = String(finalSlots.serviceName || evidenceRecord(bookingAttempts.at(-1)?.normalizedRequest).serviceName || "");
  const finalStaff = String(finalSlots.staffPreference || evidenceRecord(bookingAttempts.at(-1)?.normalizedRequest).staffPreference || "");
  const finalDate = String(finalSlots.requestedDate || evidenceRecord(bookingAttempts.at(-1)?.normalizedRequest).requestedDate || "");
  const finalTime = normalizeMetricTime(String(finalSlots.requestedTime || evidenceRecord(bookingAttempts.at(-1)?.normalizedRequest).requestedTime || ""));
  const metricValues = {};
  const successfulServiceDecision = turns.flatMap(parseVoiceDecisions).find((decision) =>
    decision.slot === "serviceName" && decision.canonicalValue === "Full Set" && ["accept", "preserve"].includes(decision.action)
  );
  const proposedServiceDecision = turns.flatMap(parseVoiceDecisions).find((decision) =>
    decision.slot === "serviceName" && decision.canonicalValue === "Full Set" && decision.action === "propose"
  );
  metricValues.serviceCaptureResult = finalService === "Full Set"
    ? measured(proposedServiceDecision ? "ONE_CLARIFICATION" : successfulServiceDecision ? "DIRECT" : "DIRECT")
    : definition.expected?.forbiddenServiceName
      ? notApplicable()
      : measured("FAILED");
  const staffDirect = /any staff|first available|no preference/.test(allTexts) && /any staff/i.test(finalStaff);
  const staffProposed = turns.flatMap(parseVoiceDecisions).some((decision) =>
    decision.slot === "staffPreference" && decision.canonicalValue === "Any staff" && decision.action === "propose"
  );
  metricValues.staffCaptureResult = /any staff/i.test(finalStaff)
    ? measured(staffProposed ? "ONE_CLARIFICATION" : staffDirect ? "DIRECT" : "DIRECT")
    : definition.expected?.forbiddenStaffPreference
      ? notApplicable()
      : measured("FAILED");
  metricValues.dateAccuracy = definition.expected?.dateOffsetDays === undefined
    ? notApplicable()
    : finalDate
      ? measured("MATCHED")
      : measured("FAILED");
  metricValues.timeAccuracy = definition.expected?.requestedTime === undefined
    ? notApplicable()
    : finalTime === definition.expected.requestedTime
      ? measured("MATCHED")
      : measured("FAILED");
  const clarificationCount = turns.filter((turn) => /did you say|did you mean|please repeat|which|what/.test(responseText(turn).toLowerCase())).length;
  metricValues.clarificationCount = measured(clarificationCount);
  const ambiguousAutoCommits = turns.flatMap(parseVoiceDecisions).filter((decision) =>
    decision.action === "accept" &&
      ["contextual_repair", "asr_alternative"].includes(decision.source) &&
      decision.requiresConfirmation
  );
  metricValues.wrongServiceAutoCommitCount = measured(ambiguousAutoCommits.filter((decision) => decision.slot === "serviceName").length);
  metricValues.wrongStaffAutoCommitCount = measured(ambiguousAutoCommits.filter((decision) => decision.slot === "staffPreference").length);
  const hasFinalConfirmation = turns.some((turn) => /just to confirm|is that correct|confirm/.test(responseText(turn).toLowerCase()));
  metricValues.appointmentBeforeFinalConfirmationCount = measured(
    bookingAttempts.some((attempt) => attempt.appointmentId) && !hasFinalConfirmation ? 1 : 0
  );
  metricValues.silentTurnCount = measured(
    turns.filter((turn, index) => String(turn.currentTurnTranscript || "").trim() && !responseText(turn).trim() && !hasPromptPlaybackEvidence(turns, index)).length
  );
  let groundedLoss = 0;
  const watchedFields = ["serviceName", "requestedDate", "requestedTime", "staffPreference"];
  for (let index = 1; index < turns.length; index += 1) {
    const before = evidenceRecord(turns[index - 1].trustedSlotsAfter);
    const after = evidenceRecord(turns[index].trustedSlotsAfter);
    for (const field of watchedFields) {
      if (before[field] && !after[field] && !/change|no|not|wrong|instead/.test(turnText(turns[index]))) {
        groundedLoss += 1;
      }
    }
  }
  metricValues.groundedFieldLossCount = measured(groundedLoss);
  metricValues.repeatedLongMenuCount = measured(
    Math.max(0, turns.filter((turn) => /press 1|press one|full set|pedicure|manicure/.test(responseText(turn).toLowerCase())).length - 1)
  );
  metricValues.autoTransferWithoutRequestCount = measured(
    turns.filter((turn) => {
      const attrs = evidenceRecord(turn.sessionAttributesAfter);
      return (attrs.transferToQueue === "true" || attrs.forceHumanEscalation === "true") && !/operator|person|human|representative|zero|\b0\b/.test(turnText(turn));
    }).length
  );
  const appointmentIds = bookingAttempts.map((attempt) => attempt.appointmentId).filter(Boolean);
  metricValues.duplicateAppointmentCount = measured(Math.max(0, new Set(appointmentIds).size ? appointmentIds.length - new Set(appointmentIds).size : 0));
  const lambdaMs = turns.map((turn) => Number(turn.lambdaProcessingMs ?? evidenceRecord(turn.turnStateDiagnostics).lambdaProcessingMs)).filter(Number.isFinite);
  const apiMs = turns.map((turn) => Number(turn.apiProcessingMs ?? evidenceRecord(turn.turnStateDiagnostics).apiProcessingMs)).filter(Number.isFinite);
  metricValues.lambdaProcessingMs = lambdaMs.length ? measured(Math.max(...lambdaMs)) : missingMetric();
  metricValues.apiProcessingMs = apiMs.length ? measured(Math.max(...apiMs)) : missingMetric();
  const callerToPrompt = turns
    .map((turn) => Number(turn.callerTurnToPromptMs ?? evidenceRecord(turn.turnStateDiagnostics).callerTurnToPromptMs ?? turn.lambdaProcessingMs))
    .filter(Number.isFinite);
  metricValues.callerTurnToPromptMs = callerToPrompt.length ? measured(Math.max(...callerToPrompt)) : missingMetric();
  metricValues.promptPlaybackEvidence = turns.length && turns.every((turn, index) => !responseText(turn).trim() || hasPromptPlaybackEvidence(turns, index))
    ? measured(true)
    : missingMetric();

  const releaseMatch = contactMatchesRelease({
    connectFlowMarker: contactAttributes.connectFlowSourceVersion || contactAttributes.VOICE_CONNECT_MARKER,
    lexAliasId: contactAttributes.VOICE_LEX_ALIAS_ID || identities.find((identity) => identity.VOICE_LEX_ALIAS_ID)?.VOICE_LEX_ALIAS_ID,
    lexBotVersion: contactAttributes.VOICE_LEX_BOT_VERSION || identities.find((identity) => identity.VOICE_LEX_BOT_VERSION)?.VOICE_LEX_BOT_VERSION,
    lambdaCodeSha256: contactAttributes.VOICE_LAMBDA_CODE_SHA256 || identities.find((identity) => identity.VOICE_LAMBDA_CODE_SHA256)?.VOICE_LAMBDA_CODE_SHA256,
    apiReleaseId: contactAttributes.VOICE_API_RELEASE_ID || identities.find((identity) => identity.VOICE_API_RELEASE_ID)?.VOICE_API_RELEASE_ID,
    voiceVariant: contactAttributes.VOICE_VARIANT || identities.find((identity) => identity.VOICE_VARIANT)?.VOICE_VARIANT
  }, {
    ...manifest,
    connect: { canary: manifest.connect?.canary || manifest.canaryDeploy?.connect },
    lex: {
      aliasId: manifest.lex?.alias?.aliasId || manifest.canaryDeploy?.lex?.aliasId,
      botVersion: manifest.lex?.botVersion || manifest.canaryDeploy?.lex?.botVersion
    },
    lambda: manifest.lambda || manifest.canaryDeploy?.lambda,
    api: manifest.api || manifest.canaryDeploy?.api
  });
  const failures = [...releaseMatch.failures];
  if (startedAfter) {
    const initiation = rawEvidence.contactDetails?.Contact?.InitiationTimestamp;
    if (!initiation || new Date(initiation).getTime() < new Date(startedAfter).getTime()) {
      failures.push("contact_before_canary_ready");
    }
  }
  if (definition.expected?.serviceName && finalService !== definition.expected.serviceName) failures.push("service_mismatch");
  if (definition.expected?.requestedTime && finalTime !== definition.expected.requestedTime) failures.push("time_mismatch");
  if (definition.expected?.staffPreference === "Any staff" && !/any staff/i.test(finalStaff)) failures.push("staff_mismatch");
  if (definition.expected?.forbiddenServiceName && finalService === definition.expected.forbiddenServiceName) failures.push("forbidden_service_resolved");
  if (definition.expected?.forbiddenStaffPreference && /any staff/i.test(finalStaff)) failures.push("forbidden_staff_resolved");
  if (definition.expected?.maxClarifications !== undefined && clarificationCount > definition.expected.maxClarifications) failures.push("too_many_clarifications");
  if (definition.expected?.requireOutOfOrderStaffRetention) {
    const retained = turns.some((turn) => {
      const slots = evidenceRecord(turn.trustedSlotsAfter);
      return /any staff/i.test(String(slots.staffPreference || "")) && (!slots.serviceName || !slots.requestedTime);
    });
    if (!retained) failures.push("out_of_order_staff_not_retained");
  }
  if (definition.expected?.requireFinalStaffCorrection && !/no.*any staff|any staff.*fine/.test(allTexts)) {
    failures.push("final_staff_correction_missing");
  }
  if (definition.expected?.requireDtmfIsolation) {
    const isolated = turns.some((turn) => evidenceRecord(turn.dtmfRouting).operatorDigitReserved === true || evidenceRecord(turn.turnStateDiagnostics).dtmfIsolation === true);
    if (!isolated) failures.push("dtmf_isolation_missing");
  }
  if (definition.expected?.requireRejectedServiceProposal) {
    const rejected = turns.flatMap(parseVoiceDecisions).some((decision) =>
      decision.slot === "serviceName" && decision.action === "reject"
    );
    if (!rejected) failures.push("service_proposal_rejection_missing");
  }
  if (definition.expected?.requireFiniteRecovery) {
    const finite = turns.some((turn) => /sorry|repeat|try once|press 0/.test(responseText(turn).toLowerCase()));
    if (!finite) failures.push("finite_recovery_missing");
  }
  for (const [name, value] of Object.entries(metricValues)) {
    if (value.state === "MISSING") failures.push(`metric_missing:${name}`);
  }
  return {
    caseId,
    caseDefinition: definition.title,
    passed: failures.length === 0,
    failures: Array.from(new Set(failures)),
    releaseMatch,
    metrics: metricValues,
    observability: {
      complete: identities.length > 0 && turns.length > 0
    },
    cleanup: {
      state: Number.isFinite(Number(appEvidencePayload.activeTestAppointmentCount)) ? "MEASURED" : "MISSING",
      activeTestAppointmentCount: Number(appEvidencePayload.activeTestAppointmentCount)
    }
  };
}

function rejectComputedEvidenceFields(inputCase) {
  const forbidden = ["fingerprints", "metrics", "observedSlots", "accepted", "evaluation"];
  const present = forbidden.filter((field) => Object.prototype.hasOwnProperty.call(inputCase, field));
  if (present.length) {
    throw new ReleaseError("Acceptance evidence may contain only contact/case/round/tester metadata", {
      forbiddenFields: present
    });
  }
}

function fetchInternalApiEvidence({ manifest, contactId }) {
  const apiBaseUrl = manifest.api?.canaryBaseUrl || manifest.canaryDeploy?.api?.canaryBaseUrl;
  if (!apiBaseUrl) {
    throw new ReleaseError("Cannot fetch trusted evidence because canary API base URL is missing", {
      reason: "api_identity_missing"
    });
  }
  const lambdaConfig = readTargets();
  const targets = lambdaConfig;
  const functionName = manifest.lambda?.functionName || targets.lambda.functions.canary.name;
  const qualifier = manifest.lambda?.aliasName;
  const args = ["--function-name", functionName];
  if (qualifier) args.push("--qualifier", qualifier);
  const config = awsJson(targets, "lambda", "get-function-configuration", args);
  const token = config.Environment?.Variables?.FASTAIBOOKING_API_INTERNAL_TOKEN;
  if (!token) {
    throw new ReleaseError("Cannot fetch trusted evidence because Lambda internal API token is missing", {
      reason: "api_internal_token_missing"
    });
  }
  const result = run("curl", [
    "--silent",
    "--show-error",
    "--fail-with-body",
    "--max-time",
    "30",
    "--header",
    `Authorization: Bearer ${token}`,
    safeUrlJoin(apiBaseUrl, `/api/v1/internal/ai/release-evidence/${encodeURIComponent(contactId)}`)
  ]);
  if (result.status !== 0) {
    throw new ReleaseError("Trusted API evidence fetch failed", {
      operation: "api:release-evidence",
      stderr: result.stderr.slice(0, 4000)
    });
  }
  return JSON.parse(result.stdout);
}

function fetchTrustedCaseEvidence({ targets, releaseId, manifest, inputCase }) {
  const contactId = inputCase.contactId;
  const contactDetails = fetchContactDetails(targets, contactId);
  const connectAttributes = fetchContactAttributes(targets, contactId);
  const appEvidence = fetchInternalApiEvidence({ manifest, contactId });
  const rawEvidence = {
    releaseId,
    contactId,
    fetchedAt: new Date().toISOString(),
    contactDetails,
    connectAttributes,
    appEvidence,
    debug: appEvidence.data?.debug || appEvidence.debug
  };
  const evidenceDir = path.join(releaseDirFor(releaseId), "evidence", contactId);
  writeJson(path.join(evidenceDir, "trusted-evidence.json"), rawEvidence);
  writeJson(path.join(evidenceDir, "trusted-evidence.sha256.json"), {
    sha256: sha256File(path.join(evidenceDir, "trusted-evidence.json"))
  });
  return rawEvidence;
}

function importAcceptanceEvidence({ releaseId, evidenceFile, contactId, caseId, roundId, testerId, result }) {
  const targets = readTargets();
  verifyIdentity(targets);
  const manifest = loadExistingManifest(releaseId);
  if (!manifest) {
    throw new ReleaseError(`Missing release manifest for ${releaseId}`);
  }
  const evidence = evidenceFile
    ? readJson(path.resolve(ROOT, evidenceFile))
    : { cases: [{ contactId, caseId, roundId, testerId, result }] };
  const cases = Array.isArray(evidence) ? evidence : evidence.cases || [];
  const accepted = [];
  const rejected = [];
  for (const inputCase of cases) {
    rejectComputedEvidenceFields(inputCase);
    if (!inputCase.contactId || !inputCase.caseId || !inputCase.roundId || !inputCase.testerId) {
      throw new ReleaseError("record-canary-case requires contactId, caseId, roundId, and testerId");
    }
    if (!isKnownReleaseCase(inputCase.caseId)) {
      throw new ReleaseError("Unknown acceptance case ID", { caseId: inputCase.caseId });
    }
    const rawEvidence = fetchTrustedCaseEvidence({ targets, releaseId, manifest, inputCase });
    const evaluation = evaluateReleaseCase({
      releaseId,
      caseId: inputCase.caseId,
      rawEvidence,
      manifest,
      startedAfter: manifest.canaryReadyForHumanPstnAt || manifest.canaryDeploy?.completedAt
    });
    const pass = evaluation.passed;
    const output = {
      contactId: inputCase.contactId,
      caseId: inputCase.caseId,
      roundId: inputCase.roundId,
      testerHash: crypto.createHash("sha256").update(String(inputCase.testerId)).digest("hex").slice(0, 16),
      deprecatedResultNoteIgnored: result || inputCase.result || undefined,
      accepted: pass,
      evaluation,
      metrics: evaluation.metrics,
      observability: evaluation.observability,
      cleanup: evaluation.cleanup,
      evidenceSha256: sha256File(path.join(releaseDirFor(releaseId), "evidence", inputCase.contactId, "trusted-evidence.json"))
    };
    if (pass) {
      accepted.push(output);
    } else {
      rejected.push(output);
    }
  }
  const previousPath = path.join(releaseDirFor(releaseId), "canary-acceptance.json");
  const previous = fs.existsSync(previousPath) ? readJson(previousPath) : { cases: [] };
  const next = {
    releaseId,
    status: accepted.length ? "RECORDED" : "NO_ACCEPTED_CASES",
    updatedAt: new Date().toISOString(),
    cases: [...(previous.cases || []), ...accepted, ...rejected],
    acceptedCount: (previous.acceptedCount || 0) + accepted.length,
    rejectedCount: (previous.rejectedCount || 0) + rejected.length
  };
  const gate = validatePromotionGate({
    ...manifest,
    canaryAcceptance: next
  });
  next.promotionGate = gate;
  writeReleaseFile(releaseId, "canary-acceptance.json", next);
  updateManifest(releaseId, { canaryAcceptance: next });
  console.log(JSON.stringify(next, null, 2));
}

function summarizeRelease({ releaseId }) {
  const manifest = loadExistingManifest(releaseId);
  if (!manifest) {
    throw new ReleaseError(`Missing release manifest for ${releaseId}`);
  }
  const acceptancePath = path.join(releaseDirFor(releaseId), "canary-acceptance.json");
  const canaryAcceptance = fs.existsSync(acceptancePath)
    ? readJson(acceptancePath)
    : manifest.canaryAcceptance;
  const gate = validatePromotionGate({
    ...manifest,
    canaryAcceptance
  });
  const summary = {
    releaseId,
    status: gate.ok ? "CANARY_ACCEPTED" : "CANARY_PENDING",
    generatedAt: new Date().toISOString(),
    gate
  };
  writeReleaseFile(releaseId, "promotion-gate.json", summary);
  updateManifest(releaseId, {
    canaryAcceptance,
    promotionGate: gate,
    status: gate.ok ? "CANARY_ACCEPTED" : manifest.status
  });
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

function assertAcceptedArtifacts(manifest) {
  const failures = [];
  if (!manifest.lambda?.path || !fs.existsSync(manifest.lambda.path)) {
    failures.push("lambda_zip_missing");
  } else {
    if (sha256File(manifest.lambda.path) !== manifest.lambda.sha256) failures.push("lambda_zip_sha256_mismatch");
    if (sha256File(manifest.lambda.path, "base64") !== manifest.lambda.codeSha256Base64) failures.push("lambda_code_sha256_mismatch");
  }
  const connectPath = manifest.connect?.canary?.path;
  if (!connectPath || !fs.existsSync(connectPath)) {
    failures.push("connect_artifact_missing");
  } else if (connectFlowNormalizedSha256(readJson(connectPath)) !== manifest.connect.canary.normalizedSha256) {
    failures.push("connect_artifact_sha256_mismatch");
  }
  if (!manifest.api?.imageTag || !manifest.api?.canaryReadback?.imageId) failures.push("api_artifact_identity_missing");
  if (!manifest.lex?.botVersion || !manifest.lex?.alias?.aliasId) failures.push("lex_artifact_identity_missing");
  if (computeSourceHash() !== manifest.sourceHash || computeApiSourceHash() !== manifest.api?.apiSourceHash) {
    failures.push("source_hash_mismatch");
  }
  const originCheck = run("git", ["merge-base", "--is-ancestor", manifest.sourceCommit || "", "origin/main"]);
  if (originCheck.status !== 0) failures.push("source_commit_not_on_origin_main");
  if (failures.length) throw new ReleaseError("Accepted runtime artifacts failed validation", { failures });
  return {
    apiImageTag: manifest.api.imageTag,
    apiImageId: manifest.api.canaryReadback.imageId,
    lambdaZipSha256: manifest.lambda.sha256,
    lambdaCodeSha256Base64: manifest.lambda.codeSha256Base64,
    lexBotVersion: manifest.lex.botVersion,
    lexAliasId: manifest.lex.alias.aliasId,
    connectNormalizedSha256: manifest.connect.canary.normalizedSha256,
    connectMarker: manifest.connect.canary.marker
  };
}

function sourceValidationPassed(releaseId) {
  const file = path.join(releaseDirFor(releaseId), "source-validation.json");
  if (!fs.existsSync(file)) return false;
  const validation = readJson(file);
  return validation.status === "passed" && validation.results?.length >= SOURCE_GATE_COMMANDS.length &&
    validation.results.every((result) => result.status === "passed" && result.exitCode === 0);
}

function rereadAcceptedCanary(targets, releaseId, manifest) {
  const liveApi = readbackApiContainer({
    releaseId,
    variant: "canary",
    serviceName: "api-voice-canary",
    containerName: "fastaibooking-api-voice-canary",
    baseUrl: "docker://fastaibooking-api-voice-canary",
    imageTag: manifest.api.imageTag
  });
  const apiFailures = [];
  if (liveApi.imageId !== manifest.api.canaryReadback.imageId) apiFailures.push("api_image_id_mismatch");
  if (liveApi.runtimeReleaseId !== releaseId) apiFailures.push("api_release_id_mismatch");
  if (liveApi.runtimeSourceSha256 !== manifest.sourceHash) apiFailures.push("api_source_hash_mismatch");
  if (liveApi.runtimeVariant !== "canary") apiFailures.push("api_variant_mismatch");
  if (liveApi.health !== "healthy" || liveApi.healthReadback?.status !== "ok") apiFailures.push("api_health_failed");
  if (apiFailures.length) throw new ReleaseError("Canary API identity changed", { failures: apiFailures, liveApi });
  const readback = readbackCanary({
    targets,
    releaseId,
    apiRelease: { ...manifest.api, canaryReadback: liveApi },
    lambdaRelease: manifest.lambda,
    lexArtifact: manifest.lex,
    connectArtifact: manifest.connect.canary
  });
  const failures = [];
  if (readback.lambda.codeSha256Base64 !== manifest.lambda.codeSha256Base64) failures.push("lambda_code_sha_mismatch");
  if (String(readback.lambda.version) !== String(manifest.lambda.publishedVersion)) failures.push("lambda_version_mismatch");
  if (readback.lex.aliasId !== manifest.lex.alias.aliasId) failures.push("lex_alias_mismatch");
  if (String(readback.lex.botVersion) !== String(manifest.lex.botVersion)) failures.push("lex_version_mismatch");
  if (readback.lex.status && readback.lex.status !== "Available") failures.push("lex_alias_unavailable");
  if (readback.lex.lambdaArn !== manifest.lex.alias.lambdaArn) failures.push("lex_lambda_hook_mismatch");
  if (readback.connect.normalizedSha256 !== manifest.connect.canary.normalizedSha256) failures.push("connect_hash_mismatch");
  if (readback.connect.marker !== manifest.connect.canary.marker) failures.push("connect_marker_mismatch");
  if (!readback.connect.aliasArns.includes(manifest.lex.alias.aliasArn)) failures.push("connect_lex_alias_mismatch");
  if (failures.length) throw new ReleaseError("Canary readback no longer matches accepted manifest", { failures, readback });
  return readback;
}

function rollbackSnapshotComplete(snapshot, apiSnapshot) {
  return Boolean(
    snapshot?.connect?.flowId && snapshot.connect.normalizedSha256 && snapshot.connect.content &&
    snapshot?.lexAlias && snapshot?.lambda?.AliasArn && snapshot.lambda.FunctionVersion &&
    apiSnapshot?.configuredImage && apiSnapshot?.containerImageId
  );
}

function writeEmergencyAuthorization(releaseId, authorization) {
  const file = path.join(releaseDirFor(releaseId), EMERGENCY_AUTHORIZATION_FILE);
  const body = `${JSON.stringify(authorization, null, 2)}\n`;
  if (fs.existsSync(file)) {
    const existing = readJson(file);
    if (
      existing.releaseId !== authorization.releaseId ||
      existing.acknowledgedSourceCommit !== authorization.acknowledgedSourceCommit ||
      existing.reason !== authorization.reason
    ) {
      throw new ReleaseError("Existing immutable emergency authorization does not match this request", { file });
    }
    return file;
  }
  const descriptor = fs.openSync(file, "wx", 0o444);
  try {
    fs.writeFileSync(descriptor, body);
  } finally {
    fs.closeSync(descriptor);
  }
  return file;
}

function promoteProduction({
  releaseId,
  dryRun = false,
  authorizedEmergencyPromote = false,
  acknowledgedReleaseId = "",
  acknowledgedSourceCommit = "",
  authorizationReason = ""
}) {
  const targets = readTargets();
  verifyIdentity(targets);
  const manifest = loadExistingManifest(releaseId);
  if (!manifest) {
    throw new ReleaseError(`Missing release manifest for ${releaseId}`);
  }
  const gate = validatePromotionGate(manifest);
  if (!gate.ok && !authorizedEmergencyPromote) {
    throw new ReleaseError("Promotion gate failed", { failures: gate.failures });
  }
  const acceptedArtifactIdentities = assertAcceptedArtifacts(manifest);
  rereadAcceptedCanary(targets, releaseId, manifest);
  const emergencyBase = authorizedEmergencyPromote
    ? validateEmergencyPromotionAuthorization({
        manifest,
        acknowledgedReleaseId,
        acknowledgedSourceCommit,
        authorizationReason,
        identityValid: true,
        artifactsValid: true,
        canaryReadbackValid: true,
        sourceValidationPassed: sourceValidationPassed(releaseId),
        rollbackSnapshotComplete: true
      })
    : null;
  if (emergencyBase && !emergencyBase.ok) {
    throw new ReleaseError("Emergency promotion authorization failed", { failures: emergencyBase.failures });
  }
  const plan = buildReleasePlan({ target: "production", dryRun, acceptedManifest: manifest });
  if (dryRun) {
    writeReleaseFile(releaseId, "production-promotion.json", {
      releaseId,
      status: "DRY_RUN",
      plannedWrites: plan.plannedWrites,
      reusesAcceptedHashes: true,
      acceptedArtifacts: {
        apiImageTag: manifest.api?.imageTag,
        apiImageId: manifest.api?.canaryReadback?.imageId,
        lambdaZipPath: manifest.lambda?.path,
        lambdaCodeSha256Base64: manifest.lambda?.codeSha256Base64,
        lexBotVersion: manifest.lex?.botVersion,
        connectCanarySha256: manifest.connect?.canary?.normalizedSha256
      }
    });
    console.log(JSON.stringify({ releaseId, status: "DRY_RUN", plan }, null, 2));
    return;
  }
  verifyIdentity(targets);
  const beforeProduction = captureTargetSnapshot(targets, "production", { releaseId, file: "before-production.json" });
  const beforeApi = snapshotApiProduction(releaseId);
  const snapshotComplete = rollbackSnapshotComplete(beforeProduction, beforeApi);
  if (!snapshotComplete) {
    throw new ReleaseError("Production rollback snapshot is incomplete");
  }
  if (authorizedEmergencyPromote) {
    const finalAuthorization = validateEmergencyPromotionAuthorization({
      manifest,
      acknowledgedReleaseId,
      acknowledgedSourceCommit,
      authorizationReason,
      identityValid: true,
      artifactsValid: true,
      canaryReadbackValid: true,
      sourceValidationPassed: sourceValidationPassed(releaseId),
      rollbackSnapshotComplete: snapshotComplete
    });
    if (!finalAuthorization.ok) throw new ReleaseError("Emergency promotion authorization failed", { failures: finalAuthorization.failures });
    writeEmergencyAuthorization(releaseId, {
      releaseId,
      acknowledgedSourceCommit,
      reason: authorizationReason.trim(),
      authorizedAt: new Date().toISOString(),
      currentGitHead: run("git", ["rev-parse", "HEAD"]).stdout.trim(),
      originalGateFailures: finalAuthorization.originalGateFailures,
      bypassedMissingEvidenceFailures: finalAuthorization.bypassedFailures,
      hardGatesPassed: ["aws_identity", "canary_ready", "accepted_artifacts", "canary_readbacks", "source_validation", "rollback_snapshot"],
      acceptedArtifactIdentities
    });
  }
  const operationLog = [];
  const acceptedLambda = manifest.lambda;
  const acceptedLex = manifest.lex;
  if (!acceptedLambda?.path || !fs.existsSync(acceptedLambda.path)) {
    throw new ReleaseError("Accepted Lambda ZIP is missing; cannot promote exact artifact", {
      path: acceptedLambda?.path
    });
  }
  let productionWritesStarted = false;
  try {
  productionWritesStarted = true;
  const apiNextReadback = deployProductionApiNext({
    releaseId,
    sourceHash: manifest.sourceHash,
    apiArtifact: manifest.api
  });
  operationLog.push({ operation: "api:production-next", completedAt: new Date().toISOString() });
  const apiProductionReadback = switchProductionApi({
    releaseId,
    sourceHash: manifest.sourceHash,
    apiArtifact: manifest.api
  });
  operationLog.push({ operation: "api:switch-production", completedAt: new Date().toISOString() });
  const apiInternalToken = readApiInternalTokenFromEc2();
  const productionLambda = deployLambdaArtifact({
    targets,
    releaseId,
    lambdaFunctionName: targets.lambda.functions.production.name,
    artifact: {
      ...acceptedLambda,
      sourceHash: manifest.sourceHash
    },
    variant: "production",
    apiBaseUrl: defaultEc2Config().publicApiBaseUrl,
    apiReleaseId: releaseId,
    apiInternalToken
  });
  operationLog.push({ operation: "lambda:publish-production", completedAt: new Date().toISOString() });
  const prodAlias = createOrUpdateLexAlias({
    targets,
    releaseId,
    target: "production",
    botVersion: acceptedLex.botVersion,
    lambdaArn: productionLambda.aliasArn,
    cloneAliasId: lexAliasIdFrom(beforeProduction.lexAlias)
  });
  operationLog.push({ operation: "lex:update-production-alias", completedAt: new Date().toISOString() });
  addLexLambdaPermission({
    targets,
    lambdaFunctionName: productionLambda.functionName,
    lambdaAliasName: productionLambda.aliasName,
    lexAliasArnValue: prodAlias.aliasArn
  });
  const prodConnectAssociation = associateLexAliasWithConnect({
    targets,
    lexAliasArnValue: prodAlias.aliasArn
  });
  operationLog.push({
    operation: "connect:associate-lex-bot-alias",
    completedAt: new Date().toISOString(),
    alreadyAssociated: prodConnectAssociation.alreadyAssociated
  });
  const { artifact: connectArtifact } = updateConnectFlow({
    targets,
    releaseId,
    target: "production",
    lexAlias: prodAlias,
    sourceHash: manifest.sourceHash,
    variant: "production",
    lambdaRelease: productionLambda,
    apiRelease: {
      releaseId,
      variant: "production"
    }
  });
  operationLog.push({ operation: "connect:update-production-flow", completedAt: new Date().toISOString() });
  const productionReadback = readbackProductionBindings({
    targets,
    releaseId,
    manifest: {
      ...manifest,
      productionPromotion: { lambda: productionLambda, lexAlias: prodAlias }
    }
  });
  assertReadbackMatchesManifest(
    productionReadback,
    {
      releaseId,
      sourceHash: manifest.sourceHash,
      api: {
        ...manifest.api,
        canaryReadback: manifest.api.canaryReadback
      },
      lambda: productionLambda,
      lex: { botVersion: acceptedLex.botVersion },
      connect: {
        normalizedSha256: connectArtifact.normalizedSha256,
        marker: connectArtifact.marker
      }
    }
  );
  const productionFailures = [];
  if (productionReadback.api?.runtimeReleaseId !== releaseId) productionFailures.push("api_release_id_mismatch");
  if (productionReadback.api?.runtimeSourceSha256 !== manifest.sourceHash) productionFailures.push("api_source_hash_mismatch");
  if (productionReadback.api?.runtimeVariant !== "production") productionFailures.push("api_variant_mismatch");
  if (productionReadback.api?.health !== "healthy" || productionReadback.api?.healthReadback?.status !== "ok") productionFailures.push("api_health_failed");
  if (productionReadback.lambda?.codeSha256Base64 !== manifest.lambda.codeSha256Base64) productionFailures.push("lambda_code_sha_mismatch");
  if (String(productionReadback.lambda?.version) !== String(productionLambda.publishedVersion)) productionFailures.push("lambda_version_mismatch");
  if (productionReadback.lambda?.environment?.VOICE_RELEASE_ID !== releaseId) productionFailures.push("lambda_release_id_mismatch");
  if (productionReadback.lambda?.environment?.VOICE_VARIANT !== "production") productionFailures.push("lambda_variant_mismatch");
  if (String(productionReadback.lex?.botVersion) !== String(acceptedLex.botVersion)) productionFailures.push("lex_version_mismatch");
  if (productionReadback.lex?.status !== "Available") productionFailures.push("lex_alias_unavailable");
  if (productionReadback.lex?.lambdaArn !== productionLambda.aliasArn) productionFailures.push("lex_lambda_hook_mismatch");
  if (productionReadback.connect?.normalizedSha256 !== connectArtifact.normalizedSha256) productionFailures.push("connect_hash_mismatch");
  if (productionReadback.connect?.marker !== connectArtifact.marker) productionFailures.push("connect_marker_mismatch");
  if (!productionReadback.connect?.aliasArns?.includes(prodAlias.aliasArn)) productionFailures.push("connect_lex_alias_mismatch");
  if (productionFailures.length) {
    throw new ReleaseError("Independent production readback failed", { failures: productionFailures, productionReadback });
  }
  const promotion = {
    releaseId,
    status: "PROMOTED_PENDING_POST_PSTN",
    promotedAt: new Date().toISOString(),
    operationLog,
    previousProduction: {
      api: beforeApi,
      marker: beforeProduction.connect.marker,
      sha256: beforeProduction.connect.normalizedSha256,
      lexAliasId: lexAliasIdFrom(beforeProduction.lexAlias),
      lexBotVersion: lexAliasBotVersionFrom(beforeProduction.lexAlias)
    },
    apiNextReadback,
    apiProductionReadback,
    lambda: productionLambda,
    lexAlias: prodAlias,
    connectAssociation: prodConnectAssociation,
    connect: connectArtifact
  };
  writeReleaseFile(releaseId, "production-promotion.json", promotion);
  writeReleaseFile(releaseId, "production-readback.json", productionReadback);
  updateManifest(releaseId, {
    status: "PROMOTED_PENDING_POST_PSTN",
    productionPromotion: promotion,
    productionReadback,
    api: {
      ...(manifest.api || {}),
      productionReadback: apiProductionReadback
    },
    lambda: {
      ...(manifest.lambda || {}),
      production: productionLambda
    },
    connect: {
      ...(manifest.connect || {}),
      production: connectArtifact
    }
  });
  writeFinalReport({ releaseId, status: "PROMOTED_PENDING_POST_PSTN" });
  console.log(JSON.stringify({ releaseId, status: "PROMOTED_PENDING_POST_PSTN", productionReadback }, null, 2));
  } catch (error) {
    if (productionWritesStarted) {
      try {
        const rollbackResult = rollbackRelease({ releaseId });
        if (rollbackResult.status !== "ROLLED_BACK_VERIFIED") {
          throw new ReleaseError("Production promotion failed and rollback verification failed", {
            promotionFailure: error.message,
            rollbackResult
          });
        }
        throw new ReleaseError("Production promotion readback failed; rollback verified", {
          rolledBack: true,
          promotionFailure: error.message,
          promotionFailureDetails: error.details || {},
          rollbackResult
        });
      } catch (rollbackError) {
        if (rollbackError instanceof ReleaseError && rollbackError.details?.rolledBack) throw rollbackError;
        throw new ReleaseError("Production promotion failed and rollback failed", {
          promotionFailure: error.message,
          rollbackFailure: rollbackError.message
        });
      }
    }
    throw error;
  }
}

function readbackProductionBindings({ targets, releaseId, manifest }) {
  const promotion = manifest.productionPromotion || {};
  const lambdaAliasName = promotion.lambda?.aliasName || manifest.lambda?.production?.aliasName || safeAliasName(releaseId);
  const lambdaFunctionName = targets.lambda.functions.production.name;
  const lambdaConfig = awsJson(targets, "lambda", "get-function-configuration", [
    "--function-name",
    lambdaFunctionName,
    "--qualifier",
    lambdaAliasName
  ]);
  const lexAliasId = promotion.lexAlias?.aliasId || manifest.productionReadback?.lex?.aliasId;
  const lexAlias = lexAliasId
    ? awsJson(targets, "lexv2-models", "describe-bot-alias", [
        "--bot-id",
        targets.lex.botId,
        "--bot-alias-id",
        lexAliasId
      ])
    : null;
  const connect = readbackConnectFlow(targets, targets.connect.flows.production.id);
  let api = null;
  try {
    api = readbackApiContainer({
      releaseId,
      variant: "production",
      serviceName: "api",
      containerName: "fastaibooking-api",
      baseUrl: defaultEc2Config().publicApiBaseUrl,
      imageTag: manifest.api?.imageTag
    });
  } catch (error) {
    api = { error: error.message };
  }
  return {
    releaseId,
    status: "PRODUCTION_READBACK",
    api,
    lambda: {
      functionName: lambdaFunctionName,
      aliasName: lambdaAliasName,
      version: lambdaConfig.Version,
      codeSha256Base64: lambdaConfig.CodeSha256,
      environment: sanitizeLambdaConfig(lambdaConfig).releaseEnvironment
    },
    lex: lexAlias
      ? {
          botId: targets.lex.botId,
          aliasId: lexAliasIdFrom(lexAlias),
          aliasName: lexAliasNameFrom(lexAlias),
          aliasArn: lexAliasArn(targets, lexAliasIdFrom(lexAlias)),
          botVersion: lexAliasBotVersionFrom(lexAlias),
          status: pick(lexAlias, "botAliasStatus", "BotAliasStatus"),
          lambdaArn: lexAliasLocaleSettingsFrom(lexAlias)?.en_US?.codeHookSpecification?.lambdaCodeHook?.lambdaARN
        }
      : null,
    connect
  };
}

function verifyProduction({ releaseId, evidenceFile, contactId, caseId, roundId, testerId }) {
  const targets = readTargets();
  verifyIdentity(targets);
  const manifest = loadExistingManifest(releaseId);
  if (!manifest) {
    throw new ReleaseError(`Missing release manifest for ${releaseId}`);
  }
  const readback = readbackProductionBindings({ targets, releaseId, manifest });
  writeReleaseFile(releaseId, "production-verify-readback.json", readback);
  const postManifest = {
    ...manifest,
    expectedVariant: "production",
    connect: {
      production: manifest.connect?.production || manifest.productionPromotion?.connect
    },
    lex: {
      aliasId: readback.lex?.aliasId,
      botVersion: readback.lex?.botVersion
    },
    lambda: {
      codeSha256Base64: readback.lambda?.codeSha256Base64
    },
    api: {
      releaseId,
      canaryBaseUrl: defaultEc2Config().publicApiBaseUrl
    }
  };
  const inputCases = evidenceFile
    ? (Array.isArray(readJson(path.resolve(ROOT, evidenceFile)))
        ? readJson(path.resolve(ROOT, evidenceFile))
        : readJson(path.resolve(ROOT, evidenceFile)).cases || [])
    : [{ contactId, caseId, roundId, testerId }];
  const evaluated = [];
  for (const inputCase of inputCases) {
    rejectComputedEvidenceFields(inputCase);
    const rawEvidence = fetchTrustedCaseEvidence({ targets, releaseId, manifest: postManifest, inputCase });
    const evaluation = evaluateReleaseCase({
      releaseId,
      caseId: inputCase.caseId,
      rawEvidence,
      manifest: postManifest,
      startedAfter: manifest.productionPromotion?.promotedAt
    });
    evaluated.push({
      contactId: inputCase.contactId,
      caseId: inputCase.caseId,
      testerHash: crypto.createHash("sha256").update(String(inputCase.testerId)).digest("hex").slice(0, 16),
      accepted: evaluation.passed,
      evaluation,
      metrics: evaluation.metrics,
      observability: evaluation.observability,
      cleanup: evaluation.cleanup
    });
  }
  const requiredPostCasesPassed = ["C01", "C04"].every((requiredCaseId) =>
    evaluated.some((item) => item.caseId === requiredCaseId && item.accepted)
  );
  const uniqueContacts = new Set(evaluated.filter((item) => item.accepted).map((item) => item.contactId));
  const verifyOk =
    requiredPostCasesPassed &&
    uniqueContacts.size >= 2 &&
    evaluated.every((item) => item.accepted) &&
    readback.lambda?.environment?.VOICE_VARIANT === "production" &&
    readback.lambda?.environment?.VOICE_RELEASE_ID === releaseId &&
    readback.lex?.status === "Available";
  const result = {
    releaseId,
    status: verifyOk ? "PROMOTED_VERIFIED" : "VERIFY_FAILED_ROLLING_BACK",
    verifiedAt: new Date().toISOString(),
    readback,
    cases: evaluated
  };
  writeReleaseFile(releaseId, "post-production-acceptance.json", result);
  if (!verifyOk) {
    rollbackRelease({ releaseId });
    return result;
  }
  updateManifest(releaseId, { status: "PROMOTED_VERIFIED", postProductionVerification: result });
  writeFinalReport({ releaseId, status: "PROMOTED_VERIFIED" });
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function rollbackRelease({ releaseId, snapshotPath }) {
  const targets = readTargets();
  verifyIdentity(targets);
  const snapshot = snapshotPath ? readJson(path.resolve(ROOT, snapshotPath)) : readJson(path.join(releaseDirFor(releaseId), "before-production.json"));
  const apiSnapshotPath = path.join(releaseDirFor(releaseId), "before-production-api.json");
  const apiSnapshot = fs.existsSync(apiSnapshotPath) ? readJson(apiSnapshotPath) : snapshot.api;
  const failures = [];
  const restored = [];
  if (apiSnapshot?.configuredImage) {
    try {
      const ec2 = defaultEc2Config();
      const image = apiSnapshot.configuredImage;
      sshRun([
        "bash",
        "-lc",
        `cd ${JSON.stringify(ec2.appDir)} && FASTAIBOOKING_API_IMAGE=${JSON.stringify(image)} docker compose up -d --no-build api && cp infra/nginx/default-ssl.conf infra/nginx/default.conf && (docker rm -f fastaibooking-nginx >/dev/null 2>&1 || true) && docker compose up -d --no-build --no-deps nginx && docker compose exec -T nginx nginx -t && docker compose exec -T nginx nginx -s reload`
      ], { details: { operation: "docker-compose:rollback-api" } });
      const apiReadback = snapshotApiProduction(releaseId);
      if (apiReadback.containerImageId !== apiSnapshot.containerImageId) {
        failures.push("api_rollback_readback_mismatch");
      } else {
        restored.push("api");
      }
    } catch (error) {
      failures.push(`api_rollback_failed:${error.message}`);
    }
  }
  if (snapshot.lambda?.AliasArn && snapshot.lambda?.FunctionVersion) {
    try {
      const aliasName = snapshot.lambda.AliasArn.split(":").pop();
      const functionName = snapshot.lambda.FunctionName;
      if (aliasName && functionName && aliasName !== functionName) {
        awsJson(targets, "lambda", "update-alias", [
          "--function-name",
          functionName,
          "--name",
          aliasName,
          "--function-version",
          snapshot.lambda.FunctionVersion
        ], {
          requiredAction: "lambda:UpdateAlias"
        });
        const restoredAlias = awsJson(targets, "lambda", "get-alias", [
          "--function-name", functionName, "--name", aliasName
        ]);
        const restoredConfig = awsJson(targets, "lambda", "get-function-configuration", [
          "--function-name", functionName, "--qualifier", snapshot.lambda.FunctionVersion
        ]);
        if (restoredAlias.FunctionVersion !== snapshot.lambda.FunctionVersion || restoredConfig.CodeSha256 !== snapshot.lambda.CodeSha256) {
          failures.push("lambda_rollback_readback_mismatch");
        } else {
          restored.push("lambda");
        }
      }
    } catch (error) {
      failures.push(`lambda_rollback_failed:${error.message}`);
    }
  }
  if (snapshot.lexAlias) {
    try {
      const aliasId = lexAliasIdFrom(snapshot.lexAlias);
      const aliasName = lexAliasNameFrom(snapshot.lexAlias);
      const botVersion = lexAliasBotVersionFrom(snapshot.lexAlias);
      const localeSettings = lexAliasLocaleSettingsFrom(snapshot.lexAlias);
      if (!aliasId || !aliasName || !botVersion || !localeSettings) {
        failures.push("lex_snapshot_missing");
      } else {
        awsJson(targets, "lexv2-models", "update-bot-alias", [
          "--bot-id",
          targets.lex.botId,
          "--bot-alias-id",
          aliasId,
          "--bot-alias-name",
          aliasName,
          "--bot-version",
          String(botVersion),
          "--bot-alias-locale-settings",
          JSON.stringify(localeSettings)
        ], {
          requiredAction: "lex:UpdateBotAlias"
        });
        const restoredAlias = waitForLexAliasAvailable(targets, aliasId);
        if (
          String(lexAliasBotVersionFrom(restoredAlias)) !== String(botVersion) ||
          JSON.stringify(lexAliasLocaleSettingsFrom(restoredAlias)) !== JSON.stringify(localeSettings)
        ) {
          failures.push("lex_rollback_readback_mismatch");
        } else {
          restored.push("lex");
        }
      }
    } catch (error) {
      failures.push(`lex_rollback_failed:${error.message}`);
    }
  }
  const contentPath = path.join(releaseDirFor(releaseId), "rollback-production-flow.json");
  writeJson(contentPath, snapshot.connect.content);
  verifyIdentity(targets);
  try {
    awsJson(targets, "connect", "update-contact-flow-content", [
      "--instance-id",
      targets.connect.instanceId,
      "--contact-flow-id",
      snapshot.connect.flowId,
      "--content",
      `file://${contentPath}`
    ], {
      requiredAction: "connect:UpdateContactFlowContent"
    });
    restored.push("connect");
  } catch (error) {
    failures.push(`connect_rollback_failed:${error.message}`);
  }
  const readback = readbackConnectFlow(targets, snapshot.connect.flowId);
  if (readback.normalizedSha256 !== snapshot.connect.normalizedSha256) {
    failures.push("connect_rollback_readback_mismatch");
  }
  const result = {
    releaseId,
    status: failures.length ? "ROLLBACK_FAILED" : "ROLLED_BACK_VERIFIED",
    restoredComponents: restored,
    failures,
    readback,
    expectedSha256: snapshot.connect.normalizedSha256
  };
  writeReleaseFile(releaseId, "rollback.json", result);
  updateManifest(releaseId, { status: result.status, rollback: result });
  writeFinalReport({ releaseId, status: result.status });
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function inspectLive({ target }) {
  const targets = readTargets();
  verifyIdentity(targets);
  const snapshot = captureTargetSnapshot(targets, target, {
    releaseId: "inspect-live",
    file: `${target}-inspect-live.json`
  });
  console.log(JSON.stringify({
    target,
    connect: {
      flowId: snapshot.connect.flowId,
      marker: snapshot.connect.marker,
      normalizedSha256: snapshot.connect.normalizedSha256
    },
    lex: {
      aliasId: lexAliasIdFrom(snapshot.lexAlias),
      aliasName: lexAliasNameFrom(snapshot.lexAlias),
      botVersion: lexAliasBotVersionFrom(snapshot.lexAlias),
      lambdaArn: lexAliasLocaleSettingsFrom(snapshot.lexAlias)?.en_US?.codeHookSpecification?.lambdaCodeHook?.lambdaARN
    },
    lambda: {
      functionName: snapshot.lambda?.FunctionName,
      codeSha256: snapshot.lambda?.CodeSha256,
      lastModified: snapshot.lambda?.LastModified
    }
  }, null, 2));
}

function parseArgs(argv) {
  const parsed = {
    command: "",
    target: "",
    dryRun: false,
    releaseId: "",
    manifest: "",
    snapshot: "",
    evidence: "",
    authorizedEmergencyPromote: false,
    acknowledgedReleaseId: "",
    acknowledgedSourceCommit: "",
    authorizationReason: "",
    rest: []
  };
  const args = [...argv];
  if (/^(validate-source|inspect-live|plan|deploy-canary|record-canary-case|run-canary-acceptance|summarize|promote-production|promote|verify|rollback)$/.test(args[0] || "")) {
    parsed.command = args.shift();
  }
  while (args.length) {
    const arg = args.shift();
    if (arg === "--target") parsed.target = args.shift() || "";
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg === "--release") parsed.releaseId = args.shift() || "";
    else if (arg === "--manifest") parsed.manifest = args.shift() || "";
    else if (arg === "--snapshot") parsed.snapshot = args.shift() || "";
    else if (arg === "--authorized-emergency-promote") parsed.authorizedEmergencyPromote = true;
    else if (arg === "--ack-release") parsed.acknowledgedReleaseId = args.shift() || "";
    else if (arg === "--ack-source-commit") parsed.acknowledgedSourceCommit = args.shift() || "";
    else if (arg === "--authorization-reason") parsed.authorizationReason = args.shift() || "";
    else if (arg === "--evidence") {
      parsed.evidence = args.shift() || "";
      parsed.rest.push("--evidence", parsed.evidence);
    } else {
      parsed.rest.push(arg);
      if (arg.startsWith("--") && args[0] && !args[0].startsWith("--")) {
        parsed.rest.push(args.shift());
      }
    }
  }
  if (!parsed.command) {
    if (parsed.dryRun) parsed.command = "plan";
    else if (parsed.target === "canary") parsed.command = "deploy-canary";
    else if (parsed.target === "production") parsed.command = "promote-production";
  }
  if (parsed.command === "deploy-canary" || parsed.command === "run-canary-acceptance" || parsed.command === "record-canary-case") {
    parsed.target = "canary";
  }
  if (parsed.command === "promote") {
    parsed.command = "promote-production";
  }
  if (parsed.command === "promote-production") {
    parsed.target = "production";
  }
  return parsed;
}

function usage() {
  console.error(`Usage:
  scripts/aws/deploy-voice-stack.sh validate-source
  scripts/aws/deploy-voice-stack.sh inspect-live --target canary|production
  scripts/aws/deploy-voice-stack.sh plan --target canary|production [--release <release-id>]
  scripts/aws/deploy-voice-stack.sh deploy-canary [--release <release-id>]
  scripts/aws/deploy-voice-stack.sh record-canary-case --release <release-id> --contact-id <id> --case-id C01 --round-id round-1 --tester-id <id>
  scripts/aws/deploy-voice-stack.sh record-canary-case --release <release-id> --evidence <json>
  scripts/aws/deploy-voice-stack.sh summarize --release <release-id>
  scripts/aws/deploy-voice-stack.sh promote-production --release <release-id> [--dry-run] [--authorized-emergency-promote --ack-release <release-id> --ack-source-commit <full-sha> --authorization-reason <text>]
  scripts/aws/deploy-voice-stack.sh verify --release <release-id> --contact-id <id> --case-id C01 --round-id post-1 --tester-id <id>
  scripts/aws/deploy-voice-stack.sh verify --release <release-id> --evidence <json>
  scripts/aws/deploy-voice-stack.sh rollback --release <release-id> [--snapshot <path>]`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    if (args.command === "validate-source") {
      const releaseId = resolveReleaseId(args.releaseId);
      fs.mkdirSync(releaseDirFor(releaseId), { recursive: true });
      validateLexSource();
      runSourceGates(releaseId);
      console.log(JSON.stringify({ releaseId, status: "SOURCE_VALIDATED", releaseDir: releaseDirFor(releaseId) }, null, 2));
      return;
    }
    if (args.command === "inspect-live") {
      if (!args.target) throw new ReleaseError("inspect-live requires --target");
      inspectLive({ target: args.target });
      return;
    }
    if (args.command === "plan") {
      const releaseId = resolveReleaseId(args.releaseId);
      const target = args.target || "canary";
      const targets = readTargets();
      verifyIdentity(targets);
      fs.mkdirSync(releaseDirFor(releaseId), { recursive: true });
      const sourceHash = computeSourceHash();
      const plan = buildReleasePlan({ target, dryRun: true });
      updateManifest(releaseId, {
        schemaVersion: RELEASE_SCHEMA_VERSION,
        releaseId,
        status: "PLAN_ONLY",
        sourceHash,
        apiSourceHash: computeApiSourceHash(),
        plan
      });
      packageLambdaArtifact({ releaseId, sourceHash, variant: target });
      console.log(JSON.stringify({ releaseId, status: "PLAN_ONLY", releaseDir: releaseDirFor(releaseId), plan }, null, 2));
      return;
    }
    if (args.command === "deploy-canary") {
      const releaseId = resolveReleaseId(args.releaseId);
      args.releaseId = releaseId;
      deployCanary({ releaseId, dryRun: args.dryRun });
      return;
    }
    if (args.command === "run-canary-acceptance" || args.command === "record-canary-case") {
      if (!args.releaseId) throw new ReleaseError(`${args.command} requires --release`);
      const acceptance = parseAcceptanceArgs(args.rest);
      importAcceptanceEvidence({
        releaseId: args.releaseId,
        evidenceFile: acceptance.evidence || args.evidence,
        contactId: acceptance.contactId,
        caseId: acceptance.caseId,
        roundId: acceptance.roundId,
        testerId: acceptance.testerId,
        result: acceptance.result
      });
      return;
    }
    if (args.command === "summarize") {
      if (!args.releaseId) throw new ReleaseError("summarize requires --release");
      summarizeRelease({ releaseId: args.releaseId });
      return;
    }
    if (args.command === "promote-production") {
      if (!args.releaseId) throw new ReleaseError("promote-production requires --release");
      promoteProduction({
        releaseId: args.releaseId,
        dryRun: args.dryRun,
        authorizedEmergencyPromote: args.authorizedEmergencyPromote,
        acknowledgedReleaseId: args.acknowledgedReleaseId,
        acknowledgedSourceCommit: args.acknowledgedSourceCommit,
        authorizationReason: args.authorizationReason
      });
      return;
    }
    if (args.command === "rollback") {
      if (!args.releaseId) throw new ReleaseError("rollback requires --release");
      rollbackRelease({ releaseId: args.releaseId, snapshotPath: args.snapshot });
      return;
    }
    if (args.command === "verify") {
      if (!args.releaseId) throw new ReleaseError("verify requires --release");
      const acceptance = parseAcceptanceArgs(args.rest);
      verifyProduction({
        releaseId: args.releaseId,
        evidenceFile: acceptance.evidence || args.evidence,
        contactId: acceptance.contactId,
        caseId: acceptance.caseId,
        roundId: acceptance.roundId,
        testerId: acceptance.testerId
      });
      return;
    }
    usage();
    process.exitCode = 2;
  } catch (error) {
    const releaseId = args.releaseId || "unknown-release";
    if (releaseId !== "unknown-release") {
      const details = error.details || {};
      const sourceGateBlocked =
        error instanceof ReleaseError && /Source gate failed/i.test(error.message);
      const status =
        details.rolledBack
          ? "ROLLED_BACK_AFTER_VERIFIED_FAILURE"
          : (error instanceof AwsOperationError && details.permissionError) || error instanceof ExternalPermissionError
          ? "BLOCKED_BY_REAL_EXTERNAL_PERMISSION_ERROR"
          : sourceGateBlocked
            ? "BLOCKED_BY_FAILED_SOURCE_GATE"
            : "BLOCKED";
      const blocker = [
        error.message,
        details.service ? `AWS operation: ${details.service} ${details.operation}` : "",
        details.code ? `Error code: ${details.code}` : "",
        details.resourceArn ? `Resource ARN: ${details.resourceArn}` : "",
        details.requiredAction ? `Minimal required action: ${details.requiredAction}` : "",
        details.resource ? `Resource: ${details.resource}` : "",
        details.requiredPermission ? `Minimal required permission: ${details.requiredPermission}` : "",
        details.stderr ? `Stderr: ${details.stderr}` : ""
      ].filter(Boolean).join("\n\n");
      updateManifest(releaseId, {
        status,
        blockedAt: new Date().toISOString(),
        blocker: {
          message: error.message,
          details
        }
      });
      writeFinalReport({
        releaseId,
        status,
        blocker
      });
    }
    console.error(JSON.stringify({
      status: "failed",
      error: error.message,
      details: error.details || {}
    }, null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
