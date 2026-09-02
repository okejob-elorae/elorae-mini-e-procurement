import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";

type AnyClient = PrismaClient | Prisma.TransactionClient;

/**
 * CASH lands in the cash account, TRANSFER in the bank account, RETUR_OFFSET reverses the
 * revenue leg it never really collected — the store settled with goods, not money, so the
 * "receipt" here is a revenue counter-entry (DR SALES_REVENUE / CR AR), the same shape a
 * marketplace sales-return revenue leg already posts. Both callers below route through this
 * one function, so the void reversal is correct for free.
 */
function debitRole(method: "CASH" | "TRANSFER" | "RETUR_OFFSET"): "CASH" | "BANK" | "SALES_REVENUE" {
  if (method === "CASH") return "CASH";
  if (method === "TRANSFER") return "BANK";
  return "SALES_REVENUE";
}

export async function postPaymentReceiptJournal(
  paymentId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const payment = await client.payment.findUnique({
    where: { id: paymentId },
    select: { docNo: true, amount: true, method: true, paidAt: true },
  });
  if (!payment) return { ok: false, code: "NOTHING_TO_POST" };
  const value = Number(payment.amount);
  if (Math.abs(value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  const lines = [
    { role: debitRole(payment.method), debit: value, credit: 0 },
    { role: "AR" as const, debit: 0, credit: value },
  ];
  return generateAutoJournal(client, "PAYMENT_RECEIPT", paymentId, lines, {
    date: payment.paidAt,
    description: `Pembayaran ${payment.docNo}`,
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
 */
export async function postPaymentVoidJournal(
  paymentId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const payment = await client.payment.findUnique({
    where: { id: paymentId },
    select: { docNo: true, amount: true, method: true, voidedAt: true, status: true },
  });
  if (!payment || payment.status !== "VOIDED" || payment.voidedAt === null) {
    return { ok: false, code: "NOTHING_TO_POST" };
  }
  const value = Number(payment.amount);
  if (Math.abs(value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  const lines = [
    { role: "AR" as const, debit: value, credit: 0 },
    { role: debitRole(payment.method), debit: 0, credit: value },
  ];
  return generateAutoJournal(client, "PAYMENT_VOID", paymentId, lines, {
    date: payment.voidedAt,
    description: `Pembatalan pembayaran ${payment.docNo}`,
    postedById,
  });
}
