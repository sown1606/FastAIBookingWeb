# AI Call Booking Workflow Audit

Date: 2026-06-02

## 2026-07-07 Voice Interrupt, DTMF, and Wait Prompt Update

- AI entry now has an immediate local greeting before Lex/Lambda backend work: `Hi, thanks for calling. I can help book your appointment. What service would you like today?`
- `BookAppointmentIntent` initial response code hook is disabled in the checked-in Lex exports so Lex does not invoke Lambda before the first useful prompt.
- Lambda no longer calls the backend just to generate a dynamic staff prompt during `DialogCodeHook`.
- Service retry switches to keypad-first after one unclear service attempt.
- Staff is optional. Missing or unrecognized staff defaults to first available/Any staff; ambiguous or invalid DTMF staff input can still elicit one keypad correction.
- Staff keypad mapping is now `1=Trang`, `2=Amy`, `3=Kelly`, `4=first available`, `0=operator`.
- Press `0` from service and staff prompts escalates to the operator path.
- Slow booking fulfillment uses the Lex start/update wait prompts: `Please give me a moment while I check availability.` and `I’m still checking the schedule.`
- Backend booking API failures now return the safe operator handoff message instead of repeating the same slot question.
- Connect AI reception has a local greeting prompt before Lex, and the human escalation flow still speaks before queue transfer.

## 2026-06-02 Demo Fix Update

Current deployed path:

`Amazon Connect -> Lex alias prod version 8 -> Lambda fastaibooking-booking-handler -> POST /api/v1/internal/ai/appointments -> backend booking/escalation flow`

Deployed fixes:

- Lex `prod` alias now points to bot version `8`.
- New Lex custom slot type `NailServiceType` handles demo nail services and pedicure synonyms.
- `serviceName` now uses `NailServiceType` instead of `AMAZON.AlphaNumeric`.
- Added Lex samples for pedicure today/tomorrow, `pedi cure`, and `better cure`.
- Shortened Lex slot prompts and lowered audio end timeout from `640ms` to `500ms`.
- Shortened AI reception Connect prompts while preserving the same Lex prod alias ARN and human escalation flow.
- Lambda recovers service/date/time/name/phone from raw `inputTranscript` on DialogCodeHook and fulfillment.
- Backend resolves `today`, `tomorrow`, `this afternoon`, `tonight`, `tomorrow morning`, `tomorrow afternoon`, and weekdays in the salon timezone.
- Backend treats bare hours `1` through `7` as PM in salon booking context unless AM/morning is clear.
- Backend auto-normalizes obvious pedicure aliases instead of asking `Did you mean Pedicure?`.
- Missing-info and confirmation prompt turns keep booking attempt context but skip extra AI interaction/call-summary writes; final booking and escalation audit remain intact.

Deployment verification:

- EC2 backend deployed with `./infra/scripts/deploy_remote_ec2.sh`; API container healthy.
- Lambda code deployed to `fastaibooking-booking-handler`; last modified `2026-06-02T10:11:52.000+0000`; update status `Successful`.
- Lex version `8` created and alias `prod` (`JVIPIZDYE3`) updated to version `8`.
- Connect AI reception flow remains `PUBLISHED` and `ACTIVE`, using alias ARN `arn:aws:lex:us-east-1:197452633989:bot-alias/KHMIXGA2US/JVIPIZDYE3`.
- Versioned Lex export is now `infra/aws/lex/FastAIBookingBot-v8/`.
- Connect exports refreshed in `infra/aws/connect/contact-flows/`.

Current smoke result:

- `npm run test:lambda`: pass
- `npm --prefix apps/api run typecheck`: pass
- `npm --prefix apps/api run build`: pass
- `npm --prefix apps/api test -- --test-name-pattern "transcript recovery|confirmed transcript"`: pass; full API test suite also passed under that run.
- `node --check infra/lambda/booking-handler/index.mjs`: pass
- `bash -n infra/scripts/smoke_test_production.sh`: pass
- `infra/scripts/smoke_test_production.sh`: pass, including live Lambda recovery samples for `pedicure today`, `pedicure tomorrow`, `pedi cure`, and `better cure`.
- CloudWatch Lambda error scan after deploy/smoke: no matching error events found.
- Recent Lambda REPORT durations after deploy/smoke: mostly sub-second warm calls; highest observed sample was `2469.61 ms` on a cold/fulfillment call.

