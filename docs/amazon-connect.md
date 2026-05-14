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

## Live Contact Flow Checklist

- Use `CALL_PROVIDER=amazon_connect` and `AI_PROVIDER=amazon` or `AI_PROVIDER=lex`.
- The phone number for `848-702-9493` forwards to the Amazon Connect number in `AMAZON_CONNECT_PHONE_NUMBER`.
- The phone number is assigned to the AI reception contact flow in `AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION`.
- The Get customer input block uses the Lex bot alias in `AMAZON_LEX_BOT_ALIAS_ID`.
- `BookAppointmentIntent` has Lambda fulfillment enabled and invokes `BOOKING_LAMBDA_FUNCTION_ARN`.
- `BookAppointmentIntent` collects customer name, customer phone, service, preferred date/time, and optional staff preference before fulfillment.
- The booking Lambda calls `POST /api/v1/internal/ai/appointments` with `FASTAIBOOKING_API_INTERNAL_TOKEN`.
- The contact flow sets contact attributes where available: `salonId`, `callerPhone`, `contactId`, `callSessionId`, `provider=AMAZON_CONNECT`.
- `HumanEscalationIntent` goes to Set working queue with `AMAZON_CONNECT_QUEUE_ID_DEFAULT`, then Transfer to queue.
- The default/no-match path asks the caller to repeat once before sending the caller to the operator fallback.
- Error paths play a clear fallback prompt, then retry once or disconnect safely.
