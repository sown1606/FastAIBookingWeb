import { sendTransactionalEmail } from "../src/lib/mailer";

const main = async (): Promise<void> => {
  const toIndex = process.argv.indexOf("--to");
  const toEmail = toIndex >= 0 ? process.argv[toIndex + 1] : undefined;

  if (!toEmail) {
    console.error("Usage: npm --prefix apps/api run email:test -- --to <test-email>");
    process.exit(1);
  }

  const sent = await sendTransactionalEmail({
    toEmail,
    subject: "FastAIBooking email test",
    text: "This is a FastAIBooking transactional email test.",
    html: "<p>This is a FastAIBooking transactional email test.</p>",
    reason: "EMAIL_TEST"
  });

  if (!sent) {
    console.error("Email test did not send. Check API logs for provider configuration or SMTP delivery errors.");
    process.exit(1);
  }

  console.log(`Email test sent to ${toEmail}.`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
