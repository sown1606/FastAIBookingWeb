# AGENT RUN REPORT 2026-07-11 - Customer Delete, Call Flow, Reschedule

## Working Notes

- Root cause assumption before editing: final booking confirmation was allowed to re-read historical transcript (`initialBookingUtterance` / aggregated transcript) and overwrite trusted current state; bare `okay` was treated as irreversible confirmation; existing appointment change requests were routed to a human-offer/goodbye path instead of self-service reschedule.
- Expected files to edit:
  - `infra/lambda/booking-handler/index.mjs`: source of Lex slot/session precedence, final confirmation classification, and Connect terminal state.
  - `apps/api/src/modules/ai/ai.service.ts`: defensive confirmation handling, staff-change state machine, and self-service reschedule using existing appointment service.
  - `apps/api/src/modules/appointments/appointments.service.ts`: extract transactional cancel helper for customer privacy delete.
  - `apps/api/src/modules/customers/customers.service.ts` and route: owner privacy delete behavior.
  - `apps/app/src/pages/customers-page.tsx` and `apps/app/src/lib/i18n.tsx`: remove UI block and warn owner.
  - Focused tests for Lambda/API/customer delete/role guard.

## Root Causes

- ContactId `62373fd1-0d08-46e7-a97e-a6475623759b`: final turn was `yeah that's correct`, trusted state before confirmation had `requestedTime=11:00`, but historical transcript still contained `ten p m`; recovery logic allowed historical transcript to ground and override trusted time, producing 10 PM and outside-hours rejection.
- ContactId `113ee134-9a99-4910-869b-da234da18406`: final confirmation accepted bare `okay` as `Confirmed`, created an appointment with Alex, and completed the call. Bare `okay` was too weak for irreversible booking confirmation.
- Reschedule incidents around 2026-07-11 03:36-03:40 UTC: no matching debug export was present in repo root. Existing code path for recognized customers with one upcoming appointment returned an update/human-handoff prompt instead of collecting new date/time/staff and calling `rescheduleAppointment`.
- Lex source-of-truth check: live alias is bot `KHMIXGA2US`, alias `JVIPIZDYE3` (`prod`), version `27`; live `RescheduleAppointmentIntent` has no `sampleUtterances`. No Lex export or version was changed.

## Files Changed

- `infra/lambda/booking-handler/index.mjs`: current-turn/trusted-slot precedence, historical fill-only behavior, final confirmation change/okay classification, deterministic reschedule repair for Book/Fallback transcripts, terminal/goodbye guard.
- `apps/api/src/modules/ai/ai.service.ts`: defensive final confirmation handling, staff-change-before-confirmation flow, bare `okay` reprompt, common-case reschedule flow using `rescheduleAppointment`, `RESCHEDULED` outcome.
- `apps/api/src/modules/appointments/appointments.service.ts`: extracted `cancelAppointmentInTransaction` and cancellation notification wrapper so customer privacy delete can cancel active appointments atomically.
- `apps/api/src/modules/customers/customers.service.ts`: owner delete now hard-deletes customers with no appointments, otherwise cancels active appointments and anonymizes PII in one transaction.
- `apps/api/src/modules/customers/customers.routes.ts`: DELETE response message aligned with hard/privacy delete.
- `apps/app/src/pages/customers-page.tsx`: removed active appointment delete block and updated confirmation warning.
- `apps/app/src/lib/i18n.tsx`: English/Vietnamese customer-delete copy updated.
- `apps/api/test/ai-internal.test.ts`: regression coverage for stale AM/PM, 10 AM control, bare okay, staff change, reschedule update, and test mock include hydration.
- `apps/api/test/appointments-stabilization.test.ts`: customer delete privacy/hard delete/rollback coverage.
- `apps/api/test/role-guards.test.ts`: owner-only route and UI no-block coverage.

## Behavior After Fix

- Customer deletion: only `SALON_OWNER` can delete. No-appointment customers are hard-deleted. Customers with appointment history are privacy-deleted: active appointments (`SCHEDULED`, `CONFIRMED`, `IN_PROGRESS`) are canceled, terminal appointments are preserved, PII is anonymized, audit metadata excludes raw PII, and external notifications run after commit.
- AM/PM precedence: current turn wins; Lex current slots must be grounded; trusted session values beat historical transcript; historical transcript only fills missing fields and cannot override trusted date/time/staff/service.
- Staff change confirmation: change requests beat affirmation. `with Amy instead` creates no appointment and asks for a fresh summary confirmation; `change the person` elicits staff; bare `okay` asks for explicit yes/change.
- Reschedule: recognized caller with exactly one upcoming appointment enters self-service reschedule, collects changed date/time/staff, validates availability, confirms with a reschedule fingerprint, then updates the existing appointment via `rescheduleAppointment`.
- Terminal/goodbye guard: responses with questions, elicitation, missing info, no availability, or “I can help / what would you like” stay `InProgress`, `conversationComplete=false`.

## Tests

- `npm run test:lambda`: PASS, 81 tests.
- `npm run test:api`: PASS, 128 tests.
- `npm run typecheck:api`: PASS.
- `npm run typecheck:app`: PASS.
- `npm run build:api`: PASS.
- `npm run build:app`: PASS; Vite emitted existing chunk-size warning.
- `npm test`: PASS (`test:lambda` 81 tests + `test:api` 128 tests).
- `git diff --check`: PASS.
- `git status --short`: repo still has unrelated untracked files from before this run; changed files are listed above.

## Deployment

- Not deployed.
- Read-only references captured:
  - Lambda booking handler: `fastaibooking-booking-handler`, `$LATEST`, CodeSha256 `OUEQkvAsRQ80NSgyBaM39CvyiX1r0/v7aSPFqLlWVcU=`, LastModified `2026-07-10T18:51:44.000+0000`.
  - Lex live alias: bot `KHMIXGA2US`, alias `JVIPIZDYE3`, alias name `prod`, bot version `27`.
- Rollback reference: unchanged live Lambda/Lex references above.

## Lee Cleanup

- NOT EXECUTED.
- Current `DATABASE_URL` resolves to local development: `postgresql://postgres:***@localhost:5432/fastaibooking`.
- Target production/cleanup database was not established, so no destructive customer cleanup was run.
- Target requested: salon `9bd14a12-85ed-418a-af7d-3f5cb329c147`, customer Lee, phone `+84******1999`.
- Matched customer count: not queried against target DB.
- Canceled appointment count: 0 executed.
- Hard/privacy deleted count: 0 executed.
- Verification: not applicable because cleanup was not executed.

## Remaining Risks

- Reschedule selection for multiple upcoming appointments still asks the caller to choose and does not self-select; this is intentional for ambiguity.
- Lex live version 27 still lacks reschedule sample utterances; Lambda/API deterministic repair covers clear existing-appointment-change transcripts without publishing Lex.
