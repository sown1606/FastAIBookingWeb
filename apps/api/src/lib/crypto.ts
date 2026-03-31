import { createHash, randomBytes } from "crypto";

export const hashToken = (token: string): string => {
  return createHash("sha256").update(token).digest("hex");
};

export const generateSecureToken = (size = 48): string => {
  return randomBytes(size).toString("hex");
};
