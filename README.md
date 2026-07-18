# FastAIBooking

Monorepo for the FastAIBooking SaaS booking platform for U.S. nail salons.

Current demo focus: one clean demo salon across Platform Admin, Owner, Staff, and Call Center Agent/Operator workspace flows.

## Apps

```text
apps/
  api/    Node.js + Express + Prisma backend API
  admin/  Platform Admin web app
  app/    Owner / Staff / Operator web app
```

## Stack

- Backend: Node.js, TypeScript, Express
- Database: PostgreSQL
- ORM: Prisma
- Frontend: React, Vite, TypeScript
- Auth: JWT access + refresh tokens
- Infra: Docker Compose, Docker, Nginx

## Demo Scope

Primary demo salon:

- Salon: `Kiet Nails & Beauty`
- Original business number: `848-702-9493`
- Carrier setup: T-Mobile no-answer forwarding code `**61*********7681**10#`
- Primary telephony layer: Amazon Connect
- AI layer: Amazon Lex / Amazon AI
- Human escalation layer: Amazon Connect Operator Queue

Live demo path:

`848-702-9493` -> `+********7681` Amazon Connect phone number -> Amazon Connect Contact Flow -> Amazon Lex `prod` alias -> Booking Lambda `infra/lambda/booking-handler/index.mjs` -> `POST /api/v1/internal/ai/appointments` -> backend booking/escalation flow -> real appointment or Operator Queue handoff

Important:

- The salon carrier should forward `848-702-9493` directly to the Amazon Connect phone number.
- Do not use CallRail in the main call flow.
- AI Reception ON/OFF is handled by the external routing/redirect layer before calls enter Amazon Connect.
- Human Call Center remains a separate ON/OFF module.
- If the caller asks for a real person or the AI cannot complete the booking, Amazon Connect transfers the call to the Operator Queue.

## Demo Accounts Preserved

- Platform admin: `admin@fastaibooking.local` / `Admin123!`
- Owner: `owner.demo@fastaibooking.local` / `Owner123!`
- Staff: `staff.demo@fastaibooking.local` / `Staff123!`
- Call center agent: `agent.demo@fastaibooking.local` / `Agent123!`
- Preserved extra owner login: `owner.callcenter.demo@fastaibooking.local` / `Owner123!`

Only `owner.demo@fastaibooking.local` is seeded as the primary owner of the single demo salon.
The auth role for the operator workspace is `CALL_CENTER_AGENT`; "Operator" remains UI/business wording for the human call-center workflow.

## Demo Seed Snapshot

- One active demo salon: `Kiet Nails & Beauty`
- 3 active/bookable staff records seeded:
  - `Trang`
  - `Amy`
  - `Kelly`
- 8 customers
- 9 appointments across today and upcoming dates
- 7 demo call sessions covering:
  - salon answered directly
  - AI booking success
  - open operator escalation
  - resolved operator escalation
  - callback fallback
  - voicemail fallback
  - SMS fallback
- One real operator assignment to the demo salon

## Root Scripts

```bash
npm run dev:api
npm run dev:admin
npm run dev:app
npm run build:api
npm run build:admin
npm run build:app
npm run test
npm run test:api
npm run test:lambda
npm run typecheck:api
npm run typecheck:admin
npm run typecheck:app
npm run seed
```

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the env template:

```bash
cp .env.example .env
```

3. Start PostgreSQL in Docker:

```bash
docker compose up -d postgres
```

4. Generate Prisma client:

```bash
npm --prefix apps/api run prisma:generate
```

5. Apply migrations:

```bash
npm --prefix apps/api run prisma:migrate:deploy
```

6. Seed the single demo salon:

```bash
NODE_ENV=development ALLOW_DEMO_SEED=true npm --prefix apps/api run prisma:seed
```

7. Start the apps you need:

```bash
npm run dev:api
npm run dev:app
npm run dev:admin
```

## Env Notes

Main demo defaults in `.env.example` and `apps/api/.env.example`:

- `CALL_PROVIDER=amazon_connect`
- `AI_PROVIDER=amazon`
- `DEMO_ORIGINAL_PHONE_NUMBER=********9493`
- `AMAZON_CONNECT_INSTANCE_URL=https://fastaibooking.my.connect.aws`
- `AMAZON_CONNECT_CCP_URL=https://fastaibooking.my.connect.aws/ccp-v2/`
- `AMAZON_LEX_LOCALE_ID=en_US`

Still requires real values before a live Amazon Connect demo:

- `AWS_REGION`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AMAZON_CONNECT_INSTANCE_ID`
- `AMAZON_CONNECT_INSTANCE_ARN`
- `AMAZON_CONNECT_PHONE_NUMBER`
- `AMAZON_CONNECT_PHONE_NUMBER_ID`
- `AMAZON_CONNECT_CONTACT_FLOW_ID_AI_RECEPTION`
- `AMAZON_CONNECT_CONTACT_FLOW_ID_HUMAN_ESCALATION`
- `AMAZON_CONNECT_QUEUE_ID_DEFAULT`
- `AMAZON_CONNECT_ROUTING_PROFILE_ID`
- `AMAZON_CONNECT_OPERATOR_SECURITY_PROFILE_ID`
- `AMAZON_LEX_BOT_ID`
- `AMAZON_LEX_BOT_ALIAS_ID`
- `AMAZON_LEX_BOOKING_INTENT_NAME`
- `AMAZON_LEX_HUMAN_ESCALATION_INTENT_NAME`
- `BOOKING_LAMBDA_FUNCTION_NAME`
- `BOOKING_LAMBDA_FUNCTION_ARN`
- `FASTAIBOOKING_API_BASE_URL`
- `FASTAIBOOKING_API_INTERNAL_TOKEN`
- `SMTP_*` if email fallback or notifications are enabled
- `AWS_SMS_ORIGINATION_NUMBER` if live AWS SMS delivery is enabled
- `AWS_SMS_CONFIGURATION_SET` if AWS SMS delivery metrics are required
- `TWILIO_*` only if Twilio SMS fallback is explicitly enabled later

## Database and Docker Reference

Docker Compose PostgreSQL service:

- Service name: `postgres`
- Container name: `fastaibooking-postgres`

Inside the Docker network:

- Host: `postgres`
- Port: `5432`
- Database: `fastaibooking`
- User: `postgres`
- Password: `postgres`
- `DATABASE_URL`: `postgresql://postgres:postgres@postgres:5432/fastaibooking`

