# Mobile App API

Base URL: `https://api.aifastbooking.com`

Use `Accept-Language: vi-VN` by default. Every protected request uses:

```http
Authorization: Bearer <accessToken>
```

Successful responses use:

```json
{ "success": true, "message": "...", "data": {} }
```

Errors use:

```json
{ "success": false, "error": { "code": "ERROR_CODE", "message": "..." } }
```

When the API returns `401`, call `POST /api/v1/auth/refresh` with the stored `refreshToken`, replace both tokens from the response, then retry the original request once.

## Timezone Rule

Display appointment times in the salon timezone from `/api/v1/auth/me`, `/api/v1/salon/profile`, or `/api/v1/staff/me/profile`. The mobile app must send appointment `startTime` as a UTC ISO string. Business hours are salon-local, not device-local.

## Auth

### Public registration

The registration screen supports two paths without authentication:

1. Save a callback lead for the admin team.
2. Complete owner and salon registration. A card is optional at registration and can be added later from Billing.

Save a callback lead:

```http
POST /api/v1/auth/registration-callback
Content-Type: application/json

{
  "phone": "<US_E164_PHONE>",
  "fullName": "Anh Nguyen",
  "email": "anh@example.com",
  "note": "Please call after 3 PM"
}
```

Only `phone` is required. The response returns `id`, `status`, and `createdAt`. Platform admins can review and update these leads through `GET /api/v1/admin/registration-leads` and `PATCH /api/v1/admin/registration-leads/:id`.

AI-assisted registration guidance:

```http
POST /api/v1/auth/registration-assistant
Content-Type: application/json

{
  "messages": [
    { "role": "assistant", "text": "How can I help with registration?" },
    { "role": "user", "text": "I do not want to add a card yet." }
  ]
}
```

Send 1 to 10 messages; each message uses role `assistant` or `user`. This endpoint returns registration guidance only and never creates the account itself.

Registration billing configuration:

```http
GET /api/v1/billing/registration-config
```

This public endpoint returns the available plans, `ready`, `trialDays`, `requiredCardBrand`, and the Stripe `publishableKey` when configured.

Optional card setup before registration:

```http
POST /api/v1/billing/registration/setup-intent
Content-Type: application/json

{ "email": "owner@example.com", "planCode": "ai_reception" }
```

Confirm the returned Stripe `clientSecret` in the mobile Stripe SDK. If the SetupIntent succeeds, include both `setupIntentId` and `billingConsentAccepted: true` in `register-owner`. To defer payment, omit both fields.

Register an owner without a card:

```http
POST /api/v1/auth/register-owner
Content-Type: application/json

{
  "fullName": "New Owner",
  "email": "owner@example.com",
  "phone": "<US_E164_PHONE>",
  "password": "Owner123!",
  "planCode": "ai_reception",
  "salon": {
    "name": "New Nail Studio",
    "timezone": "America/New_York",
    "contactPhone": "<US_E164_PHONE>",
    "country": "US"
  }
}
```

Supported `planCode` values are `ai_reception` and `human_reception`. A deferred registration has subscription status `PENDING_PAYMENT`; the account can sign in immediately and should show a non-blocking reminder to add a payment method.

Owner login:

```http
POST /api/v1/auth/login-owner
Content-Type: application/json

{ "email": "owner.demo@fastaibooking.local", "password": "Owner123!" }
```

Staff login:

```http
POST /api/v1/auth/login-staff
Content-Type: application/json

{ "email": "staff.demo@fastaibooking.local", "password": "Staff123!" }
```

Call center/operator login:

```http
POST /api/v1/auth/login-call-center
Content-Type: application/json

{ "email": "agent.demo@fastaibooking.local", "password": "Agent123!" }
```

Other auth endpoints:

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/register-owner`
- `POST /api/v1/auth/registration-callback`
- `POST /api/v1/auth/registration-assistant`
- `POST /api/v1/auth/refresh` body `{ "refreshToken": "<refreshToken>" }`
- `POST /api/v1/auth/logout` body `{ "refreshToken": "<refreshToken>" }`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`
- `POST /api/v1/auth/change-password`

After login, store `data.accessToken` and `data.refreshToken`.

## Owner APIs

Dashboard/bootstrap data used by web:

- `GET /api/v1/appointments` - returns all appointments visible to the authenticated user when no query parameters are provided.
- `GET /api/v1/appointments?page=1&limit=20` - returns a paginated appointment page.
- `GET /api/v1/billing/usage?historyLimit=3`
- `GET /api/v1/staff?includeInactive=false`
- `GET /api/v1/services`
- `GET /api/v1/customers?page=1&limit=1`
- `GET /api/v1/salon/settings`
- `GET /api/v1/salon/profile`
- `PUT /api/v1/salon/settings`

