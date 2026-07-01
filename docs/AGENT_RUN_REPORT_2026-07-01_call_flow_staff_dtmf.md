# Agent Run Report: Call Flow Staff DTMF

Date: 2026-07-01

## Scope

Updated the Amazon Connect/Lex/Lambda AI Reception booking flow so staff selection uses keypad digits backed by the real active/bookable staff list, preserves staff IDs through Lex session attributes, and adds caller wait prompts for long Lex fulfillment operations.

## Files Inspected

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.routes.ts`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/staff/staff.service.ts`
- `apps/api/src/modules/staff/staff.routes.ts`
- `apps/api/src/modules/availability/availability.service.ts`
- `apps/api/src/modules/appointments/appointments.service.ts`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/test/ai-internal.test.ts`
- `infra/aws/connect/contact-flows/ai-reception.json`
- `infra/aws/connect/contact-flows/human-escalation.json`
- `infra/aws/lex/FastAIBookingBot-v8/`
- `infra/aws/lex/FastAIBookingBot-v10/`
- `docs/amazon-connect.md`
- `docs/telephony.md`
- `docs/AI_CALL_BOOKING_WORKFLOW_AUDIT.md`
- `FastAIBooking_Postman_Collection.json`

## Files Changed

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.routes.ts`
- `apps/api/src/modules/ai/ai.service.ts`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/test/ai-internal.test.ts`
- `infra/aws/connect/contact-flows/ai-reception.json`
- `infra/aws/lex/FastAIBookingBot-v8/BotLocales/en_US/Intents/*/Intent.json`
- `infra/aws/lex/FastAIBookingBot-v8/BotLocales/en_US/Intents/BookAppointmentIntent/Slots/staffPreference/Slot.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/*/Intent.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/BookAppointmentIntent/Slots/staffPreference/Slot.json`
- `docs/AGENT_RUN_REPORT_2026-07-01_call_flow_staff_dtmf.md`

## Root Cause Summary

Staff DTMF selection existed only as a hardcoded name map. The flow did not store a digit-to-staff-ID mapping, so digit selection could only resolve by display name. The staff prompt also used conflicting `0` wording, and Lex fulfillment had no configured progress prompt while Lambda/backend work was running.

## What Was Fixed

- Staff prompt options now come from real active/bookable staff records.
- Lex session attributes now carry:
  - `staffDtmfOptions`
  - `staffDtmfStaffIds`
  - `staffDtmfPromptText`
- The backend accepts optional internal `staffId` / `selectedStaffId` and validates it against active/bookable staff for the current salon.
- Lambda forwards selected staff IDs to the backend.
- Hardcoded production staff-name mappings were removed from the Lambda/backend selection path.
- Dynamic staff lookup still falls back safely when no active staff exists.
- Spoken staff names remain supported through backend real-staff matching.

## Staff Digit Selection Behavior

- `0` maps to any available staff while the current prompt is `staffPreference`.
- `1..N` map to the current salon's active/bookable staff in database order.
- Multi-digit DTMF is supported for staff counts above 9.
- Invalid staff digits return: `I didn't find that option. Please choose from the list.`
- Staff no-input repeats once, then continues with any available staff.
- Service-menu `0` and spoken `operator` still route to human escalation.
- Selected digit is resolved to staff ID before appointment confirmation/creation.

## API Wait / Silence Handling Behavior

- Lex fulfillment progress updates were enabled in versioned v8/v10 exports for booking, cancel, reschedule, and human escalation intents.
- Booking fulfillment start prompt: `Please wait a moment while I check the schedule.`
- Booking update prompt repeats every 3 seconds while fulfillment is still running.
- Cancel/reschedule use lookup wait prompts.
- Human escalation uses connect wait prompts.
- The human escalation Connect flow already plays a hold/connect prompt before queue transfer.
- AI Reception Connect greeting no longer says `press 0 ... at any time`, avoiding conflict with staff `0` for any staff.

## Commands Run and Results

- `node --check infra/lambda/booking-handler/index.mjs` - pass
- `npm --prefix apps/api run typecheck` - pass
- `npm run test:lambda` - pass
- `npm run test:api` - pass
- `npm run test` - pass
- `npm run build:api` - pass
- `git diff --check` - pass
- JSON parse validation for updated Lex/Connect exports - pass

## Test Cases Completed

- Staff list loaded from real active/bookable staff data in backend tests.
- DTMF digit maps to correct staff ID.
- `0` maps to any staff during staff selection.
- Invalid staff digit repeats the staff options.
- No active staff does not crash the booking flow.
- Selected staff still creates/continues appointment flow with correct `staffId`.
- Any staff still resolves and books through existing availability logic.
- Busy selected staff returns alternatives instead of failing.
- Human escalation returns `Please wait while I connect you.` and transfer attributes.
- Lex export progress prompts configured for long fulfillment operations.

## Postman

No Postman collection changes were made. The only request-field addition is optional and internal to `POST /api/v1/internal/ai/appointments`, which is not part of the public Postman collection flow.

## Blockers or Follow-up Notes

- No deployment was performed.
- Lex fulfillment updates apply to streaming Lex conversations. Amazon Connect/Lex runtime behavior should be smoke tested after publishing the updated bot/contact-flow exports.
- Queue music and queue wait policy remain Amazon Connect operations settings after successful queue transfer.
