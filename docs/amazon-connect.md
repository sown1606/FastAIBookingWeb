# Amazon Connect

## Role In The Demo

Amazon Connect is the primary telephony layer for FastAIBooking:

- answers calls forwarded from `848-702-9493`
- runs the Amazon Connect Contact Flow
- invokes Amazon Lex Booking Bot
- invokes Booking Lambda or the FastAIBooking Backend API integration
- transfers callers to the Operator Queue when human help is needed
- supports operators through Amazon Connect CCP/browser softphone

## Required Setup

1. Claim or assign an Amazon Connect phone number.
2. Configure the carrier for `848-702-9493` to forward directly to the Amazon Connect phone number.
3. Create the AI Booking Reception Amazon Connect Contact Flow.
4. Add Amazon Lex Booking Bot to the Get customer input block.
5. Configure Lambda invocation for availability checks and appointment creation.
6. Create the human escalation flow and Transfer to queue block.
7. Configure the Operator Queue.
8. Configure operator user, routing profile, security profile, and CCP access.
9. Enable recording storage if call recording is part of the demo.

## Required Env Values

```dotenv
AWS_REGION=
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

AMAZON_CONNECT_INSTANCE_ID=
AMAZON_CONNECT_INSTANCE_ARN=
AMAZON_CONNECT_INSTANCE_URL=https://fastaibooking.my.connect.aws
AMAZON_CONNECT_CCP_URL=https://fastaibooking.my.connect.aws/ccp-v2/

AMAZON_CONNECT_PHONE_NUMBER=
AMAZON_CONNECT_PHONE_NUMBER_ID=

AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION=
AMAZON_CONNECT_CONTACT_FLOW_ID_HUMAN_ESCALATION=

AMAZON_CONNECT_QUEUE_ID_DEFAULT=
AMAZON_CONNECT_ROUTING_PROFILE_ID=
AMAZON_CONNECT_OPERATOR_SECURITY_PROFILE_ID=

AMAZON_CONNECT_RECORDING_BUCKET=
AMAZON_CONNECT_RECORDING_PREFIX=

AMAZON_LEX_BOT_ID=
AMAZON_LEX_BOT_ALIAS_ID=
AMAZON_LEX_LOCALE_ID=en_US
AMAZON_LEX_BOOKING_INTENT_NAME=
AMAZON_LEX_HUMAN_ESCALATION_INTENT_NAME=

BOOKING_LAMBDA_FUNCTION_NAME=
BOOKING_LAMBDA_FUNCTION_ARN=

FASTAIBOOKING_API_BASE_URL=
FASTAIBOOKING_API_INTERNAL_TOKEN=
```

Do not expose AWS credentials or internal backend tokens in frontend `VITE_*` env variables.

## Embedded CCP Requirements

The operator dashboard embeds the Amazon Connect CCP from `apps/app`, so the web app origins must be added to the Amazon Connect instance Approved origins. Without this, the CCP iframe can stay blank/gray or fail with browser frame restrictions.

Required origins:

- `https://app-new-nail.kendemo.com`
- `http://localhost:5173`

The CCP URL must use the Connect instance alias and `/ccp-v2/`:

```dotenv
VITE_AMAZON_CONNECT_CCP_URL=https://<instance-alias>.my.connect.aws/ccp-v2/
```

For the current FastAIBooking instance, the format is:

```dotenv
VITE_AMAZON_CONNECT_CCP_URL=https://fastaibooking.my.connect.aws/ccp-v2/
```

Current production values:

- Direct CCP URL: `https://fastaibooking.my.connect.aws/ccp-v2/`
- App origin: `https://app-new-nail.kendemo.com`
- Amazon Connect instance alias: `fastaibooking`
- Region: `us-east-1`

Use the repeatable helper to verify and add Approved origins:

```bash
AWS_PROFILE=nailnew AWS_REGION=us-east-1 APP_ORIGIN=https://app-new-nail.kendemo.com ./scripts/aws/ensure-connect-approved-origins.sh
```

AWS CLI commands used for manual verification:

```bash
aws sts get-caller-identity --profile nailnew
aws configure get region --profile nailnew
aws connect list-instances --profile nailnew --region us-east-1

INSTANCE_ID="<connect-instance-id>"

aws connect list-approved-origins \
  --profile nailnew \
  --region us-east-1 \
  --instance-id "$INSTANCE_ID"

aws connect disassociate-approved-origin \
  --profile nailnew \
  --region us-east-1 \
  --instance-id "$INSTANCE_ID" \
  --origin "https://app-new-nail.kendemo.com"

aws connect associate-approved-origin \
  --profile nailnew \
  --region us-east-1 \
  --instance-id "$INSTANCE_ID" \
  --origin "https://app-new-nail.kendemo.com"

aws connect associate-approved-origin \
  --profile nailnew \
  --region us-east-1 \
  --instance-id "$INSTANCE_ID" \
  --origin "http://localhost:5173"

aws connect list-queues \
  --profile nailnew \
  --region us-east-1 \
  --instance-id "$INSTANCE_ID"
```

