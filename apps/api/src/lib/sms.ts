import {
  PinpointSMSVoiceV2Client,
  SendTextMessageCommand
} from "@aws-sdk/client-pinpoint-sms-voice-v2";
import { env } from "../config/env";
import { logger } from "./logger";

const getSmsProvider = (): string => env.SMS_PROVIDER.trim().toLowerCase();

const awsSmsClient = () =>
  new PinpointSMSVoiceV2Client({
    region: env.AWS_END_USER_MESSAGING_REGION ?? env.AWS_REGION ?? "us-east-1"
  });

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

  const provider = getSmsProvider();
  if (provider === "aws" || provider === "aws_sms" || provider === "end_user_messaging") {
    if (!env.AWS_SMS_ORIGINATION_NUMBER) {
      logger.warn(
        {
          to: input.to,
          reason: input.reason
        },
        "AWS SMS is selected, but no origination number is configured. Message kept in demo log."
      );
      return;
    }

    try {
      await awsSmsClient().send(
        new SendTextMessageCommand({
          DestinationPhoneNumber: input.to,
          OriginationIdentity: env.AWS_SMS_ORIGINATION_NUMBER,
          MessageBody: input.body,
          MessageType: "TRANSACTIONAL",
          ConfigurationSetName: env.AWS_SMS_CONFIGURATION_SET
        })
      );
      logger.info(
        {
          to: input.to,
          reason: input.reason
        },
        "AWS SMS sent."
      );
    } catch (error) {
      logger.warn(
        {
          to: input.to,
          reason: input.reason,
          error: error instanceof Error ? error.message : String(error)
        },
        "AWS SMS failed. Continuing without blocking the caller workflow."
      );
    }
    return;
  }

  const hasTwilioConfig =
    provider === "twilio" &&
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
