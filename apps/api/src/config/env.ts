import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { z } from "zod";

const runtimeWorkingDirectory = process.cwd();
const dotenvPath = path.resolve(runtimeWorkingDirectory, ".env");
const dotenvExamplePath = path.resolve(runtimeWorkingDirectory, ".env.example");
const dotenvResult = dotenv.config({ path: dotenvPath });

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
  API_BASE_URL: z.string().default("http://localhost:3000"),
  ADMIN_FRONTEND_URL: z.string().default("https://admin-new-nail.kendemo.com"),
  OWNER_FRONTEND_URL: z.string().default("https://app-new-nail.kendemo.com"),
  DATABASE_URL: z.string().optional(),
  DATABASE_HOST: z.string().default("localhost"),
  DATABASE_PORT: z.coerce.number().int().positive().default(5432),
  DATABASE_NAME: z.string().default("fastaibooking"),
  DATABASE_USER: z.string().default("postgres"),
  DATABASE_PASSWORD: z.string().default("postgres"),
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
  CALLRAIL_API_KEY: nonEmptyStringOrUndefined,
  CALLRAIL_ACCOUNT_ID: nonEmptyStringOrUndefined,
  CALLRAIL_COMPANY_ID: nonEmptyStringOrUndefined,
  CALLRAIL_TRACKING_NUMBER_ID: nonEmptyStringOrUndefined,
  CALLRAIL_TRACKING_NUMBER: nonEmptyStringOrUndefined,
  CALLRAIL_TARGET_NUMBER: nonEmptyStringOrUndefined,
  CALLRAIL_DEFAULT_SALON_ID: nonEmptyStringOrUndefined,
  CALLRAIL_AI_FLOW_ID: nonEmptyStringOrUndefined,
  CALLRAIL_LIVE_PERSON_FLOW_ID: nonEmptyStringOrUndefined,
  CALL_CENTER_DEFAULT_PHONE: nonEmptyStringOrUndefined,
  AWS_REGION: z.string().optional(),
  AMAZON_CONNECT_INSTANCE_ID: z.string().optional(),
  AMAZON_CONNECT_INSTANCE_URL: z.string().optional(),
  AMAZON_CONNECT_CCP_URL: z.string().optional(),
  AMAZON_CONNECT_QUEUE_ID_DEFAULT: z.string().optional(),
  AMAZON_CONNECT_ROUTING_PROFILE_ID: z.string().optional(),
  VERTEX_PROJECT_ID: z.string().optional(),
  VERTEX_LOCATION: z.string().default("us-central1"),
  VERTEX_MODEL: z.string().default("gemini-1.5-flash-002"),
  VERTEX_SYSTEM_PROMPT_VERSION: z.string().default("v1"),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  VERTEX_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  VERTEX_PRIVATE_KEY: z.string().optional(),
  VERTEX_PRIVATE_KEY_ID: z.string().optional(),
  VERTEX_CLIENT_EMAIL: z.string().optional(),
  AI_PROVIDER: z.enum(["vertex"]).default("vertex"),
  CALL_PROVIDER: z.enum(["callrail"]).default("callrail")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const message = parsed.error.issues
    .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
    .join("; ");
  throw new Error(`Invalid environment configuration: ${message}`);
}

const base = parsed.data;

const databaseUrl =
  base.DATABASE_URL ??
  `postgresql://${encodeURIComponent(base.DATABASE_USER)}:${encodeURIComponent(base.DATABASE_PASSWORD)}@${base.DATABASE_HOST}:${base.DATABASE_PORT}/${base.DATABASE_NAME}`;

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

const runtimeEnv = {
  workingDirectory: runtimeWorkingDirectory,
  dotenvPath,
  dotenvFileExists: fs.existsSync(dotenvPath),
  dotenvExamplePath,
  dotenvExampleExists: fs.existsSync(dotenvExamplePath),
  dotenvLoadedFromFile: Boolean(dotenvResult.parsed),
  note: (() => {
    if (dotenvResult.parsed) {
      return `Runtime loaded environment values from ${dotenvPath}. .env.example is documentation only.`;
    }
    if (fs.existsSync(dotenvExamplePath)) {
      return `No runtime .env file was loaded from ${dotenvPath}. .env.example is documentation only, so use a real .env file or deployment environment variables.`;
    }
    return `No runtime .env file was loaded from ${dotenvPath}. Provide environment variables through a real .env file or the deployment environment.`;
  })()
};

const callRailRequiredKeys = [
  "CALLRAIL_WEBHOOK_SECRET",
  "CALLRAIL_API_KEY",
  "CALLRAIL_ACCOUNT_ID",
  "CALLRAIL_COMPANY_ID",
  "CALLRAIL_TRACKING_NUMBER_ID",
  "CALLRAIL_TRACKING_NUMBER",
  "CALLRAIL_DEFAULT_SALON_ID",
  "CALLRAIL_AI_FLOW_ID"
] as const;

