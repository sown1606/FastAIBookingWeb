# Agent Run Report: Voice Slot Lock and ASR Clarification

Date: 2026-07-16
Repository: FastAIBooking production repo
Salon: Kiet Nails & Beauty (`9bd14a12-85ed-418a-af7d-3f5cb329c147`)
Called number: `+18483487681`

## Scope

Fixed the production Amazon Connect/Lex voice booking path only. The change is limited to Lambda voice normalization, API voice normalization, voice regression tests, and this report. No unrelated Admin, mobile, booking CRUD, or general API refactor was made.

## Exact Root Causes

1. Staff-turn transcripts could overwrite trusted time. While `lastAskedSlot=staffPreference`, phrases such as `and it stopped at five` were allowed to produce a current-turn time candidate and replace trusted `3 PM`.
2. Negative correction language such as `and it's not a five` was not treated as rejection of the mistaken `5 PM` interpretation and could fall through to staff-name handling.
3. ASR alternatives and diagnostics were collected mainly for logging. They were not used with a safe proposed-value/confirmation flow for distorted service or staff recognition.
4. Full Set recognition had to avoid unsafe global aliases. A distorted service phrase with clear date/time context needed a scoped clarification path, while unrelated phrases such as `sunset is beautiful` had to remain rejected.
5. The any-staff success response selected the first available technician but did not explicitly acknowledge that the caller had requested first available.

## Contact Evidence

- Contact `1771efd3-27a4-4e2b-8a36-02a27705b8b2`: caller intended `Full Set today at 3 PM with Amy`; ASR transcript was `who said today at three p m and it's time to fight`. Before this fix, date/time survived but service and staff were lost. After this fix, date/time are preserved, Full Set is stored only as `proposedServiceName`, and the bot asks `I heard today at 3 PM, but I'm not sure about the service. Did you say Full Set?`.
- Contact `88a5a00a-ee09-4055-b73f-7c3909b2c784`: first turn `full set today at three p m` correctly trusted `Full Set`, `2026-07-16`, and `3 PM`. The second staff-turn transcript `and it stopped at five` previously overwrote the time with `5 PM`; the third turn `and it's not a five` was misread as an unknown technician. After this fix, `requestedTime` remains `3 PM`, `and it stopped at five` asks for first-available confirmation, and `and it's not a five` rejects that mistaken interpretation.
- Contact `c337567a-ba31-4eab-a7e3-d435fa5f75a9`: `full set today at three pm any staff is fine` was understood and selected Kevin. After this fix, the confirmation explicitly says `You said first available. Kevin is available...` while still requiring final booking confirmation.
- Safety case: `sunset is beautiful` still does not resolve or propose Full Set.

## Files Inspected

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/test/ai-internal.test.ts`
- Lex bot `KHMIXGA2US`, locale `en_US`, bot version `10` configuration, custom vocabulary, slot types, and BookAppointment runtime behavior
- Amazon Connect flow `dcccf542-587c-426c-a644-a4c6f24da6e4`

## Files Changed

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/test/ai-internal.test.ts`
- `docs/AGENT_RUN_REPORT_2026-07-16_voice_slot_lock_clarification.md`

## Slot Mutation Policy

Added one clearly named helper in both Lambda and API: `buildVoiceSlotMutationPolicy`.

Policy:

- A proposed slot mutation is accepted when the proposed field is the active slot being elicited.
- A trusted field can be replaced by an explicit correction phrase such as `actually`, `change`, `make it`, `instead`, `rather`, or `not 3`.
- A trusted field can be replaced by a clearly structured new booking request that includes service, date, time, and staff context.
- A same-value mutation is accepted as no-op reconciliation.
- Bare or ambiguous time phrases outside the active requested-time slot are blocked from mutating trusted time.
- Confidence alone is never enough to overwrite a protected trusted field.

## Before/After Examples

Before:

- Bot: asks for staff.
- Caller: `and it stopped at five`.
- Result: `requestedTime` changed from `3 PM` to `5 PM`.

After:

- Bot: asks for staff.
- Caller: `and it stopped at five`.
- Result: `requestedTime` remains `3 PM`; bot asks `I still have Full Set today at 3 PM. Did you mean first available?`.

