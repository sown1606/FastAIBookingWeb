# Agent Run Report: 2026-07-14 Thuyet Cancel, Voice, Disconnect

## Scope

Fixed and deployed three verified production issues for Kiet Nails & Beauty:

- Active calendar/schedule surfaces now exclude `CANCELED`, `NO_SHOW`, and `COMPLETED` appointments while preserving those records in history/archive/detail views.
- Voice booking now handles the production-shaped Full Set and Trang ASR variants without renaming the service `Full Set`.
- Amazon Connect AI Reception recovery no longer promises a next prompt and then immediately disconnects.

Evidence is saved under:

`docs/report-artifacts/2026-07-14-thuyet-cancel-voice-disconnect/`

## Production Window Investigated

- Tester timezone: `Asia/Ho_Chi_Minh`
- Vietnam time: `2026-07-14 08:50-09:00`
- UTC: `2026-07-14 01:50-02:00`
- Caller: `+********1999`
- Called number: `+********7681`
- Salon: `Kiet Nails & Beauty`
- Salon ID: `9bd14a12-85ed-418a-af7d-3f5cb329c147`
- Amazon Connect instance ID: `74f78377-766f-46b7-a745-4bc97b68a8dc`
- Lex bot/alias: `KHMIXGA2US` / `JVIPIZDYE3`
- Lambda: `fastaibooking-booking-handler`
- AWS region: `us-east-1`

## Production Contacts

| Contact ID | Initial Contact ID | Initiated UTC | Disconnected UTC | DB/Application result |
| --- | --- | --- | --- | --- |
| `ef6a0ced-1184-4f6c-8aac-2810f251ae8b` | none | `2026-07-14T01:50:47.101Z` | `2026-07-14T01:50:58.514Z` | No DB call session; likely disconnected before Lambda/API invocation. |
| `68ea028d-99f5-43a9-8f23-3d533dba18de` | none | `2026-07-14T01:51:37.031Z` | `2026-07-14T01:52:49.883Z` | Call session `31a39e9a-a313-49ab-8940-34409e208995`; missing `staffPreference`. |
| `99bee132-e91e-470d-931d-9f1f51912350` | none | `2026-07-14T01:55:27.778Z` | `2026-07-14T01:56:45.479Z` | Call session `90f096f0-1e1a-43b7-954a-e6b846ff858a`; missing `staffPreference`. |
| `094477c4-6d2a-4c1a-b54f-94369fa652ed` | none | `2026-07-14T01:57:14.275Z` | `2026-07-14T01:57:25.913Z` | No DB call session; likely disconnected before Lambda/API invocation. |
| `1d5020e9-fdfa-466a-8224-9f68280ccf6f` | none | `2026-07-14T01:58:21.994Z` | `2026-07-14T01:58:56.540Z` | Call session `806f7385-d8da-4a8a-8e62-ba03c42ff3b1`; reached final confirmation after `trang`. |

Disconnect reason was not available in the returned contact details. Contact attributes and details are saved as sanitized JSON artifacts.

## ASR Transcripts and Application Correlation

- Contact `1d5020e9-fdfa-466a-8224-9f68280ccf6f`:
  - `book full set tomorrow at two pm with frank`
  - Preserved `Full Set`, `2026-07-14`, `2 PM`; staff missing.
  - `book full set tomorrow at two pm with trang`
  - Resolved `Trang` and reached final confirmation.
- Contact `99bee132-e91e-470d-931d-9f1f51912350`:
  - `book princess tomorrow at two pm with jen`
  - Initially did not map service because the `princess` correction only matched the entire transcript.
  - Later service resolved to `Full Set`; `jen` did not resolve to staff.
- Contact `68ea028d-99f5-43a9-8f23-3d533dba18de`:
  - `at two p m we hang`
  - `food set tomorrow`
  - `food set tomorrow at two p m with hang`
  - `food set` correctly resolved to `Full Set`; `hang` did not resolve to staff.

Production DB fixtures confirmed:

- Active `Full Set` service ID: `41241879-49bf-42ba-a6d1-d7da9809d334`
- Active bookable `Trang` staff ID: `903511ee-4849-43dd-85fb-73595e79a233`
- Trang is mapped to Full Set through staff-service mapping `bab25d97-db08-46ea-96e8-2015cdb9c776`
- No active exact staff named `Frank`, `Jen`, or `Hang`
- No active exact service named `Princess`

## Root Causes

### Issue 1: Canceled Appointments Visible on Active Calendars

