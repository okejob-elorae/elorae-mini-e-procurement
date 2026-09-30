import { prisma } from "@elorae/db";
import { daysOverdue } from "./aging";
import { OVERDUE_THRESHOLD_SETTING_KEY, parseOverdueThresholds } from "./overdue-thresholds";
import { RECEIVABLE_SOURCE_SELECT, resolveReceivableSource } from "./receivable-source";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { sendNotificationToUsers } from "@/lib/notifications/recipients";
import { capNotificationText } from "@/lib/notifications/text";

/** Oldest-due-first, so a large historical backlog drains in the order that matters most. */
const MAX_ANNOUNCEMENTS_PER_RUN = 200;

export type OverdueSweepResult = {
  scanned: number;
  announced: number;
  deferred: number;
  collectorNotified: number;
  unassigned: number;
  failed: number;
};

/**
 * The collector-facing push. Carries no `VITEST` guard of its own, unlike its siblings in the
 * konsi count sweep and the settlement reject writer: `sendNotificationToUsers` is guarded itself,
 * and a second guard here would stop the sweep's spec from ever reaching the helper, which is the
 * seam its failure case stubs to make one receivable's notify throw.
 */
async function notifyCollectorOfOverdue(
  collectorId: string,
  fcmToken: string | null,
  payload: { title: string; body: string; data: Record<string, string> },
): Promise<void> {
  await sendNotificationToUsers([{ id: collectorId, fcmToken }], { type: "AR_OVERDUE", ...payload });
}

/**
 * Fires one `AR_OVERDUE` `AdminNotification` per receivable per run, at the highest configured
 * threshold it has newly crossed, and one `NotificationQueue` row to the assigned collector (if
 * any). See docs/superpowers/specs/2026-09-01-overdue-notification-design.md for the full
 * reasoning behind every decision below. It follows that spec except in one respect: the collector
 * push now runs BEFORE the `AR_OVERDUE` row, and a receivable that throws is logged, counted in
 * `failed` and skipped instead of halting the run — the loop body says why.
 *
 * `receivableIds` scopes the sweep to specific rows; omitted, it sweeps every OUTSTANDING/PARTIAL
 * receivable. Every test MUST pass it — this repo's specs share the `:3308` dev bed with real
 * data, and an unscoped sweep invoked from a test mutates real rows.
 */
