import { Prisma, StaffStatus } from "@prisma/client";
import { prisma } from "../../db/prisma";

type PrismaExecutor = typeof prisma | Prisma.TransactionClient;

export const DEFAULT_STAFF_TITLE = "Nail Technician";

export const normalizeStaffTitle = () => DEFAULT_STAFF_TITLE;

export interface StaffServiceDefaultRepairResult {
  salonId: string;
  dryRun: boolean;
  activeServiceIds: string[];
  eligibleStaffIds: string[];
  beforeCount: number;
  insertedCount: number;
  afterCount: number;
  missingPairs: Array<{
    salonId: string;
    staffId: string;
    serviceId: string;
    staffName: string;
    serviceName: string;
  }>;
  normalizedTitleStaffIds: string[];
  normalizedTitleCount: number;
}

export const getDefaultServiceIdsForStaff = async (
  tx: PrismaExecutor,
  salonId: string
): Promise<string[]> => {
  const services = await tx.service.findMany({
    where: {
      salonId,
      isActive: true,
      deletedAt: null
    },
    select: {
      id: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });
  return services.map((service) => service.id);
};

export const getDefaultStaffIdsForService = async (
  tx: PrismaExecutor,
  salonId: string
): Promise<string[]> => {
  const staff = await tx.staff.findMany({
    where: {
      salonId,
      status: StaffStatus.ACTIVE,
      isBookable: true,
      deletedAt: null
    },
    select: {
      id: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });
  return staff.map((member) => member.id);
};

export const repairStaffServiceDefaultsForSalon = async (
  salonId: string,
  options: { dryRun?: boolean } = {}
): Promise<StaffServiceDefaultRepairResult> => {
  const dryRun = options.dryRun !== false;
  const [services, staff, existingRows, nonCanonicalTitleStaff] = await Promise.all([
    prisma.service.findMany({
      where: {
        salonId,
        isActive: true,
        deletedAt: null
      },
      select: {
        id: true,
        name: true
      },
      orderBy: {
        createdAt: "asc"
      }
    }),
    prisma.staff.findMany({
      where: {
        salonId,
        status: StaffStatus.ACTIVE,
        isBookable: true,
        deletedAt: null
      },
      select: {
        id: true,
        fullName: true
      },
      orderBy: {
        createdAt: "asc"
      }
    }),
    prisma.staffService.findMany({
      where: {
        salonId
      },
      select: {
        staffId: true,
        serviceId: true
      }
    }),
    prisma.staff.findMany({
      where: {
        salonId,
        deletedAt: null,
        OR: [
          { title: null },
          {
            title: {
              not: DEFAULT_STAFF_TITLE
            }
          }
        ]
      },
      select: {
        id: true
      },
      orderBy: {
        createdAt: "asc"
      }
    })
  ]);

  const existingPairs = new Set(existingRows.map((row) => `${row.staffId}:${row.serviceId}`));
  const missingPairs = staff.flatMap((member) =>
    services
      .filter((service) => !existingPairs.has(`${member.id}:${service.id}`))
      .map((service) => ({
        salonId,
        staffId: member.id,
        serviceId: service.id,
        staffName: member.fullName,
        serviceName: service.name
      }))
  );
  const normalizedTitleStaffIds = nonCanonicalTitleStaff.map((member) => member.id);

  let insertedCount = 0;
  let normalizedTitleCount = 0;
  let afterCount = existingRows.length;

  if (!dryRun) {
    await prisma.$transaction(async (tx) => {
      if (missingPairs.length) {
        const result = await tx.staffService.createMany({
          data: missingPairs.map(({ salonId: pairSalonId, staffId, serviceId }) => ({
            salonId: pairSalonId,
            staffId,
            serviceId
          })),
          skipDuplicates: true
        });
        insertedCount = result.count;
      }

      if (normalizedTitleStaffIds.length) {
        const titleResult = await tx.staff.updateMany({
          where: {
            id: {
              in: normalizedTitleStaffIds
            },
            salonId,
            deletedAt: null
          },
          data: {
            title: DEFAULT_STAFF_TITLE
          }
        });
        normalizedTitleCount = titleResult.count;
      }

      afterCount = await tx.staffService.count({
        where: {
          salonId
        }
      });
    });
  }

  return {
    salonId,
    dryRun,
    activeServiceIds: services.map((service) => service.id),
    eligibleStaffIds: staff.map((member) => member.id),
    beforeCount: existingRows.length,
    insertedCount,
    afterCount,
    missingPairs,
    normalizedTitleStaffIds,
    normalizedTitleCount
  };
};
