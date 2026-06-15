import { Request } from "express";

export const DEFAULT_LANGUAGE = "vi-VN";
export type SupportedLanguage = "vi-VN" | "en-US";

const parseLanguageCandidate = (value: string): SupportedLanguage | null => {
  const language = value.trim().split(";")[0]?.toLowerCase();

  if (language === "vi" || language === "vi-vn") {
    return "vi-VN";
  }
  if (language === "en" || language === "en-us") {
    return "en-US";
  }

  return null;
};

export const normalizeLanguage = (value?: string | null): SupportedLanguage => {
  if (!value) {
    return DEFAULT_LANGUAGE;
  }

  for (const candidate of value.split(",")) {
    const language = parseLanguageCandidate(candidate);
    if (language) {
      return language;
    }
  }

  return DEFAULT_LANGUAGE;
};

export const resolveRequestLanguage = (req: Request): SupportedLanguage => {
  const header = req.header("accept-language");
  return normalizeLanguage(header);
};

export const resolveUserLanguage = (
  userLanguage: string | null | undefined,
  requestLanguage: SupportedLanguage
): SupportedLanguage => {
  if (userLanguage) {
    return normalizeLanguage(userLanguage);
  }

  return requestLanguage;
};
