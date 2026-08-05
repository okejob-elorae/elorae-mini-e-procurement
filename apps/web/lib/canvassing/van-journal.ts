import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";
import { lineCostTotal, reconcileSplit } from "./van-journal-values";

type AnyClient = PrismaClient | Prisma.TransactionClient;

const num = (v: Prisma.Decimal | number): number => Number(v);

/**
 * Loading a van moves stock out of main inventory into a van-held asset. The
 * stock ledger already does this (`VAN_LOAD` adjustment) but posted no journal,
 * so GL `Persediaan` and `InventoryValue` diverged for anything on a van.
 */
export async function postVanLoadJournal(
  vanLoadId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const load = await client.vanLoad.findUnique({
    where: { id: vanLoadId },
    select: { docNo: true, createdAt: true, lines: { select: { qty: true, unitCost: true } } },
  });
  if (!load) return { ok: false, code: "NOTHING_TO_POST" };

  const value = lineCostTotal(load.lines.map((l) => ({ qty: num(l.qty), unitCost: num(l.unitCost) })));
  if (Math.abs(value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };

  return generateAutoJournal(
    client,
    "VAN_LOAD",
    vanLoadId,
    [
      { role: "INVENTORY_VAN" as const, debit: value, credit: 0 },
      { role: "INVENTORY" as const, debit: 0, credit: value },
    ],
    { date: load.createdAt, description: `Van load ${load.docNo}`, postedById },
  );
}

/**
 * A canvassing sale is cash-on-spot: cash in against revenue, and cost out of
 * the van-held asset at the snapshot cost stamped on the sale line.
 */
export async function postVanSaleJournal(
  vanSaleId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const sale = await client.vanSale.findUnique({
    where: { id: vanSaleId },
    select: { docNo: true, createdAt: true, total: true, lines: { select: { qty: true, unitCost: true } } },
  });
  if (!sale) return { ok: false, code: "NOTHING_TO_POST" };

  const revenue = num(sale.total);
  const cogs = lineCostTotal(sale.lines.map((l) => ({ qty: num(l.qty), unitCost: num(l.unitCost) })));
  if (Math.abs(revenue) < 0.01 && Math.abs(cogs) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };

  const lines = [];
  if (Math.abs(revenue) >= 0.01) {
    lines.push({ role: "CASH" as const, debit: revenue, credit: 0 });
    lines.push({ role: "SALES_REVENUE" as const, debit: 0, credit: revenue });
  }
  if (Math.abs(cogs) >= 0.01) {
    lines.push({ role: "COGS" as const, debit: cogs, credit: 0 });
    lines.push({ role: "INVENTORY_VAN" as const, debit: 0, credit: cogs });
  }

  return generateAutoJournal(client, "VAN_SALE", vanSaleId, lines, {
    date: sale.createdAt,
    description: `Van sale ${sale.docNo}`,
    postedById,
  });
}

/**
 * End-of-day reconcile returns counted stock to main inventory and writes the
 * shortfall off to the variance account — the first time van shrinkage reaches
 * the GL. A zero-value leg is omitted entirely: `postJournal` rejects a line
 * with neither a debit nor a credit.
 */
export async function postVanReconcileJournal(
  vanReconcileId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const recon = await client.vanReconcile.findUnique({
    where: { id: vanReconcileId },
    select: {
      docNo: true,
      createdAt: true,
      lines: { select: { countedQty: true, varianceQty: true, unitCost: true } },
    },
  });
  if (!recon) return { ok: false, code: "NOTHING_TO_POST" };

  const { returned, variance } = reconcileSplit(
    recon.lines.map((l) => ({
      countedQty: num(l.countedQty),
      varianceQty: num(l.varianceQty),
      unitCost: num(l.unitCost),
    })),
  );

  const lines = [];
  if (Math.abs(returned) >= 0.01) {
    lines.push({ role: "INVENTORY" as const, debit: returned, credit: 0 });
    lines.push({ role: "INVENTORY_VAN" as const, debit: 0, credit: returned });
  }
  if (variance >= 0.01) {
    lines.push({ role: "INVENTORY_VARIANCE" as const, debit: variance, credit: 0 });
    lines.push({ role: "INVENTORY_VAN" as const, debit: 0, credit: variance });
  } else if (variance <= -0.01) {
    /* Counted more than expected: reverse the write-off direction. */
    lines.push({ role: "INVENTORY_VAN" as const, debit: -variance, credit: 0 });
    lines.push({ role: "INVENTORY_VARIANCE" as const, debit: 0, credit: -variance });
  }

  if (lines.length === 0) return { ok: false, code: "NOTHING_TO_POST" };

  return generateAutoJournal(client, "VAN_RECONCILE", vanReconcileId, lines, {
    date: recon.createdAt,
    description: `Van reconcile ${recon.docNo}`,
    postedById,
  });
}
