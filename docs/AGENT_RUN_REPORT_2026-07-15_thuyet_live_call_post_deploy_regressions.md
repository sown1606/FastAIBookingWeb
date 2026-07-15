# Agent Run Report: July 15 Live Call Post-Deploy Regressions

Date: 2026-07-15
Branch: `main`
Salon: Kiet Nails & Beauty (`9bd14a12-85ed-418a-af7d-3f5cb329c147`)
Production phone: `+18483487681`
AWS region: `us-east-1`

## Scope

Fixed the July 15 PSTN regressions reported by Thuyet after the prior deployment:

- Voice final confirmation was not reliably reaching the booking Lambda.
- Exact Manicure speech was being rejected after a prior service recognition failure.
- Observed ASR variants `mini q` and `annie stop` were not handled in the right context.
- Duplicate Lex phases for one human utterance could rerun booking logic and clear trusted state.
- Spoken human escalation missed `speak with a person`.
- Operator queue reconciliation marked a requested transfer as queued without provider evidence.
- Debug turn diagnostics needed stable turn IDs, Lex phase, state version and duplicate disposition.

No unrelated refactoring was performed. No Connect flow source change was required.

## Production Evidence

Real records inspected:

- Case 1: CallSession `af875331-14a1-4dd0-9f7e-8aba5aec69e1`, ContactId `a6731d1b-1da3-4692-bd36-a8c38d59f636`, ASR `pedicure today at two pm with annie stop`.
- Case 2: CallSession `a786f59e-0861-48ab-b1f3-e4932adce214`, ContactId `9a77c3d4-9638-418e-a321-32540b049bb1`, Full Set/date/time/Amy reached final confirmation but spoken Yes did not route back to the booking intent.
- Case 3/4: CallSession `de38589f-7587-4b65-9ffe-3ba46bdd58a7`, ContactId `e3070da7-62c0-43a1-a4e6-f894539ab983`, exact `manicure` was processed twice and the second pass cleared service state.
- Human/operator calls: `2796dd1c-658f-4c17-b819-7d698982680e`, `30a8c857-2431-4b73-b02b-c2af11b3baa0`.

Sanitized provider/DB evidence is under:

`docs/report-artifacts/2026-07-15-thuyet-live-call-post-deploy-regressions/`

## Root Causes

1. Final confirmation used application state with Lex `ElicitIntent`. Production Lex did not have a native confirmation slot or intent confirmation setting, so a bare `Yes` could be routed outside `BookAppointmentIntent` and never reach the booking Lambda with the active booking state.
2. `shouldConfirmManicurePedicureAfterFailure()` treated exact current transcript `manicure` as ambiguous solely because `serviceRecognitionFailureCount >= 1`. That contradicted the rule that exact active service names must win.
3. Contextual ASR aliases were incomplete: `mini q` for Manicure and `annie stop`/`anny stop` for Any Staff were absent.
4. Turn identity was logged but not enforced. A real Lex utterance could arrive through multiple phases/retries with the same provider turn identity and run business logic more than once.
5. Human escalation regexes and Lex samples did not include the exact spoken phrase `I want to speak with a person`.
6. Queue reconciliation conflated application transfer request with provider-confirmed queue entry. A caller disconnect before enqueue could still appear as queued.
7. Previous direct Lambda smoke tests gave false confidence because they bypassed Lex runtime intent/slot routing. The failure was in Lex routing after `ElicitIntent`, not only in Lambda request handling.

## Files Inspected

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/call-center/call-center.service.ts`
- `apps/api/test/ai-internal.test.ts`
- `tests/lambda/booking-handler.test.mjs`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/BookAppointmentIntent/Intent.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/HumanEscalationIntent/Intent.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/SlotTypes/NailServiceType/SlotType.json`
- Active AWS Lambda, Lex alias/version/locale/intents/slot types, Amazon Connect phone/flow association, and CloudWatch/contact records for the affected contacts.

