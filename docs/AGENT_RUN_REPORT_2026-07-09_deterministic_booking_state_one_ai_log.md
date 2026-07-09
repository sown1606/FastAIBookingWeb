# Deterministic booking state and one AI log row - 2026-07-09

## Scope

Fixed and deployed only the requested production path:

- Amazon Connect / Lex / Lambda booking handler
- API AI interaction logging
- Admin AI log list/detail display
- Connect AI Reception contact flow service DTMF/operator prompt

## Root cause from ContactId 7d8111d6-c239-48fe-9725-388c01f22964

Production DB check for internal `CallSession.id=e1a8fe45-eda1-4053-b295-95dfa5ec702c` showed one call session and three visible `amazon_connect_booking_fulfillment` AI interaction rows.

Historical rows included:

- `currentTurnTranscript="i want to book a full set tomorrow at two p m with trang"`
- `slotToElicit="customerName"`
- `trustedSlotsAfter` had Full Set, 2026-07-10, 2 PM, Trang
- `lastAskedSlotAfter` was missing/blank

Root causes:

- Local Lambda `ElicitSlot` responses could ask a question without committing `lastAskedSlot`, `slotToElicit`, trusted slots, active DTMF state, and `operatorHelpMentioned` into session attributes and debug payload.
- The API created one visible `AIInteraction` row per Amazon Connect booking turn instead of upserting one call-level row and appending turn data.
- Repeated known service text while asking for `customerName` was treated like a missed name, so the prompt sounded reset/confused.
- DTMF routing depended on stale/blank `activeDtmfMenu`; digit 4 could be interpreted as service, staff, or time pollution depending on slot context.
- Current-turn parsing and debug were too easy to confuse with aggregated transcript. The handler now preserves raw `currentTurnTranscript` for the current answer and keeps aggregate transcript only for summary/debug.

## Fixes

- Added deterministic dialog state commit for every Lambda prompt.
- Every question response now persists `lastAskedSlot`, `slotToElicit`, trusted booking slots, active DTMF menu/options, and `operatorHelpMentioned`.
- Booking state asks only the first missing field in this order: service, date, time, staff, customer name, confirmation/create.
- Known service/date/time/staff/name are preserved and not asked again unless caller explicitly changes them.
- Customer-name reprompts now keep context:
  - `Got it: Full Set tomorrow at 2 PM with Trang. What name should I put on the appointment?`
  - `I already have Full Set for tomorrow at 2 PM with Trang. What name should I put on the appointment?`
- Press-0 help is introduced in the initial service prompt and not appended to ordinary slot prompts.
- Service DTMF options now include `0: "__operator__"` and `4: "Full Set"`.
- Active DTMF menu now wins over stale `lastAskedSlot`.
- Raw DTMF input stays logged as `currentTurnTranscript="4"`.
- API now upserts one `AIInteraction` for `amazon_connect_booking_fulfillment` per call/contact and appends per-turn debug into `responsePayload.turnHistory[]`.
- Admin AI Logs list shows one row per real call and detail renders embedded turn history.

## Live deploy

Lambda:

```json
{
  "FunctionName": "fastaibooking-booking-handler",
  "LastModified": "2026-07-09T14:47:49.000+0000",
  "CodeSha256": "BwOEfEIGOuVIyFeXnwSmaUh7ktorrCMoF4wdkZsHvgE=",
  "RevisionId": "84cc4d05-8cc8-43df-ae76-7cc02bb4c1d4",
  "LastUpdateStatus": "Successful"
}
```

Lex:

```json
{
  "Alias": "prod",
  "Status": "Available",
  "BotVersion": "21",
  "LastUpdatedDateTime": "2026-07-09T10:16:04.326000-04:00",
  "lambdaARN": "arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler"
}
```

Lex DTMF settings checked on deployed version 21:

- `serviceName` slot `GHZKSCLGQP`: DTMF `maxLength=1`, end timeout 800 ms.
- `staffPreference` slot `4YN5NBP9ZR`: DTMF `maxLength=1`, end timeout 800 ms.

Amazon Connect:

- Contact flow: `FastAIBooking AI Reception`
- Flow id: `dcccf542-587c-426c-a644-a4c6f24da6e4`
- State/status: `ACTIVE` / `PUBLISHED`
- Lex alias in flow: `arn:aws:lex:us-east-1:197452633989:bot-alias/KHMIXGA2US/JVIPIZDYE3`
- Initial prompt in deployed flow: `Hi, I can help book your appointment. You can say the service, press 4 for Full Set, or press 0 for a real person.`
- Deployed session attrs include `operatorHelpMentioned=true`, `activeDtmfMenu=service`, and:

