import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { sendSms } from "../../lib/sms";
import { AppError } from "../../lib/errors";

const toJson = (value: unknown): Prisma.InputJsonValue => {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
};

export const resolveSalonNotificationPhone = async (salonId: string): Promise<string | null> => {
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: {
      notificationPhoneNumber: true,
      contactPhone: true,
      owner: {
        select: {
          phone: true
        }
      }
    }
  });

  if (!salon) {
    throw new AppError("Salon not found.", 404, "SALON_NOT_FOUND");
  }

  return salon.notificationPhoneNumber ?? salon.contactPhone ?? salon.owner.phone ?? null;
};

export const createSalonAlert = async (input: {
  salonId: string;
  alertType: string;
  title: string;
  message: string;
  priority?: "NORMAL" | "URGENT";
  metadata?: unknown;
  sendSms?: boolean;
}) => {
  const notificationPhone = await resolveSalonNotificationPhone(input.salonId);
  const alert = await prisma.alert.create({
    data: {
      salonId: input.salonId,
      alertType: input.alertType,
      title: input.title,
      message: input.message,
      priority: input.priority ?? "NORMAL",
      notificationPhone,
      metadata: input.metadata === undefined ? undefined : toJson(input.metadata)
    }
  });

  if (input.sendSms ?? true) {
    await sendSms({
      to: notificationPhone,
      body: input.message,
      reason: input.alertType
    });
  }

  return alert;
};

export const listSalonAlerts = async (input: {
  salonId: string;
  page: number;
  limit: number;
  unreadOnly?: boolean;
}) => {
  const skip = (input.page - 1) * input.limit;
  const where = {
    salonId: input.salonId,
    ...(input.unreadOnly ? { readAt: null } : {})
  };

  const [items, total] = await Promise.all([
    prisma.alert.findMany({
      where,
      skip,
      take: input.limit,
      orderBy: {
        createdAt: "desc"
      }
    }),
    prisma.alert.count({ where })
  ]);

  return {
    items,
    pagination: {
      page: input.page,
      limit: input.limit,
      total
    }
  };
};

export const markAlertRead = async (salonId: string, alertId: string) => {
  const alert = await prisma.alert.findFirst({
    where: {
      id: alertId,
      salonId
    }
  });
  if (!alert) {
    throw new AppError("Alert not found.", 404, "ALERT_NOT_FOUND");
  }

  return prisma.alert.update({
    where: {
      id: alert.id
    },
    data: {
      readAt: alert.readAt ?? new Date()
    }
  });
};
