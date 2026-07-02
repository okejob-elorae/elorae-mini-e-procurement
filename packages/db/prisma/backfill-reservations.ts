/**
 * One-shot cutover backfill: reconciles existing SalesOrders to the new
 * reserve-at-ingest / consume-at-ship model.
 *
 * Before this feature, marketplace orders deducted InventoryValue.qtyOnHand
 * at Jubelio-webhook ingest time. Every currently in-flight (unshipped,
 * non-cancelled) order therefore already has onHand wrongly deducted and
 * must be RESTORED (onHand += qty) and RESERVED instead. Shipped orders
 * already have correct onHand -> just record a CONSUMED reservation.
 * Cancelled orders already had their deduct reversed by the old cancel path
 * -> record a RELEASED reservation, no qty change.
 *
 * Idempotent: skips any SalesOrderItem line whose salesorderDetailId already
 * has a StockReservation row, so re-running is a no-op for already-processed
 * lines.
 *
 * DRY-RUN BY DEFAULT. Pass --apply to actually write. Dry-run only computes
 * and prints the summary (counts per action + total onHand delta).
 *
 * This writes to a shared database — review the printed summary carefully
 * before passing --apply. --apply refuses to run if DATABASE_URL points at
 * the prod SSH tunnel (port 3307) — run against the local test DB (port
 * 3308) first. Dry-run (no --apply) is read-only and may run against any url.
 */
import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { AdjustmentType, PrismaClient } from "../generated/prisma/client";
import { getDatabaseUrl } from "../src/db-connection";
import { classifyForBackfill } from "../src/backfill-reservations-classify";

const apply = process.argv.includes("--apply");

const effectiveDatabaseUrl = getDatabaseUrl() || process.env.DATABASE_URL || "";

export function assertNotProdApply(url: string, applyFlag: boolean): void {
  if (applyFlag && url.includes("3307")) {
    throw new Error(
      "Refusing --apply: DATABASE_URL points at port 3307 (the prod SSH tunnel). " +
        'Run the backfill against the local test DB (port 3308): DATABASE_URL="mysql://elorae:elorae@127.0.0.1:3308/elorae" ... --apply',
    );
  }
}

assertNotProdApply(effectiveDatabaseUrl, apply);

const adapter = new PrismaMariaDb(effectiveDatabaseUrl);
const prisma = new PrismaClient({ adapter });

type Summary = {
  reserveAndRestore: number;
  markConsumed: number;
  markReleased: number;
  skippedAlreadyReserved: number;
  skippedNoItemId: number;
  skippedZeroQty: number;
  totalOnHandDelta: number;
};

function emptySummary(): Summary {
  return {
    reserveAndRestore: 0,
    markConsumed: 0,
    markReleased: 0,
    skippedAlreadyReserved: 0,
    skippedNoItemId: 0,
    skippedZeroQty: 0,
    totalOnHandDelta: 0,
  };
}

async function resolveVariantSku(jubelioItemId: number): Promise<string> {
  const mapping = await prisma.jubelioProductMapping.findFirst({ where: { jubelioItemId } });
  return mapping?.erpVariantSku ?? "";
}

