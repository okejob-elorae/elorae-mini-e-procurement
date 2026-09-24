import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { roundCents } from "@elorae/db/pricing";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";

type AnyClient = PrismaClient | Prisma.TransactionClient;

export const SELL_THROUGH_JOURNAL_KINDS = [
  "konsi_sell_through_revenue",
  "konsi_sell_through_cogs",
  "konsi_sell_through_shrinkage",
] as const;

export type SellThroughJournalKind = (typeof SELL_THROUGH_JOURNAL_KINDS)[number];

/* Billed units leave inventory as COGS, shrunk units as a variance — both at the line's creation-time unit cost. */
export function sellThroughCostTotals(lines: Array<{ billedQty: number; shrinkageQty: number; unitCost: number }>): {
  cogs: number;
  shrinkage: number;
} {
  let cogs = 0;
  let shrinkage = 0;
  for (const l of lines) {
    cogs += l.billedQty * l.unitCost;
    shrinkage += l.shrinkageQty * l.unitCost;
  }
  return { cogs: roundCents(cogs), shrinkage: roundCents(shrinkage) };
}

/**
 * The invoiced report, or null when there is nothing a journal may be posted for: not found, not
 * APPROVED, a baseline, or no invoice date. Every journal is dated on the report's invoice date,
 * never on when the post ran, so a retry across a month boundary books into the invoice's period.
 */
async function loadInvoicedReport(client: AnyClient, id: string) {
  const doc = await client.konsiSellThrough.findUnique({
    where: { id },
    select: {
      docNo: true,
      status: true,
      baseline: true,
      invoiceDate: true,
      total: true,
      lines: { select: { billedQty: true, shrinkageQty: true, unitCost: true } },
    },
  });
  if (!doc || doc.status !== "APPROVED" || doc.baseline || doc.invoiceDate === null) return null;
  return { ...doc, invoiceDate: doc.invoiceDate };
}

function costTotalsOf(lines: Array<{ billedQty: Prisma.Decimal; shrinkageQty: Prisma.Decimal; unitCost: Prisma.Decimal }>) {
  return sellThroughCostTotals(
    lines.map((l) => ({ billedQty: l.billedQty.toNumber(), shrinkageQty: l.shrinkageQty.toNumber(), unitCost: l.unitCost.toNumber() })),
  );
}

export async function postSellThroughRevenueJournal(id: string, postedById: string, client: AnyClient = prisma): Promise<GenerateAutoJournalResult> {
  const doc = await loadInvoicedReport(client, id);
  if (!doc || doc.total === null) return { ok: false, code: "NOTHING_TO_POST" };
  const value = Number(doc.total);
  if (Math.abs(value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  return generateAutoJournal(
    client,
    "KONSI_SELLTHRU_REVENUE",
    id,
    [
      { role: "AR", debit: value, credit: 0 },
      { role: "SALES_REVENUE", debit: 0, credit: value },
    ],
    { date: doc.invoiceDate, description: `Nota tagihan konsi ${doc.docNo}`, postedById },
  );
}

export async function postSellThroughCogsJournal(id: string, postedById: string, client: AnyClient = prisma): Promise<GenerateAutoJournalResult> {
  const doc = await loadInvoicedReport(client, id);
  if (!doc) return { ok: false, code: "NOTHING_TO_POST" };
  const value = costTotalsOf(doc.lines).cogs;
  if (Math.abs(value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  return generateAutoJournal(
    client,
    "KONSI_SELLTHRU_COGS",
    id,
    [
      { role: "COGS", debit: value, credit: 0 },
      { role: "INVENTORY", debit: 0, credit: value },
    ],
    { date: doc.invoiceDate, description: `HPP nota tagihan konsi ${doc.docNo}`, postedById },
  );
}

export async function postSellThroughShrinkageJournal(id: string, postedById: string, client: AnyClient = prisma): Promise<GenerateAutoJournalResult> {
  const doc = await loadInvoicedReport(client, id);
  if (!doc) return { ok: false, code: "NOTHING_TO_POST" };
  const value = costTotalsOf(doc.lines).shrinkage;
  if (Math.abs(value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  return generateAutoJournal(
    client,
    "KONSI_SELLTHRU_SHRINKAGE",
    id,
    [
      { role: "INVENTORY_VARIANCE", debit: value, credit: 0 },
      { role: "INVENTORY", debit: 0, credit: value },
    ],
    { date: doc.invoiceDate, description: `Susut konsi ${doc.docNo}`, postedById },
  );
}

export const SELL_THROUGH_JOURNAL_POSTERS: Record<
  SellThroughJournalKind,
  (id: string, postedById: string) => Promise<GenerateAutoJournalResult>
> = {
  konsi_sell_through_revenue: postSellThroughRevenueJournal,
  konsi_sell_through_cogs: postSellThroughCogsJournal,
  konsi_sell_through_shrinkage: postSellThroughShrinkageJournal,
};
