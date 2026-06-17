import { ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";
import { localizeApiErrorMessage } from "../utils/api-error-messages";
import { resolveRequestLanguage } from "../utils/language";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let statusCode = 500;
  let code = "INTERNAL_SERVER_ERROR";
  let message = "Unexpected server error.";
  let details: unknown;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof Prisma.PrismaClientInitializationError) {
    statusCode = 503;
    code = "DATABASE_UNAVAILABLE";
    message = "Database is unavailable.";
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    statusCode = 400;
    code = err.code;
    message = err.message;
  } else if (err instanceof SyntaxError) {
    statusCode = 400;
    code = "INVALID_JSON";
    message = "Invalid JSON payload.";
  }

  logger.error(
    {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode,
      error: err
    },
    "Request failed"
  );

  const language = resolveRequestLanguage(req);
  const localizedMessage = localizeApiErrorMessage(message, code, language);

  res.status(statusCode).json({
    success: false,
    error: {
      code,
      message: localizedMessage,
      details
    }
  });
};
