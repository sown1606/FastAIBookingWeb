import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";
import { AppError } from "../../lib/errors";
import { requireCustomerPhone } from "../../utils/phone";

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

export const createCustomer = async (
  salonId: string,
  actorUserId: string,
  input: CreateCustomerInput
) => {
  const customer = await prisma.customer.create({
    data: {
      salonId,
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email?.toLowerCase(),
      phone: requireCustomerPhone(input.phone, "Customer phone"),
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
    appointments
  };
};
