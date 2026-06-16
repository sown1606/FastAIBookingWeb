# Mobile App API

Base URL: `https://api-new-nail.kendemo.com`

Use `Accept-Language: vi-VN` for Vietnamese default API messages.

## Auth Flow

Staff login:

```http
POST /api/v1/auth/login-staff
Accept-Language: vi-VN
Content-Type: application/json

{ "email": "...", "password": "..." }
```

Owner login:

```http
POST /api/v1/auth/login-owner
Accept-Language: vi-VN
Content-Type: application/json

{ "email": "...", "password": "..." }
```

After login, store:

- `data.accessToken`
- `data.refreshToken`

Every protected request must include:

```http
Authorization: Bearer <accessToken>
```

Refresh tokens with:

```http
POST /api/v1/auth/refresh
Content-Type: application/json

{ "refreshToken": "<refreshToken>" }
```

Change password:

```http
POST /api/v1/auth/change-password
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "currentPassword": "...", "newPassword": "..." }
```

Current user:

```http
GET /api/v1/auth/me
Authorization: Bearer <accessToken>
```

## Push Notifications

Call register-token after every successful login/token refresh and whenever Firebase returns a new token.

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

Notification APIs:

```http
GET /api/v1/notifications/inbox
GET /api/v1/notifications/unread-count
POST /api/v1/notifications/:id/read
POST /api/v1/notifications/read-all
```

Every notification request requires:

```http
Authorization: Bearer <accessToken>
```

Mark one notification read:

```http
POST /api/v1/notifications/<notificationId>/read
Authorization: Bearer <accessToken>
```

Mark all notifications read:

```http
POST /api/v1/notifications/read-all
Authorization: Bearer <accessToken>
```

Sample FCM registration curl:

```bash
curl -X POST "https://api-new-nail.kendemo.com/api/v1/notifications/register-token" \
  -H "Authorization: Bearer <accessToken>" \
  -H "Accept-Language: vi-VN" \
  -H "Content-Type: application/json" \
  -d '{ "token": "<FCM_TOKEN>", "platform": "android" }'
```

## Staff App APIs

Profile:

```http
GET /api/v1/staff/me/profile
PUT /api/v1/staff/me/profile
```

Update profile body:

```json
{ "fullName": "Staff Name", "phone": "(212) 555-0100", "avatarUrl": "https://..." }
```

Reminders:

```http
GET /api/v1/staff/me/reminders
```

Appointments assigned to staff:

```http
GET /api/v1/appointments
```

Staff can update status or notes on assigned appointments:

```http
PATCH /api/v1/appointments/:id

{ "status": "CONFIRMED", "notes": "..." }
```

Availability:

```http
GET /api/v1/availability/slots?staffId=<staffId>&serviceId=<serviceId>&date=YYYY-MM-DD&intervalMinutes=15
```

Validate a slot:

```http
POST /api/v1/availability/validate
Content-Type: application/json

{
  "staffId": "<staffId>",
  "serviceId": "<serviceId>",
  "startTime": "2026-06-17T15:00:00.000Z"
}
```

For staff users, `staffId` must be their own staff profile id.

## Owner App APIs

Salon profile:

```http
GET /api/v1/salon/profile
PATCH /api/v1/salon/profile
GET /api/v1/salon/settings
PATCH /api/v1/salon/settings
```

Staff:

```http
GET /api/v1/staff?includeInactive=true
POST /api/v1/staff
PATCH /api/v1/staff/:id
POST /api/v1/staff/:id/reset-access
POST /api/v1/staff/:id/deactivate
POST /api/v1/staff/:id/reactivate
```

Create staff login:

```json
{
  "fullName": "Staff Name",
  "email": "staff@example.com",
  "phone": "(212) 555-0100",
  "createLogin": true
}
```

When `createLogin` is true and no `password` is sent, the API generates a temporary password and returns:

```json
{
  "data": {
    "invitation": {
      "email": "staff@example.com",
      "temporaryPassword": "..."
    }
  }
}
```

Services:

```http
GET /api/v1/services
POST /api/v1/services
PATCH /api/v1/services/:id
POST /api/v1/services/:id/deactivate
POST /api/v1/services/:id/reactivate
```

Business hours:

```http
GET /api/v1/business-hours
PUT /api/v1/business-hours
```

Customers:

```http
GET /api/v1/customers
POST /api/v1/customers
PATCH /api/v1/customers/:id
```

Appointments:

```http
GET /api/v1/appointments
POST /api/v1/appointments
PATCH /api/v1/appointments/:id
POST /api/v1/appointments/:id/reschedule
POST /api/v1/appointments/:id/cancel
```

Availability and notifications use the same endpoints as above.

## Email Delivery

Gmail SMTP production env:

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

Local smoke test:

```bash
npm --prefix apps/api run email:test -- --to <test-email>
```

The deploy script does not sync `.env`. Keep production `.env` on the EC2 app path in sync through SSH without committing secrets.
