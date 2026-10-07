import { prisma, postJournal, JournalError, Prisma, type PrismaClient } from "@elorae/db";
import { roundCents } from "@elorae/db/pricing";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";
import { withRetry } from "@/lib/db/tx-retry";
import { SELL_THROUGH_JOURNAL_SOURCE_TYPES } from "@/lib/konsi-sell-through/journal";
import { findArJournalPendingFlags } from "./journal-pending";
import { RECEIVABLE_SOURCE_SELECT, resolveReceivableSource, ReceivableSourceMissingError } from "./receivable-source";

type AnyClient = PrismaClient | Prisma.TransactionClient;

function hasTx(client: AnyClient): client is PrismaClient {
  return typeof (client as PrismaClient).$transaction === "function";
}

/**
 * Why a payment receipt credited less than the payment, or nothing at all.
 *
 * - `RECEIVABLE_REVENUE_NOT_POSTED_YET` — TRANSIENT. An allocated invoice's own revenue journal
 *   failed to post and is waiting for a retry; once it posts, a retry of this receipt posts in full.
 * - `RECEIVABLE_OUTSIDE_LEDGER` — PERMANENT. Every allocated invoice predates the ledger (no
 *   revenue journal was ever attempted for it), so there is no receivable on the books to credit.
 */
export type ArReceiptGateCode = "RECEIVABLE_REVENUE_NOT_POSTED_YET" | "RECEIVABLE_OUTSIDE_LEDGER";

export type PostPaymentReceiptJournalResult = GenerateAutoJournalResult | { ok: false; code: ArReceiptGateCode };

/**
 * CASH lands in the cash account, TRANSFER in the bank account, RETUR_OFFSET reverses the
 * revenue leg it never really collected — the store settled with goods, not money, so the
 * "receipt" here is a revenue counter-entry (DR SALES_REVENUE / CR AR), the same shape a
 * marketplace sales-return revenue leg already posts. PROGRAM_DEDUCTION and ADMIN_FEE are
 * settlement deductions the business absorbs as a cost against revenue rather than cash or
 * bank.
 */
function debitRole(
  method: "CASH" | "TRANSFER" | "RETUR_OFFSET" | "PROGRAM_DEDUCTION" | "ADMIN_FEE",
): "CASH" | "BANK" | "SALES_REVENUE" | "TRADE_PROGRAM_EXPENSE" | "ADMIN_FEE_EXPENSE" {
  if (method === "CASH") return "CASH";
  if (method === "TRANSFER") return "BANK";
  if (method === "PROGRAM_DEDUCTION") return "TRADE_PROGRAM_EXPENSE";
  if (method === "ADMIN_FEE") return "ADMIN_FEE_EXPENSE";
  return "SALES_REVENUE";
}

/**
 * One entry per requested receivable id: `null` when the revenue journal that debited it stands,
 * otherwise the gate code saying why it does not. The source is resolved through
 * `resolveReceivableSource`, never `receivable.delivery`, since a receivable is backed by either a
 * putus delivery or a konsi sell-through report.
 */
