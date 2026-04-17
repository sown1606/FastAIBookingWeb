const resolveFormatterLocale = () => {
  if (typeof window === "undefined") {
    return "vi-VN";
  }
  return window.localStorage.getItem("fastaibooking.locale") === "en" ? "en-US" : "vi-VN";
};

export const formatDateTime = (value: string | Date | null | undefined): string => {
  if (!value) {
    return "-";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat(resolveFormatterLocale(), {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
};

export const formatCurrencyCents = (cents: number | null | undefined): string => {
  return new Intl.NumberFormat(resolveFormatterLocale(), {
    style: "currency",
    currency: "USD"
  }).format((cents ?? 0) / 100);
};
