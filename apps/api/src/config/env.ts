import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { z } from "zod";

const runtimeWorkingDirectory = process.cwd();
const monorepoRootCandidate = path.resolve(runtimeWorkingDirectory, "../..");
const monorepoRootExists =
  fs.existsSync(path.join(monorepoRootCandidate, "package.json")) &&
  fs.existsSync(path.join(monorepoRootCandidate, "apps"));
const canonicalRuntimeDirectory = monorepoRootExists ? monorepoRootCandidate : runtimeWorkingDirectory;
const dotenvPath = path.resolve(canonicalRuntimeDirectory, ".env");
const fallbackDotenvPath =
  canonicalRuntimeDirectory === runtimeWorkingDirectory
    ? null
    : path.resolve(runtimeWorkingDirectory, ".env");
const dotenvCandidatePaths = [dotenvPath, fallbackDotenvPath].filter(
  (value, index, array): value is string => Boolean(value) && array.indexOf(value) === index
);
const loadedDotenvPath = dotenvCandidatePaths.find((candidate) => fs.existsSync(candidate)) ?? null;
const dotenvExamplePath = path.resolve(canonicalRuntimeDirectory, ".env.example");
const fallbackDotenvExamplePath =
  canonicalRuntimeDirectory === runtimeWorkingDirectory
    ? null
    : path.resolve(runtimeWorkingDirectory, ".env.example");
const resolvedDotenvExamplePath = fs.existsSync(dotenvExamplePath)
  ? dotenvExamplePath
  : fallbackDotenvExamplePath ?? dotenvExamplePath;
const dotenvResult = dotenv.config({
  path: loadedDotenvPath ?? dotenvPath,
  override: process.env.NODE_ENV !== "test"
});

const toBoolean = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) {
    return defaultValue;
  }
  return value.toLowerCase() === "true";
};

const optionalPositiveInteger = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  return Number(value);
}, z.number().int().positive().optional());

const nonEmptyStringOrUndefined = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().optional());

