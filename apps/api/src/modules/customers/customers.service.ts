import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";
import { AppError } from "../../lib/errors";
import { requireCustomerPhone } from "../../utils/phone";
import { toOwnerAppointmentResponse } from "../appointments/appointments.service";

interface CreateCustomerInput {
  firstName: string;
  lastName: string;
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

export const createCustomer = async (
  salonId: string,
  actorUserId: string,
  input: CreateCustomerInput
) => {
  const phone = requireCustomerPhone(input.phone, "Customer phone");
  const customer = await prisma.customer.create({
    data: {
      salonId,
      firstName: input.firstName,
      lastName: input.lastName,
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
      salonId
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
      firstName: input.firstName ?? existing.firstName,
      lastName: input.lastName ?? existing.lastName,
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
      salonId
    }
  });
  if (!customer) {
    throw new AppError("Customer not found.", 404, "CUSTOMER_NOT_FOUND");
  }
  return customer;
};

export const getCustomerAppointmentHistory = async (salonId: string, customerId: string) => {
  const customer = await prisma.customer.findFirst({
    where: {
      id: customerId,
      salonId
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
