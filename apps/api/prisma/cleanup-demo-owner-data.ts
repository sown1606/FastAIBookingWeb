import {
  AppointmentStatus,
  Prisma,
  PrismaClient,
  Role,
  Staff,
  StaffStatus,
  StaffWorkStatus
} from "@prisma/client";

const prisma = new PrismaClient();
const DEMO_OWNER_EMAIL = "owner.demo@fastaibooking.local";
const APPLY = process.env.APPLY === "true";

const canonicalStaff = [
  {
    fullName: "Amy",
    email: "amy.demo@fastaibooking.local",
    phone: "+17325550102",
    title: "Nail Technician"
  },
  {
    fullName: "Kelly",
    email: "kelly.demo@fastaibooking.local",
    phone: "+17325550103",
    title: "Nail Technician"
  },
  {
    fullName: "Trang",
    email: "staff.demo@fastaibooking.local",
    phone: "+17325550101",
    title: "Pedicure Specialist"
  }
] as const;

const fakeServiceMarkers = ["Smoke", "Test", "UX", "Updated"];
const smokeCustomerMarkers = ["Smoke", "Test", "UX"];
const smokeNoteMarkers = ["smoke", "test"];
const visibleAppointmentStatuses = [
  AppointmentStatus.SCHEDULED,
  AppointmentStatus.CONFIRMED,
  AppointmentStatus.IN_PROGRESS
];

const fakeServiceWhere: Prisma.ServiceWhereInput = {
  OR: fakeServiceMarkers.map((marker) => ({
    name: {
      contains: marker,
      mode: Prisma.QueryMode.insensitive
    }
  }))
};

const smokeCustomerWhere: Prisma.CustomerWhereInput = {
  OR: smokeCustomerMarkers.flatMap((marker) => [
    {
      firstName: {
        contains: marker,
        mode: Prisma.QueryMode.insensitive
      }
    },
    {
      lastName: {
        contains: marker,
        mode: Prisma.QueryMode.insensitive
      }
    },
    {
      notes: {
        contains: marker,
        mode: Prisma.QueryMode.insensitive
      }
    }
  ])
};

const smokeAppointmentWhere = (
  salonId: string,
  canonicalStaffIds: string[]
): Prisma.AppointmentWhereInput => ({
  salonId,
  OR: [
    {
      staffId: {
        notIn: canonicalStaffIds
      }
    },
    ...smokeCustomerMarkers.flatMap((marker) => [
      {
        customer: {
          firstName: {
            contains: marker,
            mode: Prisma.QueryMode.insensitive
          }
        }
      },
      {
        customer: {
          lastName: {
            contains: marker,
            mode: Prisma.QueryMode.insensitive
          }
        }
      }
    ]),
    ...smokeNoteMarkers.map((marker) => ({
      notes: {
        contains: marker,
        mode: Prisma.QueryMode.insensitive
      }
    })),
    {
      service: fakeServiceWhere
    }
  ]
});

type CanonicalSelection = {
  input: (typeof canonicalStaff)[number];
  existing: Staff | null;
};

type CleanupPlan = {
  selections: CanonicalSelection[];
  extraStaff: Staff[];
  smokeAppointments: Array<{
    id: string;
    startTime: Date;
    status: AppointmentStatus;
    notes: string | null;
    staff: { fullName: string };
    customer: { firstName: string; lastName: string };
    service: { name: string };
  }>;
  smokeCustomers: Array<{
    id: string;
    firstName: string;
    lastName: string;
  }>;
  fakeServices: Array<{
    id: string;
    name: string;
    isActive: boolean;
  }>;
  activeServicesAfterCleanup: Array<{
    id: string;
    name: string;
  }>;
  existingStaffServiceMappingCount: number;
};

