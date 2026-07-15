# Thuyet Voice Recognition Full Set / Staff Run Report

Date: 2026-07-15

## Scope

Fixed Amazon Connect / Lex / Lambda / API voice booking recognition for Thuyet's live tests:

- Full Set ASR alias recovery, including unsafe sunset rejection.
- Slot grounding and continuation after partial booking extraction.
- Any staff / first available recognition and exclusions.
- Trang/Amy/Kelly/Kevin alias handling and final-confirmation staff edits.
- Prompt/menu ordering for service DTMF.
- Lambda, API, Lex, and Connect deployments.

## Live Log Export

Exported parsed Lambda turn debug to:

- `docs/live-thuyet-voice-recognition-2026-07-15.json`

Query window:

- Vietnam: `2026-07-15T21:35:00+07:00` to `2026-07-15T22:00:00+07:00`
- UTC: `2026-07-15T14:35:00Z` to `2026-07-15T15:00:00Z`
- Log group: `/aws/lambda/fastaibooking-booking-handler`
- Caller observed: `+84798171999`
- Called number: `+18483487681`

The Lambda turn debug logs do not include `bookingAttempt.normalizedRequest`; that field is exported as `null` with a source note when unavailable.

## Live ContactIds And Root Causes

| VN time | ContactId | Observed transcript | Root cause |
| --- | --- | --- | --- |
| 21:38 | `f306f29c-4a35-4ad9-9679-5bd9aaacede7` | `so we'll set today at three p m with amy` | Missing Full Set alias for `so we'll set`; date/time/staff were captured but `serviceName` stayed unset, so bot asked service. |
| 21:41 | `b1f85cfb-d631-42b8-97f1-241bfd3e34ae` | `fun fact today`, then `at gpm with amy` | Slow utterance split across turns; second turn lost the prior service/date context and `gpm` was not grounded as time. |
| 21:43 | `186690ad-80c1-46e3-9d61-228083c56572` | `the sunset is beautiful` | Unsafe `sunset` was accepted as Full Set while `lastAskedSlot=serviceName`; needed a negative sunset rule. |
| 21:49 | `5808bd78-a690-44d4-bbd8-1c4a1ae2ca71` | `and it's top if i` | Intended “Any staff is fine” was not deterministic in staff context and ASR/Lex yielded an unrecognized staff token `top`. |
| 21:52 | `cc1e989b-6323-47eb-83a3-745a001142e2` | `phone chat today at three pm with amy` | Date/time/staff were extracted, but service stayed unset and FulfillmentCodeHook returned generic help instead of continuing booking. |
| 21:55 | `31b181de-d18f-4f9f-a40e-d6a87c6d1a60` | `no with jang instead`, then `jang` | `jang` was not mapped to Trang in the staff-change/final-confirmation path. |

## Files Changed

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/test/ai-internal.test.ts`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/SlotTypes/NailServiceType/SlotType.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/SlotTypes/StaffPreferenceType/SlotType.json`
- `infra/aws/connect/contact-flows/ai-reception.json`
- `docs/live-thuyet-voice-recognition-2026-07-15.json`
- `docs/AGENT_RUN_REPORT_2026-07-15_thuyet_voice_recognition_fullset_staff.md`

Pre-existing dirty/untracked files were left unstaged: `fastaibooking-current-state.zip`, `docs/AGENT_RUN_REPORT_2026-07-11_permanent_customer_salon_delete_datetime.md`, and `docs/report-artifacts/2026-07-13-any-staff-known-caller-operator-queue/`.

## Tests Added

Added regression coverage for:

- Known caller full sentence direct confirmation: `Full Set today at 3 PM with Amy`.
- Slow/full sentence variants including `Full Set... today at 3 PM... with Amy`.
- Full Set aliases: `phone set`, `phone chat`, `pool set`, `food set`, `so we'll set`, and related speech variants.
- Sunset negative cases: `The sunset is beautiful` and `sunset today at 3 PM...`.
- `Any staff is fine` and `any staff but not Trang`.
- `No, with Trang instead` and `No, with Jang instead`.
- Repeated service while asking customer name.
- Service DTMF `4` maps to Full Set only under service menu context.
- Staff DTMF `4` remains staff-menu scoped.

## Commands And Results

