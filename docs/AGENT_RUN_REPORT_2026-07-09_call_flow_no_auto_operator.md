# Live AI Phone Flow No-Auto-Operator Report - 2026-07-09

## Summary
- Scope stayed limited to the real phone call flow: Lambda booking handler, API AI internal booking flow, Amazon Connect AI Reception flow, and call-flow tests/docs.
- Deployed Lambda, API, and AI Reception contact flow. Lex alias stayed on existing prod alias/version because the live Lex version already resolves `Full Set`.
- Fixed unintended operator transfer paths so `transferToQueue=true` is emitted only for DTMF `0`, explicit human/operator language, or a high-confidence `HumanEscalationIntent`.

## Root Cause
The live backend data for `+84798171999` did not show an explicit backend escalation:
- callSession `0f4f92e4-65f5-4f0b-a18a-a2461d5d20f4`
- caller `+84798171999`, dialed `+18483487681`
- status `IN_PROGRESS`
- routingOutcome `AI_RECEPTION`
- escalationReason `null`
- no operator records
- no stored `transferToQueue` or `forceHumanEscalation`
- last stored caller-facing message was the staff prompt asking for Trang/Amy/Kelly/etc. or first available, with `0` offered for an operator.

The concrete live auto-operator risk was in Amazon Connect AI Reception: action `41e3f239-5b57-4363-92fc-9d594579fa98`, the Lex `NoMatchingError` branch, said “This is taking longer than expected...” and routed directly to `transfer-human-escalation-flow`. That path could transfer without caller saying operator or pressing `0`.

Additional code risks fixed:
- Lambda converted backend non-OK/timeout/unreachable into human transfer on normal booking fulfillment.
- API route fallback converted internal errors/timeouts into `HUMAN_ESCALATION`.
- API service had repeated-missing-slot escalation logic.
- API trusted `forceHumanEscalation=true` / `transferToQueue=true` as input without re-checking explicit operator intent.

## Live Phone / Contact Path
- Dialed AI number: `+18483487681`
- Connect instance: `74f78377-766f-46b7-a745-4bc97b68a8dc`
- AI Reception contact flow: `dcccf542-587c-426c-a644-a4c6f24da6e4` / `FastAIBooking AI Reception`
- Lex bot alias used by flow: `arn:aws:lex:us-east-1:197452633989:bot-alias/KHMIXGA2US/JVIPIZDYE3`
- Lex prod alias before/after: bot `KHMIXGA2US`, alias `JVIPIZDYE3`, version `17`, status `Available`
- Lambda hook: `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`
- Operator queue: `d0f2a5d8-e983-4609-9bbc-efb0881a465d` / `FastAIBooking Operator Queue`
- Human escalation flow: `c7386b94-56bb-4382-b517-ee890bbacb51`
- Customer queue flow: `6bdf546e-4e3a-4bf5-954f-fb78fa6a3d5b`, includes iterative music block.

Raw captures:
- `docs/live-call-flow-thuyet-no-auto-operator-aws-2026-07-09.txt`
- `docs/live-call-flow-thuyet-no-auto-operator-data-2026-07-09.json`
- `docs/live-call-flow-thuyet-no-auto-operator-contact-path-2026-07-09.json`

## Before / After
- Lambda before: `2026-07-09T01:56:53.000+0000`, `TJ8DcCrnNET+T9Qoy4nf0ON7tFCPizd9ezv/0CsRcGw=`
- Lambda after: `2026-07-09T02:36:46.000+0000`, `9PJ7a/4Cz9IypNCpFjcMtAeJgzFe3mgPO02N6Z3FBg8=`
- API before: `sha256:ddbf68e3463024d37b91750f2f908e53e101d19ea033161daa88b6b5378a8227`
- API after: `sha256:ace10eba7b4ab21f3271f56f85714fe4e90aff9da7c68669969e93ff165e593d`, started `2026-07-09T02:37:37.999146909Z`, healthy
- Connect flow before: Lex `NoMatchingError` branch auto-transferred.
- Connect flow after: Lex `NoMatchingError` branch says “I am having trouble hearing that. Please tell me the appointment you want, or press 0 for an operator.” and routes back to the service Lex prompt.

