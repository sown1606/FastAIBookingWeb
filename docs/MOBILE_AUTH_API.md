# Mobile Auth API

Base path: `/api/v1/auth`

Send `Accept-Language` on app auth requests. Supported values are `vi`, `vi-VN`, `en`, and `en-US`; unsupported or missing values fall back to `vi-VN`.

## Endpoints

- `POST /register-owner`
- `POST /login`
- `POST /login-owner`
- `POST /login-staff`
- `POST /login-call-center`
- `GET /me`

## Register Owner

```http
POST /api/v1/auth/register-owner
Accept-Language: vi-VN
Content-Type: application/json
```

```json
{
  "fullName": "Linh Nguyen",
  "email": "linh@example.com",
  "phone": "+********0123",
  "password": "Password123!",
  "salon": {
    "name": "Linh Nails",
    "contactEmail": "linh@example.com",
    "contactPhone": "+********0123",
    "timezone": "America/New_York",
    "addressLine1": "123 Main St",
    "city": "Edison",
    "state": "NJ",
    "postalCode": "08817",
    "country": "US"
  }
}
```

## Login

```http
POST /api/v1/auth/login-owner
Accept-Language: en-US
Content-Type: application/json
```

```json
{
  "email": "linh@example.com",
  "password": "Password123!"
}
```

## Sample vi-VN Response

```json
{
  "success": true,
  "message": "Đăng nhập chủ salon thành công.",
  "data": {
    "user": {
      "id": "...",
      "email": "linh@example.com",
      "fullName": "Linh Nguyen",
      "role": "SALON_OWNER",
      "salonId": "...",
      "staffId": null,
      "language": "vi-VN"
    },
    "accessToken": "...",
    "refreshToken": "..."
  }
}
```

## Sample en-US Response

```json
{
  "success": true,
  "message": "Owner login successful.",
  "data": {
    "user": {
      "id": "...",
      "email": "linh@example.com",
      "fullName": "Linh Nguyen",
      "role": "SALON_OWNER",
      "salonId": "...",
      "staffId": null,
      "language": "en-US"
    },
    "accessToken": "...",
    "refreshToken": "..."
  }
}
```
