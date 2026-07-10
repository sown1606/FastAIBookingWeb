import { SESv2Client, SendEmailCommand } from "@aws-sdk/client-sesv2";
import nodemailer from "nodemailer";
import { env } from "../config/env";
import { formatCustomerName } from "../utils/customer-name";
import { logger } from "./logger";

const getEmailProvider = (): string => env.EMAIL_PROVIDER.trim().toLowerCase();

const canUseSmtp =
  Boolean(env.SMTP_HOST) &&
  Boolean(env.SMTP_PORT) &&
  Boolean(env.SMTP_USER) &&
  Boolean(env.SMTP_PASSWORD) &&
  Boolean(env.SMTP_FROM_EMAIL);

const transport = canUseSmtp
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASSWORD
      }
    })
  : null;

const sesClient = () =>
  new SESv2Client({
    region: env.AWS_SES_REGION ?? env.AWS_REGION ?? "us-east-1"
  });

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const isSesProvider = (provider: string): boolean =>
  provider === "aws" || provider === "aws_ses" || provider === "ses";

const getMissingSmtpKeys = (): string[] => {
  return [
    env.SMTP_HOST ? null : "SMTP_HOST",
    env.SMTP_PORT ? null : "SMTP_PORT",
    env.SMTP_USER ? null : "SMTP_USER",
    env.SMTP_PASSWORD ? null : "SMTP_PASSWORD",
    env.SMTP_FROM_EMAIL ? null : "SMTP_FROM_EMAIL"
  ].filter((value): value is string => Boolean(value));
};

export const getEmailStartupConfig = () => {
  return {
    provider: getEmailProvider(),
    smtpHost: env.SMTP_HOST,
    smtpFrom: env.SMTP_FROM_EMAIL
  };
};

export const sendTransactionalEmail = async (input: {
  toEmail: string | null | undefined;
  subject: string;
  text: string;
  html?: string;
  reason: string;
  demoLog?: Record<string, unknown>;
}): Promise<boolean> => {
  if (!input.toEmail) {
    logger.info(
      {
        reason: input.reason
      },
      "Email recipient missing. Message kept in demo log."
    );
    return false;
  }

  const provider = getEmailProvider();

  if (isSesProvider(provider) && env.AWS_SES_FROM_EMAIL) {
    try {
      await sesClient().send(
        new SendEmailCommand({
          FromEmailAddress: `"${env.SMTP_FROM_NAME}" <${env.AWS_SES_FROM_EMAIL}>`,
          Destination: {
            ToAddresses: [input.toEmail]
          },
          Content: {
            Simple: {
              Subject: {
                Data: input.subject,
                Charset: "UTF-8"
              },
              Body: {
                Text: {
                  Data: input.text,
                  Charset: "UTF-8"
                },
                Html: input.html
                  ? {
                      Data: input.html,
                      Charset: "UTF-8"
                    }
                  : undefined
              }
            }
          },
          ConfigurationSetName: env.AWS_SES_CONFIGURATION_SET
        })
      );
      logger.info(
        {
          toEmail: input.toEmail,
          provider: "aws_ses",
          reason: input.reason
        },
        "AWS SES email sent."
      );
      return true;
    } catch (error) {
      logger.error(
        {
          error,
          toEmail: input.toEmail,
          provider: "aws_ses",
          reason: input.reason
        },
        "AWS SES email send failed."
      );
      return false;
    }
  }

  if (transport && env.SMTP_FROM_EMAIL) {
    try {
      await transport.sendMail({
        from: `"${env.SMTP_FROM_NAME}" <${env.SMTP_FROM_EMAIL}>`,
        to: input.toEmail,
        subject: input.subject,
        text: input.text,
        html: input.html
      });
      logger.info(
        {
          toEmail: input.toEmail,
          provider: "smtp",
          reason: input.reason
        },
        "SMTP email sent."
      );
      return true;
    } catch (error) {
      logger.error(
        {
          error,
          toEmail: input.toEmail,
          provider: "smtp",
          smtpHost: env.SMTP_HOST,
          smtpFrom: env.SMTP_FROM_EMAIL,
          reason: input.reason
        },
        "SMTP email send failed."
      );
      return false;
    }
  }

  logger.info(
    {
      toEmail: input.toEmail,
      provider: "demo",
      reason: input.reason,
      missingSmtpKeys: getMissingSmtpKeys(),
      ...input.demoLog
    },
    "Email provider is not configured. Message kept in demo log."
  );
  return false;
};

const formatAppointmentTime = (startTime: Date): string => {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC"
  }).format(startTime);
};

const getAppointmentServiceLabel = (appointment: {
  service?: { name: string } | null;
  appointmentServices?: Array<{ service?: { name: string } | null }>;
}): string => {
  const serviceNames = appointment.appointmentServices
    ?.map((item) => item.service?.name)
    .filter((value): value is string => Boolean(value));
  return serviceNames?.length ? serviceNames.join(", ") : appointment.service?.name ?? "service";
};

const getCustomerName = (appointment: {
  customer: { firstName: string; lastName: string };
}): string => {
  return formatCustomerName(appointment.customer.firstName, appointment.customer.lastName);
};

type AppointmentEmailInput = {
  id: string;
  startTime: Date;
  status?: string;
  canceledReason?: string | null;
  customer: {
    firstName: string;
    lastName: string;
    email?: string | null;
  };
  staff: {
    fullName: string;
  };
  service?: {
    name: string;
  } | null;
  appointmentServices?: Array<{
    service?: {
      name: string;
    } | null;
  }>;
};

