import { AppointmentStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";
import { AppError } from "../../lib/errors";
import { requireCustomerPhone } from "../../utils/phone";
import {
  cancelAppointmentInTransaction,
  sendCanceledAppointmentNotifications,
  toOwnerAppointmentResponse
} from "../appointments/appointments.service";

interface CreateCustomerInput {
  firstName: string;
  lastName?: string;
  email?: string;
  phone: string;
  notes?: string;
}

interface SearchCustomersInput {
  q?: string;
  page: number;
  limit: number;
}

interface UpdateCustomerInput {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string;
  notes?: string | null;
}

const ACTIVE_APPOINTMENT_STATUSES = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS
];
const CUSTOMER_PRIVACY_DELETE_REASON = "Customer data deleted by salon owner";

const normalizeNamePart = (value: string | null | undefined) => value?.trim() ?? "";

export const createCustomer = async (
  salonId: string,
  actorUserId: string,
  input: CreateCustomerInput
) => {
  const phone = requireCustomerPhone(input.phone, "Customer phone");
  const customer = await prisma.customer.create({
    data: {
      salonId,
      firstName: normalizeNamePart(input.firstName),
      lastName: normalizeNamePart(input.lastName),
      email: input.email?.toLowerCase(),
      phone,
      notes: input.notes
    }
  });

  await createAuditLog({
    salonId,
    actorUserId,
    action: "CUSTOMER_CREATED",
    entityType: "Customer",
    entityId: customer.id
  });

  return customer;
};

export const updateCustomer = async (
  salonId: string,
  customerId: string,
  actorUserId: string,
  input: UpdateCustomerInput
) => {
  const existing = await prisma.customer.findFirst({
    where: {
      id: customerId,
      salonId,
      deletedAt: null
    }
  });
  if (!existing) {
    throw new AppError("Customer not found.", 404, "CUSTOMER_NOT_FOUND");
  }

  const nextPhone =
    input.phone === undefined ? existing.phone : requireCustomerPhone(input.phone, "Customer phone");
  if (nextPhone !== existing.phone) {
    const duplicate = await prisma.customer.findFirst({
      where: {
        salonId,
        deletedAt: null,
        phone: nextPhone,
        id: {
          not: existing.id
        }
      },
      select: {
        id: true
      }
    });
    if (duplicate) {
      throw new AppError("A customer with this phone already exists.", 409, "CUSTOMER_PHONE_CONFLICT");
    }
  }

  const customer = await prisma.customer.update({
    where: {
      id: existing.id
    },
    data: {
      firstName: input.firstName === undefined ? existing.firstName : normalizeNamePart(input.firstName),
      lastName: input.lastName === undefined ? existing.lastName : normalizeNamePart(input.lastName),
      email:
        input.email === undefined
          ? existing.email
          : input.email
            ? input.email.toLowerCase()
            : null,
      phone: nextPhone,
      notes: input.notes === undefined ? existing.notes : input.notes
    }
  });

  await createAuditLog({
    salonId,
    actorUserId,
    action: "CUSTOMER_UPDATED",
    entityType: "Customer",
    entityId: customer.id,
    metadata: {
      changedFields: Object.keys(input)
    }
  });

  return customer;
};

export const searchCustomers = async (salonId: string, input: SearchCustomersInput) => {
  const skip = (input.page - 1) * input.limit;
  const searchTerm = input.q?.trim();

  const where = {
    salonId,
    deletedAt: null,
    ...(searchTerm
      ? {
          OR: [
            { firstName: { contains: searchTerm, mode: "insensitive" as const } },
            { lastName: { contains: searchTerm, mode: "insensitive" as const } },
            { email: { contains: searchTerm, mode: "insensitive" as const } },
            { phone: { contains: searchTerm, mode: "insensitive" as const } }
          ]
        }
      : {})
  };

  const [items, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      skip,
      take: input.limit,
      orderBy: { createdAt: "desc" }
    }),
    prisma.customer.count({ where })
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

