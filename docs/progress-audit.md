# Progress Audit

## What Was Already Completed

- Monorepo structure already existed with `apps/api`, `apps/admin`, and `apps/app`.
- Core API modules already existed for auth, admin, salon, staff, services, business hours, customers, appointments, availability, billing, calls, AI, call center, alerts, messages, feedback, and health.
- Shared `apps/app` routing already separated Salon Owner, Staff, and Call Center Agent flows with `RequireAuth` and `RequireRole`.
- `apps/admin` already included dashboard, salons, salon detail, call center agents, calls, AI logs, and health pages.
- AI booking logic already parsed booking intent, validated service and availability, created customers and appointments, stored booking attempts, and escalated live-person requests.
- Call center queue/detail workflows already existed for accept, notes, QA notes, completion, callback, voicemail, SMS fallback, customer actions, and appointment actions.
- Prisma migrations already existed, including a real initial SQL migration under `apps/api/prisma/migrations`.
- Seed logic already created demo users, salons, services, business hours, appointments, AI logs, booking attempts, call sessions, transcripts, and an operator queue item.

## What Was Fixed In This Pass

- Kept existing env/example keys intact and only appended the missing `CALLRAIL_TRACKING_NUMBER_ID` placeholder to `apps/api/.env.example`.
- Removed the fake default CallRail tracking number path from backend env resolution so readiness is now truthful when tracking config is missing.
- Updated CallRail integration readiness logic to require:
  - `CALLRAIL_WEBHOOK_SECRET`
  - `CALLRAIL_API_KEY`
  - `CALLRAIL_ACCOUNT_ID`
  - `CALLRAIL_COMPANY_ID`
  - `CALLRAIL_TRACKING_NUMBER_ID`
  - `CALLRAIL_TRACKING_NUMBER`
  - `CALLRAIL_DEFAULT_SALON_ID`
  - `CALLRAIL_AI_FLOW_ID`
- Kept `CALLRAIL_LIVE_PERSON_FLOW_ID` optional for the current MVP while still reporting whether it is configured.
- Expanded `/api/v1/integrations/callrail/health` so it now reports:
  - overall configured state
  - missing required keys
  - webhook secret configured
  - API key configured
  - account/company configured
  - tracking number configured
  - tracking number ID configured
  - default salon ID configured
  - AI flow ID configured
  - live person flow ID configured as optional
- Tightened CallRail webhook normalization so `pre-call`, `call-routing-complete`, `post-call`, and `call-modified` payloads map cleanly without downgrading a real call into a fake `UNKNOWN` state.
- Fixed CallRail salon resolution so tracking-number matching works with both digits-only values and `+1...` formatted values.
- Preserved idempotent call-session handling by provider call ID and event/payload dedupe.
- Tightened the no-Vertex fallback parser so explicit phone phrases are preferred and the fallback does not mistake an ISO date string for the caller phone number.
- Added real simulator entry points:
  - `npm run simulate:callrail-booking`
  - `npm run simulate:callrail-escalation`
- The simulators use the real webhook ingestion path and the real AI booking/escalation services:
  - booking simulation sends `pre-call`, `call-routing-complete`, and `post-call`
  - escalation simulation sends `pre-call`, `call-routing-complete`, `post-call`, and `call-modified`
- Updated the admin salon detail CallRail health panel to show truthful required/optional readiness and the missing-key checklist.

## CallRail Setup Steps

1. In CallRail, create a Call Flow for the salon tracking number.
2. Add a Greeting step first.
3. Add Voice Assist as the final step.
4. Do not add a Dial step before or after Voice Assist for this MVP.
5. Assign that Call Flow to the CallRail tracking number that the salon carrier already forwards into.
6. Confirm the backend webhook URL is reachable at `/api/v1/integrations/callrail/webhook`.
7. Confirm the webhook secret/header configuration matches `CALLRAIL_WEBHOOK_SECRET`.
8. Make a real test call:
   - salon number rings first
   - no-answer forwarding sends the call to the CallRail tracking number
   - CallRail Call Flow answers with Greeting -> Voice Assist
   - post-call webhook reaches the backend
   - backend creates either a real booking attempt/appointment or a real operator escalation

## What Remains Incomplete

