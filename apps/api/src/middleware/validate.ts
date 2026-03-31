import { NextFunction, Request, Response } from "express";
import { ZodTypeAny } from "zod";
import { AppError } from "../lib/errors";

type RequestSource = "body" | "query" | "params";

export const validate =
  (schema: ZodTypeAny, source: RequestSource = "body") =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      next(
        new AppError("Validation failed.", 400, "VALIDATION_ERROR", {
          issues: result.error.issues
        })
      );
      return;
    }

    req[source] = result.data;
    next();
  };