## Files Changed

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/call-center/call-center.service.ts`
- `apps/api/test/ai-internal.test.ts`
- `tests/lambda/booking-handler.test.mjs`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/BookAppointmentIntent/Intent.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/BookAppointmentIntent/Slots/bookingConfirmation/Slot.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/HumanEscalationIntent/Intent.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/SlotTypes/BookingConfirmationType/SlotType.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/SlotTypes/NailServiceType/SlotType.json`
- This report and sanitized artifacts.

## Database Migrations

No database migration was added. Existing JSON payload/turn-history fields were used for backward-compatible diagnostics and duplicate handling.

## Confirmation Slot Architecture

- Added Lex custom slot type `BookingConfirmationType`.
- Added `BookAppointmentIntent` slot `bookingConfirmation` after normal booking slots.
- Configured audio and DTMF input for the confirmation slot with interrupt enabled.
- API and Lambda now return `ElicitSlot` with `slotToElicit=bookingConfirmation` when all booking details are ready.
- Affirmative speech and DTMF `1` create exactly one appointment.
- Negative/change speech preserves current values until a grounded correction is applied.

## State And Idempotency Design

- Lambda now sends stable diagnostics to the API: `humanTurnId`, `providerTurnId`, `providerRequestId`, `lexRequestId`, `lexPhase`, and state/sequence metadata.
- `humanTurnId` includes contact/session identity, provider request identity where available, and normalized transcript/input so multiple Lex runtime turns in one session do not collapse together.
- API checks existing canonical turn history before running booking logic for the same human turn.
- Duplicate Lex phases return the prior dialog response and record duplicate/stale disposition instead of incrementing counters, clearing slots, creating attempts, or creating appointments.
- Spoken service accepted while a DTMF menu is active closes the menu and proceeds directly to the next real prompt.

## Queue Reconciliation

- Application transfer request remains distinct from provider queue confirmation.
- No-agent/no-staff cases do not show as successfully queued.
- Busy staffed-agent case remains eligible for Connect queue/hold flow.
- A transfer is marked queued only when provider/runtime evidence supports queue routing, or when the operator status is the explicit busy-agent queue path used by Connect.

## AWS Resources

Before:

- Lambda CodeSha256: `OKrUA23kxvYWWLqX2NTxCjMw2C6L9yX3cJz9iPJesUQ=`
- Lex alias `JVIPIZDYE3`: bot version `32`
- Connect source/active normalized flow hash: `d29c79777cc87ce84bf42ad555333c4a5d43339cc96cb3c5f8ff680896493652`

After:

- Lambda `fastaibooking-booking-handler`: CodeSha256 `3qMPGC9oV5S7VLBxrW7aMAA0q+/CCemuHyXKviwT0NI=`, state `Active`, update status `Successful`.
- Lex alias `JVIPIZDYE3`: bot version `33`, alias status `Available`, locale `en_US` status `Built`.
- Connect phone `+18483487681` remains associated with flow `dcccf542-587c-426c-a644-a4c6f24da6e4`.
- Connect source/active normalized flow hash remains `d29c79777cc87ce84bf42ad555333c4a5d43339cc96cb3c5f8ff680896493652`.

Key artifacts:

- `lambda-config-before.json`
- `lambda-config-final.json`
- `lex-alias-before.json`
- `lex-alias-final.json`
- `lex-booking-confirmation-slot-v33-final.json`
- `lex-booking-confirmation-slot-type-v33-final.json`
- `connect-phone-flow-association-final.json`
- `connect-flow-hashes-after.txt`

## Tests And Commands

Passed:

- `node --check infra/lambda/booking-handler/index.mjs`
- `node --test --test-concurrency=1 tests/lambda/booking-handler.test.mjs` (126 tests)
- `npm --workspace apps/api run typecheck`
- `npm --workspace apps/api test` (265 tests)
- `npm --workspace apps/api run build`
- `npm --workspace apps/admin run typecheck`
- `npm --workspace apps/admin run build`
- `npm --workspace apps/app run typecheck`
- `npm --workspace apps/app run build`
- `npm test`
- `git diff --check`

Regression coverage added or corrected:

