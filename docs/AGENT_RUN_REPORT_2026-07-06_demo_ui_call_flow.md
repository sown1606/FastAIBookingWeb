# Agent Run Report - 2026-07-06 Demo UI and Call Flow

## Scope
- Polished the owner app UI for the live salon demo with minimal frontend-only changes.
- Kept existing AI call booking flow, backend appointment semantics, role guards, and production data untouched.
- Improved appointment loading in the app by querying the appointments API with `dateFrom` and `dateTo` instead of relying on a small first page.

## Files Inspected
- `apps/app/src/App.tsx`
- `apps/app/src/components/layout.tsx`
- `apps/app/src/auth/login-page.tsx`
- `apps/app/src/auth/auth-frame.tsx`
- `apps/app/src/pages/dashboard-page.tsx`
- `apps/app/src/pages/appointments-page.tsx`
- `apps/app/src/pages/services-page.tsx`
- `apps/app/src/pages/staff-page.tsx`
- `apps/app/src/styles.css`
- `apps/app/src/lib/timezone.ts`
- `apps/api/src/modules/appointments/appointments.routes.ts`
- `apps/api/src/modules/appointments/appointments.service.ts`
- `package.json`
- `apps/api/package.json`
- `apps/app/package.json`

## Files Changed
- `apps/app/src/components/layout.tsx`
- `apps/app/src/auth/login-page.tsx`
- `apps/app/src/pages/dashboard-page.tsx`
- `apps/app/src/pages/appointments-page.tsx`
- `apps/app/src/pages/services-page.tsx`
- `apps/app/src/pages/staff-page.tsx`
- `apps/app/src/styles.css`
- `docs/AGENT_RUN_REPORT_2026-07-06_demo_ui_call_flow.md`

## Design Changes
- Simplified basic-mode owner navigation to: Booking, Services, Staff, Alerts, Salon.
- Added fixed mobile/tablet bottom navigation and kept desktop navigation clean.
- Polished login into a compact warm salon sign-in card and moved demo accounts into a collapsible helper.
- Reworked basic owner dashboard into an appointments-home layout with greeting, today count, appointment cards, and compact AI/call-center status.
- Updated appointment, service, and staff cards with warm cream surfaces, gold actions, rounded cards, pill badges, and softer shadows.
- Added real-data appointment detail card using loaded appointment data or `GET /api/v1/appointments/:id`.
- Verified the demo image assets already exist in `apps/app/public/assets/demo/`; no broken asset URLs remain in the app build.

## Call-Flow Areas Intentionally Not Changed
- `infra/lambda/booking-handler/index.mjs`
- `apps/api/src/modules/ai/ai.service.ts`
- `infra/aws/lex`
- `infra/aws/connect`
- Existing dirty Lex export and lambda test files were present before this work and were not modified by this run.

## Commands Run and Results
- `npm ci`: passed; npm reported 19 audit findings.
- `npm --prefix apps/api run prisma:generate`: passed.
- `npm run typecheck:app`: passed.
- `npm run build:app`: passed; Vite reported existing large chunk warnings only.
- `npm --prefix apps/api run typecheck`: passed when run after Prisma generation completed. An earlier parallel run failed because it raced with client generation.
- `npm --prefix apps/api run test`: passed, 63/63.
- `npm run test:lambda`: passed, 30/30.
- `npm run test`: passed, 93/93 aggregate.
- `git diff --check`: passed.

## Browser Smoke Results
- Playwright and Puppeteer are not installed in this repo, and no browser test config exists.
- Automated browser smoke for owner/staff/operator accounts was not run.
- Existing production demo-login smoke passed for owner, staff, and operator role-specific and generic login paths.
- API and lambda tests covered the requested call-flow regressions.

## Call-Flow Regression Verification
- Known caller Kiet phone lookup preserved: covered by API and lambda tests.
- "eddie here" maps to Pedicure: covered by API and lambda tests.
- Today/tomorrow date parsing: covered by API and lambda tests.
- Staff DTMF uses active/bookable DB staff: covered by API tests.
- Staff DTMF 0 means any staff: covered by API and lambda tests.
- DTMF 0 outside staff selection can escalate to operator: covered by lambda tests.
- Invalid staff digit repeats staff prompt and does not create booking: covered by API and lambda tests.
- Explicit human request says "Please wait while I connect you.": covered by lambda tests.
- Slow backend operations have wait prompts and no controlled silent gap over 3 seconds: covered by lambda tests.

## Blockers
- Browser automation was unavailable without adding new tooling.
- No backend or call-flow blocker found.

## Deploy Result
- `npm run deploy:ec2`: passed.
- Docker app/API/admin images built successfully.
- Prisma migrate deploy found no pending migrations.
- API container reported healthy.
- `./infra/scripts/smoke_test_production.sh`: passed.
- `npm --prefix apps/api run smoke:prod-logins`: passed, 6/6.

## Commit Hash
- Final pushed commit hash is recorded in the run final response after this report is committed.
