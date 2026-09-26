import { prisma } from "@elorae/db";
import { createStoreStocktake } from "@/lib/stores/stocktake/writer";
import { StoreStocktakeError } from "@/lib/stores/stocktake/errors";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { capNotificationText } from "@/lib/notifications/text";
import { sendNotificationToUsers, type NotificationUser } from "@/lib/notifications/recipients";
import { formatDateOnlyJakarta } from "@/lib/date-only";
import { KONSI_COUNT_SYSTEM_ACTOR, countWindowFor, formatCountDueDate, formatCountMonth, type CountSchedule } from "./schedule";
import { getStoreCountState, readCountSchedule } from "./queries";
import { KONSI_COUNT_DUE, KONSI_COUNT_OVERDUE } from "./categories";

/**
 * What one sweep did. `opened` counts counts this sweep created; `alreadyOpen` counts creates
 * that lost the race to a manual open (`ALREADY_OPEN`); `existingAnnounced` counts counts the
 * sweep announced without having opened them, the raced ones included.
 */
export type KonsiCountSweepResult = {
  scanned: number;
  opened: number;
  alreadyOpen: number;
  existingAnnounced: number;
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

/* The `storeId::monthKey` keys of prior notification rows, read from their metadata. */
function storeMonthKeys(rows: { metadata: unknown }[]): Set<string> {
  const keys = new Set<string>();
  for (const row of rows) {
    const meta = row.metadata as { storeId?: string; monthKey?: string } | null;
    if (typeof meta?.storeId === "string" && typeof meta.monthKey === "string") keys.add(`${meta.storeId}::${meta.monthKey}`);
  }
  return keys;
}

/**
 * The daily konsi count sweep. For every active KONSI store with a sell-through method, it reads
 * the store's count state (`getStoreCountState`, the same rule the store screen shows). When the
 * count is DUE or OVERDUE, the store's target month is announced at most ONCE, keyed on the
 * `KONSI_COUNT_DUE` rows already written for (store, month):
 * - A DUE row exists: nothing is opened, even when no count is open. The month's count was opened
 *   already and later cancelled, or approved as partial; an admin opens the next one by hand.
 * - No DUE row and a count is open: that count is announced as it stands, and none is created,
 *   unless its `countFinishedAt` is set and falls before the target month's `openFrom`. Such a
 *   count credits the previous slot once approved, so announcing it would name a count that leaves
 *   the target month still owed, while the marker blocked every reopen. It gets no announcement
 *   and no marker, and the first sweep after it closes opens a fresh count. A null
 *   `countFinishedAt` stays announceable, since its count moment lands later.
 * - Otherwise it opens a DRAFT count through `createStoreStocktake`, which snapshots every
 *   `StoreStock` row plus the assortment prefill, so the count can be a FULL one. The creator is
 *   the store's single assigned SPG, or `KONSI_COUNT_SYSTEM_ACTOR` when the store has none or
 *   several. `ALREADY_OPEN` means someone opened a count between the read and the create: that
 *   count is treated as open and announced, not counted as a failure.
 *
 * An announcement pushes the SPGs first and writes the DUE row LAST, because the row is the
 * marker: when anything before it throws, the next morning announces again instead of losing the
 * alert. The worst case is a duplicate push, or a second count for the month when the count this
 * sweep opened is cancelled before the next run, since no marker then stops the reopen.
 *
 * An OVERDUE store also gets one `KONSI_COUNT_OVERDUE` alert per (store, month), whether or not a
 * count was opened. A failure at one store is logged and counted, and never stops the sweep.
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

  /**
   * Deliberately NO `take` and NO `createdAt` floor on either read, as with the AR overdue dedup:
   * these rows are the only record that a (store, month) announcement already happened, so a row
   * falling outside a window would re-announce it every morning, and for DUE would reopen a count
   * someone cancelled. Volume is bounded at one row per store per month per category, and
   * `@@index([category, createdAt])` keeps both reads indexed.
   */
  const [priorDue, priorOverdue] = await Promise.all([
    prisma.adminNotification.findMany({ where: { category: KONSI_COUNT_DUE }, select: { metadata: true } }),
    prisma.adminNotification.findMany({ where: { category: KONSI_COUNT_OVERDUE }, select: { metadata: true } }),
  ]);
  const dueKeys = storeMonthKeys(priorDue);
  const overdueKeys = storeMonthKeys(priorOverdue);

  const result: KonsiCountSweepResult = {
    scanned: stores.length,
    opened: 0,
    alreadyOpen: 0,
    existingAnnounced: 0,
    spgNotified: 0,
    overdueAnnounced: 0,
    failed: 0,
  };

  for (const store of stores) {
    try {
      const state = await getStoreCountState(store, schedule, now);
      if (state.status !== "DUE" && state.status !== "OVERDUE") continue;
      const key = `${store.id}::${state.monthKey}`;
      const dueDate = formatDateOnlyJakarta(state.dueAt);
      const monthLabel = formatCountMonth(state.monthKey, "id");
      const dueLabel = formatCountDueDate(state.dueAt, "id");

      let stocktakeId = state.openStocktakeId;
      if (!dueKeys.has(key)) {
        const spgs = await prisma.user.findMany({
          where: { assignedStoreId: store.id },
          orderBy: { id: "asc" },
          select: { id: true, fcmToken: true },
        });

        let doc: { id: string; docNo: string } | null = null;
        let openedHere = false;
        if (state.openStocktakeId) {
          /* `openKey` again, so a count closed since the state read is not announced as open. */
          const open = await prisma.storeStocktake.findFirst({
            where: { id: state.openStocktakeId, openKey: { not: null } },
            select: { id: true, docNo: true, countFinishedAt: true },
          });
          /* `dueAt` lies inside the target month, so its window is the target's. */
          const targetOpenFrom = countWindowFor(state.dueAt, schedule).openFrom;
          if (open && (open.countFinishedAt === null || open.countFinishedAt.getTime() >= targetOpenFrom.getTime())) {
            doc = { id: open.id, docNo: open.docNo };
          }
        } else {
          try {
            doc = await createStoreStocktake({
              storeId: store.id,
              createdById: spgs.length === 1 ? spgs[0].id : KONSI_COUNT_SYSTEM_ACTOR,
              countedAt: now,
              note: `Dibuka otomatis untuk perhitungan bulanan ${monthLabel}`,
            });
            openedHere = true;
            result.opened++;
          } catch (e) {
            if (!(e instanceof StoreStocktakeError && e.code === "ALREADY_OPEN")) throw e;
            result.alreadyOpen++;
            doc = await prisma.storeStocktake.findFirst({
              where: { storeId: store.id, openKey: { not: null } },
              select: { id: true, docNo: true },
            });
          }
        }
        stocktakeId = doc?.id ?? null;

        if (doc) {
          if (!openedHere) result.existingAnnounced++;
          if (spgs.length > 0) {
            await notifySpgsOfCount(spgs, {
              title: "Perhitungan stok bulanan",
              body:
                state.status === "OVERDUE"
                  ? `Hitung stok ${store.name} untuk ${monthLabel} secepatnya: batas waktunya ${dueLabel} sudah lewat.`
                  : `Hitung stok ${store.name} untuk ${monthLabel}, paling lambat ${dueLabel}.`,
              data: { storeId: store.id, stocktakeId: doc.id, monthKey: state.monthKey },
            });
            result.spgNotified += spgs.length;
          }

          /* The marker, so it is written last. Every metadata value is a flat string, which `toFcmData` carries into the push as written. */
          const notification = await prisma.adminNotification.create({
            data: {
              category: KONSI_COUNT_DUE,
              severity: "INFO",
              title: capNotificationText(
                openedHere ? `Perhitungan stok bulanan dibuka — ${store.name}` : `Perhitungan stok bulanan jatuh tempo — ${store.name}`,
              ),
              message:
                `Perhitungan ${doc.docNo} ${openedHere ? "dibuka otomatis" : "sudah terbuka"} untuk ${monthLabel}, batas waktu ${dueLabel}.` +
                (spgs.length === 0 ? " Toko ini belum punya SPG, jadi perhitungan perlu diisi dari backoffice." : ""),
              metadata: { storeId: store.id, storeName: store.name, stocktakeId: doc.id, docNo: doc.docNo, monthKey: state.monthKey, dueDate },
            },
          });
          dueKeys.add(key);
          /* AWAITED on purpose: a cron has no waiting user, and unawaited fan-outs in one tick would stampede FCM. `fanOutAdminNotification` never throws. */
          await fanOutAdminNotification(notification);
        }
      }

      if (state.status === "OVERDUE" && !overdueKeys.has(key)) {
        const notification = await prisma.adminNotification.create({
          data: {
            category: KONSI_COUNT_OVERDUE,
            severity: "WARNING",
            title: capNotificationText(`Perhitungan stok bulanan terlambat — ${store.name}`),
            message: `Belum ada perhitungan penuh yang disetujui untuk ${monthLabel} (batas waktu ${dueLabel}).`,
            metadata: { storeId: store.id, storeName: store.name, monthKey: state.monthKey, dueDate, stocktakeId: stocktakeId ?? "" },
          },
        });
        overdueKeys.add(key);
        await fanOutAdminNotification(notification);
        result.overdueAnnounced++;
      }
    } catch (err) {
      result.failed++;
      console.error(`[konsi-count-sweep] store ${store.id} failed`, err);
    }
  }

  return result;
}
