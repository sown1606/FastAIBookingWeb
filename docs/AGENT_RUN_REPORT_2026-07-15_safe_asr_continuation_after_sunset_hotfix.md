# FastAIBooking Safe ASR Continuation After Sunset Hotfix

Date: 2026-07-15

## Scope

Small follow-up to the completed `sunset` -> `Full Set` and operator queue hotfix:

- Removed one-letter staff inference from Lambda and API booking paths.
- Preserved guarded `sunset` / `sun set` -> `Full Set` correction and exact active `Sunset` service collision protection.
- Added Lex locale custom vocabulary for `Full Set`.
- Added Lex runtime hints only for the next elicited `serviceName` or `staffPreference` slot.
- Kept operator queue behavior, queue-entry callback, timeout flow, debug export schema/copy, Connect flows, admin UI, and DB schema unchanged.

## Existing Changes Preserved

- `sunset` / `sun set` correction remains guarded by booking/service context.
- Exact active service named `Sunset` still wins over the observed `Full Set` ASR correction.
- Operator requests and DTMF `0` still set transfer attributes without fake booking fields.
- Provider-confirmed queue state is still required before successful queued state.
- AI Reception, Human Escalation, and Customer Queue Connect source/active hashes still match and were not republished.
- Debug export schema/version and UI copy were not changed.

## Evidence Inspected

- Current Git HEAD before this follow-up: `d5ad2c54a0c951266880ad1e74498ff6a996d39d`.
- Existing dirty/untracked files left unstaged: `fastaibooking-current-state.zip`, `docs/AGENT_RUN_REPORT_2026-07-11_permanent_customer_salon_delete_datetime.md`, `docs/report-artifacts/2026-07-13-any-staff-known-caller-operator-queue/`.
- Lambda before deployment:
  - Function: `fastaibooking-booking-handler`
  - ARN: `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`
  - CodeSha256: `fAlRDAIzU9MN/DE12+CXEVg+mh19aMEWZVv3hlGCaeY=`
  - RevisionId: `5e6ec6dd-e9f5-496c-ba0d-eed570e94bd4`
  - LastModified: `2026-07-15T12:37:41.000+0000`
- Lex before deployment:
  - Bot: `KHMIXGA2US`
  - Prod alias: `JVIPIZDYE3` / `prod`
  - Before alias version: `34`
  - Hook: `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`
  - DRAFT had no custom vocabulary before import.
  - `NailServiceType` already had `Full Set` synonyms including `sunset` and `sun set`.
- Connect before/final state:
  - Instance: `74f78377-766f-46b7-a745-4bc97b68a8dc`
  - Phone `+********7681`: claimed as `f2e36faa-5264-4955-8a18-e2f53755c102`.
  - Flow association: phone ARN -> AI Reception ARN `arn:aws:connect:us-east-1:197452633989:instance/74f78377-766f-46b7-a745-4bc97b68a8dc/contact-flow/dcccf542-587c-426c-a644-a4c6f24da6e4`.
  - Operator queue `d0f2a5d8-e983-4609-9bbc-efb0881a465d`: `AGENTS_STAFFED=1`, `AGENTS_AVAILABLE=0`, `CONTACTS_IN_QUEUE=0`, snapshot `2026-07-15T09:28:08.132000-04:00`.

## Root Causes Confirmed

- One-letter staff prefix inference was unsafe. `with a` selected Amy when the right behavior is to preserve booking fields and ask a focused staff question.
- Runtime hints for `staffPreference` initially failed in production because the slot was `AMAZON.AlphaNumeric`; Lex V2 rejects runtime hints for that slot type. The slot now uses custom `StaffPreferenceType`.
- The previous production `sunset` ASR and operator queue root causes remain fixed and covered by unchanged regression tests.

## Files Changed

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/test/ai-internal.test.ts`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/CustomVocabulary.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/BookAppointmentIntent/Slots/staffPreference/Slot.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/SlotTypes/StaffPreferenceType/SlotType.json`
- `docs/AGENT_RUN_REPORT_2026-07-15_safe_asr_continuation_after_sunset_hotfix.md`

## Implementation Notes

- Removed `resolveOneLetterStaffPrefixFromText(...)` from Lambda.
- Removed `resolveOneLetterStaffPrefix(...)` from API.
- Removed all callers that silently resolved `with a` to Amy or another unique A-prefix staff member.
- Added `buildRuntimeHintsForSlot(...)` in Lambda:
  - `serviceName`: active salon service names and service DTMF options.
  - `staffPreference`: active bookable staff DTMF options plus `Any staff`.
  - Hints are compact, deduped, scoped to `BookAppointmentIntent`, and only emitted for the next elicited slot.
  - Unsupported or unrelated next slots clear/omit stale runtime hints.
- Added Lex locale custom vocabulary item:
  - `phrase=Full Set`
  - `weight=3`
  - `displayAs=Full Set`
