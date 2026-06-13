# Operator UX Production Polish

Date: 2026-06-13

## Screens checked

- Operator Call Center: `apps/app/src/pages/call-center-page.tsx`
- Staff Dashboard: `apps/app/src/pages/dashboard-page.tsx`
- Owner Salon Profile settings: `apps/app/src/pages/salon-profile-page.tsx`
- App shell/topbar/sidebar: `apps/app/src/components/layout.tsx`
- Notification bell: `apps/app/src/components/notification-bell.tsx`
- Shared app styles: `apps/app/src/styles.css`
- Vietnamese/English UI wording: `apps/app/src/lib/i18n.tsx`
- Staff/operator note API and notifications: `apps/api/src/modules/salon`, `apps/api/src/modules/notifications`

## UX issues found

- Operator layout could become too wide on laptop widths because the sidebar, left context panel, and a three-column top grid competed for horizontal space.
- On widths below the two-panel breakpoint, the entire operator context panel could appear before CCP and booking tools, delaying the active workflow.
- Queue rows showed long escalation/message text inline, which could widen or visually dominate the queue.
- Booking submit could still reach the API with missing customer, staff, service, or start time and rely on backend errors.
- Owner monitor did not show the important routing note in basic mode.
- The salon profile routing note field was not visually prominent enough for owner/staff handoff.
- Long notification text and shared button/action rows needed stronger wrapping rules.
- Staff had no read-only place to see the owner note.
- Note-change notifications only targeted assigned operators, not active staff in the salon.

## Files changed

- `apps/app/src/pages/call-center-page.tsx`
- `apps/app/src/pages/dashboard-page.tsx`
- `apps/app/src/pages/salon-profile-page.tsx`
- `apps/app/src/lib/i18n.tsx`
- `apps/app/src/styles.css`
- `apps/api/src/modules/salon/salon.routes.ts`
- `apps/api/src/modules/salon/salon.service.ts`
- `apps/api/src/modules/notifications/notifications.service.ts`
- `apps/api/test/ai-internal.test.ts`
- `apps/api/test/role-guards.test.ts`

## Layout breakpoints changed

- Default and tablet widths: operator workspace is one column; context panel exposes active call and owner note first, then the main CCP/booking workflow, with deeper context after.
- `900px`: queue row can use compact multi-column metadata while long details remain collapsed.
- `1200px`: operator workspace becomes two columns with a bounded context panel and one-column main workflow.
- `1200px` plus viewport height `760px`: context panel becomes sticky with internal scrolling.
- `1600px`: operator main top grid and booking grid can use two columns. The previous three-column top squeeze was removed.

## Functions verified by code inspection

- Load salons and select salon remain on existing call-center APIs.
- Load queue, select queue item, accept item, save notes, request callback, send SMS fallback, complete item remain on existing APIs.
- Create customer and create booking remain on existing APIs.
- Booking now validates selected salon, customer, staff, service, and start time before submit.
- Customer match pills remain visible above the booking forms and selecting a match sets the booking customer.
- Existing automatic first-match selection and caller-phone prefill remain in `loadEscalationDetail`.
- Schedule day navigation still reloads salon appointment data.
- CCP new-tab action remains a real link to the configured CCP URL.
- Notification bell still marks read, closes the menu, and navigates to `notification.url`.
- Staff dashboard reads `/api/v1/salon/operator-note` and shows the owner note read-only near the top.
- Owner note changes now create inbox/push notifications for assigned operators and active staff users in the same salon.
- Notification routes remain authenticated and current-user scoped.

## Tests and build

- `git diff --check` passed.
- `npm run typecheck:api` passed.
- `npm run build:api` passed.
- `npm run test:api` passed.
- `npm run typecheck:app` passed.
- `npm run build:app` passed.
- `npm run test:lambda` passed.
- Amazon Connect Approved origins helper passed for `https://app-new-nail.kendemo.com` and `http://localhost:5173`.
- Vite still reports the existing large chunk warning for production assets.

## Remaining blockers

- Browser-auth responsive verification was not run in this pass. The CSS was adjusted for 390px, 768px, 1024px, 1366px, 1440px, and 1600px targets by breakpoint and overflow review.
- Unrelated local seed/Lex changes were left unstaged and are not part of this polish pass.

## Manual test checklist

1. Login owner.
2. Open Salon Profile.
3. Edit important operator/staff note.
4. Save note.
5. Login operator.
6. Open `/call-center`.
7. Confirm note appears near top.
8. Confirm CCP panel still loads or shows clear fallback.
9. Select queue item.
10. Accept call.
11. Create customer if no match.
12. Create booking.
13. Save notes.
14. Complete call.
15. Check no horizontal overflow at 1366px and 1440px.
