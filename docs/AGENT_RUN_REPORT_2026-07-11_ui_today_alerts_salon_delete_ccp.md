# AGENT RUN REPORT 2026-07-11 - UI Today Count, Alerts, Salon Delete, CCP

## Root Causes

- Today dashboard count: owner dashboard filtered appointments by salon date key on the client and counted every status in the returned list. Canceled/no-show records with today's `startTime` were counted as "Lịch hẹn hôm nay", and the count could depend on list loading rather than a server-side total.
- Appointments/call-center layout: desktop grids used ratios that left empty space in the main column while forms/technical panels competed for height. Call-center setup/debug content stayed visible too often.
- Alerts localization: `alerts-page.tsx` rendered raw `title`, raw `message`, and raw `alertType` for non-booking alerts. The call-center backend also created escalation alerts with English title/message.
- Salon delete: platform admin delete treated stale `IN_PROGRESS` call sessions as a hard 409. Admins had to clean operational data manually before deleting a demo salon.
- CCP: owner/operator UI had direct CCP fallback too prominent, technical details visible by default, and readiness could be inferred too loosely from setup state instead of Streams events.

## Files Changed

- `apps/app/src/lib/appointment-status.ts`: shared operational/history appointment status policy.
- `apps/app/src/lib/timezone.ts`: shared salon date-key helpers.
- `apps/api/src/modules/appointments/appointments.service.ts`, `appointments.routes.ts`: server-side `/appointments/summary` counts by status.
- `apps/app/src/pages/dashboard-page.tsx`: hero/card counts use server summary and operational-only today list.
- `apps/app/src/pages/appointments-page.tsx`: aligned today/upcoming/history status and salon timezone handling.
- `apps/app/src/pages/alerts-page.tsx`, `apps/app/src/lib/i18n.tsx`: localized alert type mapping, safe legacy fallback, compact read state, friendly call escalation and booking rendering.
- `apps/app/src/pages/call-center-page.tsx`, `apps/app/src/styles.css`: embedded-first CCP state, collapsed diagnostics, balanced operator layout, localized legacy escalation/failure text.
- `apps/api/src/modules/call-center/call-center.service.ts`: structured escalation metadata for alerts.
- `apps/api/src/modules/admin/admin.service.ts`: salon delete now terminalizes operational data before permanent deletion.
- `apps/admin/src/lib/salon-delete.ts`: shared two-step salon delete dialog.
- `apps/admin/src/pages/salons-page.tsx`, `salon-detail-page.tsx`, `apps/admin/src/lib/i18n.tsx`, `apps/admin/src/styles.css`: list delete action, shared dialog, detail reuse, spacing/actions.
- `apps/api/test/admin-salon-delete.test.ts`, `appointments-stabilization.test.ts`, `ui-source-contracts.test.ts`: focused coverage for deletion, count/timezone, alert/source contracts.

## Behavior After Fix

- `Lịch hẹn hôm nay` policy:
  - Operational count: `SCHEDULED`, `CONFIRMED`, `IN_PROGRESS`.
  - History/terminal: `COMPLETED`, `CANCELED`, `NO_SHOW`.
  - Hero count and main dashboard today section exclude `CANCELED`, `NO_SHOW`, and `COMPLETED`.
  - Completed and canceled/no-show counts are shown separately.
  - Production smoke on `2026-07-11` for `Kiet Nails & Beauty`: total today `14`, canceled `14`, operational `0`.
- Alerts:
  - VI escalation title: `Khách cần gặp tổng đài viên`.
  - VI pressed-0 body: `Khách đã bấm phím 0 và đang chờ được kết nối.`
  - EN escalation title/body: `Customer needs an operator` / `The customer pressed 0 and is waiting to be connected.`
  - Unknown alert types use `Thông báo hệ thống` / `System notification`, not raw enum codes.
  - Booking alerts render title once and show customer/service/staff plus salon-local appointment time.
- Salon deletion:
  - Admin list has a small danger `Xóa` action per salon card.
  - Preview shows counts and warnings, then requires exact salon name.
  - Delete starts by marking salon unavailable, cancels active appointments with reason `Salon permanently deleted by platform admin`, writes status history, clears staff active work state, closes escalations, terminalizes active/stale call sessions, then permanently deletes salon data.
  - Platform admin/global call-center users are preserved; owner/staff accounts for that salon are removed.
  - External cleanup warnings remain explicit; no browser AWS CLI or hidden provider cleanup.
