# Push notification API debugging

Register an Android FCM token:

```bash
curl -X POST "$BASE/api/v1/notifications/register" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fcmToken":"FCM_TOKEN_HERE","platform":"ANDROID","deviceId":"android_device_id"}'
```

Inspect safe notification state for the authenticated user:

```bash
curl "$BASE/api/v1/notifications/debug-me" \
  -H "Authorization: Bearer $TOKEN"
```

Create an inbox notification and send a backend test push:

```bash
curl -X POST "$BASE/api/v1/notifications/test-user" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"FastAIBooking test","body":"Backend push test","data":{"type":"test_notification"}}'
```
