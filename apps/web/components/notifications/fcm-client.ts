export type FcmRegistrationOutcome = "registered" | "unsupported" | "denied" | "failed";

export type FcmRegistrationResult = {
  outcome: FcmRegistrationOutcome;
  /* Stops the foreground `onMessage` listener; present once the listener was attached. */
  unsubscribe?: () => void;
};

export type RegisterFcmTokenOptions = {
  /**
   * Scope of an existing service worker registration to subscribe against — the PWA passes
   * `/pwa/`, whose Serwist worker shows the pushes. Omitted (the backoffice), the Firebase SDK
   * falls back to its own default worker, exactly as before this option existed.
   */
  serviceWorkerScope?: string;
  onForegroundMessage?: () => void;
  /* Checked between async steps, so an unmounted caller stops before writing a token. */
  isCancelled?: () => boolean;
};

const ACTIVATION_TIMEOUT_MS = 10_000;
const DELETE_TIMEOUT_MS = 3_000;

/**
 * Whether a token reached the server during this page session. Permission alone proves
 * nothing — the token can still have failed to register, or been deleted at a logout — so
 * the PWA reports push as on only once this is true.
 */
let registeredThisSession = false;
const registeredListeners = new Set<() => void>();

export function hasRegisteredFcmToken(): boolean {
  return registeredThisSession;
}

/** Calls `listener` the next time a token registers; returns the unsubscribe. */
export function onFcmTokenRegistered(listener: () => void): () => void {
  registeredListeners.add(listener);
  return () => {
    registeredListeners.delete(listener);
  };
}

function markRegistered(): void {
  registeredThisSession = true;
  for (const listener of Array.from(registeredListeners)) listener();
}

/**
 * A registration found on a first visit may still be installing, and `PushManager.subscribe`
 * refuses a registration with no active worker. Resolves false when it never activates in time.
 */
function waitForActiveWorker(reg: ServiceWorkerRegistration): Promise<boolean> {
  if (reg.active) return Promise.resolve(true);
  const pending = reg.installing ?? reg.waiting;
  if (!pending) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(Boolean(reg.active)), ACTIVATION_TIMEOUT_MS);
    pending.addEventListener("statechange", () => {
      if (pending.state === "activated") {
        clearTimeout(timer);
        resolve(true);
      } else if (pending.state === "redundant") {
        clearTimeout(timer);
        resolve(Boolean(reg.active));
      }
    });
  });
}

/**
 * Gets this device's FCM token and stores it on the signed-in user through
 * `/api/notifications/register`, so the server can push to it via Firebase Admin.
 *
 * Never asks for notification permission itself beyond what `getToken` does on its own: the
 * backoffice relies on that implicit prompt today, while the PWA calls this only once permission
 * is already granted (on load) or right after an explicit button press.
 */
export async function registerFcmToken(opts: RegisterFcmTokenOptions = {}): Promise<FcmRegistrationResult> {
  const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN;
  const storageBucket = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET;
  const messagingSenderId = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID;

  if (!vapidKey || !apiKey || !projectId || !appId) return { outcome: "unsupported" };

  const cancelled = () => opts.isCancelled?.() ?? false;
  let unsubscribe: (() => void) | undefined;

  try {
    let serviceWorkerRegistration: ServiceWorkerRegistration | undefined;
    if (opts.serviceWorkerScope !== undefined) {
      if (!("serviceWorker" in navigator)) return { outcome: "unsupported" };
      /* No registration in dev: Serwist only builds the worker for production. */
      const reg = await navigator.serviceWorker.getRegistration(opts.serviceWorkerScope);
      if (!reg) return { outcome: "unsupported" };
      if (!(await waitForActiveWorker(reg))) return { outcome: "failed" };
      serviceWorkerRegistration = reg;
    }

    const { getApp, getApps, initializeApp } = await import("firebase/app");
    const { getMessaging, getToken, onMessage, isSupported } = await import("firebase/messaging");

    const supported = await isSupported();
    if (!supported || cancelled()) return { outcome: "unsupported" };

    const app =
      getApps().length > 0
        ? getApp()
        : initializeApp({
            apiKey,
            authDomain: authDomain ?? `${projectId}.firebaseapp.com`,
            projectId,
            storageBucket: storageBucket ?? `${projectId}.appspot.com`,
            messagingSenderId,
            appId,
          });

    const messaging = getMessaging(app);

    const onForegroundMessage = opts.onForegroundMessage;
    if (onForegroundMessage) {
      unsubscribe = onMessage(messaging, () => onForegroundMessage());
    }

    if (Notification.permission === "denied") return { outcome: "denied", unsubscribe };

    const token = await getToken(
      messaging,
      serviceWorkerRegistration ? { vapidKey, serviceWorkerRegistration } : { vapidKey },
    );
    if (!token || cancelled()) return { outcome: "failed", unsubscribe };

    const res = await fetch("/api/notifications/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) return { outcome: "failed", unsubscribe };
    markRegistered();
    return { outcome: "registered", unsubscribe };
  } catch {
    /* Permission refused inside getToken, or FCM unreachable. */
    return { outcome: "failed", unsubscribe };
  }
}

async function deleteTokenIfInitialised(): Promise<void> {
  const { getApp, getApps } = await import("firebase/app");
  if (getApps().length === 0) return;
  const { deleteToken, getMessaging, isSupported } = await import("firebase/messaging");
  if (!(await isSupported())) return;
  await deleteToken(getMessaging(getApp()));
}

/**
 * Unsubscribes this device's FCM token at logout, so FCM stops delivering to it even before
 * the server row is cleared. Best-effort: only when this page already initialised Firebase,
 * never throws, and gives up after a few seconds so an offline phone still logs out.
 */
export async function deleteFcmToken(): Promise<void> {
  registeredThisSession = false;
  try {
    await Promise.race([
      deleteTokenIfInitialised(),
      new Promise<void>((resolve) => setTimeout(resolve, DELETE_TIMEOUT_MS)),
    ]);
  } catch {
    /* Nothing to undo: the server-side sign-out clears the user's token regardless. */
  }
}
