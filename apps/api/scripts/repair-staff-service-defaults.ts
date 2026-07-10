import { prisma } from "../src/db/prisma";
import { repairStaffServiceDefaultsForSalon } from "../src/modules/staff/staff-defaults";

const readArg = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return process.argv[index + 1];
};

const main = async () => {
  const salonId = readArg("--salon-id");
  const dryRun = !process.argv.includes("--apply");

  if (!salonId) {
    throw new Error("Usage: tsx scripts/repair-staff-service-defaults.ts --salon-id <uuid> [--apply]");
  }

  const salon = await prisma.salon.findUnique({
    where: {
      id: salonId
    },
    select: {
      id: true,
      name: true
    }
  });
  if (!salon) {
    throw new Error(`Salon not found: ${salonId}`);
  }

  const result = await repairStaffServiceDefaultsForSalon(salon.id, { dryRun });
  console.log(
    JSON.stringify(
      {
        salon,
        ...result
      },
      null,
      2
    )
  );
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
