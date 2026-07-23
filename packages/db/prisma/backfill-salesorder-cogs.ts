/**
 * One-shot backfill: fills SalesOrderItem.cogs for already-consumed orders
 * (lines shipped before the sale-time COGS stamp existed).
 *
 * consumeOrder now stamps cogs = qty * avgCost at consume time (Task 1), but
 * that only covers lines consumed after the change shipped. Historic lines
 * left cogs null even though the cost is recoverable from the
 * FULFILLMENT_CONSUME StockAdjustment row consumeOrder wrote when it
 * deducted stock: idempotencyKey = `salesorder-{salesorderId}-consume-line-
 * {salesorderDetailId}`, carrying newAvgCost + qtyChange (negative).
 *
 * Idempotent: only targets SalesOrderItem rows with cogs still null, so
 * re-running is a no-op for already-backfilled lines.
 *
 * DRY-RUN BY DEFAULT. Pass --apply to actually write. Dry-run only computes
 * and prints the summary (updated vs skipped counts).
 *
 * This writes to a shared database — review the printed summary carefully
 * before passing --apply. --apply refuses to run if DATABASE_URL points at
 * the prod SSH tunnel (port 3307) — run against the local test DB (port
 * 3308) first. Dry-run (no --apply) is read-only and may run against any url.
 */
import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client";
import { getDatabaseUrl } from "../src/db-connection";
import { assertNotProdApply } from "../src/backfill-reservations-classify";

const apply = process.argv.includes("--apply");

const effectiveDatabaseUrl = getDatabaseUrl() || process.env.DATABASE_URL || "";

assertNotProdApply(effectiveDatabaseUrl, apply);

const adapter = new PrismaMariaDb(effectiveDatabaseUrl);
const prisma = new PrismaClient({ adapter });

type BackfillClient = {
  salesOrderItem: Pick<PrismaClient["salesOrderItem"], "findMany" | "update">;
  stockAdjustment: Pick<PrismaClient["stockAdjustment"], "findFirst">;
};

export async function resolveBackfillCogs(
  client: BackfillClient,
  opts: { apply: boolean },
): Promise<{ updated: number; skipped: number }> {
  const lines = await client.salesOrderItem.findMany({
    where: { cogs: null },
    select: { id: true, salesorderDetailId: true },
  });

  let updated = 0;
  let skipped = 0;

  for (const line of lines) {
    const adj = await client.stockAdjustment.findFirst({
      where: {
        source: "FULFILLMENT_CONSUME",
        idempotencyKey: { endsWith: `-consume-line-${line.salesorderDetailId}` },
      },
      select: { newAvgCost: true, qtyChange: true },
    });

    if (!adj) {
      skipped += 1;
      continue;
    }

    const cogs = Number(adj.newAvgCost) * Math.abs(Number(adj.qtyChange));
    if (opts.apply) {
      await client.salesOrderItem.update({ where: { id: line.id }, data: { cogs } });
    }
    updated += 1;
  }

  return { updated, skipped };
}

async function main() {
  console.log(`SalesOrderItem cogs backfill — mode: ${apply ? "APPLY (writes enabled)" : "DRY-RUN (no writes)"}`);

  const res = await resolveBackfillCogs(prisma, { apply });

  console.log("\n=== Backfill summary ===");
  console.log(`Mode:                        ${apply ? "APPLIED" : "DRY-RUN (nothing written)"}`);
  console.log(`cogs resolved from adjustment: ${res.updated}`);
  console.log(`skipped (no consume adjustment, left null): ${res.skipped}`);
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
