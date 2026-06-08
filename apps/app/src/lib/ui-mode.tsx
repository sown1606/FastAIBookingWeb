import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type UiMode = "basic" | "advanced";

const STORAGE_KEY = "fastaibooking.uiMode";

interface UiModeContextValue {
  mode: UiMode;
  setMode: (mode: UiMode) => void;
  isBasicMode: boolean;
}

const UiModeContext = createContext<UiModeContextValue | null>(null);

const resolveInitialMode = (): UiMode => {
  if (typeof window === "undefined") {
    return "basic";
  }
  return window.localStorage.getItem(STORAGE_KEY) === "advanced" ? "advanced" : "basic";
};

export const UiModeProvider = ({ children }: { children: ReactNode }) => {
  const [mode, setMode] = useState<UiMode>(resolveInitialMode);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, mode);
  }, [mode]);

  const value = useMemo<UiModeContextValue>(
    () => ({
      mode,
      setMode,
      isBasicMode: mode === "basic"
    }),
    [mode]
  );

  return <UiModeContext.Provider value={value}>{children}</UiModeContext.Provider>;
};

export const useUiMode = () => {
  const value = useContext(UiModeContext);
  if (!value) {
    throw new Error("useUiMode must be used within UiModeProvider");
  }
  return value;
};
