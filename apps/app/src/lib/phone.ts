const NANP_REGEX = /^1?([2-9]\d{2})([2-9]\d{2})(\d{4})$/;
const E164_CUSTOMER_PHONE_REGEX = /^\+[1-9]\d{6,14}$/;

export const digitsOnly = (value: string) => value.replace(/\D/g, "");

export const normalizeUsPhone = (value: string): string | null => {
  const match = digitsOnly(value).match(NANP_REGEX);
  if (!match) {
    return null;
  }
  return `+1${match[1]}${match[2]}${match[3]}`;
};

export const isValidUsPhone = (value: string): boolean => normalizeUsPhone(value) !== null;

export const formatUsPhoneInput = (value: string): string => {
  const digits = digitsOnly(value).replace(/^1(?=\d{10}$)/, "").slice(0, 10);
  if (digits.length <= 3) {
    return digits;
  }
  if (digits.length <= 6) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  }
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

export const validateOptionalUsPhone = (value: string): boolean => {
  return value.trim().length === 0 || isValidUsPhone(value);
};

export const normalizeCustomerPhone = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const usPhone = normalizeUsPhone(trimmed);
  if (usPhone) {
    return usPhone;
  }
  if (!trimmed.startsWith("+")) {
    return null;
  }
  const canonical = `+${trimmed.replace(/\D/g, "")}`;
  return E164_CUSTOMER_PHONE_REGEX.test(canonical) ? canonical : null;
};

export const validateOptionalCustomerPhone = (value: string): boolean => {
  return value.trim().length === 0 || normalizeCustomerPhone(value) !== null;
};

export const formatCustomerPhoneInput = (value: string): string => {
  return value.trimStart().startsWith("+") ? value : formatUsPhoneInput(value);
};

export const requiredLabel = (label: string) => `${label} *`;
