import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";

type AnyClient = PrismaClient | Prisma.TransactionClient;

export async function postFgReceiptJournal(
  receiptId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const receipt = await client.fGReceipt.findUnique({
    where: { id: receiptId },
    select: { totalCostValue: true, qtyAccepted: true, docNumber: true, receivedAt: true },
  });
  if (!receipt) return { ok: false, code: "NOTHING_TO_POST" };
  const value = receipt.totalCostValue == null ? 0 : Number(receipt.totalCostValue);
  if (Number(receipt.qtyAccepted) <= 0 || Math.abs(value) < 0.01) {
    return { ok: false, code: "NOTHING_TO_POST" };
  }
  const lines = [
    { role: "INVENTORY_FG" as const, debit: value, credit: 0 },
    { role: "INVENTORY" as const, debit: 0, credit: value },
  ];
  return generateAutoJournal(client, "FG_RECEIPT", receiptId, lines, {
    date: receipt.receivedAt ?? new Date(),
    description: `FG receipt ${receipt.docNumber}`,
    postedById,
  });
}