async function main() {
  console.log(`Reservation cutover backfill — mode: ${apply ? "APPLY (writes enabled)" : "DRY-RUN (no writes)"}`);

  const summary = emptySummary();

  const orders = await prisma.salesOrder.findMany({
    include: { items: true },
    orderBy: { salesorderId: "asc" },
  });

  console.log(`Loaded ${orders.length} SalesOrder rows.`);

  for (const order of orders) {
    const linesToProcess = order.items.filter((item) => item.itemId !== null && Number(item.qty) > 0);
    if (order.items.length !== linesToProcess.length) {
      summary.skippedNoItemId += order.items.filter((i) => i.itemId === null).length;
      summary.skippedZeroQty += order.items.filter((i) => i.itemId !== null && Number(i.qty) <= 0).length;
    }
    if (linesToProcess.length === 0) continue;

    const decision = classifyForBackfill({
      isCanceled: order.isCanceled,
      fulfillmentStatus: order.fulfillmentStatus,
      status: order.status,
    });

    const runLine = async (
      tx: Pick<PrismaClient, "stockReservation" | "stockAdjustment" | "inventoryValue">,
      item: (typeof linesToProcess)[number],
    ): Promise<void> => {
      const existing = await tx.stockReservation.findUnique({
        where: { salesorderDetailId: item.salesorderDetailId },
      });
      if (existing) {
        summary.skippedAlreadyReserved += 1;
        return;
      }

      const itemId = item.itemId as string;
      const qty = Number(item.qty);
      const variantSku = await resolveVariantSku(item.jubelioItemId);

      if (decision.action === "reserve-and-restore") {
        summary.reserveAndRestore += 1;
        summary.totalOnHandDelta += qty;
        if (!apply) return;

        const inv = await tx.inventoryValue.findUnique({
          where: { itemId_variantSku: { itemId, variantSku } },
        });
        if (!inv) {
          console.warn(
            `WARNING: no InventoryValue row for itemId=${itemId} variantSku="${variantSku}" ` +
              `(salesorderDetailId=${item.salesorderDetailId}) — skipping restore for this line.`,
          );
          return;
        }

        const prevQty = Number(inv.qtyOnHand);
        const newQty = prevQty + qty;
        const avgCost = Number(inv.avgCost);
        const prevReserved = Number(inv.reservedQty);
        const newReserved = prevReserved + qty;

        await tx.stockAdjustment.create({
          data: {
            docNumber: `BACKFILL-${item.salesorderDetailId}`,
            itemId,
            type: AdjustmentType.POSITIVE,
            qtyChange: qty,
            reason: "Reservation cutover — restore onHand deducted under deduct-at-ingest",
            prevQty,
            newQty,
            prevAvgCost: avgCost,
            newAvgCost: avgCost,
            source: "JUBELIO_RECONCILE",
            idempotencyKey: `backfill-restore-${item.salesorderDetailId}`,
            externalRef: `salesorder:${order.salesorderId}`,
          },
        });

        await tx.inventoryValue.update({
          where: { itemId_variantSku: { itemId, variantSku } },
          data: {
            qtyOnHand: newQty,
            reservedQty: newReserved,
            totalValue: newQty * avgCost,
            lastUpdated: new Date(),
          },
        });

        await tx.stockReservation.create({
          data: {
            salesorderId: order.salesorderId,
            salesorderDetailId: item.salesorderDetailId,
            itemId,
            variantSku,
            qty,
            state: "RESERVED",
          },
        });
        return;
      }

      if (decision.action === "mark-consumed") {
        summary.markConsumed += 1;
        if (!apply) return;
        await tx.stockReservation.create({
          data: {
            salesorderId: order.salesorderId,
            salesorderDetailId: item.salesorderDetailId,
            itemId,
            variantSku,
            qty,
            state: "CONSUMED",
            resolvedAt: new Date(),
          },
        });
        return;
      }

      // mark-released
      summary.markReleased += 1;
      if (!apply) return;
      await tx.stockReservation.create({
        data: {
          salesorderId: order.salesorderId,
          salesorderDetailId: item.salesorderDetailId,
          itemId,
          variantSku,
          qty,
          state: "RELEASED",
          resolvedAt: new Date(),
        },
      });
    };

    if (apply) {
      await prisma.$transaction(async (tx) => {
        for (const item of linesToProcess) {
          await runLine(tx, item);
        }
      });
    } else {
      for (const item of linesToProcess) {
        await runLine(prisma, item);
      }
    }
  }

  console.log("\n=== Backfill summary ===");
  console.log(`Mode:                        ${apply ? "APPLIED" : "DRY-RUN (nothing written)"}`);
  console.log(`reserve-and-restore lines:   ${summary.reserveAndRestore}`);
  console.log(`mark-consumed lines:         ${summary.markConsumed}`);
  console.log(`mark-released lines:         ${summary.markReleased}`);
  console.log(`skipped (already reserved):  ${summary.skippedAlreadyReserved}`);
  console.log(`skipped (no mapped itemId):  ${summary.skippedNoItemId}`);
  console.log(`skipped (qty <= 0):          ${summary.skippedZeroQty}`);
  console.log(`total onHand delta (+qty):   ${summary.totalOnHandDelta}`);
  if (!apply) {
    console.log("\nThis was a DRY RUN. No rows were written. Re-run with --apply to commit these changes.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