```json
{
  "1": "Pedicure",
  "2": "Manicure",
  "3": "Gel Manicure",
  "4": "Full Set",
  "5": "Dip Powder",
  "0": "__operator__"
}
```

Phone number:

```json
{
  "PhoneNumberId": "f2e36faa-5264-4955-8a18-e2f53755c102",
  "PhoneNumber": "+18483487681",
  "Status": "CLAIMED",
  "InstanceId": "74f78377-766f-46b7-a745-4bc97b68a8dc",
  "TargetArn": "arn:aws:connect:us-east-1:197452633989:instance/74f78377-766f-46b7-a745-4bc97b68a8dc"
}
```

The AWS CLI response confirms the number is claimed in the same Connect instance. The CLI does not expose the inbound contact-flow association for the claimed number; the updated published AI Reception flow and Lex alias were verified directly. A real inbound handset call is the definitive phone-number-to-flow proof.

API/Admin:

- `npm run deploy:ec2`: passed.
- Docker images rebuilt, Prisma reported no pending migrations, API container healthy, nginx reloaded.
- API liveness/readiness passed.
- Admin `https://admin-new-nail.kendemo.com/` returned HTTP 200.

## Live smokes

Two-turn booking smoke:

- Contact id: `codex-deterministic-one-log-1783608506312`
- Turn 1: `i want to book a full set tomorrow at two p m with trang`
- Lambda response: `Got it: Full Set tomorrow at 2 PM with Trang. What name should I put on the appointment?`
- Turn 2: `full set`
- Lambda response: `I already have Full Set for tomorrow at 2 PM with Trang. What name should I put on the appointment?`
- Production DB result:
  - `aiLogRows=1`
  - `turnHistoryLength=2`
  - `lastAskedSlotAfter=["customerName","customerName"]`
  - `currentTurnTranscript=["i want to book a full set tomorrow at two p m with trang","full set"]`

DTMF 4 smoke:

- Contact id: `codex-deterministic-dtmf4-1783608554315`
- Raw input: `4`
- Lambda response: `What day would you like? You can say today or tomorrow.`
- `serviceName=Full Set`
- `confirmedServiceName=Full Set`
- Fake `requestedTime=4 PM` was ignored.
- Production DB result:
  - `aiLogRows=1`
  - `turnHistoryLength=1`
  - `currentTurnTranscript="4"`
  - `slotToElicit="requestedDate"`
  - `ignoredPollutedSlots=["requestedTime"]`

Exact saved `dtmfRouting`:

```json
{
  "digit": "4",
  "route": "service_menu",
  "accepted": true,
  "nextSlot": "requestedDate",
  "selection": "Full Set",
  "readSource": "inputTranscript",
  "menuMismatch": false,
  "digitSequence": ["4"],
  "ignoredReason": "",
  "lastAskedSlotBefore": "serviceName",
  "activeDtmfMenuBefore": "service",
  "isBareDigitUtterance": true,
  "isMultiDigitOrDigitSequence": false
}
```

Press 0 smoke:

- Contact id: `codex-deterministic-press0-1783608610232`
- Response: `Please wait while I connect you.`
- `dialogAction.type=Close`
- `transferToQueue=true`
- `forceHumanEscalation=true`
- `escalationReason=customer_pressed_zero`

DTMF 4 reaches Lambda in the deployed Lambda smoke, and Connect/Lex are configured to pass one digit. I did not place a real PSTN/ViberOut handset call. If a future real call has no Lambda turn with `inputTranscript="4"` or equivalent, the remaining fault is upstream of Lambda in Connect/Lex/ViberOut DTMF delivery.

Known caller note:

- For `+84798171999`, the deployed smoke did not receive a known customer name from the API lookup, so the bot asked for name once.
- The API path preserves customer memory after a successful name capture for future calls.

## Test results

- `npm ci`: passed. Existing audit output: 19 vulnerabilities, 2 low, 13 moderate, 4 high.
- `npm --prefix apps/api run prisma:generate`: passed after `npm ci`.
- `npm run test:lambda`: passed, 62/62.
- `npm run test:api`: passed, 78/78.
- `npm run typecheck:api`: passed.
- `npm run build:api`: passed.
- `npm run typecheck:admin`: passed.
- `npm run build:admin`: passed, with existing Vite chunk-size warning.
- `git diff --check`: passed.

## Commit

- Commit hash: `9d6f0a5d18baefc7065537c2ed9d549333d7c4ab`
- Push branch: `main`