async function classifyReceivables(
  ids: string[],
  client: AnyClient,
): Promise<Map<string, ArReceiptGateCode | null>> {
  const result = new Map<string, ArReceiptGateCode | null>();
  if (ids.length === 0) return result;

  const rows = await client.receivable.findMany({
    where: { id: { in: ids } },
    select: { id: true, ...RECEIVABLE_SOURCE_SELECT },
  });
  const deliveryOf = new Map<string, string>();
  const sellThroughOf = new Map<string, string>();
  for (const row of rows) {
    try {
      const source = resolveReceivableSource(row);
      if (source.kind === "DELIVERY") deliveryOf.set(row.id, source.deliveryId);
      else sellThroughOf.set(row.id, source.sellThroughId);
    } catch (e) {
      if (!(e instanceof ReceivableSourceMissingError)) throw e;
    }
  }

  const journaledIds = async (sourceType: string, sourceIds: string[]): Promise<Set<string | null>> => {
    if (sourceIds.length === 0) return new Set();
    const journals = await client.journal.findMany({
      where: { sourceType, sourceId: { in: sourceIds } },
      select: { sourceId: true },
    });
    return new Set(journals.map((j) => j.sourceId));
  };
  const deliveryIds = [...new Set(deliveryOf.values())];
  const deliveryJournaled = await journaledIds("FIELD_DELIVERY_REVENUE", deliveryIds);
  const sellThroughJournaled = await journaledIds(
    SELL_THROUGH_JOURNAL_SOURCE_TYPES.konsi_sell_through_revenue,
    [...new Set(sellThroughOf.values())],
  );
  const failedDeliveryPosts = await findArJournalPendingFlags(
    "field_delivery_revenue",
    deliveryIds.filter((id) => !deliveryJournaled.has(id)),
  );

  for (const id of ids) {
    const deliveryId = deliveryOf.get(id);
    const sellThroughId = sellThroughOf.get(id);
    if (deliveryId !== undefined) {
      if (deliveryJournaled.has(deliveryId)) result.set(id, null);
      else if (failedDeliveryPosts.has(deliveryId)) result.set(id, "RECEIVABLE_REVENUE_NOT_POSTED_YET");
      else result.set(id, "RECEIVABLE_OUTSIDE_LEDGER");
    } else if (sellThroughId !== undefined) {
      result.set(id, sellThroughJournaled.has(sellThroughId) ? null : "RECEIVABLE_REVENUE_NOT_POSTED_YET");
    } else {
      result.set(id, "RECEIVABLE_OUTSIDE_LEDGER");
    }
  }
  return result;
}

/**
 * Posts DR <method's role> / CR AR for the part of the payment this ledger can credit: the sum of
 * the allocations whose invoice's revenue journal stands. That journal is the only thing that
 * debited AR here, so crediting AR for any other allocation would drive Piutang below what the
 * books ever carried — the same counterpart gate `classifySaleLeg` applies to marketplace returns.
 *
 * Any allocation whose invoice journal is merely late (`RECEIVABLE_REVENUE_NOT_POSTED_YET`) refuses
 * the WHOLE payment, so a retry once that journal posts credits the payment in full rather than
 * leaving a partial receipt standing for good. Allocations outside the ledger are excluded and the
 * rest posts, with the description saying so; only when nothing is left does it refuse
 * `RECEIVABLE_OUTSIDE_LEDGER`. A mixed payment is common, since settlement approval allocates
 * oldest-first across backfilled and live invoices.
 *
 * For a delivery-backed invoice, "late" means a `JOURNAL_PENDING` flag exists for its
 * `field_delivery_revenue` post, never merely a missing journal: every backfilled delivery has no
 * journal by construction, and the flag is the only evidence a post was attempted and failed (the
 * AR retry-gate entry in `docs/ARCHITECTURE-NOTES.md`). A sell-through report is always invoiced
 * through a revenue post, so its missing journal is always late.
 *
 * A payment that already has a receipt returns it without re-gating, and a VOIDED payment with none
 * posts nothing, so a receipt can never land after its void. That holds only because the whole
 * decide-and-post runs in ONE transaction that opens with `SELECT … FOR UPDATE` on the `Payment`
 * row: `voidPayment` flips the status on that same row, so a void either commits before the lock
 * (and is read here as VOIDED) or waits for this receipt to commit (and then mirrors it). Reading
 * the status unlocked and posting in a second transaction let a void commit in between, find no
 * receipt to reverse, and leave this receipt standing against a voided payment. If the two
 * deadlock instead, the victim rolls back whole and retries: `voidPayment` through
 * `runSerializable`, this one through `withRetry`. A caller-supplied transaction client gets no
 * transaction or retry of its own and must not have read before calling, for the same
 * ER_CHECKREAD reason `lockSettlementRow` gives; no caller passes one today.
 */
