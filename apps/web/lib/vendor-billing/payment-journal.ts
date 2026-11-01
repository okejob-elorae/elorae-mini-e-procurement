import { prisma, postJournal, JournalError, Prisma, type PrismaClient } from "@elorae/db";
import type { GenerateAutoJournalResult } from "@/lib/finance/journal";

type AnyClient = PrismaClient | Prisma.TransactionClient;

/*
 * A vendor payment posted Dr AP / Cr BANK or CASH (`VENDOR_PAYMENT`, by payment id) for the AP the
 * billed receipts booked. Vendor payments take no new payments since 2026-11-01
 * (`payment-writer.ts`), so no new `VENDOR_PAYMENT` journal is written; the ones posted before stay,
 * and voiding such a payment still mirrors its journal below.
 */

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