- Added compact custom Lex slot type `StaffPreferenceType` so `staffPreference` can accept runtime hints.

## Regression Cases Covered

- `sunset today at three p m with a`: `Full Set`, today, `3 PM`, no staff selected, asks only for staff, no generic loop.
- `sunset today at three pm with`: preserves service/date/time and asks only for staff.
- `sunset` while eliciting service resolves `Full Set`.
- `The sunset is beautiful` does not resolve a nail service.
- Active exact `Sunset` service wins.
- With only Amy active, `with a` does not select Amy.
- With Amy and Alice active, `with a` selects neither.
- Exact `with Amy` resolves Amy.
- Exact `with Alice` resolves Alice after catalog refresh without code changes.
- Ambiguous near-full staff candidates ask one focused clarification.
- Runtime hints include only current active services/staff for the slot being elicited.
- Disabled or renamed staff no longer appears after bounded cache refresh.
- Existing operator request, DTMF `0`, queue-entry, busy-agent queue, timeout, duplicate-turn, and debug-export tests pass unchanged.

## Commands And Results

- `node --check infra/lambda/booking-handler/index.mjs`: PASS.
- `npm run test:lambda`: PASS, 133/133.
- `npm run typecheck:api`: PASS.
- `npm run build:api`: PASS.
- `npm run test:api`: PASS, 276/276.
- `npm test`: PASS, Lambda 133/133 and API 276/276.
- `jq empty` on changed Lex JSON files: PASS.
- `git diff --check`: PASS.
- `rg -n "resolveOneLetterStaffPrefix|one-letter|one letter|with a.*Amy|Amy.*with a" ...`: no removed helper names remain in Lambda/API; matches are regression test names and customer-name spelling prompts only.

## Deployment

- API/admin/app production deploy:
  - Command: `npm run deploy:ec2`
  - Result: remote deploy completed successfully.
  - API image built: `sha256:78819eb71a9d128aa8ad57dbb44bda8ba2f5356e749847d691bd7f5b0927bedf`.
  - Prisma migrate deploy: 16 migrations found, no pending migrations.
  - API container and nginx recreated successfully.
- Lambda deployment:
  - Packaged `infra/lambda/booking-handler/index.mjs`.
  - Updated `fastaibooking-booking-handler`.
  - Waited for `Active` and `Successful`.
- Lex deployment:
  - Imported custom vocabulary because DRAFT had no existing custom vocabulary.
  - ImportId: `XUXX8WSJFG`, status `Completed`.
  - Created interim version `35` with custom vocabulary.
  - Production runtime check found `AMAZON.AlphaNumeric` rejects `staffPreference` runtime hints.
  - Created DRAFT custom slot type `StaffPreferenceType`, id `DFQYFYRZNC`.
  - Rebuilt locale, created version `36`, moved alias `JVIPIZDYE3` to `36`.
- Connect deployment:
  - No Connect flows were changed or republished.
  - Source and active normalized hashes matched after deployment.

## AWS After IDs And Hashes

- Lambda after:
  - Function ARN: `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`
  - CodeSha256: `DCXJJK1WZouwCNAP2rKQJP+5ktNizjmCHnGcSuahViM=`
  - RevisionId: `7f913357-8306-4c26-82c7-485d8ec716b4`
  - LastModified: `2026-07-15T13:20:54.000+0000`
  - State: `Active`
  - LastUpdateStatus: `Successful`
- Lex after:
  - Bot: `KHMIXGA2US`
  - Alias: `JVIPIZDYE3` / `prod`
  - Final version: `36`
  - Alias status: `Available`
  - Alias updated: `2026-07-15T09:32:57.079000-04:00`
  - Custom vocabulary: `Full Set`, weight `3`, displayAs `Full Set`, itemId `XIVR2W4MNF`.
  - `NailServiceType`: `CRPHEOWTHG`; `Full Set` includes `sunset` and `sun set`.
  - `StaffPreferenceType`: `DFQYFYRZNC`.
- Connect after, normalized source/active hashes:
  - AI Reception `dcccf542-587c-426c-a644-a4c6f24da6e4`: `d80b39e3b9180b99c08693b51dbca04986f1d74ae27ee529c2672040e0f5da36` / `d80b39e3b9180b99c08693b51dbca04986f1d74ae27ee529c2672040e0f5da36`.
  - Human Escalation `c7386b94-56bb-4382-b517-ee890bbacb51`: `f9f60dd6a2e58f1f2a49c9b2cf80cad62b881b670dfae51fdd5b8dba7443fbed` / `f9f60dd6a2e58f1f2a49c9b2cf80cad62b881b670dfae51fdd5b8dba7443fbed`.
  - Customer Queue Timeout `6bdf546e-4e3a-4bf5-954f-fb78fa6a3d5b`: `cb5aac0c0879946b092532198328af1ff747de502bc677deab98f386542209a2` / `cb5aac0c0879946b092532198328af1ff747de502bc677deab98f386542209a2`.

