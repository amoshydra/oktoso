import type { HubClient } from "@amoshydra/oktoso-client";
import type { PushSubscription as HubPushSubscription } from "@amoshydra/oktoso-contracts";

const DEVICE_KEY = "oktoso-device-id";
const SUBSCRIPTION_KEY = "oktoso-push-subscription-id";

/** Register the shell worker after load. Production only: dev uses HMR. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return;
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .catch(() => undefined);
  });
}

export function pushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

/** Stable per-browser identity used to revoke one device's subscription. */
export function deviceID(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const next =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, next);
    return next;
  } catch {
    return "browser";
  }
}

export function deviceLabel(): string {
  const match = /(Android|iPhone|iPad|Macintosh|Windows|Linux)/.exec(
    navigator.userAgent,
  );
  return (match?.[1] ?? "Browser").slice(0, 80);
}

/**
 * Ask for permission, subscribe with the hub's VAPID key, and register the
 * subscription. Must be called from a user gesture.
 */
export async function enablePush(
  client: HubClient,
): Promise<HubPushSubscription | undefined> {
  if (!pushSupported()) {
    throw new Error("This browser does not support push notifications.");
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return undefined;

  const settings = await client.notificationSettings();
  if (!settings.applicationServerKey) {
    throw new Error("The hub has not enabled Web Push yet.");
  }

  const registration = await ensureRegistration();
  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64URL(settings.applicationServerKey),
    }));

  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) {
    throw new Error("The push subscription is missing its keys.");
  }

  const stored = await client.addPushSubscription({
    deviceID: deviceID(),
    label: deviceLabel(),
    endpoint: subscription.endpoint,
    keys: { p256dh, auth },
    expirationTime: subscription.expirationTime,
  });

  try {
    localStorage.setItem(SUBSCRIPTION_KEY, stored.id);
  } catch {
    // A private-mode storage failure must not break delivery.
  }
  return stored;
}

/** Remove this browser's subscription from the hub and the push service. */
export async function disablePush(client: HubClient): Promise<void> {
  const stored = readStoredSubscriptionID();
  if (stored) {
    await client.removePushSubscription(stored).catch(() => undefined);
  } else {
    // The local id was lost; fall back to this browser's device records.
    const mine = await client
      .notificationSubscriptions()
      .catch(() => [])
      .then((items) => items.filter((item) => item.deviceID === deviceID()));
    await Promise.all(
      mine.map((item) =>
        client.removePushSubscription(item.id).catch(() => undefined),
      ),
    );
  }

  try {
    localStorage.removeItem(SUBSCRIPTION_KEY);
  } catch {
    // Ignore storage failures.
  }

  const registration = await navigator.serviceWorker
    .getRegistration()
    .catch(() => undefined);
  const subscription = await registration?.pushManager
    .getSubscription()
    .catch(() => undefined);
  await subscription?.unsubscribe().catch(() => undefined);
}

function readStoredSubscriptionID(): string | undefined {
  try {
    return localStorage.getItem(SUBSCRIPTION_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

/** VAPID keys are URL-safe base64; PushManager wants raw bytes. */
export function decodeBase64URL(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
