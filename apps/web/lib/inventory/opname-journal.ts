import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";

type AnyClient = PrismaClient | Prisma.TransactionClient;

export async function opnameNetDelta(opnameId: string, client: AnyClient = prisma): Promise<number> {
  const moves = await client.stockMovement.findMany({
    where: { refType: "OPNAME", refId: opnameId },
    select: { totalCost: true },
  });
  return moves.reduce((sum, m) => sum + (m.totalCost == null ? 0 : Number(m.totalCost)), 0);
}

export async function postOpnameJournal(
  opnameId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const delta = await opnameNetDelta(opnameId, client);
  if (Math.abs(delta) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };

  const lines =
    delta > 0
      ? [
          { role: "INVENTORY" as const, debit: delta, credit: 0 },
          { role: "INVENTORY_VARIANCE" as const, debit: 0, credit: delta },
        ]
      : [
          { role: "INVENTORY_VARIANCE" as const, debit: -delta, credit: 0 },
          { role: "INVENTORY" as const, debit: 0, credit: -delta },
        ];

  const opname = await client.stockOpname.findUnique({ where: { id: opnameId }, select: { docNumber: true } });

  return generateAutoJournal(client, "OPNAME", opnameId, lines, {
    date: new Date(),
    description: `Opname adjustment ${opname?.docNumber ?? opnameId}`,
    postedById,
  });
}
