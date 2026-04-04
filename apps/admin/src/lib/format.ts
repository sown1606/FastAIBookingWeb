export const formatDateTime = (value: string | Date | null | undefined): string => {
  if (!value) {
    return "-";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
};

export const formatCurrencyCents = (cents: number | null | undefined): string => {
  const amount = (cents ?? 0) / 100;
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "USD"
  }).format(amount);
};

export const formatPhone = (value: string | null | undefined): string => {
  return value && value.trim().length ? value : "-";
};
