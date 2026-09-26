import { prisma } from "@elorae/db";
import { createStoreStocktake } from "@/lib/stores/stocktake/writer";
import { StoreStocktakeError } from "@/lib/stores/stocktake/errors";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { capNotificationText } from "@/lib/notifications/text";
import { sendNotificationToUsers, type NotificationUser } from "@/lib/notifications/recipients";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { KONSI_COUNT_SYSTEM_ACTOR, type CountSchedule } from "./schedule";
import { getStoreCountState, readCountSchedule } from "./queries";
import { KONSI_COUNT_DUE, KONSI_COUNT_OVERDUE } from "./categories";

export type KonsiCountSweepResult = {
  scanned: number;
  opened: number;
  alreadyOpen: number;
  spgNotified: number;
  overdueAnnounced: number;
  failed: number;
};

/**
 * Wraps the SPG-facing push, because `sendNotificationToUsers` carries no VITEST guard of its own,
 * unlike `fanOutAdminNotification`. The guard is the first statement: without it a spec would write
 * real `NotificationQueue` rows on the shared bed and could push to real phones through the
 * `FIREBASE_ADMIN_*` credentials `vitest.config.ts` loads. Same shape as the overdue sweep's
 * collector push.
 */
async function notifySpgsOfCount(
  users: NotificationUser[],
  payload: { title: string; body: string; data: Record<string, string> },
): Promise<void> {
  if (process.env.VITEST) return;
  await sendNotificationToUsers(users, { type: KONSI_COUNT_DUE, ...payload });
}

/**
 * The daily konsi count sweep. For every active KONSI store with a sell-through method, it reads
 * the store's count state (`getStoreCountState`, the same rule the store screen shows). When the
 * count is DUE or OVERDUE and none is open, it opens a DRAFT count through `createStoreStocktake`,
 * which snapshots every `StoreStock` row plus the assortment prefill, so the count can be a FULL
 * one. The creator is the store's single assigned SPG, or `KONSI_COUNT_SYSTEM_ACTOR` when the
 * store has none or several. `ALREADY_OPEN` means someone opened a count between the read and the
 * create: it is counted as already open, not as a failure.
 *
 * An OVERDUE store gets one `KONSI_COUNT_OVERDUE` alert per (store, month). A failure at one store
 * is logged and counted, and never stops the sweep.
 *
 * `storeIds` scopes the sweep. Omitted, it sweeps every eligible store; an EMPTY list sweeps
 * nothing, deliberately, since `[]` is a selection and not "no filter". Every spec MUST pass it:
 * specs share the `:3308` bed with real data, and an unscoped sweep opens real counts. `schedule`
 * lets a spec fix the schedule instead of mutating the shared setting rows.
 */
