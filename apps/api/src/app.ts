import cors from "cors";
import express, { Request } from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { Role } from "@prisma/client";
import { PUBLIC_API_PREFIX } from "./config/constants";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { authenticate, requireRoles, requireSalonAccess } from "./middleware/auth";
import { errorHandler } from "./middleware/error-handler";
import { notFoundHandler } from "./middleware/not-found";
import { requestContext } from "./middleware/request-context";
import { adminRouter } from "./modules/admin/admin.routes";
import { alertsRouter } from "./modules/alerts/alerts.routes";
import { appointmentsRouter } from "./modules/appointments/appointments.routes";
import { authRouter } from "./modules/auth/auth.routes";
import { availabilityRouter } from "./modules/availability/availability.routes";
import { billingRouter } from "./modules/billing/billing.routes";
import { businessHoursRouter } from "./modules/business-hours/business-hours.routes";
import { aiInternalRouter, aiRouter } from "./modules/ai/ai.routes";
import { callCenterRouter } from "./modules/call-center/call-center.routes";
import { callrailWebhookRouter } from "./modules/calls/callrail-webhook.routes";
import { callsRouter } from "./modules/calls/calls.routes";
import { customersRouter } from "./modules/customers/customers.routes";
import { feedbackRouter } from "./modules/feedback/feedback.routes";
import { healthRouter } from "./modules/health/health.routes";
import { messagesRouter } from "./modules/messages/messages.routes";
import { ownerRouter } from "./modules/owner/owner.routes";
import { salonRouter } from "./modules/salon/salon.routes";
import { servicesRouter } from "./modules/services/services.routes";
import { staffRouter } from "./modules/staff/staff.routes";

const allowedOrigins = env.corsOrigins;

export const app = express();

app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true
  })
);
app.use(
  express.json({
    limit: "5mb",
    verify: (req, _res, buffer) => {
      (req as Request).rawBody = buffer.toString("utf8");
    }
  })
);
app.use(requestContext);
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.requestId ?? "missing-request-id",
    customSuccessMessage: (req) => `${req.method} ${req.url} completed`,
    customErrorMessage: (req) => `${req.method} ${req.url} failed`
  })
);

app.get("/", (_req, res) => {
  res.json({
    success: true,
    data: {
      name: env.APP_NAME,
      environment: env.NODE_ENV,
      now: new Date().toISOString()
    }
  });
});

app.use("/health", healthRouter);
app.use(`${PUBLIC_API_PREFIX}/health`, healthRouter);

app.use(`${PUBLIC_API_PREFIX}/auth`, authRouter);
app.use(`${PUBLIC_API_PREFIX}/admin`, adminRouter);
app.use(`${PUBLIC_API_PREFIX}/ai`, aiInternalRouter);
app.use(`${PUBLIC_API_PREFIX}/integrations/callrail`, callrailWebhookRouter);
app.use(`${PUBLIC_API_PREFIX}/feedback`, feedbackRouter);

app.use(
  `${PUBLIC_API_PREFIX}/call-center`,
  authenticate,
  requireRoles(Role.CALL_CENTER_AGENT, Role.SALON_OWNER),
  callCenterRouter
);

app.use(authenticate, requireRoles(Role.SALON_OWNER, Role.STAFF), requireSalonAccess);
app.use(`${PUBLIC_API_PREFIX}/owner`, ownerRouter);
app.use(`${PUBLIC_API_PREFIX}/salon`, salonRouter);
app.use(`${PUBLIC_API_PREFIX}/staff`, staffRouter);
app.use(`${PUBLIC_API_PREFIX}/alerts`, alertsRouter);
app.use(`${PUBLIC_API_PREFIX}/messages`, messagesRouter);
app.use(`${PUBLIC_API_PREFIX}/billing`, billingRouter);
app.use(`${PUBLIC_API_PREFIX}/services`, servicesRouter);
app.use(`${PUBLIC_API_PREFIX}/business-hours`, businessHoursRouter);
app.use(`${PUBLIC_API_PREFIX}/customers`, customersRouter);
app.use(`${PUBLIC_API_PREFIX}/appointments`, appointmentsRouter);
app.use(`${PUBLIC_API_PREFIX}/availability`, availabilityRouter);
app.use(`${PUBLIC_API_PREFIX}/calls`, callsRouter);
app.use(`${PUBLIC_API_PREFIX}/ai`, aiRouter);

app.use(notFoundHandler);
app.use(errorHandler);
