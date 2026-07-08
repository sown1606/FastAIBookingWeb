# Operator CCP AWS CLI Pass

Date: 2026-07-08

## AWS Identity

- AWS profile: `nailnew`
- AWS region: `us-east-1`
- AWS account id: `197452633989`

## Amazon Connect Instance

- Alias: `fastaibooking`
- Instance id: `74f78377-766f-46b7-a745-4bc97b68a8dc`
- CCP URL format: `https://fastaibooking.my.connect.aws/ccp-v2/`

## Approved Origins

Before update:

- none

After update:

- `http://localhost:5173`
- `https://app-new-nail.kendemo.com`

## Direct CCP Fallback

If the embedded CCP is blocked by browser CSP such as `frame-ancestors 'self'`, treat it as an Amazon Connect Approved origins configuration issue. The operator screen is still usable:

- click `Open Amazon Connect CCP`
- log in to the direct CCP tab
- set the agent state to Available
- keep `/call-center` open for the real queue, salon context, customer creation, booking creation, notes, callbacks, SMS fallback, and completion actions

The `/call-center` page continues lightweight queue polling while embedded CCP is not ready, so queued escalations can still appear during Direct CCP mode.

## FORCE_REAPPLY Usage

Use the helper for the normal verification/add pass:

```bash
AWS_PROFILE=nailnew AWS_REGION=us-east-1 APP_ORIGIN=https://app-new-nail.kendemo.com ./scripts/aws/ensure-connect-approved-origins.sh
```

If the production origin is already listed but the iframe is still blocked, re-apply only the exact app origin:

```bash
AWS_PROFILE=nailnew AWS_REGION=us-east-1 APP_ORIGIN=https://app-new-nail.kendemo.com FORCE_REAPPLY=true ./scripts/aws/ensure-connect-approved-origins.sh
```

The script prints AWS caller identity, the selected Connect instance alias/id/region, Approved origins before and after, and fails clearly when the profile account does not match the expected FastAIBooking account. `FORCE_REAPPLY=true` never removes unrelated origins.

## Connect Resources

Queues:

- `VietnamOperatorQueue` (`STANDARD`): `45e2d433-0135-4f9c-a6f9-099c90d470c0`
- `BasicQueue` (`STANDARD`): `7725f572-1319-4ab7-8f04-988598f953c2`
- `FastAIBooking Operator Queue` (`STANDARD`): `d0f2a5d8-e983-4609-9bbc-efb0881a465d`
- Agent queues present for `operator1`, `fastaibooking`, and `operator-demo`.

Users:

- `operator1`: `0da9b3e7-865a-4a2c-b6aa-6b1c21759470`
- `fastaibooking`: `0f25273a-6f44-4d1c-b5d6-b2f3ac2b8dfc`
- `operator-demo`: `4549005f-03cc-4794-9163-d9e900354f9b`

Routing profiles:

- `FastAIBooking Operator Routing Profile`: `40c00f91-f81f-4cec-9faa-da14e575b523`
- `VietnamOperatorVoiceProfile`: `54208312-7b2c-44e1-87a5-32f6ed8a52d6`
- `Basic Routing Profile`: `8d039bb8-8add-4f4d-9e9b-8eca69707f1c`

## Files Changed

- `scripts/aws/ensure-connect-approved-origins.sh`
- `apps/app/src/pages/call-center-page.tsx`
- `apps/app/src/pages/salon-profile-page.tsx`
- `apps/app/src/lib/i18n.tsx`
- `apps/app/src/styles.css`
- `docs/amazon-connect.md`
- `docs/operator-ccp-aws-cli-pass.md`

## Tests Run

- `git diff --check` - passed.
- `npm run typecheck:app` - passed.
- `npm run build:app` - passed. Vite emitted only the existing large chunk warning.
- `npm run typecheck:api` - passed.
- `npm run build:api` - passed.
- `AWS_PROFILE=nailnew AWS_REGION=us-east-1 APP_ORIGIN=https://app-new-nail.kendemo.com ./scripts/aws/ensure-connect-approved-origins.sh` - verifies the current account, instance, and Approved origins.
- `AWS_PROFILE=nailnew AWS_REGION=us-east-1 APP_ORIGIN=https://app-new-nail.kendemo.com FORCE_REAPPLY=true ./scripts/aws/ensure-connect-approved-origins.sh` - re-applies only the production app origin when CSP still blocks the iframe.

## Remaining Blockers

- No AWS CLI permission blockers were hit for Connect instance, Approved origins, queues, users, or routing profiles.
- The worktree was not clean before this pass. Pre-existing changes were present in `apps/api/prisma/seed.ts`, `fastaibooking-current-state.zip`, and Lex export JSON files; those were left untouched. This blocks commit/push under the prompt's stated criteria unless the user confirms how to handle the pre-existing changes.
- Server deploy was not run because commit/push is blocked by the pre-existing dirty worktree condition in the prompt.

## Manual Test Checklist

1. Login as `agent.demo@fastaibooking.local`.
2. Open `/call-center`.
3. Click `Open Amazon Connect CCP`.
4. Login direct CCP and set agent Available.
5. Make test call and ask for human operator.
6. Confirm queue item appears.
7. Accept/handle call.
8. Create customer if needed.
9. Create real appointment.
10. Complete call.
11. Confirm owner/staff dashboards still show data correctly.
