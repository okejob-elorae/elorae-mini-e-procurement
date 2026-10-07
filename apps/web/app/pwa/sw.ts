import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { ExpirationPlugin, NetworkFirst, Serwist, StaleWhileRevalidate } from "serwist";
import { parsePushPayload } from "../../lib/pwa/push-payload";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const OFFLINE_URL = "/pwa/offline";
const PAGES_CACHE = "pwa-pages";

// Precache the offline fallback at install (the SW installs while online).
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PAGES_CACHE).then((cache) => cache.add(OFFLINE_URL)).catch(() => {}),
  );
});

// NetworkFirst for /pwa page navigations + RSC fetches: fresh when online (≤3s),
// last-seen from cache when offline; on total miss, serve the offline page.
const pagesStrategy = new NetworkFirst({
  cacheName: PAGES_CACHE,
  networkTimeoutSeconds: 3,
  plugins: [
    new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 7 }),
    {
      handlerDidError: async ({ request }) =>
        request.destination === "document"
          ? (await caches.open(PAGES_CACHE)).match(OFFLINE_URL)
          : Response.error(),
    },
  ],
});

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url }) => url.pathname === "/pwa/api/catalog",
      handler: new StaleWhileRevalidate({ cacheName: "pwa-catalog" }),
    },
    {
      // App-Router RSC fetches (soft <Link> navigation) under /pwa
      matcher: ({ request, url }) =>
        url.pathname.startsWith("/pwa") &&
        (request.headers.get("RSC") === "1" || url.searchParams.has("_rsc")),
      handler: pagesStrategy,
    },
    {
      // Full document navigations under /pwa (hard loads, back/forward)
      matcher: ({ request, url }) => request.mode === "navigate" && url.pathname.startsWith("/pwa"),
      handler: pagesStrategy,
    },
    ...defaultCache,
  ],
});

/**
 * FCM push for the PWA, handled here rather than by a Firebase messaging service worker: two
 * service workers cannot share the `/pwa/` scope, and the PWA obtains its FCM token against this
 * registration. Every push MUST show a notification (Chrome's `userVisibleOnly` contract), so an
 * unreadable payload still shows a generic one.
 */
self.addEventListener("push", (event) => {
  let raw: unknown = null;
  try {
    raw = event.data?.json() ?? null;
  } catch {
    raw = null;
  }
  const payload = parsePushPayload(raw);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "/pwa/icon-192.png",
      data: { url: payload.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data as { url?: unknown } | null;
  const url = typeof data?.url === "string" ? data.url : "/pwa/notifications";
  event.waitUntil(openPushTarget(url));
});

/* Reuses an open PWA window when there is one, else opens a new one. */
async function openPushTarget(url: string): Promise<void> {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const pwaWindow = windows.find((client) => new URL(client.url).pathname.startsWith("/pwa"));
  if (pwaWindow) {
    try {
      const focused = await pwaWindow.focus();
      await focused.navigate(url);
      return;
    } catch {
      /* navigate() refuses a window this worker does not control; open a fresh one instead. */
    }
  }
  await self.clients.openWindow(url);
}

serwist.addEventListeners();