## Fix Applied
- Added strict `shouldTransferToHuman()` in Lambda.
- Added strict `shouldTransferToHuman()` gate in API service.
- Removed API repeated-missing-slot auto escalation.
- Changed API internal route fallback to `MISSING_INFO` with `transferToQueue=false`.
- Changed Lambda backend failure handling on normal booking/update paths to reprompt with wait/callback/press-0 option, not transfer.
- Preserved DTMF fallback and press `0` operator escalation.
- Preserved `Full Set` customer-facing wording and DTMF `4 -> Full Set`.
- Updated Connect AI Reception Lex error branch to reprompt instead of transferring.

## Please Wait / Hold Coverage
- Service lookup: “Please wait a moment while I check our services.”
- Customer lookup: “Please wait a moment while I pull up your information.”
- Staff lookup: “Please wait a moment while I check available staff.”
- Availability lookup: “Please give me a moment while I check availability.”
- Booking creation: “Please wait while I create your appointment.”
- Explicit operator transfer: “Please wait while I connect you.”
- Hold music is only on actual operator queue transfer. Human escalation flow speaks the wait prompt, updates queue, then transfers to the queue. Customer queue flow has iterative music configured.

## Production Data Notes
- `+84798171999` production call record did not prove the caller pressed `0` or asked for an operator.
- There was no linked operator/contact-center escalation record for that call in DB export.
- DB export includes older historical rows with `Acrylic Full Set`. I did not rename, delete, or seed data. Active call-flow code/prompts/tests no longer contain `Acrylic Full Set`.

## Validation
- `npm run test:lambda` - pass, 39 tests
- `npm run test:api` - pass, 70 tests
- `npm run typecheck:api` - pass
- `npm run build:api` - pass
- `git diff --check` - pass
- Active call-flow scan for `Acrylic Full Set`, `AI services not available`, and old “connect you to our team” string - no matches.

## Post-Deploy Smoke
- Lex runtime: “I want to book a full set.” -> `BookAppointmentIntent`, `serviceName=Full Set`, no `transferToQueue`.
- Lambda direct DTMF `4` with `lastAskedSlot=serviceName` -> `serviceName=Full Set`, `confirmedServiceName=Full Set`, next slot `requestedDate`, no transfer.
- Lambda direct follow-up “my name is Thuyet” -> customerName `Thuyet`, preserved `Full Set`, no transfer.
- Lambda direct follow-up “tomorrow at 3 PM” -> date/time filled, preserved `Full Set`, no transfer.
- Lambda direct press `0` -> `transferToQueue=true`, `escalationReason=customer_pressed_zero`, message “Please wait while I connect you.”
- Lambda direct “I want to talk to a person” -> `transferToQueue=true`, `escalationReason=caller_requested_human`.
- Backend timeout/unavailable behavior covered in Lambda/API tests: wait prompt plus retry/reprompt/callback option, no auto transfer.
- Connect active production scan: old Lex error auto-transfer branch removed; transfer branch only reached when `$.Lex.SessionAttributes.transferToQueue == "true"`.

## Deploy Commands
- Lambda: `aws lambda update-function-code --function-name fastaibooking-booking-handler ...`
- API: `rsync` changed AI service/route files to EC2, then `docker compose build api && docker compose up -d api`
- Connect: `aws connect update-contact-flow-content --contact-flow-id dcccf542-587c-426c-a644-a4c6f24da6e4 --content file://infra/aws/connect/contact-flows/ai-reception.json`
- Lex: no deploy needed; prod alias/version unchanged and smoke passed.

## Remaining Risk
- I could not make a manual PSTN phone call from this environment. Thuyet should run the phone script below.
- The DB record for the reported `+84798171999` call had no contactId and no AI interaction logs attached, so exact Connect-side contact outcome is inferred from the live flow/log path rather than a single joined DB contact record.
- Direct Lambda post-deploy smoke with explicit operator paths created production validation records using contact id `codex-smoke-dtmf4-contact`; I did not delete them.

## Manual Phone Test For Thuyet
1. Call `+18483487681` from `+84 798 171 999`.
2. Say: “I want to book a full set.”
3. If asked for service again, press `4`.
4. Say: “my name is Thuyet.”
5. Say: “tomorrow at 3 PM.”
6. If asked for staff, say “first available.”
7. Expected: AI continues booking and does not transfer.
8. Press `0` only when intentionally testing operator transfer. Expected: “Please wait while I connect you.” then queue/hold music.

## Commit
- Fix commit hash: pending before commit.
