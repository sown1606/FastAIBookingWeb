import { createContext, useContext } from "react";
import type { ReactNode } from "react";

export type UiMode = "basic" | "advanced";

interface UiModeContextValue {
  mode: UiMode;
  setMode: (mode: UiMode) => void;
  isBasicMode: boolean;
}

const UiModeContext = createContext<UiModeContextValue | null>(null);

const basicModeValue: UiModeContextValue = {
  mode: "basic",
  setMode: () => undefined,
  isBasicMode: true
};

export const UiModeProvider = ({ children }: { children: ReactNode }) => {
  return <UiModeContext.Provider value={basicModeValue}>{children}</UiModeContext.Provider>;
};

export const useUiMode = () => {
  const value = useContext(UiModeContext);
  if (!value) {
    throw new Error("useUiMode must be used within UiModeProvider");
  }
  return value;
};