## Summary

The AI phone booking demo path is hardened and deployed:

`Amazon Connect -> Lex alias prod -> Lambda fastaibooking-booking-handler -> POST /api/v1/internal/ai/appointments -> backend booking/escalation flow`

The original demo failure mode is fixed:

- Numeric/code-like values such as `111115` are ignored as staff preferences.
- Invalid staff values are not stored in normalized booking requests.
- Caller-facing responses use active/bookable staff names only.
- No staff preference, "any staff", "anyone", and "whoever is available" search all active/bookable staff.
- Alternative suggestions are deduped by staff/time before speech.
- Lambda and backend responses preserve known customer/booking fields across turns and avoid asking again for already-known fields.
- Missing-slot and service-clarification retries escalate to a human after the third failed attempt.
- Backend timeout/non-OK/error paths return `forceHumanEscalation=true` and `transferToQueue=true`.
- Unexpected internal endpoint failures return a caller-safe Lex human escalation payload instead of raw error text.
- Human escalation records and AWS routing point to `FastAIBooking Operator Queue`.
- The AI Reception Contact Flow checks `$.Lex.SessionAttributes.transferToQueue` after Lex and transfers to `FastAIBooking Human Escalation` when true.
- Automated contract tests now cover the Lambda, internal AI endpoint, and role/dashboard guard contracts.

## Files Changed

- `apps/api/prisma/seed.ts`
- `apps/api/src/modules/ai/ai.prompts.ts`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/ai/ai.routes.ts`
- `apps/api/src/modules/call-center/call-center.service.ts`
- `apps/api/package.json`
- `infra/lambda/booking-handler/index.mjs`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/test/ai-internal.test.ts`
- `apps/api/test/role-guards.test.ts`
- `package.json`
- `infra/scripts/smoke_test_production.sh`
- `infra/aws/lex/FastAIBookingBot-v8/`
- `infra/aws/connect/contact-flows/ai-reception.json`
- `infra/aws/connect/contact-flows/human-escalation.json`
- `docs/AI_CALL_BOOKING_WORKFLOW_AUDIT.md`

## Backend Fixes

- Removed `staffPreference` as a required field for booking.
- Added active/bookable staff resolution with explicit statuses for all-staff, matched, ambiguous, and invalid/no-match preferences.
- Treats numeric, code-like, too-short, digit-containing, and unconfigured staff values as no staff preference.
- Clears invalid staff before writing `normalizedBookingRequest.staffName`.
- Canonicalizes exact/alias service matches, so `Pedicure` and `pedicure.` resolve to the same service.
- Uses real staff records for confirmation, booking, no-availability, and alternative speech.
- Dedupes alternatives before writing session attributes or speaking them.
- Keeps booking attempts, transcripts, AI interaction logs, call sessions, and escalation metadata populated.
- Explicit human, cancel, and reschedule handoff returns the exact caller message `Please wait while I connect you.` and sets transfer attributes for Connect routing.
- Escalation records now label the queue as `FastAIBooking Operator Queue` when the Amazon Connect queue id is configured.

## Lambda Fixes

- Forwards Lex intent name, transcript, interpreted slots, session attributes, contact id, called number, customer phone, and salon id when available.
- Sends `HumanEscalationIntent` to the backend when Lex gives that intent or when the utterance clearly asks to speak to a real person.
- Merges captured slots into `sessionAttributes` on every `DialogCodeHook` before returning `Delegate`.
- Hydrates known Lex slots from `sessionAttributes` so Lex does not elicit known fields again.
- Wraps backend API calls with a 4.5-second `AbortController` timeout.
- Uses one backend failure escalation path for book, cancel, reschedule, and human-escalation intents.
- Sets `forceHumanEscalation=true`, `transferToQueue=true`, and `escalationReason=backend_error|backend_timeout` on backend failure.
- Does not expose backend JSON/debug payloads to callers.
- Logs coarse backend failure codes instead of backend response bodies.

## Current Production Readiness

Ready:

- Current main flow is AWS: `848-702-9493 -> +********7681 -> Amazon Connect Contact Flow -> Lex prod alias -> Booking Lambda -> POST /api/v1/internal/ai/appointments -> backend booking/escalation flow`.
- CallRail is not in the main demo path. It remains optional legacy/integration code only.
- AI Reception ON/OFF is external routing/redirect behavior before Amazon Connect. The backend flow does not use another in-app routing toggle.
- Human Call Center remains a separate ON/OFF module.
- Automated coverage exists for Lambda contracts, backend internal AI endpoint behavior, and role/dashboard guard safety.