Canceled appointments are intentionally persisted as historical records with `status = CANCELED`. The UI bug was that active schedule collections did not uniformly re-apply the shared operational-status helper. In particular, staff Basic-mode selected-day rendering used raw `selectedDayAppointments`, so `CANCELED`, `NO_SHOW`, and `COMPLETED` records could still render as active blocks. Cancel actions also waited for a full reload, leaving the selected detail/card and local active collections stale after a successful cancel.

### Issue 2: Full Set and Trang Recognition

The guarded `princess -> Full Set` correction only accepted a transcript where the entire normalized text was `princess`. It missed one-shot booking text such as `book princess tomorrow at two pm with jen`.

Trang aliases did not include the verified production ASR confusions `frank`, `jen`, and `hang`. There was also no explicit collision-safe, context-scoped ASR-confusion mechanism shared between Lambda pre-processing and API staff resolution. Lambda and API could therefore preserve service/date/time but repeatedly fail staff clarification. Lambda also had a no-input fallback that could auto-select `Any staff`, which is unsafe for this failure mode.

### Issue 3: Greeting/Recovery Disconnect

The active AI Reception Connect flow contained a reachable recovery action with this prompt:

`I am having technical trouble continuing this call. Please call again, or press 0 on the next prompt for a person.`

That action immediately routed to `DisconnectParticipant`, so there was no next prompt. Two short incident contacts produced no DB session or Lambda evidence, which is consistent with failure before the application handler. Connect instance attributes showed contact flow logs and Contact Lens enabled, but CloudWatch Connect and Lex event searches for the window returned zero events; Lambda logs existed for the contacts that reached Lambda.

## Files Inspected

