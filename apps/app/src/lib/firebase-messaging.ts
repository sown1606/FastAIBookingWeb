import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type MessagePayload,
  type Messaging
} from "firebase/messaging";
import { apiPost } from "./api";

type ForegroundMessageHandler = (payload: MessagePayload) => void;

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const firebaseVapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
const serviceWorkerPath = "/firebase-messaging-sw.js";

let firebaseApp: FirebaseApp | null = null;
let messagingPromise: Promise<Messaging | null> | null = null;
let serviceWorkerRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
let registerTokenPromise: Promise<string | null> | null = null;
let activeToken: string | null = null;
let foregroundUnsubscribe: (() => void) | null = null;
let foregroundHandler: ForegroundMessageHandler | null = null;

const isFirebaseConfigured = (): boolean => {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.messagingSenderId &&
      firebaseConfig.appId &&
      firebaseVapidKey
  );
};

const getFirebaseApp = (): FirebaseApp | null => {
  if (!isFirebaseConfigured()) {
    return null;
  }
  if (firebaseApp) {
    return firebaseApp;
  }

  firebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);
  return firebaseApp;
};

const getMessagingInstance = async (): Promise<Messaging | null> => {
  if (messagingPromise) {
    return messagingPromise;
  }

  messagingPromise = (async () => {
    if (!isFirebaseConfigured() || !("Notification" in window)) {
      return null;
    }

    const supported = await isSupported();
    const app = getFirebaseApp();
    return supported && app ? getMessaging(app) : null;
  })();

  return messagingPromise;
};

const getServiceWorkerRegistration = async (): Promise<ServiceWorkerRegistration | null> => {
  if (serviceWorkerRegistrationPromise) {
    return serviceWorkerRegistrationPromise;
  }

  serviceWorkerRegistrationPromise = (async () => {
    if (!("serviceWorker" in navigator)) {
      return null;
    }
    return navigator.serviceWorker.register(serviceWorkerPath);
  })();

  return serviceWorkerRegistrationPromise;
};

const requestNotificationPermission = async (): Promise<boolean> => {
  if (!("Notification" in window)) {
    return false;
  }
  if (Notification.permission === "granted") {
    return true;
  }
  if (Notification.permission === "denied") {
    return false;
  }

  return (await Notification.requestPermission()) === "granted";
};

export const registerFirebaseMessagingToken = async (): Promise<string | null> => {
  if (registerTokenPromise) {
    return registerTokenPromise;
  }

  registerTokenPromise = (async () => {
    try {
      const permissionGranted = await requestNotificationPermission();
      if (!permissionGranted) {
        return null;
      }

      const [messaging, serviceWorkerRegistration] = await Promise.all([
        getMessagingInstance(),
        getServiceWorkerRegistration()
      ]);
      if (!messaging || !serviceWorkerRegistration) {
        return null;
      }

      const token = await getToken(messaging, {
        vapidKey: firebaseVapidKey,
        serviceWorkerRegistration
      });
      if (!token) {
        return null;
      }

      await apiPost<
        { registered: boolean; id: string },
        { token: string; fcmToken: string; platform: string }
      >(
        "/api/v1/notifications/register-token",
        {
          token,
          fcmToken: token,
          platform: "web"
        }
      );
      activeToken = token;
      return token;
    } catch {
      return null;
    } finally {
      registerTokenPromise = null;
    }
  })();

  return registerTokenPromise;
};

export const subscribeToForegroundMessages = async (
  handler: ForegroundMessageHandler
): Promise<void> => {
  foregroundHandler = handler;
  if (foregroundUnsubscribe) {
    return;
  }

  const messaging = await getMessagingInstance();
  if (!messaging) {
    return;
  }

  foregroundUnsubscribe = onMessage(messaging, (payload) => {
    foregroundHandler?.(payload);
  });
};

export const stopForegroundMessages = (): void => {
  foregroundHandler = null;
  foregroundUnsubscribe?.();
  foregroundUnsubscribe = null;
};

export const unregisterFirebaseMessagingToken = async (): Promise<void> => {
  try {
    const messaging = await getMessagingInstance();
    if (!messaging || Notification.permission !== "granted") {
      activeToken = null;
      return;
    }

    const serviceWorkerRegistration = await getServiceWorkerRegistration();
    const token =
      activeToken ??
      (serviceWorkerRegistration
        ? await getToken(messaging, {
            vapidKey: firebaseVapidKey,
            serviceWorkerRegistration
          })
        : null);

    if (token) {
      await apiPost<{ unregistered: boolean }, { token: string; platform: string }>(
        "/api/v1/notifications/unregister-token",
        {
          token,
          platform: "web"
        }
      ).catch(() => undefined);
    }

    await deleteToken(messaging).catch(() => undefined);
    activeToken = null;
  } catch {
    activeToken = null;
  }
};
