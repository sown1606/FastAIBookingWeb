import type { AuthSession } from "../types";

const STORAGE_KEY = "fastaibooking_app_session";

let memorySession: AuthSession | null = null;

const parseStored = (value: string | null): AuthSession | null => {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as AuthSession;
  } catch {
    return null;
  }
};

export const getSession = (): AuthSession | null => {
  if (memorySession) {
    return memorySession;
  }
  memorySession = parseStored(localStorage.getItem(STORAGE_KEY));
  return memorySession;
};

export const setSession = (session: AuthSession): void => {
  memorySession = session;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
};

export const clearSession = (): void => {
  memorySession = null;
  localStorage.removeItem(STORAGE_KEY);
};
