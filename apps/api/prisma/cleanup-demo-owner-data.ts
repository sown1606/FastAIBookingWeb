import {
  PrismaClient,
  Role,
  StaffStatus,
  StaffWorkStatus
} from "@prisma/client";

const prisma = new PrismaClient();
const DEMO_OWNER_EMAIL = "owner.demo@fastaibooking.local";
const LEGACY_FULL_SET_NAME = ["Acrylic", "Full Set"].join(" ");
const canonicalStaff = [
  {
    fullName: "Trang",
    email: "staff.demo@fastaibooking.local",
    phone: "+17325550101",
    title: "Pedicure Specialist"
  },
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
  }
];

const run = async (): Promise<void> => {
  const salon = await prisma.salon.findFirst({
    where: {
      owner: {
        email: DEMO_OWNER_EMAIL
      }
    },
    select: {
      id: true,
      name: true
    }
  });

  if (!salon) {
    console.log("Demo cleanup skipped: demo salon was not found.");
    return;
  }

  const result = await prisma.$transaction(async (tx) => {
    const canonicalIds: string[] = [];

    for (const input of canonicalStaff) {
      const matches = await tx.staff.findMany({
        where: {
          salonId: salon.id,
          OR: [
            {
              email: {
                equals: input.email,
                mode: "insensitive"
              }
            },
            {
              fullName: {
                equals: input.fullName,
                mode: "insensitive"
              }
            }
          ]
        },
        orderBy: {
          createdAt: "asc"
        }
      });
      const existing = matches[0];
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
              isBookable: true
            }
          });

      canonicalIds.push(staff.id);

      const duplicateIds = matches.slice(1).map((item) => item.id);
      if (duplicateIds.length) {
        await tx.staff.updateMany({
          where: {
            id: {
              in: duplicateIds
            }
          },
          data: {
            status: StaffStatus.INACTIVE,
            currentWorkStatus: StaffWorkStatus.AVAILABLE,
            activeAppointmentId: null,
            isBookable: false
          }
        });
      }

      const userByEmail = await tx.user.findUnique({
        where: {
          email: input.email
        }
      });
      const userByStaff = await tx.user.findUnique({
        where: {
          staffId: staff.id
        }
      });

      if (userByStaff && userByEmail && userByStaff.id !== userByEmail.id) {
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
      if (canonicalUser) {
        await tx.user.update({
          where: {
            id: canonicalUser.id
          },
          data: {
            fullName: input.fullName,
            phone: input.phone,
            role: Role.STAFF,
            salonId: salon.id,
            staffId: staff.id,
            isActive: true
          }
        });
      }
    }

    const extraStaff = await tx.staff.findMany({
      where: {
        salonId: salon.id,
        id: {
          notIn: canonicalIds
        }
      },
      select: {
        id: true,
        fullName: true
      }
    });
    const extraStaffIds = extraStaff.map((item) => item.id);

    if (extraStaffIds.length) {
      await tx.staff.updateMany({
        where: {
          id: {
            in: extraStaffIds
          }
        },
        data: {
          status: StaffStatus.INACTIVE,
          currentWorkStatus: StaffWorkStatus.AVAILABLE,
          activeAppointmentId: null,
          isBookable: false
        }
      });
      await tx.user.updateMany({
        where: {
          salonId: salon.id,
          role: Role.STAFF,
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
              notIn: canonicalIds
            }
          }
        ]
      },
      data: {
        isActive: false
      }
    });

    const fullSetServices = await tx.service.findMany({
      where: {
        salonId: salon.id,
        OR: [
          {
            name: {
              equals: "Full Set",
              mode: "insensitive"
            }
          },
          {
            name: {
              equals: LEGACY_FULL_SET_NAME,
              mode: "insensitive"
            }
          }
        ]
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    if (fullSetServices.length) {
      const target =
        fullSetServices.find((service) => service.name.toLowerCase() === "full set") ??
        fullSetServices[0];
      await tx.service.update({
        where: {
          id: target.id
        },
        data: {
          name: "Full Set",
          isActive: true
        }
      });

      for (const duplicate of fullSetServices.filter((service) => service.id !== target.id)) {
        await tx.appointment.updateMany({
          where: {
            serviceId: duplicate.id
          },
          data: {
            serviceId: target.id
          }
        });

        const appointmentServices = await tx.appointmentService.findMany({
          where: {
            serviceId: duplicate.id
          },
          select: {
            id: true,
            appointmentId: true
          }
        });
        for (const appointmentService of appointmentServices) {
          const existingTarget = await tx.appointmentService.findUnique({
            where: {
              appointmentId_serviceId: {
                appointmentId: appointmentService.appointmentId,
                serviceId: target.id
              }
            }
          });
          if (existingTarget) {
            await tx.appointmentService.delete({
              where: {
                id: appointmentService.id
              }
            });
          } else {
            await tx.appointmentService.update({
              where: {
                id: appointmentService.id
              },
              data: {
                serviceId: target.id
              }
            });
          }
        }

        const staffMappings = await tx.staffService.findMany({
          where: {
            serviceId: duplicate.id
          },
          select: {
            salonId: true,
            staffId: true
          }
        });
        if (staffMappings.length) {
          await tx.staffService.createMany({
            data: staffMappings.map((mapping) => ({
              salonId: mapping.salonId,
              staffId: mapping.staffId,
              serviceId: target.id
            })),
            skipDuplicates: true
          });
        }
        await tx.staffService.deleteMany({
          where: {
            serviceId: duplicate.id
          }
        });
        await tx.service.delete({
          where: {
            id: duplicate.id
          }
        });
      }
    }

    const activeStaff = await tx.staff.findMany({
      where: {
        salonId: salon.id,
        status: StaffStatus.ACTIVE
      },
      select: {
        fullName: true
      },
      orderBy: {
        createdAt: "asc"
      }
    });
    const activeNames = new Set(activeStaff.map((item) => item.fullName));
    const expectedNames = canonicalStaff.map((item) => item.fullName);
    if (
      activeStaff.length !== expectedNames.length ||
      expectedNames.some((name) => !activeNames.has(name))
    ) {
      throw new Error(
        `Demo cleanup verification failed. Active staff: ${activeStaff
          .map((item) => item.fullName)
          .join(", ")}`
      );
    }

    return {
      activeStaff: expectedNames,
      deactivatedStaff: extraStaff.map((item) => item.fullName)
    };
  });

  console.log(
    JSON.stringify({
      salon: salon.name,
      activeStaff: result.activeStaff,
      deactivatedStaffCount: result.deactivatedStaff.length
    })
  );
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
