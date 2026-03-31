import { Role } from "@prisma/client";

export interface AuthTokenPayload {
  sub: string;
  email: string;
  role: Role;
  salonId: string | null;
  staffId: string | null;
  type: "access" | "refresh";
  jti?: string;
}

export interface AuthContext {
  userId: string;
  email: string;
  role: Role;
  salonId: string | null;
  staffId: string | null;
}
