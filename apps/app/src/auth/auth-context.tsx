import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, registerSessionInvalidationHandler } from "../lib/api";
import { clearSession, getSession, setSession } from "../lib/auth-storage";
import { unregisterFirebaseMessagingToken } from "../lib/firebase-messaging";
import type { AuthSession, AuthUser } from "../types";

interface OwnerRegistrationPayload {
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  salon: {
    name: string;
    contactEmail?: string;
    contactPhone?: string;
    timezone: string;
    addressLine1?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
}

interface AuthContextValue {
  session: AuthSession | null;
  isInitializing: boolean;
  login: (
    email: string,
    password: string,
    mode: "owner" | "staff" | "call-center" | "auto"
  ) => Promise<void>;
  registerOwner: (payload: OwnerRegistrationPayload) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  logout: () => Promise<void>;
}

interface MeResponse {
  id: string;
  email: string;
  fullName: string;
  role: "PLATFORM_ADMIN" | "SALON_OWNER" | "STAFF" | "CALL_CENTER_AGENT" | "OPERATOR";
  salonId: string | null;
  staffId: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const normalizeUser = (input: MeResponse): AuthUser => ({
  id: input.id,
  email: input.email,
  fullName: input.fullName,
  role: input.role,
  salonId: input.salonId,
  staffId: input.staffId
});

const assertRoleSupported = (role: AuthUser["role"]) => {
  if (
    role === "SALON_OWNER" ||
    role === "STAFF" ||
    role === "CALL_CENTER_AGENT" ||
    role === "OPERATOR"
  ) {
    return;
  }
  throw new Error("This account cannot access the salon app.");
};

const warnLogoutCleanupFailure = (error: unknown): void => {
  if (import.meta.env.DEV) {
    console.warn("Push token cleanup failed during logout.", error);
  }
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSessionState] = useState<AuthSession | null>(getSession());
  const [isInitializing, setIsInitializing] = useState(true);

  const clearLocalSession = () => {
    clearSession();
    setSessionState(null);
  };

  const cleanupPushToken = async (allowAuthRefresh = true): Promise<void> => {
    try {
      await unregisterFirebaseMessagingToken({ allowAuthRefresh });
    } catch (error) {
      warnLogoutCleanupFailure(error);
    }
  };

  useEffect(() => {
    registerSessionInvalidationHandler(() => {
      void cleanupPushToken(false).finally(clearLocalSession);
    });
    return () => {
      registerSessionInvalidationHandler(null);
    };
  }, []);

  useEffect(() => {
    const bootstrap = async () => {
      const stored = getSession();
      if (!stored) {
        setIsInitializing(false);
        return;
      }

      try {
        const me = await apiGet<MeResponse>("/api/v1/auth/me");
        assertRoleSupported(me.role);
        const nextSession: AuthSession = {
          ...stored,
          user: normalizeUser(me)
        };
        setSession(nextSession);
        setSessionState(nextSession);
      } catch {
        await cleanupPushToken(false);
        clearLocalSession();
      } finally {
        setIsInitializing(false);
      }
    };

    void bootstrap();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isInitializing,
      login: async (email, password, mode) => {
        const endpoint =
          mode === "owner"
            ? "/api/v1/auth/login-owner"
            : mode === "staff"
              ? "/api/v1/auth/login-staff"
              : mode === "call-center"
                ? "/api/v1/auth/login-call-center"
              : "/api/v1/auth/login";

        const auth = await apiPost<AuthSession, { email: string; password: string }>(endpoint, {
          email,
          password
        });

        assertRoleSupported(auth.user.role);
        setSession(auth);
        setSessionState(auth);
      },
      registerOwner: async (payload) => {
        const auth = await apiPost<AuthSession, OwnerRegistrationPayload>(
          "/api/v1/auth/register-owner",
          payload
        );
        assertRoleSupported(auth.user.role);
        setSession(auth);
        setSessionState(auth);
      },
      forgotPassword: async (email) => {
        await apiPost<null, { email: string }>("/api/v1/auth/forgot-password", {
          email
        });
      },
      resetPassword: async (token, newPassword) => {
        await apiPost<null, { token: string; newPassword: string }>("/api/v1/auth/reset-password", {
          token,
          newPassword
        });
      },
      logout: async () => {
        try {
          await cleanupPushToken();
          const current = getSession();
          if (current?.refreshToken) {
            await apiPost<null, { refreshToken: string }>("/api/v1/auth/logout", {
              refreshToken: current.refreshToken
            });
          }
        } finally {
          clearLocalSession();
        }
      }
    }),
    [isInitializing, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("Auth context is not available.");
  }
  return value;
};
