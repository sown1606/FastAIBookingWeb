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
  assert.equal(getBillingPlan("human_reception").phoneRouting, "ai");
  assert.equal(getBillingPlan("ai_reception").operatorTransferIncluded, false);
  assert.equal(getBillingPlan("human_reception").operatorTransferIncluded, true);
});

test("Stripe subscription states map to salon access states", () => {
  assert.equal(mapStripeSubscriptionStatus("trialing"), SubscriptionStatus.TRIAL);
  assert.equal(mapStripeSubscriptionStatus("active"), SubscriptionStatus.ACTIVE);
  assert.equal(mapStripeSubscriptionStatus("past_due"), SubscriptionStatus.PAST_DUE);
  assert.equal(mapStripeSubscriptionStatus("unpaid"), SubscriptionStatus.PAST_DUE);
  assert.equal(mapStripeSubscriptionStatus("canceled"), SubscriptionStatus.CANCELED);
});

test("registration supports either deferred billing or a verified Visa SetupIntent", () => {
  const stripeSource = readRepoFile(
    "apps/api/src/modules/billing/stripe-billing.service.ts"
  );
  const registrationSource = readRepoFile("apps/app/src/auth/register-page.tsx");
  const authSchemaSource = readRepoFile("apps/api/src/modules/auth/auth.routes.ts");
  const authServiceSource = readRepoFile("apps/api/src/modules/auth/auth.service.ts");
  const billingPageSource = readRepoFile("apps/app/src/pages/billing-page.tsx");

  assert.match(stripeSource, /setupIntent\.status !== "succeeded"/);
  assert.match(stripeSource, /paymentMethod\.card\.brand !== "visa"/);
  assert.match(stripeSource, /trial_period_days: plan\.trialDays/);
  assert.match(stripeSource, /missing_payment_method: "cancel"/);
  assert.match(stripeSource, /stripePrice\.unit_amount !== plan\.monthlyPriceCents/);
  assert.match(stripeSource, /stripePrice\.recurring\?\.interval !== "month"/);
  assert.match(registrationSource, /<PaymentElement/);
  assert.match(registrationSource, /billingConsent/);
  assert.match(registrationSource, /billingConsentAccepted: true/);
  assert.match(registrationSource, /value="skip-card"/);
  assert.match(registrationSource, /value="card"/);
  assert.match(authSchemaSource, /planCode: z\.enum\(BILLING_PLAN_CODES\)/);
  assert.match(authSchemaSource, /setupIntentId:.*\.optional\(\)/);
  assert.match(authSchemaSource, /billingConsentAccepted: z\.literal\(true\)\.optional\(\)/);
  assert.match(
    authSchemaSource,
    /Boolean\(value\.setupIntentId\) !== Boolean\(value\.billingConsentAccepted\)/
  );
  assert.match(authServiceSource, /SubscriptionStatus\.PENDING_PAYMENT/);
  assert.match(authServiceSource, /Add a Visa card securely from Billing when you are ready/);
  assert.match(billingPageSource, /subscription\.status === "PENDING_PAYMENT"/);
  assert.match(billingPageSource, /\/api\/v1\/billing\/payment-method\/setup-intent/);
  assert.match(billingPageSource, /\/api\/v1\/billing\/payment-method\/activate/);
});

test("unauthenticated signup exposes callback and guided registration paths", () => {
  const routesSource = readRepoFile("apps/api/src/modules/auth/auth.routes.ts");
  const registrationServiceSource = readRepoFile(
    "apps/api/src/modules/registration/registration.service.ts"
  );
  const registrationPageSource = readRepoFile("apps/app/src/auth/register-page.tsx");
  const assistantSource = readRepoFile(
    "apps/app/src/auth/registration-assistant.tsx"
  );
  const adminRoutesSource = readRepoFile("apps/api/src/modules/admin/admin.routes.ts");

  assert.match(routesSource, /"\/registration-callback"/);
  assert.match(routesSource, /"\/registration-assistant"/);
  assert.match(routesSource, /publicRegistrationRateLimit/);
  assert.match(registrationServiceSource, /prisma\.registrationLead\.create/);
  assert.match(registrationServiceSource, /VertexAIProvider/);
  assert.match(registrationPageSource, /\/api\/v1\/auth\/registration-callback/);
  assert.match(registrationPageSource, /<RegistrationAssistant/);
  assert.match(assistantSource, /\/api\/v1\/auth\/registration-assistant/);
  assert.match(adminRoutesSource, /"\/registration-leads"/);
  assert.match(adminRoutesSource, /"\/registration-leads\/:id"/);
});

test("public SetupIntent creation is rate limited", () => {
  const routesSource = readRepoFile("apps/api/src/modules/billing/billing.routes.ts");
  const appSource = readRepoFile("apps/api/src/app.ts");

  assert.match(routesSource, /registrationSetupIntentRateLimit/);
  assert.match(routesSource, /windowMs: 15 \* 60 \* 1000/);
  assert.match(routesSource, /limit: 10/);
  assert.match(routesSource, /REGISTRATION_RATE_LIMITED/);
  assert.match(appSource, /app\.set\("trust proxy", 1\)/);
});

