# CallRail

## Current Status

CallRail is not required for the current Amazon Connect-only demo.

Do not use CallRail in the main call flow:

```text
Salon original number -> Amazon Connect -> Amazon Lex Booking Bot -> Booking Lambda or FastAIBooking Backend API -> real appointment
```

## Optional Future Marketing Attribution Only

If CallRail is reintroduced later, it should only provide marketing attribution outside the primary phone, AI booking, queue, and human escalation flow.

Optional future keys:

```dotenv
CALLRAIL_API_KEY=
CALLRAIL_ACCOUNT_ID=
CALLRAIL_COMPANY_ID=
CALLRAIL_TRACKING_NUMBER_ID=
CALLRAIL_TRACKING_NUMBER=
CALLRAIL_WEBHOOK_SECRET=
```

These values are not needed for the current Amazon Connect-only demo.
