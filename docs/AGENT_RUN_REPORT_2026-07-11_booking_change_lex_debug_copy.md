# Booking Change, Lex Reschedule, and Debug JSON Copy Report

Date: 2026-07-12 UTC

## 1. Root Causes

- Customer name pollution: filler tokens such as `with` could be accepted as `customerName` or reused from an existing customer profile, so phrases like `with Kevin` could leak into customer identity and summaries.
- Active booking changes: final-confirmation correction turns were too easy to classify as confirmation, stale staff, or historical transcript recovery instead of current-turn draft edits.
- Staff matching: single-token staff aliases could match inside unrelated words, for example `chang` inside `change`, causing stale or wrong staff state.
- Empty/no-input turns: empty current turns could fall back to historical transcript text, risking initial utterance replay and duplicate decision source tracking.
- Lex reschedule production gap: prod alias v27 had no `RescheduleAppointmentIntent` sample utterances. After adding utterances, the slotless Reschedule intent exposed a Lambda adapter issue where backend `ElicitSlot` responses were invalid for that intent.
- Admin call debug export: Download JSON had the full-call payload, but Copy JSON did not exist and the export path did not centralize recursive secret redaction.

## 2. Call IDs and Evidence

- Problem call: `c61a4c09-ee8e-4e61-891b-897a9a513a9d`, provider contact `cc4e13e7-9283-43d3-a8bf-f42de3a32d75`.
  - Evidence from prompt: `customerName` became `with`, caller mentioned Kevin but final state kept Trang, Friday rejection bled into later Monday change, and initial utterance replay appeared near the end.
- Control call: `fd12d3f2-d3e2-4a2b-b8ed-b18256499915`, provider contact `24b17e7e-aaac-4841-a238-276446da1943`.
  - Evidence from prompt: normal Manicure, Monday 2 PM, Kevin booking succeeded; fixes preserve this path and add regression coverage.

The pasted log files were not present in the workspace, so implementation used the concrete transcripts and observed bugs from the task prompt plus existing repository reports.

## 3. Files Changed

- `infra/lambda/booking-handler/index.mjs`
- `tests/lambda/booking-handler.test.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `apps/api/test/ai-internal.test.ts`
- `apps/api/test/ui-source-contracts.test.ts`
- `apps/admin/src/pages/call-detail-page.tsx`
- `apps/admin/src/lib/i18n.tsx`
- `infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/RescheduleAppointmentIntent/Intent.json`
- `docs/AGENT_RUN_REPORT_2026-07-11_booking_change_lex_debug_copy.md`

Pre-existing and intentionally not staged: `fastaibooking-current-state.zip`, `docs/AGENT_RUN_REPORT_2026-07-11_permanent_customer_salon_delete_datetime.md`.

## 4. Minimal-Diff Explanation

- Added small validation/routing helpers instead of refactoring the booking handler or AI service.
- Kept normal booking, DTMF, Connect flow, business hours, salon timezone, and service duration behavior unchanged.
- Centralized debug payload construction and redaction in the existing call detail page rather than creating a new debug schema or duplicating AI detail behavior.
- Updated only the deployed Lex source-of-truth v10 Reschedule intent, not deprecated exports.

## 5. Lex Inspection

- Bot ID: `KHMIXGA2US`
- Alias ID: `JVIPIZDYE3`
- Alias name: `prod`
- Old alias version before update: `27`
- Latest numeric version before update: `28` was accidentally created during an initial rejected DRAFT update and was not assigned to prod.
- Deployed version: `29`
- Prod alias status after update: `Available`
- Locale: `en_US`
- Version 29 locale status: `Built`
- Locale last build submitted: `2026-07-12T00:17:34.542000-04:00`
- Lambda code hook: `arn:aws:lambda:us-east-1:197452633989:function:fastaibooking-booking-handler`, interface `1.0`
- v27 Reschedule sample utterances: `null`
- v29 Reschedule sample utterances: 15 reschedule/change utterances added.

Intent overlap checks:

- `I want to book a manicure` -> `BookAppointmentIntent`
- `I want to change my existing appointment` -> `RescheduleAppointmentIntent`
- Active booking draft `change it to Monday at two PM with Kevin` repaired to session intent `BookAppointmentIntent`.

## 6. Behavior After Fix

- `with Kevin` does not become `customerName`.
- `my name is Lee`, `this is Lee`, `I'm Lee`, and `you can call me Lee` are accepted when appropriate.
- Existing customer/profile name `with` is ignored for greeting and summary.
- Active booking draft changes update only the explicit fields and preserve trusted service/time/staff/name/phone as applicable.
- Current-turn date/time/staff wins over stale state.
- Staff changes update `staffPreference`, `staffId`, `selectedStaffId`, `confirmedStaffName`, `confirmedStaffId`, and `staffSource` consistently.
- Empty current turn no longer replays the initial booking utterance or creates duplicate transcript/attempt/log decisions.
- Reschedule intent slot prompts are downgraded to `ElicitIntent` for the slotless Lex intent while preserving `lastAskedSlot` in session attributes.
- Copy debug JSON and Download JSON use the same sanitized `call_debug` payload shape.