Needs Manual AWS Console Setup:

- Confirm carrier forwarding from `848-702-9493` to `+********7681`.
- Confirm AI Reception and Human Escalation contact flows are published/active.
- Confirm Operator Queue is enabled and an operator is logged into CCP as Available for live handoff testing.
- Confirm Lex `prod` alias points at the intended bot version and Lambda hook.
- Lambda package is deployed for the current booking recovery and timeout changes.

Needs Live SMS Config:

- `AWS_SMS_ORIGINATION_NUMBER` is required only for live AWS SMS delivery.
- `AWS_SMS_CONFIGURATION_SET` is optional for SMS delivery metrics.
- Missing AWS SMS origination/config does not block AI booking tests, real appointment creation, or human escalation.

Known Limitations:

- Cancel and reschedule voice intents intentionally hand off to human/backend flow.
- Queue wait-time behavior after successful transfer is configured in Amazon Connect, outside the backend.

## AWS Verification

Profile used: `nailnew`

- AWS account: `197452633989`
- Region: `us-east-1`
- Amazon Connect instance: `fastaibooking`, id `74f78377-766f-46b7-a745-4bc97b68a8dc`, status `ACTIVE`
- Demo Connect phone: `+********7681`
- AI contact flow: `FastAIBooking AI Reception`, id `dcccf542-587c-426c-a644-a4c6f24da6e4`, status `PUBLISHED`, state `ACTIVE`
- Human escalation contact flow: `FastAIBooking Human Escalation`, id `c7386b94-56bb-4382-b517-ee890bbacb51`, status `PUBLISHED`, state `ACTIVE`
- Operator queue: `FastAIBooking Operator Queue`, id `d0f2a5d8-e983-4609-9bbc-efb0881a465d`, status `ENABLED`
- Operator routing profile: `FastAIBooking Operator Routing Profile`, id `40c00f91-f81f-4cec-9faa-da14e575b523`
- Connect AI flow invokes Lex bot alias ARN `arn:aws:lex:us-east-1:197452633989:bot-alias/KHMIXGA2US/JVIPIZDYE3`
- Human escalation flow sets and transfers to queue ARN ending `/queue/d0f2a5d8-e983-4609-9bbc-efb0881a465d`
- AI Reception flow includes `Compare` on `$.Lex.SessionAttributes.transferToQueue` and `TransferToFlow` to `FastAIBooking Human Escalation`.
- Human escalation flow has queue error fallback messaging before disconnect for queue-at-capacity/no-matching-error branches.
- Lex bot: `FastAIBookingBot`, id `KHMIXGA2US`
- Lex alias: `prod`, id `JVIPIZDYE3`, bot version `8`, status `Available`
- Lex alias Lambda hook: `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`
- `BookAppointmentIntent`: fulfillment hook enabled; dialog hook enabled
- `HumanEscalationIntent`: fulfillment hook enabled
- `CancelAppointmentIntent`: fulfillment hook enabled in version `8`; safe behavior is human handoff
- `RescheduleAppointmentIntent`: fulfillment hook enabled in version `8`; safe behavior is human handoff
- Lambda function: `fastaibooking-booking-handler`
- Lambda runtime: `nodejs20.x`
- Lambda handler: `index.handler`
- Lambda last modified in AWS verification: `2026-06-02T10:11:52.000+0000`
- Lambda env var names only: `[INTERNAL_TOKEN_ENV]`, `DEFAULT_SALON_ID`, `FASTAIBOOKING_API_BASE_URL`
- CloudWatch Lambda errors checked after deployment/smoke: none found
- Versioned AWS exports live in `infra/aws/lex/FastAIBookingBot-v8/` and `infra/aws/connect/contact-flows/`.

Note: the default AWS profile points at account `********1212` and lacks Connect/Lex/Lambda permissions. Use profile `nailnew` for this demo account.

## Intentional Out Of Scope

