import nodemailer from "nodemailer";
import { env } from "../config/env";
import { logger } from "./logger";

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

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

export const sendPasswordResetEmail = async (
  toEmail: string,
  recipientName: string,
  resetToken: string
): Promise<void> => {
  const resetLink = `${env.RESET_PASSWORD_URL}?token=${encodeURIComponent(resetToken)}`;

  if (!transport || !env.SMTP_FROM_EMAIL) {
    logger.warn(
      {
        toEmail,
        resetToken,
        resetLink
      },
      "SMTP is not configured. Password reset token generated."
    );
    return;
  }

  await transport.sendMail({
    from: `"${env.SMTP_FROM_NAME}" <${env.SMTP_FROM_EMAIL}>`,
    to: toEmail,
    subject: "FastAIBooking password reset",
    text: `Hello ${recipientName}, use this link to reset your password: ${resetLink}`,
    html: `<p>Hello ${recipientName},</p><p>Use this link to reset your password:</p><p><a href="${resetLink}">${resetLink}</a></p>`
  });
};

export const sendStaffInvitationEmail = async (input: {
  toEmail: string;
  recipientName: string;
  salonName: string;
  temporaryPassword?: string;
}): Promise<void> => {
  const subject = `Invitation to ${input.salonName} on FastAIBooking`;
  const textLines = [
    `Hello ${input.recipientName},`,
    "",
    `${input.salonName} invited you to use FastAIBooking for your schedule, messages, and assigned appointments.`,
    `Demo app download link: ${env.STAFF_INVITE_APP_LINK}`,
    input.temporaryPassword ? `Temporary password: ${input.temporaryPassword}` : undefined,
    "",
    "Please sign in and change your password after setup.",
    "Thank you."
  ].filter((line): line is string => line !== undefined);

  if (!transport || !env.SMTP_FROM_EMAIL) {
    logger.info(
      {
        toEmail: input.toEmail,
        appLink: env.STAFF_INVITE_APP_LINK,
        temporaryPassword: input.temporaryPassword
      },
      "SMTP is not configured. Staff invitation kept in demo log."
    );
    return;
  }

  await transport.sendMail({
    from: `"${env.SMTP_FROM_NAME}" <${env.SMTP_FROM_EMAIL}>`,
    to: input.toEmail,
    subject,
    text: textLines.join("\n"),
    html: `<p>Hello ${escapeHtml(input.recipientName)},</p><p>${escapeHtml(input.salonName)} invited you to use FastAIBooking for your schedule, messages, and assigned appointments.</p><p>Demo app download link: <a href="${escapeHtml(env.STAFF_INVITE_APP_LINK)}">${escapeHtml(env.STAFF_INVITE_APP_LINK)}</a></p>${
      input.temporaryPassword ? `<p>Temporary password: ${escapeHtml(input.temporaryPassword)}</p>` : ""
    }<p>Please sign in and change your password after setup.</p><p>Thank you.</p>`
  });
};
