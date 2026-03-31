import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { env } from "../config/env";
import { AppError } from "./errors";
import { AuthTokenPayload } from "../types/auth";

interface AccessTokenInput {
  userId: string;
  email: string;
  role: Role;
  salonId: string | null;
  staffId: string | null;
}

interface RefreshTokenInput extends AccessTokenInput {
  jti: string;
}

export const signAccessToken = (input: AccessTokenInput): string => {
  const expiresIn = env.JWT_EXPIRES_IN as jwt.SignOptions["expiresIn"];
  return jwt.sign(
    {
      sub: input.userId,
      email: input.email,
      role: input.role,
      salonId: input.salonId,
      staffId: input.staffId,
      type: "access"
    } satisfies AuthTokenPayload,
    env.JWT_SECRET,
    {
      expiresIn
    }
  );
};

export const signRefreshToken = (input: RefreshTokenInput): string => {
  const expiresIn = env.REFRESH_TOKEN_EXPIRES_IN as jwt.SignOptions["expiresIn"];
  return jwt.sign(
    {
      sub: input.userId,
      email: input.email,
      role: input.role,
      salonId: input.salonId,
      staffId: input.staffId,
      type: "refresh",
      jti: input.jti
    } satisfies AuthTokenPayload,
    env.REFRESH_TOKEN_SECRET,
    {
      expiresIn
    }
  );
};

export const verifyAccessToken = (token: string): AuthTokenPayload => {
  try {
    return jwt.verify(token, env.JWT_SECRET) as AuthTokenPayload;
  } catch {
    throw new AppError("Invalid access token.", 401, "UNAUTHORIZED");
  }
};

export const verifyRefreshToken = (token: string): AuthTokenPayload => {
  try {
    return jwt.verify(token, env.REFRESH_TOKEN_SECRET) as AuthTokenPayload;
  } catch {
    throw new AppError("Invalid refresh token.", 401, "UNAUTHORIZED");
  }
};