export const getCustomerDetail = async (salonId: string, customerId: string) => {
  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      salonId,
      deletedAt: null
    }
  });
  if (!customer) {
    throw new AppError("Customer not found.", 404, "CUSTOMER_NOT_FOUND");
  }
  return customer;
};

export const deleteCustomer = async (salonId: string, customerId: string, actorUserId: string) => {
  const existing = await prisma.customer.findFirst({
    where: {
      id: customerId,
      salonId,
      deletedAt: null
    },
    select: {
      id: true,
      salonId: true
    }
  });

  if (!existing) {
    throw new AppError("Customer not found.", 404, "CUSTOMER_NOT_FOUND");
  }

  const [appointmentCount, activeAppointments] = await Promise.all([
    prisma.appointment.count({
      where: {
        salonId,
        customerId
      }
    }),
    prisma.appointment.findMany({
      where: {
        salonId,
        customerId,
        status: {
          in: ACTIVE_APPOINTMENT_STATUSES
        }
      },
      select: {
        id: true,
        staffId: true,
        status: true
      }
    })
  ]);

  if (appointmentCount === 0) {
    const result = await prisma.$transaction(async (tx) => {
      await tx.customer.delete({
        where: {
          id: existing.id
        }
      });
      await createAuditLog(
        {
          salonId,
          actorUserId,
          action: "CUSTOMER_DELETED",
          entityType: "Customer",
          entityId: existing.id,
          metadata: {
            mode: "hard_delete",
            customerId: existing.id,
            appointmentCount: 0,
            canceledAppointmentCount: 0
          }
        },
        tx
      );
      return {
        customerId: existing.id,
        mode: "hard_delete" as const,
        appointmentCount: 0,
        canceledAppointmentCount: 0
      };
    });
    return result;
  }

  const deletedAt = new Date();
  const privacyPhone = `deleted-customer-${existing.id}`;
  const result = await prisma.$transaction(async (tx) => {
    const canceledAppointments = [];
    for (const appointment of activeAppointments) {
      canceledAppointments.push(
        await cancelAppointmentInTransaction(tx, {
          salonId,
          appointmentId: appointment.id,
          actorUserId,
          reason: CUSTOMER_PRIVACY_DELETE_REASON,
          existing: appointment
        })
      );
    }

    await tx.customer.update({
      where: {
        id: existing.id
      },
      data: {
        firstName: "Deleted",
        lastName: "Customer",
        email: null,
        phone: privacyPhone,
        notes: null,
        deletedAt
      }
    });

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: "CUSTOMER_PRIVACY_DELETED",
        entityType: "Customer",
        entityId: existing.id,
        metadata: {
          mode: "privacy_delete",
          customerId: existing.id,
          appointmentCount,
          canceledAppointmentCount: canceledAppointments.length
        }
      },
      tx
    );

    return {
      customerId: existing.id,
      mode: "privacy_delete" as const,
      appointmentCount,
      canceledAppointmentCount: canceledAppointments.length,
      deletedAt,
      canceledAppointments: canceledAppointments.map((appointment) => ({
        appointment,
        affectedStaffIds: [appointment.staffId]
      }))
    };
  });

  await Promise.all(
    result.canceledAppointments.map((item) =>
      sendCanceledAppointmentNotifications(item.appointment, item.affectedStaffIds)
    )
  );

  return {
    customerId: result.customerId,
    mode: result.mode,
    appointmentCount: result.appointmentCount,
    canceledAppointmentCount: result.canceledAppointmentCount,
    deletedAt: result.deletedAt
  };
};

export const getCustomerAppointmentHistory = async (salonId: string, customerId: string) => {
  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      salonId,
    }
  });
  if (!customer) {
    throw new AppError("Customer not found.", 404, "CUSTOMER_NOT_FOUND");
  }

  const appointments = await prisma.appointment.findMany({
    where: {
      salonId,
      customerId
    },
    include: {
      staff: true,
      service: true
    },
    orderBy: {
      startTime: "desc"
    }
  });

  return {
    customer,
    appointments: appointments.map(toOwnerAppointmentResponse)
  };
};
