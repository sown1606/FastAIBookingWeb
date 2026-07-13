# Confirmation Phrase and Staff Availability Hotfix Report

## Scope

Production P0 hotfix for the Amazon Connect -> Lex -> booking Lambda -> internal AI appointment API flow. The fix is limited to final-confirmation/control phrase handling, trusted staff preservation, and regression coverage around requested-staff availability outcomes.

## Production Call Evidence

- Call session: `09e0b976-f7c0-492c-930a-3ce7cb3d3eee`
- Amazon Connect ContactId: `bde2fcc0-e891-49fe-b9e1-ca181d69e342`
- Salon: `Kiet Nails & Beauty`
- Salon ID: `9bd14a12-85ed-418a-af7d-3f5cb329c147`
- Staff chosen before failure: Alex, `ad1786ae-a0ec-4521-9efc-47cb9ee30b4c`
- Failure turn: caller said `go ahead`
- Bad state before fix: `requestedStaff = go ahead`, `staffPreference = go ahead`, `missingFields = ["staffPreference"]`

## Root Cause

The Lambda and API both allowed short confirmation/control phrases to pass through staff candidate normalization. In the API, current-turn staff extraction ran before final confirmation classification, so `go ahead` was treated as an unmatched specific technician while `awaitingFinalBookingConfirmation = true`. That cleared trusted Alex and reopened staff selection before the same turn could be classified as an affirmation.

This was not an availability conflict. The request was corrupted before the availability lookup could validate Alex correctly.

## Availability Audit

Read-only production query results:

- Alex exists in salon `9bd14a12-85ed-418a-af7d-3f5cb329c147`.
- Alex status: `ACTIVE`
- Alex `isBookable`: `true`
- Alex `deletedAt`: `null`
- Full Set service ID: `41241879-49bf-42ba-a6d1-d7da9809d334`
- Full Set active: `true`
- Full Set duration: `100` minutes
- Alex is mapped to Full Set through `staffService`.
- Salon timezone: `America/New_York`
- Business hours were present for all weekdays.
- Blocking overlapping appointments for Alex in the audited production evidence path: `0`

The production booking attempt for the evidence call stored `requestedStaff = go ahead` and did not have a valid requested start window. Given the production data above, the availability engine should have considered Alex valid if the trusted Alex staff ID had reached validation.

## Files Inspected

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/availability/availability.service.ts`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/test/ai-internal.test.ts`