- Live CallRail behavior still depends on the actual CallRail account configuration, webhook configuration, and Voice Assist call flow being active on the tracking number.
- Live Amazon Connect browser CCP behavior still depends on valid Amazon Connect env/config and browser-side CCP access.
- Live Vertex parsing quality still depends on real Vertex credentials and project configuration.
- SMS fallback remains stub/log-only by current implementation and was not converted into a live SMS sender here.
- Browser-level manual smoke coverage is still required for the final product pass across Owner, Staff, Operator, and Admin pages.

## Live Provider Dependencies Still Missing

- CallRail still requires real account-side setup plus active `CALLRAIL` integration config rows as needed per salon.
- Amazon Connect still requires:
  - `AWS_REGION`
  - `AMAZON_CONNECT_INSTANCE_ID`
  - `AMAZON_CONNECT_INSTANCE_URL`
  - `AMAZON_CONNECT_CCP_URL`
  - `AMAZON_CONNECT_QUEUE_ID_DEFAULT`
  - `AMAZON_CONNECT_ROUTING_PROFILE_ID`
  - active `AMAZON_CONNECT` `IntegrationConfig`
- Vertex still requires:
  - `VERTEX_PROJECT_ID`
  - `VERTEX_LOCATION`
  - `VERTEX_MODEL`
  - `VERTEX_SYSTEM_PROMPT_VERSION`
  - and either `GOOGLE_APPLICATION_CREDENTIALS` or `VERTEX_CLIENT_EMAIL` plus `VERTEX_PRIVATE_KEY`

## How To Run Locally

1. Use a modern npm version that supports the workspace lockfile cleanly. `npm 10+` is recommended.
2. Keep your existing `.env` values. If you need a new local file, copy from `.env.example` and fill only local-safe values.
3. Start PostgreSQL and make sure the configured database exists.
4. Run `npm ci`.
5. Run `npm run migrate`.
6. Run `npm run seed`.
7. Start the apps you need:
   - `npm run dev:api`
   - `npm run dev:admin`
   - `npm run dev:app`

## How To Deploy

1. Provision PostgreSQL and populate the required env vars for API, admin, and app.
2. Run `npm ci`.
3. Run `npm run build:api`.
4. Run `npm run build:admin`.
5. Run `npm run build:app`.
6. Run `npm run migrate`.
7. Run `npm run seed` only for demo/staging environments where seeded data is intended.
8. Deploy the API and frontend artifacts, or use the included infrastructure scripts if that matches the target environment.

## How To Seed

- Root command: `npm run seed`
- Direct API command: `npm --prefix apps/api run prisma:seed`

## How To Smoke Test

1. Run the build and typecheck commands from the repository root.
2. Run `npm run simulate:callrail-booking`.
3. Run `npm run simulate:callrail-escalation`.
4. Log in as Owner and confirm:
   - salon profile/settings load
   - calls list shows the simulated call
   - AI logs show the simulated AI parse
   - appointments show the simulated booking when booking succeeded
5. Log in as Operator and confirm:
   - queue shows the simulated escalation
   - escalation detail shows transcript, AI summary, booking attempts, and salon context
6. Log in as Admin and confirm:
   - CallRail health shows truthful ready/missing state
   - salon detail shows recent CallRail logs and integration readiness
7. Follow the browser walkthroughs in `DEMO_TEST_PLAN.md` for Owner, Staff, Operator, and Admin.

## Demo Accounts

- `admin@fastaibooking.local / Admin123!`
- `owner.demo@fastaibooking.local / Owner123!`
- `staff.demo@fastaibooking.local / Staff123!`
- `agent.demo@fastaibooking.local / Agent123!`
- `owner.callcenter.demo@fastaibooking.local / Owner123!`

## Exact Changed Files

- `package.json`
- `apps/api/package.json`
- `apps/api/.env.example`
- `apps/api/src/config/env.ts`
- `apps/api/src/modules/ai-reception/ai-reception.service.ts`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/calls/calls.service.ts`
- `apps/api/src/modules/calls/providers/callrail.provider.ts`
- `apps/api/scripts/callrail-simulator.shared.ts`
- `apps/api/scripts/simulate-callrail-booking.ts`
- `apps/api/scripts/simulate-callrail-escalation.ts`
- `apps/admin/src/pages/salon-detail-page.tsx`
- `docs/progress-audit.md`
