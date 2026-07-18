# Agent Run Report: Basic Booking State, Dates, Staff, Minutes

Date: 2026-07-12

## Scope

Production P0 hotfix for the Amazon Connect -> Lex -> booking Lambda -> internal AI appointment API path. The fix is limited to active AI booking state parsing and regression coverage for service ASR, staff preservation, explicit any-staff phrases, date grounding, and minute-level time parsing.

Out of scope and unchanged: Connect flow, operator/DTMF 0 routing, appointment transaction semantics, salon timezone, business hours, service duration, cancellation, reschedule, notification flow, iOS source, and unrelated UI.

## Production Evidence

- Pedicure ASR incident: `d436ad9c-d0ee-457e-92aa-635e53a6bcb4`, ContactId `387038ce-49af-4046-80e6-bca17b82e770`, transcript `hi i want to book a p t q tomorrow`.
- Alex time-change incident: `6c20d1e1-af55-49b8-babf-973850aa5702`, ContactId `feefdb01-b8d8-4edd-964c-3b859cb03515`.
- Full Set today time-change incident: `ae5ffb1b-fe54-4e27-ad2a-0714c1955984`, ContactId `7b4b55f9-bfff-4f30-a378-c8b3d5eba2d8`.
- First-available incident: `12502ec3-58c0-4ac8-a4a9-13e440a29e1e`, ContactId `945a055b-b700-4d6b-9a73-2531e3ba64a8`.

## Root Causes

1. API staff extraction allowed generic correction words into fuzzy staff matching. `change` could conservatively match the Trang alias `chang`, so time-only turns like `change it into four p m` became a staff correction to Trang.
2. API `hasStaffCuePhrase` treated generic `change it to` / `switch it to` as staff cues. A correction phrase without a grounded staff name could therefore overwrite trusted staff.
3. Lambda scoped staff candidate normalization treated bare `p m` as a short staff candidate, causing an incomplete time fragment to clear trusted staff.
4. `p t q` / `ptq` were missing as tightly scoped Pedicure ASR aliases, and staff sanitization did not reject recognized service aliases as invalid staff values.
5. Real ASR variants such as `for available` and `first avaiable` were missing from explicit any-staff handling.
6. Deterministic time parsing did not normalize spoken minute phrases such as `three fifty PM` or separated numeric phrases like `3 30 PM`.
7. Weekday parsing was hardened to avoid truthiness mistakes around weekday indexes.

## Files Changed

