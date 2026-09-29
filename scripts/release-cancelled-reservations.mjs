/**
 * One-off recovery script. Run AFTER the handler fix that treats `internal_status: "CANCELED"` as a
 * cancel is deployed, so no new order joins the backlog while this drains it.
 *
 * Releases the Jubelio stock reservations still held by orders Jubelio has cancelled. Before that
 * fix the salesorder handler released only on `is_canceled === true`, while Jubelio often reports a
 * cancel through `internal_status: "CANCELED"` alone, so those orders kept their reservations and
 * `InventoryValue.reservedQty` stayed inflated by them. Each order goes through `releaseOrder`, the
 * same writer and the same state update as the handler's cancel branch, and moves no on-hand stock.
 *
 * Usage on VPS:
 *   docker compose -f docker-compose.prod.yml cp scripts/release-cancelled-reservations.mjs api:/tmp/release.mjs
 *   docker compose -f docker-compose.prod.yml exec -e DRY_RUN=1 api node /tmp/release.mjs
 *   docker compose -f docker-compose.prod.yml exec api node /tmp/release.mjs
 *
 * Safe to run multiple times: `releaseOrder` flips each reservation RESERVED -> RELEASED with a
 * guarded update, so a reservation already released by this script or by a live webhook is skipped.
 *
 * Tunables:
 *   DRY_RUN=1       count + log what would change, write nothing
 *   BATCH=200       orders per page (default 200)
 */

import { prisma, releaseOrder } from "@elorae/db";

const DRY_RUN = process.env.DRY_RUN === "1";
const BATCH = Number(process.env.BATCH ?? "200");

/**
 * Same test as `isCanceledOrder` in the api's status-derive, read off the columns the handler
 * mirrors from the payload rather than off `SalesOrder.status`, so an order is released only when
 * Jubelio's own fields say it is cancelled.
 */
const CANCELLED_ORDER = {
  OR: [{ isCanceled: true }, { internalStatus: "CANCELED" }],
};

async function cancelledOrderIdsWithReservations(afterId, take) {
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
  const cancelled = await prisma.salesOrder.findMany({
    where: { salesorderId: { in: ids }, ...CANCELLED_ORDER },
    select: { salesorderId: true },
  });
  return { ids: cancelled.map((o) => o.salesorderId).sort((a, b) => a - b), lastId: ids[ids.length - 1] };
}

async function main() {
  const heldQty = await prisma.stockReservation.aggregate({
    where: {
      source: "JUBELIO",
      state: "RESERVED",
      salesorderId: {
        in: (await prisma.salesOrder.findMany({ where: CANCELLED_ORDER, select: { salesorderId: true } }))
          .map((o) => o.salesorderId),
      },
    },
    _count: { _all: true },
    _sum: { qty: true },
  });
  console.log(`RESERVED reservations on cancelled orders: ${heldQty._count._all} (qty ${heldQty._sum.qty ?? 0})`);
  console.log(`DRY_RUN=${DRY_RUN ? "yes" : "no"}  BATCH=${BATCH}`);

  if (heldQty._count._all === 0) {
    console.log("Nothing to do.");
    return;
  }

  let afterId = null;
  let orders = 0;
  let released = 0;
  let failed = 0;
  while (true) {
    const { ids, lastId } = await cancelledOrderIdsWithReservations(afterId, BATCH);
    if (lastId === null) break;
    afterId = lastId;

    for (const salesorderId of ids) {
      orders += 1;
      if (DRY_RUN) {
        if (orders <= 5) console.log(`  would release salesorder ${salesorderId}`);
        continue;
      }
      try {
        /* Re-checked per order: a live webhook may have un-cancelled it since the page was read. */
        const stillCancelled = await prisma.salesOrder.count({ where: { salesorderId, ...CANCELLED_ORDER } });
        if (stillCancelled === 0) continue;
        const result = await releaseOrder(prisma, { salesorderId });
        released += result.released;
        await prisma.jubelioSalesOrderState.updateMany({
          where: { salesorderId },
          data: { stockApplied: false, reversedAt: new Date(), lastIsCanceled: true },
        });
      } catch (err) {
        failed += 1;
        console.error(`  salesorder ${salesorderId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (DRY_RUN) {
    console.log(`Dry run — ${orders} cancelled orders would be released, no writes performed.`);
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