Before:

- Caller: `who said today at three p m and it's time to fight`.
- Result: date/time survived, but service was lost with no safe Full Set proposal.

After:

- Result: date/time survive; service is not committed; bot asks `I heard today at 3 PM, but I'm not sure about the service. Did you say Full Set?`.

Before:

- Caller: `Full Set today at 3 PM, any staff is fine`.
- Result: Kevin selected, but response did not acknowledge first available.

After:

- Result: `You said first available. Kevin is available. Just to confirm: Full Set today at 3 PM with Kevin. Is that correct?`.

## Lex, Lambda, API, and Connect Changes

Lambda/API:

- Added strict slot ownership for service, date/time, and staff normalization.
- Added proposed-value confirmation for ambiguous Full Set recognition: `proposedServiceName` and `awaitingServiceConfirmation`.
- Added proposed-value confirmation for ambiguous staff recognition: `proposedStaffPreference` and `awaitingStaffConfirmation`.
- Added staff-context handling for `and it stopped at five` as an ambiguous first-available candidate requiring confirmation.
- Added rejection handling for `and it's not a five`, preserving `3 PM` and returning to the staff choice prompt.
- Added ASR decision use of top transcript, N-best alternatives, active slot, trusted state, domain plausibility, and actual confidence when supplied.
- Added diagnostics for active slot, proposed mutations, accepted mutations, prevented mutations, clarification reason, ASR alternatives used, and before/after trusted state.

Lex:

- Verified canonical custom vocabulary on version `10`: `Full Set`, `Any staff`, `Any staff is fine`, `First available`, and `Whoever is available`.
- Verified active staff names and service slot synonyms are present in slot-specific resources.
- Verified runtime hints remain slot-specific from Lambda: service names while eliciting service; staff names and first-available phrases while eliciting staff.
- Verified no malformed ASR outputs such as `time to fight` or `stopped at five` were added to global vocabulary.
- Verified bot locale speech model setting: `amazon.nova-2-sonic-v1:0`, `nluConfidenceThreshold=0.4`, and default speech detection sensitivity.

Connect:

- No Connect flow edit was required.
- Verified production number `+18483487681` points to phone ID `f2e36faa-5264-4955-8a18-e2f53755c102`.
- Verified phone association routes to flow `dcccf542-587c-426c-a644-a4c6f24da6e4`, `FastAIBooking AI Reception`, `PUBLISHED`, `ACTIVE`.
- Verified the flow uses Lex alias `KHMIXGA2US/JVIPIZDYE3`.
- Verified voice timeout attributes: start timeout `8000`, global end timeout `3200`, max audio `20000`, service end timeout `1800`, date/time/staff end timeout `1600`, customer name end timeout `2000`, and interrupt enabled.

## Tests and Pass Counts

- `node --check infra/lambda/booking-handler/index.mjs`: pass
- `npm run test:lambda`: pass, 145/145
- `npm run test:api`: pass, 289/289
- `npm run typecheck:api`: pass
- `npm run build:api`: pass
- `git diff --check`: pass

Added regression coverage for:

- Exact `Full Set today at 3 PM with Amy`
- Slow segmented `Full Set`, `today at 3 PM`, `with Amy`
- Exact `Full Set today at 3 PM, any staff is fine`
- Distorted service `who said today at three p m and it's time to fight`
- Protected staff-turn time phrase `and it stopped at five`
- Negative correction `and it's not a five`
- Explicit valid correction `Actually change it to 5 PM with Amy`
- Unsafe unrelated phrase `sunset is beautiful`
- N-best disagreement for Full Set and first available
- Exact any-staff response wording
- No nonterminal disconnect or automatic transfer
- Final appointment creation only after explicit final confirmation

## Commands and Results

