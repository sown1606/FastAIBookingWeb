# Live Call DTMF4 Slot Grounding Hold Music Report - 2026-07-09

## Scope
- Fixed only the Amazon Connect / Lex / Lambda phone booking flow, Admin AI debug display, and Connect human escalation hold path.
- Live call under review:
  - Amazon Connect ContactId: `477db497-266c-4be9-b8ed-2091a6e64eed`
  - Caller: `+84798171999`
  - Called: `+18483487681`
  - Internal AI log CallSession.id: `3175af7d-7c6c-4675-acf0-b3bf94dfcdaa`
- Admin labels were clarified so the external Amazon Connect ContactId and internal `CallSession.id` are separate concepts.

## Root Cause From ContactId 477db497-266c-4be9-b8ed-2091a6e64eed
- Lex sent cumulative slot memory, not just current-turn slot truth. On turn 1, the current transcript was only `tomorrow`, but Lex also carried `requestedTime.originalValue = "4 PM"`.
- Lambda and API paths trusted too much Lex/session slot state across turns. That allowed an ungrounded `requestedTime = "4 PM"` to persist even though the caller only answered the date.
- On turn 2, the bot was asking `customerName`; Lex/current input was `sorry`, and the previous code accepted that bare answer as a customer name.
- Repeated service prompts were caused by two issues:
  - confirmed `Full Set` was not guarded in every response builder when backend/API missing-fields logic asked for `serviceName`;
  - the staff prompt wording was long and menu-heavy, so after service was already known it could sound like the service menu was being repeated.

## Fixes
- Added strict current-turn grounding in `infra/lambda/booking-handler/index.mjs`.
  - Uses only `event.inputTranscript` as `currentTurnTranscript`.
  - Accepts slot updates only when current slot asked, grounded in current transcript, accepted by active DTMF menu, or already trusted from session attributes.
  - Ignores ungrounded Lex slots in `ignoredUngroundedSlots`.
- Fixed the `requestedTime = 4 PM` ghost.
  - Bare `4` is no longer treated as a time unless `lastAskedSlot = requestedTime`.
  - `requestedTime` from Lex is ignored when current transcript has no time phrase and time was not the current slot.
- Added customer-name noise filtering.
  - `sorry`, fillers, yes/no, service/date/operator/digit words are rejected as names.
  - `sorry` now re-prompts: `What name should I put on the appointment?`
- Added deterministic DTMF routing for digits 0-9.
  - Active DTMF menu is saved in `activeDtmfMenu` and `activeDtmfOptionsJson`.
  - Menu routing wins over stale `lastAskedSlot`, and mismatches are logged.
  - Digit 0 always routes to operator transfer.
  - Digit 4 selects `Full Set` only in service menu, or staff option 4 only in staff menu.
  - Digit 4 at date/time/name slots is not silently consumed and does not become `4 PM`.
- Added service-confirmation guards.
  - If `serviceName` or `confirmedServiceName` is `Full Set`, Lambda does not elicit `serviceName` again.
  - If backend returns missing service after Lambda already has confirmed service, Lambda redirects to the real next missing slot and rewrites the spoken prompt.
- Shortened staff prompts.
  - After service is known: `Got it, Full Set. Which staff would you like?...`
  - Dynamic staff DTMF says `For staff, press 1...` and avoids huge menus for larger staff lists.
- Admin debug JSON now includes all turns in one call-level payload with current transcript, aggregate transcript, slot before/after state, DTMF routing, ignored slots/noise, trusted slots, session attributes, dialog action, missing fields, parsed output, transfer flags, and escalation reason.
- Admin AI log detail now displays:
  - current turn transcript
  - aggregated request text
  - last asked slot before/after
  - active DTMF menu before/after
  - DTMF routing
  - ignored slots/noise

## Live DTMF Smoke Results
These were deployed Lambda smokes, not real phone calls.

### Press 4
- Synthetic ContactId: `codex-live-dtmf4-smoke-20260709`
- Response:
  - `dialogAction.type = ElicitSlot`
  - `slotToElicit = requestedDate`
  - `serviceName = Full Set`
  - `confirmedServiceName = Full Set`
  - `requestedTime` unset
- Exact deployed `dtmfRouting` log:

```json
{
  "digit": "4",
  "lastAskedSlotBefore": "serviceName",
  "activeDtmfMenuBefore": "service",
  "route": "service_menu",
  "selection": "Full Set",
  "accepted": true,
  "ignoredReason": "",
  "nextSlot": "requestedDate",
  "menuMismatch": false
}
```

- The same log showed `ignoredPollutedSlots: ["requestedTime"]` for the injected `requestedTime = "4 PM"`.
- This proves deployed Lambda handles `4` correctly when it reaches Lambda. I did not place a real ViberOut/Amazon Connect phone call from the tester device, so if a future real call has no AI log with `inputTranscript = "4"`, the problem is upstream of Lambda in Connect/Lex DTMF delivery.

### Press 0
- Synthetic ContactId: `codex-live-press0-smoke-20260709`
- Response:
  - `dialogAction.type = Close`
  - message: `Please wait while I connect you.`
  - `transferToQueue = true`
  - `forceHumanEscalation = true`
  - `escalationReason = customer_pressed_zero`
  - `queueId = d0f2a5d8-e983-4609-9bbc-efb0881a465d`
  - synthetic escalation id: `4518b637-81c7-46ca-bcc0-0dce5ac97214`
- Exact deployed `dtmfRouting` log:

```json
{
  "digit": "0",
  "lastAskedSlotBefore": "serviceName",
  "activeDtmfMenuBefore": "service",
  "route": "operator_transfer",
  "selection": "operator",
  "accepted": true,
  "ignoredReason": "",
  "nextSlot": "operator",
  "menuMismatch": false
}
```

## Hold Music / Queue Flow Result
- Deployed Human Escalation flow:
  - ID: `c7386b94-56bb-4382-b517-ee890bbacb51`
  - ARN: `arn:aws:connect:us-east-1:197452633989:instance/74f78377-766f-46b7-a745-4bc97b68a8dc/contact-flow/c7386b94-56bb-4382-b517-ee890bbacb51`
- Operator queue:
  - ID: `d0f2a5d8-e983-4609-9bbc-efb0881a465d`
- Customer queue flow:
  - ID: `6bdf546e-4e3a-4bf5-954f-fb78fa6a3d5b`
  - Name: `Default customer queue`
  - Type: `CUSTOMER_QUEUE`
- Human Escalation flow now does:
  - play `Please wait while I connect you.`
  - set target queue `d0f2a5d8-e983-4609-9bbc-efb0881a465d`
  - set customer queue flow `6bdf546e-4e3a-4bf5-954f-fb78fa6a3d5b`
  - `TransferContactToQueue`
- Live customer queue flow contains a repeated queue prompt and music prompt `Music_Pop_ThisAndThatIsLife_Inst.wav`.
- AI Reception flow verified:
  - ID: `dcccf542-587c-426c-a644-a4c6f24da6e4`
  - still points to Lex alias `KHMIXGA2US/JVIPIZDYE3`
  - still transfers to Human Escalation flow `c7386b94-56bb-4382-b517-ee890bbacb51`
- Phone number verified:
  - `+18483487681`
  - phone number id `f2e36faa-5264-4955-8a18-e2f53755c102`
  - status `CLAIMED`
  - instance `74f78377-766f-46b7-a745-4bc97b68a8dc`
- AWS CLI does not expose the inbound phone-number-to-contact-flow mapping in `describe-phone-number`; a console check or real inbound call is still the definitive verification that `+18483487681` enters AI Reception.

## Files Changed
- `infra/lambda/booking-handler/index.mjs`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/admin/admin.routes.ts`
- `apps/api/test/ai-internal.test.ts`
- `apps/admin/src/pages/ai-log-detail-page.tsx`
- `apps/admin/src/lib/i18n.tsx`
- `infra/aws/connect/contact-flows/human-escalation.json`
- This report.

## Tests Added / Updated
- Lambda:
  - tomorrow does not create fake requested time
  - customer name noise `sorry`
  - confirmed service never asks service again when backend says missing service
  - active service DTMF menu `4 -> Full Set`
  - active staff DTMF menu `4 -> staff option 4`
  - wrong-slot digit `4` does not become `4 PM`
  - press `0` logs operator routing and transfers
- API:
  - updated staff prompt assertion for the new concise wording.

## Commands And Results
- `npm run test:lambda`: passed, 55 tests.
- `npm run test:api`: passed, 72 tests.
- `npm run typecheck:api`: passed.
- `npm run build:api`: passed.
- `npm run typecheck:admin`: passed.
- `npm run build:admin`: passed.
- `git diff --check`: passed.
- `npm run deploy:ec2`: passed.
  - API/Admin Docker images rebuilt.
  - Prisma reported no pending migrations.
  - API container restarted healthy.
  - Admin container recreated.
  - nginx reloaded.
- `curl https://api-new-nail.kendemo.com/health`: passed.
- `curl -I https://admin-new-nail.kendemo.com/`: passed, HTTP 200.

## Deploy Result
- Lambda `fastaibooking-booking-handler` deployed.
  - LastModified: `2026-07-09T11:19:15.000+0000`
  - LastUpdateStatus: `Successful`
  - CodeSha256: `Mez3rPlFRCluI4txLCY18aMaGi51e+PNQF3hyQIjufk=`
- Connect Human Escalation flow deployed with the customer queue flow hook.
- API/Admin deployed to EC2 and are healthy.

## Retest Script
1. Call `+18483487681` from the tester phone.
2. Say: `full set`.
3. If the service menu is active, press `4`.
   - Expected AI log: `currentTurnTranscript = "4"`.
   - Expected `dtmfRouting.route = "service_menu"`, `selection = "Full Set"`.
   - Expected no `requestedTime = "4 PM"` unless the bot was explicitly asking time.
4. Say: `tomorrow`.
   - Expected `requestedDate = 2026-07-10` salon-local.
   - Expected `requestedTime` unset.
   - Expected next slot `requestedTime`.
   - Expected `ignoredUngroundedSlots` includes `requestedTime` if Lex sends stale `4 PM`.
5. When asked name, say: `sorry`.
   - Expected no `customerName = "sorry"`.
   - Expected `ignoredNoiseFields` includes `customerName`.
   - Expected prompt: `What name should I put on the appointment?`
6. At the staff prompt, press `4`.
   - Expected route uses `activeDtmfMenu = "staff"`.
   - Expected staff option 4 from `activeDtmfOptionsJson`.
   - Expected service remains `Full Set`.
7. Press `0`.
   - Expected message: `Please wait while I connect you.`
   - Expected `transferToQueue = true`.
   - Expected `escalationReason = customer_pressed_zero`.
   - Expected caller hears the customer queue prompt/music while waiting.
8. In Admin, open the AI call detail and use Copy full call debug JSON.
   - Expected one JSON contains all turns with `currentTurnTranscript`, `aggregatedRequestText`, `dtmfRouting`, ignored slots/noise, trusted slots, and both IDs:
     - Amazon Connect ContactId
     - internal `CallSession.id`

