import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../db/prisma";

interface AuditInput {
  salonId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: unknown;
}

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

export const createAuditLog = async (
  input: AuditInput,
  executor: PrismaExecutor = prisma
): Promise<void> => {
  await executor.auditLog.create({
    data: {
      salonId: input.salonId ?? null,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      metadata:
        input.metadata === undefined ? undefined : (input.metadata as Prisma.InputJsonValue)
    }
  });
};