export async function runKonsiCountSweep(input?: {
  storeIds?: string[];
  now?: Date;
  schedule?: CountSchedule;
}): Promise<KonsiCountSweepResult> {
  const now = input?.now ?? new Date();
  const schedule = input?.schedule ?? (await readCountSchedule());

  const stores = await prisma.store.findMany({
    where: {
      termsType: "KONSI",
      sellThroughMethod: { not: null },
      isActive: true,
      ...(input?.storeIds !== undefined ? { id: { in: input.storeIds } } : {}),
    },
    orderBy: { code: "asc" },
    select: { id: true, name: true, createdAt: true },
  });

  /*
   * Deliberately NO `take` and NO `createdAt` floor, as with the AR overdue dedup: this read is the
   * only record that a (store, month) alert already fired, so a row falling outside a window would
   * re-announce it every morning. Volume is bounded at one row per store per month, and
   * `@@index([category, createdAt])` keeps the read indexed.
   */
  const priorOverdue = await prisma.adminNotification.findMany({
    where: { category: KONSI_COUNT_OVERDUE },
    select: { metadata: true },
  });
  const announced = new Set<string>();
  for (const row of priorOverdue) {
    const meta = row.metadata as { storeId?: string; monthKey?: string } | null;
    if (typeof meta?.storeId === "string" && typeof meta.monthKey === "string") announced.add(`${meta.storeId}::${meta.monthKey}`);
  }

  const result: KonsiCountSweepResult = { scanned: stores.length, opened: 0, alreadyOpen: 0, spgNotified: 0, overdueAnnounced: 0, failed: 0 };

  for (const store of stores) {
    try {
      const state = await getStoreCountState(store, schedule, now);
      if (state.status !== "DUE" && state.status !== "OVERDUE") continue;
      const dueDate = formatDateOnlyJakarta(state.dueAt);

      let stocktakeId = state.openStocktakeId;
      if (!stocktakeId) {
        const spgs = await prisma.user.findMany({
          where: { assignedStoreId: store.id },
          orderBy: { id: "asc" },
          select: { id: true, fcmToken: true },
        });
        try {
          const created = await createStoreStocktake({
            storeId: store.id,
            createdById: spgs.length === 1 ? spgs[0].id : KONSI_COUNT_SYSTEM_ACTOR,
            countedAt: now,
            note: `Opened automatically for the ${state.monthKey} count`,
          });
          stocktakeId = created.id;
          result.opened++;

          /* Every metadata value is a flat string: `toFcmData` drops anything else from the push payload. */
          const notification = await prisma.adminNotification.create({
            data: {
              category: KONSI_COUNT_DUE,
              severity: "INFO",
              title: capNotificationText(`Perhitungan stok bulanan dibuka — ${store.name}`),
              message:
                `Perhitungan ${created.docNo} dibuka otomatis untuk periode ${state.monthKey}, batas waktu ${dueDate}.` +
                (spgs.length === 0 ? " Toko ini belum punya SPG, jadi perhitungan perlu diisi dari backoffice." : ""),
              metadata: { storeId: store.id, storeName: store.name, stocktakeId: created.id, docNo: created.docNo, monthKey: state.monthKey, dueDate },
            },
          });
          /* AWAITED on purpose: a cron has no waiting user, and unawaited fan-outs in one tick would stampede FCM. `fanOutAdminNotification` never throws. */
          await fanOutAdminNotification(notification);

          if (spgs.length > 0) {
            await notifySpgsOfCount(spgs, {
              title: "Perhitungan stok bulanan",
              body: `Hitung stok ${store.name} sebelum ${dueDate}.`,
              data: { storeId: store.id, stocktakeId: created.id, monthKey: state.monthKey },
            });
            result.spgNotified += spgs.length;
          }
        } catch (e) {
          if (!(e instanceof StoreStocktakeError && e.code === "ALREADY_OPEN")) throw e;
          result.alreadyOpen++;
          const raced = await prisma.storeStocktake.findFirst({
            where: { storeId: store.id, openKey: { not: null } },
            select: { id: true },
          });
          stocktakeId = raced?.id ?? null;
        }
      }

      if (state.status === "OVERDUE") {
        const key = `${store.id}::${state.monthKey}`;
        if (!announced.has(key)) {
          const notification = await prisma.adminNotification.create({
            data: {
              category: KONSI_COUNT_OVERDUE,
              severity: "WARNING",
              title: capNotificationText(`Perhitungan stok bulanan terlambat — ${store.name}`),
              message: `Belum ada perhitungan penuh yang disetujui untuk periode ${state.monthKey} (batas waktu ${dueDate}).`,
              metadata: { storeId: store.id, storeName: store.name, monthKey: state.monthKey, dueDate, stocktakeId: stocktakeId ?? "" },
            },
          });
          await fanOutAdminNotification(notification);
          announced.add(key);
          result.overdueAnnounced++;
        }
      }
    } catch (err) {
      result.failed++;
      console.error(`[konsi-count-sweep] store ${store.id} failed`, err);
    }
  }

  return result;
}
