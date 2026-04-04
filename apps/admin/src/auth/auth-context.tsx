import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, extractErrorMessage, registerSessionInvalidationHandler } from "../lib/api";
import { clearSession, getSession, setSession } from "../lib/auth-storage";
import type { AuthSession, AuthUser } from "../types";

interface AuthContextValue {
  session: AuthSession | null;
  isInitializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

interface MeResponse {
  id: string;
  email: string;
  fullName: string;
  role: "PLATFORM_ADMIN" | "SALON_OWNER" | "STAFF" | "CALL_CENTER_AGENT";
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

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [session, setSessionState] = useState<AuthSession | null>(getSession());
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    registerSessionInvalidationHandler(() => {
      clearSession();
      setSessionState(null);
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
        if (me.role !== "PLATFORM_ADMIN") {
          throw new Error("This account is not a platform admin.");
        }
        const nextSession: AuthSession = {
          ...stored,
          user: normalizeUser(me)
        };
        setSession(nextSession);
        setSessionState(nextSession);
      } catch {
        clearSession();
        setSessionState(null);
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
      login: async (email, password) => {
        const auth = await apiPost<AuthSession, { email: string; password: string }>(
          "/api/v1/admin/auth/login",
          {
            email,
            password
          }
        );
        if (auth.user.role !== "PLATFORM_ADMIN") {
          throw new Error("This account is not a platform admin.");
        }
        setSession(auth);
        setSessionState(auth);
      },
      logout: async () => {
        const current = getSession();
        try {
          if (current?.refreshToken) {
            await apiPost<null, { refreshToken: string }>("/api/v1/auth/logout", {
              refreshToken: current.refreshToken
            });
          }
        } catch (error) {
          const message = extractErrorMessage(error);
          if (!message.toLowerCase().includes("unauthorized")) {
            console.error(message);
          }
        } finally {
          clearSession();
          setSessionState(null);
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