- CCP:
  - Embedded-first by default unless disabled by env.
  - Streams `agent/contact` events drive ready/contact state.
  - Login required, frame blocked, popup blocked, and error states have concise UI.
  - Technical details are collapsed; long AWS CLI guidance is not shown to normal operators.

## Tests

- `npm run test:lambda`: PASS, 81 tests.
- `npm run test:api`: PASS, 143 tests.
- `npm run typecheck:api`: PASS.
- `npm run typecheck:app`: PASS.
- `npm run typecheck:admin`: PASS.
- `npm run build:api`: PASS.
- `npm run build:app`: PASS, existing Vite chunk-size warning only.
- `npm run build:admin`: PASS, existing Vite chunk-size warning only.
- `npm test`: PASS, Lambda 81/81 and API 143/143.
- `git diff --check`: PASS after report write.

## UI Verification

- Browser verification used Chrome headless against production after deploy.
- Viewports checked: `1440x900`, `1920x1080`, `1024x768`, `390x844`.
- Pages checked: owner dashboard, appointments, alerts VI, call-center, admin salons; alerts EN also checked at `1440x900`.
- Result: 21 screenshots, failed `0`; no horizontal overflow; no raw `CALL_ESCALATION_CREATED`, `Human escalation created`, or `Caller pressed zero for operator` in rendered UI.
- Artifacts:
  - `/tmp/fastaibooking-screens/verification.json`
  - `/tmp/fastaibooking-screens/owner-dashboard-1440x900.png`
  - `/tmp/fastaibooking-screens/owner-appointments-1440x900.png`
  - `/tmp/fastaibooking-screens/owner-alerts-vi-1440x900.png`
  - `/tmp/fastaibooking-screens/owner-alerts-en-1440x900.png`
  - `/tmp/fastaibooking-screens/operator-call-center-1440x900.png`
  - `/tmp/fastaibooking-screens/admin-salons-1440x900.png`

## Deployment

- Deployed: yes, EC2 app/API/admin stack via `npm run deploy:ec2`.
- Prisma migrate deploy: no pending migrations.
- Rollback refs before deploy:
  - API image: `49562399d0f1`
  - Owner app image: `14a4ebd1b0ec`
  - Admin image: `feb5e3b38d9a`
  - Lambda `fastaibooking-booking-handler`: LastModified `2026-07-11T10:07:12.000+0000`, CodeSha256 `RICLr1opcQKOUEQBw+wJbFnsabIpVOObxK1mOtrQ2d4=`, RevisionId `0318963e-0cde-4733-9693-2581590770e5`
  - Connect Approved origins: `http://localhost:5173`, `https://app-new-nail.kendemo.com`
- Final deployed images:
  - API image: `88e83178d12c`
  - Owner app image: `5044bbe98c8e`
  - Admin image: `a5f45253f91d`
- AWS config changes: none.
- Lambda/Lex/Connect contact flow deploy: not changed.
- Production smoke:
  - `/health/liveness`: HTTP 200.
  - `/health/readiness`: HTTP 200.
  - owner today summary: total `14`, operational `0`, canceled `14`.
  - admin salon delete preview for `john and henry`: active calls `0`, active appointments `2`, warnings `2`; no deletion executed.
  - Lex runtime text `0`: `transferToQueue=true`, `escalationReason=customer_pressed_zero`, `conversationComplete=false`.

## Regression Verification

- AI booking regression: covered by `npm test` Lambda/API booking tests, including successful booking, retry dedupe, and one call session/AI log invariants.
- DTMF service/staff: covered by Lambda/API tests for service digit `4`, staff digits, invalid digits, and scoped DTMF menus.
- Operator `0`: covered by Lambda tests and production Lex runtime smoke.
- No auto operator: covered by backend timeout/error tests returning safe reprompts with `transferToQueue=false`.
- Reschedule/cancel and staff-change-before-confirmation: covered by API/Lambda tests.

## Remaining Risks

- True live Amazon Connect contact disconnect before salon deletion is not automated in this patch because the repo does not currently include a Connect service client/provider for that action. Delete still terminalizes DB state and returns external cleanup warnings.
- Headless browser verification cannot prove real microphone/softphone audio permissions; it verifies embedded/fallback UI state and Streams-driven code paths, not a real handset call.
- No production salon was actually deleted during smoke. The destructive path is covered by tests and preview smoke only.

## Notes

- Pre-existing dirty file `fastaibooking-current-state.zip` was present before this task and was not included in deployment or commit scope.
