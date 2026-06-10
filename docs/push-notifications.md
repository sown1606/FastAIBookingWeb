# Push Notifications Status

FastAIBooking does not currently configure Firebase Cloud Messaging or browser push tokens.
The API exposes this intentionally as `PUSH_NOTIFICATIONS_NOT_CONFIGURED` in `/health/readiness` and `/api/v1/health/readiness`.

## Environment variables for a future Firebase setup

- `FIREBASE_SERVICE_ACCOUNT_JSON`, or all of:
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_WEB_PUSH_VAPID_KEY`

## Implementation steps when ready

1. Add `firebase-admin` to `apps/api` and initialize it only when the Firebase env vars are present.
2. Add a Prisma model for user/browser push tokens with user id, token, platform, created time, and last seen time.
3. Add authenticated endpoints to register and unregister web push tokens.
4. Add frontend registration behind an explicit user action only; do not request notification permission on page load.
5. Send push notifications for these events after existing SMS/email/alert behavior succeeds or is queued:
   - new AI booking created
   - call center escalation queued
   - appointment canceled or rescheduled
   - urgent alert created
6. Keep health output non-crashing when Firebase env vars are missing.
