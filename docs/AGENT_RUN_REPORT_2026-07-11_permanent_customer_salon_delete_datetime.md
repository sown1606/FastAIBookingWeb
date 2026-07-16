# AGENT RUN REPORT 2026-07-11 - Permanent Customer/Salon Delete and Date-Time Display

## Working Notes

- Root cause before editing:
  - Owner customer delete still keeps the original `Customer` row through privacy-delete, so identity remains recoverable from the row and from historical `BookingAttempt` / `CallSession` memory.
  - Fresh caller slot order asks service/date/time/staff before name, so unknown callers are asked for identity too late.
  - Platform admin has no salon permanent-delete preview/delete endpoint or UI.
  - Booking alerts render customer-facing appointment time with raw `toISOString()`, and the alerts UI prints raw alert type/read state.
- Files expected to change:
  - `apps/api/src/modules/customers/customers.service.ts` and `.routes.ts`: add delete preview and replace privacy-delete with atomic permanent delete/reassignment/scrub.
  - `apps/api/src/modules/appointments/appointments.service.ts`: expose push-only cancel notification and structured/localized booking alert metadata/message.
  - `apps/api/src/modules/ai/ai.service.ts` and `infra/lambda/booking-handler/index.mjs`: stop resurrecting caller identity from logs and ask unknown callers for name first.
  - `apps/api/src/modules/admin/admin.service.ts` and `.routes.ts`: add platform-admin salon delete preview/delete.
  - `apps/app/src/pages/customers-page.tsx`, `apps/app/src/pages/alerts-page.tsx`, `apps/app/src/lib/format.ts`, `apps/app/src/lib/i18n.tsx`, `apps/app/src/styles.css`: owner UI confirmation and compact alert date rendering.
  - `apps/admin/src/pages/salon-detail-page.tsx`, `apps/admin/src/lib/i18n.tsx`, `apps/admin/src/styles.css`: admin danger zone UI.
  - Focused API/Lambda/UI assertion tests for these behaviors.
- Invariants to preserve:
  - No business-hours/timezone/slot-precedence regression for the just-fixed call flow.
  - DTMF service/staff, operator 0, cancel, reschedule, stale transcript guard, bare `okay` guard, staff-change-before-confirmation, and non-terminal no-goodbye behavior stay intact.
  - Destructive production data actions and deployment are not executed in this run.

## Root Causes

- Permanent customer delete: the prior owner delete path was still privacy-delete. It kept the original `Customer` row and anonymized it, while `findKnownCallerMemoryByPhone()` could still recover a caller name from historical `BookingAttempt` / `CallSession` records. That meant a deleted phone could still be treated as a known caller.
- Fresh caller greeting: both Lambda and API slot selection preferred service/date/time/staff before `customerName`, so an unknown caller could move deep into booking before being politely asked for a name.
- Platform salon delete: admin had read/create/update salon APIs but no typed preview/delete path. Because several salon relations use `onDelete: SetNull`, a safe permanent delete needed explicit preflight, explicit call-session/audit cleanup, and owner/staff account removal.
- Date/time display: booking alert creation used `appointment.startTime.toISOString()` inside customer-facing text, and the alerts UI rendered raw alert type/read-state presentation.

## Files Changed