Troubleshooting blank embedded CCP:

- Confirm the browser origin is listed in Amazon Connect Approved origins.
- Confirm the URL uses `https://<instance-alias>.my.connect.aws/ccp-v2/`, not old `/ccp#`.
- Open the CCP URL in a new tab and log in to Amazon Connect.
- If the browser console shows `frame-ancestors 'self'`, Amazon Connect did not allow this app origin to embed the CCP yet. Verify the exact account, region, instance id, and Approved origins with AWS CLI. If the origin is present but the iframe is still blocked, disassociate and associate the production origin again, wait 1-3 minutes, then hard reload.
- Allow browser cookies/popups needed by Amazon Connect login and softphone after the frame-ancestor check passes.
- Check for frame blocking such as `X-Frame-Options: sameorigin` or CSP `frame-ancestors 'self'`; this usually means the origin has not applied to the intended Connect instance or the CCP URL is wrong.
- Confirm the AWS region and Connect instance alias/id are the intended `us-east-1` FastAIBooking instance.
- If embedding is blocked but direct CCP works, use the dashboard side-by-side with the direct CCP popup from `https://fastaibooking.my.connect.aws/ccp-v2/` until Approved origins propagates.

## Live Contact Flow Checklist

- Use `CALL_PROVIDER=amazon_connect` and `AI_PROVIDER=amazon` or `AI_PROVIDER=lex`.
- The phone number for `848-702-9493` forwards to the Amazon Connect number in `AMAZON_CONNECT_PHONE_NUMBER`.
- The phone number is assigned to the AI reception contact flow in `AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION`.
- The Get customer input block uses the Lex bot alias in `AMAZON_LEX_BOT_ALIAS_ID`.
- `BookAppointmentIntent` has Lambda fulfillment enabled and invokes `BOOKING_LAMBDA_FUNCTION_ARN`.
- `BookAppointmentIntent` collects customer name, customer phone, service, preferred date/time, and optional staff preference before fulfillment.
- The booking Lambda calls `POST /api/v1/internal/ai/appointments` with `FASTAIBOOKING_API_INTERNAL_TOKEN`.
- The contact flow sets contact attributes where available: `salonId`, `callerPhone`, `contactId`, `callSessionId`, `provider=AMAZON_CONNECT`.
- After each Lex result, the AI reception flow checks `$.Lex.SessionAttributes.transferToQueue`.
- If `transferToQueue == true`, the flow transfers to `FastAIBooking Human Escalation`.
- `HumanEscalationIntent`, `CancelAppointmentIntent`, `RescheduleAppointmentIntent`, and backend fallback responses set transfer attributes and route to the human escalation flow.
- Explicit human handoff says exactly: `Please wait while I connect you.`
- The human escalation flow sets the working queue with `AMAZON_CONNECT_QUEUE_ID_DEFAULT`, then transfers to queue.
- Queue setup/transfer errors play a fallback message before disconnecting safely.
- The default/no-match path asks the caller to repeat once before sending the caller to the operator fallback.
- Error paths play a clear fallback prompt, then retry once or disconnect safely.

## Versioned AWS Exports

AWS configuration used by the demo is versioned in the repo for review and maintenance:

- Lex V2 bot export: `infra/aws/lex/FastAIBookingBot-v8/`
- AI reception Contact Flow content: `infra/aws/connect/contact-flows/ai-reception.json`
- Human escalation Contact Flow content: `infra/aws/connect/contact-flows/human-escalation.json`

Regenerate these exports with `AWS_PROFILE=nailnew` and `AWS_REGION=us-east-1` after changing Lex or Connect in AWS.

## Production Verification Commands

```bash
npm run test
npm run build:api
npm run typecheck:api
npm run build:app
npm run typecheck:app
npm run build:admin
npm run typecheck:admin
node --check infra/lambda/booking-handler/index.mjs
git diff --check
```

`infra/scripts/smoke_test_production.sh` also verifies health endpoints, the internal AI booking endpoint, the internal human escalation endpoint, and read-only AWS resource state when AWS CLI profile `nailnew` is available.

## SMS Limitation

AWS SMS origination/config is not required for the Amazon Connect AI booking test. Missing `AWS_SMS_ORIGINATION_NUMBER` blocks only live SMS delivery; booking and human escalation should still complete and log a safe skipped SMS.

## Out Of Scope

AI Reception ON/OFF is handled at the external redirect/routing layer before calls enter this Amazon Connect/Lex flow. This backend and Contact Flow do not read the web AI Reception ON/OFF setting for routing decisions in the current production/demo setup.