## Production Runtime Validation

- Read-only health before and after deployment:
  - Admin frontend: `200`
  - App frontend: `200`
  - `/health/liveness`: `200`
  - `/health/readiness`: `200`
  - `/api/v1/health/liveness`: `200`
  - `/api/v1/health/readiness`: `200`
- Active Lex alias typed/runtime cases:
  - `sunset today at three p m with a`: `BookAppointmentIntent`, `serviceName=Full Set`, `requestedDate=2026-07-15`, `requestedTime=3 PM`, `staffPreference=null`, `slotToElicit=staffPreference`, no generic prompt, runtime hints scoped to `staffPreference`.
  - `sunset today at three pm with`: same preserved service/date/time, asks `staffPreference`.
  - `sunset` while eliciting `serviceName`: resolved `Full Set`, then asked next missing date.
  - `The sunset is beautiful`: no `serviceName`, no `serviceAliasCorrectionRaw`.
  - `today at 3 pm` with no service: asks `serviceName` and returns only service runtime hints.
  - `I want to speak with a person`: one message, `Let me check for an available operator.`, `transferToQueue=true`, no fake staff/service.
  - Typed `0`: same operator route attributes and prompt.
- Operator queue metric evidence:
  - Queue staffed but busy: `AGENTS_STAFFED=1`, `AGENTS_AVAILABLE=0`.
  - This confirms the active queue is in the busy-staffed state that the preserved flow must queue instead of immediately disconnecting.

## Audio Evidence

- Polly validation was blocked by IAM:
  - `polly:DescribeVoices` denied for `arn:aws:iam::197452633989:user/fastaibooking-codex-deployer`.
- Generated local PCM fixtures using macOS `say` and `ffmpeg`:
  - `Full Set today at 3 PM with Amy.`
  - `I want to speak with a person.`
- Active Lex `recognize-utterance` audio-input validation was blocked by the deployed Lex model:
  - `ValidationException: RecognizeUtterance operation is not supported for speech-to-speech models`.
- No real handset, speakerphone, or room-noise PSTN call was originated from this environment. These are left as tester acceptance cases below and must not be represented as typed Lex validation.

## Synthetic Cleanup

- Synthetic prefix used: `codex-safe-asr-20260715`.
- Before cleanup: 7 call sessions, 7 AI logs, 7 booking attempts.
- Deleted only matching synthetic records:
  - AI logs: 7
  - Booking attempts: 7
  - Call sessions: 7
- Verification after cleanup:
  - Call sessions: 0
  - AI logs: 0
  - Booking attempts: 0
- No real supplied contacts, customers, appointments, or AI logs were deleted or mutated.

## Remaining Limitations

- Real handset, speakerphone distance, and moderate room-noise validation still require a human tester or telephony harness.
- Runtime hints improve next slot elicitation only. Initial free-form audio recognition is handled by Lex custom vocabulary plus guarded Lambda fallback; this run did not claim runtime hints pre-seed first-turn ASR.
- Staff/service pronunciation aliases remain limited to the current data model. A dedicated pronunciation-alias admin/data phase was not added in this urgent continuation.

## Rollback Steps

1. Revert this commit.
2. Redeploy API/admin/app with `npm run deploy:ec2`.
3. Package and update Lambda from the reverted `infra/lambda/booking-handler/index.mjs`; wait for `Active` / `Successful`.
4. Move Lex alias `JVIPIZDYE3` back to version `34` when reverting Lambda/API to `d5ad2c54a0c951266880ad1e74498ff6a996d39d`.
5. Do not move the current Lambda back to Lex version `34` alone, because current Lambda emits `staffPreference` runtime hints and version `34` uses unsupported `AMAZON.AlphaNumeric`.
6. Connect rollback is not required because no Connect flow was changed.
7. Run production health checks and the operator/Full Set acceptance cases after rollback.

## Tester Acceptance Cases

1. `Full Set today at 3 PM with Amy.`
   - Expected: confirm Full Set, today, 3 PM, Amy; no service re-ask.
2. `Full Set today at 3 PM with Alice.` after adding Alice to the test salon.
   - Expected: exact active Alice resolves by catalog without code deployment.
3. `Full Set today at 3 PM with A.`
   - Expected: Full Set/date/time preserved; no Amy/Alice inference; one focused staff clarification.
4. `I want to speak with a person.`
   - Expected: one transition prompt, then queue/hold music.
5. Press `0` during the greeting.
   - Expected: same queue/hold behavior.
6. Press `0` during the service prompt.
   - Expected: same queue/hold behavior.
7. Keep an operator busy on another call, then request a person.
   - Expected: caller waits in queue instead of immediate disconnect.
8. Let the queue time out.
   - Expected: one complete polite timeout message and then clean disconnect, not a cut-off sentence.

## Commit And Push

- Implementation/report commit SHA: `1a7ce641336c413888233eb89cd450dd2176dce7`
- Push result: `git push origin main` completed successfully.
