import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";

type AnyClient = PrismaClient | Prisma.TransactionClient;

async function grnValue(grnId: string, client: AnyClient): Promise<{ value: number; docNumber: string } | null> {
  const grn = await client.gRN.findUnique({ where: { id: grnId }, select: { totalAmount: true, docNumber: true } });
  if (!grn) return null;
  return { value: Number(grn.totalAmount), docNumber: grn.docNumber };
}

export async function postGrnJournal(
  grnId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const grn = await grnValue(grnId, client);
  if (!grn || Math.abs(grn.value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  const lines = [
    { role: "INVENTORY" as const, debit: grn.value, credit: 0 },
    { role: "AP" as const, debit: 0, credit: grn.value },
  ];
  return generateAutoJournal(client, "GRN", grnId, lines, {
    date: new Date(),
    description: `GRN ${grn.docNumber}`,
    postedById,
  });
}

export async function postGrnReversalJournal(
  grnId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const grn = await grnValue(grnId, client);
  if (!grn || Math.abs(grn.value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  const lines = [
    { role: "AP" as const, debit: grn.value, credit: 0 },
    { role: "INVENTORY" as const, debit: 0, credit: grn.value },
  ];
  return generateAutoJournal(client, "GRN_REVERSAL", grnId, lines, {
    date: new Date(),
    description: `GRN reversal ${grn.docNumber}`,
    postedById,
  });
}
