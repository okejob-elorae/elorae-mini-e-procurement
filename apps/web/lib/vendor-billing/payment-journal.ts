import { prisma, postJournal, JournalError, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";

type AnyClient = PrismaClient | Prisma.TransactionClient;

async function paymentOf(paymentId: string, client: AnyClient) {
  const p = await client.vendorPayment.findUnique({
    where: { id: paymentId },
    select: { docNumber: true, paidAt: true, method: true, amount: true },
  });
  return p ? { ...p, amount: Number(p.amount), cashRole: p.method === "CASH" ? ("CASH" as const) : ("BANK" as const) } : null;
}

/**
 * Dr AP / Cr BANK or CASH for a vendor bill payment. Idempotent by payment id. The AP it debits is
 * the payable booked when the billed goods or WO step work were received — a bill books none of its
 * own (`bill-journal.ts`) — so it is the same AP Supplier payments → Pay settles, and the payment
 * writer refuses a receipt already paid there (`refusePaidThroughSupplierPayments`).
 */
export async function postVendorPaymentJournal(
  paymentId: string,
  postedById: string,
  client: AnyClient = prisma
): Promise<GenerateAutoJournalResult> {
  const p = await paymentOf(paymentId, client);
  if (!p || p.amount < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  return generateAutoJournal(
    client,
    "VENDOR_PAYMENT",
    paymentId,
    [
      { role: "AP", debit: p.amount, credit: 0 },
      { role: p.cashRole, debit: 0, credit: p.amount },
    ],
    { date: p.paidAt, description: `Pembayaran vendor ${p.docNumber}`, postedById }
  );
}

/**
 * Mirrors the payment journal as posted (debit and credit swapped on the same chart account), dated
 * on `voidedAt`, like `postPaymentVoidJournal` for AR: a role re-pointed since the payment must not
 * move the reversal onto another account.
 */
export async function postVendorPaymentReversalJournal(
  paymentId: string,
  postedById: string,
  client: AnyClient = prisma
): Promise<GenerateAutoJournalResult> {
  const payment = await client.vendorPayment.findUnique({
    where: { id: paymentId },
    select: { docNumber: true, voidedAt: true },
  });
  if (!payment?.voidedAt) return { ok: false, code: "NOTHING_TO_POST" };
  const original = await client.journal.findUnique({
    where: { sourceType_sourceId: { sourceType: "VENDOR_PAYMENT", sourceId: paymentId } },
    select: { lines: { select: { chartAccountId: true, debit: true, credit: true, memo: true } } },
  });
  if (!original) return { ok: false, code: "NOTHING_TO_POST" };
  try {
    const res = await postJournal(client, {
      source: { type: "VENDOR_PAYMENT_REVERSAL", id: paymentId },
      date: payment.voidedAt,
      description: `Pembatalan pembayaran vendor ${payment.docNumber}`,
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
