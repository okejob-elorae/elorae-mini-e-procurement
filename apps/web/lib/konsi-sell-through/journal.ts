import { prisma, postJournal, JournalError, Prisma, type PrismaClient } from "@elorae/db";
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

export const SELL_THROUGH_VOID_JOURNAL_KINDS = [
  "konsi_sell_through_revenue_void",
  "konsi_sell_through_cogs_void",
  "konsi_sell_through_shrinkage_void",
] as const;

export type SellThroughVoidJournalKind = (typeof SELL_THROUGH_VOID_JOURNAL_KINDS)[number];

export type SellThroughAnyJournalKind = SellThroughJournalKind | SellThroughVoidJournalKind;

/* The original each reversal mirrors. */
const VOID_OF: Record<SellThroughVoidJournalKind, SellThroughJournalKind> = {
  konsi_sell_through_revenue_void: "konsi_sell_through_revenue",
  konsi_sell_through_cogs_void: "konsi_sell_through_cogs",
  konsi_sell_through_shrinkage_void: "konsi_sell_through_shrinkage",
};

/* The `Journal.sourceType` each reversal posts under — beside its original's, never the same one, so both stand in the GL. */
export const SELL_THROUGH_VOID_JOURNAL_SOURCE_TYPES: Record<SellThroughVoidJournalKind, string> = {
  konsi_sell_through_revenue_void: "KONSI_SELLTHRU_REVENUE_VOID",
  konsi_sell_through_cogs_void: "KONSI_SELLTHRU_COGS_VOID",
  konsi_sell_through_shrinkage_void: "KONSI_SELLTHRU_SHRINKAGE_VOID",
};

const VOID_DESCRIPTION: Record<SellThroughVoidJournalKind, string> = {
  konsi_sell_through_revenue_void: "Pembatalan nota tagihan konsi",
  konsi_sell_through_cogs_void: "Pembatalan HPP nota tagihan konsi",
  konsi_sell_through_shrinkage_void: "Pembatalan susut konsi",
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
 * The kinds this report still owes a journal for.
 *
 * APPROVED: every original kind with a postable amount and no `Journal` row under its source type
 * yet. Empty for anything `loadInvoicedReport` rejects — a baseline, a report not yet approved —
 * and a kind whose amount is zero is never owed.
 *
 * VOIDED: every reversal whose original EXISTS and whose own row does not. An original is never
 * owed once the report is void. That also covers the one race worth naming: an approve's own
 * original post landing after the void leaves an original with no reversal, which then reads as
 * owed here.
 *
 * A missing journal is a safe gate HERE because every report approved before invoicing existed was
 * marked a baseline, so no un-invoiced history can read as owed. It covers a crash between a
 * commit and the posts, which leaves no JOURNAL_PENDING flag behind, and it clears the moment the
 * journal lands, which a flag never does.
 */
export async function sellThroughJournalGaps(id: string, client: AnyClient = prisma): Promise<SellThroughAnyJournalKind[]> {
  const head = await client.konsiSellThrough.findUnique({ where: { id }, select: { status: true } });
  if (head?.status === "VOIDED") return voidJournalGaps(id, client);
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

async function voidJournalGaps(id: string, client: AnyClient): Promise<SellThroughVoidJournalKind[]> {
  const sourceTypes = [...Object.values(SELL_THROUGH_JOURNAL_SOURCE_TYPES), ...Object.values(SELL_THROUGH_VOID_JOURNAL_SOURCE_TYPES)];
  const posted = await client.journal.findMany({ where: { sourceId: id, sourceType: { in: sourceTypes } }, select: { sourceType: true } });
  const postedTypes = new Set(posted.map((j) => j.sourceType));
  return SELL_THROUGH_VOID_JOURNAL_KINDS.filter(
    (kind) => postedTypes.has(SELL_THROUGH_JOURNAL_SOURCE_TYPES[VOID_OF[kind]]) && !postedTypes.has(SELL_THROUGH_VOID_JOURNAL_SOURCE_TYPES[kind]),
  );
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

/**
 * Reverses one original journal of a VOIDED report by mirroring it as posted: every line's debit
 * and credit swapped on the same chart account, dated on the original's date, under the reversal's
 * own source type. It deliberately bypasses `resolveAccount` — a mapping changed since approve must
 * not send the reversal to a different account than the original hit. A replay is a no-op through
 * the `(sourceType, sourceId)` unique key. NOTHING_TO_POST when the report is not VOIDED or the
 * original was never posted.
 */
export async function postSellThroughVoidJournal(
  kind: SellThroughVoidJournalKind,
  id: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const doc = await client.konsiSellThrough.findUnique({ where: { id }, select: { docNo: true, status: true } });
  if (!doc || doc.status !== "VOIDED") return { ok: false, code: "NOTHING_TO_POST" };
  const original = await client.journal.findFirst({
    where: { sourceType: SELL_THROUGH_JOURNAL_SOURCE_TYPES[VOID_OF[kind]], sourceId: id },
    select: { date: true, lines: { select: { chartAccountId: true, debit: true, credit: true, memo: true } } },
  });
  if (!original) return { ok: false, code: "NOTHING_TO_POST" };
  try {
    const res = await postJournal(client, {
      source: { type: SELL_THROUGH_VOID_JOURNAL_SOURCE_TYPES[kind], id },
      date: original.date,
      description: `${VOID_DESCRIPTION[kind]} ${doc.docNo}`,
      postedById,
      lines: original.lines.map((l) => ({
        chartAccountId: l.chartAccountId,
        debit: Number(l.credit),
        credit: Number(l.debit),
        ...(l.memo ? { memo: l.memo } : {}),
      })),
    });
    return { ok: true, journalId: res.journalId, created: res.created };
  } catch (e) {
    if (e instanceof JournalError && e.code === "UNBALANCED") return { ok: false, code: "UNBALANCED" };
    throw e;
  }
}

export const SELL_THROUGH_JOURNAL_POSTERS: Record<
  SellThroughAnyJournalKind,
  (id: string, postedById: string) => Promise<GenerateAutoJournalResult>
> = {
  konsi_sell_through_revenue: postSellThroughRevenueJournal,
  konsi_sell_through_cogs: postSellThroughCogsJournal,
  konsi_sell_through_shrinkage: postSellThroughShrinkageJournal,
  konsi_sell_through_revenue_void: (id, postedById) => postSellThroughVoidJournal("konsi_sell_through_revenue_void", id, postedById),
  konsi_sell_through_cogs_void: (id, postedById) => postSellThroughVoidJournal("konsi_sell_through_cogs_void", id, postedById),
  konsi_sell_through_shrinkage_void: (id, postedById) => postSellThroughVoidJournal("konsi_sell_through_shrinkage_void", id, postedById),
};
