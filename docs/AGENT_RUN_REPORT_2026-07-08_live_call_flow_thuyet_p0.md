# Live AI Phone Flow Thuyet P0 Run Report

## Short Summary
- Scope: real Amazon Connect -> Lex -> Lambda -> API phone booking flow only.
- Deployed: Lambda `fastaibooking-booking-handler` and API container only.
- Not touched: UI, Admin, CCP, fake seed data, data deletion, Lex alias/version, Connect flow JSON.
- Result: live Lex resolves `full set` to `Full Set`; live Lambda DTMF `4` sets and preserves `serviceName=Full Set`; backend/API errors return wait-and-transfer, not goodbye.

## Current Root Cause
The latest exported tester call data showed stale full-set service state reaching the live call session as a non-`Full Set` resolved service label, and that value was accepted into `serviceName`/session attributes. This could pollute later turns after the caller gave a name/date. The fix canonicalizes any stale full-set resolved value back to customer-facing `Full Set` in Lambda/API while still using the real matched service record id for availability and booking.

The exact phrase `AI services not available at this moment, goodbye` was not found in repo call-flow code, live Connect flow JSON, CloudWatch log search, or production AI/DB export. The likely source is a managed Lex/Connect failure path or older deployed artifact. Active Connect Lex error path now says a wait/transfer message, and backend/API failures return `Please wait while I connect you.`

## Live Phone/Contact Flow Path
- Live AI number: `+18483487681`.
- Connect instance: `74f78377-766f-46b7-a745-4bc97b68a8dc` (`fastaibooking`).
- AI Reception flow: `FastAIBooking AI Reception`, id `dcccf542-587c-426c-a644-a4c6f24da6e4`.
- Human Escalation flow: `FastAIBooking Human Escalation`, id `c7386b94-56bb-4382-b517-ee890bbacb51`.
- Operator queue: `FastAIBooking Operator Queue`, id `d0f2a5d8-e983-4609-9bbc-efb0881a465d`.
- Lex alias used by active flow: `arn:aws:lex:us-east-1:197452633989:bot-alias/KHMIXGA2US/JVIPIZDYE3`.
- Lambda hook: `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`.

## Versions And Deploy
- Lex prod alias before/after: version `17` -> `17` unchanged.
- Lambda before: `2026-07-08T18:37:46.000+0000`, sha `gSYcd/qfnTBwtTXPj8ViJMzCNPNHgCVS4RqJHA8DpOk=`.
- Lambda after: `2026-07-09T01:56:53.000+0000`, sha `TJ8DcCrnNET+T9Qoy4nf0ON7tFCPizd9ezv/0CsRcGw=`.
- API deploy: rebuilt and restarted only `fastaibooking-api`; healthy image `sha256:ddbf68e3463024d37b91750f2f908e53e101d19ea033161daa88b6b5378a8227`, started `2026-07-09T01:57:49Z`.
- Lambda env verified by key names: `FASTAIBOOKING_API_BASE_URL`, `FASTAIBOOKING_API_INTERNAL_TOKEN`, `DEFAULT_SALON_ID`.

## AI Logs And Key Excerpts
Production export saved: `docs/live-call-flow-thuyet-ai-logs-2026-07-08.json`.

Counts:
- Matching requested phones: `19` calls.
- Last 12 hours: `1` call.
- Latest merged calls: `42`.
- Latest booking attempts: `40`.
- Latest AI interaction logs: `69`.

Key latest live excerpt:
- Contact id `cec28e0b-0c77-4a6e-9506-bbb05fe5072d`, caller `+84798171999`, dialed `+18483487681`.
- Transcript stored: `three`.
- Raw Lex slots showed original service `full set`, but stale resolved service was stored in session attributes before this fix.
- The call reached `MISSING_INFO` for `staffPreference`, not a successful booking.

## Fix Applied
- Lambda: strengthened wait coverage logs and exact staff wait prompt wording.
- API: canonicalizes stale full-set resolved names to `Full Set` for:
  - normalized request/service parser output,
  - Lex response session attributes,
  - booking attempts and AI interaction logs,
  - confirmation and booked/no-availability caller speech,
  - service prompt option lists.
