# UI Luxury Refresh Audit

Date: 2026-07-03

## Design Reference Summary

Applied a premium salon direction to `apps/app`: warm cream background, gold primary actions, dark brown text, soft white cards, pill badges, rounded inputs, larger card radii, restrained shadows, mobile-first spacing, and a more polished staff booking/call readiness presentation.

## Files Inspected

- `apps/app/src/styles.css`
- `apps/app/src/components/layout.tsx`
- `apps/app/src/auth/*`
- `apps/app/src/pages/dashboard-page.tsx`
- `apps/app/src/pages/appointments-page.tsx`
- `apps/app/src/pages/services-page.tsx`
- `apps/app/src/pages/staff-page.tsx`
- `apps/app/src/pages/salon-profile-page.tsx`
- `apps/app/src/pages/call-center-page.tsx`
- `apps/app/src/pages/calls-page.tsx`
- `apps/app/src/pages/ai-logs-page.tsx`
- Shared components: states, notification bell, language switcher, dialogs, cards/buttons via CSS classes

## Files Changed

- `apps/app/src/styles.css`
- `apps/app/src/pages/staff-page.tsx`
- `apps/app/src/lib/i18n.tsx`

## Shared Design Tokens Changed

- Background: `#F5EBDD`, `#F8F1E7`
- Card surface: `#FFFFFF`, `#FFFDF8`
- Primary gold: `#C99A2E`
- Gold dark: `#9B6F1E`
- Gold soft: `#F0D48A`
- Text dark: `#2A2118`
- Muted text: `#8A7662`
- Border: `#E9DCCB`
- Danger: `#D85B5B`
- Success: `#4F8A5B`
- Radius variables: `--radius-card: 22px`, `--radius-control: 18px`

## Pages Visually Updated

- Dashboard hero and quick actions now use warm image overlays and gold primary treatment.
- Appointment cards, entity cards, hours cards, schedule cards, staff cards, and shared cards now use premium rounded surfaces.
- Forms use cream/white rounded inputs and pill buttons.
- Staff page defaults to `Nail Technician`, keeps bookable ON, and shows an `AI booking ready` pill for active/bookable staff.
- Notification, language, role, and status pills were aligned with the refreshed palette.

## Responsive Checks

- `npm --prefix apps/app run typecheck` passed.
- `npm --prefix apps/app run build` passed.
- CSS remains mobile-first with existing breakpoints at 430px, 700px, 900px, 1025px, 1100px, 1500px, and 1600px.
- No page logic, route guards, owner/staff/operator menu rules, or API calls were changed.

## Known Gaps

- No browser screenshot pass was run in this environment.
- `apps/admin` was not restyled beyond shared repository state; this pass focused on `apps/app` as requested.
- Vite build still reports large production chunks for existing bundles, but build exits successfully.