- `infra/lambda/booking-handler/index.mjs`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/test/ai-internal.test.ts`

No Lex source file was changed. Production Lex uses `AMAZON.AlphaNumeric` for `staffPreference`, with no custom staff slot type or staff synonym source to update.

## Minimal-Diff Explanation

- Added conservative service aliases `p t q` and `ptq` for Pedicure in Lambda and API.
- Added explicit any-staff variants: `the first available`, `for available`, `first avaiable`, and `first available one`.
- Added small shared-style hour/minute normalization helpers in Lambda and API.
- Stopped treating generic `change it to` as a staff cue in API.
- Excluded correction verbs from API fuzzy staff token matching.
- Preserved already validated dynamic staff identity in Lambda when the current turn is only incomplete time noise.
- Rejected bare `am/pm` fragments as staff candidates in Lambda.
- Added focused multi-turn regression tests without weakening existing assertions.

## Behavior After Fix

- `p t q` and `ptq` resolve to Pedicure in booking/service context and are not stored as staff.
- Customer name turns preserve accepted service and do not ask service again.
- Time-only corrections update only `requestedTime`; staff name and IDs remain synchronized.
- `change` no longer maps to Trang.
- `for available` and `first avaiable` enter explicit any-staff flow and can select actual availability.
- `today`, `tomorrow`, and weekdays are grounded in salon timezone.
- `3:50 PM`, `3 30 PM`, `three fifty PM`, and related minute phrases preserve exact minutes.
- No appointment is created before fresh final confirmation.

## Regression Tests Added

Lambda tests added for:

- `p t q` -> Pedicure, not staff.
- Pedicure -> customer name -> date/time without asking service again.
- Full Set + Alex -> time-only correction to 4 PM preserves Alex IDs.
- Full Set + Alex -> spoken minute correction to 3:50 PM preserves Alex IDs.
- `for available` while asking staff -> `Any staff`.
- `today` and `Tuesday` while asking date.
- Bare `p m` preserves service/name/date/staff and re-elicits time.

API tests added for:

- Time-only final correction preserves non-first Kevin staff identity.
- Spoken minute final correction preserves Kevin and exact minutes.
- `for available` / `first avaiable` use explicit-any flow.
- Time-only answer does not invent `requestedDate=today`.
- `ptq` service ASR resolves to Pedicure and is not stored as staff.

## Local Validation

- `node --check infra/lambda/booking-handler/index.mjs`: passed.
- `npm run test:lambda`: passed, 96/96.
- `npm run test:api`: passed, 179/179.
- `npm run typecheck:api`: passed.
- `npm run typecheck:app`: passed.
- `npm run typecheck:admin`: passed.
- `npm run build:api`: passed.
- `npm run build:app`: passed with existing Vite chunk-size warnings.
- `npm run build:admin`: passed with existing Vite chunk-size warnings.
- `npm test`: passed, Lambda 96/96 and API 179/179.
- `git diff --check`: passed.

## Production Deployment

Lambda:

- Function: `fastaibooking-booking-handler`
- Region/profile: `us-east-1` / `nailnew`
- Before: RevisionId `86b9a58e-81e1-4f5c-bfa1-7b60f70f97bd`, CodeSha256 `zhXawK3D6tZ9+nby+XYVLyQwwvbrVN2ZtGycLJm4Ypk=`, LastModified `2026-07-12T13:08:22.000+0000`
- After: RevisionId `bf55a362-619a-48cd-8682-e315367a4862`, CodeSha256 `NRfsRSBefUncj+hL+ca/qeyNytELufbm9lBNst7vXd8=`, LastModified `2026-07-12T17:57:08.000+0000`
- Status: `Active`, `LastUpdateStatus=Successful`

Lex:

- Bot: `KHMIXGA2US`
- Alias: `prod` / `JVIPIZDYE3`
- Old version: `31`
- New version: `31` unchanged
- Alias status: `Available`
- DRAFT locale `en_US`: `Built`
- `staffPreference` slot type: `AMAZON.AlphaNumeric`
- Code hook: `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`

EC2/API:

- Deploy command: `npm run deploy:ec2`
- Before API image: `sha256:63f4975c29b857651c4209cc7fbe3f716a01e50ad2b3ec2bb3a0cb29437aafc8`, healthy.
- After API image: `sha256:70dc00636cd1e422b7cf0b6ccf56c22b46c960a0aaae2686fd52c050f191fc4e`, created `2026-07-12T17:58:03.06022207Z`, healthy.
- Prisma: 16 migrations found, no pending migrations.
- App/admin images were cached or unchanged by source scope; containers remained running.

Connect flow:

- Unchanged. No Connect deployment was performed.

## Production Smoke

Read-only health smoke:

- `./infra/scripts/smoke_test_production.sh`: passed.
- Admin frontend: 200.
- App frontend: 200.
- API liveness/readiness endpoints: 200.

Synthetic Lex/Lambda/API smokes, no final `yes` sent:

- `codex-basic-state-********9430-ptq`: `I want to book a p t q tomorrow` -> `serviceName=Pedicure`, `staffPreference` not `ptq`, then `Thuyet` preserved Pedicure, then `eleven am` preserved Pedicure and asked staff.
- `codex-basic-state-********9430-alex-time`: Full Set tomorrow 2 PM with Alex -> time-only correction to 4 PM kept Alex ID `ad1786ae-a0ec-4521-9efc-47cb9ee30b4c`; subsequent `change it to 3:50 PM` kept Alex and set `requestedTime=15:50`.
- `codex-basic-state-tail-********1478-tuesday`: Full Set Tuesday 3 PM with Alex -> `requestedDate=2026-07-14`, Alex IDs synchronized.
- `codex-basic-state-tail-********1478-minutes`: Full Set tomorrow 3:50 PM with Alex -> exact minutes preserved, Alex IDs synchronized.
- `codex-basic-state-tail-********1478-for-available`: Lex-only injected first-available turn did not produce the old technician-not-found behavior and created no records.
- `codex-basic-state-api-any-********8035`: Direct production API explicit-any smoke for `for available` selected real availability with Trang ID `903511ee-4849-43dd-85fb-73595e79a233`, returned fresh confirmation, and created no appointment.

Production DB verification:

- Backend-reaching smoke ContactIds each produced exactly 1 `CallSession`, 1 `BookingAttempt`, 1 `AIInteractionLog`, and 0 `Appointment`.
- `codex-basic-state-tail-********1478-for-available` created 0 records because Lex closed before Lambda/API invocation in the injected state.

Production logs verified:

- Lambda structured logs include `currentTurnTranscript`, `slotDecisions`, `trustedSlotsBefore`, `trustedSlotsAfter`, `ignoredPollutedSlots`, staff IDs, requested date/time, and confirmation fingerprints for the smoke ContactIds.
- API logs show successful `MISSING_INFO` outcomes for the smoke ContactIds.

## Rollback References

- Lambda rollback CodeSha256: `zhXawK3D6tZ9+nby+XYVLyQwwvbrVN2ZtGycLJm4Ypk=`, RevisionId `86b9a58e-81e1-4f5c-bfa1-7b60f70f97bd`.
- API rollback image: `sha256:63f4975c29b857651c4209cc7fbe3f716a01e50ad2b3ec2bb3a0cb29437aafc8`.
- Lex rollback: not needed; prod alias stayed on version `31`.
- Connect rollback: not needed; flow unchanged.

## Git

- Implementation commit: `7bf8a73` (`fix: stabilize basic AI booking state and date handling`)
- Push result: pending at report creation; final push result is recorded in the final Codex response.
- Pre-existing unrelated worktree items were not staged: `fastaibooking-current-state.zip` and `docs/AGENT_RUN_REPORT_2026-07-11_permanent_customer_salon_delete_datetime.md`.

## Remaining Risks

- No live PSTN phone call was placed in this run; production validation used Lex runtime, direct production API smoke, production health checks, DB verification, and logs.
- Lex can close `ReadyForFulfillment` in artificially injected session states before Lambda/API is invoked; the backend explicit-any path was therefore verified with a direct production API smoke.
- Existing frontend Vite chunk-size warnings remain unrelated to this P0 hotfix.
