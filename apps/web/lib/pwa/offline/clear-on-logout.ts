import { pwaDb } from "./db";

export type UnsyncedCounts = { orders: number; photos: number; completions: number };

const OFFLINE_URL_PATH = "/pwa/offline";
const PAGES_CACHE = "pwa-pages";

/**
 * Serwist names its precache `serwist-precache-v2-<scope>` and the legacy next-pwa
 * worker uses `workbox-precache-*`. Both hold only the built app shell (JS/CSS/icons),
 * never user data, and the next user needs them to open the app offline.
 */
const PRECACHE_PREFIXES = ["serwist-precache", "workbox-precache"];

export function countTotal(counts: UnsyncedCounts): number {
  return counts.orders + counts.photos + counts.completions;
}

/**
 * Logout is blocked while any offline queue holds a row, whatever its syncState:
 * pending and syncing rows have not reached the server, and failed rows still
 * await a retry or a manual resolution on their pending screen.
 */
export function logoutBlockReason(counts: UnsyncedCounts): "unsynced" | null {
  return countTotal(counts) > 0 ? "unsynced" : null;
}

export async function countUnsynced(): Promise<UnsyncedCounts> {
  const [orders, photos, completions] = await Promise.all([
    pwaDb.pendingOrders.count(),
    pwaDb.pendingPhotos.count(),
    pwaDb.pendingCompletions.count(),
  ]);
  return { orders, photos, completions };
}

/** Visit photos have no queue screen of their own; they retry from the store page. */
export async function firstPendingPhotoStoreId(): Promise<string | null> {
  const row = await pwaDb.pendingPhotos.orderBy("capturedAt").first();
  return row?.storeId ?? null;
}

/**
 * Empties the three PWA queues in one transaction, then drops every service-worker
 * cache except the precache (rule above). `pwa-pages` is emptied rather than deleted
 * because the worker precaches the offline fallback page into it once, at install,
 * so that single entry has to survive for the next user's offline navigations.
 */
export async function clearOfflineState(): Promise<void> {
  await pwaDb.transaction(
    "rw",
    pwaDb.pendingOrders,
    pwaDb.pendingPhotos,
    pwaDb.pendingCompletions,
    async () => {
      await Promise.all([
        pwaDb.pendingOrders.clear(),
        pwaDb.pendingPhotos.clear(),
        pwaDb.pendingCompletions.clear(),
      ]);
    },
  );

  if (typeof caches === "undefined") return;

  const names = await caches.keys();
  await Promise.all(
    names.map(async (name) => {
      if (PRECACHE_PREFIXES.some((prefix) => name.startsWith(prefix))) return;
      if (name === PAGES_CACHE) {
        const cache = await caches.open(name);
        const requests = await cache.keys();
        await Promise.all(
          requests
            .filter((request) => new URL(request.url).pathname !== OFFLINE_URL_PATH)
            .map((request) => cache.delete(request)),
        );
        return;
      }
      await caches.delete(name);
    }),
  );
}
