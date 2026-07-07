# Agent Run Report: Voice Interrupt, DTMF, Wait, Noise

Date: 2026-07-07

## Scope

- Fixed the Amazon Connect + Lex + Lambda booking flow startup silence and noisy-salon retry behavior.
- Kept booking creation, availability checks, staff/service APIs, AI logs, call sessions, human escalation, and press-0 operator routing intact.

## Root Causes Found

- `BookAppointmentIntent` initial response invoked the Lex dialog code hook before the caller heard a useful first prompt.
- Lambda used a backend call to generate staff DTMF options during `DialogCodeHook`, which could leave the caller waiting before a prompt.
- Staff was treated as required in Lambda/API paths, causing repeated staff questions instead of defaulting to first available.
- Staff keypad `0` previously meant Any staff in parts of the flow, conflicting with the operator requirement.
- Booking API failures could re-elicit a slot instead of giving a caller-safe wait-and-transfer message.

## Files Inspected

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/BookAppointmentIntent/Intent.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/BookAppointmentIntent/Slots/serviceName/Slot.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/BookAppointmentIntent/Slots/staffPreference/Slot.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/SlotTypes/NailServiceType/SlotType.json`
- `infra/aws/connect/contact-flows/ai-reception.json`
- `infra/aws/connect/contact-flows/human-escalation.json`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/test/ai-internal.test.ts`
- `docs/AI_CALL_BOOKING_WORKFLOW_AUDIT.md`

## Files Changed

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `infra/aws/connect/contact-flows/ai-reception.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/BookAppointmentIntent/Intent.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/BookAppointmentIntent/Slots/serviceName/Slot.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/BookAppointmentIntent/Slots/staffPreference/Slot.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/SlotTypes/NailServiceType/SlotType.json`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/test/ai-internal.test.ts`
- `docs/AI_CALL_BOOKING_WORKFLOW_AUDIT.md`
- `docs/AGENT_RUN_REPORT_2026-07-07_voice_interrupt_dtmf_wait_noise.md`

## Prompt And Flow Changes

- First local AI greeting: `Hi, thanks for calling. I can help book your appointment. What service would you like today?`
- Service retry: keypad-first menu with `1` Pedicure, `2` Manicure, `3` Gel Manicure, `4` Acrylic Full Set, `5` Dip Powder, `0` operator.
- Staff retry: `1` Trang, `2` Amy, `3` Kelly, `4` first available, `0` operator.
- Availability wait prompt: `Please give me a moment while I check availability.`
- Fulfillment update prompt: `I’m still checking the schedule.`
- Backend failure handoff: `This is taking longer than expected. Please wait while I connect you to our team.`

## Tests Added Or Updated

- Initial/local DialogCodeHook response does not call backend for staff prompt.
- Press `0` from service prompt escalates to operator.
- Press `0` from staff prompt escalates to operator.
- Staff DTMF `4` maps to Any staff/first available.
- Missing/unrecognized staff defaults to first available and continues.
- Backend non-OK/thrown booking errors escalate safely instead of repeating slot prompts.
- Lex fulfillment wait prompt assertions updated for the new availability wording.

## Commands Run

- `npm run test:lambda` - passed, 32 tests.
- `npm --prefix apps/api run test` - passed, 63 tests.
- `npm run build:api` - passed.
- `npm run deploy:ec2` - passed; API container healthy, no pending Prisma migrations.
- Lambda `fastaibooking-booking-handler` update - passed; last modified `2026-07-07T07:32:11.000+0000`, update status `Successful`.
- Amazon Connect AI reception contact flow update - passed; flow remains `PUBLISHED` and `ACTIVE`.
- Lex DRAFT update/build/version/alias update - passed; `prod` alias now points to bot version `15`.
- `./infra/scripts/smoke_test_production.sh` - passed.

## Deploy Notes

- Deployed updated Lambda package for `infra/lambda/booking-handler/index.mjs`.
- Built updated Lex DRAFT and pointed active `prod` alias to version `15`.
- Updated the AI reception Connect contact flow in AWS.
- Keep the human escalation flow active and verify the operator queue/CCP agent state before live demo.
- Run one live call to confirm Amazon Connect plays Lex fulfillment updates through `Get Customer Input`; if it does not, keep the Connect local greeting and transfer prompt as the fallback UX.

## Remaining Risks

- Lex fulfillment update playback can vary by Amazon Connect integration behavior; live call validation is still required.
- Queue hold music after successful queue transfer is controlled by Amazon Connect queue/customer-queue configuration outside this code.
- The worktree had unrelated pre-existing dirty files, including a demo readiness doc and zip artifact; they were not part of this fix.
