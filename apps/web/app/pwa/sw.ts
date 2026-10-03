import { defaultCache } from "@serwist/next/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { ExpirationPlugin, NetworkFirst, Serwist, StaleWhileRevalidate } from "serwist";
// Jalur relatif, bukan alias `@/`: service worker dibangun penyusun anak Serwist.
import { tautanKabar } from "../../lib/notifications/tautan-kabar";

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

/*
 * Pemberitahuan di HP (FCM). Firebase SDK TIDAK dipasang di service worker ini
 * (tidak ada `firebase-messaging-sw.js`), jadi pesannya ditampilkan sendiri.
 * FCM mengirim `{ notification: { title, body }, data: { type, ...id } }`.
 * Setiap push WAJIB menampilkan pemberitahuan — iPhone mencabut langganan
 * aplikasi yang menerima push tanpa menampilkan apa pun.
 */
type PesanPush = { notification?: { title?: string; body?: string }; data?: Record<string, string> };

self.addEventListener("push", (event) => {
  let pesan: PesanPush = {};
  try {
    pesan = (event.data?.json() as PesanPush) ?? {};
  } catch {
    pesan = {};
  }
  const data = pesan.data ?? {};
  const judul = pesan.notification?.title || data.title || "Elorae";
  const isi = pesan.notification?.body || data.body || "";
  event.waitUntil(
    self.registration.showNotification(judul, {
      body: isi,
      icon: "/pwa/icon-192.png",
      badge: "/pwa/icon-192.png",
      data,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = (event.notification.data ?? {}) as Record<string, string>;
  const tujuan = (data.type ? tautanKabar(data.type, data) : null) ?? "/pwa/kabar";
  event.waitUntil(
    (async () => {
      const jendela = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const j of jendela) {
        if (new URL(j.url).pathname.startsWith("/pwa")) {
          await j.navigate(tujuan).catch(() => null);
          await j.focus().catch(() => null);
          return;
        }
      }
      await self.clients.openWindow(tujuan);
    })(),
  );
});

serwist.addEventListeners();
