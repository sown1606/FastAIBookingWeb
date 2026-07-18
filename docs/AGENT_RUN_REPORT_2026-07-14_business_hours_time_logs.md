# Agent Run Report: Business Hours, Time Parsing, Logs

Date: 2026-07-14
Repository: FastAIBooking production repo
Salon: Kiet Nails & Beauty (`9bd14a12-85ed-418a-af7d-3f5cb329c147`)
Called number: `+********7681`
Caller in evidence: `+********1999`

## Root Causes

1. Closed Friday was detected too late because staff resolution and staff-menu generation could run before the booking request was gated by the requested appointment day. The DB already had Friday closed; the flow order was wrong.
2. `uh ten eight ten a m` was silently grounded to the Lex time slot `08:10`, even though the current-turn transcript contained competing `10 AM` evidence. The Lambda/API path trusted one slot value too early.
3. Business Hours existed but was hidden in Owner Basic UI. Basic mode is always active, but `/business-hours` was missing from Basic navigation and dashboard/settings entry points.
4. Admin logs mixed synthetic and real calls by default. AI Logs defaulted `includeSynthetic` to true, Call Logs had no matching filter, and `codex-*` smoke rows were indistinguishable unless inspected manually.
5. Repeated nonterminal failures created new `BookingAttempt` rows instead of reusing one logical attempt for the same call/request fingerprint.
6. Amazon Connect calls stayed `IN_PROGRESS` because application upserts rewrote active status and the API runtime had no AWS credential provider for provider reconciliation.

## Files Inspected

- Current-state source archive: `fastaibooking-current-state.zip`
- Prior provider/debug run: `docs/AGENT_RUN_REPORT_2026-07-14_thuyet_service_staff_exclusion_disconnect.md`
- Prior GPT debug export sample: `docs/report-artifacts/2026-07-14-thuyet-service-staff-exclusion-disconnect/debug-gpt-export-sample.json`
- Production AWS resources: Lambda `fastaibooking-booking-handler`, Lex bot alias `KHMIXGA2US/JVIPIZDYE3`, Connect instance `74f78377-766f-46b7-a745-4bc97b68a8dc`, flow `dcccf542-587c-426c-a644-a4c6f24da6e4`
- Production DB tables: `BusinessHour`, `CallSession`, `BookingAttempt`, `AIInteractionLog`, `CallTranscript`, `CallEscalation`
- Production Lambda logs for contacts `aac7cf9b-2b95-4b9a-bda4-656ee771b194` and `f6c5beba-b17c-413c-b8a5-2b21a0e62932`

## Files Changed

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/calls/calls.service.ts`
- `apps/api/src/modules/admin/admin.routes.ts`
- `apps/admin/src/pages/ai-logs-page.tsx`
- `apps/admin/src/pages/calls-page.tsx`
- `apps/admin/src/lib/i18n.tsx`
- `apps/app/src/components/layout.tsx`
- `apps/app/src/pages/dashboard-page.tsx`
- `apps/app/src/pages/salon-profile-page.tsx`
- `apps/app/src/pages/business-hours-page.tsx`
- `apps/app/src/lib/i18n.tsx`
- Tests in `tests/lambda/booking-handler.test.mjs`, `apps/api/test/ai-internal.test.ts`, `apps/api/test/ui-source-contracts.test.ts`, `apps/api/test/role-guards.test.ts`

## Before/After Call Order

Before:

1. Resolve salon.
2. Collect service/date/time.
3. Ask/resolve staff and build staff menus.
4. Run availability/business-hours checks.
5. Return closed/outside-hours only after staff had already been discussed.

After:

1. Resolve salon.
2. Load the requested salon business-hours records from DB.
3. Collect service/date/time.
4. As soon as requested date is known, reject closed days before staff parsing/menu/availability.
5. Once service/date/time are known, verify service duration fits business hours before staff availability.
6. Only then resolve staff, build DTMF staff menu, or run availability.

Closed-day response now keeps `conversationComplete=false`, sets `lastAskedSlot=requestedDate`, clears only the invalid requested date, preserves trusted service/time/customer fields, and sets `availabilityReasonCode=SALON_CLOSED`.

## Time Parsing Decisions

- Clear `10 AM`, `ten AM`, `at ten`, and `ten o'clock` normalize to `10 AM`.
- Clear `8:10 AM` and `eight ten AM` normalize to `8:10 AM`.
- `uh ten eight ten a m` now produces candidates `10 AM` and `8:10 AM`, selects `10 AM` as the clarification target, and asks `Did you mean 10 AM?`.
- Business-hours and availability checks are blocked while `awaitingTimeConfirmation=true`.
- Diagnostics include raw transcript, Lex slot, extracted candidates, selected candidate, ambiguity reason, and final normalized time when confirmed.

