# Operator UX Production Polish

Date: 2026-06-14

## Files Changed

- `apps/app/src/styles.css`
- `apps/app/src/pages/call-center-page.tsx`
- `apps/app/src/pages/dashboard-page.tsx`
- `apps/api/src/modules/salon/salon.routes.ts`
- `apps/api/src/modules/salon/salon.service.ts`
- `apps/api/test/role-guards.test.ts`
- `docs/push-notifications.md`
- `docs/operator-ux-production-polish.md`

## UX Fixes

- Operator workspace stays one column on normal laptop widths so the left context panel does not compete with the CCP and booking workflow.
- Operator top and booking grids remain one column by default, become two columns around wide tablet/small desktop width, and only allow three real cards on wide desktop.
- Active call and the important owner note stay first in the operator flow, followed by CCP, selected call summary, customer/booking form, queue, and staff schedule.
- Sticky operator context is disabled on small and medium screens and enabled only on wide/tall desktop viewports.
- Long owner notes, notification text, call summaries, messages, and escalation reasons wrap or clamp instead of widening the page.
- Notification menu is constrained to the viewport on mobile.
- Tables remain inside `.table-wrap` with horizontal scroll local to that wrapper.
- Basic operator mode hides technical CCP details and raw advanced call/debug sections.
- Wait times older than 24 hours render as `Cũ / cần kiểm tra`.

## Breakpoints

- Default, 390px, 768px, 1024px: operator workspace and operator grids are one column.
- `1100px`: `.operator-top-grid` and `.operator-booking-grid` can use two columns.
- `1500px`: operator workspace can use a left context column plus main panel; grids can fit three real cards only when enough width and children exist.
- `1500px` plus `820px` viewport height: `.operator-context-panel` can become sticky with internal scrolling.
- `1600px`: left context column can grow slightly from 340px to 360px.

## Staff Note And Notifications

- Added `GET /api/v1/salon/staff-note` before owner-only salon routes.
- `SALON_OWNER` and `STAFF` can read the owner note payload: `salonId`, `salonName`, `callCenterRoutingNote`.
- Staff dashboard reads `/api/v1/salon/staff-note` and renders the note read-only near the top.
- Owner settings update API remains unchanged.
- Owner note changes still notify assigned call-center users.
- Owner note changes also create inbox/push notifications for active staff in the salon:
  - title: `Ghi chú từ chủ tiệm đã cập nhật`
  - type: `salon_owner_note_updated`
  - url: `/dashboard`
  - includes `salonId`
- Missing Firebase credentials do not crash the API; inbox rows are still created before push send attempts.

## Notification Smoke Coverage

- Notification API routes are authenticated and role-limited for `SALON_OWNER`, `STAFF`, `CALL_CENTER_AGENT`, and `OPERATOR`.
- Notification bell loads inbox/unread count, marks one notification read, marks all read, and navigates to `notification.url`.
- Foreground Firebase messages dispatch the notification refresh event.
- Logout unregisters the browser token on a best-effort basis.
- Production API smoke verified demo owner/staff/call-center logins.
- Production API smoke updated the owner note, verified staff `/salon/staff-note`, verified call-center salon detail, verified staff/operator inbox notifications, then restored the seeded demo note.
- Production API smoke covered notification inbox, unread count, register token, unregister token, mark one read, and read all.
- Browser smoke verified no horizontal overflow on `/call-center` at 390px, 768px, 1024px, 1366px, and 1440px.
- Browser smoke verified no horizontal overflow on staff and owner dashboard checks.
- Browser smoke verified the notification menu stayed within the viewport at 390px, 768px, 1024px, 1366px, and 1440px.
- Operator smoke selected and accepted queued escalation `e44f2681-85af-48bd-8ec8-581ec9d6194c`.
- Operator smoke created appointment `48a32b30-c06c-4fd8-bf33-97406bdb1966`.
- Operator smoke completed the queued escalation; final status was `CLOSED`.

## Tests Run

- `npm run typecheck:api` passed.
- `npm run build:api` passed.
- `npm run typecheck:app` passed.
- `npm run build:app` passed. Vite reported the existing large chunk warning.
- `npm run test:lambda` passed.
- `npm run test:api` passed.
- `git diff --check` passed.
- Amazon Connect approved origins helper passed for:
  - `https://app-new-nail.kendemo.com`
  - `http://localhost:5173`
- CCP URL remains `https://fastaibooking.my.connect.aws/ccp-v2/`.

## Deploy Result

- Commit `eb06b0a` (`Polish app UX and staff notifications`) pushed to `origin/main`.
- Follow-up docs commit `8d17bf0` (`Document deployment result`) pushed to `origin/main`.
- `npm run deploy:ec2` completed successfully.
- A second deploy was run from a clean temporary worktree at `8d17bf0` so unrelated local dirty files were not shipped.
- Remote deploy rebuilt `admin`, `api`, and `app`; Prisma reported no pending migrations.
- The Firebase service-account mount was restored after the clean rsync and the API was restarted.
- Remote containers after deploy:
  - `fastaibooking-api`: healthy
  - `fastaibooking-app`: running
  - `fastaibooking-nginx`: running
  - `fastaibooking-postgres`: healthy
- `curl -fsS https://api-new-nail.kendemo.com/health/liveness` passed.
- `curl -fsS https://api-new-nail.kendemo.com/health/readiness` passed.
- Readiness reported Amazon Connect ready and push notifications configured.
- API log tail after deploy showed external unauthenticated probe attempts returning 401; no deploy startup failure was observed.
- Manual owner/staff/operator browser smoke remains to be run with real login sessions.
