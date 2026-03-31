import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

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
  DATABASE_SSL: z.string().optional(),
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
  DOMAIN_API: z.string().default("api-new-nail.kendemo.com"),
  DOMAIN_ADMIN: z.string().default("admin-new-nail.kendemo.com"),
  DOMAIN_APP: z.string().default("app-new-nail.kendemo.com"),
  SERVER_IP: z.string().default("32.194.150.135"),
  CALLRAIL_API_KEY: z.string().optional(),
  CALLRAIL_ACCOUNT_ID: z.string().optional(),
  CALLRAIL_COMPANY_ID: z.string().optional(),
  CALLRAIL_WEBHOOK_SECRET: z.string().optional(),
  CALLRAIL_BASE_URL: z.string().default("https://api.callrail.com"),
  CALLRAIL_TRACKING_NUMBER: z.string().optional(),
  CALLRAIL_TARGET_NUMBER: z.string().optional(),
  CALLRAIL_DEFAULT_SALON_ID: z.string().optional(),
  CALLRAIL_AI_FLOW_ID: z.string().optional(),
  CALLRAIL_LIVE_PERSON_FLOW_ID: z.string().optional(),
  CALL_CENTER_DEFAULT_PHONE: z.string().optional(),
  VERTEX_PROJECT_ID: z.string().optional(),
  VERTEX_LOCATION: z.string().default("us-central1"),
  VERTEX_MODEL: z.string().default("gemini-1.5-flash-002"),
  VERTEX_SYSTEM_PROMPT_VERSION: z.string().default("v1"),
  GOOGLE_APPLICATION_CREDENTIALS: z.string().optional(),
  VERTEX_SERVICE_ACCOUNT_EMAIL: z.string().optional(),
  VERTEX_PRIVATE_KEY: z.string().optional(),
  VERTEX_PRIVATE_KEY_ID: z.string().optional(),
  VERTEX_CLIENT_EMAIL: z.string().optional(),
  VERTEX_CLIENT_ID: z.string().optional(),
  VERTEX_CLIENT_CERT_URL: z.string().optional(),
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

export const env = {
  ...base,
  DATABASE_URL: databaseUrl,
  DATABASE_SSL: toBoolean(base.DATABASE_SSL, false)
};

export type Env = typeof env;