## Owner UI Changes

- Basic owner navigation now includes `/business-hours`.
- Owner dashboard now exposes a Business Hours action.
- Salon Settings now includes a clear Business Hours link.
- Business Hours page prevents duplicate saves, shows saving state, validates open/close ranges locally, submits closed days with null times, disables time inputs while closed, and shows API validation errors.
- English and Vietnamese labels were kept in sync.

## Production Business Hours

Source: `docs/report-artifacts/2026-07-14-business-hours-time-logs/db-business-hours-before.csv`

- Sunday: 09:00-18:00
- Monday: 09:00-18:00
- Tuesday: 09:00-18:00
- Wednesday: 09:00-18:00
- Thursday: 11:00-18:00
- Friday: Closed (`openTime=null`, `closeTime=null`)
- Saturday: 09:00-18:00
- Timezone: `America/New_York`

Friday remained closed; no schedule was hardcoded.

## Production Evidence

Case 1, closed Friday:

- CallSession: `ac7dcda2-e25a-4264-8bfd-d1d859492aab`
- Contact: `aac7cf9b-2b95-4b9a-bda4-656ee771b194`
- Provider started: `2026-07-14T14:47:15.191Z`
- Provider disconnected: `2026-07-14T14:48:51.093Z`
- Before app row: `IN_PROGRESS`, `endedAt=null`
- Duplicate attempts before: 4 `NO_AVAILABILITY` rows for the same closed Friday request

Case 2, noisy time:

- CallSession: `b0dfdced-9256-4b1f-a91a-57b43d5db6c1`
- Contact: `f6c5beba-b17c-413c-b8a5-2b21a0e62932`
- Provider started: `2026-07-14T14:55:46.508Z`
- Provider disconnected: `2026-07-14T14:58:06.436Z`
- Before app row: `IN_PROGRESS`, `endedAt=null`
- Duplicate attempts before: 3 `NO_AVAILABILITY` rows for `8:10 AM`

Amazon Connect `describe-contact` did not return a disconnect reason field for these contacts; it did return authoritative initiation and disconnect timestamps.

## Logging and Finalization

- `upsertAmazonConnectCallSession` no longer downgrades terminal sessions to `IN_PROGRESS`.
- Admin Call Logs now supports `includeSynthetic=false` by default and labels Test/Smoke rows when enabled.
- Admin AI Logs now defaults `includeSynthetic=false`.
- Synthetic identity detection uses `codex-*` ContactIds and explicit synthetic metadata.
- BookingAttempt writes now use a normalized request fingerprint and update the active logical failed attempt instead of inserting repeated identical `NO_AVAILABILITY` rows.
- Empty/silent turns remain AI turn history and do not create logical booking attempts.
- Provider reconciliation is available in admin call list/detail. The EC2 API runtime was configured with AWS credentials after deploy so `DescribeContact` can populate terminal status, `endedAt`, and `durationSeconds`.

After reconciliation:

- Friday session: `COMPLETED`, `endedAt=2026-07-14T14:48:51.093Z`, `durationSeconds=77`
- Noisy-time session: `COMPLETED`, `endedAt=2026-07-14T14:58:06.436Z`, `durationSeconds=124`

## Log Counts and Cleanup

Before this run's smoke tests:

- Synthetic CallSession: 42
- Synthetic AIInteractionLog: 42
- Synthetic BookingAttempt: 42
- Synthetic CallTranscript: 52
- Synthetic CallEscalation: 6

Before cleanup after verification smokes:

- Synthetic CallSession: 47
- Synthetic AIInteractionLog: 47
- Synthetic BookingAttempt: 47
- Synthetic CallTranscript: 57
- Synthetic CallEscalation: 6
- Conclusive synthetic Appointment: 0
- Conclusive synthetic Customer: 0

Deleted:

- AIInteractionLog: 47
- BookingAttempt: 47
- CallTranscript: 57
- CallEscalation: 6
- CallEvent: 0
- CallSession: 47
- Appointment: 0
- Customer: 0

After cleanup:

- Synthetic CallSession: 0
- Synthetic AIInteractionLog: 0
- Synthetic BookingAttempt: 0
- Synthetic CallTranscript: 0
- Synthetic CallEscalation: 0

