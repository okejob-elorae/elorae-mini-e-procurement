/**
 * Recovery script, run once per scope, AFTER the handler fix for that scope is deployed so no new
 * order joins the backlog while it drains. The file name predates the returned scope.
 *
 * Releases the Jubelio stock reservations still held by finished orders the salesorder handler
 * never released:
 *   SCOPE=cancelled (default) — orders Jubelio cancelled through `internal_status: "CANCELED"`
 *     alone; the handler used to release only on `is_canceled === true`.
 *   SCOPE=returned — orders Jubelio reports returned (`internal_status` or `wms_status`
 *     `"RETURNED"`); the handler used to treat them as neither shipped nor cancelled, so nothing
 *     released them. Orders carrying a mirrored ship or completion signal are left out, as the
 *     handler consumes those instead; the dry run reports how many that excludes.
 * Both kept `InventoryValue.reservedQty` inflated. Each order goes through `releaseOrder`, the
 * same writer and the same state update as the handler's release branch, and moves no on-hand
 * stock: until cutover Jubelio's figure governs on-hand, so a finished order's reservation is
 * dropped, never consumed.
 *
 * Usage on VPS — copied under /app/apps/api, not /tmp, because Node resolves `@elorae/db` by walking
 * up from the script's own location and it only resolves from inside the api package:
 *   docker compose -f docker-compose.prod.yml cp scripts/release-cancelled-reservations.mjs api:/app/apps/api/release.mjs
 *   docker compose -f docker-compose.prod.yml exec -e DRY_RUN=1 -e SCOPE=returned api node /app/apps/api/release.mjs
 *   docker compose -f docker-compose.prod.yml exec -e SCOPE=returned api node /app/apps/api/release.mjs
 * Omit SCOPE (or pass SCOPE=cancelled) for the cancelled scope.
 *
 * The first line reports reservation rows and their quantity; the last reports orders.
 *
 * Safe to run multiple times: `releaseOrder` flips each reservation RESERVED -> RELEASED with a
 * guarded update, so a reservation already released by this script or by a live webhook is skipped.
 *
 * Tunables:
 *   SCOPE=cancelled which finished orders to release: cancelled (default) or returned
 *   DRY_RUN=1       count + log what would change, write nothing
 *   BATCH=200       orders per page (default 200)
 */

import { prisma, releaseOrder } from "@elorae/db";

const DRY_RUN = process.env.DRY_RUN === "1";
const BATCH = Number(process.env.BATCH ?? "200");

/**
 * Each scope's test is the same as `isCanceledOrder` / `isReturnedOrder` in the api's
 * status-derive, read off the columns the handler mirrors from the payload rather than off
 * `SalesOrder.status`, so an order is released only when Jubelio's own fields say it is finished.
 */
const SCOPES = {
  cancelled: {
    where: { OR: [{ isCanceled: true }, { internalStatus: "CANCELED" }] },
    lastIsCanceled: true,
  },
  returned: {
    where: {
      OR: [{ internalStatus: "RETURNED" }, { wmsStatus: "RETURNED" }],
      markedAsComplete: false,
      completedDate: null,
      NOT: { fulfillmentStatus: "SHIPPED" },
    },
    lastIsCanceled: false,
    /* The returned orders the ship-signal terms above leave out, counted in the dry run. */
    excluded: {
      OR: [{ internalStatus: "RETURNED" }, { wmsStatus: "RETURNED" }],
      NOT: { markedAsComplete: false, completedDate: null, NOT: { fulfillmentStatus: "SHIPPED" } },
    },
  },
};
const SCOPE_NAME = process.env.SCOPE ?? "cancelled";
/* Own keys only: an inherited name like "constructor" would otherwise pass with no filter at all. */
const SCOPE = Object.hasOwn(SCOPES, SCOPE_NAME) ? SCOPES[SCOPE_NAME] : undefined;
if (!SCOPE) {
  console.error(`Unknown SCOPE "${SCOPE_NAME}"; expected one of: ${Object.keys(SCOPES).join(", ")}`);
  process.exit(1);
}
const FINISHED_ORDER = SCOPE.where;

async function finishedOrderIdsWithReservations(afterId, take) {
  const rows = await prisma.stockReservation.findMany({
    where: {
      source: "JUBELIO",
      state: "RESERVED",
      salesorderId: { not: null, ...(afterId !== null ? { gt: afterId } : {}) },
    },
    distinct: ["salesorderId"],
    orderBy: { salesorderId: "asc" },
    take,
    select: { salesorderId: true },
  });
  const ids = rows.map((r) => r.salesorderId);
  if (ids.length === 0) return { ids: [], lastId: null };
  const finished = await prisma.salesOrder.findMany({
    where: { salesorderId: { in: ids }, ...FINISHED_ORDER },
    select: { salesorderId: true },
  });
  return { ids: finished.map((o) => o.salesorderId).sort((a, b) => a - b), lastId: ids[ids.length - 1] };
}

async function main() {
  const heldQty = await prisma.stockReservation.aggregate({
    where: {
      source: "JUBELIO",
      state: "RESERVED",
      salesorderId: {
        in: (await prisma.salesOrder.findMany({ where: FINISHED_ORDER, select: { salesorderId: true } }))
          .map((o) => o.salesorderId),
      },
    },
    _count: { _all: true },
    _sum: { qty: true },
  });
  console.log(`RESERVED reservations on ${SCOPE_NAME} orders: ${heldQty._count._all} (qty ${heldQty._sum.qty ?? 0})`);
  console.log(`SCOPE=${SCOPE_NAME}  DRY_RUN=${DRY_RUN ? "yes" : "no"}  BATCH=${BATCH}`);
  if (SCOPE.excluded) {
    const excludedOrders = await prisma.salesOrder.findMany({ where: SCOPE.excluded, select: { salesorderId: true } });
    const excludedHeld = excludedOrders.length === 0
      ? 0
      : await prisma.stockReservation.count({
        where: { source: "JUBELIO", state: "RESERVED", salesorderId: { in: excludedOrders.map((o) => o.salesorderId) } },
      });
    console.log(`Left out for carrying a ship or completion signal: ${excludedHeld} RESERVED reservations`);
  }

  if (heldQty._count._all === 0) {
    console.log("Nothing to do.");
    return;
  }

  let afterId = null;
  let orders = 0;
  let released = 0;
  let failed = 0;
  while (true) {
    const { ids, lastId } = await finishedOrderIdsWithReservations(afterId, BATCH);
    if (lastId === null) break;
    afterId = lastId;

    for (const salesorderId of ids) {
      orders += 1;
      if (DRY_RUN) {
        if (orders <= 5) console.log(`  would release salesorder ${salesorderId}`);
        continue;
      }
      try {
        /* Re-checked per order: a live webhook may have moved it out of this scope since the page was read. */
        const stillFinished = await prisma.salesOrder.count({ where: { salesorderId, ...FINISHED_ORDER } });
        if (stillFinished === 0) continue;
        const result = await releaseOrder(prisma, { salesorderId });
        released += result.released;
        await prisma.jubelioSalesOrderState.updateMany({
          where: { salesorderId },
          data: { stockApplied: false, reversedAt: new Date(), lastIsCanceled: SCOPE.lastIsCanceled },
        });
      } catch (err) {
        failed += 1;
        console.error(`  salesorder ${salesorderId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (DRY_RUN) {
    console.log(`Dry run — ${orders} ${SCOPE_NAME} orders would be released, no writes performed.`);
    return;
  }
  console.log(`Orders processed: ${orders}  reservations released: ${released}  failed orders: ${failed}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
