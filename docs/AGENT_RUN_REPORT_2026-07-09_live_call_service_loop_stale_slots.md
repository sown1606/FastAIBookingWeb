# Agent Run Report: Live Call Service Loop Stale Slots

Date: 2026-07-09

## Incident

- Live call session: `a5e4a9d8-0930-43ea-9772-dc31985f6ce2`
- Amazon Connect ContactId: `a1738e9e-fd50-493f-a7ce-2afaff660573`
- Caller: `+********1999`
- Called number: `+********7681`
- Caller turn: `ah i want full set`

## Root Cause

For ContactId `a1738e9e-fd50-493f-a7ce-2afaff660573`, Lex correctly resolved `serviceName=Full Set` from the current turn, but the Lambda/API state merge still trusted old session attributes from a previous turn.

`requestedTime=4 PM` appeared even though the caller only said Full Set because it was stale state already present in `sessionAttributes`. The current transcript did not contain a real time and `requestedDate` was still missing, but the prior flow allowed the old `requestedTime` attribute to survive and be sent forward.

`lastAskedSlot` stayed `serviceName` because the response merge did not always rewrite session attributes to the actual slot being elicited after service recognition. The bot asked for date, but the attributes still made later turns look like the service prompt was active.

The same family of issues also affected ViberOut DTMF slot pollution: when service digit `4` was pressed, Lex could populate unrelated date/time/staff slots from the same input. The Lambda now scopes service-prompt DTMF so only `serviceName` can be updated.

## Fixes

- `Full Set` recognition now sets both `serviceName` and `confirmedServiceName`.
- When the current Full Set turn has no date/time and date is missing, stale previous `requestedTime` is cleared before API calls and before session persistence.
- After recognizing service, `lastAskedSlot` is set to the actual next elicited slot, such as `requestedDate`.
- Service loop counters are reset when leaving `serviceName`.
- Confirmed `Full Set` is preserved across later date, time, and name turns, and the service menu is not re-elicited unless the caller explicitly changes service.
- `tomorrow` is parsed as salon-local tomorrow when `lastAskedSlot=requestedDate`.
- Spoken `number four` now maps to service DTMF option 4 when the last asked slot is `serviceName`.
- DTMF service digit `4` clears polluted `requestedDate`, `requestedTime`, `staffPreference`, and similar non-service slot values when they came from the same digit/noise.
- Full Set speech aliases include `phone set`, `full set`, `fullset`, `full said`, `full sit`, `full sat`, `full sell`, and `fo set`; the canonical output remains exactly `Full Set`.
- Invalid one-letter staff noise such as `m` is not persisted or sent to the API.
- Lambda per-turn structured debug is logged and included in API request/response payloads.
- Admin AI Log detail now has `Copy full call debug JSON`, backed by `GET /api/v1/admin/ai-logs/:id/debug`.

## Full Debug JSON

Available in Admin. Open an AI Log detail page and click `Copy full call debug JSON`.

The endpoint returns call session data, ordered AI interactions, booking attempts, transcripts, contact IDs, caller/called numbers, and a per-turn timeline containing request/response text, slots, session attributes before/after, last asked slot before/after, missing fields, transfer flags, parsed output, and raw request/response payloads.

## Files Changed

- `infra/lambda/booking-handler/index.mjs`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/admin/admin.routes.ts`
- `apps/admin/src/pages/ai-log-detail-page.tsx`
- `apps/admin/src/lib/i18n.tsx`
- `docs/AGENT_RUN_REPORT_2026-07-09_live_call_service_loop_stale_slots.md`

## Tests Added or Updated

- `ah i want full set` with stale `requestedTime=4 PM` clears time, confirms Full Set, elicits `requestedDate`, and sets `lastAskedSlot=requestedDate`.
- Full Set followed by `tomorrow` preserves service and elicits the next missing field.
- Full Set followed by `tomorrow`, then `3 PM`, preserves service across all turns and never asks service again.
- Polluted DTMF 4 keeps only `serviceName=Full Set` and clears polluted date/time/staff.
- `number four` maps to `Full Set` when `lastAskedSlot=serviceName`.
- `phone set` resolves to canonical `Full Set`.
- `I want to book a phone set tomorrow at 3 PM with Trang` keeps service/date/time/staff.
- One-letter staff noise is cleared and not sent as API `staffPreference`.
- Existing press-0 and backend-timeout tests remain passing.

## Commands and Results

- `npm run test:lambda`: passed, 49 tests.
- `npm run test:api`: passed, 72 tests.
- `npm run typecheck:api`: passed.
- `npm run build:api`: passed.
- `npm run typecheck:admin`: passed.
- `npm run build:admin`: passed. Vite emitted only the existing chunk-size warning.
- `node --check infra/lambda/booking-handler/index.mjs`: passed.
- `git diff --check`: passed.
- Cleanup search for `AI services not available` and `Acrylic Full Set` in active Lambda/API/Admin/test paths: no matches.

## Deploy Result

- Lambda `fastaibooking-booking-handler` deployed successfully.
  - LastModified: `2026-07-09T09:11:13.000+0000`
  - CodeSha256: `5j0SCvnElun+T8xtA/y2tsETl1tnu6ovyIKxUPS1+og=`
  - LastUpdateStatus: `Successful`
- API/Admin EC2 deployment completed successfully via `npm run deploy:ec2`.
  - Docker Compose rebuilt `api`, `admin`, and `app`.
  - No pending Prisma migrations.
  - `fastaibooking-api` restarted and is healthy.
  - `fastaibooking-admin` restarted.
  - Nginx reloaded successfully.

## Retest Cases

- Live caller says `ah i want full set` after stale `requestedTime=4 PM`: should ask requested date, not keep 4 PM, and `lastAskedSlot` should be `requestedDate`.
- Caller then says `tomorrow`: should set salon-local requested date, keep `Full Set`, and ask requested time.
- Caller then says `3 PM`: should set requested time, keep `Full Set`, and never ask service again.
- Caller presses DTMF `4` from service prompt with Lex-polluted slots: should keep only `serviceName=Full Set` and clear fake date/time/staff.
- Caller says `number four` from service prompt: should map to `Full Set`.
- Caller presses `0`: should still transfer to operator.
- Backend timeout: should reprompt safely and not auto-transfer.
- Admin AI Log detail: `Copy full call debug JSON` should copy the ordered full-call timeline.
