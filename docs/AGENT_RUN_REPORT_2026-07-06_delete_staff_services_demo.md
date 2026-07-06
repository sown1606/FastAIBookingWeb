# Agent Run Report - Delete Staff and Services Demo

Date: 2026-07-06

## Scope

- Finished safe owner-app delete functionality for Services and Staff.
- Kept the AI call booking flow untouched.
- Used persistent soft delete only. Staff and Service rows remain in the database so appointment history and foreign-key references stay intact.

## Files Inspected

- apps/api/prisma/schema.prisma
- apps/api/src/modules/staff/staff.service.ts
- apps/api/src/modules/staff/staff.routes.ts
- apps/api/src/modules/services/services.service.ts
- apps/api/src/modules/services/services.routes.ts
- apps/api/test/role-guards.test.ts
- apps/app/src/lib/api.ts
- apps/app/src/lib/i18n.tsx
- apps/app/src/pages/services-page.tsx
- apps/app/src/pages/staff-page.tsx
- apps/app/src/styles.css
- apps/app/public/assets/demo/nail-service.webp
- apps/app/public/assets/demo/salon-wall.webp

## Files Changed

- apps/api/prisma/schema.prisma
- apps/api/prisma/migrations/202607060001_soft_delete_staff_services/migration.sql
- apps/api/src/modules/staff/staff.service.ts
- apps/api/src/modules/services/services.service.ts
- apps/api/test/role-guards.test.ts
- apps/app/src/lib/api.ts
- apps/app/src/lib/i18n.tsx
- apps/app/src/pages/services-page.tsx
- apps/app/src/pages/staff-page.tsx
- apps/app/src/styles.css
- docs/AGENT_RUN_REPORT_2026-07-06_delete_staff_services_demo.md

## deletedAt Migration

Added a safe Prisma migration with nullable columns and indexes only:

- Staff.deletedAt DateTime?
- Service.deletedAt DateTime?
- @@index([salonId, deletedAt]) on Staff and Service

No existing rows are removed or rewritten by the migration.

## Soft Delete Rationale

Staff and Service are referenced by appointments. Delete now marks rows as deleted/inactive and removes staff-service mappings, but it does not hard-delete staff, services, or appointments. This preserves appointment history and avoids breaking historical records.

## Call Flow Files Intentionally Not Changed

- infra/lambda/booking-handler/index.mjs
- apps/api/src/modules/ai/ai.service.ts
- infra/aws/lex
- infra/aws/connect

Pre-existing local changes were present in infra/aws/lex and tests/lambda/booking-handler.test.mjs. They were not edited by this run.

## Commands Run

- npm ci: passed. npm reported existing audit warnings.
- npm --prefix apps/api run prisma:generate: passed.
- npm run typecheck:app: passed.
- npm run build:app: passed. Vite reported only the existing large chunk warning; no missing demo asset warnings.
- npm --prefix apps/api run typecheck: passed.
- npm --prefix apps/api run test: passed, 63/63.
- npm run test:lambda: passed, 30/30.
- npm run test: passed, lambda 30/30 and API 63/63.
- git diff --check: passed.

After a small cleanup to avoid returning deletedAt in service summaries, the affected API checks and root tests were rerun and passed:

- npm --prefix apps/api run typecheck: passed.
- npm --prefix apps/api run test: passed, 63/63.
- npm run test: passed, lambda 30/30 and API 63/63.
- git diff --check: passed.

## Smoke Results

Local test coverage confirmed:

- "eddie here" still maps to Pedicure.
- today/tomorrow and salon-timezone parsing still pass.
- staff DTMF uses active/bookable DB staff.
- DTMF 0 in staff selection still means Any staff.
- DTMF 0 outside staff selection still escalates only through the existing operator path.
- Human request still says "Please wait while I connect you."
- Wait prompts remain present for slow API operations.

Deleted staff/service availability is covered by the new service-layer filters and static guard tests: deleted rows are excluded from normal list queries, active staff/service options, and staff-service mappings even when includeInactive=true.

## Deploy Result

Pending at report creation. Deploy and production smoke results are recorded in the final agent response after commit/push/deploy.

## Commit Hash

Pending at report creation. The final agent response records the pushed commit hash.