const selectCanonicalStaff = (staff: Staff[]): CanonicalSelection[] => {
  const selected = new Map<string, Staff>();
  const claimedIds = new Set<string>();

  for (const input of canonicalStaff) {
    const emailMatch = staff.find(
      (member) =>
        !claimedIds.has(member.id) &&
        member.email?.trim().toLowerCase() === input.email.toLowerCase()
    );
    if (emailMatch) {
      selected.set(input.email, emailMatch);
      claimedIds.add(emailMatch.id);
    }
  }

  for (const input of canonicalStaff) {
    if (selected.has(input.email)) {
      continue;
    }
    const nameMatch = staff.find(
      (member) =>
        !claimedIds.has(member.id) &&
        member.fullName.trim().toLowerCase() === input.fullName.toLowerCase()
    );
    if (nameMatch) {
      selected.set(input.email, nameMatch);
      claimedIds.add(nameMatch.id);
    }
  }

  return canonicalStaff.map((input) => ({
    input,
    existing: selected.get(input.email) ?? null
  }));
};

const buildCleanupPlan = async (salonId: string): Promise<CleanupPlan> => {
  const staff = await prisma.staff.findMany({
    where: { salonId },
    orderBy: { createdAt: "asc" }
  });
  const selections = selectCanonicalStaff(staff);
  const canonicalStaffIds = selections
    .map((selection) => selection.existing?.id)
    .filter((staffId): staffId is string => Boolean(staffId));
  const selectedIdSet = new Set(canonicalStaffIds);
  const extraStaff = staff.filter((member) => !selectedIdSet.has(member.id));

  const smokeAppointments = await prisma.appointment.findMany({
    where: smokeAppointmentWhere(salonId, canonicalStaffIds),
    select: {
      id: true,
      startTime: true,
      status: true,
      notes: true,
      staff: {
        select: {
          fullName: true
        }
      },
      customer: {
        select: {
          firstName: true,
          lastName: true
        }
      },
      service: {
        select: {
          name: true
        }
      }
    },
    orderBy: {
      startTime: "asc"
    }
  });
  const smokeAppointmentIds = new Set(smokeAppointments.map((appointment) => appointment.id));

  const smokeCustomerCandidates = await prisma.customer.findMany({
    where: {
      salonId,
      ...smokeCustomerWhere
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      appointments: {
        select: {
          id: true
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });
  const smokeCustomers = smokeCustomerCandidates
    .filter((customer) =>
      customer.appointments.every((appointment) => smokeAppointmentIds.has(appointment.id))
    )
    .map(({ appointments: _appointments, ...customer }) => customer);

  const services = await prisma.service.findMany({
    where: { salonId },
    select: {
      id: true,
      name: true,
      isActive: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });
  const fakeServices = services.filter((service) =>
    fakeServiceMarkers.some((marker) =>
      service.name.toLowerCase().includes(marker.toLowerCase())
    )
  );
  const fakeServiceIds = new Set(fakeServices.map((service) => service.id));
  const activeServicesAfterCleanup = services
    .filter((service) => service.isActive && !fakeServiceIds.has(service.id))
    .map(({ id, name }) => ({ id, name }));

  const existingStaffServiceMappingCount = await prisma.staffService.count({
    where: { salonId }
  });

  return {
    selections,
    extraStaff,
    smokeAppointments,
    smokeCustomers,
    fakeServices,
    activeServicesAfterCleanup,
    existingStaffServiceMappingCount
  };
};

const printPlan = (
  salon: { id: string; name: string },
  plan: CleanupPlan
): void => {
  console.log(
    JSON.stringify(
      {
        mode: APPLY ? "APPLY" : "DRY_RUN",
        ownerEmail: DEMO_OWNER_EMAIL,
        salon,
        plannedChanges: {
          canonicalStaff: plan.selections.map(({ input, existing }) => ({
            action: existing ? "UPDATE" : "CREATE",
            existingId: existing?.id ?? null,
            existingName: existing?.fullName ?? null,
            existingEmail: existing?.email ?? null,
            target: input
          })),
          extraStaffToDelete: plan.extraStaff.map((staff) => ({
            id: staff.id,
            fullName: staff.fullName,
            email: staff.email,
            status: staff.status
          })),
          smokeAppointmentsToDelete: plan.smokeAppointments.map((appointment) => ({
            id: appointment.id,
            startTime: appointment.startTime.toISOString(),
            status: appointment.status,
            staff: appointment.staff.fullName,
            customer: `${appointment.customer.firstName} ${appointment.customer.lastName}`.trim(),
            service: appointment.service.name,
            notes: appointment.notes
          })),
          orphanSmokeCustomersToDelete: plan.smokeCustomers,
          fakeServicesToDeactivate: plan.fakeServices,
          staffServiceMappingsToReplace: plan.existingStaffServiceMappingCount,
          staffServiceMappingsToCreate:
            plan.activeServicesAfterCleanup.length * canonicalStaff.length,
          activeServicesAfterCleanup: plan.activeServicesAfterCleanup.map((service) => service.name)
        },
        projectedVerification: {
          activeStaffCount: canonicalStaff.length,
          activeStaffNames: canonicalStaff.map((staff) => staff.fullName),
          inactiveOrDeletedExtraStaffCount: plan.extraStaff.length,
          deletedSmokeAppointmentsCount: plan.smokeAppointments.length,
          deletedSmokeCustomersCount: plan.smokeCustomers.length,
          noFutureVisibleAppointmentReferencesNonCanonicalStaff: true,
          noServiceMappingReferencesNonCanonicalStaff: true
        }
      },
      null,
      2
    )
  );
};

const normalizeCanonicalUser = async (
  tx: Prisma.TransactionClient,
  salonId: string,
  staffId: string,
  input: (typeof canonicalStaff)[number]
): Promise<void> => {
  const [userByEmail, userByStaff] = await Promise.all([
    tx.user.findUnique({
      where: {
        email: input.email
      }
    }),
    tx.user.findUnique({
      where: {
        staffId
      }
    })
  ]);

  if (userByEmail && userByStaff && userByEmail.id !== userByStaff.id) {
    await tx.user.update({
      where: {
        id: userByStaff.id
      },
      data: {
        staffId: null,
        isActive: false
      }
    });
  }

  const canonicalUser = userByEmail ?? userByStaff;
  if (!canonicalUser) {
    return;
  }

  await tx.user.update({
    where: {
      id: canonicalUser.id
    },
    data: {
      email: input.email,
      fullName: input.fullName,
      phone: input.phone,
      role: Role.STAFF,
      salonId,
      staffId,
      isActive: true
    }
  });
};

const applyCleanup = async (
  salon: { id: string; name: string },
  plan: CleanupPlan
) => {
  return prisma.$transaction(async (tx) => {
    const canonicalStaffIds: string[] = [];

    for (const { input, existing } of plan.selections) {
      const staff = existing
        ? await tx.staff.update({
            where: {
              id: existing.id
            },
            data: {
              fullName: input.fullName,
              email: input.email,
              phone: input.phone,
              title: input.title,
              status: StaffStatus.ACTIVE,
              currentWorkStatus: StaffWorkStatus.AVAILABLE,
              activeAppointmentId: null,
              isBookable: true
            }
          })
        : await tx.staff.create({
            data: {
              salonId: salon.id,
              fullName: input.fullName,
              email: input.email,
              phone: input.phone,
              title: input.title,
              status: StaffStatus.ACTIVE,
              currentWorkStatus: StaffWorkStatus.AVAILABLE,
              activeAppointmentId: null,
              isBookable: true
            }
          });

      canonicalStaffIds.push(staff.id);
      await normalizeCanonicalUser(tx, salon.id, staff.id, input);
    }

    const smokeAppointmentIds = plan.smokeAppointments.map((appointment) => appointment.id);
    let deletedSmokeAppointmentsCount = 0;
    if (smokeAppointmentIds.length) {
      const deletedAppointments = await tx.appointment.deleteMany({
        where: {
          salonId: salon.id,
          id: {
            in: smokeAppointmentIds
          }
        }
      });
      deletedSmokeAppointmentsCount = deletedAppointments.count;
    }

    const smokeCustomerIds = plan.smokeCustomers.map((customer) => customer.id);
    let deletedSmokeCustomersCount = 0;
    if (smokeCustomerIds.length) {
      const deletedCustomers = await tx.customer.deleteMany({
        where: {
          salonId: salon.id,
          id: {
            in: smokeCustomerIds
          },
          appointments: {
            none: {}
          }
        }
      });
      deletedSmokeCustomersCount = deletedCustomers.count;
    }

    const extraStaffIds = plan.extraStaff.map((staff) => staff.id);
    if (extraStaffIds.length) {
      await tx.user.updateMany({
        where: {
          staffId: {
            in: extraStaffIds
          }
        },
        data: {
          isActive: false
        }
      });
    }

    await tx.user.updateMany({
      where: {
        salonId: salon.id,
        role: Role.STAFF,
        OR: [
          {
            staffId: null
          },
          {
            staffId: {
              notIn: canonicalStaffIds
            }
          }
        ]
      },
      data: {
        isActive: false
      }
    });

    const removedStaffServiceMappings = await tx.staffService.deleteMany({
      where: {
        salonId: salon.id
      }
    });

    const fakeServiceIds = plan.fakeServices.map((service) => service.id);
    if (fakeServiceIds.length) {
      await tx.service.updateMany({
        where: {
          salonId: salon.id,
          id: {
            in: fakeServiceIds
          }
        },
        data: {
          isActive: false
        }
      });
    }

    let deletedExtraStaffCount = 0;
    if (extraStaffIds.length) {
      const deletedStaff = await tx.staff.deleteMany({
        where: {
          salonId: salon.id,
          id: {
            in: extraStaffIds
          },
          appointments: {
            none: {}
          }
        }
      });
      deletedExtraStaffCount = deletedStaff.count;
    }

    const activeServices = await tx.service.findMany({
      where: {
        salonId: salon.id,
        isActive: true
      },
      select: {
        id: true,
        name: true
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    const staffServiceMappings = activeServices.flatMap((service) =>
      canonicalStaffIds.map((staffId) => ({
        salonId: salon.id,
        serviceId: service.id,
        staffId
      }))
    );
    if (staffServiceMappings.length) {
      await tx.staffService.createMany({
        data: staffServiceMappings,
        skipDuplicates: true
      });
    }

    const activeStaff = await tx.staff.findMany({
      where: {
        salonId: salon.id,
        status: StaffStatus.ACTIVE
      },
      select: {
        id: true,
        fullName: true
      },
      orderBy: {
        fullName: "asc"
      }
    });
    const expectedNames = canonicalStaff.map((staff) => staff.fullName).sort();
    const actualNames = activeStaff.map((staff) => staff.fullName).sort();
    if (
      activeStaff.length !== canonicalStaff.length ||
      expectedNames.some((name, index) => actualNames[index] !== name)
    ) {
      throw new Error(`Cleanup verification failed for active staff: ${actualNames.join(", ")}`);
    }

    const remainingExtraStaff = await tx.staff.count({
      where: {
        salonId: salon.id,
        id: {
          notIn: canonicalStaffIds
        }
      }
    });
    if (remainingExtraStaff !== 0) {
      throw new Error(`Cleanup verification failed: ${remainingExtraStaff} extra staff remain.`);
    }

    const futureVisibleNonCanonicalAppointments = await tx.appointment.count({
      where: {
        salonId: salon.id,
        staffId: {
          notIn: canonicalStaffIds
        },
        status: {
          in: visibleAppointmentStatuses
        },
        startTime: {
          gte: new Date()
        }
      }
    });
    if (futureVisibleNonCanonicalAppointments !== 0) {
      throw new Error(
        `Cleanup verification failed: ${futureVisibleNonCanonicalAppointments} future visible stale appointments remain.`
      );
    }

    const nonCanonicalStaffServiceMappings = await tx.staffService.count({
      where: {
        salonId: salon.id,
        staffId: {
          notIn: canonicalStaffIds
        }
      }
    });
    if (nonCanonicalStaffServiceMappings !== 0) {
      throw new Error(
        `Cleanup verification failed: ${nonCanonicalStaffServiceMappings} stale staff-service mappings remain.`
      );
    }

    return {
      canonicalStaffIds,
      activeServices,
      deletedExtraStaffCount,
      deletedSmokeAppointmentsCount,
      deletedSmokeCustomersCount,
      removedStaffServiceMappingCount: removedStaffServiceMappings.count,
      createdStaffServiceMappingCount: staffServiceMappings.length
    };
  });
};

const printVerification = async (
  salon: { id: string; name: string },
  result: Awaited<ReturnType<typeof applyCleanup>>
): Promise<void> => {
  const activeStaff = await prisma.staff.findMany({
    where: {
      salonId: salon.id,
      status: StaffStatus.ACTIVE
    },
    select: {
      id: true,
      fullName: true
    },
    orderBy: {
      fullName: "asc"
    }
  });
  const activeStaffIds = activeStaff.map((staff) => staff.id);
  const inactiveExtraStaffCount = await prisma.staff.count({
    where: {
      salonId: salon.id,
      id: {
        notIn: activeStaffIds
      }
    }
  });
  const activeServices = await prisma.service.findMany({
    where: {
      salonId: salon.id,
      isActive: true
    },
    select: {
      name: true,
      staffServices: {
        where: {
          staffId: {
            in: activeStaffIds
          },
          staff: {
            status: StaffStatus.ACTIVE,
            salonId: salon.id
          }
        },
        select: {
          staffId: true
        }
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });
  const futureVisibleNonCanonicalAppointments = await prisma.appointment.count({
    where: {
      salonId: salon.id,
      staffId: {
        notIn: activeStaffIds
      },
      status: {
        in: visibleAppointmentStatuses
      },
      startTime: {
        gte: new Date()
      }
    }
  });
  const nonCanonicalStaffServiceMappings = await prisma.staffService.count({
    where: {
      salonId: salon.id,
      staffId: {
        notIn: activeStaffIds
      }
    }
  });

  console.log(
    JSON.stringify(
      {
        mode: "APPLIED",
        ownerEmail: DEMO_OWNER_EMAIL,
        salon,
        activeStaffCount: activeStaff.length,
        activeStaffNames: activeStaff.map((staff) => staff.fullName),
        inactiveOrDeletedExtraStaffCount:
          inactiveExtraStaffCount + result.deletedExtraStaffCount,
        remainingInactiveExtraStaffCount: inactiveExtraStaffCount,
        deletedOrCancelledSmokeAppointmentsCount: result.deletedSmokeAppointmentsCount,
        deletedSmokeCustomersCount: result.deletedSmokeCustomersCount,
        cleanedStaffServiceMappingCount:
          result.removedStaffServiceMappingCount + result.createdStaffServiceMappingCount,
        removedStaffServiceMappingCount: result.removedStaffServiceMappingCount,
        createdStaffServiceMappingCount: result.createdStaffServiceMappingCount,
        activeServices: activeServices.map((service) => ({
          name: service.name,
          assignedActiveStaffCount: service.staffServices.length
        })),
        noFutureVisibleAppointmentReferencesNonCanonicalStaff:
          futureVisibleNonCanonicalAppointments === 0,
        noServiceMappingReferencesNonCanonicalStaff:
          nonCanonicalStaffServiceMappings === 0
      },
      null,
      2
    )
  );
};

const run = async (): Promise<void> => {
  const owner = await prisma.user.findUnique({
    where: {
      email: DEMO_OWNER_EMAIL
    },
    select: {
      email: true,
      ownedSalon: {
        select: {
          id: true,
          name: true
        }
      }
    }
  });

  if (!owner) {
    throw new Error(`Cleanup stopped: owner ${DEMO_OWNER_EMAIL} was not found.`);
  }
  if (!owner.ownedSalon) {
    throw new Error(`Cleanup stopped: salon owned by ${DEMO_OWNER_EMAIL} was not found.`);
  }

  const plan = await buildCleanupPlan(owner.ownedSalon.id);
  printPlan(owner.ownedSalon, plan);

  if (!APPLY) {
    console.log("Dry run complete. No data was changed. Set APPLY=true to apply this exact cleanup.");
    return;
  }

  const result = await applyCleanup(owner.ownedSalon, plan);
  await printVerification(owner.ownedSalon, result);
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