From the local machine:

- Host: `localhost`
- Port: `5432`
- Database: `fastaibooking`
- User: `postgres`
- Password: `postgres`
- `DATABASE_URL`: `postgresql://postgres:postgres@localhost:5432/fastaibooking`

## Prisma Commands

```bash
npm --prefix apps/api run prisma:generate
npm --prefix apps/api run prisma:migrate:deploy
NODE_ENV=development ALLOW_DEMO_SEED=true npm --prefix apps/api run prisma:seed
```

## Safe Local Demo DB Reset

Only use this for the local demo database.

```bash
docker compose down -v
docker compose up -d postgres
npm --prefix apps/api run prisma:generate
npm --prefix apps/api run prisma:migrate:deploy
NODE_ENV=development ALLOW_DEMO_SEED=true npm --prefix apps/api run prisma:seed
```

## Verify the Seeded Demo Salon

```bash
docker compose exec -T postgres \
  psql -U postgres -d fastaibooking \
  -c 'SELECT name, "originalPhoneNumber", "customerIncomingPhoneNumber" FROM "Salon";'
```

Expected salon row:

- `Kiet Nails & Beauty`
- `+********9493`
- the Amazon Connect forwarding number configured in `AMAZON_CONNECT_PHONE_NUMBER`

Seeded provider call IDs useful for demo verification:

- AI booking success: `demo-forwarding-call-1`
- Open operator escalation: `demo-escalation-open-1`
- Resolved operator escalation: `demo-escalation-closed-1`
- Callback fallback: `demo-callback-fallback-1`
- Voicemail fallback: `demo-voicemail-fallback-1`
- SMS fallback: `demo-sms-fallback-1`

## Manual Live Demo Test

1. Confirm the Amazon Connect phone number is claimed and assigned to the AI Booking Reception contact flow.
2. Confirm the salon/carrier forwards `848-702-9493` directly to that Amazon Connect phone number.
3. Call `848-702-9493` from another phone.
4. Confirm Amazon Connect answers through the Amazon Connect Contact Flow.
5. Complete an AI booking through the Amazon Lex Booking Bot.
6. Confirm the Booking Lambda posts to the internal backend AI appointment endpoint and creates a real appointment.
7. Confirm the Owner dashboard and assigned Staff schedule show the appointment.
8. Ask for a real person and confirm Amazon Connect says, "Please wait while I connect you." before transferring to the Operator Queue.
9. Confirm an operator can answer in Amazon Connect CCP and manage the booking in the FastAIBooking operator dashboard.

## Current Production Readiness

Ready:

- Amazon Connect is the main demo path; CallRail is optional legacy/integration code only.
- Lambda and backend internal AI endpoint have automated contract coverage for booking, missing input, staff resolution, busy alternatives, cancel/reschedule handoff, human escalation, and backend failure safety.
- Owner/staff/operator/admin guard coverage verifies no cross-salon data leak in the current route contracts.
- Safe env templates exist at `.env.example`, `apps/api/.env.example`, `apps/app/.env.example`, and `apps/admin/.env.example`.

Needs manual AWS Console/setup verification:

- Confirm the carrier forwards `848-702-9493` to `+********7681`.
- Confirm the AI Reception contact flow, Human Escalation contact flow, Operator Queue, Lex `prod` alias, and Lambda env var names are current in `us-east-1` under profile `nailnew`.
- Log an operator into Amazon Connect CCP, set status to Available, and place one live customer call.

Needs live SMS config:

- `AWS_SMS_ORIGINATION_NUMBER` is not required for AI booking tests. It is required only for live AWS SMS delivery.
- Missing SMS origination/config does not block real appointment creation or human escalation.

Known limitations:

- Cancel and reschedule by phone currently hand off safely to the backend/human flow; they do not self-serve full appointment mutation by voice.
- Queue wait-time behavior after a successful transfer remains an Amazon Connect queue/customer-queue-flow operations setting.

Exact commands to run for a production-readiness check:

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

## Optional Future Marketing Attribution

CallRail is not required for the current Amazon Connect-only demo. If it is used later, it should sit outside the core phone and AI booking flow as an optional marketing attribution source only.

Optional CallRail env keys, when that future attribution work is explicitly enabled:

- `CALLRAIL_API_KEY`
- `CALLRAIL_ACCOUNT_ID`
- `CALLRAIL_COMPANY_ID`
- `CALLRAIL_TRACKING_NUMBER_ID`
- `CALLRAIL_TRACKING_NUMBER`
- `CALLRAIL_WEBHOOK_SECRET`

## Deployment Scripts

```bash
./infra/scripts/run_migrations.sh
./infra/scripts/run_seed.sh
./infra/scripts/backup_postgres.sh
./infra/scripts/deploy_ec2.sh
./infra/scripts/deploy_remote_ec2.sh
./infra/scripts/enable_ssl.sh your-email@example.com
./infra/scripts/renew_ssl.sh
./infra/scripts/smoke_test_production.sh
```