const asNonEmpty = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const envSchema = z.object({
  APP_NAME: z.string().default("FastAIBooking API"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().default("/api/v1"),
  API_BASE_URL: z.string().default("http://localhost:3000"),
  CORS_ORIGINS: z.string().optional(),
  ADMIN_FRONTEND_URL: z.string().default("https://admin-new-nail.kendemo.com"),
  OWNER_FRONTEND_URL: z.string().default("https://app-new-nail.kendemo.com"),
  DATABASE_URL: z.string().optional(),
  DATABASE_HOST: z.string().default("localhost"),
  DATABASE_PORT: z.coerce.number().int().positive().default(5432),
  DATABASE_NAME: z.string().default("fastaibooking"),
  DATABASE_USER: z.string().default("postgres"),
  DATABASE_PASSWORD: z.string().default("postgres"),
  POSTGRES_HOST: z.string().optional(),
  POSTGRES_PORT: z.coerce.number().int().positive().optional(),
  POSTGRES_DB: z.string().optional(),
  POSTGRES_USER: z.string().optional(),
  POSTGRES_PASSWORD: z.string().optional(),
  JWT_SECRET: z.string().min(16),
  JWT_EXPIRES_IN: z.string().default("15m"),
  REFRESH_TOKEN_SECRET: z.string().min(16),
  REFRESH_TOKEN_EXPIRES_IN: z.string().default("30d"),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: optionalPositiveInteger,
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM_EMAIL: z.string().optional(),
  SMTP_FROM_NAME: z.string().default("FastAIBooking"),
  EMAIL_PROVIDER: z.string().default("demo"),
  AWS_SES_REGION: z.string().optional(),
  AWS_SES_FROM_EMAIL: z.string().optional(),
  AWS_SES_CONFIGURATION_SET: z.string().optional(),
  RESET_PASSWORD_URL: z.string().default("https://app-new-nail.kendemo.com/reset-password"),
  VERIFY_EMAIL_URL: z.string().default("https://app-new-nail.kendemo.com/verify-email"),
  STAFF_INVITE_APP_LINK: z.string().default("https://app-new-nail.kendemo.com/download-demo-app"),
  FEEDBACK_PUBLIC_URL: z.string().default("https://app-new-nail.kendemo.com/feedback"),
  SMS_PROVIDER: z.string().default("demo"),
  SMS_FROM_NUMBER: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
  FREE_STAFF_LIMIT: z.coerce.number().int().nonnegative().default(5),
  EXTRA_STAFF_PRICE: z.coerce.number().nonnegative().default(0),
  CALLRAIL_WEBHOOK_SECRET: nonEmptyStringOrUndefined,
  CALLRAIL_WEBHOOK_PATH: z.string().default("/api/v1/integrations/callrail/webhook"),
  CALLRAIL_API_KEY: nonEmptyStringOrUndefined,
  CALLRAIL_ACCOUNT_ID: nonEmptyStringOrUndefined,
  CALLRAIL_COMPANY_ID: nonEmptyStringOrUndefined,
  CALLRAIL_TRACKING_NUMBER_ID: nonEmptyStringOrUndefined,
  CALLRAIL_TRACKING_NUMBER: nonEmptyStringOrUndefined,
  CALLRAIL_CALL_FLOW_NAME: nonEmptyStringOrUndefined,
  CALLRAIL_TARGET_NUMBER: nonEmptyStringOrUndefined,
  CALLRAIL_DEFAULT_SALON_ID: nonEmptyStringOrUndefined,
  CALLRAIL_AI_FLOW_ID: nonEmptyStringOrUndefined,
  CALLRAIL_LIVE_PERSON_FLOW_ID: nonEmptyStringOrUndefined,
  CALL_CENTER_DEFAULT_PHONE: nonEmptyStringOrUndefined,
  DEMO_SALON_NAME: z.string().default("Kiet Nails & Beauty"),
  DEMO_ORIGINAL_PHONE_NUMBER: z.string().default("8487029493"),
  DEMO_FORWARDING_PHONE_NUMBER: z.string().default(""),
  DEMO_CARRIER: z.string().default("tmobile"),
  DEMO_FORWARDING_TYPE: z.string().default("no_answer"),
  DEMO_FORWARDING_ACTIVATION_CODE: z.string().default(""),
  DEMO_FORWARDING_DEACTIVATION_CODE: z.string().default("##61#"),
  DEMO_FORWARDING_STATUS_CODE: z.string().default("*#61#"),
  AWS_REGION: z.string().optional(),
  AWS_DEFAULT_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),
  AWS_END_USER_MESSAGING_REGION: z.string().optional(),
  AWS_SMS_ORIGINATION_NUMBER: z.string().optional(),
  AWS_SMS_CONFIGURATION_SET: z.string().optional(),
  AMAZON_CONNECT_INSTANCE_ID: z.string().optional(),
  AMAZON_CONNECT_INSTANCE_ARN: z.string().optional(),
  AMAZON_CONNECT_INSTANCE_ALIAS: z.string().optional(),
  AMAZON_CONNECT_INSTANCE_URL: z.string().optional(),
  AMAZON_CONNECT_CCP_URL: z.string().optional(),
  AMAZON_CONNECT_QUEUE_ID_DEFAULT: z.string().optional(),
  AMAZON_CONNECT_ROUTING_PROFILE_ID: z.string().optional(),
  AMAZON_CONNECT_OPERATOR_SECURITY_PROFILE_ID: z.string().optional(),
  AMAZON_CONNECT_CONTACT_FLOW_ID: z.string().optional(),
  AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION: z.string().optional(),
  AMAZON_CONNECT_CONTACT_FLOW_ID_HUMAN_ESCALATION: z.string().optional(),
  AMAZON_CONNECT_PHONE_NUMBER: z.string().optional(),
  AMAZON_CONNECT_PHONE_NUMBER_ID: z.string().optional(),
  AMAZON_CONNECT_RECORDING_BUCKET: z.string().optional(),
  AMAZON_CONNECT_RECORDING_PREFIX: z.string().optional(),
  AMAZON_LEX_BOT_ID: z.string().optional(),
  AMAZON_LEX_BOT_ALIAS_ID: z.string().optional(),
  AMAZON_LEX_LOCALE_ID: z.string().optional(),
  LEX_BOT_ID: z.string().optional(),
  LEX_BOT_ALIAS_ID: z.string().optional(),
  LEX_BOT_LOCALE_ID: z.string().optional(),
  AMAZON_LEX_BOOKING_INTENT_NAME: z.string().optional(),
  AMAZON_LEX_HUMAN_ESCALATION_INTENT_NAME: z.string().optional(),
  BOOKING_LAMBDA_FUNCTION_NAME: z.string().optional(),
  LAMBDA_BOOKING_HANDLER_NAME: z.string().optional(),
  BOOKING_LAMBDA_FUNCTION_ARN: z.string().optional(),
  FASTAIBOOKING_API_BASE_URL: z.string().optional(),
  FASTAIBOOKING_API_INTERNAL_TOKEN: z.string().optional(),
  FASTAIBOOKING_API_INTERNAL_TOKEN_PREVIOUS: z.string().optional(),
  FASTAIBOOKING_API_RELEASE_ID: z.string().optional(),
  FASTAIBOOKING_API_SOURCE_SHA256: z.string().optional(),
  FASTAIBOOKING_API_VARIANT: z.enum(["canary", "production", "development", "test"]).optional(),
  DEFAULT_SALON_ID: nonEmptyStringOrUndefined,
  GOOGLE_CLOUD_PROJECT: z.string().optional(),
  VERTEX_PROJECT_ID: z.string().optional(),
  VERTEX_AI_LOCATION: z.string().optional(),
  VERTEX_LOCATION: z.string().default("us-central1"),
  VERTEX_AI_MODEL: z.string().optional(),
  VERTEX_MODEL: z.string().default("gemini-1.5-flash-002"),
  VERTEX_SYSTEM_PROMPT_VERSION: z.string().default("v1"),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  VERTEX_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  VERTEX_API_KEY: z.string().optional(),
  VERTEX_PRIVATE_KEY: z.string().optional(),
  VERTEX_PRIVATE_KEY_ID: z.string().optional(),
  VERTEX_CLIENT_EMAIL: z.string().optional(),
  VERTEX_CLIENT_ID: z.string().optional(),
  VERTEX_CLIENT_CERT_URL: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_PATH: nonEmptyStringOrUndefined,
  FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: nonEmptyStringOrUndefined,
  FIREBASE_PROJECT_ID: z.string().optional(),
  FIREBASE_CLIENT_EMAIL: z.string().optional(),
  FIREBASE_PRIVATE_KEY: z.string().optional(),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional(),
  FIREBASE_WEB_PUSH_VAPID_KEY: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().optional(),
  AI_PROVIDER: z.enum(["amazon", "lex", "vertex"]).default("amazon"),
  CALL_PROVIDER: z.enum(["amazon_connect", "callrail"]).default("amazon_connect")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const message = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${message}`);
}

const base = parsed.data;

const resolvedDatabaseHost = asNonEmpty(base.DATABASE_HOST) ?? asNonEmpty(base.POSTGRES_HOST) ?? "localhost";
const resolvedDatabasePort = base.DATABASE_PORT ?? base.POSTGRES_PORT ?? 5432;
const resolvedDatabaseName = asNonEmpty(base.DATABASE_NAME) ?? asNonEmpty(base.POSTGRES_DB) ?? "fastaibooking";
const resolvedDatabaseUser = asNonEmpty(base.DATABASE_USER) ?? asNonEmpty(base.POSTGRES_USER) ?? "postgres";
const resolvedDatabasePassword =
  asNonEmpty(base.DATABASE_PASSWORD) ?? asNonEmpty(base.POSTGRES_PASSWORD) ?? "postgres";

const databaseUrl =
  base.DATABASE_URL ??
  `postgresql://${encodeURIComponent(resolvedDatabaseUser)}:${encodeURIComponent(resolvedDatabasePassword)}@${resolvedDatabaseHost}:${resolvedDatabasePort}/${resolvedDatabaseName}`;

const hasVertexCredentialFile = (() => {
  const credentialsPath = asNonEmpty(base.GOOGLE_APPLICATION_CREDENTIALS);
  if (!credentialsPath) {
    return false;
  }
  return fs.existsSync(credentialsPath);
})();

const hasVertexCredentialEnv =
  Boolean(asNonEmpty(base.VERTEX_CLIENT_EMAIL) ?? asNonEmpty(base.VERTEX_SERVICE_ACCOUNT_EMAIL)) &&
  Boolean(asNonEmpty(base.VERTEX_PRIVATE_KEY));
const firebaseServiceAccountPath = asNonEmpty(base.FIREBASE_SERVICE_ACCOUNT_PATH);
const hasFirebaseServiceAccountPath = Boolean(
  firebaseServiceAccountPath && fs.existsSync(firebaseServiceAccountPath)
);
const hasFirebaseServiceAccountJson = Boolean(asNonEmpty(base.FIREBASE_SERVICE_ACCOUNT_JSON));
const hasFirebaseServiceAccountJsonBase64 = Boolean(
  asNonEmpty(base.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64)
);
const hasFirebaseServiceAccountEnv =
  Boolean(asNonEmpty(base.FIREBASE_PROJECT_ID)) &&
  Boolean(asNonEmpty(base.FIREBASE_CLIENT_EMAIL)) &&
  Boolean(asNonEmpty(base.FIREBASE_PRIVATE_KEY));
const hasFirebaseAdminCredentials =
  hasFirebaseServiceAccountPath ||
  hasFirebaseServiceAccountJsonBase64 ||
  hasFirebaseServiceAccountJson ||
  hasFirebaseServiceAccountEnv;

const runtimeEnv = {
  workingDirectory: runtimeWorkingDirectory,
  dotenvPath,
  fallbackDotenvPath,
  loadedDotenvPath,
  dotenvFileExists: dotenvCandidatePaths.some((candidate) => fs.existsSync(candidate)),
  dotenvExamplePath: resolvedDotenvExamplePath,
  dotenvExampleExists: fs.existsSync(resolvedDotenvExamplePath),
  dotenvLoadedFromFile: Boolean(dotenvResult.parsed),
  note: (() => {
    if (loadedDotenvPath === dotenvPath && dotenvResult.parsed) {
      return `Runtime loaded environment values from ${dotenvPath}. This is the canonical runtime .env file for the current environment. ${resolvedDotenvExamplePath} is the template only.`;
    }
    if (loadedDotenvPath === fallbackDotenvPath && dotenvResult.parsed) {
      return `Runtime loaded environment values from ${fallbackDotenvPath}. The canonical monorepo runtime file is ${dotenvPath}, so keep that file in sync when you want one shared env source.`;
    }
    if (fs.existsSync(resolvedDotenvExamplePath)) {
      return `No runtime .env file was loaded from ${dotenvPath}. Fill ${resolvedDotenvExamplePath} first, then copy or sync it into ${dotenvPath}, or provide deployment environment variables.`;
    }
    return `No runtime .env file was loaded from ${dotenvPath}. Provide environment variables through a real .env file or the deployment environment.`;
  })()
};

const callRailAttributionKeys = [
  "CALLRAIL_API_KEY",
  "CALLRAIL_ACCOUNT_ID",
  "CALLRAIL_COMPANY_ID",
  "CALLRAIL_TRACKING_NUMBER_ID",
  "CALLRAIL_TRACKING_NUMBER",
  "CALLRAIL_WEBHOOK_SECRET"
] as const;

const callRailValueByKey: Record<(typeof callRailAttributionKeys)[number], string | undefined> = {
  CALLRAIL_API_KEY: asNonEmpty(base.CALLRAIL_API_KEY),
  CALLRAIL_ACCOUNT_ID: asNonEmpty(base.CALLRAIL_ACCOUNT_ID),
  CALLRAIL_COMPANY_ID: asNonEmpty(base.CALLRAIL_COMPANY_ID),
  CALLRAIL_TRACKING_NUMBER_ID: asNonEmpty(base.CALLRAIL_TRACKING_NUMBER_ID),
  CALLRAIL_TRACKING_NUMBER: asNonEmpty(base.CALLRAIL_TRACKING_NUMBER),
  CALLRAIL_WEBHOOK_SECRET: asNonEmpty(base.CALLRAIL_WEBHOOK_SECRET),
};

const resolvedCorsOrigins = Array.from(
  new Set(
    [
      ...((base.CORS_ORIGINS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0)),
      base.ADMIN_FRONTEND_URL.trim(),
      base.OWNER_FRONTEND_URL.trim()
    ].filter((value) => value.length > 0)
  )
);

const resolvedVertexProjectId =
  asNonEmpty(base.VERTEX_PROJECT_ID) ?? asNonEmpty(base.GOOGLE_CLOUD_PROJECT);
const resolvedVertexLocation =
  asNonEmpty(base.VERTEX_AI_LOCATION) ?? asNonEmpty(base.VERTEX_LOCATION) ?? "us-central1";
const resolvedVertexModel =
  asNonEmpty(base.VERTEX_AI_MODEL) ?? asNonEmpty(base.VERTEX_MODEL) ?? "gemini-1.5-flash-002";
const resolvedGeminiApiKey = asNonEmpty(base.GEMINI_API_KEY) ?? asNonEmpty(base.VERTEX_API_KEY);
const resolvedAwsRegion = asNonEmpty(base.AWS_REGION) ?? asNonEmpty(base.AWS_DEFAULT_REGION);
const resolvedLexBotId = asNonEmpty(base.AMAZON_LEX_BOT_ID) ?? asNonEmpty(base.LEX_BOT_ID);
const resolvedLexBotAliasId =
  asNonEmpty(base.AMAZON_LEX_BOT_ALIAS_ID) ?? asNonEmpty(base.LEX_BOT_ALIAS_ID);
const resolvedLexLocaleId =
  asNonEmpty(base.AMAZON_LEX_LOCALE_ID) ?? asNonEmpty(base.LEX_BOT_LOCALE_ID) ?? "en_US";
const resolvedBookingLambdaFunctionName =
  asNonEmpty(base.BOOKING_LAMBDA_FUNCTION_NAME) ?? asNonEmpty(base.LAMBDA_BOOKING_HANDLER_NAME);

const integrationStatuses = {
  callRail: {
    configured: callRailAttributionKeys.every((key) => Boolean(callRailValueByKey[key])),
    missing: callRailAttributionKeys.filter((key) => !callRailValueByKey[key])
  },
  vertex: {
    configured: Boolean(resolvedVertexProjectId && (hasVertexCredentialFile || hasVertexCredentialEnv || resolvedGeminiApiKey)),
    missing: [
      !resolvedVertexProjectId ? "VERTEX_PROJECT_ID or GOOGLE_CLOUD_PROJECT" : null,
      !hasVertexCredentialFile && !hasVertexCredentialEnv && !resolvedGeminiApiKey
        ? "GOOGLE_APPLICATION_CREDENTIALS or VERTEX_CLIENT_EMAIL/VERTEX_PRIVATE_KEY or GEMINI_API_KEY"
        : null
    ].filter((value): value is string => Boolean(value))
  },
  amazonConnect: {
    configured: Boolean(
      resolvedAwsRegion &&
        asNonEmpty(base.AMAZON_CONNECT_INSTANCE_ID) &&
        asNonEmpty(base.AMAZON_CONNECT_INSTANCE_ARN) &&
        asNonEmpty(base.AMAZON_CONNECT_INSTANCE_URL) &&
        asNonEmpty(base.AMAZON_CONNECT_CCP_URL) &&
        asNonEmpty(base.AMAZON_CONNECT_PHONE_NUMBER) &&
        asNonEmpty(base.AMAZON_CONNECT_PHONE_NUMBER_ID) &&
        asNonEmpty(base.AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION) &&
        asNonEmpty(base.AMAZON_CONNECT_CONTACT_FLOW_ID_HUMAN_ESCALATION) &&
        asNonEmpty(base.AMAZON_CONNECT_QUEUE_ID_DEFAULT) &&
        asNonEmpty(base.AMAZON_CONNECT_ROUTING_PROFILE_ID) &&
        asNonEmpty(base.AMAZON_CONNECT_OPERATOR_SECURITY_PROFILE_ID) &&
        resolvedLexBotId &&
        resolvedLexBotAliasId &&
        asNonEmpty(base.AMAZON_LEX_BOOKING_INTENT_NAME) &&
        asNonEmpty(base.AMAZON_LEX_HUMAN_ESCALATION_INTENT_NAME) &&
        resolvedBookingLambdaFunctionName &&
        asNonEmpty(base.BOOKING_LAMBDA_FUNCTION_ARN) &&
        asNonEmpty(base.FASTAIBOOKING_API_BASE_URL) &&
        asNonEmpty(base.FASTAIBOOKING_API_INTERNAL_TOKEN)
    ),
    missing: [
      !resolvedAwsRegion ? "AWS_REGION" : null,
      !asNonEmpty(base.AMAZON_CONNECT_INSTANCE_ID) ? "AMAZON_CONNECT_INSTANCE_ID" : null,
      !asNonEmpty(base.AMAZON_CONNECT_INSTANCE_ARN) ? "AMAZON_CONNECT_INSTANCE_ARN" : null,
      !asNonEmpty(base.AMAZON_CONNECT_INSTANCE_URL) ? "AMAZON_CONNECT_INSTANCE_URL" : null,
      !asNonEmpty(base.AMAZON_CONNECT_CCP_URL) ? "AMAZON_CONNECT_CCP_URL" : null,
      !asNonEmpty(base.AMAZON_CONNECT_PHONE_NUMBER) ? "AMAZON_CONNECT_PHONE_NUMBER" : null,
      !asNonEmpty(base.AMAZON_CONNECT_PHONE_NUMBER_ID)
        ? "AMAZON_CONNECT_PHONE_NUMBER_ID"
        : null,
      !asNonEmpty(base.AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION)
        ? "AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION"
        : null,
      !asNonEmpty(base.AMAZON_CONNECT_CONTACT_FLOW_ID_HUMAN_ESCALATION)
        ? "AMAZON_CONNECT_CONTACT_FLOW_ID_HUMAN_ESCALATION"
        : null,
      !asNonEmpty(base.AMAZON_CONNECT_QUEUE_ID_DEFAULT)
        ? "AMAZON_CONNECT_QUEUE_ID_DEFAULT"
        : null,
      !asNonEmpty(base.AMAZON_CONNECT_ROUTING_PROFILE_ID)
        ? "AMAZON_CONNECT_ROUTING_PROFILE_ID"
        : null,
      !asNonEmpty(base.AMAZON_CONNECT_OPERATOR_SECURITY_PROFILE_ID)
        ? "AMAZON_CONNECT_OPERATOR_SECURITY_PROFILE_ID"
        : null,
      !resolvedLexBotId ? "AMAZON_LEX_BOT_ID or LEX_BOT_ID" : null,
      !resolvedLexBotAliasId ? "AMAZON_LEX_BOT_ALIAS_ID or LEX_BOT_ALIAS_ID" : null,
      !asNonEmpty(base.AMAZON_LEX_BOOKING_INTENT_NAME)
        ? "AMAZON_LEX_BOOKING_INTENT_NAME"
        : null,
      !asNonEmpty(base.AMAZON_LEX_HUMAN_ESCALATION_INTENT_NAME)
        ? "AMAZON_LEX_HUMAN_ESCALATION_INTENT_NAME"
        : null,
      !resolvedBookingLambdaFunctionName
        ? "BOOKING_LAMBDA_FUNCTION_NAME or LAMBDA_BOOKING_HANDLER_NAME"
        : null,
      !asNonEmpty(base.BOOKING_LAMBDA_FUNCTION_ARN) ? "BOOKING_LAMBDA_FUNCTION_ARN" : null,
      !asNonEmpty(base.FASTAIBOOKING_API_BASE_URL) ? "FASTAIBOOKING_API_BASE_URL" : null,
      !asNonEmpty(base.FASTAIBOOKING_API_INTERNAL_TOKEN) ? "FASTAIBOOKING_API_INTERNAL_TOKEN" : null
    ].filter((value): value is string => Boolean(value))
  },
  pushNotifications: {
    configured: hasFirebaseAdminCredentials,
    code: hasFirebaseAdminCredentials
      ? "PUSH_NOTIFICATIONS_CONFIGURED"
      : "PUSH_NOTIFICATIONS_NOT_CONFIGURED",
    missing: [
      firebaseServiceAccountPath && !hasFirebaseServiceAccountPath
        ? "FIREBASE_SERVICE_ACCOUNT_PATH file"
        : null,
      !hasFirebaseAdminCredentials
        ? "FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON_BASE64 or FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY"
        : null,
      !asNonEmpty(base.FIREBASE_WEB_PUSH_VAPID_KEY) ? "FIREBASE_WEB_PUSH_VAPID_KEY" : null
    ].filter((value): value is string => Boolean(value))
  }
};

export const env = {
  ...base,
  API_PREFIX: base.API_PREFIX,
  CORS_ORIGINS: base.CORS_ORIGINS,
  corsOrigins: resolvedCorsOrigins,
  CALLRAIL_WEBHOOK_SECRET: asNonEmpty(base.CALLRAIL_WEBHOOK_SECRET),
  CALLRAIL_WEBHOOK_PATH: base.CALLRAIL_WEBHOOK_PATH,
  CALLRAIL_API_KEY: asNonEmpty(base.CALLRAIL_API_KEY),
  CALLRAIL_ACCOUNT_ID: asNonEmpty(base.CALLRAIL_ACCOUNT_ID),
  CALLRAIL_COMPANY_ID: asNonEmpty(base.CALLRAIL_COMPANY_ID),
  CALLRAIL_TRACKING_NUMBER_ID: asNonEmpty(base.CALLRAIL_TRACKING_NUMBER_ID),
  CALLRAIL_TRACKING_NUMBER: asNonEmpty(base.CALLRAIL_TRACKING_NUMBER),
  CALLRAIL_CALL_FLOW_NAME: asNonEmpty(base.CALLRAIL_CALL_FLOW_NAME),
  CALLRAIL_TARGET_NUMBER: asNonEmpty(base.CALLRAIL_TARGET_NUMBER),
  CALLRAIL_DEFAULT_SALON_ID: asNonEmpty(base.CALLRAIL_DEFAULT_SALON_ID),
  CALLRAIL_AI_FLOW_ID: asNonEmpty(base.CALLRAIL_AI_FLOW_ID),
  CALLRAIL_LIVE_PERSON_FLOW_ID: asNonEmpty(base.CALLRAIL_LIVE_PERSON_FLOW_ID),
  CALL_CENTER_DEFAULT_PHONE: asNonEmpty(base.CALL_CENTER_DEFAULT_PHONE),
  DEMO_SALON_NAME: base.DEMO_SALON_NAME,
  DEMO_ORIGINAL_PHONE_NUMBER: base.DEMO_ORIGINAL_PHONE_NUMBER,
  DEMO_FORWARDING_PHONE_NUMBER: base.DEMO_FORWARDING_PHONE_NUMBER,
  DEMO_CARRIER: base.DEMO_CARRIER,
  DEMO_FORWARDING_TYPE: base.DEMO_FORWARDING_TYPE,
  DEMO_FORWARDING_ACTIVATION_CODE: base.DEMO_FORWARDING_ACTIVATION_CODE,
  DEMO_FORWARDING_DEACTIVATION_CODE: base.DEMO_FORWARDING_DEACTIVATION_CODE,
  DEMO_FORWARDING_STATUS_CODE: base.DEMO_FORWARDING_STATUS_CODE,
  GOOGLE_CLOUD_PROJECT: asNonEmpty(base.GOOGLE_CLOUD_PROJECT),
  GEMINI_API_KEY: resolvedGeminiApiKey,
  DEFAULT_SALON_ID: asNonEmpty(base.DEFAULT_SALON_ID),
  EMAIL_PROVIDER: base.EMAIL_PROVIDER,
  AWS_SES_REGION: asNonEmpty(base.AWS_SES_REGION),
  AWS_SES_FROM_EMAIL: asNonEmpty(base.AWS_SES_FROM_EMAIL),
  AWS_SES_CONFIGURATION_SET: asNonEmpty(base.AWS_SES_CONFIGURATION_SET),
  AWS_REGION: resolvedAwsRegion,
  AWS_DEFAULT_REGION: asNonEmpty(base.AWS_DEFAULT_REGION) ?? resolvedAwsRegion,
  AWS_END_USER_MESSAGING_REGION: asNonEmpty(base.AWS_END_USER_MESSAGING_REGION),
  AWS_SMS_ORIGINATION_NUMBER: asNonEmpty(base.AWS_SMS_ORIGINATION_NUMBER),
  AWS_SMS_CONFIGURATION_SET: asNonEmpty(base.AWS_SMS_CONFIGURATION_SET),
  AMAZON_LEX_BOT_ID: resolvedLexBotId,
  AMAZON_LEX_BOT_ALIAS_ID: resolvedLexBotAliasId,
  AMAZON_LEX_LOCALE_ID: resolvedLexLocaleId,
  LEX_BOT_ID: asNonEmpty(base.LEX_BOT_ID) ?? resolvedLexBotId,
  LEX_BOT_ALIAS_ID: asNonEmpty(base.LEX_BOT_ALIAS_ID) ?? resolvedLexBotAliasId,
  LEX_BOT_LOCALE_ID: asNonEmpty(base.LEX_BOT_LOCALE_ID) ?? resolvedLexLocaleId,
  BOOKING_LAMBDA_FUNCTION_NAME: resolvedBookingLambdaFunctionName,
  LAMBDA_BOOKING_HANDLER_NAME:
    asNonEmpty(base.LAMBDA_BOOKING_HANDLER_NAME) ?? resolvedBookingLambdaFunctionName,
  DATABASE_URL: databaseUrl,
  DATABASE_HOST: resolvedDatabaseHost,
  DATABASE_PORT: resolvedDatabasePort,
  DATABASE_NAME: resolvedDatabaseName,
  DATABASE_USER: resolvedDatabaseUser,
  DATABASE_PASSWORD: resolvedDatabasePassword,
  POSTGRES_HOST: asNonEmpty(base.POSTGRES_HOST) ?? resolvedDatabaseHost,
  POSTGRES_PORT: base.POSTGRES_PORT ?? resolvedDatabasePort,
  POSTGRES_DB: asNonEmpty(base.POSTGRES_DB) ?? resolvedDatabaseName,
  POSTGRES_USER: asNonEmpty(base.POSTGRES_USER) ?? resolvedDatabaseUser,
  POSTGRES_PASSWORD: asNonEmpty(base.POSTGRES_PASSWORD) ?? resolvedDatabasePassword,
  VERTEX_PROJECT_ID: resolvedVertexProjectId,
  VERTEX_LOCATION: resolvedVertexLocation,
  VERTEX_MODEL: resolvedVertexModel,
  FIREBASE_SERVICE_ACCOUNT_PATH: firebaseServiceAccountPath,
  FIREBASE_SERVICE_ACCOUNT_JSON_BASE64: asNonEmpty(base.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64),
  FIREBASE_PROJECT_ID: asNonEmpty(base.FIREBASE_PROJECT_ID),
  FIREBASE_CLIENT_EMAIL: asNonEmpty(base.FIREBASE_CLIENT_EMAIL),
  FIREBASE_PRIVATE_KEY: asNonEmpty(base.FIREBASE_PRIVATE_KEY),
  FIREBASE_SERVICE_ACCOUNT_JSON: asNonEmpty(base.FIREBASE_SERVICE_ACCOUNT_JSON),
  FIREBASE_WEB_PUSH_VAPID_KEY: asNonEmpty(base.FIREBASE_WEB_PUSH_VAPID_KEY),
  integrationStatuses,
  runtimeEnv
};

export type Env = typeof env;
