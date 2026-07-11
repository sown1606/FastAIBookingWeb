import { AppointmentStatus, Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";
import { AppError } from "../../lib/errors";
import { normalizeCustomerPhone, requireCustomerPhone } from "../../utils/phone";
import { normalizePhoneForMatching } from "../calls/providers/callrail.provider";
import {
  cancelAppointmentInTransaction,
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

const ACTIVE_APPOINTMENT_STATUSES: AppointmentStatus[] = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS
];
const CUSTOMER_PERMANENT_DELETE_REASON = "Customer data permanently deleted by salon owner";
const ANONYMOUS_CUSTOMER_PHONE = "anonymous-customer";

const normalizeNamePart = (value: string | null | undefined) => value?.trim() ?? "";

const normalizePhoneDigits = (value: string | null | undefined) => value?.replace(/\D/g, "") ?? "";

const buildPhoneLookupValues = (phone: string | null | undefined): string[] => {
  const trimmed = phone?.trim();
  if (!trimmed) {
    return [];
  }

  const values = new Set<string>();
  const normalizedCustomerPhone = normalizeCustomerPhone(trimmed);
  const normalizedForMatching = normalizePhoneForMatching(trimmed);
  const digits = normalizePhoneDigits(trimmed);

  [trimmed, normalizedCustomerPhone, normalizedForMatching, digits].forEach((value) => {
    if (value) {
      values.add(value);
    }
  });
  if (digits) {
    values.add(`+${digits}`);
    if (digits.startsWith("1") && digits.length === 11) {
      values.add(digits.slice(1));
      values.add(`+${digits.slice(1)}`);
    }
  }
  if (normalizedCustomerPhone) {
    const normalizedDigits = normalizePhoneDigits(normalizedCustomerPhone);
    values.add(normalizedDigits);
    if (normalizedDigits.startsWith("1") && normalizedDigits.length === 11) {
      values.add(normalizedDigits.slice(1));
    }
  }

  return Array.from(values).filter(Boolean);
};

const jsonPathEqualsAny = <T>(fieldName: keyof T, path: string[], values: string[]) => {
  return values.map((value) => ({
    [fieldName]: {
      path,
      equals: value
    }
  })) as T[];
};

const getCustomerDeleteTargets = async (
  salonId: string,
  customerId: string,
  executor: Pick<typeof prisma, "customer">
) => {
  const selectedCustomer = await executor.customer.findFirst({
    where: {
      id: customerId,
      salonId,
      deletedAt: null
    },
    select: {
      id: true,
      phone: true
    }
  });

  if (!selectedCustomer) {
    throw new AppError("Customer not found.", 404, "CUSTOMER_NOT_FOUND");
  }

  const normalizedPhone = normalizeCustomerPhone(selectedCustomer.phone);
  if (!normalizedPhone) {
    return {
      selectedCustomer,
      phoneLookupValues: [],
      matchedCustomers: [selectedCustomer]
    };
  }

  const phoneLookupValues = buildPhoneLookupValues(selectedCustomer.phone);
  const matchedCustomers = await executor.customer.findMany({
    where: {
      salonId,
      deletedAt: null,
      phone: {
        in: phoneLookupValues
      }
    },
    select: {
      id: true,
      phone: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  return {
    selectedCustomer,
    phoneLookupValues,
    matchedCustomers: matchedCustomers.length ? matchedCustomers : [selectedCustomer]
  };
};

const getOrCreateAnonymousCustomer = async (
  tx: Prisma.TransactionClient,
  salonId: string
) => {
  const existing = await tx.customer.findFirst({
    where: {
      salonId,
      deletedAt: {
        not: null
      },
      phone: ANONYMOUS_CUSTOMER_PHONE
    },
    select: {
      id: true
    }
  });
  if (existing) {
    return existing;
  }

  return tx.customer.create({
    data: {
      salonId,
      firstName: "Anonymous",
      lastName: "Customer",
      email: null,
      phone: ANONYMOUS_CUSTOMER_PHONE,
      notes: null,
      deletedAt: new Date()
    },
    select: {
      id: true
    }
  });
};

export const getCustomerDeletePreview = async (salonId: string, customerId: string) => {
  const { selectedCustomer, phoneLookupValues, matchedCustomers } = await getCustomerDeleteTargets(
    salonId,
    customerId,
    prisma
  );
  const matchedCustomerIds = matchedCustomers.map((customer) => customer.id);
  const appointments = await prisma.appointment.findMany({
    where: {
      salonId,
      customerId: {
        in: matchedCustomerIds
      }
    },
    select: {
      id: true,
      status: true
    }
  });
  const appointmentIds = appointments.map((appointment) => appointment.id);
  const callSessions = phoneLookupValues.length
    ? await prisma.callSession.findMany({
        where: {
          salonId,
          callerPhone: {
            in: phoneLookupValues
          }
        },
        select: {
          id: true
        }
      })
    : [];
  const callSessionIds = callSessions.map((callSession) => callSession.id);
  const bookingAttemptWhere: Prisma.BookingAttemptWhereInput[] = [
    ...(phoneLookupValues.length
      ? [
          {
            customerPhone: {
              in: phoneLookupValues
            }
          }
        ]
      : []),
    ...(appointmentIds.length
      ? [
          {
            appointmentId: {
              in: appointmentIds
            }
          }
        ]
      : []),
    ...(callSessionIds.length
      ? [
          {
            callSessionId: {
              in: callSessionIds
            }
          }
        ]
      : []),
    ...matchedCustomerIds.flatMap((id) =>
      jsonPathEqualsAny<Prisma.BookingAttemptWhereInput>("normalizedRequest", ["customerId"], [id])
    )
  ];

  const bookingAttemptCount = bookingAttemptWhere.length
    ? await prisma.bookingAttempt.count({
        where: {
          salonId,
          OR: bookingAttemptWhere
        }
      })
    : 0;

  return {
    customerId: selectedCustomer.id,
    matchedCustomerIds,
    matchedCustomerCount: matchedCustomerIds.length,
    appointmentCount: appointments.length,
    activeAppointmentCount: appointments.filter((appointment) =>
      ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status)
    ).length,
    callSessionCount: callSessionIds.length,
    bookingAttemptCount,
    warning:
      "Permanent deletion removes customer profiles, cancels active appointments, reassigns appointment history to an anonymous placeholder, and removes related call/debug history."
  };
};

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
  return prisma.$transaction(async (tx) => {
    const { phoneLookupValues, matchedCustomers } = await getCustomerDeleteTargets(
      salonId,
      customerId,
      tx
    );
    const targetCustomerIds = matchedCustomers.map((customer) => customer.id);
    const appointments = await tx.appointment.findMany({
      where: {
        salonId,
        customerId: {
          in: targetCustomerIds
        }
      },
      select: {
        id: true,
        staffId: true,
        status: true
      }
    });
    const appointmentIds = appointments.map((appointment) => appointment.id);
    const activeAppointments = appointments.filter((appointment) =>
      ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status)
    );

    for (const appointment of activeAppointments) {
      await cancelAppointmentInTransaction(tx, {
        salonId,
        appointmentId: appointment.id,
        actorUserId,
        reason: CUSTOMER_PERMANENT_DELETE_REASON,
        existing: appointment
      });
    }

    const anonymousCustomer =
      appointments.length > 0 ? await getOrCreateAnonymousCustomer(tx, salonId) : null;
    const reassignedAppointmentUpdate = anonymousCustomer
      ? await tx.appointment.updateMany({
          where: {
            salonId,
            customerId: {
              in: targetCustomerIds
            }
          },
          data: {
            customerId: anonymousCustomer.id,
            notes: null
          }
        })
      : { count: 0 };

    if (appointmentIds.length) {
      await tx.customerFeedback.updateMany({
        where: {
          salonId,
          appointmentId: {
            in: appointmentIds
          }
        },
        data: {
          customerPhone: ANONYMOUS_CUSTOMER_PHONE
        }
      });
    }

    const callSessions = phoneLookupValues.length
      ? await tx.callSession.findMany({
          where: {
            salonId,
            callerPhone: {
              in: phoneLookupValues
            }
          },
          select: {
            id: true
          }
        })
      : [];
    const callSessionIds = callSessions.map((callSession) => callSession.id);

    const bookingAttemptWhere: Prisma.BookingAttemptWhereInput[] = [
      ...(phoneLookupValues.length
        ? [
            {
              customerPhone: {
                in: phoneLookupValues
              }
            }
          ]
        : []),
      ...(appointmentIds.length
        ? [
            {
              appointmentId: {
                in: appointmentIds
              }
            }
          ]
        : []),
      ...(callSessionIds.length
        ? [
            {
              callSessionId: {
                in: callSessionIds
              }
            }
          ]
        : []),
      ...targetCustomerIds.flatMap((id) =>
        jsonPathEqualsAny<Prisma.BookingAttemptWhereInput>("normalizedRequest", ["customerId"], [id])
      )
    ];
    const targetBookingAttempts = bookingAttemptWhere.length
      ? await tx.bookingAttempt.findMany({
          where: {
            salonId,
            OR: bookingAttemptWhere
          },
          select: {
            id: true,
            callSessionId: true,
            transcriptId: true
          }
        })
      : [];
    const bookingAttemptIds = targetBookingAttempts.map((attempt) => attempt.id);
    const targetCallSessionIds = Array.from(
      new Set([
        ...callSessionIds,
        ...targetBookingAttempts
          .map((attempt) => attempt.callSessionId)
          .filter((id): id is string => Boolean(id))
      ])
    );
    const transcriptIds = Array.from(
      new Set(
        targetBookingAttempts
          .map((attempt) => attempt.transcriptId)
          .filter((id): id is string => Boolean(id))
      )
    );

    const aiInteractionWhere: Prisma.AiInteractionLogWhereInput[] = [
      ...(bookingAttemptIds.length
        ? [
            {
              bookingAttemptId: {
                in: bookingAttemptIds
              }
            }
          ]
        : []),
      ...(targetCallSessionIds.length
        ? [
            {
              callSessionId: {
                in: targetCallSessionIds
              }
            }
          ]
        : []),
      ...(transcriptIds.length
        ? [
            {
              transcriptId: {
                in: transcriptIds
              }
            }
          ]
        : [])
    ];
    const deletedAiInteraction = aiInteractionWhere.length
      ? await tx.aiInteractionLog.deleteMany({
          where: {
            salonId,
            OR: aiInteractionWhere
          }
        })
      : { count: 0 };

    const deletedBookingAttempt = bookingAttemptIds.length
      ? await tx.bookingAttempt.deleteMany({
          where: {
            salonId,
            id: {
              in: bookingAttemptIds
            }
          }
        })
      : { count: 0 };

    if (transcriptIds.length) {
      await tx.callTranscript.deleteMany({
        where: {
          salonId,
          id: {
            in: transcriptIds
          }
        }
      });
    }

    const deletedCallSession = targetCallSessionIds.length
      ? await tx.callSession.deleteMany({
          where: {
            id: {
              in: targetCallSessionIds
            },
            salonId
          }
        })
      : { count: 0 };

    const alertWhere: Prisma.AlertWhereInput[] = [
      ...(appointmentIds.length
        ? appointmentIds.flatMap((id) =>
            jsonPathEqualsAny<Prisma.AlertWhereInput>("metadata", ["appointmentId"], [id])
          )
        : []),
      ...(phoneLookupValues.length
        ? phoneLookupValues.flatMap((phone) =>
            jsonPathEqualsAny<Prisma.AlertWhereInput>("metadata", ["customerPhone"], [phone])
          )
        : [])
    ];
    const deletedAlert = alertWhere.length
      ? await tx.alert.deleteMany({
          where: {
            salonId,
            OR: alertWhere
          }
        })
      : { count: 0 };

    const userNotificationWhere: Prisma.UserNotificationWhereInput[] = [
      ...(appointmentIds.length
        ? appointmentIds.flatMap((id) =>
            jsonPathEqualsAny<Prisma.UserNotificationWhereInput>("data", ["appointmentId"], [id])
          )
        : []),
      ...(phoneLookupValues.length
        ? phoneLookupValues.flatMap((phone) =>
            jsonPathEqualsAny<Prisma.UserNotificationWhereInput>("data", ["customerPhone"], [phone])
          )
        : [])
    ];
    if (userNotificationWhere.length) {
      await tx.userNotification.deleteMany({
        where: {
          salonId,
          OR: userNotificationWhere
        }
      });
    }

    await tx.customer.deleteMany({
      where: {
        salonId,
        id: {
          in: targetCustomerIds
        }
      }
    });

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: "CUSTOMER_PERMANENTLY_DELETED",
        entityType: "Customer",
        entityId: customerId,
        metadata: {
          mode: "permanent_delete",
          selectedCustomerId: customerId,
          deletedCustomerIds: targetCustomerIds,
          matchedCustomerCount: targetCustomerIds.length,
          appointmentCount: appointments.length,
          canceledAppointmentCount: activeAppointments.length,
          reassignedAppointmentCount: reassignedAppointmentUpdate.count,
          deletedCallSessionCount: deletedCallSession.count,
          deletedBookingAttemptCount: deletedBookingAttempt.count,
          deletedAiInteractionCount: deletedAiInteraction.count,
          deletedAlertCount: deletedAlert.count
        }
      },
      tx
    );

    return {
      customerId,
      mode: "permanent_delete" as const,
      deletedCustomerIds: targetCustomerIds,
      deletedCustomerCount: targetCustomerIds.length,
      appointmentCount: appointments.length,
      canceledAppointmentCount: activeAppointments.length,
      reassignedAppointmentCount: reassignedAppointmentUpdate.count,
      deletedCallSessionCount: deletedCallSession.count,
      deletedBookingAttemptCount: deletedBookingAttempt.count
    };
  });
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
