import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";

type AnyClient = PrismaClient | Prisma.TransactionClient;

async function paymentOf(paymentId: string, client: AnyClient) {
  const p = await client.vendorPayment.findUnique({
    where: { id: paymentId },
    select: { docNumber: true, paidAt: true, method: true, amount: true },
  });
  return p ? { ...p, amount: Number(p.amount), cashRole: p.method === "CASH" ? ("CASH" as const) : ("BANK" as const) } : null;
}

/** Dr AP / Cr BANK or CASH for a vendor bill payment. Idempotent by payment id. */
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

/** Mirror of the payment journal, posted only against one that exists. */
export async function postVendorPaymentReversalJournal(
  paymentId: string,
  postedById: string,
  client: AnyClient = prisma
): Promise<GenerateAutoJournalResult> {
  const original = await client.journal.findUnique({
    where: { sourceType_sourceId: { sourceType: "VENDOR_PAYMENT", sourceId: paymentId } },
    select: { id: true },
  });
  if (!original) return { ok: false, code: "NOTHING_TO_POST" };
  const p = await paymentOf(paymentId, client);
  if (!p || p.amount < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  return generateAutoJournal(
    client,
    "VENDOR_PAYMENT_REVERSAL",
    paymentId,
    [
      { role: p.cashRole, debit: p.amount, credit: 0 },
      { role: "AP", debit: 0, credit: p.amount },
    ],
    { date: new Date(), description: `Pembatalan pembayaran vendor ${p.docNumber}`, postedById }
  );
}
