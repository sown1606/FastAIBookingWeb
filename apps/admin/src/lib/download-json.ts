const SENSITIVE_KEY_PARTS = [
  "authorization",
  "cookie",
  "setcookie",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "secret",
  "password",
  "sessiontoken",
  "privatekey",
  "clientsecret"
];

const normalizeKey = (key: string) => key.replace(/[^a-z0-9]/gi, "").toLowerCase();

const isSensitiveKey = (key: string) => {
  const normalized = normalizeKey(key);
  return SENSITIVE_KEY_PARTS.some((part) => normalized.includes(part));
};

export const sanitizeJsonExport = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJsonExport(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
      key,
      isSensitiveKey(key) ? "[REDACTED]" : sanitizeJsonExport(nestedValue)
    ])
  );
};

export const stringifyJsonExport = (payload: unknown) =>
  JSON.stringify(sanitizeJsonExport(payload), null, 2);

export const toUtcTimestampForFilename = (date = new Date()) =>
  date.toISOString().replace(/[:.]/g, "-");

export const safeFilenamePart = (value: string | null | undefined, fallback: string) => {
  const sanitized = (value || fallback).replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-");
  return sanitized.replace(/^-|-$/g, "") || fallback;
};

export const downloadJsonFile = (filename: string, payload: unknown) => {
  const json = stringifyJsonExport(payload);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};
