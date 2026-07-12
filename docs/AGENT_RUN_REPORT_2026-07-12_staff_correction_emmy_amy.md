# Agent Run Report - Staff Correction Emmy/Amy - 2026-07-12

## Scope

P0 production hotfix for active booking staff recognition and staff correction. The change is limited to Lambda booking slot sanitization, API staff resolution, and regression tests. No business hours, salon timezone, appointment duration, appointment transaction, Connect flow, iOS source, cancel, reschedule, DTMF 0, or operator routing logic was changed.

## Vietnam-Time Incident Timeline

- Incident call session: `e736ea1d-98de-47f6-ab0c-161e4bf3bf07`
- Amazon Connect ContactId: `b3b78bc1-0119-43be-97fd-9a1efa71e402`
- Caller: `+84798171999`
- Approx UTC time: `2026-07-12T11:39:13Z`
- Approx Vietnam time: `2026-07-12 18:39 ICT`
- Transcript sequence: caller asked for `pedicure tomorrow at eleven am with emmy`, then repeatedly corrected `no i want emmy not chang`.
- Bad production state after `with emmy`: `staffPreference=Trang`, `staffId=903511ee-4849-43dd-85fb-73595e79a233`, `selectedStaffId=903511ee-4849-43dd-85fb-73595e79a233`, `confirmedStaffId=903511ee-4849-43dd-85fb-73595e79a233`, `confirmedStaffName=Trang`.
- No appointment was created during this incident call.

## Root Cause

1. `emmy` / `emmie` were missing from both deterministic staff alias tables. `with emmy` therefore did not resolve to active staff Amy.
2. In the Lambda staff slot boundary, a scoped `staffPreference` Lex value could be trusted too early just because `staffPreference` was the current asked slot. A raw ASR/Lex value such as `with emmy` / `withemmy` was not grounded against active staff before stale state could survive.
3. In the API, unresolved explicit staff text could collapse into the broad `all` resolution path. Combined with `staffWasAlreadyAsked`, this normalized a specific unmatched name into `Any staff`.
4. During final confirmation, because `emmy` did not resolve, there was no current-turn staff mention to override the previously trusted Trang state and the old confirmation fingerprint was repeated.

## Why Emmy Became Trang

`with emmy` was a specific staff request, but Emmy was not an alias for Amy. The unresolved specific staff text then reached fallback behavior that treated it like open availability / Any staff. Availability then selected the first active/bookable staff for the requested slot, which was Trang in production.

## Why Correction Could Not Replace Trang

Correction phrases such as `no i want emmy not chang` still contained an unresolved `emmy`. Since no unique current-turn staff mention was detected, the previous trusted Trang IDs remained stronger than the correction text. The confirmation fingerprint stayed tied to Trang, so the caller heard the old confirmation again.

## Files Inspected

- `docs/AGENT_RUN_REPORT_2026-07-12_customer_delete_ui_voice_interrupt_goodbye.md`
- `docs/AGENT_RUN_REPORT_2026-07-12_full_set_service_name_sticky.md`
- `docs/AGENT_RUN_REPORT_2026-07-11_booking_change_lex_debug_copy.md`
- `docs/AGENT_RUN_REPORT_2026-07-11_permanent_customer_salon_delete_datetime.md`
- `docs/p0-call-state-repair-report-2026-07-10.md`
- `infra/lambda/booking-handler/index.mjs`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/test/ai-internal.test.ts`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/BookAppointmentIntent/Slots/staffPreference/Slot.json`
- `infra/scripts/deploy_remote_ec2.sh`
- `infra/scripts/deploy_ec2.sh`
- `infra/scripts/smoke_test_production.sh`
- `apps/api/src/modules/appointments/appointments.service.ts`
- `apps/api/src/modules/appointments/appointments.routes.ts`

## Files Changed

