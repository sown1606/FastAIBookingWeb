import { Prisma, PrismaClient, StaffStatus } from "@prisma/client";
import { env } from "../../config/env";
import { prisma } from "../../db/prisma";
import { getCurrentBillingPeriod } from "../../utils/date";

type PrismaExecutor = PrismaClient | Prisma.TransactionClient;

export interface StaffBillingUsage {
  freeStaffLimit: number;
  activeStaffCount: number;
  includedStaffCount: number;
  billableExtraStaffCount: number;
  extraStaffUnitPriceCents: number;
  estimatedExtraCostCents: number;
}

export const calculateStaffBillingUsage = (activeStaffCount: number): StaffBillingUsage => {
  const freeStaffLimit = env.FREE_STAFF_LIMIT;
  const extraStaffUnitPriceCents = Math.round(env.EXTRA_STAFF_PRICE * 100);
  const includedStaffCount = Math.min(activeStaffCount, freeStaffLimit);
  const billableExtraStaffCount = Math.max(activeStaffCount - freeStaffLimit, 0);
  const estimatedExtraCostCents = billableExtraStaffCount * extraStaffUnitPriceCents;

  return {
    freeStaffLimit,
    activeStaffCount,
    includedStaffCount,
    billableExtraStaffCount,
    extraStaffUnitPriceCents,
    estimatedExtraCostCents
  };
};

export const refreshBillingUsageForSalon = async (
  salonId: string,
  executor: PrismaExecutor = prisma
): Promise<StaffBillingUsage & { periodStart: Date; periodEnd: Date }> => {
  const activeStaffCount = await executor.staff.count({
    where: {
      salonId,
      status: StaffStatus.ACTIVE
    }
  });

  const usage = calculateStaffBillingUsage(activeStaffCount);
  const { periodStart, periodEnd } = getCurrentBillingPeriod();

  await executor.billingUsage.upsert({
    where: {
      salonId_periodStart_periodEnd: {
        salonId,
        periodStart,
        periodEnd
      }
    },
    create: {
      salonId,
      periodStart,
      periodEnd,
      freeStaffLimit: usage.freeStaffLimit,
      activeStaffCount: usage.activeStaffCount,
      includedStaffCount: usage.includedStaffCount,
      billableExtraStaffCount: usage.billableExtraStaffCount,
      extraStaffUnitPriceCents: usage.extraStaffUnitPriceCents,
      estimatedExtraCostCents: usage.estimatedExtraCostCents
    },
    update: {
      freeStaffLimit: usage.freeStaffLimit,
      activeStaffCount: usage.activeStaffCount,
      includedStaffCount: usage.includedStaffCount,
      billableExtraStaffCount: usage.billableExtraStaffCount,
      extraStaffUnitPriceCents: usage.extraStaffUnitPriceCents,
      estimatedExtraCostCents: usage.estimatedExtraCostCents
    }
  });

  return {
    ...usage,
    periodStart,
    periodEnd
  };
};

export const getCurrentBillingUsageForSalon = async (
  salonId: string
): Promise<StaffBillingUsage & { periodStart: Date; periodEnd: Date }> => {
  return refreshBillingUsageForSalon(salonId, prisma);
};

export const getBillingUsageHistoryForSalon = async (
  salonId: string,
  take = 6
): Promise<
  Array<{
    periodStart: Date;
    periodEnd: Date;
    freeStaffLimit: number;
    activeStaffCount: number;
    includedStaffCount: number;
    billableExtraStaffCount: number;
    extraStaffUnitPriceCents: number;
    estimatedExtraCostCents: number;
  }>
> => {
  return prisma.billingUsage.findMany({
    where: { salonId },
    orderBy: { periodStart: "desc" },
    take
  });
};
