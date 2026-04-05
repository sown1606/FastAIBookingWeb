export type Role = "PLATFORM_ADMIN" | "SALON_OWNER" | "STAFF" | "CALL_CENTER_AGENT";

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  salonId: string | null;
  staffId: string | null;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

export interface ApiEnvelope<T> {
  success: boolean;
  message: string;
  data: T;
}

export interface ApiErrorEnvelope {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
}