No UUID Amazon Connect ContactIds and no real caller rows were deleted based only on caller phone.

## Tests

All requested local checks passed:

- `node --check infra/lambda/booking-handler/index.mjs`
- `npm run test:lambda`: 122/122 passed
- `npm run test:api`: 257/257 passed
- `npm run typecheck:api`
- `npm run typecheck:admin`
- `npm run typecheck:app`
- `npm run build:api`
- `npm run build:admin`
- `npm run build:app`
- `npm test`: reran Lambda and API suites successfully
- `git diff --check`

Build warnings: existing Vite chunk-size warnings for owner/admin bundles.

## Deployment

API/admin/owner app:

- Command: `npm run deploy:ec2`
- Result: success
- Migrations: no pending migrations
- API container: healthy
- Nginx config test/reload: success

Lambda:

- Function: `fastaibooking-booking-handler`
- Runtime: `nodejs20.x`
- Previous CodeSha256: `/Jrie6LOEr660QHwgQ+UalDPqTHS4mRBf/Xam/5gVpM=`
- New CodeSha256: `ThAinKBwyK/n1rI9giHkspSDDGfOOs8mmdYFkJxYxyg=`
- RevisionId: `4c5d29e0-c286-4495-9b3b-dbc9d50778da`
- LastModified: `2026-07-14T16:12:06.000+0000`
- Zip sha256: `4e10229ca070c8afe7d6b23d8221e4b294830c67ce3acf2699d605909c58c728`

Connect/Lex:

- No Connect or Lex source changes were deployed for this task.
- Lex alias `JVIPIZDYE3` remained `Available`, bot version `31`.
- Inbound number association: `+********7681`/phone ID `f2e36faa-5264-4955-8a18-e2f53755c102` routes to flow `dcccf542-587c-426c-a644-a4c6f24da6e4`.
- Active Connect flow hash equals source hash: `321d4cd84f370fad0a5745688dfbf336791ed960f8ce3121bcb41b48f19bbb65`.

## Production QA

Health:

- `https://api-new-nail.kendemo.com/health`: ok
- `https://api-new-nail.kendemo.com/api/v1/health`: ok
- `https://app-new-nail.kendemo.com/business-hours`: HTTP 200
- `https://admin-new-nail.kendemo.com/calls`: HTTP 200

Deployed Lambda smokes:

- Friday closed smoke returned `ElicitSlot(requestedDate)` with `We are closed on Friday... What other day works for you? You can also press 0 for a person.`
- Noisy time smoke returned `ElicitSlot(requestedTime)` with `Did you mean 10 AM?`
- Clear 10 AM smoke returned `ElicitSlot(staffPreference)` and preserved `requestedTime=10 AM`.

Deployed API smokes:

- Friday closed: `NO_AVAILABILITY`, `availabilityReasonCode=SALON_CLOSED`, `appointmentId=null`
- Noisy time: `MISSING_INFO`, `awaitingTimeConfirmation=true`, `proposedRequestedTime=10 AM`, `appointmentId=null`
- Clear 10 AM: `MISSING_INFO`, staff menu active, `requestedTime=10 AM`, `appointmentId=null`

No permanent appointments were created by the smokes.

## Artifacts

Sanitized artifacts are under:

`docs/report-artifacts/2026-07-14-business-hours-time-logs/`

Key files:

- `db-business-hours-before.csv`
- `db-case-call-sessions-before.csv`
- `db-case-call-sessions-after.csv`
- `db-case-booking-attempts-before.csv`
- `lambda-smoke-summary.json`
- `api-smoke-summary.json`
- `db-synthetic-counts-before-cleanup.csv`
- `db-synthetic-cleanup-deleted.csv`
- `db-synthetic-counts-after-cleanup.csv`
- `connect-flow-active-after.json`
- `connect-flow-associations-after.json`
- `lex-alias-after.json`
- `lambda-get-function-post-smoke.json`

## Git

Implementation commit hash: `d3e8dcea7c2424fb45f038dbd9472d380a3840dc`
Push result: `git push` succeeded to `github.com-sown1606:sown1606/FastAIBookingWeb.git`, updating `main` from `fe807d5` to `d3e8dce`.

## Remaining Risks

- Provider finalization reconciliation now works in production after configuring AWS credentials for the API runtime. A future infrastructure hardening pass should replace static runtime credentials with an EC2 instance role or task role.
- Amazon Connect did not expose disconnect reason for the two named contacts through `describe-contact`; provider timestamps were available and used.
