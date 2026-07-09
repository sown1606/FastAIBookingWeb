# Live call smooth DTMF deploy verification - 2026-07-09

## Scope

Focused on the live Amazon Connect / Lex / Lambda phone booking path, Admin AI log debug visibility, and Connect operator hold/queue routing.

## Root cause from live evidence

- ContactId: `477db497-266c-4be9-b8ed-2091a6e64eed`
- Caller: `+84798171999`
- Called: `+18483487681`
- Admin call detail ID was the Amazon Connect `ContactId`.
- AI detail `3175af7d-7c6c-4675-acf0-b3bf94dfcdaa` was the internal `CallSession.id`, not the Connect ContactId.
- Lex was carrying cumulative slot memory into later turns. That allowed `requestedTime=4 PM` to appear on a turn where `inputTranscript` was only `tomorrow`.
- The same cumulative/current-turn confusion let `inputTranscript=sorry` become `customerName=sorry`.
- Press `4` had two layers:
  - Lambda routing was fixed to map initial `4` to `Full Set`.
  - Live Lex initially classified first-turn `4` as fallback or began `BookAppointmentIntent` by eliciting `serviceName` again. Final fix added literal digit utterances, `{serviceName}`, and initial dialog code hook invocation so first-turn `4` reaches Lambda as `Full Set`.

## Code fixes

- Lambda now uses current-turn grounding and ignores ungrounded cumulative Lex slots.
- `requestedTime` is ignored when the current transcript has no time phrase and Lambda was not asking for time.
- customer-name noise such as `sorry`, `ok`, `operator`, `zero`, `four`, `tomorrow`, and service words is rejected.
- confirmed recognized services are preserved across DialogCodeHook, FulfillmentCodeHook, FallbackIntent recovery, backend failures, and API missing-service responses.
- FallbackIntent with booking context, including `3 PM` while waiting for time, is treated as booking recovery instead of service fallback.
- DTMF routing logs structured `dtmfRouting` for digits.
- Initial Connect greeting now includes service voice, `4 for Full Set`, and `0 for a real person`.
- Lex DTMF slot specs for non-phone slots are now `maxLength=1`, `endTimeoutMs=800`.
- Lex BookAppointmentIntent now includes first-turn digit utterances `1`-`5`, `press N`, `number N`, `{serviceName}`, and initial dialog hook invocation.
- HumanEscalationIntent now includes literal `0`, `press 0`, and `number 0`.

## Deployment

### Lambda

- Function: `fastaibooking-booking-handler`
- Before:
  - LastModified: `2026-07-09T11:19:15.000+0000`
  - CodeSha256: `Mez3rPlFRCluI4txLCY18aMaGi51e+PNQF3hyQIjufk=`
  - RevisionId: `2fa643ed-4d39-4fd1-9f77-0b5d42e20df8`
- After:
  - LastModified: `2026-07-09T11:57:36.000+0000`
  - CodeSha256: `NJu30ZcGML7F1CqvssPuckW58Dgf6r5rKGA/NKi/JQI=`
  - RevisionId: `a0574b0a-8bdd-4bec-b9f3-420deade332c`
  - Runtime: `nodejs20.x`
  - LastUpdateStatus: `Successful`

### Lex

- Bot: `KHMIXGA2US`
- Alias: `JVIPIZDYE3` / `prod`
- Before alias version: `17`
- Intermediate versions:
  - `18`: DTMF slot prompt settings
  - `19`: literal digit utterances
- Final alias version: `20`
- Final alias LastUpdatedDateTime: `2026-07-09T08:15:00.344000-04:00`
- Lambda hook still points to `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`.
- Version `20` BookAppointmentIntent:
  - sampleCount: `44`
  - has digits `1`-`5`: yes
  - has `{serviceName}`: yes
  - initial next step: `InvokeDialogCodeHook`
  - code hook active: `true`
- Version `20` serviceName slot DTMF:
  - `maxLength=1`
  - `endTimeoutMs=800`

### Connect

- Phone number: `+18483487681`
- Phone number id: `f2e36faa-5264-4955-8a18-e2f53755c102`
- Instance: `74f78377-766f-46b7-a745-4bc97b68a8dc`
- `describe-phone-number` confirms the number is claimed on the expected instance. AWS CLI does not expose the phone-number-to-contact-flow association in `describe-phone-number`; no interactive handset call was placed from this environment.
- AI Reception flow deployed:
  - id: `dcccf542-587c-426c-a644-a4c6f24da6e4`
  - name: `FastAIBooking AI Reception`
  - state/status: `ACTIVE` / `PUBLISHED`
  - live content contains the new greeting with `4 for Full Set` and `0 for a real person`
  - live content references Lex alias `KHMIXGA2US/JVIPIZDYE3`
  - live content references Human Escalation flow `c7386b94-56bb-4382-b517-ee890bbacb51`
- Human Escalation flow deployed:
  - id: `c7386b94-56bb-4382-b517-ee890bbacb51`
  - name: `FastAIBooking Human Escalation`
  - state/status: `ACTIVE` / `PUBLISHED`
  - says `Please wait while I connect you.`
  - targets queue `d0f2a5d8-e983-4609-9bbc-efb0881a465d`
  - references customer queue flow `6bdf546e-4e3a-4bf5-954f-fb78fa6a3d5b`
  - fallback says no agents are available instead of silently hanging up
- Queue:
  - id: `d0f2a5d8-e983-4609-9bbc-efb0881a465d`
  - name: `FastAIBooking Operator Queue`
  - status: `ENABLED`
- Customer queue flow:
  - id: `6bdf546e-4e3a-4bf5-954f-fb78fa6a3d5b`
  - name: `Default customer queue`
  - type: `CUSTOMER_QUEUE`
  - state/status: `ACTIVE` / `PUBLISHED`