- AI Reception ON/OFF is handled before this flow at the external redirect/routing layer for the user/salon phone path.
- This backend/Lex/Connect flow assumes a call has already been routed to AI Reception and does not read the web AI Reception ON/OFF setting.
- Queue wait-time policy after a caller is successfully transferred into the Amazon Connect queue remains an Amazon Connect queue/customer-queue-flow operations setting. This flow handles queue setup/transfer errors with fallback messaging.

## Demo Data State

Salon:

- Name: `Kiet Nails & Beauty`
- Salon id: `9bd14a12-85ed-418a-af7d-3f5cb329c147`
- Timezone: `America/New_York`
- Demo Connect phone: `+********7681`
- Original demo phone: `+********9493`

Final active/bookable staff:

- `Trang`
- `Amy`
- `Kelly`

Service:

- `Pedicure`, `Manicure`, `Gel Manicure`, `Full Set`, and `Dip Powder` are active.
- Duration: 45 minutes.
- Staff mapping: `Trang`, `Amy`, `Kelly`.

Availability:

- Use the availability endpoint before live testing because seeded appointment dates move relative to the demo day.
- Automated endpoint tests cover a busy 5:00 PM slot and verify deduped alternatives.

## Check Results

- `npm run test:lambda`: pass
- `npm run test:api`: pass
- `git diff --check`: pass
- `node --check infra/lambda/booking-handler/index.mjs`: pass
- `npm run build:api`: pass
- `npm run typecheck:api`: pass
- `npm run build:app`: pass
- `npm run typecheck:app`: pass
- `npm run build:admin`: pass
- `npm run typecheck:admin`: pass
- Existing lint command: none present in root or API `package.json`
- Production `/health/liveness`: `200`
- Production `/health/readiness`: `200`
- Production `/api/v1/health/liveness`: `200`
- Production `/api/v1/health/readiness`: `200`

## Deployment Result

- Implementation commit: `9abab6491758bdc554938507bf7f6c6ebc1e3ef9`
- Lambda was packaged from `infra/lambda/booking-handler/index.mjs` and deployed with `aws lambda update-function-code`.
- Lex DRAFT was updated with service synonyms, demo booking utterances, shorter prompts, and built into bot version `8`.
- Lex alias `prod` was moved to version `8` and the alias Lambda hook was restored/verified.
- EC2 was deployed with `./infra/scripts/deploy_remote_ec2.sh`.
- Docker build completed successfully.
- Prisma migrate deploy found no pending migrations.
- API container restarted and reported healthy.
- Nginx reload completed.

## Production Smoke Results

Smoke A: no staff preference

- Input: `I want to book a pedicure tomorrow at 1 PM. My name is Kiet Nguyen. My phone number is ******6266.`
- Result: `BOOKED`
- Staff: first available active staff, usually `Trang`
- Caller message names the selected staff before completion.
- Cleanup: appointment canceled

Smoke B: valid staff

- Input: `I want to book a pedicure tomorrow at 1 PM with Kelly. My name is Kiet Nguyen. My phone number is ******6266.`
- Result: `BOOKED`
- Staff: `Kelly`
- Caller message names `Kelly`.
- Cleanup: appointment canceled

Smoke C: invalid staff

- Input: `I want to book a pedicure tomorrow at 1 PM with 111115. My name is Kiet Nguyen. My phone number is ******6266.`
- Result: staff clarification instead of booking
- Caller message does not contain `111115`
- Cleanup: appointment canceled

Smoke D: human escalation

- Input: `I want to speak to a real person.`
- Result: `HUMAN_ESCALATION`
- Caller message: `Please wait while I connect you.`
- Escalation record: `QUEUED`
- Routing outcome: `QUEUED`
- Queue name: `FastAIBooking Operator Queue`

Safe Lambda invoke:

- Lex event text: `I want to speak to a real person.`
- Lambda status: `200`
- Function error: `null`
- Lambda response message: `Please wait while I connect you.`
- Backend outcome session attribute: `HUMAN_ESCALATION`

## Commands Run

