import { AppError } from "../lib/errors";

export const NANP_REGEX = /^1?([2-9]\d{2})([2-9]\d{2})(\d{4})$/;
const E164_CUSTOMER_PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

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

export const normalizeCustomerPhone = (value: string | null | undefined): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalizedUsPhone = normalizeUsPhone(trimmed);
  if (normalizedUsPhone) {
    return normalizedUsPhone;
  }

  if (!trimmed.startsWith("+")) {
    return null;
  }

  const canonical = `+${trimmed.replace(/\D/g, "")}`;
  return E164_CUSTOMER_PHONE_REGEX.test(canonical) ? canonical : null;
};

export const requireCustomerPhone = (value: string | null | undefined, fieldName = "phone"): string => {
  const normalized = normalizeCustomerPhone(value);
  if (!normalized) {
    throw new AppError(`${fieldName} must be a valid phone number.`, 400, "INVALID_CUSTOMER_PHONE");
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

export const isValidCustomerPhone = (value: string | null | undefined): boolean => {
  return normalizeCustomerPhone(value) !== null;
};