- `bookingConfirmation` Lex source contract.
- Full Set + Yes via Lex confirmation slot.
- DTMF `1` confirmation.
- Exact Manicure after failed ASR is accepted, replacing the prior broken test expectation.
- Genuine Manicure/Pedicure ambiguity still asks clarification only when N-best evidence supports it.
- `mini q` resolves to Manicure in service context.
- `annie stop` resolves to Any Staff in booking/staff context.
- Duplicate Lex phases do not rerun business logic.
- `I want to speak with a person` triggers explicit human escalation.
- Queue reconciliation distinguishes requested transfer from provider-confirmed queue.

## Lex Runtime Validation

Validation used the active production alias `JVIPIZDYE3` on Lex version `33`, not direct Lambda-only invocation.

- Session A: `Full Set today at 3 PM with Amy` then `Yes` reached `bookingConfirmation`, then booked exactly once. Artifact: `lex-runtime/session-a6-summary.json`.
- Session B: `I want to book today at 2 PM with Amy`, `Manicure`, `Yes` accepted spoken Manicure while service DTMF was active, closed the menu, then booked exactly once. Artifact: `lex-runtime/session-b-summary.json`.
- Session C: `Pedicure today at 2 PM with any staff`, `Yes` selected an eligible staff member and booked exactly once. Artifact: `lex-runtime/session-c2-summary.json`.
- Observed ASR replay: `pedicure today at two pm with annie stop` resolved Pedicure/date/time/Any Staff and prompted final confirmation without staff reprompt. Artifact: `lex-runtime/session-observed-annie-stop-summary.json`.
- Human request: `I want to speak with a person` produced explicit transfer attributes and queue ID with `operatorQueueOutcome=AGENTS_BUSY`. Artifact: `lex-runtime/session-d2-summary.json`.
- DTMF confirmation: final confirmation followed by `1` booked exactly once. Artifact: `lex-runtime/session-dtmf-confirm2-summary.json`.
- Additional one-turn smokes covered `fun facts today at two p m with amy`, `pay the bill today at two p m with any stop`, and `0`.

## Production Health

`infra/scripts/smoke_test_production.sh` passed after deployment:

- Admin frontend reachable.
- Owner app frontend reachable.
- Health liveness/readiness reachable.
- API health liveness/readiness reachable.

Artifact: `production-health-final.txt`.

## Synthetic Cleanup

Only synthetic identifiers created by this execution were cleaned:

- Contact ID prefix: `codex-20260715-postreg-%`
- Synthetic customers: `+155520672%` with note `Synthetic Lex runtime validation 2026-07-15 post-deploy regressions%`

Deleted:

- 17 `CallSession`
- 17 `AIInteractionLog`
- 17 `BookingAttempt`
- 24 `CallTranscript`
- 3 `CallEscalation`
- 0 `CallEvent`
- 5 `Appointment`
- 5 `Customer`

Post-cleanup remaining count for those synthetic selectors: 0 call sessions, 0 customers.

Artifacts:

- `synthetic-cleanup-before-counts.txt`
- `synthetic-cleanup-appointment-preview.txt`
- `synthetic-cleanup.sql`
- `synthetic-cleanup-result.txt`

No real UUID Amazon Connect calls or tester records were deleted.

## Remaining Limitations

- Validation was performed through Lex runtime text sessions and API/provider resource checks. No new PSTN audio call was placed by this agent after deployment, so ASR endpointing timing remains dependent on live PSTN conditions.
- Historical real-call duplicate turn records were not destructively repaired. New duplicate Lex phases are rejected/merged going forward.
- Connect flow was inspected and left unchanged because source and active normalized hashes already matched and this fix did not require flow edits.

## Rollback Instructions

1. Repoint Lex alias `JVIPIZDYE3` from version `33` back to version `32`.
2. Redeploy the previous Lambda package with CodeSha256 `OKrUA23kxvYWWLqX2NTxCjMw2C6L9yX3cJz9iPJesUQ=` from the pre-deploy artifact or release storage.
3. Roll back the API container to the previous image or revert this commit and run the API deploy.
4. No Connect rollback is required because no Connect flow change was published.
5. Re-run production health checks and a Lex runtime confirmation session.

## Git

Commit hash: recorded in the final delivery response for the pushed commit containing this report.
Push result: recorded in the final delivery response after `git push`.