const callRailValueByKey: Record<(typeof callRailRequiredKeys)[number], string | undefined> = {
  CALLRAIL_WEBHOOK_SECRET: asNonEmpty(base.CALLRAIL_WEBHOOK_SECRET),
  CALLRAIL_API_KEY: asNonEmpty(base.CALLRAIL_API_KEY),
  CALLRAIL_ACCOUNT_ID: asNonEmpty(base.CALLRAIL_ACCOUNT_ID),
  CALLRAIL_COMPANY_ID: asNonEmpty(base.CALLRAIL_COMPANY_ID),
  CALLRAIL_TRACKING_NUMBER_ID: asNonEmpty(base.CALLRAIL_TRACKING_NUMBER_ID),
  CALLRAIL_TRACKING_NUMBER: asNonEmpty(base.CALLRAIL_TRACKING_NUMBER),
  CALLRAIL_DEFAULT_SALON_ID: asNonEmpty(base.CALLRAIL_DEFAULT_SALON_ID),
  CALLRAIL_AI_FLOW_ID: asNonEmpty(base.CALLRAIL_AI_FLOW_ID)
};

const integrationStatuses = {
  callRail: {
    configured: callRailRequiredKeys.every((key) => Boolean(callRailValueByKey[key])),
    missing: callRailRequiredKeys.filter((key) => !callRailValueByKey[key])
  },
  vertex: {
    configured: Boolean(asNonEmpty(base.VERTEX_PROJECT_ID) && (hasVertexCredentialFile || hasVertexCredentialEnv)),
    missing: [
      !asNonEmpty(base.VERTEX_PROJECT_ID) ? "VERTEX_PROJECT_ID" : null,
      !hasVertexCredentialFile && !hasVertexCredentialEnv
        ? "GOOGLE_APPLICATION_CREDENTIALS or VERTEX_CLIENT_EMAIL/VERTEX_PRIVATE_KEY"
        : null
    ].filter((value): value is string => Boolean(value))
  },
  amazonConnect: {
    configured: Boolean(
      asNonEmpty(base.AWS_REGION) &&
        asNonEmpty(base.AMAZON_CONNECT_INSTANCE_ID) &&
        asNonEmpty(base.AMAZON_CONNECT_INSTANCE_URL) &&
        asNonEmpty(base.AMAZON_CONNECT_CCP_URL) &&
        asNonEmpty(base.AMAZON_CONNECT_QUEUE_ID_DEFAULT) &&
        asNonEmpty(base.AMAZON_CONNECT_ROUTING_PROFILE_ID)
    ),
    missing: [
      !asNonEmpty(base.AWS_REGION) ? "AWS_REGION" : null,
      !asNonEmpty(base.AMAZON_CONNECT_INSTANCE_ID) ? "AMAZON_CONNECT_INSTANCE_ID" : null,
      !asNonEmpty(base.AMAZON_CONNECT_INSTANCE_URL) ? "AMAZON_CONNECT_INSTANCE_URL" : null,
      !asNonEmpty(base.AMAZON_CONNECT_CCP_URL) ? "AMAZON_CONNECT_CCP_URL" : null,
      !asNonEmpty(base.AMAZON_CONNECT_QUEUE_ID_DEFAULT)
        ? "AMAZON_CONNECT_QUEUE_ID_DEFAULT"
        : null,
      !asNonEmpty(base.AMAZON_CONNECT_ROUTING_PROFILE_ID)
        ? "AMAZON_CONNECT_ROUTING_PROFILE_ID"
        : null
    ].filter((value): value is string => Boolean(value))
  }
};

export const env = {
  ...base,
  CALLRAIL_WEBHOOK_SECRET: asNonEmpty(base.CALLRAIL_WEBHOOK_SECRET),
  CALLRAIL_API_KEY: asNonEmpty(base.CALLRAIL_API_KEY),
  CALLRAIL_ACCOUNT_ID: asNonEmpty(base.CALLRAIL_ACCOUNT_ID),
  CALLRAIL_COMPANY_ID: asNonEmpty(base.CALLRAIL_COMPANY_ID),
  CALLRAIL_TRACKING_NUMBER_ID: asNonEmpty(base.CALLRAIL_TRACKING_NUMBER_ID),
  CALLRAIL_TRACKING_NUMBER: asNonEmpty(base.CALLRAIL_TRACKING_NUMBER),
  CALLRAIL_TARGET_NUMBER: asNonEmpty(base.CALLRAIL_TARGET_NUMBER),
  CALLRAIL_DEFAULT_SALON_ID: asNonEmpty(base.CALLRAIL_DEFAULT_SALON_ID),
  CALLRAIL_AI_FLOW_ID: asNonEmpty(base.CALLRAIL_AI_FLOW_ID),
  CALLRAIL_LIVE_PERSON_FLOW_ID: asNonEmpty(base.CALLRAIL_LIVE_PERSON_FLOW_ID),
  CALL_CENTER_DEFAULT_PHONE: asNonEmpty(base.CALL_CENTER_DEFAULT_PHONE),
  DATABASE_URL: databaseUrl,
  integrationStatuses,
  runtimeEnv
};

export type Env = typeof env;
