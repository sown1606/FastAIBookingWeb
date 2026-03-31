import { Response } from "express";

interface SuccessOptions<T> {
  data: T;
  message?: string;
  statusCode?: number;
}

export const sendSuccess = <T>(res: Response, options: SuccessOptions<T>): Response => {
  const statusCode = options.statusCode ?? 200;
  return res.status(statusCode).json({
    success: true,
    message: options.message ?? "Success",
    data: options.data
  });
};