- API still uses the real matched service record id for availability validation and appointment creation.
- Tests added for stale live-style full-set resolution in Lambda and API.
- Removed a parser prompt example that contained blocked full-set wording.

## Please Wait Coverage
- Customer lookup: `Please wait a moment while I pull up your information.`
- Service lookup: `Please wait a moment while I check our services.`
- Staff lookup/options: `Please wait a moment while I check available staff.`
- Availability lookup: `Please give me a moment while I check availability.`
- Booking create: `Please wait while I create your appointment.`
- Transfer: `Please wait while I connect you.`
- Structured logs now include `operationName`, `waitPrompt`, `durationMs`, `contactId`, `sessionId`, `salonId`, `serviceName`, `lastAskedSlot`, and `outcome`.

## Hold Music / Queue Waiting
- Human escalation flow speaks: `Please wait while I connect you. If there is a short wait, you may hear quiet hold music while an operator joins.`
- Customer queue flow: `Default customer queue`, id `6bdf546e-4e3a-4bf5-954f-fb78fa6a3d5b`.
- Queue flow action: `MessageParticipantIteratively`.
- Queue flow includes prompt `Music_Pop_ThisAndThatIsLife_Inst.wav`, so callers hear queue audio/music while waiting.
- Lex cannot play music during Lambda fulfillment; Lex fulfillment update prompts cover long Lambda/API fulfillment waits.

## Validation
- `npm run test:lambda`: pass, 38/38.
- `npm run test:api`: pass, 70/70.
- `npm run typecheck:api`: pass.
- `npm run build:api`: pass.
- `git diff --check`: pass.

## Post-Deploy Smoke
- Lex runtime `I want to book a full set.`: `serviceName.interpretedValue=Full Set`, next slot `customerName`.
- Live Lambda direct DTMF `4` with `lastAskedSlot=serviceName`: `serviceName=Full Set`, `confirmedServiceName=Full Set`, next slot `requestedDate`.
- Live Lambda follow-up `my name is Thuyet`: preserved `Full Set`, filled `customerName=Thuyet`.
- Live Lambda follow-up `tomorrow at 3 PM`: preserved `Full Set`, filled `requestedDate=2026-07-09`, `requestedTime=3 PM`.
- Live API backend error simulation: returned `HUMAN_ESCALATION`, message `Please wait while I connect you.`, `transferToQueue=true`, no goodbye.
- Active Connect flow scan: no `AI services not available`; Lex error branch has wait/transfer prompt.
- Real phone call test: not placed from this environment.

## Commands Run
- Required AWS path script saved to `docs/live-call-flow-thuyet-aws-2026-07-08.txt`.
- Production DB/AI export saved to `docs/live-call-flow-thuyet-ai-logs-2026-07-08.json`.
- Contact path saved to `docs/live-call-flow-thuyet-contact-path-2026-07-08.json`.
- Lambda deploy: `zip -j ... infra/lambda/booking-handler/index.mjs`, then `aws lambda update-function-code`, then `aws lambda wait function-updated`.
- API deploy: targeted `rsync` of API call-flow files, then `docker compose build api && docker compose up -d api`.

## Remaining Risk
- The exact spoken `AI services not available at this moment, goodbye` text was not present in source, live flow JSON, CloudWatch search, or DB export, so the exact historical source cannot be proven beyond the live-path evidence.
- Manual phone validation still needs a real call with an operator logged into CCP as Available.

## Manual Phone Test Script For Thuyet
1. Call `+18483487681`.
2. Say: `I want to book a full set.`
3. If asked to use keypad, press `4`.
4. Say: `My name is Thuyet.`
5. Say: `Tomorrow at 3 PM.`
6. If asked for staff, say `first available` or press the listed first-available option.
7. Confirm the service is always spoken as `Full Set`.
8. Press `0` at any prompt to verify operator transfer says `Please wait while I connect you.`

## Commit
- Commit hash: d06ad1a.
