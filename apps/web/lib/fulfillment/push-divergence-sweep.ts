import { prisma, type JubelioOutboxEntityType } from "@elorae/db";
import { fanOutAdminNotification } from "@/lib/notifications/admin-fanout";
import { capNotificationText } from "@/lib/notifications/text";

const CATEGORY = "FULFILLMENT_PUSH_STUCK";
const DEFAULT_STUCK_AFTER_MS = 3_600_000;

/**
 * Bounds the NEW alerts one run raises, so the first run after deploy does not fan out one alert
 * per historical stuck order at once. Orders are visited oldest first; the rest are left for later
 * runs, which the dedup below makes safe.
 */
const MAX_ALERTS_PER_RUN = 20;

/* Mirrors OUTBOX_SKIP_REASONS.JUBELIO_ALREADY_IN_STATE in apps/api/src/jubelio/outbox/outbox-status.ts: Jubelio confirmed the state. */
const SKIP_REASON_ALREADY_IN_STATE = "jubelio_already_in_state";

const PUSH_TYPE_BY_STATUS = {
  PICKED: "salesorder_pick",
  PACKED: "salesorder_pack",
} as const satisfies Record<"PICKED" | "PACKED", JubelioOutboxEntityType>;

const PUSH_TYPES = Object.values(PUSH_TYPE_BY_STATUS);

export type FulfillmentPushDivergenceResult = {
  checked: number;
  notified: number;
  failed: number;
  /* Divergent orders not yet announced that this run left for a later one because of the cap. */
  deferred: number;
};

const EMPTY_RESULT: FulfillmentPushDivergenceResult = { checked: 0, notified: 0, failed: 0, deferred: 0 };

/**
 * Alerts admins when an order's local fulfilment says PICKED/PACKED but the matching pick/pack
 * outbox push never landed: the latest row is DEAD, SKIPPED for any reason other than
 * already-in-state, or still PENDING/PROCESSING after `stuckAfterMs`. It deliberately does not
 * compare `wmsStatus`, whose vocabulary from Jubelio is not reliably known.
 *
 * A cancelled or returned order is finished, so a push that never landed for it is not alerted.
 *
 * `orderIds` scopes the sweep: `undefined` sweeps every order and `[]` sweeps none. Every test MUST
 * pass it, since specs share the `:3308` dev bed with real data. `maxAlerts` overrides
 * `MAX_ALERTS_PER_RUN` for tests.
 */
export async function runFulfillmentPushDivergenceSweep(options?: {
  orderIds?: string[];
  now?: Date;
  stuckAfterMs?: number;
  maxAlerts?: number;
}): Promise<FulfillmentPushDivergenceResult> {
  if (options?.orderIds && options.orderIds.length === 0) return { ...EMPTY_RESULT };

  const now = options?.now ?? new Date();
  const stuckAfterMs = options?.stuckAfterMs ?? DEFAULT_STUCK_AFTER_MS;
  const maxAlerts = options?.maxAlerts ?? MAX_ALERTS_PER_RUN;

  const orders = await prisma.salesOrder.findMany({
    where: {
      fulfillmentStatus: { in: ["PICKED", "PACKED"] },
      status: { notIn: ["CANCELLED", "RETURNED"] },
      ...(options?.orderIds ? { id: { in: options.orderIds } } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, salesorderNo: true, fulfillmentStatus: true },
  });
  if (orders.length === 0) return { ...EMPTY_RESULT };

  const outboxRows = await prisma.jubelioOutbox.findMany({
    where: {
      entityType: { in: PUSH_TYPES },
      entityId: { in: orders.map((o) => o.id) },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, entityType: true, entityId: true, status: true, skipReason: true, createdAt: true },
  });
  const latest = new Map<string, (typeof outboxRows)[number]>();
  for (const row of outboxRows) latest.set(`${row.entityId}:${row.entityType}`, row);

  /*
   * Deliberately NO `take` and NO `createdAt` floor: this row set is the only record that a
   * divergence was already announced, so a bound would re-announce it on every run.
   */
  const priorRows = await prisma.adminNotification.findMany({
    where: { category: CATEGORY },
    select: { metadata: true },
  });
  const announced = new Set<string>();
  for (const row of priorRows) {
    const meta = row.metadata as { salesOrderId?: string; outboxId?: string } | null;
    if (meta?.salesOrderId && meta.outboxId) announced.add(`${meta.salesOrderId}:${meta.outboxId}`);
  }

  let notified = 0;
  let failed = 0;
  let deferred = 0;

  for (const order of orders) {
    const pushType = PUSH_TYPE_BY_STATUS[order.fulfillmentStatus as "PICKED" | "PACKED"];
    const row = latest.get(`${order.id}:${pushType}`);
    if (!row) continue;

    const stuck =
      row.status === "DEAD" ||
      (row.status === "SKIPPED" && row.skipReason !== SKIP_REASON_ALREADY_IN_STATE) ||
      ((row.status === "PENDING" || row.status === "PROCESSING") && now.getTime() - row.createdAt.getTime() > stuckAfterMs);
    if (!stuck) continue;
    if (announced.has(`${order.id}:${row.id}`)) continue;
    if (notified + failed >= maxAlerts) {
      deferred++;
      continue;
    }

    const kind = pushType === "salesorder_pick" ? "pick" : "pack";
    try {
      /* `AdminNotification.title` is VARCHAR(191). */
      const title = capNotificationText(`Push ${kind} ke Jubelio belum masuk (${row.status}) — ${order.salesorderNo}`);
      const message =
        `Order ${order.salesorderNo} berstatus ${order.fulfillmentStatus} di ERP, tetapi push ${kind} ke Jubelio ` +
        `berstatus ${row.status}${row.skipReason ? ` (${row.skipReason})` : ""}.`;

      /* Every metadata value is a flat scalar; `toFcmData` drops anything else. */
      const notification = await prisma.adminNotification.create({
        data: {
          category: CATEGORY,
          severity: "WARNING",
          title,
          message,
          metadata: {
            salesOrderId: order.id,
            salesorderNo: order.salesorderNo,
            outboxId: row.id,
            pushType,
            pushStatus: row.status,
            skipReason: row.skipReason ?? "",
          },
        },
      });

      /* Awaited on purpose: a cron has no waiting user, and unawaited fan-outs would stampede FCM. Never copy into an interactive path. */
      await fanOutAdminNotification(notification);
    } catch (err) {
      /*
       * Only a failed `create` is retried next run. If the create succeeded and the fan-out threw,
       * the row exists, so dedup suppresses any retry: the alert stays visible in the bell but is
       * never pushed. Either way the order is counted as failed.
       */
      failed++;
      console.error(`[fulfillment-push-divergence] order ${order.id} failed`, err);
      continue;
    }
    notified++;
  }

  return { checked: orders.length, notified, failed, deferred };
}
