import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const hasArg = (name: string) => process.argv.includes(name);
const readArg = (name: string): string | undefined => {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const technicalPatterns = [
  "Created by Amazon Connect AI Booking.",
  "Source: amazon_connect_ai",
  "Amazon Connect contact: <contact-id>"
];

const technicalNoteLinePatterns = [
  /^Created by Amazon Connect AI Booking\.$/i,
  /^Source:\s*amazon_connect_ai$/i,
  /^Amazon Connect contact:\s*.+$/i
];

const removeTechnicalAppointmentNoteLines = (notes: string | null | undefined): string | null => {
  if (!notes) {
    return notes ?? null;
  }
  const businessLines = notes
    .split(/\r?\n/)
    .filter((line) => !technicalNoteLinePatterns.some((pattern) => pattern.test(line.trim())));
  const cleaned = businessLines.join("\n").trim();
  return cleaned || null;
};

const main = async () => {
  const dryRun = hasArg("--dry-run") || !hasArg("--apply");
  const salonId = readArg("--salon-id");

  const appointments = await prisma.appointment.findMany({
    where: {
      ...(salonId ? { salonId } : {}),
      notes: {
        not: null
      }
    },
    select: {
      id: true,
      salonId: true,
      notes: true
    },
    orderBy: {
      createdAt: "asc"
    }
  });

  const changed = appointments
    .map((appointment) => ({
      ...appointment,
      cleanedNotes: removeTechnicalAppointmentNoteLines(appointment.notes)
    }))
    .filter((appointment) => appointment.cleanedNotes !== appointment.notes);

  if (!dryRun && changed.length > 0) {
    await prisma.$transaction(
      changed.map((appointment) =>
        prisma.appointment.update({
          where: {
            id: appointment.id
          },
          data: {
            notes: appointment.cleanedNotes
          }
        })
      )
    );
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        salonId: salonId ?? null,
        rowsInspected: appointments.length,
        rowsChanged: changed.length,
        patternsRemoved: technicalPatterns,
        businessNoteCharactersRemoved: 0,
        changedAppointmentIds: changed.map((appointment) => appointment.id)
      },
      null,
      2
    )
  );
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
