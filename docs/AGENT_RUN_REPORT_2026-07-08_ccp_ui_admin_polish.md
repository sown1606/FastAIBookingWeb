# Agent Run Report - 2026-07-08 CCP UI Admin Polish

## Scope

- Polished the Call Center CCP experience when embedded Amazon Connect CCP is blocked by CSP.
- Kept the Amazon Connect/Lex/Lambda booking and escalation flow intact.
- Refined `apps/app` operator screen hierarchy and `apps/admin` visual tokens/styling.
- Kept screens connected to existing real APIs; no fake data, seed data, Lex prompts, contact flows, Lambda booking handler, AI booking service, or appointment creation logic were changed.

## Files Inspected

- `apps/app/src/pages/call-center-page.tsx`
- `apps/app/src/styles.css`
- `apps/app/src/components/layout.tsx`
- `apps/app/src/lib/i18n.tsx`
- `apps/admin/src/styles.css`
- `apps/admin/src/components/layout.tsx`
- `apps/admin/src/pages/dashboard-page.tsx`
- `apps/admin/src/pages/health-page.tsx`
- `apps/admin/src/pages/salons-page.tsx`
- `apps/admin/src/pages/salon-detail-page.tsx`
- `apps/admin/src/pages/calls-page.tsx`
- `apps/admin/src/pages/call-detail-page.tsx`
- `apps/admin/src/pages/call-center-agents-page.tsx`
- `apps/api/src/modules/call-center/call-center.routes.ts`
- `apps/api/src/modules/call-center/call-center.service.ts`
- `scripts/aws/ensure-connect-approved-origins.sh`
- `docs/operator-ccp-aws-cli-pass.md`
- `docs/amazon-connect.md`

## Files Changed

- `apps/app/src/pages/call-center-page.tsx`
- `apps/app/src/styles.css`
- `apps/app/src/lib/i18n.tsx`
- `apps/admin/src/styles.css`
- `scripts/aws/ensure-connect-approved-origins.sh`
- `docs/operator-ccp-aws-cli-pass.md`
- `docs/amazon-connect.md`
- `docs/AGENT_RUN_REPORT_2026-07-08_ccp_ui_admin_polish.md`

## CCP Diagnosis

- Embedded CCP blocked by CSP is handled as an Amazon Connect Approved origins configuration issue.
- The embedded CCP initialization is still attempted.
- When embedded CCP is blocked, slow, or not ready, the operator sees a calm Direct CCP mode card instead of a long technical warning.
- Direct CCP mode keeps the real queue, active call panel, salon context, customer creation, appointment creation, notes, callback, SMS fallback, and complete actions available.
- Lightweight queue polling runs every 10 seconds while the embedded CCP is not ready.
- Waiting/open queue items sort before closed/stale demo items, and stale closed rows are visually de-emphasized.

## AWS Commands To Run

```bash
aws sts get-caller-identity --profile nailnew
aws connect list-approved-origins --profile nailnew --region us-east-1 --instance-id 74f78377-766f-46b7-a745-4bc97b68a8dc
AWS_PROFILE=nailnew AWS_REGION=us-east-1 APP_ORIGIN=https://app-new-nail.kendemo.com ./scripts/aws/ensure-connect-approved-origins.sh
AWS_PROFILE=nailnew AWS_REGION=us-east-1 APP_ORIGIN=https://app-new-nail.kendemo.com FORCE_REAPPLY=true ./scripts/aws/ensure-connect-approved-origins.sh
```

`FORCE_REAPPLY=true` removes and re-adds only the exact `APP_ORIGIN`; it does not remove unrelated origins.

## UI/UX Changes

- Added first-class Direct CCP mode copy and actions in Vietnamese and English.
- Moved AWS CLI diagnostics into collapsible technical details only.
- Added current App origin, current CCP URL, and expected Approved origin to the operator fallback card.
- Updated operator queue styling so truly waiting/open items are prominent and old closed items are less noisy.
- Updated admin CSS tokens to the same warm cream/gold/brown premium style used in `apps/app`.
- Polished admin sidebar, topbar, cards, tables, pills, buttons, auth shell, and responsive surfaces through CSS only.

## Commands Run And Results

- `bash -n scripts/aws/ensure-connect-approved-origins.sh` - passed.
- `npm run typecheck:app` - passed.
- `npm run build:app` - passed; Vite emitted the existing large chunk warning.
- `npm run typecheck:admin` - passed.
- `npm run build:admin` - passed; Vite emitted the existing large chunk warning.
- `npm run typecheck:api` - passed.
- `npm run build:api` - passed.
- `npm run test:api` - passed, 67 tests.
- `git diff --check` - passed.
- `npm run deploy:ec2` - passed; Docker images rebuilt, Prisma reported no pending migrations, app/admin containers were recreated, API was healthy, and nginx reloaded.

## Risks / Blockers

- Direct CCP mode depends on the operator logging into the real Amazon Connect CCP tab and setting agent state to Available.
- Embedded CCP still requires the production app origin to be applied in the correct AWS account, region, and Connect instance.
- The worktree had a pre-existing unrelated modified file: `fastaibooking-current-state.zip`. It was not changed or staged by this work.

## Manual Demo Checklist

1. Login as agent.demo@fastaibooking.local.
2. Open /call-center.
3. Click Open Amazon Connect CCP.
4. Login direct CCP and set agent Available.
5. Make test call and ask for human operator.
6. Confirm queue item appears.
7. Accept/handle call.
8. Create customer if needed.
9. Create real appointment.
10. Complete call.
11. Confirm owner/staff dashboards still show data correctly.
