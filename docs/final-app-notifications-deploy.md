# Final App Notifications Deploy

Date: 2026-06-13

## Commit

- Commit pushed to `origin/main`: `005ffef`
- Message: `Polish operator UX and app notifications`

## Files changed

- `apps/api/src/modules/notifications/notifications.service.ts`
- `apps/api/src/modules/salon/salon.routes.ts`
- `apps/api/src/modules/salon/salon.service.ts`
- `apps/api/test/ai-internal.test.ts`
- `apps/api/test/role-guards.test.ts`
- `apps/app/src/pages/dashboard-page.tsx`
- `apps/app/src/pages/call-center-page.tsx`
- `apps/app/src/pages/salon-profile-page.tsx`
- `apps/app/src/lib/i18n.tsx`
- `apps/app/src/styles.css`
- `docs/amazon-connect.md`
- `docs/operator-ccp-aws-cli-pass.md`
- `docs/operator-ux-production-polish.md`
- `scripts/aws/ensure-connect-approved-origins.sh`

## Notification and owner-note results

- Added `GET /api/v1/salon/operator-note` for `SALON_OWNER` and `STAFF` before the owner-only salon route guard.
- Staff dashboard now shows `Ghi chú hôm nay từ chủ tiệm` read-only near the top.
- Owner note updates now create inbox/push notifications for assigned operators and active staff in the same salon.
- Operator note card in `/call-center` remains unchanged.
- Notification API route checks verified:
  - `/api/v1/notifications/inbox`
  - `/api/v1/notifications/unread-count`
  - `/api/v1/notifications/register-token`
  - `/api/v1/notifications/unregister-token`
  - `/api/v1/notifications/:id/read`
  - `/api/v1/notifications/read-all`

## Tests run

- `git diff --check` passed.
- `npm run typecheck:api` passed.
- `npm run build:api` passed.
- `npm run test:api` passed.
- `npm run typecheck:app` passed.
- `npm run build:app` passed.
- `npm run test:lambda` passed.

Notes:

- `npm run build:app` still reports the existing Vite large-chunk warning.
- No Prisma schema change was made, so local `prisma:generate` was not required. The deploy Docker build ran `npm run prisma:generate`.

## AWS approved origins result

Command:

```bash
AWS_PROFILE=nailnew AWS_REGION=us-east-1 APP_ORIGIN=https://app-new-nail.kendemo.com ./scripts/aws/ensure-connect-approved-origins.sh
```

Result:

- Amazon Connect instance: `fastaibooking` / `74f78377-766f-46b7-a745-4bc97b68a8dc`
- Already approved: `https://app-new-nail.kendemo.com`
- Already approved: `http://localhost:5173`
- CCP URL confirmed as `https://fastaibooking.my.connect.aws/ccp-v2/`

## Deploy result

Command:

```bash
./infra/scripts/deploy_remote_ec2.sh
```

Result:

- Remote Docker build completed for `admin`, `api`, and `app`.
- Deploy script ran Prisma migrations through `prisma migrate deploy`.
- Migration result: `No pending migrations to apply.`
- Production seed was not run.
- Containers restarted successfully.

## Health URLs

- `https://api-new-nail.kendemo.com/health/liveness`: HTTP 200, `status: ok`
- `https://api-new-nail.kendemo.com/health/readiness`: HTTP 200, `status: ready`
- Readiness integrations:
  - `amazonConnect.configured: true`
  - `amazonConnect.ready: true`
  - `amazonConnect.activeIntegrationConfigCount: 12`
  - `pushNotifications.configured: true`
  - `pushNotifications.ready: true`
  - `pushNotifications.status: configured`

## Container check

- `fastaibooking-api`: up and healthy
- `fastaibooking-app`: up
- `fastaibooking-admin`: up
- `fastaibooking-nginx`: up
- `fastaibooking-postgres`: up and healthy
- API logs showed successful `/health/liveness` and `/health/readiness` requests after deploy.

## Remaining blockers

- Manual browser smoke was not run by Codex because it requires authenticated owner, staff, and operator sessions.
- Verify foreground web push registration manually if push toasts do not appear, because readiness reports push notifications configured while still listing `FIREBASE_WEB_PUSH_VAPID_KEY` in the metadata.

## Manual smoke checklist

1. Login owner.
2. Edit `Ghi chú quan trọng cho operator/staff`.
3. Confirm save works.
4. Login staff.
5. Confirm staff dashboard shows note read-only.
6. Login operator.
7. Confirm `/call-center` shows note near top.
8. Open notification bell; confirm no overflow.
9. Create or change appointment; confirm owner/staff notification inbox updates.
10. Ask AI to transfer human; confirm operator notification inbox gets queue item.
11. Click notification; confirm it opens the correct page.
12. Create booking from operator.
13. Complete call.
14. Confirm no huge wait time like `5681 phút`.
