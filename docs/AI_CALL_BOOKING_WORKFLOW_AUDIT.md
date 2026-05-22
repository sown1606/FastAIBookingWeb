# AI Call Booking Workflow Audit

Date: 2026-05-22

## Summary

The AI phone booking demo path is hardened and deployed:

`Amazon Connect -> Lex alias prod -> Lambda fastaibooking-booking-handler -> POST /api/v1/internal/ai/appointments -> backend booking/escalation flow`

The original demo failure mode is fixed:

- Numeric/code-like values such as `111115` are ignored as staff preferences.
- Invalid staff values are not stored in normalized booking requests.
- Caller-facing responses use active/bookable staff names only.
- No staff preference, "any staff", "anyone", and "whoever is available" search all active/bookable staff.
- Alternative suggestions are deduped by staff/time before speech.
- Human escalation says exactly: "Please wait while I connect you."
- Human escalation records and AWS routing point to `FastAIBooking Operator Queue`.

## Files Changed

- `apps/api/prisma/seed.ts`
- `apps/api/src/modules/ai/ai.prompts.ts`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/call-center/call-center.service.ts`
- `infra/lambda/booking-handler/index.mjs`
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
- Human escalation now returns and stores `Please wait while I connect you.`
- Escalation records now label the queue as `FastAIBooking Operator Queue` when the Amazon Connect queue id is configured.

## Lambda Fixes

- Forwards Lex intent name, transcript, interpreted slots, session attributes, contact id, called number, customer phone, and salon id when available.
- Sends `HumanEscalationIntent` to the backend when Lex gives that intent or when the utterance clearly asks to speak to a real person.
- Keeps Lambda responses plain-text and speakable.
- Uses `Please wait while I connect you.` as the fallback for human/cancel/reschedule handoff.
- Does not expose backend JSON/debug payloads to callers.

## AWS Verification

Profile used: `nailnew`

- AWS account: `197452633989`
- Region: `us-east-1`
- Amazon Connect instance: `fastaibooking`, id `74f78377-766f-46b7-a745-4bc97b68a8dc`, status `ACTIVE`
- Demo Connect phone: `+18483487681`
- AI contact flow: `FastAIBooking AI Reception`, id `dcccf542-587c-426c-a644-a4c6f24da6e4`, status `PUBLISHED`, state `ACTIVE`
- Human escalation contact flow: `FastAIBooking Human Escalation`, id `c7386b94-56bb-4382-b517-ee890bbacb51`, status `PUBLISHED`, state `ACTIVE`
- Operator queue: `FastAIBooking Operator Queue`, id `d0f2a5d8-e983-4609-9bbc-efb0881a465d`, status `ENABLED`
- Operator routing profile: `FastAIBooking Operator Routing Profile`, id `40c00f91-f81f-4cec-9faa-da14e575b523`
- Connect AI flow invokes Lex bot alias ARN `arn:aws:lex:us-east-1:197452633989:bot-alias/KHMIXGA2US/JVIPIZDYE3`
- Human escalation flow sets and transfers to queue ARN ending `/queue/d0f2a5d8-e983-4609-9bbc-efb0881a465d`
- Lex bot: `FastAIBookingBot`, id `KHMIXGA2US`
- Lex alias: `prod`, id `JVIPIZDYE3`, bot version `7`, status `Available`
- Lex alias Lambda hook: `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`
- `BookAppointmentIntent`: fulfillment hook enabled; dialog hook enabled
- `HumanEscalationIntent`: fulfillment hook enabled
- `CancelAppointmentIntent`: fulfillment hook enabled in version `7`; safe behavior is human handoff
- `RescheduleAppointmentIntent`: fulfillment hook enabled in version `7`; safe behavior is human handoff
- Lambda function: `fastaibooking-booking-handler`
- Lambda runtime: `nodejs20.x`
- Lambda handler: `index.handler`
- Lambda last modified after deploy: `2026-05-22T12:38:39.000+0000`
- Lambda env var names only: `FASTAIBOOKING_API_INTERNAL_TOKEN`, `DEFAULT_SALON_ID`, `FASTAIBOOKING_API_BASE_URL`
- CloudWatch Lambda errors checked after deployment/smoke: none found

Note: the default AWS profile points at account `794673701212` and lacks Connect/Lex/Lambda permissions. Use profile `nailnew` for this demo account.

## Demo Data State

Salon:

- Name: `Kiet Nails & Beauty`
- Salon id: `9bd14a12-85ed-418a-af7d-3f5cb329c147`
- Timezone: `America/New_York`
- Demo Connect phone: `+18483487681`
- Original demo phone: `+18487029493`

Final active/bookable staff:

- `Mia Carter`
- `Olivia Brooks`
- `Nora Evans`

Confirmed inactive/non-bookable-for-routing noise:

- `Trang`: `INACTIVE`
- `Amy`: `INACTIVE`
- `Kelly`: `INACTIVE`

Service:

- `Pedicure` is active.
- Duration: 45 minutes.
- Staff mapping: `Mia Carter`, `Olivia Brooks`, `Nora Evans`.

Availability:

- `2026-05-23T13:00:00-04:00` is available after smoke cleanup.
- Active non-canceled appointments overlapping `2026-05-23T17:00:00.000Z` to `2026-05-23T17:45:00.000Z`: `0`.

## Check Results

- `git diff --check`: pass
- `node --check infra/lambda/booking-handler/index.mjs`: pass
- `npm run build:api`: pass
- `npm run typecheck:api`: pass
- Existing lint command: none present in root or API `package.json`
- Production `/health/liveness`: `200`
- Production `/health/readiness`: `200`
- Production `/api/v1/health/liveness`: `200`
- Production `/api/v1/health/readiness`: `200`

## Deployment Result

- Implementation commit: `9abab6491758bdc554938507bf7f6c6ebc1e3ef9`
- Lambda was packaged from `infra/lambda/booking-handler/index.mjs` and deployed with `aws lambda update-function-code`.
- Lex DRAFT was updated so cancel/reschedule intents invoke fulfillment, then built into bot version `7`.
- Lex alias `prod` was moved to version `7` and the alias Lambda hook was restored/verified.
- EC2 was deployed with `./infra/scripts/deploy_remote_ec2.sh`.
- Docker build completed successfully.
- Prisma migrate deploy found no pending migrations.
- API container restarted and reported healthy.
- Nginx reload completed.

## Production Smoke Results

Smoke A: no staff preference

- Input: `I want to book a pedicure tomorrow at 1 PM. My name is Kiet Nguyen. My phone number is 7325956266.`
- Result: `BOOKED`
- Staff: `Mia Carter`
- Caller message: `You're all set. Your pedicure is booked for tomorrow at 1 PM with Mia Carter. Thank you for calling.`
- Cleanup: appointment canceled

