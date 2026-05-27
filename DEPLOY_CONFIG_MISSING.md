# Deploy Config Missing

## Blocking deploy

No blocking deploy config is missing for building and restarting the existing Docker stack.

## Blocking full Amazon Connect AI test

No blocking Amazon Connect AI booking config is missing. The runtime env now has the Connect instance, phone number, AI Reception flow, Lex bot alias, Booking Lambda, backend API URL, and internal API token.

## Blocking human operator fallback

No blocking human fallback config is missing. The runtime env now has the FastAIBooking Operator Queue, Operator Routing Profile, Agent security profile, and Human Escalation flow.

## Blocking SMS live test

This does not block the AWS AI booking flow. It blocks only live SMS delivery; appointment creation and human escalation must continue without SMS.

- AWS_SMS_ORIGINATION_NUMBER
  - Needed by: AWS End User Messaging SMS provider for transactional booking confirmation/update/cancel SMS.
  - How to get: Lease or register an SMS-capable origination identity in AWS End User Messaging SMS for `us-east-1`, then set this env var to that phone number, sender ID, pool ID, or origination identity ARN.
  - Current status: Empty in root `.env.example` and copied runtime env files. AWS SMS account attributes show the account is in sandbox and there are no SMS origination phone numbers or pools.
  - Blocks deploy: No.
  - Blocks AI call test: No.
  - Blocks human fallback: No.
  - Blocks SMS/email live test: Blocks live SMS only.

## Optional / later

- AWS_SMS_CONFIGURATION_SET
  - Needed by: Optional AWS End User Messaging SMS event tracking and delivery metrics.
  - How to get: Create an SMS configuration set in AWS End User Messaging SMS if delivery/event tracking is required.
  - Current status: Empty.
  - Blocks deploy: No.
  - Blocks AI call test: No.
  - Blocks human fallback: No.
  - Blocks SMS/email live test: No.
