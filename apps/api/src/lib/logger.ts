import pino from "pino";
import { env } from "../config/env";

export const logger = pino({
  name: env.APP_NAME,
  level: env.LOG_LEVEL
});
