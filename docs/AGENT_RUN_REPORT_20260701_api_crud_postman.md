# Agent Run Report - 2026-07-01 API CRUD/Postman

## Scope

- Added mobile-requested owner APIs for staff and service delete.
- Extended staff create/reset password behavior for manual and generated passwords.
- Added mobile-friendly staff password alias.
- Updated mobile API docs and Postman collection examples.
- Added lightweight API/static coverage for route guards, password modes, delete logic, and Postman request names.

## Files inspected

- `apps/api/src/modules/staff/staff.routes.ts`
- `apps/api/src/modules/staff/staff.service.ts`
- `apps/api/src/modules/services/services.routes.ts`
- `apps/api/src/modules/services/services.service.ts`
- `apps/api/src/modules/admin/admin.routes.ts`
- `apps/api/src/lib/mailer.ts`
- `apps/api/src/modules/auth/auth.routes.ts`
- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/billing/billing.service.ts`
- `apps/api/prisma/schema.prisma`
- `apps/api/test/role-guards.test.ts`
- `FastAIBooking_Postman_Collection.json`
- `FastAIBooking_Postman_Environment.json`
- `docs/MOBILE_APP_API.md`
- `docs/MOBILE_APP_API_EXPORT.json`
- `package.json`
- `apps/api/package.json`
- `infra/scripts/deploy_remote_ec2.sh`
- `infra/scripts/deploy_ec2.sh`

## Files changed

- `apps/api/src/modules/staff/staff.routes.ts`
- `apps/api/src/modules/staff/staff.service.ts`
- `apps/api/src/modules/services/services.routes.ts`
- `apps/api/src/modules/services/services.service.ts`
- `apps/api/src/modules/admin/admin.routes.ts`
- `apps/api/src/lib/mailer.ts`
- `apps/api/test/role-guards.test.ts`
- `FastAIBooking_Postman_Collection.json`
- `docs/MOBILE_APP_API.md`
- `docs/MOBILE_APP_API_EXPORT.json`
- `docs/AGENT_RUN_REPORT_20260701_api_crud_postman.md`

`FastAIBooking_Postman_Environment.json` was inspected but not changed because no new variables were needed.

## API decisions

- `POST /api/v1/staff` accepts existing `fullName` payloads and mobile `firstName`/`lastName` payloads.
- `POST /api/v1/staff` accepts optional `password`.
  - Provided password returns `passwordMode: "MANUAL"`.
  - Omitted password generates a temporary password and returns `passwordMode: "GENERATED"`.
- Staff create supports optional `isActive`; existing `isBookable` remains supported.
- Staff invitation email now includes login email and temporary/manual password.
- `POST /api/v1/staff/:id/reset-access` accepts optional `password`, legacy `newPassword`, and `sendEmail`.
  - Provided password uses manual mode.
  - Omitted password generates a temporary password.
  - `sendEmail` defaults to `true`.
  - If no linked user exists, the reset flow creates or safely links a staff user account.
- Added `PATCH /api/v1/staff/:id/password` as an alias using the same `resetStaffAccess` service function.
- Added `DELETE /api/v1/staff/:id`.
  - Owner-only and salon-scoped.
  - Safe soft delete: sets `status=INACTIVE`, `isBookable=false`, disables linked user login, removes staff-service mappings, refreshes billing usage, and audits `STAFF_DELETED`.
  - Appointment history is not deleted.
- Added `DELETE /api/v1/services/:id`.
  - Owner-only and salon-scoped.
  - Safe soft delete: sets `isActive=false`, removes staff-service mappings, and audits `SERVICE_DELETED`.
  - Appointment history is not deleted.
- Existing deactivate/reactivate and activate/deactivate APIs were left in place.

## CRUD audit

- Staff: list/create/update/deactivate/reactivate/reset-access/service mappings/self routes present; added delete and password alias.
- Services: list/create/update/activate/deactivate/staff mapping present; added delete.
- Customers: list/create/detail/update/customer appointment history routes exist.
- Appointments: list/create/detail/update/cancel/reschedule/staff workflow routes exist.
- Business hours: get/put routes exist.
- Salon profile/settings: get/put routes exist.

No extra CRUD endpoint was added beyond the requested staff/service/password coverage.

## Commands run and results

- `git status --short`: repo had pre-existing unrelated dirty files before this task.
- `npm run typecheck:api`: initially failed with one TypeScript narrowing error in `staff.service.ts`; fixed.
- `npm run build:api`: initially failed with the same TypeScript narrowing error; fixed.
- `npm run typecheck:api`: pass.
- `npm run build:api`: pass.
- `npm run test:api`: pass, 54 tests.

Frontend files were not touched for this task, so `typecheck:app` and `build:app` were not required.

## Postman updates

Added/updated Staff requests:

- `Create Staff - Manual Password`
- `Create Staff - Auto Generated Password`
- `Reset Staff Password - Manual`
- `Reset Staff Password - Auto Generated`
- `Set Staff Password`
- `Delete Staff`

Added Services request:

- `Delete Service`

The collection uses existing variables: `baseUrl`, `ownerAccessToken`, `language`, `staffId`, and `serviceId`.

## QA cases

- Owner-only route guard assertions for staff delete, staff password alias, and service delete.
- Staff create validation keeps `password` optional.
- Staff create supports manual and generated password paths.
- Staff reset-access supports manual and generated password paths.
- Email paths are wired for staff invitation and reset when `sendEmail !== false`.
- Staff delete soft-deletes safely without appointment deletion.
- Service delete soft-deletes safely without appointment deletion.
- Postman collection contains the required mobile request names.

## Deploy result

Pending at report creation. The deploy must run after commit/push, preferably from a clean worktree because the current local workspace contains unrelated dirty files and large artifacts.

## Commit hash

Pending at report creation. Git commit hashes are only available after the commit is created; the final response for this run records the exact pushed commit hash.

## Next steps/blockers

- Commit only the scoped files for this task; leave unrelated dirty files untouched.
- Push the branch.
- Run `npm run deploy:ec2` from a clean worktree or equivalent clean checkout to avoid shipping unrelated local files.
- Run production smoke checks against `https://api-new-nail.kendemo.com`, including `npm --prefix apps/api run smoke:prod-logins` if credentials/config are available.
