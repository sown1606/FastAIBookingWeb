# Progress Audit

## Current Demo Target

One clean demo salon only:

- Salon: `Kiet Nails & Beauty`
- Original business number: `848-702-9493`
- Carrier setup: T-Mobile no-answer forwarding code `**61*********7681**10#`
- Primary telephony layer: Amazon Connect
- Primary AI layer: Amazon Lex / Amazon AI
- Demo flow: `848-702-9493 -> +********7681 -> Amazon Connect Contact Flow -> Lex prod alias -> Booking Lambda -> POST /api/v1/internal/ai/appointments -> backend booking/escalation flow -> Owner/Staff dashboard`
- Human escalation flow: `AI Booking Reception -> Operator Queue -> Amazon Connect CCP/browser softphone -> FastAIBooking operator dashboard`

## What Is Now Coherent

- Owner, Staff, Call Center Agent, and Platform Admin all compile against real API-backed screens.
- Default product locale is Vietnamese in both `apps/app` and `apps/admin`, with English still available.
- The owner app now exposes a real call-center monitoring page in addition to the operator workspace.
- Admin call and AI log pages now use consistent i18n and show real backend data instead of mixed hardcoded text.
- Environment examples now make Amazon Connect the primary call provider and Amazon AI the primary AI provider.
- Seed data is focused on one salon with realistic staff, services, hours, customers, appointments, billing usage, alerts, messages, call sessions, escalations, and AI logs.

## Seeded Demo Shape

- 1 active salon
- 3 active/bookable AI demo staff records
  - `Trang`
  - `Amy`
  - `Kelly`
- 8 customers
- 9 appointments
- 7 call sessions
  - salon answered directly
  - AI booking success
  - queued escalation
  - resolved escalation
  - callback fallback
  - voicemail fallback
  - SMS fallback
- 1 assigned call-center agent

## UI Changes In This Pass

- `apps/app`
  - owner sidebar exposes the release navigation: dashboard, appointments, customers, staff, services, business hours, availability, salon profile/settings, call center, calls, AI logs, billing, messages, and alerts
  - owner dashboard quick actions remain simplified for the demo flow
  - staff sidebar exposes dashboard, appointments, and My Profile only
  - My Profile is routed at `/my-profile` for Staff and uses real profile and password endpoints
  - the operator workspace stays focused on opening Amazon Connect CCP, selecting a salon, queue handling, customer/booking forms, appointment actions, notes, and completion
  - appointments now default to today's selected date, show previous/next day buttons plus a date input, and filter owner/staff visible schedules to that selected day while preserving the status filter
  - business hours now highlights the current weekday with a Today/Hôm nay label
  - added owner access to `/call-center`
  - added owner call-center navigation item
  - localized and cleaned:
    - Calls
    - AI Logs
    - Availability
    - Alerts
    - Messages
    - My Profile
    - Billing
  - owner call-center monitor now shows:
    - assigned operators
    - queue metrics
    - fallback status
    - selected escalation detail

- `apps/admin`
  - localized and cleaned:
    - Calls
    - Call detail
    - AI Logs
    - AI Log detail

## Backend Changes In This Pass

- Owner access is allowed for read-only call-center monitoring routes while queue mutations remain call-center-agent-only.
- Call-center workspace access now resolves by:
  - owner salon context
  - call-center agent salon assignments
- Call-center runtime payload now reports owner/call-center-agent access mode and Amazon Connect readiness context.
- Amazon Connect is now the documented phone, contact flow, queue, and human escalation layer.
- Legacy call ingestion remains present in code for optional/future attribution work, but it is not part of the main demo architecture.

## Config And Env Notes

- Root `.env.example` and `apps/api/.env.example` now use:
  - `CALL_PROVIDER=amazon_connect`
  - `AI_PROVIDER=amazon`
  - `DEMO_ORIGINAL_PHONE_NUMBER=********9493`
  - `AMAZON_CONNECT_INSTANCE_URL=https://fastaibooking.my.connect.aws`
  - `AMAZON_CONNECT_CCP_URL=https://fastaibooking.my.connect.aws/ccp-v2/`
  - `AMAZON_LEX_LOCALE_ID=en_US`
- Required live setup values now include the Amazon Connect instance, phone number, contact flows, queue, routing profile, operator security profile, Lex bot, Booking Lambda, backend API URL, and internal API token.
- CallRail env keys are documented only as optional future marketing attribution values and are not required for the Amazon Connect-only demo.
- Frontend env examples already match actual Vite usage:
  - `VITE_API_BASE_URL`
  - `VITE_APP_BASE_URL`
  - `VITE_ADMIN_BASE_URL`
  - `VITE_APP_NAME`
  - `VITE_DEFAULT_LOCALE`

## Still Depends On Real External Setup

- Amazon Connect live CCP still requires valid instance access, claimed phone number, contact flows, queue, routing profile, operator user, and browser login.
- Amazon Lex Booking Bot still requires a configured bot, alias, locale, booking intent, and human escalation intent.
- Booking Lambda still requires an internal backend endpoint and `[INTERNAL_TOKEN_ENV]`.
- SMTP and Twilio still require real provider credentials for live delivery.

## Release Hygiene Notes

- Do not include unrelated local artifacts in web deploy packaging:
  - `GoogleService-Info.plist`
  - `google-services.json`
  - `localhost-kan-tekcom-20260521-152245-rkdxec.wpress`
  - `wordpress-7.0.zip`
  - `fastaibooking-current-state.zip`
- These files were present in the working tree during the June 29, 2026 release audit and were not removed automatically.

## Next Implementation Checklist

Backend:

- Internal AI appointment endpoint, token validation, appointment creation, booking attempts, call sessions, transcripts, and AI logs are covered by automated API/Lambda tests.
- Continue live verification with a seeded database and Amazon Connect/Lex/Lambda environment before demo.

Amazon Connect:

- Claim or assign Amazon Connect phone number.
- Assign AI Booking Reception contact flow to the number.
- Configure Amazon Lex Booking Bot in the Get customer input block.
- Configure Lambda invocation for booking availability and creation.
- Configure Transfer to queue block for human escalation.
- Configure operator user, queue, routing profile, and CCP access.

Frontend:

- Owner dashboard shows new appointments.
- Staff dashboard shows assigned appointments and Staff My Profile.
- Operator dashboard shows call center queue/request context.
- Admin dashboard shows integration health.

## Verification Status

- June 29, 2026 baseline install passed: `npm ci`.
- June 29, 2026 final source verification passed:
  - `npm --prefix apps/api run prisma:generate`
  - `npm run typecheck:app`
  - `npm run typecheck:admin`
  - `npm run typecheck:api`
  - `npm run build:app`
  - `npm run build:admin`
  - `npm run build:api`
  - `npm run test:lambda`
  - `npm run test:api`
  - `git diff --check`
- `npm run build:app` produced no missing `/assets/demo/nail-service.webp` or `/assets/demo/salon-wall.webp` warnings; Vite still reports the existing large chunk warning.
- Browser/manual smoke still needs to be run against a live seeded database and live Amazon Connect/Lex/Lambda setup.