- `apps/api/src/modules/customers/customers.service.ts`: replaced privacy-delete with permanent delete, duplicate-phone target resolution, anonymous hidden placeholder reassignment, active appointment cancellation in the existing transaction helper, related call/debug cleanup, and safe audit metadata.
- `apps/api/src/modules/customers/customers.routes.ts`: added owner-only `GET /customers/:id/delete-preview`.
- `apps/api/src/modules/ai/ai.service.ts`: caller recognition now uses only active `Customer` rows; unknown callers are asked for `customerName` before booking slots.
- `infra/lambda/booking-handler/index.mjs`: aligned Lambda slot priority and customer-name prompts/retry policy without changing business hours, timezone, operator, confirmation, or reschedule logic.
- `apps/api/src/modules/admin/admin.service.ts`: added platform-admin salon delete preview/delete with confirmation, active-activity blocks, cascade-safe cleanup, owner/staff login removal, and global audit.
- `apps/api/src/modules/admin/admin.routes.ts`: added admin salon delete preview/delete endpoints with typed confirmation.
- `apps/api/src/modules/appointments/appointments.service.ts`: added timezone/locale alert date formatter and structured booking alert metadata.
- `apps/app/src/pages/customers-page.tsx`, `apps/app/src/lib/i18n.tsx`: owner UI now previews permanent customer delete, requires typed confirmation, and removes privacy-delete wording.
- `apps/app/src/pages/alerts-page.tsx`, `apps/app/src/styles.css`: compact alert rendering, localized booking alert label, salon-timezone appointment time, and small read badge.
- `apps/admin/src/pages/salon-detail-page.tsx`, `apps/admin/src/lib/i18n.tsx`, `apps/admin/src/styles.css`: added admin danger zone, preview counts, exact-name confirmation, and success navigation.
- `apps/api/test/admin-salon-delete.test.ts`, `apps/api/test/appointments-stabilization.test.ts`, `apps/api/test/ai-internal.test.ts`, `apps/api/test/role-guards.test.ts`, `tests/lambda/booking-handler.test.mjs`: added/updated regression coverage for permanent delete, fresh caller recognition, salon delete, date formatting, and call-flow invariants.
- Pre-existing dirty file left untouched: `fastaibooking-current-state.zip` was already modified at the initial `git status --short`.

## Permanent Customer Deletion Behavior

- `DELETE /api/v1/customers/:id` now returns `mode: "permanent_delete"` and hard-deletes the selected active customer row plus active duplicate customer profiles in the same salon with the same normalized phone.
- `GET /api/v1/customers/:id/delete-preview` reports matched customer IDs/count, appointment counts, active appointment count, call-session count, booking-attempt count, and a permanent-delete warning.
- Active appointments (`SCHEDULED`, `CONFIRMED`, `IN_PROGRESS`) are canceled inside the same transaction using `cancelAppointmentInTransaction`; terminal appointment statuses are preserved.
- Appointment history is reassigned to one hidden deleted anonymous customer per salon, appointment notes are cleared, feedback phone is scrubbed, and original customer rows are hard-deleted.
- Customer-facing cancel notifications are not sent for permanent deletion. Audit metadata stores counts/technical IDs only, not raw name/email/phone/notes.
- Targeted call/debug records are deleted by deterministic linkage: phone variants, appointment IDs, call-session IDs, booking-attempt IDs, transcript IDs, and normalized JSON `customerId`. Call-session child records cascade through schema relations.

## Fresh Caller Recognition/Greeting Behavior

- Known callers are recognized only from active `Customer` rows in the correct salon (`deletedAt: null`).
- `BookingAttempt`, `CallSession`, transcripts, and AI summaries no longer populate `recognizedCustomerName`, greeting text, or booking state.
- Unknown callers are asked for `customerName` before service/date/time/staff while preserving any service/date/time/staff already spoken in the first turn.
- Prompts now follow the requested policy: polite first ask, slow-name retry, spelling retry. Operator 0 and explicit human requests still bypass name collection.

## Permanent Salon Deletion Behavior

- Added platform-admin-only preview and delete endpoints:
  - `GET /api/v1/admin/salons/:id/delete-preview`
  - `DELETE /api/v1/admin/salons/:id`
- Delete requires `confirmPermanentDelete: true` and exact trimmed salon name.
- Active calls and `IN_PROGRESS` appointments block deletion with 409 and no side effects.
- Successful delete explicitly removes salon call sessions and prior salon audit logs, deletes the salon for cascade cleanup, revokes refresh tokens, deletes owner/staff user accounts, preserves platform admin/call-center agent users, and writes a global `SALON_PERMANENTLY_DELETED` audit.
- Response includes counts and `externalCleanupRequired`; no AWS/CallRail destructive external automation is executed.

## Date/Time Display Behavior