Salon profile and settings:

- `GET /api/v1/salon/profile`
- `PUT /api/v1/salon/profile`
- `GET /api/v1/salon/settings`
- `PUT /api/v1/salon/settings`
- `GET /api/v1/business-hours`
- `PUT /api/v1/business-hours`
- `GET /api/v1/health/readiness`

Appointment reminder settings are part of `GET /api/v1/salon/settings` and `PUT /api/v1/salon/settings`:

```json
{
  "appointmentReminderMinutes": 60,
  "ownerUpcomingReminderEnabled": true
}
```

`appointmentReminderMinutes` accepts only `60`, `120`, or `180` and defaults to `60`. `ownerUpcomingReminderEnabled` defaults to `true`; set it to `false` when the owner does not want to receive the same upcoming-appointment notification that is sent to the assigned staff member. Updating the interval also reschedules pending, undelivered booking reminders.

Staff:

- `GET /api/v1/staff?includeInactive=true`
- `POST /api/v1/staff` with either `fullName` or `firstName`/`lastName`
- `PATCH /api/v1/staff/:id`
- `POST /api/v1/staff/:id/deactivate`
- `POST /api/v1/staff/:id/reactivate`
- `POST /api/v1/staff/:id/reset-access`
- `PATCH /api/v1/staff/:id/password`
- `DELETE /api/v1/staff/:id`
- `GET /api/v1/staff/:id/services`
- `PUT /api/v1/staff/:id/services`

Create staff with manual password:

```http
POST /api/v1/staff
Authorization: Bearer <ownerToken>
Content-Type: application/json

{
  "firstName": "Amy",
  "lastName": "Nguyen",
  "email": "amy.staff.demo@example.com",
  "phone": "+********0101",
  "password": "StaffDemo123!",
  "isActive": true
}
```

Create staff with generated password:

```http
POST /api/v1/staff
Authorization: Bearer <ownerToken>
Content-Type: application/json

{
  "firstName": "Kelly",
  "lastName": "Tran",
  "email": "kelly.staff.demo@example.com",
  "phone": "+********0102",
  "isActive": true
}
```

Staff create can include `password` for owner-provided setup or omit `password`; the backend generates a temporary password. Both modes hash the password, create/link a staff login, and send the login email plus password to the staff member. The response includes `passwordMode: "MANUAL"` or `"GENERATED"` and `emailSent`.

If `serviceIds` is omitted on create, active/bookable staff are auto-assigned to all active services. If `serviceIds` is present, it is the exact mapping. `serviceIds: []` creates no explicit service mapping for that staff.

Update staff with exact services:

```http
PATCH /api/v1/staff/:id
Authorization: Bearer <ownerToken>
Content-Type: application/json

{ "serviceIds": ["service-id-1"] }
```

Get staff service assignment:

```http
GET /api/v1/staff/:id/services
Authorization: Bearer <ownerToken>
```

Set staff service assignment:

```http
PUT /api/v1/staff/:id/services
Authorization: Bearer <ownerToken>
Content-Type: application/json

{ "serviceIds": ["service-id-1", "service-id-2"] }
```

Reset staff password manually:

```http
POST /api/v1/staff/:id/reset-access
Authorization: Bearer <ownerToken>
Content-Type: application/json

{ "password": "NewStaffPass123!", "sendEmail": true }
```

Reset staff password with generated temporary password:

```http
POST /api/v1/staff/:id/reset-access
Authorization: Bearer <ownerToken>
Content-Type: application/json

{ "sendEmail": true }
```

`sendEmail` defaults to `true`. The alias `PATCH /api/v1/staff/:id/password` accepts the same body and uses the same backend logic. If the staff has no linked user yet, reset-access creates or safely links the staff login before emailing the new password.

Delete staff:

```http
DELETE /api/v1/staff/:id
Authorization: Bearer <ownerToken>
```

Delete staff is appointment-history safe: it disables staff login, marks the staff inactive and non-bookable, removes staff-service mappings, and refreshes billing usage. Active staff lists exclude the deleted staff.

Response:

```json
{
  "staff": { "id": "...", "fullName": "...", "isBookable": true, "status": "ACTIVE" },
  "services": [
    {
      "id": "...",
      "name": "Gel Manicure",
      "durationMinutes": 45,
      "priceCents": 4500,
      "isActive": true,
      "assigned": true
    }
  ]
}
```

Services:

- `GET /api/v1/services`
- `GET /api/v1/services?includeInactive=true`
- `POST /api/v1/services`
- `PATCH /api/v1/services/:id`
- `POST /api/v1/services/:id/deactivate`
- `POST /api/v1/services/:id/activate`
- `DELETE /api/v1/services/:id`
- `PUT /api/v1/services/:id/staff` body `{ "staffIds": ["staff-id-1"] }`

`DELETE /api/v1/services/:id` is appointment-history safe: it marks the service inactive and removes service staff mappings. Default service lists exclude inactive/deleted services.

Customers:

- `GET /api/v1/customers?q=<query>&page=1&limit=20`
- `POST /api/v1/customers`
- `GET /api/v1/customers/:id`
- `GET /api/v1/customers/:id/appointments`

Appointments:

- `GET /api/v1/appointments`
- `GET /api/v1/appointments?page=1&limit=20`
- `GET /api/v1/appointments/:id`
- `POST /api/v1/appointments`
- `PATCH /api/v1/appointments/:id`
- `PATCH /api/v1/appointments/:id/reschedule`
- `PATCH /api/v1/appointments/:id/cancel`
- `POST /api/v1/appointments/:id/start`
- `POST /api/v1/appointments/:id/extend`
- `POST /api/v1/appointments/:id/done`

`GET /api/v1/appointments` returns all appointments visible to the authenticated user when no query parameters are provided. Add filters or explicit pagination to use paginated results; for example, `GET /api/v1/appointments?page=1&limit=20`.

Create appointment:

```json
{
  "customerId": "<customerId>",
  "staffId": "<staffId>",
  "serviceId": "<serviceId>",
  "startTime": "2026-06-24T13:00:00.000Z",
  "source": "MANUAL",
  "notes": "Mobile booking"
}
```

Availability:

- `GET /api/v1/availability/slots?staffId=<staffId>&serviceId=<serviceId>&date=YYYY-MM-DD&intervalMinutes=15`
- `POST /api/v1/availability/validate`

Messages:

- `GET /api/v1/messages/threads`
- `GET /api/v1/messages/staff/:staffId`
- `POST /api/v1/messages/staff/:staffId`

Alerts, calls, and AI logs:

- `GET /api/v1/alerts?page=1&limit=50`
- `POST /api/v1/alerts/:id/read`
- `GET /api/v1/calls?page=1&limit=50`
- `GET /api/v1/calls/:id`
- `GET /api/v1/ai/interactions`
- `GET /api/v1/ai/interactions/:id`
- `GET /api/v1/ai/interactions/export`
- `GET /api/v1/owner/salons/:salonId/ai-reception`
- `POST /api/v1/owner/salons/:salonId/ai-reception/generate-forwarding-code`
- `POST /api/v1/owner/salons/:salonId/ai-reception/mark-forwarding-tested`
- `GET /api/v1/owner/salons/:salonId/call-logs`

Billing:

- `GET /api/v1/billing/registration-config` - public registration plan and Stripe readiness.
- `POST /api/v1/billing/registration/setup-intent` - public optional card setup before owner registration.
- `POST /api/v1/billing/payment-method/setup-intent` - owner-only deferred card setup.
- `POST /api/v1/billing/payment-method/activate` - owner-only activation body `{ "setupIntentId": "seti_..." }`.
- `GET /api/v1/billing/subscription`
- `GET /api/v1/billing/usage?historyLimit=12`

## Staff APIs

Staff app bootstrap:

- `POST /api/v1/auth/login-staff`
- `GET /api/v1/auth/me`
- `GET /api/v1/staff/me/profile`
- `PUT /api/v1/staff/me/profile`
- `GET /api/v1/staff/me/services`
- `GET /api/v1/staff/me/reminders`
- `POST /api/v1/auth/change-password`

`GET /api/v1/staff/me/profile` includes `user`, `staff`, `salon`, `serviceIds`, and `assignedServices` for bootstrap.

`GET /api/v1/staff/me/reminders` returns pending reminder records for the authenticated staff member. Upcoming-booking push data uses `type: "appointment_upcoming_reminder"` with `appointmentId`, `salonId`, `staffId`, and `/appointments?appointmentId=...` as the URL.

Get assigned services:

```http
GET /api/v1/staff/me/services
Authorization: Bearer <staffToken>
```

Response:

```json
{
  "staff": { "id": "...", "fullName": "...", "isBookable": true, "status": "ACTIVE" },
  "services": [
    {
      "serviceId": "...",
      "id": "...",
      "name": "Gel Manicure",
      "description": "Gel polish manicure.",
      "durationMinutes": 45,
      "priceCents": 4500,
      "isActive": true
    }
  ]
}
```