export async function postPaymentReceiptJournal(
  paymentId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<PostPaymentReceiptJournalResult> {
  if (hasTx(client)) {
    const root = client;
    return withRetry(() => root.$transaction((tx) => postReceiptLocked(paymentId, postedById, tx)));
  }
  return postReceiptLocked(paymentId, postedById, client as Prisma.TransactionClient);
}

/**
 * The body of `postPaymentReceiptJournal`, inside its transaction. Every `ok: false` return comes
 * before the journal write, so returning one commits nothing; the classification's flag lookup
 * reads `AdminNotification` on the global client, which never touches `Payment` and so cannot
 * deadlock against the lock.
 */
async function postReceiptLocked(
  paymentId: string,
  postedById: string,
  tx: Prisma.TransactionClient,
): Promise<PostPaymentReceiptJournalResult> {
  const locked = await tx.$queryRaw<{ status: string }[]>`
    SELECT \`status\` FROM \`Payment\` WHERE \`id\` = ${paymentId} FOR UPDATE
  `;
  if (locked.length === 0) return { ok: false, code: "NOTHING_TO_POST" };

  const existing = await tx.journal.findUnique({
    where: { sourceType_sourceId: { sourceType: "PAYMENT_RECEIPT", sourceId: paymentId } },
    select: { id: true },
  });
  if (existing) return { ok: true, journalId: existing.id, created: false };
  if (locked[0].status === "VOIDED") return { ok: false, code: "NOTHING_TO_POST" };

  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
    select: {
      docNo: true,
      amount: true,
      method: true,
      paidAt: true,
      allocations: { select: { receivableId: true, amount: true } },
    },
  });
  if (!payment) return { ok: false, code: "NOTHING_TO_POST" };
  if (Math.abs(Number(payment.amount)) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };

  const verdicts = await classifyReceivables(
    payment.allocations.map((a) => a.receivableId),
    tx,
  );
  if (payment.allocations.some((a) => verdicts.get(a.receivableId) === "RECEIVABLE_REVENUE_NOT_POSTED_YET")) {
    return { ok: false, code: "RECEIVABLE_REVENUE_NOT_POSTED_YET" };
  }
  const inLedger = payment.allocations.filter((a) => verdicts.get(a.receivableId) === null);
  const excluded = payment.allocations.length - inLedger.length;
  const value = roundCents(inLedger.reduce((sum, a) => sum + Number(a.amount), 0));
  if (value < 0.01) return { ok: false, code: "RECEIVABLE_OUTSIDE_LEDGER" };

  const lines = [
    { role: debitRole(payment.method), debit: value, credit: 0 },
    { role: "AR" as const, debit: 0, credit: value },
  ];
  return generateAutoJournal(tx, "PAYMENT_RECEIPT", paymentId, lines, {
    date: payment.paidAt,
    description:
      excluded > 0
        ? `Pembayaran ${payment.docNo} (sebagian: ${excluded} piutang di luar buku besar)`
        : `Pembayaran ${payment.docNo}`,
    postedById,
  });
}

/**
 * A distinct `sourceType` is what lets the reversal coexist with the receipt under
 * `Journal @@unique([sourceType, sourceId])`. Both entries stay standing: a void is a reversing
 * entry, never a deletion of the original.
 *
 * Dated on `voidedAt`, not on `paidAt`. The reversal belongs to the period the correction was made
 * in — dating it back to the original payment would silently rewrite a prior period's cash.
 *
 * The reversal MIRRORS the receipt as posted — every line's debit and credit swapped on the same
 * chart account — and never recomputes it from the payment. A receipt can credit less than the
 * payment (allocations outside the ledger are excluded), and a role can be re-pointed between the
 * two posts; recomputing would reverse what was never posted. No standing receipt means nothing to
 * reverse.
 */
export async function postPaymentVoidJournal(
  paymentId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const payment = await client.payment.findUnique({
    where: { id: paymentId },
    select: { docNo: true, voidedAt: true, status: true },
  });
  if (!payment || payment.status !== "VOIDED" || payment.voidedAt === null) {
    return { ok: false, code: "NOTHING_TO_POST" };
  }
  const receipt = await client.journal.findUnique({
    where: { sourceType_sourceId: { sourceType: "PAYMENT_RECEIPT", sourceId: paymentId } },
    select: { lines: { select: { chartAccountId: true, debit: true, credit: true, memo: true } } },
  });
  if (!receipt) return { ok: false, code: "NOTHING_TO_POST" };
  try {
    const res = await postJournal(client, {
      source: { type: "PAYMENT_VOID", id: paymentId },
      date: payment.voidedAt,
      description: `Pembatalan pembayaran ${payment.docNo}`,
      postedById,
      lines: receipt.lines.map((l) => ({
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
