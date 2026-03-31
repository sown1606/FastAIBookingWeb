import { NextFunction, Request, Response } from "express";
import { Role, StaffStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { AppError } from "../lib/errors";
import { verifyAccessToken } from "../lib/jwt";

const extractBearerToken = (authorizationHeader?: string): string => {
  if (!authorizationHeader) {
    throw new AppError("Missing authorization header.", 401, "UNAUTHORIZED");
  }
  const [scheme, token] = authorizationHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    throw new AppError("Invalid authorization format.", 401, "UNAUTHORIZED");
  }
  return token;
};

export const authenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const payload = verifyAccessToken(token);

    if (payload.type !== "access") {
      throw new AppError("Invalid access token.", 401, "UNAUTHORIZED");
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        salonId: true,
        isActive: true,
        staffId: true,
        staffProfile: {
          select: {
            salonId: true,
            status: true
          }
        }
      }
    });

    if (!user || !user.isActive) {
      throw new AppError("Unauthorized user.", 401, "UNAUTHORIZED");
    }

    if (user.role === Role.STAFF) {
      if (!user.staffId || !user.staffProfile) {
        throw new AppError("Staff access is not configured.", 403, "FORBIDDEN");
      }
      if (user.staffProfile.status !== StaffStatus.ACTIVE) {
        throw new AppError("Staff account is inactive.", 403, "FORBIDDEN");
      }
      if (user.salonId !== user.staffProfile.salonId) {
        throw new AppError("Invalid staff salon access.", 403, "FORBIDDEN");
      }
    }

    req.auth = {
      userId: user.id,
      email: user.email,
      role: user.role,
      salonId: user.salonId,
      staffId: user.staffId
    };

    next();
  } catch (error) {
    next(error);
  }
};

export const requireRoles =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new AppError("Unauthorized.", 401, "UNAUTHORIZED"));
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(new AppError("Forbidden.", 403, "FORBIDDEN"));
      return;
    }
    next();
  };

export const requireSalonAccess = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.auth?.salonId) {
    next(new AppError("Salon context is required.", 403, "FORBIDDEN"));
    return;
  }
  next();
};
