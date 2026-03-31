import { randomUUID } from "crypto";
import { NextFunction, Request, Response } from "express";

export const requestContext = (req: Request, res: Response, next: NextFunction): void => {
  const incomingId = req.headers["x-request-id"];
  const requestId = typeof incomingId === "string" && incomingId.trim() ? incomingId : randomUUID();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
};
