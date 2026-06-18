import assert from "node:assert/strict";
import { test } from "node:test";
import { pushTokenSchema } from "../src/modules/notifications/notifications.schemas";

const token = "firebase_token_here";

test("push token schema accepts canonical tokens for every supported platform", () => {
  for (const platform of ["web", "ios", "android"] as const) {
    assert.deepEqual(pushTokenSchema.parse({ token, platform }), {
      token,
      platform
    });
  }
});

test("push token schema normalizes uppercase platform values", () => {
  assert.deepEqual(pushTokenSchema.parse({ token, platform: "ANDROID" }), {
    token,
    platform: "android"
  });
  assert.deepEqual(pushTokenSchema.parse({ token, platform: "IOS" }), {
    token,
    platform: "ios"
  });
  assert.deepEqual(pushTokenSchema.parse({ token, platform: "WEB" }), {
    token,
    platform: "web"
  });
});

test("push token schema maps fcmToken only when canonical token is absent", () => {
  assert.deepEqual(
    pushTokenSchema.parse({
      fcmToken: token,
      platform: "ANDROID",
      deviceId: "android-device-id"
    }),
    {
      token,
      platform: "android"
    }
  );

  assert.deepEqual(
    pushTokenSchema.parse({
      token,
      fcmToken: "ignored-firebase-token-with-enough-characters",
      platform: "ios"
    }),
    {
      token,
      platform: "ios"
    }
  );
});

test("push token schema rejects unknown platforms with a clear issue", () => {
  const result = pushTokenSchema.safeParse({
    token,
    platform: "windows"
  });

  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(
      result.error.issues[0]?.message,
      'platform must be one of "web", "ios", or "android".'
    );
  }
});
