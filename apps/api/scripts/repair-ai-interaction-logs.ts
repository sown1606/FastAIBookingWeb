import { ExternalProvider, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dryRun = !process.argv.includes("--apply");
const taskType = "amazon_connect_booking_fulfillment";

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const readContactId = (log: {
  requestPayload: unknown;
  callSession?: { providerCallId: string } | null;
  callSessionId: string | null;
}) => {
  const requestPayload = asRecord(log.requestPayload);
  const attributes = asRecord(requestPayload.attributes);
  return String(
    log.callSession?.providerCallId ??
      log.callSessionId ??
      requestPayload.amazonConnectContactId ??
      requestPayload.contactId ??
      attributes.AmazonConnectContactId ??
      attributes.contactId ??
      ""
  ).trim();
};

const turnKey = (turn: unknown): string => {
  const record = asRecord(turn);
  return String(
    record.idempotencyKey ??
      [
        record.currentTurnTranscript,
        record.lastAskedSlotBefore,
        record.lastAskedSlotAfter,
        record.activeDtmfMenuBefore,
        record.slotToElicit
      ].join("|")
  );
};

const turnTime = (turn: unknown, fallback: Date): number => {
  const value = asRecord(turn).createdAt;
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback.getTime();
};

const buildTurnFromLog = (log: {
  id: string;
  createdAt: Date;
  requestText: string | null;
  requestPayload: unknown;
  responseText: string | null;
  responsePayload: unknown;
}) => {
  const requestPayload = asRecord(log.requestPayload);
  const responsePayload = asRecord(log.responsePayload);
  return {
    idempotencyKey: `legacy-row:${log.id}`,
    createdAt: log.createdAt.toISOString(),
    currentTurnTranscript: log.requestText ?? null,
    responseText: log.responseText ?? null,
    requestPayload,
    responsePayload,
    lastAskedSlotBefore: asRecord(requestPayload.sessionAttributes).lastAskedSlot ?? null,
    lastAskedSlotAfter: asRecord(responsePayload.sessionAttributes).lastAskedSlot ?? null,
    activeDtmfMenuBefore: asRecord(requestPayload.sessionAttributes).activeDtmfMenu ?? null,
    slotToElicit: asRecord(asRecord(responsePayload.sessionState).dialogAction).slotToElicit ?? null
  };
};

const main = async () => {
  const logs = await prisma.aiInteractionLog.findMany({
    where: {
      provider: ExternalProvider.AMAZON_CONNECT,
      taskType
    },
    orderBy: {
      createdAt: "asc"
    },
    include: {
      callSession: {
        select: {
          providerCallId: true
        }
      }
    }
  });

  const groups = new Map<string, typeof logs>();
  for (const log of logs) {
    const contactId = readContactId(log);
    if (!contactId) {
      continue;
    }
    const key = `AMAZON_CONNECT:${taskType}:${contactId}`;
    groups.set(key, [...(groups.get(key) ?? []), log]);
  }

  const duplicateGroups = Array.from(groups.entries()).filter(([, group]) => group.length > 1);
  let duplicateRows = 0;
  let syntheticRows = 0;

  for (const [key, group] of groups) {
    const synthetic = /^AMAZON_CONNECT:amazon_connect_booking_fulfillment:codex-/i.test(key);
    if (synthetic) {
      syntheticRows += group.length;
    }
    if (!dryRun) {
      await prisma.aiInteractionLog.updateMany({
        where: {
          id: {
            in: group.map((log) => log.id)
          }
        },
        data: {
          interactionKey: group.length === 1 ? key : undefined,
          isSynthetic: synthetic
        }
      });
    }
  }

  for (const [key, group] of duplicateGroups) {
    duplicateRows += group.length - 1;
    const [canonical] = group;
    const latest = [...group].sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
    const byTurnKey = new Map<string, unknown>();
    for (const log of group) {
      const existingTurns = asArray(asRecord(log.responsePayload).turnHistory);
      const turns = existingTurns.length > 0 ? existingTurns : [buildTurnFromLog(log)];
      for (const turn of turns) {
        const key = turnKey(turn);
        if (!byTurnKey.has(key)) {
          byTurnKey.set(key, turn);
        }
      }
    }
    const turnHistory = Array.from(byTurnKey.values())
      .sort((left, right) => turnTime(left, canonical.createdAt) - turnTime(right, canonical.createdAt))
      .map((turn, index) => ({
        ...asRecord(turn),
        index: index + 1
      }));
    const responsePayload = {
      ...asRecord(latest.responsePayload),
      turnHistory,
      turnCount: turnHistory.length,
      latestTurn: turnHistory[turnHistory.length - 1] ?? null
    };

    if (!dryRun) {
      await prisma.$transaction(async (tx) => {
        await tx.aiInteractionLog.update({
          where: {
            id: canonical.id
          },
          data: {
            interactionKey: key,
            requestText: latest.requestText,
            requestPayload: latest.requestPayload ?? undefined,
            responseText: latest.responseText,
            responsePayload,
            parsedOutput: latest.parsedOutput ?? undefined,
            isValid: latest.isValid,
            validationErrors: latest.validationErrors ?? undefined,
            confidence: latest.confidence,
            transcriptId: latest.transcriptId,
            bookingAttemptId: latest.bookingAttemptId,
            createdByUserId: latest.createdByUserId,
            isSynthetic: /^AMAZON_CONNECT:amazon_connect_booking_fulfillment:codex-/i.test(key)
          }
        });
        await tx.aiInteractionLog.deleteMany({
          where: {
            id: {
              in: group.slice(1).map((log) => log.id)
            }
          }
        });
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        totalAmazonConnectBookingLogs: logs.length,
        duplicateGroups: duplicateGroups.length,
        duplicateRows,
        syntheticRows,
        action: dryRun ? "report_only" : "merged_and_deleted_duplicates"
      },
      null,
      2
    )
  );
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