Smoke B: valid staff

- Input: `I want to book a pedicure tomorrow at 1 PM with Mia Carter. My name is Kiet Nguyen. My phone number is 7325956266.`
- Result: `BOOKED`
- Staff: `Mia Carter`
- Caller message: `You're all set. Your pedicure is booked for tomorrow at 1 PM with Mia Carter. Thank you for calling.`
- Cleanup: appointment canceled

Smoke C: invalid staff

- Input: `I want to book a pedicure tomorrow at 1 PM with 111115. My name is Kiet Nguyen. My phone number is 7325956266.`
- Result: `BOOKED`
- Staff: `Mia Carter`
- Caller message did not contain `111115`
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
aws lexv2-models wait bot-version-available --profile nailnew --region us-east-1 --bot-id KHMIXGA2US --bot-version 7
aws lexv2-models update-bot-alias --profile nailnew --region us-east-1 --bot-id KHMIXGA2US --bot-alias-id JVIPIZDYE3 --bot-alias-name prod --bot-version 7 --bot-alias-locale-settings '{"en_US":{"enabled":true,"codeHookSpecification":{"lambdaCodeHook":{"lambdaARN":"arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler","codeHookInterfaceVersion":"1.0"}}}}'
zip -j /tmp/fastaibooking-booking-handler.zip infra/lambda/booking-handler/index.mjs
aws lambda update-function-code --profile nailnew --region us-east-1 --function-name fastaibooking-booking-handler --zip-file fileb:///tmp/fastaibooking-booking-handler.zip
aws lambda wait function-updated --profile nailnew --region us-east-1 --function-name fastaibooking-booking-handler
aws lambda get-function-configuration --profile nailnew --region us-east-1 --function-name fastaibooking-booking-handler
aws logs filter-log-events --profile nailnew --region us-east-1 --log-group-name /aws/lambda/fastaibooking-booking-handler --start-time 1779321600000 --filter-pattern 'ERROR'
aws lambda invoke --profile nailnew --region us-east-1 --function-name fastaibooking-booking-handler --payload fileb:///tmp/fastaibooking-lex-human-escalation-event.json /tmp/fastaibooking-lex-human-escalation-output.json
./infra/scripts/deploy_remote_ec2.sh
curl -sS -o /dev/null -w '%{http_code}' https://api-new-nail.kendemo.com/health/liveness
curl -sS -o /dev/null -w '%{http_code}' https://api-new-nail.kendemo.com/health/readiness
curl -sS -o /dev/null -w '%{http_code}' https://api-new-nail.kendemo.com/api/v1/health/liveness
curl -sS -o /dev/null -w '%{http_code}' https://api-new-nail.kendemo.com/api/v1/health/readiness
```

Production data and smoke checks were run through the existing API/admin/internal endpoints using local `.env` values without printing secrets.

## Remaining Blockers

- A real inbound call through `+18483487681` was not performed in this automated run.
- Final manual acceptance should call the demo number with an operator logged into CCP and confirm audio, Lex, Lambda, backend logs, and operator pickup in one live session.
- The prompt had an internal conflict: one section said final staff should include `Trang`, while the detailed verification and acceptance criteria required `Mia Carter`, `Olivia Brooks`, and `Nora Evans`. The deployed state follows the acceptance criteria.

## Next Manual Demo Steps

1. Log an operator into Amazon Connect CCP with the `FastAIBooking Operator Routing Profile`.
2. Call `+18483487681`.
3. Book: "I want to book a pedicure tomorrow at 1 PM. My name is Kiet Nguyen. My phone number is 7325956266."
4. Repeat invalid staff path: "I want to book a pedicure tomorrow at 1 PM with 111115. My name is Kiet Nguyen. My phone number is 7325956266."
5. Escalate: "I want to speak to a real person."
6. Confirm the call transfers to `FastAIBooking Operator Queue` and appears in the operator dashboard.
