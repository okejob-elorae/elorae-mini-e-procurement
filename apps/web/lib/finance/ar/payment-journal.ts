import { prisma, postJournal, JournalError, Prisma, type PrismaClient } from "@elorae/db";
import { roundCents } from "@elorae/db/pricing";
import { generateAutoJournal, type AutoJournalLine, type GenerateAutoJournalResult } from "@/lib/finance/journal";
import { withRetry } from "@/lib/db/tx-retry";
import { JENIS_TERTUNDA_LAPANGAN, SUMBER_LAPANGAN, SUMBER_NOTA_LAMA } from "@/lib/finance/lapangan/aturan";
import { SELL_THROUGH_JOURNAL_SOURCE_TYPES } from "@/lib/konsi-sell-through/journal";
import { findDeliveryRevenuePendingFlags, findJournalPendingFlagsOfKinds } from "./journal-pending";
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
 * bank. ROUNDING_ADJUSTMENT closes a sub-rupiah residue no store can pay in cash, so the
 * business absorbs it as ROUNDING_EXPENSE; `recordRoundingAdjustment` is its only writer.
 */
function debitRole(
  method: "CASH" | "TRANSFER" | "RETUR_OFFSET" | "PROGRAM_DEDUCTION" | "ADMIN_FEE" | "ROUNDING_ADJUSTMENT",
): "CASH" | "BANK" | "SALES_REVENUE" | "TRADE_PROGRAM_EXPENSE" | "ADMIN_FEE_EXPENSE" | "ROUNDING_EXPENSE" {
  if (method === "CASH") return "CASH";
  if (method === "TRANSFER") return "BANK";
  if (method === "PROGRAM_DEDUCTION") return "TRADE_PROGRAM_EXPENSE";
  if (method === "ADMIN_FEE") return "ADMIN_FEE_EXPENSE";
  if (method === "ROUNDING_ADJUSTMENT") return "ROUNDING_EXPENSE";
  return "SALES_REVENUE";
}

/**
 * A rounding adjustment always carries exactly one allocation, so it can never post the partial
 * `sebagian` form: an excluded allocation leaves nothing to credit and refuses outright.
 */
function receiptDescription(docNo: string, method: string, excluded: number): string {
  if (method === "ROUNDING_ADJUSTMENT") return `Penyesuaian pembulatan ${docNo}`;
  if (excluded > 0) return `Pembayaran ${docNo} (sebagian: ${excluded} piutang di luar buku besar)`;
  return `Pembayaran ${docNo}`;
}

/**
 * The receivables role a store invoice's own journal debited. Every store invoice posted today
 * debits AR_STORE — the nota journal (`FIELD_DELIVERY`), a konsi sell-through invoice and a
 * MANUAL/IMPORT invoice (`STORE_INVOICE`) — and tags that line with the role name as its memo. A
 * journal with no such line is the old shape, which debited AR, so its receipt credits AR: crediting
 * an account the invoice never debited would leave one account negative and the other overstated by
 * the same amount.
 */
export type StoreReceivableRole = "AR" | "AR_STORE";

const AR_STORE_MEMO = "AR_STORE";

type ReceivableVerdict = { gate: ArReceiptGateCode | null; role: StoreReceivableRole };

/**
 * One entry per requested receivable id: `gate` is `null` when the journal that debited it stands,
 * otherwise the code saying why it does not; `role` is the account that journal debited. The source
 * is resolved through `resolveReceivableSource`, never `receivable.delivery`, since a receivable is
 * backed by a putus delivery, a konsi sell-through report, or only its own invoice number.
 *
 * A delivery is in the ledger once its nota journal stands, or the revenue half of the old pair
 * (`SUMBER_NOTA_LAMA`) does. Its post is late when either kind a delivery post fails under is
 * flagged — `field_delivery_revenue` or the nota engine's own `nota_putus`. A MANUAL/IMPORT invoice
 * is in the ledger once its first-generation `STORE_INVOICE` journal stands, and late while its
 * `faktur_piutang` post is flagged.
 */