export async function runOverdueSweep(options?: {
  receivableIds?: string[];
  asOf?: Date;
  maxAnnouncementsPerRun?: number;
}): Promise<OverdueSweepResult> {
  const asOf = options?.asOf ?? new Date();
  const cap = options?.maxAnnouncementsPerRun ?? MAX_ANNOUNCEMENTS_PER_RUN;

  const setting = await prisma.systemSetting.findUnique({
    where: { key: OVERDUE_THRESHOLD_SETTING_KEY },
    select: { value: true },
  });
  const thresholds = parseOverdueThresholds(setting?.value ?? null);

  const receivables = await prisma.receivable.findMany({
    where: {
      status: { in: ["OUTSTANDING", "PARTIAL"] },
      ...(options?.receivableIds ? { id: { in: options.receivableIds } } : {}),
    },
    orderBy: { dueDate: "asc" },
    select: {
      id: true,
      storeId: true,
      outstandingAmount: true,
      dueDate: true,
      store: { select: { name: true } },
      ...RECEIVABLE_SOURCE_SELECT,
      collectorId: true,
      collector: { select: { name: true, fcmToken: true } },
    },
  });

  /*
   * Deliberately NO `take` and NO `createdAt` floor. Copying `alreadyFlagged`'s `take: 200` from
   * the JOURNAL_PENDING path would be a bug here: that code dedups a daily-refiring flag, so an
   * aged-out row costs at worst a duplicate. This IS the only record that a one-shot crossing
   * already fired — a row falling outside a window would make the sweep re-announce it forever.
   * Volume is bounded by construction (roughly one row per receivable per threshold), and
   * `@@index([category, createdAt])` makes the read indexed even unfiltered.
   */
  const priorRows = await prisma.adminNotification.findMany({
    where: { category: "AR_OVERDUE" },
    select: { metadata: true },
  });
  const highestAnnounced = new Map<string, number>();
  for (const row of priorRows) {
    const meta = row.metadata as { receivableId?: string; thresholdDays?: number } | null;
    if (!meta?.receivableId || typeof meta.thresholdDays !== "number") continue;
    const current = highestAnnounced.get(meta.receivableId);
    if (current === undefined || meta.thresholdDays > current) highestAnnounced.set(meta.receivableId, meta.thresholdDays);
  }

  let announced = 0;
  let deferred = 0;
  let collectorNotified = 0;
  let unassigned = 0;
  let failed = 0;

  for (const r of receivables) {
    const days = daysOverdue(r.dueDate, asOf);
    const crossed = thresholds.filter((t) => t <= days);
    if (crossed.length === 0) continue; // not yet due at any configured threshold

    const tStar = crossed[crossed.length - 1];
    const tLast = highestAnnounced.get(r.id);
    if (tLast !== undefined && tStar <= tLast) continue;

    if (announced >= cap) {
      deferred++;
      continue;
    }

    /*
     * `Receivable.collectorId` is FK-free under `relationMode = "prisma"`. On an OPTIONAL
     * relation this resolves the collector object to `null` rather than throwing when the id is
     * stale — but a candidate is still treated as unassigned defensively, per slice D's own
     * spec calling out this exact obligation for anything reading `collectorId`.
     */
    const collectorId = r.collectorId;
    const collectorName = r.collector?.name ?? null;
    if (!collectorId || !r.collector) unassigned++;

    const docNo = resolveReceivableSource(r).docNo;
    const outstandingAmount = Number(r.outstandingAmount);
    /* `AdminNotification.title` is VARCHAR(191); a long store name would otherwise fail this crossing on every run. */
    const title = capNotificationText(
      collectorName
        ? `Piutang jatuh tempo ${days} hari — ${r.store.name}`
        : `Piutang jatuh tempo ${days} hari (belum ada penagih) — ${r.store.name}`,
    );
    const message =
      `Nota ${docNo} sebesar ${outstandingAmount} sudah lewat ${days} hari dari jatuh tempo.` +
      (collectorName ? ` Ditugaskan ke ${collectorName}.` : " Belum ada penagih yang ditugaskan.");

    const collectorPayload = {
      title: `Piutang jatuh tempo ${days} hari`,
      body: `Nota ${docNo} di ${r.store.name} sebesar ${outstandingAmount} sudah lewat ${days} hari dari jatuh tempo.`,
      data: { receivableId: r.id, thresholdDays: String(tStar), daysOverdue: String(days) },
    };

    /**
     * One receivable's failure must not halt the run, and must not mark its crossing announced.
     * The `AR_OVERDUE` row is the dedup marker, so it is written LAST, after the collector push —
     * the same order as the konsi count sweep's `KONSI_COUNT_DUE` marker. A throw before it leaves
     * no marker, and the next run retries the crossing; a crossing that did land has its marker and
     * is never re-announced. The catch sits here, around the collector push and the marker, and
     * NOT inside `sendNotificationToUsers`: swallowing a `NotificationQueue` insert failure there
     * would report success to this loop, which would then write the marker for a collector who was
     * never told. The collector push has one recipient, and the helper's only uncaught write is that
     * recipient's queue insert, so a throw from it means nothing reached the collector and a retry
     * does not double-notify. The one duplicate this order can cost: the push lands and the marker
     * insert then throws, so the next run pushes to the collector again.
     */
    try {
      if (collectorId && r.collector) await notifyCollectorOfOverdue(collectorId, r.collector.fcmToken, collectorPayload);

      /*
       * Every metadata value is a flat scalar. `toFcmData` (admin-fanout.ts) stringifies scalars
       * and DROPS null/undefined/objects/arrays — a nested value would silently vanish from the
       * push payload. `collectorId`/`collectorName` are written as `""` rather than null for the
       * same reason. `thresholdDays` is the dedup key read back above and is load-bearing: a row
       * written without it is invisible to the dedup map and re-announces every future run.
       */
      const notification = await prisma.adminNotification.create({
        data: {
          category: "AR_OVERDUE",
          severity: "WARNING",
          title,
          message,
          metadata: {
            receivableId: r.id,
            thresholdDays: tStar,
            daysOverdue: days,
            storeId: r.storeId,
            storeName: r.store.name,
            docNo,
            outstandingAmount,
            collectorId: collectorId ?? "",
            collectorName: collectorName ?? "",
          },
        },
      });

      /**
       * AWAITED — a deliberate exception, shared with the konsi count sweep, where no user is
       * waiting either. `reportStuckDeliveryCompletionAction` awaits too, but it is no precedent: the
       * PWA's offline queue calls it mostly from background sync, and also from the pending screen's
       * Retry, where a salesman IS waiting. Interactive callers fire
       * `void fanOutAdminNotification(...)` because a user is waiting on an already-committed
       * transaction; in a cron nobody is waiting, and hundreds of unawaited fan-outs in one tick
       * (each an FCM call retrying for roughly a minute on network failure) is a stampede.
       * `fanOutAdminNotification` wraps its whole body in try/catch and never throws, so awaiting
       * it here is safe, and sitting inside this try can never count a crossing whose marker was
       * written as failed. DO NOT copy this `await` into any interactive call site.
       */
      await fanOutAdminNotification(notification);
    } catch (err) {
      failed++;
      console.error(`[overdue-sweep] receivable ${r.id} at ${tStar} days failed; its crossing stays unannounced for the next run`, err);
      continue;
    }

    if (collectorId && r.collector) collectorNotified++;
    announced++;
  }

  return { scanned: receivables.length, announced, deferred, collectorNotified, unassigned, failed };
}
