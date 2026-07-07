# Agent Run Report - Call Flow Naturalness

Date: 2026-07-07

## Scope

- Focused only on the Amazon Connect, Lex, Lambda, and internal AI appointment call flow.
- Verified customer-facing service wording uses the seeded backend service name "Full Set".
- Kept booking creation, availability checks, known-caller handling, DTMF, human escalation, call session logs, AI logs, alternative slots, and confirmation flow intact.

## Files Inspected

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/BookAppointmentIntent/Slots/serviceName/Slot.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/SlotTypes/NailServiceType/SlotType.json`
- `infra/aws/connect/contact-flows/ai-reception.json`
- `apps/api/test/ai-internal.test.ts`

## Files Changed

- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/test/ai-internal.test.ts`
- `docs/AGENT_RUN_REPORT_2026-07-07_call_flow_naturalness.md`

## Decisions

- Preserved the existing backend service name "Full Set" in customer-facing confirmation text.
- Updated final confirmation phrasing so next-day bookings say "tomorrow at 3 PM" instead of expanding to a calendar date.
- Kept staff optional, but verified the flow asks staff once after service/date/time/customer details are known.
- Verified "first available" resolves to a real active, bookable staff member before final confirmation.
- Added a regression scan so targeted call-flow files fail tests if blocked Full Set wording returns.

## Preserved Behavior

- Real appointment creation only after final confirmation.
- Duplicate protection by call session/contact id.
- Human escalation and press 0 operator path.
- Known Kiet caller name and phone behavior.
- Service/date/time recovery from natural speech.
- Staff DTMF selection and session staff id mapping.
- Alternative slot prompting when requested staff is unavailable.
- Staff-service validation through `validateAppointmentSlot`.

## Prompt And Flow Notes

- Lambda and Lex inspected paths already use option 4 as "Full Set".
- Connect service retry text inspected path uses "Full Set".
- Service prompt supports voice plus keypad selection.
- Staff prompt supports DTMF selection for Trang, Amy, Kelly, and first available.
- Confirmation now produces wording like: "Just to confirm, Full Set with Trang tomorrow at 3 PM. Is that correct?"

## Tests Added Or Updated

- Full Set natural-language booking reaches confirmation without re-asking service.
- DTMF 4 maps to "Full Set".
- Staff DTMF 3 maps to Kelly and does not ask staff again.
- Missing staff asks once, then first available resolves before confirmation.
- Unclear staff asks options once, then defaults to first available.
- Staff-service mapping is checked through slot validation.
- Targeted call-flow files are scanned for blocked Full Set wording.

## Commands Run

- `npm install` at repo root: completed, dependencies already up to date.
- `npm install` in `apps/api`: completed to restore the package-local test runner binary; generated nested lockfile was removed as install noise.
- `cd apps/api && npm test`: passed, 67/67 tests.
- `cd apps/api && npm run typecheck`: passed.
- `cd apps/api && node --check ../../infra/lambda/booking-handler/index.mjs`: passed.
- `npm run build:api`: passed.
- `npm run deploy:ec2`: passed; API container recreated and reported healthy, with no pending Prisma migrations.

## Deploy Notes

- API deploy completed through the existing EC2 deploy script.
- No Connect or Lex deploy was needed because this patch did not change those JSON artifacts.

## Remaining Manual AWS Connect/Lex Publish Steps

- If Connect or Lex JSON files are changed later, rebuild the Lex locale, publish a new bot version, move the production alias, and import/publish the Connect contact flow.
- After publishing, place demo calls for service speech, DTMF service selection, DTMF staff selection, first available staff, and press 0 operator transfer.

## Demo Test Phrases

- "Hi, I want to book Full Set tomorrow at 3 PM with Trang."
- "Hi, I want to book a pedicure tomorrow at 2 PM with Kelly."
- "Hi, I want to book a manicure tomorrow at 5 PM, first available."
- "Press 4 for Full Set."
- "Press 0 for an operator."

## Remaining Risks

- Manual AWS publish is still required for future Connect or Lex file changes.
- Live Connect behavior should still be verified by phone because prompt timing can differ from local Lambda/API tests.
