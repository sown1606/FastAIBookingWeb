import { Router } from "express";
import { ExternalProvider } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { sendSuccess } from "../../utils/response";
import { asyncHandler } from "../../middleware/async-handler";

export const healthRouter = Router();

const getAmazonConnectHealth = async () => {
  const activeIntegrationConfigCount = await prisma.integrationConfig.count({
    where: {
      provider: ExternalProvider.AMAZON_CONNECT,
      isActive: true
    }
  });
  const missing = [
    ...env.integrationStatuses.amazonConnect.missing,
    activeIntegrationConfigCount === 0 ? "Active AMAZON_CONNECT IntegrationConfig" : null
  ].filter((value): value is string => Boolean(value));

  return {
    configured: env.integrationStatuses.amazonConnect.configured,
    activeIntegrationConfigCount,
    ready: env.integrationStatuses.amazonConnect.configured && activeIntegrationConfigCount > 0,
    missing
  };
};

const getPushNotificationHealth = () => ({
  configured: env.integrationStatuses.pushNotifications.configured,
  ready: env.integrationStatuses.pushNotifications.configured,
  status: env.integrationStatuses.pushNotifications.configured ? "configured" : "not_configured",
  code: env.integrationStatuses.pushNotifications.code,
  missing: env.integrationStatuses.pushNotifications.missing
});

healthRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    return sendSuccess(res, {
      data: {
        status: "ok",
        timestamp: new Date().toISOString()
      }
    });
  })
);

healthRouter.get(
  "/liveness",
  asyncHandler(async (_req, res) => {
    return sendSuccess(res, {
      data: {
        status: "ok",
        timestamp: new Date().toISOString()
      }
    });
  })
);

healthRouter.get(
  "/ready",
  asyncHandler(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    const amazonConnect = await getAmazonConnectHealth();
    const pushNotifications = getPushNotificationHealth();
    return sendSuccess(res, {
      data: {
        status: amazonConnect.ready ? "ready" : "degraded",
        integrations: {
          amazonConnect,
          pushNotifications
        },
        timestamp: new Date().toISOString()
      }
    });
  })
);

healthRouter.get(
  "/readiness",
  asyncHandler(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    const amazonConnect = await getAmazonConnectHealth();
    const pushNotifications = getPushNotificationHealth();
    return sendSuccess(res, {
      data: {
        status: amazonConnect.ready ? "ready" : "degraded",
        integrations: {
          amazonConnect,
          pushNotifications
        },
        timestamp: new Date().toISOString()
      }
    });
  })
);
