const startOfMonthUtc = (date: Date): Date => {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
};

const endOfMonthUtc = (date: Date): Date => {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
};

export const getCurrentBillingPeriod = (referenceDate: Date = new Date()): {
  periodStart: Date;
  periodEnd: Date;
} => {
  return {
    periodStart: startOfMonthUtc(referenceDate),
    periodEnd: endOfMonthUtc(referenceDate)
  };
};
