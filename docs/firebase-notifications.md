# Firebase Cloud Messaging Notifications

FastAIBooking supports browser push notifications through Firebase Cloud Messaging.

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

## Frontend Setup

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

## Test Steps

1. Install dependencies and generate Prisma:

   ```sh
   npm install
   npm --prefix apps/api run prisma:generate
   ```

2. Apply the Prisma migration in the target database:

   ```sh
   npm --prefix apps/api run prisma:migrate:deploy
   ```

3. Start the API and owner app, then sign in as a salon owner, staff member, or call-center agent.

4. Accept the browser notification permission prompt. Confirm the API stores a row in `PushToken`.

5. Create or update an appointment and confirm assigned staff plus owner receive push notifications.

6. Create an operator queue escalation and confirm assigned call-center users receive a push notification.

7. Log out and confirm the token is removed from `PushToken` on a best-effort basis.