- `apps/app/src/pages/appointments-page.tsx`
- `apps/app/src/lib/appointment-status.ts`
- `apps/app/src/pages/dashboard-page.tsx`
- `apps/app/src/pages/call-center-page.tsx`
- `apps/api/src/modules/ai/ai.service.ts`
- `infra/lambda/booking-handler/index.mjs`
- `infra/aws/connect/contact-flows/ai-reception.json`
- `infra/aws/lex/FastAIBookingBot-v10/`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/test/ai-internal.test.ts`
- Production Connect contact details, attributes, active contact flow export, Lex alias, Lambda config, Lambda logs, DB call sessions, booking attempts, AI interaction logs, services, staff, staff-service mappings, and appointment samples.

## Files Changed

- `apps/app/src/lib/appointment-status.ts`
- `apps/app/src/pages/appointments-page.tsx`
- `apps/api/src/modules/ai/ai.service.ts`
- `infra/lambda/booking-handler/index.mjs`
- `infra/aws/connect/contact-flows/ai-reception.json`
- `apps/api/test/ai-internal.test.ts`
- `apps/api/test/ui-source-contracts.test.ts`
- `tests/lambda/booking-handler.test.mjs`
- `docs/AGENT_RUN_REPORT_2026-07-14_thuyet_cancel_voice_disconnect.md`
- `docs/report-artifacts/2026-07-14-thuyet-cancel-voice-disconnect/*`

## Implementation Decisions

- Reused the existing operational-status helper and added `filterOperationalAppointments` instead of duplicating status arrays.
- Kept `CANCELED`, `NO_SHOW`, and `COMPLETED` in archive/history/detail paths.
- After cancel, active local appointment collections are updated immediately, selected details are cleared when they reference the canceled appointment, and the page silently reloads.
- Added silent schedule revalidation on window focus, document visible, and a 20-second visible-page interval without toggling full-page loading state.
- Kept `Full Set` as the service name; never introduced `Acrylic Full Set`.
- `princess` is only corrected in a grounded service/booking context, and the API first checks whether an exact active service named `Princess` exists.
- Added scoped Trang ASR confusion handling for `frank`, `jen`, and `hang` in both Lambda and API.
- Exact active staff names always win over the Trang confusion map.
- Trang confusion only applies in staff collection, staff DTMF, or explicit staff wording contexts and only when Trang is active/bookable/eligible for the requested service.
- Removed the Lambda no-input path that auto-selected `Any staff`.
- Changed the final Connect recovery step into a real Lex input collection that allows speech retry and DTMF `0`, then routes final errors to an explicit goodbye.
- Did not create a Lex version because no Lex source changed.

## Tests Added

- Calendar/source-contract tests for operational-only active surfaces, canceled selected-appointment local state clearing, and silent background revalidation without full-page loading flicker.
- API tests for production-shaped phrases:
  - `book full set tomorrow at two pm with frank`
  - `book princess tomorrow at two pm with jen`
  - `food set tomorrow at two p m with hang`
  - `book full set tomorrow at two pm with trang`
- API collision/safety tests for exact `Frank`, `Jen`, `Hang`, customer name `Jen`, time correction text, unrelated `princess`, exact active `Princess`, one session/log, no duplicate appointment before confirmation.
- Lambda tests for the same production-shaped phrases, exact dynamic staff collisions, customer-name safety, time-correction safety, and preserved known slots.
- Connect flow contract tests proving primary/recovery Lex errors route to bounded input opportunities, no reachable prompt says `next prompt` before disconnect, and operator transfer routes only through the explicit transfer flag.

## Commands and Results

| Command | Result |
| --- | --- |
| `git status --short --branch` | Confirmed dirty tree before edits; preserved unrelated `fastaibooking-current-state.zip` and pre-existing docs/artifacts. |
| AWS Connect `search-contacts` for `2026-07-14T01:50:00Z` through `2026-07-14T02:00:00Z` | Found five matching contacts listed above. |
| AWS Connect `describe-contact`, `get-contact-attributes` | Saved sanitized per-contact artifacts. |
| AWS Connect `describe-contact-flow` for AI Reception | Exported active production flow before and after deployment. |
| AWS Lex `describe-bot-alias` | Alias `JVIPIZDYE3` was `Available`; after deployment still `Available`, bot version `31`. |
| AWS Lambda `get-function-configuration` | Saved sanitized before/after config. |
| CloudWatch log searches for Connect/Lex/Lambda window | Lambda returned 74 events; Connect and Lex searches returned 0 events in the queried groups. |
| Production DB queries | Verified service/staff/mapping fixture, call sessions, booking attempts, AI interaction logs, and persisted canceled appointments. |
| `node --check infra/lambda/booking-handler/index.mjs` | Passed. |
| `npm run test:lambda` | Passed; 113 tests. |
| `npm run test:api` | Passed after tightening the new source-contract regex; 238 tests. |
| `npm run typecheck:api` | Passed. |
| `npm run typecheck:app` | Passed. |
| `npm run typecheck:admin` | Passed. |
| `npm run build:api` | Passed. |
| `npm run build:app` | Passed with existing Vite large-chunk warnings only. |
| `npm run build:admin` | Passed with existing Vite large-chunk warnings only. |
| `npm test` | Passed; Lambda 113 tests and API 238 tests. |
| `git diff --check` | Passed. |
| `aws lambda update-function-code` | Deployed `fastaibooking-booking-handler`. |
| `npm run deploy:ec2` | Deployed API/app/admin stack to EC2; no pending migrations. |
| `aws connect update-contact-flow-content` | Deployed AI Reception flow. |
| `./infra/scripts/smoke_test_production.sh` | Passed read-only production health smoke. |

## Test Totals

- Lambda test suite: 113 passing.
- API test suite: 238 passing.
- Top-level `npm test`: passed, including the same Lambda/API suites.
- Typechecks: API, app, and admin all passed.
- Builds: API, app, and admin all passed.

## Deployment Identifiers and Hashes

### Lambda

- Function: `fastaibooking-booking-handler`
- Last modified: `2026-07-14T04:32:04.000+0000`
- Revision ID: `b6dc7251-ee0e-4438-9910-ffaaf011165f`
- Code SHA256: `qyfOhI3h0G24hoyap8eW2y9jhhq/j/3/Mj0TWYqP7Fc=`
- Last update status: `Successful`
- State: `Active`

### EC2 Deploy

- API image: `fastaibooking-api 67791dc919d8`
- App image: `fastaibooking-app 867d2e5ff5de`
- Admin image: `fastaibooking-admin b724db701327` (cached because admin source did not change)

### Connect Flow

- Flow: AI Reception
- Flow ID: `dcccf542-587c-426c-a644-a4c6f24da6e4`
- After deployment, active production source hash matched checked-in source:
  - `425eba27a1ec85f5892734161c9cad7747ae9b9dde4592b4e7099aef83c661ea`
- Normalized structure hash:
  - `38010c01f1ac42451e05ef987d9e0f1db0fd3ae7138aa06b32e8ac46efa4c797`
- Flow state/status after deploy: `ACTIVE` / `PUBLISHED`

### Lex

- Bot ID: `KHMIXGA2US`
- Alias ID: `JVIPIZDYE3`
- Alias name: `prod`
- Bot version: `31`
- Alias status after deploy: `Available`
- No new Lex version was created.

## Active Connect Flow Comparison

Before deployment, active production and checked-in source both contained the broken terminal recovery route. The only normalized active/source drift observed before deployment was non-routing greeting text; the broken recovery shape was present in both.

After deployment, `infra/aws/connect/contact-flows/ai-reception.json` and the active production AI Reception export have identical file hash and normalized structure hash. The final recovery action is now `ConnectParticipantWithLexBot`, accepts voice again, allows `0` through Lex/Lambda transfer intent, and sends final repeated errors to an explicit goodbye instead of a misleading prompt followed by immediate disconnect.

## Synthetic Smoke Results

### API Voice Smoke

Four production-shaped API smokes passed:

- `smoke-20260714-api-frank`: `book full set tomorrow at two pm with frank`
- `smoke-20260714-api-princess-jen`: `book princess tomorrow at two pm with jen`
- `smoke-20260714-api-food-hang`: `food set tomorrow at two p m with hang`
- `smoke-20260714-api-trang`: `book full set tomorrow at two pm with trang`

All returned HTTP 200, `ConfirmIntent`, message containing `Full Set tomorrow at 2 PM with Trang`, one call session, one booking attempt, one AI interaction, sticky service/date/time/staff slots, and no appointment before final confirmation.

### Lambda Voice Smoke

Four deployed Lambda smokes passed for the same phrases:

- Lambda status code 200
- No function error
- `ConfirmIntent`
- `serviceName = Full Set`
- `requestedDate = 2026-07-15`
- `requestedTime = 2 PM`
- `staffPreference = Trang`
- `staffId = 903511ee-4849-43dd-85fb-73595e79a233`

### Production Health Smoke

Read-only production smoke passed:

- Admin frontend: 200
- App frontend: 200
- Health liveness/readiness: 200
- API health liveness/readiness: 200

## Calendar Smoke and Cleanup

Temporary smoke marker: `SMOKE_CANCEL_20260714_1784003955677`

- Created temporary customer: `6053a45c-98e9-4ecc-b455-b7a2bd2f6c73`
- Created temporary future appointment: `4b500f49-407d-43a7-bdd7-7e1eb5679a82`
- Start time: `2030-07-14T18:00:00.000Z`
- Created status: `SCHEDULED`
- Verified active schedule contained appointment before cancel.
- Canceled through API; returned status `CANCELED`.
- Verified `SCHEDULED`, `CONFIRMED`, and `IN_PROGRESS` active queries did not contain appointment after cancel.
- Verified canceled archive contained appointment after cancel.
- Verified explicit detail by ID returned `CANCELED`.
- Permanently deleted only the temporary smoke appointment.
- Cleanup check: remaining smoke appointment count `0`, remaining smoke customer count `0`.

## Production Debug Data for Synthetic Calls

Saved to `production-synthetic-debug-summary.json`.

For all synthetic API and Lambda contacts:

- One call session per contact.
- One booking attempt per contact.
- One AI interaction per contact.
- Slots stayed sticky.
- No repeated service/date/time collection.
- No appointment was created before final confirmation.
- No duplicate appointment was created.

## Artifacts

Key artifacts include:

- `connect-search-contacts-0150-0200.json`
- `connect-contact-summary.tsv`
- `contact-detail-*.json`
- `contact-attributes-*.json`
- `lambda-turn-summary.tsv`
- `db-call-sessions.tsv`
- `db-booking-attempts.tsv`
- `db-ai-interactions.tsv`
- `db-services-staff.tsv`
- `db-fullset-trang-mapping.tsv`
- `db-historical-appointments-sample.tsv`
- `ai-reception-active-before.json`
- `ai-reception-active-after.json`
- `connect-flow-file-hashes.txt`
- `lex-prod-alias-before.json`
- `lex-prod-alias-after.json`
- `lambda-booking-handler-before-sanitized.json`
- `lambda-booking-handler-after-sanitized.json`
- `production-api-voice-smoke.json`
- `production-lambda-voice-smoke.json`
- `production-calendar-cancel-smoke.json`
- `production-smoke-cleanup-check.json`
- `production-health-smoke.txt`

## Remaining Risks

- Connect and Lex CloudWatch searches returned no events for the incident window even though instance-level logging attributes were enabled. The flow now has bounded recovery, but a future failure before Lex/Lambda invocation may still depend on CTR/log delivery behavior to provide a detailed trace.
- Synthetic voice smokes invoked API and Lambda directly; they did not place live PSTN calls.
- The admin Docker image was cached because admin source did not change.

## Commit and Push

- Implementation commit: `1e72d56` (`fix: stabilize canceled calendars and accented voice booking`)
- Report/artifact commit: created after this report content.
- Push result: branch push to the configured remote is performed after report commit creation; the final assistant response records the remote result.
