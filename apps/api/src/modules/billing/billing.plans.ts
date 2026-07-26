import { env } from "../../config/env";
import { AppError } from "../../lib/errors";

export const BILLING_PLAN_CODES = ["ai_reception", "human_reception"] as const;
export const BILLING_TRIAL_DAYS = 30;

export type BillingPlanCode = (typeof BILLING_PLAN_CODES)[number];

export interface BillingPlan {
  code: BillingPlanCode;
  name: string;
  monthlyPriceCents: number;
  trialDays: number;
  stripePriceId: string | null;
  phoneRouting: "ai";
  operatorTransferIncluded: boolean;
}

export const isBillingPlanCode = (value: string): value is BillingPlanCode =>
  BILLING_PLAN_CODES.includes(value as BillingPlanCode);

export const getBillingPlans = (): BillingPlan[] => [
  {
    code: "ai_reception",
    name: "AI Reception",
    monthlyPriceCents: 8_900,
    trialDays: BILLING_TRIAL_DAYS,
    stripePriceId: env.STRIPE_PRICE_ID_AI_RECEPTION ?? null,
    phoneRouting: "ai",
    operatorTransferIncluded: false
  },
  {
    code: "human_reception",
    name: "AI + Live Operator",
    monthlyPriceCents: 49_900,
    trialDays: BILLING_TRIAL_DAYS,
    stripePriceId: env.STRIPE_PRICE_ID_HUMAN_RECEPTION ?? null,
    phoneRouting: "ai",
    operatorTransferIncluded: true
  }
];

export const getBillingPlan = (code: BillingPlanCode): BillingPlan => {
  const plan = getBillingPlans().find((item) => item.code === code);
  if (!plan) {
    throw new AppError("Billing plan is not supported.", 400, "BILLING_PLAN_INVALID");
  }
  return plan;
};

export const requireStripePriceId = (code: BillingPlanCode): string => {
  const plan = getBillingPlan(code);
  if (!plan.stripePriceId) {
    throw new AppError(
      "Registration billing is not configured yet.",
      503,
      "STRIPE_REGISTRATION_NOT_CONFIGURED"
    );
  }
  return plan.stripePriceId;
};

export const hasOperatorTransferEntitlement = (
  planCode: string | null | undefined,
  subscriptionStatus: string | null | undefined
): boolean =>
  Boolean(
    planCode &&
      isBillingPlanCode(planCode) &&
      getBillingPlan(planCode).operatorTransferIncluded &&
      (subscriptionStatus === "TRIAL" || subscriptionStatus === "ACTIVE")
  );
