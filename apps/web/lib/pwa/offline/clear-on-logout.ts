import { pwaDb } from "./db";

/**
 * `photos` counts only pending and syncing visit photos; `failedPhotos` counts the
 * ones that exhausted their uploads, which have no pending screen and are the only
 * rows a user may discard from the logout dialog.
 */
export type UnsyncedCounts = {
  orders: number;
  photos: number;
  failedPhotos: number;
  completions: number;
};

const OFFLINE_URL_PATH = "/pwa/offline";
const PAGES_CACHE = "pwa-pages";

/**
 * Serwist names its precache `serwist-precache-v2-<scope>` and the legacy next-pwa
 * worker uses `workbox-precache-*`. Both hold only the built app shell (JS/CSS/icons),
 * never user data, and the next user needs them to open the app offline.
 */
const PRECACHE_PREFIXES = ["serwist-precache", "workbox-precache"];

export function countTotal(counts: UnsyncedCounts): number {
  return counts.orders + counts.photos + counts.failedPhotos + counts.completions;
}

/**
 * Logout is blocked while any offline queue holds a row, whatever its syncState.
 * "failedPhotosOnly" marks the one case the dialog can resolve itself: nothing but
 * failed visit photos remain, and they can be discarded there. Every other row waits
 * for a sync or a resolution on its own pending screen.
 */
export function logoutBlockReason(
  counts: UnsyncedCounts,
): "unsynced" | "failedPhotosOnly" | null {
  if (countTotal(counts) === 0) return null;
  if (counts.failedPhotos === countTotal(counts)) return "failedPhotosOnly";
  return "unsynced";
}

export async function countUnsynced(): Promise<UnsyncedCounts> {
  const [orders, photos, failedPhotos, completions] = await Promise.all([
    pwaDb.pendingOrders.count(),
    pwaDb.pendingPhotos.where("syncState").notEqual("failed").count(),
    pwaDb.pendingPhotos.where("syncState").equals("failed").count(),
    pwaDb.pendingCompletions.count(),
  ]);
  return { orders, photos, failedPhotos, completions };
}

/**
 * Deletes only the failed visit photo rows, in one transaction, and returns how many
 * went. Pending and syncing photos are untouched: they may still upload.
 */
export async function discardFailedPhotos(): Promise<number> {
  return pwaDb.transaction("rw", pwaDb.pendingPhotos, () =>
    pwaDb.pendingPhotos.where("syncState").equals("failed").delete(),
  );
}

/**
 * Visit photos have no queue screen of their own; they retry from the store page.
 * Failed rows are skipped: they are discarded in the dialog, not reviewed there.
 */
export async function firstPendingPhotoStoreId(): Promise<string | null> {
  const rows = await pwaDb.pendingPhotos
    .where("syncState")
    .notEqual("failed")
    .sortBy("capturedAt");
  return rows[0]?.storeId ?? null;
}

/**
 * Counts the three PWA queues and empties them in ONE transaction, so a row enqueued
 * between a caller's earlier read and this clear can never be deleted silently: if any
 * row exists the transaction writes nothing and this returns "blocked", and the caller
 * re-reads the counts and shows the dialog again. Only on "cleared" does it drop every
 * service-worker cache except the precache (rule above). `pwa-pages` is emptied rather
 * than deleted because the worker precaches the offline fallback page into it once, at
 * install, so that single entry has to survive for the next user's offline navigations.
 */
export async function clearOfflineState(): Promise<"cleared" | "blocked"> {
  const blocked = await pwaDb.transaction(
    "rw",
    pwaDb.pendingOrders,
    pwaDb.pendingPhotos,
    pwaDb.pendingCompletions,
    async () => {
      const [orders, photos, completions] = await Promise.all([
        pwaDb.pendingOrders.count(),
        pwaDb.pendingPhotos.count(),
        pwaDb.pendingCompletions.count(),
      ]);
      if (orders + photos + completions > 0) return true;
      await Promise.all([
        pwaDb.pendingOrders.clear(),
        pwaDb.pendingPhotos.clear(),
        pwaDb.pendingCompletions.clear(),
      ]);
      return false;
    },
  );
  if (blocked) return "blocked";

  if (typeof caches === "undefined") return "cleared";

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
  return "cleared";
}