Staff appointments:

- `GET /api/v1/appointments`
- `GET /api/v1/appointments/:id`
- `PATCH /api/v1/appointments/:id` with only `status` or `notes`
- `PATCH /api/v1/appointments/:id/cancel`
- `POST /api/v1/appointments/:id/start`
- `POST /api/v1/appointments/:id/extend`
- `POST /api/v1/appointments/:id/done`

Without query parameters, staff appointment list returns all appointments assigned to the authenticated staff user.
- `GET /api/v1/availability/slots`
- `POST /api/v1/availability/validate`

Staff messages:

- `GET /api/v1/messages/me`
- `POST /api/v1/messages/me`

## Operator / Call Center APIs

Authentication:

- `POST /api/v1/auth/login-call-center`
- `GET /api/v1/auth/me`

Runtime and assigned salons:

- `GET /api/v1/call-center/runtime`
- `GET /api/v1/call-center/salons`
- `GET /api/v1/call-center/salons/:salonId`
- `GET /api/v1/call-center/salons/:salonId/staff`
- `GET /api/v1/call-center/salons/:salonId/services`
- `GET /api/v1/call-center/salons/:salonId/customers?page=1&limit=100`
- `POST /api/v1/call-center/salons/:salonId/customers`
- `GET /api/v1/call-center/salons/:salonId/appointments`
- `POST /api/v1/call-center/salons/:salonId/appointments`
- `PATCH /api/v1/call-center/salons/:salonId/appointments/:appointmentId`
- `PATCH /api/v1/call-center/salons/:salonId/appointments/:appointmentId/reschedule`
- `PATCH /api/v1/call-center/salons/:salonId/appointments/:appointmentId/cancel`

Queue and live support:

- `GET /api/v1/call-center/queue?limit=50`
- `GET /api/v1/call-center/queue/match?phone=<phone>&contactId=<id>`
- `GET /api/v1/call-center/queue/:id`
- `POST /api/v1/call-center/queue/:id/accept`
- `PATCH /api/v1/call-center/queue/:id`
- `POST /api/v1/call-center/queue/:id/complete`
- `POST /api/v1/call-center/queue/:id/callback-request`
- `POST /api/v1/call-center/queue/:id/voicemail`
- `POST /api/v1/call-center/queue/:id/sms-fallback`

## Push Notifications

Call register-token after every login and whenever Firebase refreshes the token.

Android:

```http
POST /api/v1/notifications/register-token
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "token": "<FCM_TOKEN>", "platform": "android" }
```

iOS:

```json
{ "token": "<FCM_TOKEN>", "platform": "ios" }
```

Web:

```json
{ "token": "<FCM_TOKEN>", "platform": "web" }
```

Unregister on logout:

```http
POST /api/v1/notifications/unregister-token
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "token": "<FCM_TOKEN>", "platform": "android" }
```

The canonical field is `token`. The API temporarily accepts `fcmToken` when `token` is absent, but new mobile code must use `token`. Platform values are case-insensitive and normalized to `android`, `ios`, or `web`. `deviceId` is optional input and is ignored because it is not stored.

Mobile integration sequence:

1. Initialize Firebase with `google-services.json` on Android or `GoogleService-Info.plist` on iOS.
2. After login or registration succeeds, get the FCM token from the Firebase SDK.
3. Call `POST /api/v1/notifications/register-token`.
4. Call the same endpoint whenever Firebase refreshes the token.
5. Call `POST /api/v1/notifications/unregister-token` on logout.
6. Route notification clicks using `data.url` or related IDs such as `appointmentId`, `escalationId`, and `salonId`.

Inbox:

- `GET /api/v1/notifications/inbox?limit=10`
- `GET /api/v1/notifications/unread-count`
- `POST /api/v1/notifications/:id/read`
- `POST /api/v1/notifications/read-all`

Expected notification deep link data:

```json
{
  "type": "appointment_created",
  "appointmentId": "...",
  "salonId": "...",
  "staffId": "...",
  "url": "/appointments?appointmentId=..."
}
```

Sample FCM registration curl:

```bash
curl -X POST "$BASE_URL/api/v1/notifications/register-token" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "firebase_token_here",
    "platform": "android"
  }'
```

Optional compatibility test:

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

## Email Delivery Note

Gmail SMTP is configured through production `.env`; do not commit secrets.

```dotenv
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=<gmail>
SMTP_PASSWORD=<google-app-password>
SMTP_FROM_EMAIL=<gmail>
SMTP_FROM_NAME=FastAIBooking
```

Use a Gmail App Password, not the normal Gmail password.
