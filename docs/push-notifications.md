# Push Notifications

FastAIBooking supports browser push notifications through Firebase Cloud Messaging.
`docs/firebase-notifications.md` is the source of truth for Firebase credentials,
frontend build variables, local setup, and production verification.

## Current Implementation

- The API initializes Firebase Admin only when credentials are present.
- Missing Firebase credentials do not block API startup or inbox notification writes.
- Authenticated users can register and unregister web push tokens.
- Notification inbox routes are current-user scoped and support unread count, mark read, and mark all read.
- Foreground web notifications refresh the app notification count.
- Logout unregisters the browser token on a best-effort basis.

## Supported Roles

- `SALON_OWNER`
- `STAFF`
- `CALL_CENTER_AGENT`
- `OPERATOR`

## Relevant Routes

- `GET /api/v1/notifications/inbox`
- `GET /api/v1/notifications/unread-count`
- `POST /api/v1/notifications/register-token`
- `POST /api/v1/notifications/unregister-token`
- `POST /api/v1/notifications/:id/read`
- `POST /api/v1/notifications/read-all`

## Related Events

- Appointment updates notify salon owners and assigned staff.
- Call-center escalations notify assigned call-center users.
- Owner note updates notify assigned call-center users and active staff in the salon.
