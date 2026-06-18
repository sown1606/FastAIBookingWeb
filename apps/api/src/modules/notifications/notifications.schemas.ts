import { z } from "zod";

const normalizeTokenAlias = (value: unknown): unknown => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  const input = value as Record<string, unknown>;
  if (input.token !== undefined) {
    return input;
  }

  return {
    ...input,
    token: input.fcmToken
  };
};

const pushPlatformSchema = z.preprocess(
  (value) => {
    if (value === undefined) {
      return "web";
    }
    return typeof value === "string" ? value.trim().toLowerCase() : value;
  },
  z.enum(["web", "ios", "android"], {
    errorMap: () => ({
      message: 'platform must be one of "web", "ios", or "android".'
    })
  })
);

export const pushTokenSchema = z.preprocess(
  normalizeTokenAlias,
  z
    .object({
      token: z
        .string({
          required_error: "token is required."
        })
        .trim()
        .min(1, "token is required.")
        .max(4096, "token must contain at most 4096 characters."),
      platform: pushPlatformSchema
    })
    .strip()
);

export type PushTokenPayload = z.infer<typeof pushTokenSchema>;
