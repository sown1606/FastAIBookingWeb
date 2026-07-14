export type AppointmentStatus =
  | "SCHEDULED"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELED"
  | "NO_SHOW";

export const OPERATIONAL_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  "SCHEDULED",
  "CONFIRMED",
  "IN_PROGRESS"
];

export const HISTORY_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  "COMPLETED",
  "CANCELED",
  "NO_SHOW"
];

export const CANCELED_OR_NO_SHOW_STATUSES: AppointmentStatus[] = [
  "CANCELED",
  "NO_SHOW"
];

const operationalStatusSet = new Set<string>(OPERATIONAL_APPOINTMENT_STATUSES);
const historyStatusSet = new Set<string>(HISTORY_APPOINTMENT_STATUSES);
const canceledOrNoShowStatusSet = new Set<string>(CANCELED_OR_NO_SHOW_STATUSES);

export const isOperationalAppointmentStatus = (status: string | null | undefined): boolean =>
  Boolean(status && operationalStatusSet.has(status));

export const filterOperationalAppointments = <T extends { status: string | null | undefined }>(
  items: T[]
): T[] => items.filter((item) => isOperationalAppointmentStatus(item.status));

export const isHistoryAppointmentStatus = (status: string | null | undefined): boolean =>
  Boolean(status && historyStatusSet.has(status));

export const isCanceledOrNoShowStatus = (status: string | null | undefined): boolean =>
  Boolean(status && canceledOrNoShowStatusSet.has(status));
