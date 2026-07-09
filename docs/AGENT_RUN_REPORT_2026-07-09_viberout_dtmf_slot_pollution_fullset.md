# ViberOut DTMF Slot Pollution Full Set Fix - 2026-07-09

## Scope

Only the Amazon Connect / Lex / Lambda phone booking flow was changed.

## Root Cause From ContactId 9fed7297-a05f-4862-bb34-372e84f74825

The caller pressed `4` while `lastAskedSlot=serviceName`. Lex correctly resolved `serviceName` to `Full Set`, but it also polluted unrelated slots from the same DTMF turn:

- `requestedDate.originalValue=4` -> `2027-04-01`
- `requestedTime.originalValue=4 PM` -> `4 PM`
- `staffPreference.originalValue=m` -> invalid one-letter noise

The Lambda previously merged those Lex slots/session values too broadly, so the fake date/time/staff could be persisted and sent to the API. A backend customer lookup could also echo polluted date/time back during that same DTMF turn.

## Files Changed

- `infra/lambda/booking-handler/index.mjs`
- `tests/lambda/booking-handler.test.mjs`
- `docs/AGENT_RUN_REPORT_2026-07-09_viberout_dtmf_slot_pollution_fullset.md`

Note: `fastaibooking-current-state.zip` is modified in the working tree but was not part of this scoped Lambda fix.

## Fix Applied

- Added Lex-turn sanitization before booking logic reads slots.
- When `lastAskedSlot=serviceName` and scoped DTMF maps to a service, only `serviceName` is accepted.
- DTMF `4` now sets both `serviceName=Full Set` and `confirmedServiceName=Full Set`.
- Same-turn polluted `requestedDate`, `requestedTime`, customer fields, and invalid staff slots are ignored.
- Backend-echoed ignored fields are stripped before returning session attributes to Lex.
- One-letter staff noise such as `m` is not persisted or sent as `staffPreference`.
- Added aliases for `phone set`, `full sit`, `full sell`, and `fo set`; canonical output remains `Full Set`.
- Preserved known `Full Set` so empty/noisy Lex slots do not re-ask service.
- Added one compact JSON log line per Lex turn with contact id, transcript, input mode, slot values, scoped DTMF digit, ignored slots, before/after session attributes, next slot, and message. Secret-like keys are filtered.

## Tests Added

- Polluted ViberOut DTMF 4 turn with `requestedDate=4`, `requestedTime=4 PM`, and `staffPreference=m`.
- `phone set` maps to `Full Set`.
- Full utterance `I want to book a phone set tomorrow at 3 PM with Trang` keeps date/time/staff.
- One-letter staff noise is cleared and the staff list is re-elicited without sending `staffPreference`.
- Existing press `0` transfer and backend timeout no-auto-transfer tests remain covered.

## Commands And Results

- `npm run test:lambda` - passed, 45/45.
- `npm run test:api` - passed, 72/72.
- `npm run typecheck:api` - passed.
- `npm run build:api` - passed.
- `git diff --check` - passed.
- `node --check infra/lambda/booking-handler/index.mjs` - passed.
- Active scan for `AI services not available` and `Acrylic Full Set` in Lambda, Connect, Lex v10, API source, and active tests - no matches.

## Deploy Result

Lambda was changed and deployed. API code was not changed, so API deploy was not needed.

- Function: `fastaibooking-booking-handler`
- Region: `us-east-1`
- Final Lambda LastModified: `2026-07-09T08:39:43.000+0000`
- Final Lambda CodeSha256: `fomWPkDwQC/Ptd8oQEqv0g10HjDyImYpjxA6DD1fi1Y=`
- UpdateStatus: `Successful`

## Deployed Smoke

Direct deployed Lambda invoke with the polluted ViberOut shape:

- `inputMode=DTMF`
- `inputTranscript=4`
- `lastAskedSlot=serviceName`
- `serviceName.originalValue=4`
- `requestedDate.originalValue=4`, interpreted `2027-04-01`
- `requestedTime.originalValue=4 PM`
- `staffPreference.originalValue=m`

Result:

- `serviceName=Full Set`
- `confirmedServiceName=Full Set`
- `requestedDate` absent
- `requestedTime` absent
- `staffPreference` absent
- no `transferToQueue`
- no `forceHumanEscalation`
- next slot: `requestedDate` because deployed caller lookup recognized the smoke caller name; for unknown callers the local regression asks `customerName` first.

## Retest Cases

- ViberOut caller reaches service prompt and presses `4`: must continue as `Full Set`, no fake `2027-04-01`, no fake `4 PM`, no staff `m`.
- Unknown caller after DTMF `4`: ask customer name before accepting date/time.
- Known caller after DTMF `4`: skip known name and ask the next real missing field.
- Say `phone set tomorrow at 3 PM with Trang`: service must be `Full Set`; date/time/staff retained.
- Staff prompt hears `m`: do not save/send it; ask staff again from the list.
- Press `0`: still transfers to operator.
- Backend timeout: still reprompts without auto-transfer.