- `node --check infra/lambda/booking-handler/index.mjs`: passed
- `npm run test:lambda`: passed, 145 tests
- `npm run test:api`: passed, 289 tests
- `npm run typecheck:api`: passed
- `npm run build:api`: passed
- `EC2_KEY=/Users/macbookpro/Desktop/fastAibooking/fastAibooking.pem npm run deploy:ec2`: passed
- Lambda package/update for `fastaibooking-booking-handler`: passed
- Lex `build-bot-locale`: completed with locale status `Built`
- Lex `create-bot-version`: created version `40`
- Lex `update-bot-alias`: production alias updated to version `40`
- `./infra/scripts/smoke_test_production.sh`: passed all health checks
- `git diff --check`: passed

## Deployment Identifiers and Versions

API:

- Deployment workflow: `npm run deploy:ec2`
- Final Docker image SHA: `sha256:23883d0abb1b016ffbbe29f174528bc259e7396731088e7f02bfbe82d3ac4d24`
- Prisma migrations: no pending migrations
- Nginx config test/reload: success

Lambda:

- Function: `fastaibooking-booking-handler`
- LastModified: `2026-07-16T14:22:16.000+0000`
- CodeSha256: `IAyptIk46mywPhEQOW5UJyaPoMdBYAxzkL36uU9Qoes=`
- RevisionId: `6442f9a8-5e92-4bd1-9a5d-269c32d2208d`
- State: `Active`
- LastUpdateStatus: `Successful`

Lex:

- BotId: `KHMIXGA2US`
- AliasId: `JVIPIZDYE3`
- Alias name: `prod`
- Published bot version: `40`
- Alias status: `Available`
- Alias updated: `2026-07-16T10:24:05.174000-04:00`
- Lambda hook: `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`

Connect:

- Instance: `74f78377-766f-46b7-a745-4bc97b68a8dc`
- Flow: `dcccf542-587c-426c-a644-a4c6f24da6e4`
- Flow status: `PUBLISHED`, `ACTIVE`
- Phone: `+18483487681`
- PhoneNumberId: `f2e36faa-5264-4955-8a18-e2f53755c102`
- Connect flow update: not required

## Production Smoke Results

All smoke tests used the final production Lex alias version `40`. No final `yes` confirmation was sent in smoke tests, so no synthetic appointment was created and no cleanup appointment was required.

- `Full Set today at 3 PM with Amy`: reached final confirmation for Full Set today at 3 PM with Amy; no appointment created.
- Slow segmented `Full Set`, `today at 3 PM`, `with Amy`: preserved service/date/time/staff and reached final confirmation; no appointment created.
- `Full Set today at 3 PM, any staff is fine`: response said `You said first available. Kevin is available...`; no appointment created.
- `who said today at three p m and it's time to fight`: preserved date/time, proposed Full Set, asked service confirmation, and did not book.
- Protected sequence `full set today at three p m` then `and it stopped at five` then `and it's not a five`: `requestedTime` stayed `3 PM`; first-available proposal was rejected; no booking used `5 PM`.
- `Actually change it to 5 PM with Amy`: accepted the explicit time correction to `5 PM`; production availability then rejected the request because the appointment duration exceeded business hours; no appointment created.
- `sunset is beautiful`: did not resolve or propose Full Set.
- Lambda N-best Full Set disagreement: top distorted transcript plus alternate `Full Set today at three p m` proposed Full Set and required confirmation; no booking.
- Lambda N-best first-available disagreement: active staff slot with alternate `first available` proposed any staff and required confirmation; no booking.
- Production health smoke script: admin frontend 200, app frontend 200, health liveness/readiness 200, API health liveness/readiness 200.

## Real-Handset Acceptance Status

No real handset, ViberOut, or PSTN acceptance call was performed during this run. All production acceptance here was typed/runtime smoke testing against the deployed API, Lambda, Lex alias, and Connect configuration.

## Remaining Risks

- Real-world ASR drift can still produce new distorted phrases. The fix constrains destructive state mutation and routes plausible domain matches through confirmation instead of expanding global aliases.
- The explicit correction sequence to `5 PM with Amy` is correctly accepted as a mutation, but production business hours can still reject the resulting appointment when the service duration does not fit.
- The final pushed commit hash is reported in the final response because this report file is part of that same commit.

## Commit and Branch

- Branch: `main`
- Remote: `origin/main`
- Commit hash: reported in the final response after this report is committed and pushed.
