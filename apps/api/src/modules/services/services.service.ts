import { prisma } from "../../db/prisma";
import { createAuditLog } from "../../lib/audit";
import { AppError } from "../../lib/errors";

interface CreateServiceInput {
  name: string;
  description?: string;
  durationMinutes: number;
  priceCents: number;
  staffIds?: string[];
}

interface UpdateServiceInput {
  name?: string;
  description?: string | null;
  durationMinutes?: number;
  priceCents?: number;
}

export const listServices = async (salonId: string, includeInactive = false) => {
  return prisma.service.findMany({
    where: {
      salonId,
      ...(includeInactive ? {} : { isActive: true })
    },
    include: {
      staffServices: {
        include: {
          staff: true
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });
};

const validateStaffIdsBelongToSalon = async (salonId: string, staffIds: string[]): Promise<void> => {
  if (!staffIds.length) {
    return;
  }
  const count = await prisma.staff.count({
    where: {
      salonId,
      id: {
        in: staffIds
      }
    }
  });
  if (count !== staffIds.length) {
    throw new AppError("One or more staff IDs are invalid for this salon.", 400, "INVALID_STAFF");
  }
};

export const createService = async (
  salonId: string,
  actorUserId: string,
  input: CreateServiceInput
) => {
  await validateStaffIdsBelongToSalon(salonId, input.staffIds ?? []);

  return prisma.$transaction(async (tx) => {
    const service = await tx.service.create({
      data: {
        salonId,
        name: input.name,
        description: input.description,
        durationMinutes: input.durationMinutes,
        priceCents: input.priceCents
      }
    });

    if (input.staffIds?.length) {
      await tx.staffService.createMany({
        data: input.staffIds.map((staffId) => ({
          salonId,
          serviceId: service.id,
          staffId
        })),
        skipDuplicates: true
      });
    }

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: "SERVICE_CREATED",
        entityType: "Service",
        entityId: service.id
      },
      tx
    );

    return tx.service.findUniqueOrThrow({
      where: { id: service.id },
      include: {
        staffServices: {
          include: { staff: true }
        }
      }
    });
  });
};

export const updateService = async (
  salonId: string,
  serviceId: string,
  actorUserId: string,
  input: UpdateServiceInput
) => {
  const existing = await prisma.service.findFirst({
    where: {
      id: serviceId,
      salonId
    }
  });
  if (!existing) {
    throw new AppError("Service not found.", 404, "SERVICE_NOT_FOUND");
  }

  const service = await prisma.service.update({
    where: { id: existing.id },
    data: {
      name: input.name ?? existing.name,
      description: input.description === undefined ? existing.description : input.description,
      durationMinutes: input.durationMinutes ?? existing.durationMinutes,
      priceCents: input.priceCents ?? existing.priceCents
    },
    include: {
      staffServices: {
        include: {
          staff: true
        }
      }
    }
  });

  await createAuditLog({
    salonId,
    actorUserId,
    action: "SERVICE_UPDATED",
    entityType: "Service",
    entityId: service.id,
    metadata: input
  });

  return service;
};

export const setServiceActiveState = async (
  salonId: string,
  serviceId: string,
  actorUserId: string,
  isActive: boolean
) => {
  const service = await prisma.service.findFirst({
    where: {
      id: serviceId,
      salonId
    }
  });
  if (!service) {
    throw new AppError("Service not found.", 404, "SERVICE_NOT_FOUND");
  }

  const updated = await prisma.service.update({
    where: { id: service.id },
    data: { isActive },
    include: {
      staffServices: {
        include: {
          staff: true
        }
      }
    }
  });

  await createAuditLog({
    salonId,
    actorUserId,
    action: isActive ? "SERVICE_ACTIVATED" : "SERVICE_DEACTIVATED",
    entityType: "Service",
    entityId: updated.id
  });

  return updated;
};

export const setServiceStaffMapping = async (
  salonId: string,
  serviceId: string,
  actorUserId: string,
  staffIds: string[]
) => {
  await validateStaffIdsBelongToSalon(salonId, staffIds);
  const existing = await prisma.service.findFirst({
    where: {
      id: serviceId,
      salonId
    }
  });
  if (!existing) {
    throw new AppError("Service not found.", 404, "SERVICE_NOT_FOUND");
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.staffService.deleteMany({
      where: {
        salonId,
        serviceId: existing.id
      }
    });

    if (staffIds.length) {
      await tx.staffService.createMany({
        data: staffIds.map((staffId) => ({
          salonId,
          serviceId: existing.id,
          staffId
        }))
      });
    }

    await createAuditLog(
      {
        salonId,
        actorUserId,
        action: "SERVICE_STAFF_MAPPING_UPDATED",
        entityType: "Service",
        entityId: existing.id,
        metadata: { staffIds }
      },
      tx
    );

    return tx.service.findUniqueOrThrow({
      where: { id: existing.id },
      include: {
        staffServices: {
          include: {
            staff: true
          }
        }
      }
    });
  });

  return result;
};
