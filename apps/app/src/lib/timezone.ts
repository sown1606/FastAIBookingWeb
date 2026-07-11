const dateTimeLocalPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

const getTimeZoneParts = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone: timezone
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second")
  };
};

const getTimeZoneOffsetMs = (date: Date, timezone: string): number => {
  const parts = getTimeZoneParts(date, timezone);
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return localAsUtc - date.getTime();
};

export const dateTimeLocalToUtcIso = (value: string, timezone: string): string | null => {
  const match = dateTimeLocalPattern.exec(value);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute] = match;
  const localAsUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    0
  );
  let utcTime = localAsUtc - getTimeZoneOffsetMs(new Date(localAsUtc), timezone);
  utcTime = localAsUtc - getTimeZoneOffsetMs(new Date(utcTime), timezone);

  const utcDate = new Date(utcTime);
  return Number.isNaN(utcDate.getTime()) ? null : utcDate.toISOString();
};

export const getSalonDateKey = (
  value: string | Date,
  timezone = "America/New_York"
): string => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  const parts = getTimeZoneParts(date, timezone);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
};

export const shiftSalonDateKey = (dateKey: string, days: number): string => {
  const [year = 1970, month = 1, day = 1] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return date.toISOString().slice(0, 10);
};

export const utcToDateTimeLocalInTimeZone = (
  value: string | Date | null | undefined,
  timezone: string
): string => {
  if (!value) {
    return "";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const parts = getTimeZoneParts(date, timezone);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
};