async function classifyReceivables(
  ids: string[],
  client: AnyClient,
): Promise<Map<string, ReceivableVerdict>> {
  const result = new Map<string, ReceivableVerdict>();
  if (ids.length === 0) return result;

  const rows = await client.receivable.findMany({
    where: { id: { in: ids } },
    select: { id: true, ...RECEIVABLE_SOURCE_SELECT },
  });
  const deliveryOf = new Map<string, string>();
  const sellThroughOf = new Map<string, string>();
  const invoiceIds = new Set<string>();
  for (const row of rows) {
    try {
      const source = resolveReceivableSource(row);
      if (source.kind === "DELIVERY") deliveryOf.set(row.id, source.deliveryId);
      else if (source.kind === "SELL_THROUGH") sellThroughOf.set(row.id, source.sellThroughId);
      else invoiceIds.add(row.id);
    } catch (e) {
      if (!(e instanceof ReceivableSourceMissingError)) throw e;
    }
  }

  /* sourceId → the role its journal debited, preferring the first of `sourceTypes` that stands. */
  const journaledRoles = async (sourceTypes: string[], sourceIds: string[]): Promise<Map<string, StoreReceivableRole>> => {
    const roles = new Map<string, StoreReceivableRole>();
    if (sourceIds.length === 0) return roles;
    const journals = await client.journal.findMany({
      where: { sourceType: { in: sourceTypes }, sourceId: { in: sourceIds } },
      select: { sourceType: true, sourceId: true, lines: { select: { memo: true, debit: true } } },
    });
    const rank = (sourceType: string | null) => sourceTypes.indexOf(sourceType ?? "");
    journals.sort((x, y) => rank(x.sourceType) - rank(y.sourceType));
    for (const j of journals) {
      if (j.sourceId === null || roles.has(j.sourceId)) continue;
      const storeLine = j.lines.some((l) => l.memo === AR_STORE_MEMO && Number(l.debit) > 0);
      roles.set(j.sourceId, storeLine ? "AR_STORE" : "AR");
    }
    return roles;
  };
  const deliveryIds = [...new Set(deliveryOf.values())];
  const deliveryJournaled = await journaledRoles([SUMBER_LAPANGAN.NOTA, SUMBER_NOTA_LAMA.PENDAPATAN], deliveryIds);
  const sellThroughJournaled = await journaledRoles(
    [SELL_THROUGH_JOURNAL_SOURCE_TYPES.konsi_sell_through_revenue],
    [...new Set(sellThroughOf.values())],
  );
  const invoiceJournaled = await journaledRoles([SUMBER_LAPANGAN.FAKTUR], [...invoiceIds]);
  const failedDeliveryPosts = await findDeliveryRevenuePendingFlags(deliveryIds.filter((id) => !deliveryJournaled.has(id)));
  const failedInvoicePosts = await findJournalPendingFlagsOfKinds(
    [JENIS_TERTUNDA_LAPANGAN[SUMBER_LAPANGAN.FAKTUR]],
    [...invoiceIds].filter((id) => !invoiceJournaled.has(id)),
  );

  const outside: ReceivableVerdict = { gate: "RECEIVABLE_OUTSIDE_LEDGER", role: "AR_STORE" };
  const late: ReceivableVerdict = { gate: "RECEIVABLE_REVENUE_NOT_POSTED_YET", role: "AR_STORE" };
  for (const id of ids) {
    const deliveryId = deliveryOf.get(id);
    const sellThroughId = sellThroughOf.get(id);
    if (deliveryId !== undefined) {
      const role = deliveryJournaled.get(deliveryId);
      if (role) result.set(id, { gate: null, role });
      else result.set(id, failedDeliveryPosts.has(deliveryId) ? late : outside);
    } else if (sellThroughId !== undefined) {
      const role = sellThroughJournaled.get(sellThroughId);
      result.set(id, role ? { gate: null, role } : late);
    } else if (invoiceIds.has(id)) {
      const role = invoiceJournaled.get(id);
      if (role) result.set(id, { gate: null, role });
      else result.set(id, failedInvoicePosts.has(id) ? late : outside);
    } else {
      result.set(id, outside);
    }
  }
  return result;
}

