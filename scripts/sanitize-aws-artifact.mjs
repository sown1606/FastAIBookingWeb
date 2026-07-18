#!/usr/bin/env node
import fs from "node:fs";

const DROP_KEY_NAMES = new Set([
  "Environment",
  "Code",
  "Location",
  "Password",
  "SecretAccessKey",
  "SessionToken",
  "Token",
  "Authorization",
  "X-Amz-Signature",
  "X-Amz-Credential",
  "X-Amz-Security-Token"
]);

const SENSITIVE_KEY_RE =
  /(?:authorization|bearer|token|secret|password|credential|access[_-]?key|session[_-]?token|api[_-]?key)/i;

function sanitizeString(value) {
  let out = value;
  out = out.replace(/AKIA[0-9A-Z]{16}/g, "[REDACTED_AWS_ACCESS_KEY_ID]");
  out = out.replace(/ASIA[0-9A-Z]{16}/g, "[REDACTED_AWS_TEMP_ACCESS_KEY_ID]");
  out = out.replace(/(Authorization\s*[:=]\s*)Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED_BEARER]");
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]");
  out = out.replace(/([?&](?:X-Amz|AWSAccessKeyId|Signature|Expires|Security-Token)[^=]*=)[^&\s"']+/gi, "$1[REDACTED]");
  out = out.replace(/\b(?:\+?1)?([ -.]?\d){10}\b/g, (match) => {
    const digits = match.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 11) {
      return match;
    }
    return `[REDACTED_PHONE_****${digits.slice(-4)}]`;
  });
  return out;
}

function sanitize(value, key = "") {
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }
  if (value && typeof value === "object") {
    const result = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      if (DROP_KEY_NAMES.has(childKey)) {
        result[childKey] = "[REDACTED]";
        continue;
      }
      if (SENSITIVE_KEY_RE.test(childKey)) {
        result[childKey] = "[REDACTED]";
        continue;
      }
      result[childKey] = sanitize(childValue, childKey);
    }
    return result;
  }
  if (typeof value === "string") {
    if (SENSITIVE_KEY_RE.test(key) && value.trim()) {
      return "[REDACTED]";
    }
    return sanitizeString(value);
  }
  return value;
}

function readInput() {
  const inputPath = process.argv[2];
  if (inputPath && inputPath !== "-") {
    return fs.readFileSync(inputPath, "utf8");
  }
  return fs.readFileSync(0, "utf8");
}

const raw = readInput();
try {
  const parsed = JSON.parse(raw);
  process.stdout.write(`${JSON.stringify(sanitize(parsed), null, 2)}\n`);
} catch {
  process.stdout.write(sanitizeString(raw));
}
