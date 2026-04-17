const NANP_REGEX = /^1?([2-9]\d{2})([2-9]\d{2})(\d{4})$/;

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
