# Agent Run Report: Call Flow, Voice, UI, and Staff Defaults

Date: 2026-07-03

## Scope

Continued from `docs/AGENT_RUN_REPORT_2026-07-01_call_flow_staff_dtmf.md`. Verified the previous staff DTMF call-flow work, added staff creation defaults for AI visibility, audited Kiet voice-recognition logs, tightened call wait behavior, refreshed the `apps/app` luxury salon UI, and added regression coverage.

## Files Inspected

- Previous report: `docs/AGENT_RUN_REPORT_2026-07-01_call_flow_staff_dtmf.md`
- Lambda/API: `infra/lambda/booking-handler/index.mjs`, `apps/api/src/modules/ai/ai.routes.ts`, `apps/api/src/modules/ai/ai.service.ts`
- Staff: `apps/api/src/modules/staff/staff.service.ts`, `apps/api/src/modules/staff/staff.routes.ts`
- Tests: `tests/lambda/booking-handler.test.mjs`, `apps/api/test/ai-internal.test.ts`
- Lex/Connect: `infra/aws/lex/`, `infra/aws/connect/`
- Logs: `ai-interactions-*.json`
- UI: `apps/app/src/styles.css`, `apps/app/src/components/layout.tsx`, auth pages, dashboard, appointments, services, staff, salon profile, call center, calls, AI logs

## Files Changed

- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/src/modules/staff/staff.service.ts`
- `apps/api/test/ai-internal.test.ts`
- `apps/api/test/staff-defaults.test.ts`
- `tests/lambda/booking-handler.test.mjs`
- `infra/aws/lex/FastAIBookingBot-v8/BotLocales/en_US/SlotTypes/NailServiceType/SlotType.json`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/SlotTypes/NailServiceType/SlotType.json`
- `apps/app/src/styles.css`
- `apps/app/src/pages/staff-page.tsx`
- `apps/app/src/lib/i18n.tsx`
- `docs/AI_VOICE_RECOGNITION_AUDIT_2026-07-03.md`
- `docs/UI_LUXURY_REFRESH_AUDIT_2026-07-03.md`
- `docs/AGENT_RUN_REPORT_2026-07-03_call_flow_voice_ui_staff.md`

## Previous Run Verification Result

Confirmed the July 1 staff DTMF implementation is present in code:

- Staff options are loaded from active/bookable DB staff.
- DTMF maps digit to staff ID through `staffDtmfStaffIds`.
- `0` maps to any staff when `lastAskedSlot` is `staffPreference`.
- `0` outside staff selection can still escalate to an operator.
- Invalid staff DTMF repeats the staff list without booking.
- Selected staff ID is passed to appointment creation.
- Busy requested staff returns alternatives.
- Lex v8/v10 booking/cancel/reschedule/escalation fulfillment progress prompts are configured.

## Staff Default Role and Title Behavior

- `createStaff` now defaults missing/blank title to `Nail Technician`.
- `Staff.status` still defaults to `ACTIVE`.
- `Staff.isBookable` now defaults to `true` unless `isBookable: false` is explicitly passed.
- Login creation continues to create `User.role = Role.STAFF`.
- When `serviceIds` is omitted, active salon services are assigned.
- When `serviceIds` is provided, the provided mapping is preserved.
- `createLogin: false` still creates an active/bookable Staff record.

## New Staff Call-Flow Visibility Result

New active/bookable staff appear in the AI staff DTMF prompt without hardcoded names. Regression coverage adds a new `Lina` staff fixture, verifies `press 4 for Lina`, and confirms DTMF digit `4` creates the appointment with Lina's `staffId`.

## Kiet Voice Recognition Log Audit Summary

Found repeated log utterance: `i want to have eddie here tomorrow at seven p.m.`. Added `eddie here` as a Pedicure alias in Lambda, API service matching, and Lex v8/v10 slot exports. The alias is scoped only to service matching. Known caller Kiet remains preserved through phone lookup when transcript/slot text is noisy.

See `docs/AI_VOICE_RECOGNITION_AUDIT_2026-07-03.md` for log details.

## Call Wait and Silence Handling

- Existing Lex fulfillment progress prompts remain active with 1 second start delay and 3 second updates.
- Lambda backend timeout default reduced from 3500 ms to 2800 ms for unprompted DialogCodeHook backend waits.
- Existing graceful backend failure paths remain in place.
- Connect human escalation flow already plays: `Please hold while I connect you to our team...`
- Real queue/hold music must be configured in Amazon Connect Console on the operator queue/customer queue flow after deployment.

## UI Luxury Refresh Summary

Updated `apps/app` shared styling to cream/gold/dark brown tokens, softer cards, pill buttons, rounded inputs, premium shadows, warm image overlays, and clearer staff readiness badges. Staff form now defaults to `Nail Technician` with bookable ON.

See `docs/UI_LUXURY_REFRESH_AUDIT_2026-07-03.md` for UI details.

## Commands Run and Results

- `npm --prefix apps/api run typecheck` - pass
- `npm --prefix apps/api run test` - pass, 62 tests
- `npm --prefix apps/app run typecheck` - pass
- `npm --prefix apps/app run build` - pass, Vite large chunk warning only
- `npm run test:lambda` - pass, 26 tests
- `npm run test` - pass
- `node --check infra/lambda/booking-handler/index.mjs` - pass
- Lex/Connect JSON parse validation - pass, 32 JSON files
- `git diff --check` - pass

## Tests Added or Updated

- Staff default creation tests in `apps/api/test/staff-defaults.test.ts`
- `eddie here` Pedicure recognition and conservative non-match tests in `apps/api/test/ai-internal.test.ts`
- New staff DTMF visibility and booking-by-digit test in `apps/api/test/ai-internal.test.ts`
- Lambda `eddie here` recovery test in `tests/lambda/booking-handler.test.mjs`

## Manual Smoke Test Checklist

- Owner creates staff without title; verify title is `Nail Technician`, status Active, Bookable ON.
- Owner creates staff without choosing services; verify active services are assigned.
- Call AI booking and reach staff selection; verify new staff is read as a numbered option.
- Press `0` at staff selection; verify any available staff path.
- Press invalid staff digit; verify staff list repeats once and no booking is created.
- Say `I want to have eddie here tomorrow at seven p.m.` from Kiet's phone; verify Pedicure and Kiet are preserved.
- Confirm booking after selecting a staff digit; verify appointment uses selected `staffId`.
- Check app pages on mobile and desktop widths for staff, appointments, services, salon profile, call center, calls, and AI logs.

## Blockers and Follow-Up Notes

- No deployment was performed.
- No browser screenshot pass was run.
- `fastaibooking-current-state.zip` was already modified before this run and was not touched intentionally.
- Amazon Connect queue music/hold experience still needs production console verification after publishing updated flows.
