import { Router } from "express";
import { prisma } from "../../db/prisma";
import { sendSuccess } from "../../utils/response";
import { asyncHandler } from "../../middleware/async-handler";

export const healthRouter = Router();

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
    return sendSuccess(res, {
      data: {
        status: "ready",
        timestamp: new Date().toISOString()
      }
    });
  })
);

healthRouter.get(
  "/readiness",
  asyncHandler(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    return sendSuccess(res, {
      data: {
        status: "ready",
        timestamp: new Date().toISOString()
      }
    });
  })
);
