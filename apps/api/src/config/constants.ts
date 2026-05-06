import { AppointmentStatus, Role, StaffStatus } from "@prisma/client";
import { env } from "./env";

export const PUBLIC_API_PREFIX = env.API_PREFIX;

export const OWNER_ROLES: Role[] = [Role.SALON_OWNER];
export const ADMIN_ROLES: Role[] = [Role.PLATFORM_ADMIN];

export const ACTIVE_STAFF_STATUS = StaffStatus.ACTIVE;

export const NON_BLOCKING_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.CANCELED
];