test("phone provisioning is idempotent and always attaches the shared AI Connect flow", () => {
  const source = readRepoFile(
    "apps/api/src/modules/billing/phone-provisioning.service.ts"
  );
  const routesSource = readRepoFile("apps/api/src/modules/billing/billing.routes.ts");

  assert.match(source, /ClaimPhoneNumberCommand/);
  assert.match(source, /ClientToken: provisioning\.claimClientToken/);
  assert.match(source, /AssociatePhoneNumberContactFlowCommand/);
  assert.match(source, /AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION/);
  assert.doesNotMatch(source, /AMAZON_CONNECT_CONTACT_FLOW_ID_HUMAN_ESCALATION/);
  assert.match(source, /PhoneProvisioningStatus\.ACTIVE/);
  assert.match(source, /customerIncomingPhoneNumber: input\.phoneNumber/);
  assert.match(source, /callCenterEnabled: plan\.operatorTransferIncluded/);
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
  assert.match(authSource, /if \(stripeRegistration && plan\.operatorTransferIncluded\)/);
});

test("appointment reminders are configurable and processed outside booking requests", () => {
  const schemaSource = readRepoFile("apps/api/prisma/schema.prisma");
  const appointmentsSource = readRepoFile(
    "apps/api/src/modules/appointments/appointments.service.ts"
  );
  const salonRoutesSource = readRepoFile("apps/api/src/modules/salon/salon.routes.ts");
  const salonServiceSource = readRepoFile("apps/api/src/modules/salon/salon.service.ts");
  const workerSource = readRepoFile(
    "apps/api/src/modules/appointments/reminder-worker.ts"
  );
  const serverSource = readRepoFile("apps/api/src/server.ts");

  assert.match(schemaSource, /appointmentReminderMinutes\s+Int\s+@default\(60\)/);
  assert.match(schemaSource, /ownerUpcomingReminderEnabled\s+Boolean\s+@default\(true\)/);
  assert.match(salonRoutesSource, /z\.literal\(60\)/);
  assert.match(salonRoutesSource, /z\.literal\(120\)/);
  assert.match(salonRoutesSource, /z\.literal\(180\)/);
  assert.match(appointmentsSource, /settings\?\.appointmentReminderMinutes \?\? 60/);
  assert.match(appointmentsSource, /reminderType: "BEFORE_BOOKING"/);
  assert.match(salonServiceSource, /reschedulePendingAppointmentReminders/);
  assert.match(workerSource, /ownerUpcomingReminderEnabled \?\? true/);
  assert.match(workerSource, /reminderType: "BEFORE_BOOKING"/);
  assert.match(workerSource, /startTime: \{ gt: now \}/);
  assert.match(workerSource, /sendPushToAssignedStaff/);
  assert.match(workerSource, /sendPushToSalonOwner/);
  assert.match(workerSource, /deliveredAt: null/);
  assert.match(serverSource, /startAppointmentReminderWorker/);
});

test("operator transfer is subscription-gated and new salons receive a Lex-ready service catalog", () => {
  const salonSource = readRepoFile("apps/api/src/modules/salon/salon.service.ts");
  const callCenterSource = readRepoFile(
    "apps/api/src/modules/call-center/call-center.service.ts"
  );
  const authSource = readRepoFile("apps/api/src/modules/auth/auth.service.ts");

  assert.match(salonSource, /hasOperatorTransferEntitlement/);
  assert.match(salonSource, /OPERATOR_PLAN_REQUIRED/);
  assert.match(callCenterSource, /OPERATOR_NOT_INCLUDED/);
  for (const serviceName of [
    "Manicure",
    "Pedicure",
    "Gel Manicure",
    "Full Set",
    "Dip Powder",
    "Other Services"
  ]) {
    assert.match(authSource, new RegExp(`name: "${serviceName}"`));
  }
  assert.match(authSource, /await createDefaultServices\(salon\.id, tx\)/);
});

test("owner forwarding setup supports major US carriers and only verifies observed calls", () => {
  const forwardingSource = readRepoFile(
    "apps/api/src/modules/ai-reception/ai-reception.service.ts"
  );
  const ownerRoutes = readRepoFile("apps/api/src/modules/owner/owner.routes.ts");

  assert.match(forwardingSource, /"tmobile"/);
  assert.match(forwardingSource, /"att"/);
  assert.match(forwardingSource, /"verizon"/);
  assert.match(forwardingSource, /"uscellular"/);
  assert.match(forwardingSource, /recentInboundCall/);
  assert.match(forwardingSource, /AI_RECEPTION_FORWARDING_TEST_REQUESTED/);
  assert.match(ownerRoutes, /z\.enum\(AI_RECEPTION_CARRIERS\)/);
});

test("Stripe webhook is mounted on a raw body before the JSON parser", () => {
  const appSource = readRepoFile("apps/api/src/app.ts");
  const rawBodyIndex = appSource.indexOf('express.raw({ type: "application/json"');
  const jsonBodyIndex = appSource.indexOf("express.json({");

  assert.ok(rawBodyIndex > 0);
  assert.ok(jsonBodyIndex > rawBodyIndex);
});