/**
 * Posts DR <method's role> / CR the store receivable for the part of the payment this ledger can
 * credit: the sum of the allocations whose invoice's own journal stands. That journal is the only
 * thing that debited the receivable here, so crediting it for any other allocation would drive
 * Piutang below what the books ever carried — the same counterpart gate `classifySaleLeg` applies to
 * marketplace returns. Each allocation credits the role its invoice's journal debited
 * (`StoreReceivableRole`), so a payment settling both an old-shape invoice and a current one posts
 * one credit line per role. The AR_STORE line carries the store, which is how the store-receivables
 * reconciliation reads its balance per store.
 *
 * Any allocation whose invoice journal is merely late (`RECEIVABLE_REVENUE_NOT_POSTED_YET`) refuses
 * the WHOLE payment, so a retry once that journal posts credits the payment in full rather than
 * leaving a partial receipt standing for good. Allocations outside the ledger are excluded and the
 * rest posts, with the description saying so; only when nothing is left does it refuse
 * `RECEIVABLE_OUTSIDE_LEDGER`. A mixed payment is common, since settlement approval allocates
 * oldest-first across backfilled and live invoices.
 *
 * For a delivery-backed invoice, "late" means a `JOURNAL_PENDING` flag exists for its revenue post
 * (`field_delivery_revenue` or `nota_putus`), never merely a missing journal: every backfilled
 * delivery has no journal by construction, and the flag is the only evidence a post was attempted and failed (the
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
      storeId: true,
      allocations: { select: { receivableId: true, amount: true } },
    },
  });
  if (!payment) return { ok: false, code: "NOTHING_TO_POST" };
  if (Math.abs(Number(payment.amount)) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };

  const verdicts = await classifyReceivables(
    payment.allocations.map((a) => a.receivableId),
    tx,
  );
  if (payment.allocations.some((a) => verdicts.get(a.receivableId)?.gate === "RECEIVABLE_REVENUE_NOT_POSTED_YET")) {
    return { ok: false, code: "RECEIVABLE_REVENUE_NOT_POSTED_YET" };
  }
  const inLedger = payment.allocations.filter((a) => verdicts.get(a.receivableId)?.gate === null);
  const excluded = payment.allocations.length - inLedger.length;
  const creditByRole = new Map<StoreReceivableRole, number>();
  for (const a of inLedger) {
    const role = verdicts.get(a.receivableId)!.role;
    creditByRole.set(role, (creditByRole.get(role) ?? 0) + Number(a.amount));
  }
  const credits = [...creditByRole].map(([role, amount]) => ({ role, amount: roundCents(amount) })).filter((c) => c.amount >= 0.01);
  const value = roundCents(credits.reduce((sum, c) => sum + c.amount, 0));
  if (value < 0.01) return { ok: false, code: "RECEIVABLE_OUTSIDE_LEDGER" };

  const lines: AutoJournalLine[] = [
    { role: debitRole(payment.method), debit: value, credit: 0 },
    ...credits.map((c) => ({
      role: c.role,
      debit: 0,
      credit: c.amount,
      ...(c.role === "AR_STORE" ? { storeId: payment.storeId } : {}),
    })),
  ];
  return generateAutoJournal(tx, "PAYMENT_RECEIPT", paymentId, lines, {
    date: payment.paidAt,
    description: receiptDescription(payment.docNo, payment.method, excluded),
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
 * chart account, store and channel — and never recomputes it from the payment. A receipt can credit less than the
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
    select: { lines: { select: { chartAccountId: true, debit: true, credit: true, memo: true, channel: true, storeId: true } } },
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
        ...(l.channel ? { channel: l.channel } : {}),
        ...(l.storeId ? { storeId: l.storeId } : {}),
      })),
    });
    return { ok: true, journalId: res.journalId, created: res.created };
  } catch (e) {
    if (e instanceof JournalError && e.code === "UNBALANCED") return { ok: false, code: "UNBALANCED" };
    throw e;
  }
}
