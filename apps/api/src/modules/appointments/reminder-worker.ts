import { AppointmentStatus } from "@prisma/client";
import { DateTime } from "luxon";
import { prisma } from "../../db/prisma";
import { logger } from "../../lib/logger";
import { formatCustomerName } from "../../utils/customer-name";
import {
  sendPushToAssignedStaff,
  sendPushToSalonOwner
} from "../notifications/notifications.service";

const REMINDER_POLL_INTERVAL_MS = 30_000;
let reminderTimer: NodeJS.Timeout | null = null;
let reminderRunActive = false;

const formatAppointmentTime = (date: Date, timezone: string): string => {
  const value = DateTime.fromJSDate(date, { zone: "utc" }).setZone(timezone);
  return value.isValid ? value.toFormat("ccc, LLL d 'at' h:mm a") : date.toISOString();
};

export const processDueAppointmentReminders = async (now = new Date()): Promise<number> => {
  if (reminderRunActive) {
    return 0;
  }
  reminderRunActive = true;
  try {
    const reminders = await prisma.staffReminder.findMany({
      where: {
        reminderType: "BEFORE_BOOKING",
        deliveredAt: null,
        remindAt: { lte: now },
        appointment: {
          startTime: { gt: now },
          status: {
            in: [AppointmentStatus.SCHEDULED, AppointmentStatus.CONFIRMED]
          }
        }
      },
      orderBy: { remindAt: "asc" },
      take: 50,
      include: {
        staff: { select: { fullName: true } },
        appointment: {
          include: {
            customer: true,
            service: true,
            salon: {
              select: {
                name: true,
                timezone: true,
                settings: {
                  select: { ownerUpcomingReminderEnabled: true }
                }
              }
            }
          }
        }
      }
    });

    let deliveredCount = 0;
    for (const reminder of reminders) {
      try {
        const appointment = reminder.appointment;
        const customerName = formatCustomerName(
          appointment.customer.firstName,
          appointment.customer.lastName
        );
        const appointmentTime = formatAppointmentTime(
          appointment.startTime,
          appointment.salon.timezone
        );
        const payload = {
          title: "Upcoming appointment",
          body: `${customerName || "Customer"} is scheduled for ${appointment.service.name} at ${appointmentTime}.`,
          type: "appointment_upcoming_reminder",
          salonId: reminder.salonId,
          url: `/appointments?appointmentId=${encodeURIComponent(appointment.id)}`,
          data: {
            appointmentId: appointment.id,
            salonId: reminder.salonId,
            staffId: reminder.staffId
          }
        };

        await sendPushToAssignedStaff(reminder.staffId, payload);
        if (appointment.salon.settings?.ownerUpcomingReminderEnabled ?? true) {
          await sendPushToSalonOwner(reminder.salonId, payload);
        }
        const marked = await prisma.staffReminder.updateMany({
          where: {
            id: reminder.id,
            deliveredAt: null
          },
          data: { deliveredAt: new Date() }
        });
        deliveredCount += marked.count;
      } catch (error) {
        logger.warn(
          {
            reminderId: reminder.id,
            appointmentId: reminder.appointmentId,
            error: error instanceof Error ? error.message : String(error)
          },
          "Appointment reminder delivery failed and will be retried."
        );
      }
    }
    return deliveredCount;
  } finally {
    reminderRunActive = false;
  }
};

export const startAppointmentReminderWorker = (): void => {
  if (reminderTimer) {
    return;
  }
  void processDueAppointmentReminders();
  reminderTimer = setInterval(() => {
    void processDueAppointmentReminders();
  }, REMINDER_POLL_INTERVAL_MS);
  reminderTimer.unref();
};

export const stopAppointmentReminderWorker = (): void => {
  if (!reminderTimer) {
    return;
  }
  clearInterval(reminderTimer);
  reminderTimer = null;
};
