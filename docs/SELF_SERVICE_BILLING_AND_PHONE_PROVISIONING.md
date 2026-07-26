# Self-service billing and Amazon Connect phone provisioning

## Customer contract

- A Visa card is required before a salon owner account can be created.
- The trial lasts exactly 30 days and does not charge the card at signup.
- `ai_reception` renews monthly at **$89 USD**.
- `human_reception` is the internal code for **AI + Live Operator** and renews
  monthly at **$499 USD**.
- Registration is fail-closed until Stripe and Amazon Connect are fully configured.
- The salon remains `PENDING` until its Amazon Connect number is claimed and attached to the selected plan's flow. Successful phone configuration moves it to `ACTIVE`.

Only Stripe identifiers, card brand, and last four digits are stored. Raw card data never reaches this API.

## Stripe setup

Create two active recurring Prices in Stripe:

1. AI Reception: USD 89.00, recurring every month.
2. AI + Live Operator: USD 499.00, recurring every month.

The dedicated FastAIBooking Stripe account was created in test mode on
2026-07-26:

- Account: `acct_1TxQUlLviryo7Mdv`
- AI Reception product: `prod_UxLF0LgxCED3IK`
- AI Reception monthly test price: `price_1TxQYnLviryo7MdvCnTkjuwW`
- AI + Live Operator product: `prod_UxLFQK91SwDwvN`
- AI + Live Operator monthly test price: `price_1TxQZ5Lviryo7Mdvls8Fxvt6`
- Subscription webhook destination: `we_1TxQxNLviryo7MdvwKT4sBOO`

These identifiers are test-mode only. Do not put them into the production
environment. Complete Stripe business verification, recreate/confirm the same
catalog in live mode, and use the live Price IDs and live API keys for launch.

The backend retrieves the selected Price before creating a subscription and rejects the configuration unless currency, amount, interval, and active state match this contract.

Set:

```dotenv
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID_AI_RECEPTION=
STRIPE_PRICE_ID_HUMAN_RECEPTION=
REGISTRATION_ATTEMPT_TTL_MINUTES=120
```

Create a Stripe webhook for:

```text
POST https://<api-host>/api/v1/billing/stripe/webhook
```

Subscribe it to:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

The endpoint verifies the Stripe signature against the raw request body before changing local subscription state.

## Amazon Connect setup

Set:

```dotenv
AWS_REGION=us-east-1
AMAZON_CONNECT_INSTANCE_ID=
AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION=
AMAZON_CONNECT_CONTACT_FLOW_ID_HUMAN_ESCALATION=
AMAZON_CONNECT_PROVISION_PHONE_COUNTRY_CODE=US
AMAZON_CONNECT_PROVISION_PHONE_TYPE=DID
AMAZON_CONNECT_PHONE_CLAIM_WAIT_MS=12000
```

The runtime AWS principal needs narrowly scoped permission for:

- `connect:SearchAvailablePhoneNumbers`
- `connect:ClaimPhoneNumber`
- `connect:DescribePhoneNumber`
- `connect:AssociatePhoneNumberContactFlow`
- the tagging permissions required by `ClaimPhoneNumber` when tags are supplied

Provisioning first searches the salon's area code, falls back to any available US number, claims it with a persistent client token, waits for `CLAIMED`, and associates both subscriptions with:

- `$89` plan -> `AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION`
- `$499` plan -> `AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION`

The shared AI flow invokes the published Lex bot and booking Lambda. The `$499`
entitlement additionally enables the existing press-0 human-escalation branch,
queue, and operator assignments. The `$89` plan explicitly stores
`callCenterEnabled=false`; owner settings, routing, and escalation services all
re-check the active subscription before allowing a queue transfer.

The `$499` plan is offered only while at least one active call-center agent
exists. Registration assigns every active call-center agent to the new salon so
the operator workspace and notifications are usable immediately; admins can
narrow those assignments afterward.

The E.164 number is then stored as the salon's incoming number and as Amazon
Connect integration routing data. Failed or still-in-progress claims can be
safely reconciled from Billing without creating a second Stripe subscription.
New registrations also receive the six editable starter services used by the
Lex menu. When the owner adds an active/bookable staff member, the existing
staff-default mapping assigns those services automatically.

Phone claiming proves only that AWS is ready. Carrier forwarding remains
`PENDING` until a real inbound Amazon Connect call is observed. The owner profile
contains current T-Mobile, Verizon, AT&T, UScellular, and Other/MVNO guidance,
plus readiness and test-call status.

## Release checklist

1. Apply Prisma migration `202607260001_trial_billing_and_phone_provisioning`.
2. Apply migration `202607260002_backfill_service_plan_entitlements` so
   explicitly enabled legacy operator salons retain that entitlement.
3. Configure and verify both Stripe Prices and the signed webhook.
4. Configure the published AI Connect flow ID and the human-escalation/queue
   resources used only by entitled `$499` salons.
5. Grant the runtime principal the minimum Connect permissions above.
6. Run API and owner-app builds/tests.
7. Complete one Stripe test-mode registration for each plan.
8. Verify the new number is `CLAIMED`, attached to the expected flow, visible in Billing, and resolves the correct salon from `SystemEndpoint.Address`.
9. Place a real inbound call to each plan before enabling live Stripe keys.

References: [Stripe SetupIntents](https://docs.stripe.com/payments/setup-intents), [Stripe subscription trials](https://docs.stripe.com/billing/subscriptions/trials), [Stripe webhook signatures](https://docs.stripe.com/webhooks), [Amazon Connect phone claiming](https://docs.aws.amazon.com/connect/latest/adminguide/get-connect-number.html), and [attaching a number to a flow](https://docs.aws.amazon.com/connect/latest/adminguide/associate-claimed-ported-phone-number-to-flow.html).
