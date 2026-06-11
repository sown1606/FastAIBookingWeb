import fs from "fs";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging, type Messaging } from "firebase-admin/messaging";
import type { ServiceAccount } from "firebase-admin";
import { env } from "../config/env";
import { logger } from "./logger";

interface RawFirebaseServiceAccount {
  projectId?: string;
  project_id?: string;
  clientEmail?: string;
  client_email?: string;
  privateKey?: string;
  private_key?: string;
}

let messaging: Messaging | null | undefined;

const normalizePrivateKey = (value?: string): string | undefined => {
  return value?.replace(/\\n/g, "\n");
};

const normalizeServiceAccount = (
  raw: RawFirebaseServiceAccount
): ServiceAccount | null => {
  const projectId = raw.projectId ?? raw.project_id;
  const clientEmail = raw.clientEmail ?? raw.client_email;
  const privateKey = normalizePrivateKey(raw.privateKey ?? raw.private_key);

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return {
    projectId,
    clientEmail,
    privateKey
  };
};

const parseServiceAccountJson = (rawJson: string): ServiceAccount | null => {
  const parsed = JSON.parse(rawJson) as RawFirebaseServiceAccount;
  return normalizeServiceAccount(parsed);
};

const loadServiceAccount = (): ServiceAccount | null => {
  if (env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    try {
      return parseServiceAccountJson(
        fs.readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8")
      );
    } catch {
      logger.warn(
        "Firebase service account path could not be loaded. Trying fallback credentials."
      );
    }
  }

  if (env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64) {
    try {
      return parseServiceAccountJson(
        Buffer.from(env.FIREBASE_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString("utf8")
      );
    } catch {
      logger.warn(
        "Firebase service account base64 payload could not be loaded. Trying fallback credentials."
      );
    }
  }

  if (env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      return parseServiceAccountJson(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    } catch {
      logger.warn("Firebase service account JSON could not be loaded.");
    }
  }

  return normalizeServiceAccount({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY
  });
};

export const getFirebaseMessaging = (): Messaging | null => {
  if (messaging !== undefined) {
    return messaging;
  }

  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) {
    messaging = null;
    return messaging;
  }

  try {
    const app =
      getApps()[0] ??
      initializeApp({
        credential: cert(serviceAccount)
      });
    messaging = getMessaging(app);
    return messaging;
  } catch {
    logger.warn("Firebase Admin initialization failed. Push notifications disabled.");
    messaging = null;
    return messaging;
  }
};
