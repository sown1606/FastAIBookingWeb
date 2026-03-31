import { env } from "../config/env";
import { logger } from "./logger";

export const sendSms = async (input: {
  to: string | null | undefined;
  body: string;
  reason: string;
}): Promise<void> => {
  if (!input.to) {
    logger.warn(
      {
        reason: input.reason,
        body: input.body
      },
      "SMS recipient missing. Message kept in demo log."
    );
    return;
  }

  const hasTwilioConfig =
    env.SMS_PROVIDER.toLowerCase() === "twilio" &&
    Boolean(env.TWILIO_ACCOUNT_SID) &&
    Boolean(env.TWILIO_AUTH_TOKEN) &&
    (Boolean(env.TWILIO_MESSAGING_SERVICE_SID) || Boolean(env.SMS_FROM_NUMBER));

  if (!hasTwilioConfig) {
    logger.info(
      {
        to: input.to,
        body: input.body,
        reason: input.reason
      },
      "SMS provider is not configured. Message kept in demo log."
    );
    return;
  }

  logger.info(
    {
      to: input.to,
      reason: input.reason
    },
    "SMS provider integration point reached. Configure provider adapter before production send."
  );
};
