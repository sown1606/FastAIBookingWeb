import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const dryRun = !process.argv.includes("--apply");

const main = async () => {
  const customers = await prisma.customer.findMany({
    where: {
      lastName: "Unknown"
    },
    select: {
      id: true,
      salonId: true,
      firstName: true,
      lastName: true,
      phone: true,
      createdAt: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  if (!dryRun && customers.length > 0) {
    await prisma.customer.updateMany({
      where: {
        lastName: "Unknown"
      },
      data: {
        lastName: ""
      }
    });
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        matchedCount: customers.length,
        updatedCount: dryRun ? 0 : customers.length,
        customers
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