const sendAppointmentEmail = async (
  appointment: AppointmentEmailInput,
  input: {
    subject: string;
    intro: string;
    reason: string;
  }
): Promise<void> => {
  const customerName = getCustomerName(appointment);
  const serviceName = getAppointmentServiceLabel(appointment);
  const appointmentTime = formatAppointmentTime(appointment.startTime);
  const text = [
    `Hello ${customerName || "there"},`,
    "",
    input.intro,
    `Service: ${serviceName}`,
    `Staff: ${appointment.staff.fullName}`,
    `Time: ${appointmentTime}`,
    appointment.canceledReason ? `Reason: ${appointment.canceledReason}` : null,
    "",
    "Thank you for choosing FastAIBooking."
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");

  await sendTransactionalEmail({
    toEmail: appointment.customer.email,
    subject: input.subject,
    text,
    html: `<p>Hello ${escapeHtml(customerName || "there")},</p><p>${escapeHtml(input.intro)}</p><ul><li>Service: ${escapeHtml(serviceName)}</li><li>Staff: ${escapeHtml(appointment.staff.fullName)}</li><li>Time: ${escapeHtml(appointmentTime)}</li></ul>${
      appointment.canceledReason ? `<p>Reason: ${escapeHtml(appointment.canceledReason)}</p>` : ""
    }<p>Thank you for choosing FastAIBooking.</p>`,
    reason: input.reason
  });
};

export const sendAppointmentConfirmationEmail = async (
  appointment: AppointmentEmailInput
): Promise<void> => {
  await sendAppointmentEmail(appointment, {
    subject: "FastAIBooking appointment confirmation",
    intro: "Your appointment has been booked.",
    reason: "APPOINTMENT_CONFIRMATION"
  });
};

export const sendAppointmentUpdateEmail = async (
  appointment: AppointmentEmailInput
): Promise<void> => {
  await sendAppointmentEmail(appointment, {
    subject: "FastAIBooking appointment update",
    intro: "Your appointment has been updated.",
    reason: "APPOINTMENT_UPDATE"
  });
};

export const sendAppointmentCancellationEmail = async (
  appointment: AppointmentEmailInput
): Promise<void> => {
  await sendAppointmentEmail(appointment, {
    subject: "FastAIBooking appointment cancellation",
    intro: "Your appointment has been canceled.",
    reason: "APPOINTMENT_CANCELLATION"
  });
};

export const sendPasswordResetEmail = async (
  toEmail: string,
  recipientName: string,
  resetToken: string
): Promise<void> => {
  const resetLink = `${env.RESET_PASSWORD_URL}?token=${encodeURIComponent(resetToken)}`;

  await sendTransactionalEmail({
    toEmail,
    subject: "FastAIBooking password reset",
    text: `Hello ${recipientName}, use this link to reset your password: ${resetLink}`,
    html: `<p>Hello ${recipientName},</p><p>Use this link to reset your password:</p><p><a href="${resetLink}">${resetLink}</a></p>`,
    reason: "PASSWORD_RESET",
    demoLog: {
      resetLink
    }
  });
};

export const sendStaffInvitationEmail = async (input: {
  toEmail: string;
  recipientName: string;
  salonName: string;
  temporaryPassword?: string;
}): Promise<boolean> => {
  const subject = `Invitation to ${input.salonName} on FastAIBooking`;
  const textLines = [
    `Hello ${input.recipientName},`,
    "",
    `${input.salonName} invited you to use FastAIBooking for your schedule, messages, and assigned appointments.`,
    `Login email: ${input.toEmail}`,
    `Demo app download link: ${env.STAFF_INVITE_APP_LINK}`,
    input.temporaryPassword ? `Temporary password: ${input.temporaryPassword}` : undefined,
    "",
    "Please sign in and change your password after setup.",
    "Thank you."
  ].filter((line): line is string => line !== undefined);

  return sendTransactionalEmail({
    toEmail: input.toEmail,
    subject,
    text: textLines.join("\n"),
    html: `<p>Hello ${escapeHtml(input.recipientName)},</p><p>${escapeHtml(input.salonName)} invited you to use FastAIBooking for your schedule, messages, and assigned appointments.</p><p>Login email: ${escapeHtml(input.toEmail)}</p><p>Demo app download link: <a href="${escapeHtml(env.STAFF_INVITE_APP_LINK)}">${escapeHtml(env.STAFF_INVITE_APP_LINK)}</a></p>${
      input.temporaryPassword ? `<p>Temporary password: ${escapeHtml(input.temporaryPassword)}</p>` : ""
    }<p>Please sign in and change your password after setup.</p><p>Thank you.</p>`,
    reason: "STAFF_INVITATION",
    demoLog: {
      appLink: env.STAFF_INVITE_APP_LINK,
      temporaryPassword: input.temporaryPassword
    }
  });
};

export const sendStaffPasswordChangedEmail = async (input: {
  toEmail: string;
  recipientName: string;
  salonName: string;
  newPassword: string;
}): Promise<boolean> => {
  const subject = `${input.salonName} FastAIBooking password changed`;
  const text = [
    `Hello ${input.recipientName},`,
    "",
    `The owner of ${input.salonName} changed your FastAIBooking password.`,
    `Login email: ${input.toEmail}`,
    `New password: ${input.newPassword}`,
    "",
    "Please sign in and keep this password secure.",
    "Thank you."
  ].join("\n");

  return sendTransactionalEmail({
    toEmail: input.toEmail,
    subject,
    text,
    html: `<p>Hello ${escapeHtml(input.recipientName)},</p><p>The owner of ${escapeHtml(input.salonName)} changed your FastAIBooking password.</p><p>Login email: ${escapeHtml(input.toEmail)}</p><p>New password: ${escapeHtml(input.newPassword)}</p><p>Please sign in and keep this password secure.</p><p>Thank you.</p>`,
    reason: "STAFF_PASSWORD_CHANGED"
  });
};
