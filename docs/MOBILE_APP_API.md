# Mobile App API

Base URL: `https://api-new-nail.kendemo.com`

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
- `POST /api/v1/auth/refresh` body `{ "refreshToken": "<refreshToken>" }`
- `POST /api/v1/auth/logout` body `{ "refreshToken": "<refreshToken>" }`
- `GET /api/v1/auth/me`
- `POST /api/v1/auth/forgot-password`
- `POST /api/v1/auth/reset-password`
- `POST /api/v1/auth/change-password`

After login, store `data.accessToken` and `data.refreshToken`.

## Owner APIs

Dashboard/bootstrap data used by web:

- `GET /api/v1/appointments?page=1&limit=20`
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

Staff:

- `GET /api/v1/staff?includeInactive=true`
- `POST /api/v1/staff`
- `PATCH /api/v1/staff/:id`
- `POST /api/v1/staff/:id/deactivate`
- `POST /api/v1/staff/:id/reactivate`
- `POST /api/v1/staff/:id/reset-access`
- `GET /api/v1/staff/:id/services`
- `PUT /api/v1/staff/:id/services`

Create staff with exact services:

```http
POST /api/v1/staff
Authorization: Bearer <ownerToken>
Content-Type: application/json

{
  "fullName": "Staff Name",
  "email": "staff@example.com",
  "phone": "(732) 555-0124",
  "isBookable": true,
  "createLogin": true,
  "serviceIds": ["service-id-1", "service-id-2"]
}
```

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
- `PUT /api/v1/services/:id/staff` body `{ "staffIds": ["staff-id-1"] }`

Customers:

- `GET /api/v1/customers?q=<query>&page=1&limit=20`
- `POST /api/v1/customers`
- `GET /api/v1/customers/:id`
- `GET /api/v1/customers/:id/appointments`

Appointments:

- `GET /api/v1/appointments?page=1&limit=100`
- `GET /api/v1/appointments/:id`
- `POST /api/v1/appointments`
- `PATCH /api/v1/appointments/:id`
- `PATCH /api/v1/appointments/:id/reschedule`
- `PATCH /api/v1/appointments/:id/cancel`
- `POST /api/v1/appointments/:id/start`
- `POST /api/v1/appointments/:id/extend`
- `POST /api/v1/appointments/:id/done`

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

{ "token": "<FCM_TOKEN>" }
```

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
curl -X POST "https://api-new-nail.kendemo.com/api/v1/notifications/register-token" \
  -H "Authorization: Bearer <accessToken>" \
  -H "Accept-Language: vi-VN" \
  -H "Content-Type: application/json" \
  -d '{ "token": "<FCM_TOKEN>", "platform": "android" }'
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
