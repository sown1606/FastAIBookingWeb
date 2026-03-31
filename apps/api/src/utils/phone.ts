import { AppError } from "../lib/errors";

const NANP_REGEX = /^1?([2-9]\d{2})([2-9]\d{2})(\d{4})$/;

export const normalizeUsPhone = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const digits = value.replace(/\D/g, "");
  const match = digits.match(NANP_REGEX);
  if (!match) {
    return null;
  }

  return `+1${match[1]}${match[2]}${match[3]}`;
};

export const requireUsPhone = (value: string | null | undefined, fieldName = "phone"): string => {
  const normalized = normalizeUsPhone(value);
  if (!normalized) {
    throw new AppError(`${fieldName} must be a valid US phone number.`, 400, "INVALID_US_PHONE");
  }
  return normalized;
};

export const formatUsPhone = (value: string | null | undefined): string => {
  const normalized = normalizeUsPhone(value);
  if (!normalized) {
    return value ?? "";
  }

  return `(${normalized.slice(2, 5)}) ${normalized.slice(5, 8)}-${normalized.slice(8)}`;
};

export const isValidUsPhone = (value: string | null | undefined): boolean => {
  return normalizeUsPhone(value) !== null;
};