## Live smoke verification

### Lex runtime press 4

Session: `codex-lexruntime-v20-4-20260709T121518Z`

Result:

- Lex top intent: `BookAppointmentIntent`
- `serviceName.originalValue = "4"`
- `serviceName.interpretedValue = "Full Set"`
- Lambda response:
  - `serviceName = Full Set`
  - `confirmedServiceName = Full Set`
  - next slot: `requestedDate`

CloudWatch `dtmfRouting`:

```json
{
  "digit": "4",
  "lastAskedSlotBefore": "",
  "activeDtmfMenuBefore": "",
  "route": "service_menu",
  "selection": "Full Set",
  "accepted": true,
  "ignoredReason": "",
  "nextSlot": "requestedDate",
  "menuMismatch": false
}
```

### Lex runtime press 0

Session: `codex-lexruntime-v20-0-20260709T121522Z`

Result:

- Lex top intent: `HumanEscalationIntent`
- Lambda response: `Please wait while I connect you.`
- `transferToQueue = true`
- `escalationReason = customer_pressed_zero`

CloudWatch `dtmfRouting`:

```json
{
  "digit": "0",
  "lastAskedSlotBefore": "",
  "activeDtmfMenuBefore": "",
  "route": "operator_transfer",
  "selection": "operator",
  "accepted": true,
  "ignoredReason": "",
  "nextSlot": "operator",
  "menuMismatch": false
}
```

### Fallback 3 PM while waiting for time

Synthetic Lambda session: `codex-smooth-fallback3pm-2026-07-09T12-04-50-734Z`

Result:

- input: `3 PM`
- incoming intent: `FallbackIntent`
- previous confirmed service: `Full Set`
- parsed `requestedTime = 3 PM`
- preserved `serviceName = Full Set`
- preserved `confirmedServiceName = Full Set`
- did not ask for service

## Admin log verification

- Deployed Admin/API query for latest press-0 Lex runtime smoke returned one AI log row.
- AI interaction id: `ce84cf58-f62a-4ecf-9262-f594b2c0556b`
- CreatedAt: `2026-07-09T12:15:26.308Z`
- taskType: `amazon_connect_booking_fulfillment`
- internal CallSession.id: `73cf642d-16fe-4aaa-8704-e3e3d6535980`
- providerCallId/contactId: `codex-lexruntime-v20-0-20260709T121522Z`
- response preview: `Please wait while I connect you.`
- This proves Admin AI Logs receive new deployed-path rows. It does not prove a new real handset call after `07:23`; no interactive real phone call was placed by the agent.

## Hold music / queue result

- Human handoff prompt is deployed before queue transfer.
- Queue transfer targets `FastAIBooking Operator Queue`.
- Human escalation flow references the published `Default customer queue` customer queue flow.
- No silent hangup branch remains for queue transfer errors; fallback message says no agents are available.
- Audible hold music/repeated queue prompt was not verified by a real phone call from this environment. A tester should still place a handset call to confirm audio after queue transfer.

## Commands and results

- `npm ci` - passed; npm reported 19 audit findings.
- `npm --prefix apps/api run prisma:generate` - passed after `npm ci`.
- `npm run test:lambda` - passed, 59/59.
- `npm run test:api` - passed, 72/72.
- `npm run typecheck:api` - passed.
- `npm run build:api` - passed.
- `npm run typecheck:admin` - passed.
- `npm run build:admin` - passed with existing Vite chunk-size warning.
- `git diff --check` - passed.
- `npm run deploy:ec2` - passed; API container healthy, no pending migrations.
- `aws lambda get-function-configuration` - verified updated Lambda.
- `aws logs tail /aws/lambda/fastaibooking-booking-handler --since 30m --format short` - verified deployed structured logs.
- Lex DRAFT build/publish/update alias - final alias `prod` -> version `20`.
- Connect `update-contact-flow-content` - AI Reception and Human Escalation deployed and verified as `ACTIVE` / `PUBLISHED`.

## Files changed

- `infra/lambda/booking-handler/index.mjs`
- `tests/lambda/booking-handler.test.mjs`
- `infra/aws/connect/contact-flows/ai-reception.json`
- `infra/aws/connect/contact-flows/human-escalation.json`
- `infra/aws/lex/FastAIBookingBot-v7/...`
- `infra/aws/lex/FastAIBookingBot-v8/...`
- `infra/aws/lex/FastAIBookingBot-v10/...`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/admin/admin.routes.ts`
- `apps/api/test/ai-internal.test.ts`
- `apps/admin/src/pages/ai-log-detail-page.tsx`
- `apps/admin/src/lib/i18n.tsx`

## Retest script

1. Call `+18483487681`.
2. At the first greeting, press `4`.
   - Expected: bot accepts `Full Set` immediately and asks for date, not service.
   - Admin/CloudWatch should show `dtmfRouting.route = service_menu`, `selection = Full Set`.
3. Say `tomorrow`.
   - Expected: bot asks for time; no fake `4 PM`.
4. Say `3 PM`.
   - Expected: bot accepts time and never asks service again.
5. Say a noise word when asked name, such as `sorry`.
   - Expected: bot asks `What name should I put on the appointment?`
6. Call again and press `0` at the first greeting.
   - Expected: bot says `Please wait while I connect you.`
   - Expected: Connect transfers to queue and caller hears the customer queue audio/prompt.
7. Confirm Admin Call Logs and Admin AI Logs show the same real Connect ContactId, with AI detail also showing internal `CallSession.id`.

## Commit and push

- Branch: `main`
- Upstream: `origin/main`
- Commit hash: see final agent response after commit/push. A commit cannot contain its own final SHA in this tracked report because changing this line changes the commit SHA.