- `infra/lambda/booking-handler/index.mjs`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/test/ai-internal.test.ts`

## Minimal-Diff Explanation

- Added conservative Amy aliases only: `emmy`, `emmie`.
- Added scoped staff phrase normalization around staff context/correction context, without broad text stripping outside staff resolution.
- Separated current asked slot from grounded staff match.
- Split API staff resolution into distinct outcomes: `missing`, `explicit_any`, `matched`, `ambiguous`, `unmatched_specific`, and `invalid_noise`.
- Removed the path where unmatched explicit staff becomes Any staff.
- Ensured current-turn uniquely resolved staff wins over stale previous staff and clears stale IDs/fingerprint before fresh confirmation.
- Kept appointment creation, availability transaction, time/date calculation, timezone, business hours, DTMF 0, operator routing, cancel, and reschedule logic unchanged.

## Lambda Behavior Before And After

Before:
- `with emmy` was not an Amy alias.
- Scoped `staffPreference` values could be kept even when not grounded.
- Stale Trang could survive correction turns.

After:
- `with emmy`, `I want emmy`, `No, Amy`, and `no i want emmy not chang` resolve to active Amy when Amy is unique.
- Unknown explicit staff clears stale staff only when the turn is an explicit staff/correction phrase, then elicits `staffPreference`.
- Lex stale staff slot cannot override current transcript staff mention.
- Staff diagnostics include current-turn staff, discarded stale staff, ignored ungrounded slot, and staff source when available.

## API Behavior Before And After

Before:
- No-match explicit staff could enter broad `all` behavior and select first available staff.
- Final-confirmation staff correction could preserve old trusted staff.

After:
- `explicit_any` is only used for explicit phrases such as `any staff`, `anyone`, `first available`, `whoever is available`, and `no preference`.
- `with Emily` / unknown specific names return clarification, clear stale staff IDs, do not use Any staff, and do not run broad availability.
- A uniquely resolved current-turn staff mention replaces previous staff atomically across `staffPreference`, `staffId`, `selectedStaffId`, `confirmedStaffId`, and `confirmedStaffName`.
- Fresh confirmation is required after staff correction; no appointment is created before the fresh `yes`.

## Lex Inspection And Behavior

- Bot ID: `KHMIXGA2US`
- Prod alias ID/name: `JVIPIZDYE3` / `prod`
- Old prod alias version before this run: `31`
- New prod alias version after this run: `31` (unchanged)
- Prod alias status: `Available`
- Locale: `en_US`
- Version `31` locale status: `Built`
- Staff slot: `staffPreference`, slot type `AMAZON.AlphaNumeric`
- Live custom slot types in version `31`: only `NailServiceType`
- There is no custom staff slot type or Amy synonym source in the deployed Lex model. No Lex version was created for this hotfix. Emmy/Emmie support is deterministic in Lambda/API.
- Prod alias Lambda hook remains `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`.

## Tests Added

Lambda:
- `with emmy` canonicalizes to Amy while `staffPreference` is being asked.
- Final confirmation correction `no i want emmy not chang` replaces stale Trang with Amy.
- Unknown explicit staff clears stale Trang instead of sending Any staff.

API:
- Alias/correction phrases resolve to Amy: `Amy`, `Amie`, `Emmy`, `Emmie`, `with emmy`, `I want emmy`, `no I want emmy not change`, `Emmy not Trang`, `Amy not Trang`, `Not Trang Amy`, `No Amy`.
- Unknown explicit staff asks clarification without reusing Trang or Any staff.
- Final confirmation correction from Emmy replaces Trang and books Amy only after fresh yes.
- `not Trang` without replacement clears staff and preserves service/date/time/name.
- Active salon with both Amy and Emmy active/bookable is ambiguous and asks clarification.
- Existing unclear-staff test now asserts no automatic first-available fallback.

## Test And Build Results

- `node --check infra/lambda/booking-handler/index.mjs`: PASS
- `npm run test:lambda`: PASS, 89 tests
- `npm run test:api`: PASS, 174 tests
- `npm run typecheck:api`: PASS
- `npm run typecheck:app`: PASS
- `npm run build:api`: PASS
- `npm run build:app`: PASS, with existing Vite chunk-size warning only
- `npm test`: PASS, Lambda 89 tests and API 174 tests
- `git diff --check`: PASS

## Production Versions Before And After

API:
- Before deploy API image: `sha256:fd36d5cc9437635ec9a1cb487fbb46e33ad42d0ecf9344726623f46033206f37`
- After deploy API image: `sha256:63f4975c29b857651c4209cc7fbe3f716a01e50ad2b3ec2bb3a0cb29437aafc8`
- Deploy command: `npm run deploy:ec2`
- Deploy result: API container recreated and healthy; Prisma reported no pending migrations.

Lambda:
- Function: `fastaibooking-booking-handler`
- Before deploy `CodeSha256`: `Fd+OlHCVlhlgvj7jazYrQqApwgNVLVtssqHbQ3TQfC8=`
- Before deploy `RevisionId`: `96a6fc66-2fd2-4689-bfc1-2315f8c72808`
- After deploy `CodeSha256`: `zhXawK3D6tZ9+nby+XYVLyQwwvbrVN2ZtGycLJm4Ypk=`
- After deploy version: `$LATEST`
- After deploy `RevisionId`: `86b9a58e-81e1-4f5c-bfa1-7b60f70f97bd`
- After deploy status: `State=Active`, `LastUpdateStatus=Successful`
- Lambda aliases: none; Lex calls the function ARN directly.

Lex:
- Old version: `31`
- New version: `31`
- Prod alias target: `prod/JVIPIZDYE3 -> version 31`
- Locale status: `Built`
- No Lex deployment was performed because `staffPreference` is `AMAZON.AlphaNumeric` and there is no custom staff synonym slot type.

Connect:
- Flow: `FastAIBooking AI Reception`
- Instance ID: `74f78377-766f-46b7-a745-4bc97b68a8dc`
- Flow ID: `dcccf542-587c-426c-a644-a4c6f24da6e4`
- Status/state: `PUBLISHED` / `ACTIVE`
- Content SHA after run: `cb4895040bddaee125c5e62c24ea88ee99f315ad7ab5eccbda9689f310e21cda`
- Connect flow was not changed or deployed.

## Production Smoke Tests

Read-only site/API smoke:
- `./infra/scripts/smoke_test_production.sh`: PASS

Lex runtime / deployed Lambda / deployed API smoke ContactIds:
- `codex-prod-staff-emmy-oneshot-20260712-1309`
  - Input: `I want to book a pedicure tomorrow at eleven AM with Emmy.`
  - Result: `staffPreference=Amy`, all staff IDs `e75b9b6d-ad6a-4060-b945-43f1358e3a79`, no `appointmentId`.
- `codex-prod-staff-emmy-correction-20260712-1309`
  - Start state: Trang final confirmation.
  - Input: `No, I want Emmy, not Trang.`
  - Result: fresh confirmation with Amy, stale Trang discarded, all staff IDs Amy, no `appointmentId`.
- `codex-prod-staff-emily-unknown-20260712-1309`
  - Input: `I want Emily.`
  - Result: clarification prompt, `staffPreference/staffId/selectedStaffId/confirmedStaffId/confirmedStaffName` cleared, ignored ungrounded staff slot, no Any staff, no appointment.
- `codex-prod-staff-first-available-20260712-1310`
  - Input: `First available.`
  - Result: explicit Any staff path worked (`current_turn_any_staff` in Lex response), selected available Trang, no appointment before final yes.
- `codex-prod-staff-dtmf-amy-20260712-1310`
  - Dynamic runtime staff menu contained `2: Amy`.
  - Input digit `2`.
  - Result: Amy ID selected consistently, no appointment before final yes.
- `codex-prod-staff-dtmf-trang-20260712-1310`
  - Dynamic runtime staff menu contained `1: Trang`.
  - Input digit `1`.
  - Result: Trang ID selected consistently, no appointment before final yes.

Production DB smoke verification:
- Each synthetic smoke ContactId produced exactly 1 `CallSession`, 1 `AIInteractionLog`, 1 `BookingAttempt`, and 0 `Appointment`.
- Debug for correction shows `currentTurnStaffMention=Amy`, `discardedStaleStaff=Trang`, `staffSource=current_turn_alias`.
- Debug for unknown Emily shows `ignoredUngroundedSlots=["staffPreference"]`, stale Trang discarded, no staff IDs selected.

No real handset call was placed from Codex in this run. No final production `yes` was sent, to avoid creating a live appointment. The exact after-yes behavior is covered by regression tests and passed locally.

## Staff IDs Verified

- Amy: `e75b9b6d-ad6a-4060-b945-43f1358e3a79`
- Trang: `903511ee-4849-43dd-85fb-73595e79a233`
- Kelly: `25406cde-99ef-4407-999d-cf42eaa67bc3`

## iOS Timezone Read-Only Verification

No backend appointment time, salon timezone, UTC conversion, or date calculation was changed.

Production API appointment detail for `843d034d-5d36-4426-870c-84cdc1b09d2e` returned:
- `startTime=2026-07-13T18:45:00.000Z`
- `endTime=2026-07-13T20:25:00.000Z`
- `salon.timezone=America/New_York`
- `staff.id=e75b9b6d-ad6a-4060-b945-43f1358e3a79`
- `staff.fullName=Amy`

Production DB read-only check matched the API response. iOS should render this appointment using the salon timezone.

## Rollback References

- API rollback reference: previous image `sha256:fd36d5cc9437635ec9a1cb487fbb46e33ad42d0ecf9344726623f46033206f37`, or redeploy the previous GitHub commit before `91da759`.
- Lambda rollback reference: update `fastaibooking-booking-handler` code back to package with `CodeSha256=Fd+OlHCVlhlgvj7jazYrQqApwgNVLVtssqHbQ3TQfC8=` / `RevisionId=96a6fc66-2fd2-4689-bfc1-2315f8c72808` from before this run.
- Lex rollback: not needed; prod alias stayed on version `31`.
- Connect rollback: not needed; flow unchanged.

## Commit And Push

- Code commit: `91da759` (`fix(call-flow): honor explicit staff corrections`)
- Report commit: created after this report is committed.
- Push result: recorded in final Codex response after push.

## Remaining Risks

- Production Lex has no custom staff synonym slot type, so Emmy/Emmie recognition is implemented deterministically in Lambda/API instead of Lex synonyms.
- Only conservative aliases were added. Other ASR variants should be added only with evidence and tests.
- Real handset audio was not placed by Codex; production path was verified with Lex runtime, deployed Lambda, deployed API, and production DB logs.
- Existing pre-run dirty files were not touched: `fastaibooking-current-state.zip` and `docs/AGENT_RUN_REPORT_2026-07-11_permanent_customer_salon_delete_datetime.md`.