- `npm run test:lambda`: PASS, 136 tests.
- `npm run test:api`: PASS, 278 tests.
- `npm run typecheck:api`: PASS.
- `npm run build:api`: PASS.
- `npm run typecheck:admin`: PASS.
- `npm run build:admin`: PASS. Vite chunk-size warning only.
- `git diff --check`: PASS.

## Deployment

Lambda:

- Function: `fastaibooking-booking-handler`
- Before: `LastModified=2026-07-15T13:20:54.000+0000`, `CodeSha256=DCXJJK1WZouwCNAP2rKQJP+5ktNizjmCHnGcSuahViM=`
- After: `LastModified=2026-07-15T17:40:04.000+0000`, `CodeSha256=Ulj4wXWXPmwq0AKmgg53oEbag2STrU7IUH9So2M7nDI=`
- State: `Active`, `LastUpdateStatus=Successful`

API/Admin:

- Command: `npm run deploy:ec2`
- Result: PASS.
- API image: `sha256:a6e21e691e0ccbcd5095a6a015575a7db8672162bad1b8a263ae041f0d9b45fd`
- Prisma: no pending migrations.
- API container: healthy.
- Health: `https://api-new-nail.kendemo.com/health` returned `status=ok` at `2026-07-15T17:50:16.526Z`.

Lex:

- Bot: `KHMIXGA2US`
- Alias: `JVIPIZDYE3` / `prod`
- Before alias version: `36`
- New published version: `37`
- Alias after deploy: `botVersion=37`, `botAliasStatus=Available`
- Locale `en_US` version 37: `Built`
- Code hook preserved: `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`
- Version 37 `NailServiceType`: `Pedicure`, `Manicure`, `Gel Manicure`, `Full Set`, `Dip Powder`
- Version 37 `StaffPreferenceType`: `Any staff`, `Trang`, `Amy`, `Kelly`, `Kevin`

Connect:

- Instance: `74f78377-766f-46b7-a745-4bc97b68a8dc`
- Flow: `dcccf542-587c-426c-a644-a4c6f24da6e4` / `FastAIBooking AI Reception`
- Updated content with greeting: `Hi, I can help book your appointment. Tell me the service, day, time, and staff. You can press 0 for a person.`
- Deployed content has `2026-07-15-thuyet-voice-recognition-fullset-staff` 6 times and old source marker 0 times.
- Lex alias ARN still points to `KHMIXGA2US/JVIPIZDYE3`.
- Re-associated phone number `+18483487681` / `f2e36faa-5264-4955-8a18-e2f53755c102` to the AI Reception flow; command succeeded.

## Production Smokes

Real PSTN/ViberOut calls cannot be originated from this Codex environment. I ran deployed Lex runtime and deployed Lambda smokes against prod alias/API and did not send final `yes`, so no appointment was created.

Lex runtime smokes:

- `codex-thuyet-voice-20260715-fullset`: `Full Set today at 3 PM with Amy` -> direct confirmation, `serviceName=Full Set`, `staffPreference=Amy`, `customerName=lee`.
- `codex-thuyet-voice-20260715-slow-fullset`: `Full Set... today at 3 PM... with Amy.` -> direct confirmation.
- `codex-thuyet-voice-20260715-phone-chat`: `phone chat today at 3 PM with Amy` -> direct confirmation as Full Set.
- `codex-thuyet-voice-20260715-sunset`: `The sunset is beautiful` -> no Full Set, asks `serviceName`.

Deployed Lambda smokes:

- `codex-thuyet-voice-20260715-any-staff-prod`: `Any staff is fine` with `lastAskedSlot=staffPreference` -> selected first available Kevin and confirmed Full Set today 3 PM.
- `codex-thuyet-voice-20260715-trang-instead-prod`: `No, with Trang instead.` -> updated Amy to Trang and reconfirmed, preserving Full Set/date/time/customer.
- `codex-thuyet-voice-20260715-jang-instead-prod`: `No, with Jang instead.` -> mapped Jang to Trang and reconfirmed.
- `codex-thuyet-voice-20260715-service-dtmf-4-prod`: service menu DTMF `4` -> `dtmfRouting.accepted=true`, `route=service_menu`, `selection=Full Set`, next slot `requestedDate`.

## Commit

- Commit hash: `50cf4bd0508a2aec4adf21d052321f88dd151552`
- Pushed branch: `main`