## Files Changed

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/test/ai-internal.test.ts`

## Minimal Diff Explanation

- Added an exact final-confirmation-only phrase helper in Lambda and API.
- Classified exact phrases such as `go ahead`, `please book it`, `sounds good`, and `proceed` as `AFFIRMED`.
- Rejected those exact phrases as staff candidates.
- While awaiting final confirmation, bypassed current-turn staff extraction for exact confirmation-only phrases.
- Preserved trusted staff fields on affirmation.
- Aligned API test availability mocks with blocking appointment statuses.

No Lex source, Connect flow, business hours, service durations, appointment transaction, operator routing, cancellation, or reschedule flow was changed.

## Behavior After Fix

- `go ahead` while awaiting final confirmation is an affirmation, not a staff name.
- Trusted Alex fields remain aligned:
  - `staffPreference = Alex`
  - `staffId = ad1786ae-a0ec-4521-9efc-47cb9ee30b4c`
  - `selectedStaffId = ad1786ae-a0ec-4521-9efc-47cb9ee30b4c`
  - `confirmedStaffId = ad1786ae-a0ec-4521-9efc-47cb9ee30b4c`
  - `confirmedStaffName = Alex`
- Time-only correction still updates only time and asks for a fresh confirmation.
- `go ahead` after the fresh confirmation books using trusted Alex.
- Unknown or unmapped staff still goes through clarification/staff-not-mapped handling.
- Availability failures remain distinct for real overlap, canceled/non-blocking overlap, staff not mapped, and outside business hours.

## Regression Tests Added

Lambda:

- Confirmation-only phrase table preserves trusted Alex and sends `confirmationState = Confirmed`.
- Production-shaped flow: Alex at 11 AM -> `no change it into two pm` -> fresh confirmation with Alex -> `go ahead` books with Alex.

API:

- Confirmation-only phrase table books exactly once with trusted Alex and idempotent retry.
- Production-shaped Alex time correction -> `go ahead` keeps Alex through booking.
- Real Alex overlap returns no availability with overlap reason.
- Canceled Alex overlap does not block booking.
- Alex not mapped to Full Set asks for another staff and does not say busy.
- Alex outside business hours reports business hours and does not say Alex is busy.

## Test and Build Results

All required validation passed:

- `node --check infra/lambda/booking-handler/index.mjs` - pass
- `npm run test:lambda` - pass, 98 tests
- `npm run test:api` - pass, 185 tests
- `npm run typecheck:api` - pass
- `npm run typecheck:app` - pass
- `npm run typecheck:admin` - pass
- `npm run build:api` - pass
- `npm run build:app` - pass, existing Vite chunk-size warnings only
- `npm run build:admin` - pass, existing Vite chunk-size warnings only
- `npm test` - pass, Lambda 98 + API 185 tests
- `git diff --check` - pass

## Lambda Deployment

Pre-deploy:

- Function: `fastaibooking-booking-handler`
- RevisionId: `bf55a362-619a-48cd-8682-e315367a4862`
- CodeSha256: `NRfsRSBefUncj+hL+ca/qeyNytELufbm9lBNst7vXd8=`
- LastModified: `2026-07-12T17:57:08.000+0000`
- LastUpdateStatus: `Successful`

Post-deploy:

- RevisionId: `1b477a7b-0441-4794-bd8a-68312c308b9d`
- CodeSha256: `d7bCvLZsjt6ya40ND8nm691T91/kXtRYgugXfc0GoKw=`
- LastModified: `2026-07-13T02:51:44.000+0000`
- LastUpdateStatus: `Successful`

Rollback reference: redeploy the previous Lambda package/SHA `NRfsRSBefUncj+hL+ca/qeyNytELufbm9lBNst7vXd8=`.

## Lex Deployment

No Lex deployment was required. The fix is deterministic Lambda/API behavior and does not require new Lex model data.

- Bot ID: `KHMIXGA2US`
- Prod alias ID: `JVIPIZDYE3`
- Prod alias version before: `31`
- Prod alias version after: `31`
- Alias status: `Available`
- Locale `en_US` status for version `31`: `Built`
- Code hook: `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`

Rollback reference: Lex remains on prod version `31`.

## API Deployment

Command:

- `npm run deploy:ec2`

Result:

- Docker build passed.
- Prisma migrate deploy reported no pending migrations.
- API container recreated and healthy.
- Nginx reloaded.
- Pre-deploy API image: `sha256:70dc00636cd1e422b7cf0b6ccf56c22b46c960a0aaae2686fd52c050f191fc4e`
- Post-deploy API image: `sha256:ddb677f70efccce5399bd7e3d5368449df6990c25733f3c255658104e6af1a0a`

Rollback reference: redeploy the previous EC2 source/image state, or rebuild from the prior source snapshot that produced API image `sha256:70dc00636cd1e422b7cf0b6ccf56c22b46c960a0aaae2686fd52c050f191fc4e`.

## Production Smoke

Read-only smoke:

- `./infra/scripts/smoke_test_production.sh` - pass
- Admin frontend: `200`
- App frontend: `200`
- API liveness/readiness endpoints: `200`
- API container-local readiness: `200`

Synthetic booking smoke:

- ContactId: `codex-smoke-confirmation-alex-1783911324884`
- Flow: Full Set with Alex at 11 AM -> `no change it into two pm` -> fresh confirmation -> `go ahead`
- Correction result: `ConfirmIntent`
- Correction staff: Alex, `ad1786ae-a0ec-4521-9efc-47cb9ee30b4c`
- Correction time: `14:00`
- Final result: `Close`, booked message with Alex
- Created appointment: `34465165-d9b6-4d4b-8502-de219d8dea2a`
- Cleanup: appointment deleted immediately; verification returned `remaining = null`
- Booking attempt after cleanup: `requestedStaff = Alex`, `staffPreference = Alex`, `staffId = ad1786ae-a0ec-4521-9efc-47cb9ee30b4c`
- AI interaction rows for smoke call: `1`
- Technician-not-found response in smoke logs: `false`

No live phone call was placed. The smoke used a synthetic Lambda invocation against production Lambda/API and cleaned the temporary appointment.

## Connect Flow

Unchanged. The active flow continues to use the Lex prod alias and the same Lambda code hook.

## Remaining Risks

- The synthetic smoke verifies the Lambda/API production path, but not live PSTN audio/ASR behavior.
- The smoke cleanup removed the appointment row, while historical call/booking/AI log records remain as expected production audit records.
- The report cannot self-contain its final Git commit hash before commit creation; the final Codex response records the pushed commit hash.

## Commit and Push

- Commit hash: pending at report creation; final response records the pushed commit hash.
- Push result: pending at report creation; final response records the push result.
