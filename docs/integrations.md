# Integrations

## Required For Current Demo

Amazon Connect:

- Claimed Amazon Connect phone number
- AI Booking Reception Amazon Connect Contact Flow
- Human escalation Amazon Connect Contact Flow
- Operator Queue
- Routing profile
- Operator security profile
- CCP/browser softphone access

Amazon Lex / Amazon AI:

- Amazon Lex Booking Bot
- Booking intent
- Human escalation intent
- Locale `en_US` for the current demo unless another locale is explicitly configured

Booking Lambda / Backend:

- Booking Lambda function
- FastAIBooking Backend API base URL
- Internal API token for Lambda calls
- Backend appointment creation endpoint
- Contact flow result recording endpoint

Fallback and notifications:

- SMS provider only if SMS fallback is enabled
- SMTP provider only if email notifications are enabled

## Email Delivery

The API sends staff invitations, password resets, and appointment email through the same transactional mailer path.

Gmail SMTP production env:

```dotenv
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=<gmail>
SMTP_PASSWORD=<google-app-password>
SMTP_FROM_EMAIL=<gmail>
SMTP_FROM_NAME=FastAIBooking
```

Use a Gmail App Password, not the normal Gmail password. Do not commit real credentials.

Local smoke test:

```bash
npm --prefix apps/api run email:test -- --to <test-email>
```

The deploy script excludes `.env`. Keep the production `.env` on the EC2 app path in sync through SSH without committing secrets.

## Provider Defaults

```dotenv
CALL_PROVIDER=amazon_connect
AI_PROVIDER=amazon
```

## Optional Future Marketing Attribution

CallRail is not required for the Amazon Connect-only demo. If added later, it should be used only as an optional marketing attribution provider outside the primary phone and AI booking flow.

Optional CallRail keys:

```dotenv
CALLRAIL_API_KEY=
CALLRAIL_ACCOUNT_ID=
CALLRAIL_COMPANY_ID=
CALLRAIL_TRACKING_NUMBER_ID=
CALLRAIL_TRACKING_NUMBER=
CALLRAIL_WEBHOOK_SECRET=
```
