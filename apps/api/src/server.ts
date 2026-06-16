import { app } from "./app";
import { env } from "./config/env";
import { prisma } from "./db/prisma";
import { logger } from "./lib/logger";
import { getEmailStartupConfig } from "./lib/mailer";

const server = app.listen(env.PORT, () => {
  const emailConfig = getEmailStartupConfig();
  logger.info(
    {
      port: env.PORT,
      env: env.NODE_ENV
    },
    "FastAIBooking API server is running"
  );
  logger.info(`Email provider: ${emailConfig.provider}`);
  logger.info(`SMTP host: ${emailConfig.smtpHost ?? "not configured"}`);
  logger.info(`SMTP from: ${emailConfig.smtpFrom ?? "not configured"}`);
});

const shutdown = async (signal: string): Promise<void> => {
  logger.info({ signal }, "Shutting down API server");
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (error) => {
  logger.error({ error }, "Uncaught exception");
  void shutdown("uncaughtException");
});
