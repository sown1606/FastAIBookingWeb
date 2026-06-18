# Firebase Cloud Messaging Notifications

FastAIBooking uses one Firebase Cloud Messaging token API for Web, iOS, and Android.

## Backend Setup

1. Put the Firebase Admin SDK JSON at:

   ```sh
   secrets/firebase/fastaibooking-firebase-adminsdk.json
   ```

2. For local API runs, set:

   ```sh
   FIREBASE_SERVICE_ACCOUNT_PATH=/Users/macbookpro/Desktop/fastAibooking/secrets/firebase/fastaibooking-firebase-adminsdk.json
   ```

3. For Docker Compose, the API mounts `./secrets/firebase` at `/run/secrets/firebase` and defaults to:

   ```sh
   FIREBASE_SERVICE_ACCOUNT_PATH=/run/secrets/firebase/fastaibooking-firebase-adminsdk.json
   ```

4. Optional fallback if a file mount is not available:

   ```sh
   FIREBASE_SERVICE_ACCOUNT_JSON_BASE64=<base64-encoded service account JSON>
   ```

If no Firebase credential is available, the API starts normally and push sends are skipped.

## Web Setup

The owner app uses these Vite build variables:

```sh
VITE_FIREBASE_API_KEY
VITE_FIREBASE_AUTH_DOMAIN
VITE_FIREBASE_PROJECT_ID
VITE_FIREBASE_STORAGE_BUCKET
VITE_FIREBASE_MESSAGING_SENDER_ID
VITE_FIREBASE_APP_ID
VITE_FIREBASE_VAPID_KEY
```

Docker Compose passes the current project values as build args. For non-Compose builds, provide the same variables before running `npm run build:app`.

## Notification API

All token endpoints require an authenticated owner, staff member, or call-center user.

Register or refresh a token:

```http
POST /api/v1/notifications/register-token
Authorization: Bearer <access_token>
Content-Type: application/json
```

Android:

```json
{
  "token": "firebase_token_here",
  "platform": "android"
}
```

iOS:

```json
{
  "token": "firebase_token_here",
  "platform": "ios"
}
```

Web:

```json
{
  "token": "firebase_token_here",
  "platform": "web"
}
```

Unregister on logout:

```http
POST /api/v1/notifications/unregister-token
Authorization: Bearer <access_token>
Content-Type: application/json
```

```json
{
  "token": "firebase_token_here",
  "platform": "android"
}
```

The canonical field is `token`. For backward compatibility, the API accepts `fcmToken` only when `token` is absent. Platform values are case-insensitive and stored as `web`, `ios`, or `android`. Unknown platform values return HTTP 400. `deviceId` is not required or stored and is ignored if sent.

There is no `/api/v1/devices/fcm-token` endpoint.

Notification inbox routes:

- `GET /api/v1/notifications/inbox?limit=10`
- `GET /api/v1/notifications/unread-count`
- `POST /api/v1/notifications/:id/read`
- `POST /api/v1/notifications/read-all`

## Mobile Integration

- Android initializes Firebase using `google-services.json`.
- iOS initializes Firebase using `GoogleService-Info.plist`.
- After login or registration succeeds, get the FCM token from the Firebase SDK and call `POST /api/v1/notifications/register-token`.
- When Firebase refreshes the token, call the same registration endpoint again.
- On logout, call `POST /api/v1/notifications/unregister-token`.
- Handle notification clicks using `data.url` when present, or route using related fields such as `data.appointmentId`, `data.escalationId`, and `data.salonId`.

The backend sends to every stored token for each target user, regardless of platform. Re-registering a token refreshes its user/platform association without creating a duplicate. Invalid or unregistered FCM tokens are deleted after Firebase reports them.

## Quick API Tests for Duy and Kien

Canonical request:

```bash
curl -X POST "$BASE_URL/api/v1/notifications/register-token" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "firebase_token_here",
    "platform": "android"
  }'
```

Optional backward-compatibility test:

```bash
curl -X POST "$BASE_URL/api/v1/notifications/register-token" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fcmToken": "firebase_token_here",
    "platform": "ANDROID",
    "deviceId": "android_device_id"
  }'
```

The compatibility request maps `fcmToken` to `token`, normalizes the platform to `android`, and ignores `deviceId`. New integrations must send `token`.

## Notification Payload

Firebase `data` values are strings. Event-specific messages include these fields where available:

- `type`
- `url`
- `appointmentId`
- `escalationId`
- `salonId`

The web service worker continues to navigate to `data.url`. Native apps can use the same URL or related IDs for deep-link routing.

## Docker Migration and Deploy

Run migrations through the Docker network so the API uses `postgres:5432`:

```bash
docker compose up -d postgres
docker compose run --rm api npm run prisma:migrate:deploy
docker compose up -d --build api app admin nginx
```

If the API container is already running:

```bash
docker compose exec api npm run prisma:migrate:deploy
```

No new migration is required for mobile token support. The existing `PushToken.platform` field stores `web`, `ios`, or `android`.

## Test Steps

1. Install dependencies and generate Prisma:

   ```sh
   npm install
   npm --prefix apps/api run prisma:generate
   ```

2. Apply existing Prisma migrations in the target database through Docker:

   ```sh
   docker compose up -d postgres
   docker compose run --rm api npm run prisma:migrate:deploy
   ```

3. Start the API and app, then sign in as a salon owner, staff member, or call-center agent.

4. Register a Web, iOS, or Android token and confirm the API stores a row in `PushToken` with a normalized platform.

5. Register the same token again and confirm it is updated rather than duplicated.

6. Create or update an appointment and confirm assigned staff plus owner receive push notifications with appointment deep-link data.

7. Create an operator queue escalation and confirm assigned call-center users receive a push notification with escalation deep-link data.

8. Log out and confirm the token is removed from `PushToken` on a best-effort basis.