- New booking alerts include structured metadata: appointment ID, customer/service/staff names, start/end time, salon timezone, and source.
- Alert messages no longer embed raw ISO UTC strings. Backend formatting uses salon timezone and locale fallback (`vi-VN` / `en-US`).
- Owner alerts UI renders `BOOKING_CREATED` as localized `Lịch hẹn mới` / `New appointment`, formats appointment time in salon timezone, parses legacy ISO strings defensively, and uses a compact read badge instead of a full-width read button.

## Tests

- `npm run test:lambda`: PASS, 81 tests.
- `npm run test:api`: PASS, 136 tests.
- `npm run typecheck:api`: PASS.
- `npm run typecheck:app`: PASS.
- `npm run typecheck:admin`: PASS.
- `npm run build:api`: PASS.
- `npm run build:app`: PASS. Vite emitted existing chunk-size warnings only.
- `npm run build:admin`: PASS. Vite emitted existing chunk-size warnings only.
- `npm test`: PASS; Lambda 81/81 and API 136/136.
- `git diff --check`: PASS.
- `git status --short`: inspected after verification; source/test/report files are modified, and `fastaibooking-current-state.zip` remains the pre-existing dirty file.

## Deployment

- DEPLOYED on 2026-07-11.
- AWS account/profile: `nailnew`, account `197452633989`.
- EC2 deploy command: `npm run deploy:ec2`.
  - Target host: `32.194.150.135`, app dir `/home/ubuntu/fastAibooking`.
  - Prisma migrate deploy ran successfully: `No pending migrations to apply.`
  - Before images:
    - API: `2d5e944b6f06`
    - App: `b32229c41612`
    - Admin: `d10550eec150`
  - After images:
    - API: `c52ace04f79b`
    - App: `953809b57d9f`
    - Admin: `7035a20cd8f9`
- Lambda deploy:
  - Function: `fastaibooking-booking-handler`
  - Before rollback reference:
    - LastModified: `2026-07-10T18:51:44.000+0000`
    - CodeSha256: `OUEQkvAsRQ80NSgyBaM39CvyiX1r0/v7aSPFqLlWVcU=`
    - RevisionId: `9aabeca2-db15-42e2-a6c0-499a84de1d00`
  - After:
    - LastModified: `2026-07-11T10:07:12.000+0000`
    - CodeSha256: `RICLr1opcQKOUEQBw+wJbFnsabIpVOObxK1mOtrQ2d4=`
    - RevisionId: `0318963e-0cde-4733-9693-2581590770e5`
    - LastUpdateStatus: `Successful`
- Lex/Connect:
  - Lex bot alias was not republished.
  - Current alias remains `KHMIXGA2US/JVIPIZDYE3` (`prod`) on version `27`.
  - Connect contact flows were not changed.
- Post-deploy smoke:
  - `https://api-new-nail.kendemo.com/health/liveness`: HTTP 200, `status: ok`.
  - `https://api-new-nail.kendemo.com/health/readiness`: HTTP 200, `status: ready`.
  - `https://app-new-nail.kendemo.com`: HTTP 200.
  - `https://admin-new-nail.kendemo.com`: HTTP 200.
  - Lambda direct invoke with unknown caller and full booking details elicited `customerName`, preserved service/date/time/staff, and did not create an appointment.
  - Lex runtime text `0` returned `Please wait while I connect you.`, `transferToQueue=true`, and `conversationComplete=false`.
  - Recent API/Lambda logs for smoke showed successful responses. The operator smoke created synthetic call/escalation/log records for session `codex-operator0-smoke-20260711T1008Z`.

## Destructive Data Action

NOT EXECUTED.

## Remaining Risks

- External telephony/provider resources are not deprovisioned by salon delete. The API returns explicit `externalCleanupRequired` warnings for configured providers such as Amazon Connect and CallRail.
- Customer permanent delete intentionally avoids substring name searches to prevent deleting another person's data. Free-text PII in unrelated records that are not linked by customer ID, phone variant, appointment, call session, transcript, or booking attempt is not destructively searched.
- This run did not deploy or run production cleanup. Real customer/salon deletion still requires target environment confirmation and an explicit operator action through the new APIs/UI.
