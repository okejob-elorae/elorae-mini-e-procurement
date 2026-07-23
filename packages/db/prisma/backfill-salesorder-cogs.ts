/**
 * One-shot backfill: fills SalesOrderItem.cogs for already-consumed orders
 * (lines shipped before the sale-time COGS stamp existed).
 *
 * consumeOrder now stamps cogs = qty * avgCost at consume time, but that only
 * covers lines consumed after the change shipped. Historic lines left cogs
 * null even though the cost is recoverable from the FULFILLMENT_CONSUME
 * StockAdjustment row consumeOrder wrote: idempotencyKey =
 * `salesorder-{salesorderId}-consume-line-{salesorderDetailId}`, carrying
 * newAvgCost + qtyChange (negative).
 *
 * Set-based: bulk-loads all consume adjustments once and joins in memory
 * (the earlier per-line findFirst was N+1 and timed out at ~9k lines).
 * Writes run in bounded batches of 8 (well under the default pool of 10) so
 * a large backfill can never exhaust the connection pool.
 *
 * Idempotent: only targets SalesOrderItem rows with cogs still null (the
 * UPDATE re-checks `cogs: null`), so re-running is a no-op for already-filled
 * lines.
 *
 * DRY-RUN BY DEFAULT. Pass --apply to write. Dry-run is read-only, any url.
 * --apply refuses on the prod SSH tunnel (port 3307) unless you ALSO pass
 * --allow-prod (deliberate prod backfill). Prefer validating on the local
 * test DB (port 3308) first.
 */
import { PrismaClient } from "../generated/prisma/client";

const UPDATE_CHUNK = 8; // < default pool (10) — never exhaust connections

type BackfillClient = {
  salesOrderItem: Pick<PrismaClient["salesOrderItem"], "findMany" | "updateMany">;
  stockAdjustment: Pick<PrismaClient["stockAdjustment"], "findMany">;
};

export async function resolveBackfillCogs(
  client: BackfillClient,
  opts: { apply: boolean },
): Promise<{ updated: number; skipped: number }> {
  // 1. bulk-load consume adjustments → detailId -> cogs (one query, in-memory join)
  const adjustments = await client.stockAdjustment.findMany({
    where: { source: "FULFILLMENT_CONSUME" },
    select: { idempotencyKey: true, newAvgCost: true, qtyChange: true },
  });
  const cogsByDetailId = new Map<string, number>();
  for (const adj of adjustments) {
    const match = adj.idempotencyKey?.match(/-consume-line-(\d+)$/);
    if (match) cogsByDetailId.set(match[1], Number(adj.newAvgCost) * Math.abs(Number(adj.qtyChange)));
  }

  // 2. null-cogs lines → join
  const lines = await client.salesOrderItem.findMany({
    where: { cogs: null },
    select: { id: true, salesorderDetailId: true },
  });
  const targets: { id: string; cogs: number }[] = [];
  let skipped = 0;
  for (const line of lines) {
    const cogs = cogsByDetailId.get(String(line.salesorderDetailId));
    if (cogs === undefined) { skipped += 1; continue; }
    targets.push({ id: line.id, cogs });
  }

  // 3. dry-run reports the would-update count; apply writes in bounded batches
  if (!opts.apply) return { updated: targets.length, skipped };

  let updated = 0;
  for (let i = 0; i < targets.length; i += UPDATE_CHUNK) {
    const batch = targets.slice(i, i + UPDATE_CHUNK);
    const results = await Promise.all(
      batch.map((t) => client.salesOrderItem.updateMany({ where: { id: t.id, cogs: null }, data: { cogs: t.cogs } })),
    );
    updated += results.reduce((sum, r) => sum + r.count, 0);
  }
  return { updated, skipped };
}

// CLI entry — only when invoked directly (`tsx prisma/backfill-salesorder-cogs.ts ...`),
// never when the module is imported (e.g. by the spec), so importing has no side effects.
async function runCli() {
  await import("dotenv/config");
  const { PrismaMariaDb } = await import("@prisma/adapter-mariadb");
  const { getDatabaseUrl } = await import("../src/db-connection");
  const { assertNotProdApply } = await import("../src/backfill-reservations-classify");

  const apply = process.argv.includes("--apply");
  const allowProd = process.argv.includes("--allow-prod");
  const effectiveDatabaseUrl = getDatabaseUrl() || process.env.DATABASE_URL || "";

  // Default keeps the accidental-prod-apply guard; --allow-prod is the explicit
  // opt-in for a deliberate prod backfill over the tunnel.
  if (!allowProd) {
    assertNotProdApply(effectiveDatabaseUrl, apply);
  } else if (apply && effectiveDatabaseUrl.includes("3307")) {
    console.warn("⚠ --allow-prod set: applying against the prod tunnel (:3307).");
  }

  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(effectiveDatabaseUrl) });
  console.log(`SalesOrderItem cogs backfill — mode: ${apply ? "APPLY (writes enabled)" : "DRY-RUN (no writes)"}`);
  try {
    const res = await resolveBackfillCogs(prisma, { apply });
    console.log("\n=== Backfill summary ===");
    console.log(`Mode:                        ${apply ? "APPLIED" : "DRY-RUN (nothing written)"}`);
    console.log(`cogs resolved from adjustment: ${res.updated}`);
    console.log(`skipped (no consume adjustment, left null): ${res.skipped}`);
    if (!apply) {
      console.log("\nThis was a DRY RUN. No rows were written. Re-run with --apply to commit these changes.");
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && process.argv[1].includes("backfill-salesorder-cogs")) {
  runCli().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