## 7. Test Results

Passed:

- `node --check infra/lambda/booking-handler/index.mjs`
- `jq empty infra/aws/lex/FastAIBookingBot-v10/BotLocales/en_US/Intents/RescheduleAppointmentIntent/Intent.json`
- `npm run typecheck:api`
- `npm run typecheck:app`
- `npm run build:api`
- `npm run build:app` (existing Vite chunk-size warning only)
- `npm --prefix apps/admin run typecheck`
- `npm --prefix apps/admin run build` (existing Vite chunk-size warning only)
- `npm run test:lambda`: 85/85
- `npm run test:api`: 158/158
- `npm run test`: Lambda 85/85 + API 158/158
- `git diff --check`

Regression coverage added for:

- Invalid customer names and `with Kevin`.
- Clear name phrase extraction.
- Active booking date/time/staff/multi-field changes.
- `not today`, closed Friday then Monday replacement, and fragment `with`.
- Empty current turn no replay/dedup.
- Staff alias word-boundary matching.
- Reschedule slotless Lex adapter behavior.
- Active draft Reschedule NLU repaired to Book intent.
- Copy/download debug payload equality and redaction.

## 8. Deployment Versions

Lambda:

- Function: `fastaibooking-booking-handler`
- Pre-task rollback reference: `$LATEST`, CodeSha256 `RICLr1opcQKOUEQBw+wJbFnsabIpVOObxK1mOtrQ2d4=`, revision `0318963e-0cde-4733-9693-2581590770e5`, last modified `2026-07-11T10:07:12.000+0000`
- Final deployed CodeSha256: `LBcVAlZ9Ev3eQkr40yHoh1t1ZmfMhvB31Lm5Gb8MyQo=`
- Final revision: `9a8a9fa5-287e-43ea-a6fc-4f44c9ea1a07`
- Final last modified: `2026-07-12T04:35:17.000+0000`
- Final status: `Successful`

Lex:

- Rollback alias version: `27`
- Deployed alias version: `29`
- Alias status: `Available`

Connect:

- AI reception flow ID: `dcccf542-587c-426c-a644-a4c6f24da6e4`
- Status: `PUBLISHED`, state `ACTIVE`
- Content sha256 unchanged: `5e22b84c1fcc0b88c55b07aff24fd120b6abc5e59d107e5b6037a231c9f6a878`
- Connect flow was not deployed or changed.

EC2/API/Admin:

- `npm run deploy:ec2` completed successfully.
- Docker API/admin containers recreated and healthy.
- Prisma migrate deploy: no pending migrations.

## 9. Smoke Tests

Passed:

- `./infra/scripts/smoke_test_production.sh`
- `https://api-new-nail.kendemo.com/health/liveness`
- `https://api-new-nail.kendemo.com/health/readiness`
- `https://api-new-nail.kendemo.com/api/v1/health/liveness`
- `https://api-new-nail.kendemo.com/api/v1/health/readiness`

Lex runtime smoke:

- Normal booking utterance: interpreted/session intent `BookAppointmentIntent`, dialog `ElicitSlot`.
- Existing reschedule utterance: interpreted intent `RescheduleAppointmentIntent`, dialog `ElicitIntent`, `lastAskedSlot=customerPhone`, no invalid slot error.
- DTMF/operator smoke: text `0` from active service menu returned `transferToQueue=true`.
- Active booking draft change smoke: `change it to Monday at two PM with Kevin` returned session intent `BookAppointmentIntent`, `staffPreference=Kevin`, `requestedDate=2026-07-13`, `requestedTime=14:00`, no `appointmentId`.

No live phone call was placed and no final confirmation was sent in production smoke, to avoid intentionally creating or rescheduling real production appointments.

## 10. Rollback References

- Lambda rollback reference: CodeSha256 `RICLr1opcQKOUEQBw+wJbFnsabIpVOObxK1mOtrQ2d4=`, revision `0318963e-0cde-4733-9693-2581590770e5`.
- Lex rollback: update alias `prod` (`JVIPIZDYE3`) back to bot version `27`.
- Connect rollback: not needed; flow unchanged at sha256 `5e22b84c1fcc0b88c55b07aff24fd120b6abc5e59d107e5b6037a231c9f6a878`.
- EC2 rollback: previous Docker images remain on host; no database migration was applied.

## 11. Remaining Risks

- Production smoke used Lex runtime synthetic sessions and read-only health checks, not a full PSTN phone call.
- The active-change production smoke intentionally avoided final confirmation, so it verified routing/state/no-appointment but not production appointment creation.
- Version 28 exists in Lex history but was never assigned to prod; prod uses version 29.
- Final commit hash is produced after this report file is committed; the final response records the pushed commit hash.

## 12. Intentionally Not Changed

- Database schema and Prisma migrations.
- Business hours, salon timezone, and service duration.
- Connect contact flows and DTMF mapping.
- UI outside call detail debug actions.
- Normal booking core flow beyond guarded fixes and tests.
- Customer phone lookup behavior.
- Historical JSON logs and deprecated Lex exports.
