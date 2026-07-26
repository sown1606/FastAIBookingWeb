import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { SubscriptionStatus } from "@prisma/client";
import {
  BILLING_PLAN_CODES,
  getBillingPlan,
  getBillingPlans
} from "../src/modules/billing/billing.plans";
import { mapStripeSubscriptionStatus } from "../src/modules/billing/stripe-billing.service";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const readRepoFile = (relativePath: string) =>
  readFileSync(resolve(repoRoot, relativePath), "utf8");

test("public plans use the approved monthly prices and 30-day default trial", () => {
  assert.deepEqual(BILLING_PLAN_CODES, ["ai_reception", "human_reception"]);
  const plans = getBillingPlans();
  assert.equal(plans.length, 2);
  assert.equal(getBillingPlan("ai_reception").monthlyPriceCents, 8_900);
  assert.equal(getBillingPlan("human_reception").monthlyPriceCents, 49_900);
  assert.equal(getBillingPlan("ai_reception").trialDays, 30);
  assert.equal(getBillingPlan("human_reception").trialDays, 30);
  assert.equal(getBillingPlan("ai_reception").phoneRouting, "ai");
  assert.equal(getBillingPlan("human_reception").phoneRouting, "human");
});

test("Stripe subscription states map to salon access states", () => {
  assert.equal(mapStripeSubscriptionStatus("trialing"), SubscriptionStatus.TRIAL);
  assert.equal(mapStripeSubscriptionStatus("active"), SubscriptionStatus.ACTIVE);
  assert.equal(mapStripeSubscriptionStatus("past_due"), SubscriptionStatus.PAST_DUE);
  assert.equal(mapStripeSubscriptionStatus("unpaid"), SubscriptionStatus.PAST_DUE);
  assert.equal(mapStripeSubscriptionStatus("canceled"), SubscriptionStatus.CANCELED);
});

test("registration source requires a succeeded Visa SetupIntent and explicit consent", () => {
  const stripeSource = readRepoFile(
    "apps/api/src/modules/billing/stripe-billing.service.ts"
  );
  const registrationSource = readRepoFile("apps/app/src/auth/register-page.tsx");
  const authSchemaSource = readRepoFile("apps/api/src/modules/auth/auth.routes.ts");

  assert.match(stripeSource, /setupIntent\.status !== "succeeded"/);
  assert.match(stripeSource, /paymentMethod\.card\.brand !== "visa"/);
  assert.match(stripeSource, /trial_period_days: plan\.trialDays/);
  assert.match(stripeSource, /missing_payment_method: "cancel"/);
  assert.match(stripeSource, /stripePrice\.unit_amount !== plan\.monthlyPriceCents/);
  assert.match(stripeSource, /stripePrice\.recurring\?\.interval !== "month"/);
  assert.match(registrationSource, /<PaymentElement/);
  assert.match(registrationSource, /billingConsent/);
  assert.match(registrationSource, /billingConsentAccepted: true/);
  assert.match(registrationSource, /disabled=\{!stripe \|\| !elements \|\| !consented \|\| submitting\}/);
  assert.match(authSchemaSource, /planCode: z\.enum\(BILLING_PLAN_CODES\)/);
  assert.match(authSchemaSource, /setupIntentId:/);
  assert.match(authSchemaSource, /billingConsentAccepted: z\.literal\(true\)/);
});

test("public SetupIntent creation is rate limited", () => {
  const routesSource = readRepoFile("apps/api/src/modules/billing/billing.routes.ts");

  assert.match(routesSource, /registrationSetupIntentRateLimit/);
  assert.match(routesSource, /windowMs: 15 \* 60 \* 1000/);
  assert.match(routesSource, /limit: 10/);
  assert.match(routesSource, /REGISTRATION_RATE_LIMITED/);
});

test("phone provisioning is idempotent and attaches plan-specific Connect flows", () => {
  const source = readRepoFile(
    "apps/api/src/modules/billing/phone-provisioning.service.ts"
  );
  const routesSource = readRepoFile("apps/api/src/modules/billing/billing.routes.ts");

  assert.match(source, /ClaimPhoneNumberCommand/);
  assert.match(source, /ClientToken: provisioning\.claimClientToken/);
  assert.match(source, /AssociatePhoneNumberContactFlowCommand/);
  assert.match(source, /AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION/);
  assert.match(source, /AMAZON_CONNECT_CONTACT_FLOW_ID_HUMAN_ESCALATION/);
  assert.match(source, /PhoneProvisioningStatus\.ACTIVE/);
  assert.match(source, /customerIncomingPhoneNumber: input\.phoneNumber/);
  assert.match(source, /skipDuplicates: true/);
  assert.match(
    routesSource,
    /getPhoneProvisioningForSalon\(salonId, true\)/,
    "Billing should reconcile an asynchronous AWS claim automatically"
  );
});

test("real-person registration requires and assigns active call-center staff", () => {
  const stripeSource = readRepoFile(
    "apps/api/src/modules/billing/stripe-billing.service.ts"
  );
  const authSource = readRepoFile("apps/api/src/modules/auth/auth.service.ts");

  assert.match(stripeSource, /HUMAN_RECEPTION_NOT_STAFFED/);
  assert.match(stripeSource, /role: Role\.CALL_CENTER_AGENT/);
  assert.match(authSource, /tx\.callCenterSalonAssignment\.createMany/);
  assert.match(authSource, /assignedHumanAgentCount/);
});

test("Stripe webhook is mounted on a raw body before the JSON parser", () => {
  const appSource = readRepoFile("apps/api/src/app.ts");
  const rawBodyIndex = appSource.indexOf('express.raw({ type: "application/json"');
  const jsonBodyIndex = appSource.indexOf("express.json({");

  assert.ok(rawBodyIndex > 0);
  assert.ok(jsonBodyIndex > rawBodyIndex);
});