```bash
npm run test
npm run test:lambda
npm run test:api
npm run build:api
npm run typecheck:api
npm run build:app
npm run typecheck:app
npm run build:admin
npm run typecheck:admin
node --check infra/lambda/booking-handler/index.mjs
bash -n infra/scripts/smoke_test_production.sh
git diff --check
aws sts get-caller-identity --profile nailnew --query Account --output text
aws connect describe-instance --profile nailnew --region us-east-1 --instance-id 74f78377-766f-46b7-a745-4bc97b68a8dc --query 'Instance.{Alias:InstanceAlias,Status:InstanceStatus,Id:Id}' --output json
aws connect describe-contact-flow --profile nailnew --region us-east-1 --instance-id 74f78377-766f-46b7-a745-4bc97b68a8dc --contact-flow-id dcccf542-587c-426c-a644-a4c6f24da6e4 --query 'ContactFlow.{Name:Name,Status:Status,State:State}' --output json
aws connect describe-contact-flow --profile nailnew --region us-east-1 --instance-id 74f78377-766f-46b7-a745-4bc97b68a8dc --contact-flow-id c7386b94-56bb-4382-b517-ee890bbacb51 --query 'ContactFlow.{Name:Name,Status:Status,State:State}' --output json
aws connect describe-queue --profile nailnew --region us-east-1 --instance-id 74f78377-766f-46b7-a745-4bc97b68a8dc --queue-id d0f2a5d8-e983-4609-9bbc-efb0881a465d --query 'Queue.{Name:Name,Status:Status,QueueId:QueueId}' --output json
aws lexv2-models describe-bot-alias --profile nailnew --region us-east-1 --bot-id KHMIXGA2US --bot-alias-id JVIPIZDYE3 --query '{Alias:botAliasName,Status:botAliasStatus,BotVersion:botVersion}' --output json
aws lambda get-function-configuration --profile nailnew --region us-east-1 --function-name fastaibooking-booking-handler --query '{Runtime:Runtime,Handler:Handler,LastModified:LastModified,EnvKeys:keys(Environment.Variables)}' --output json
git status --short
git branch --show-current
git log --oneline -8
sed -n '1,260p' docs/AI_CALL_BOOKING_WORKFLOW_AUDIT.md
sed -n '1,260p' infra/lambda/booking-handler/index.mjs
sed -n '1,260p' apps/api/src/modules/call-center/call-center.service.ts
sed -n '1,260p' apps/api/src/modules/appointments/appointments.service.ts
sed -n '1,260p' apps/api/src/modules/availability/availability.service.ts
sed -n '1,280p' docs/amazon-connect.md
sed -n '1,260p' docs/telephony.md
sed -n '1,260p' infra/scripts/deploy_remote_ec2.sh
sed -n '1,260p' infra/scripts/deploy_ec2.sh
sed -n '1,260p' .env.example
sed -n '1,300p' apps/api/.env.example
rg -n "createAmazonConnectAIAppointment|HumanEscalationIntent|CancelAppointmentIntent|RescheduleAppointmentIntent|LIVE_PERSON|CANCEL|RESCHEDULE|internal/ai/appointments|bookingFromText" apps/api/src/modules/ai infra/lambda/booking-handler/index.mjs apps/api/src/modules/appointments apps/api/src/modules/calls apps/api/src/modules/call-center
node --check infra/lambda/booking-handler/index.mjs
git diff --check
npm run build:api
npm run typecheck:api
aws sts get-caller-identity --profile nailnew --query 'Account' --output text
aws connect list-instances --profile nailnew --region us-east-1
aws connect describe-contact-flow --profile nailnew --region us-east-1 --instance-id 74f78377-766f-46b7-a745-4bc97b68a8dc --contact-flow-id dcccf542-587c-426c-a644-a4c6f24da6e4
aws connect describe-contact-flow --profile nailnew --region us-east-1 --instance-id 74f78377-766f-46b7-a745-4bc97b68a8dc --contact-flow-id c7386b94-56bb-4382-b517-ee890bbacb51
aws connect describe-queue --profile nailnew --region us-east-1 --instance-id 74f78377-766f-46b7-a745-4bc97b68a8dc --queue-id d0f2a5d8-e983-4609-9bbc-efb0881a465d
aws connect describe-routing-profile --profile nailnew --region us-east-1 --instance-id 74f78377-766f-46b7-a745-4bc97b68a8dc --routing-profile-id 40c00f91-f81f-4cec-9faa-da14e575b523
aws connect list-routing-profile-queues --profile nailnew --region us-east-1 --instance-id 74f78377-766f-46b7-a745-4bc97b68a8dc --routing-profile-id 40c00f91-f81f-4cec-9faa-da14e575b523
aws lexv2-models describe-bot-alias --profile nailnew --region us-east-1 --bot-id KHMIXGA2US --bot-alias-id JVIPIZDYE3
aws lexv2-models list-intents --profile nailnew --region us-east-1 --bot-id KHMIXGA2US --bot-version 6 --locale-id en_US
aws lexv2-models update-intent --profile nailnew --region us-east-1 --bot-id KHMIXGA2US --bot-version DRAFT --locale-id en_US --intent-id CYMY7O3UTQ --intent-name CancelAppointmentIntent --fulfillment-code-hook enabled=true
aws lexv2-models update-intent --profile nailnew --region us-east-1 --bot-id KHMIXGA2US --bot-version DRAFT --locale-id en_US --intent-id GO4CW7HBYH --intent-name RescheduleAppointmentIntent --fulfillment-code-hook enabled=true
aws lexv2-models build-bot-locale --profile nailnew --region us-east-1 --bot-id KHMIXGA2US --bot-version DRAFT --locale-id en_US
aws lexv2-models wait bot-locale-built --profile nailnew --region us-east-1 --bot-id KHMIXGA2US --bot-version DRAFT --locale-id en_US
aws lexv2-models create-bot-version --profile nailnew --region us-east-1 --bot-id KHMIXGA2US --bot-version-locale-specification '{"en_US":{"sourceBotVersion":"DRAFT"}}'
aws lexv2-models describe-bot-version --profile nailnew --region us-east-1 --bot-id KHMIXGA2US --bot-version 8
aws lexv2-models update-bot-alias --profile nailnew --region us-east-1 --bot-id KHMIXGA2US --bot-alias-id JVIPIZDYE3 --bot-alias-name prod --bot-version 8 --bot-alias-locale-settings '{"en_US":{"enabled":true,"codeHookSpecification":{"lambdaCodeHook":{"lambdaARN":"arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler","codeHookInterfaceVersion":"1.0"}}}}'
zip -j /tmp/fastaibooking-booking-handler.zip infra/lambda/booking-handler/index.mjs
aws lambda update-function-code --profile nailnew --region us-east-1 --function-name fastaibooking-booking-handler --zip-file fileb:///tmp/fastaibooking-booking-handler.zip
aws lambda wait function-updated --profile nailnew --region us-east-1 --function-name fastaibooking-booking-handler
aws lambda get-function-configuration --profile nailnew --region us-east-1 --function-name fastaibooking-booking-handler
aws logs filter-log-events --profile nailnew --region us-east-1 --log-group-name /aws/lambda/fastaibooking-booking-handler --start-time ********0000 --filter-pattern 'ERROR'
aws lambda invoke --profile nailnew --region us-east-1 --function-name fastaibooking-booking-handler --payload fileb:///tmp/fastaibooking-lex-human-escalation-event.json /tmp/fastaibooking-lex-human-escalation-output.json
./infra/scripts/deploy_remote_ec2.sh
curl -sS -o /dev/null -w '%{http_code}' https://api-new-nail.kendemo.com/health/liveness
curl -sS -o /dev/null -w '%{http_code}' https://api-new-nail.kendemo.com/health/readiness
curl -sS -o /dev/null -w '%{http_code}' https://api-new-nail.kendemo.com/api/v1/health/liveness
curl -sS -o /dev/null -w '%{http_code}' https://api-new-nail.kendemo.com/api/v1/health/readiness
```

Production data and smoke checks were run through the existing API/admin/internal endpoints using local `.env` values without printing secrets.

## Remaining Blockers

- A real inbound call through `+********7681` was not performed in this automated run.
- Final manual acceptance should call the demo number with an operator logged into CCP and confirm audio, Lex, Lambda, backend logs, and operator pickup in one live session.
- Earlier planning notes had conflicting staff examples. The current seeded AI booking staff are `Trang`, `Amy`, and `Kelly`.

## Next Manual Demo Steps

1. Log an operator into Amazon Connect CCP with the `FastAIBooking Operator Routing Profile`.
2. Call `+********7681`.
3. Book: "I want to book a pedicure tomorrow at 1 PM. My name is Kiet Nguyen. My phone number is ******6266."
4. Repeat invalid staff path: "I want to book a pedicure tomorrow at 1 PM with 111115. My name is Kiet Nguyen. My phone number is ******6266."
5. Escalate: "I want to speak to a real person."
6. Confirm the call transfers to `FastAIBooking Operator Queue` and appears in the operator dashboard.
