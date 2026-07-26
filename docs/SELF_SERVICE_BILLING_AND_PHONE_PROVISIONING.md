# Self-service billing and Amazon Connect phone provisioning

## Customer contract

- A Visa card is required before a salon owner account can be created.
- The trial lasts exactly 30 days and does not charge the card at signup.
- `ai_reception` renews monthly at **$89 USD**.
- `human_reception` renews monthly at **$499 USD**.
- Registration is fail-closed until Stripe and Amazon Connect are fully configured.
- The salon remains `PENDING` until its Amazon Connect number is claimed and attached to the selected plan's flow. Successful phone configuration moves it to `ACTIVE`.

Only Stripe identifiers, card brand, and last four digits are stored. Raw card data never reaches this API.

## Stripe setup

Create two active recurring Prices in Stripe:

1. AI Reception: USD 89.00, recurring every month.
2. Real Person Reception: USD 499.00, recurring every month.

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

Provisioning first searches the salon's area code, falls back to any available US number, claims it with a persistent client token, waits for `CLAIMED`, and associates:

- `$89` plan -> `AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION`
- `$499` plan -> `AMAZON_CONNECT_CONTACT_FLOW_ID_HUMAN_ESCALATION`

The `$499` plan is offered only while at least one active call-center agent exists. Registration assigns every active call-center agent to the new salon so the real-person workspace and notifications are usable immediately; admins can narrow those assignments afterward.

The E.164 number is then stored as the salon's incoming number and as Amazon Connect integration routing data. Failed or still-in-progress claims can be safely reconciled from Billing without creating a second Stripe subscription.

## Release checklist

1. Apply Prisma migration `202607260001_trial_billing_and_phone_provisioning`.
2. Configure and verify both Stripe Prices and the signed webhook.
3. Configure the two published Amazon Connect flow IDs.
4. Grant the runtime principal the minimum Connect permissions above.
5. Run API and owner-app builds/tests.
6. Complete one Stripe test-mode registration for each plan.
7. Verify the new number is `CLAIMED`, attached to the expected flow, visible in Billing, and resolves the correct salon from `SystemEndpoint.Address`.
8. Place a real inbound call to each plan before enabling live Stripe keys.

References: [Stripe SetupIntents](https://docs.stripe.com/payments/setup-intents), [Stripe subscription trials](https://docs.stripe.com/billing/subscriptions/trials), [Stripe webhook signatures](https://docs.stripe.com/webhooks), [Amazon Connect phone claiming](https://docs.aws.amazon.com/connect/latest/adminguide/get-connect-number.html), and [attaching a number to a flow](https://docs.aws.amazon.com/connect/latest/adminguide/associate-claimed-ported-phone-number-to-flow.html).
