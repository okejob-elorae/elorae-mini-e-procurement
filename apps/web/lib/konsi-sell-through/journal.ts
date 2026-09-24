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

/* The `Journal.sourceType` each kind posts under — the one spelling, read by the posters and by `sellThroughJournalGaps`. */
export const SELL_THROUGH_JOURNAL_SOURCE_TYPES: Record<SellThroughJournalKind, string> = {
  konsi_sell_through_revenue: "KONSI_SELLTHRU_REVENUE",
  konsi_sell_through_cogs: "KONSI_SELLTHRU_COGS",
  konsi_sell_through_shrinkage: "KONSI_SELLTHRU_SHRINKAGE",
};

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

type InvoicedReport = NonNullable<Awaited<ReturnType<typeof loadInvoicedReport>>>;

/**
 * What each kind would post for this report: revenue at the invoice total, COGS and shrinkage at
 * the lines' unit cost. The posters and `sellThroughJournalGaps` both read it, so the gap check can
 * never call a journal owed that its poster would then decline as NOTHING_TO_POST.
 */
function journalAmounts(doc: InvoicedReport): Record<SellThroughJournalKind, number> {
  const cost = sellThroughCostTotals(
    doc.lines.map((l) => ({ billedQty: l.billedQty.toNumber(), shrinkageQty: l.shrinkageQty.toNumber(), unitCost: l.unitCost.toNumber() })),
  );
  return {
    konsi_sell_through_revenue: doc.total === null ? 0 : Number(doc.total),
    konsi_sell_through_cogs: cost.cogs,
    konsi_sell_through_shrinkage: cost.shrinkage,
  };
}

const isPostable = (value: number): boolean => Math.abs(value) >= 0.01;

/**
 * The kinds this report still owes a journal for: every kind with a postable amount and no
 * `Journal` row under its source type yet. Empty for anything `loadInvoicedReport` rejects — a
 * baseline, a report not yet approved — and a kind whose amount is zero is never owed.
 *
 * A missing journal is a safe gate HERE because every report approved before invoicing existed was
 * marked a baseline, so no un-invoiced history can read as owed. It covers a crash between the
 * approve commit and the posts, which leaves no JOURNAL_PENDING flag behind, and it clears the
 * moment the journal lands, which a flag never does.
 */
export async function sellThroughJournalGaps(id: string, client: AnyClient = prisma): Promise<SellThroughJournalKind[]> {
  const doc = await loadInvoicedReport(client, id);
  if (!doc) return [];
  const amounts = journalAmounts(doc);
  const owed = SELL_THROUGH_JOURNAL_KINDS.filter((kind) => isPostable(amounts[kind]));
  if (owed.length === 0) return [];
  const posted = await client.journal.findMany({
    where: { sourceId: id, sourceType: { in: owed.map((kind) => SELL_THROUGH_JOURNAL_SOURCE_TYPES[kind]) } },
    select: { sourceType: true },
  });
  const postedTypes = new Set(posted.map((j) => j.sourceType));
  return owed.filter((kind) => !postedTypes.has(SELL_THROUGH_JOURNAL_SOURCE_TYPES[kind]));
}

export async function postSellThroughRevenueJournal(id: string, postedById: string, client: AnyClient = prisma): Promise<GenerateAutoJournalResult> {
  const doc = await loadInvoicedReport(client, id);
  if (!doc) return { ok: false, code: "NOTHING_TO_POST" };
  const value = journalAmounts(doc).konsi_sell_through_revenue;
  if (!isPostable(value)) return { ok: false, code: "NOTHING_TO_POST" };
  return generateAutoJournal(
    client,
    SELL_THROUGH_JOURNAL_SOURCE_TYPES.konsi_sell_through_revenue,
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
  const value = journalAmounts(doc).konsi_sell_through_cogs;
  if (!isPostable(value)) return { ok: false, code: "NOTHING_TO_POST" };
  return generateAutoJournal(
    client,
    SELL_THROUGH_JOURNAL_SOURCE_TYPES.konsi_sell_through_cogs,
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
  const value = journalAmounts(doc).konsi_sell_through_shrinkage;
  if (!isPostable(value)) return { ok: false, code: "NOTHING_TO_POST" };
  return generateAutoJournal(
    client,
    SELL_THROUGH_JOURNAL_SOURCE_TYPES.konsi_sell_through_shrinkage,
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
