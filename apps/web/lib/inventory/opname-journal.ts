import { prisma, Prisma, type PrismaClient, type StockLedgerRefType } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";

type AnyClient = PrismaClient | Prisma.TransactionClient;

const OPNAME_REF_TYPE = "StockOpname" satisfies StockLedgerRefType;

/**
 * Sums the ledger's totalCost for this opname's rows, both the per-line adjustments and the
 * fabric-aggregate component (opname-approve.ts's applyLineAdjustments and
 * applyFabricAdjustments both append under the same refType/refId).
 *
 * A null totalCost is never treated as zero. Every current writer stamps a real value here,
 * so a null can only mean a row written before the ledger carried cost columns at all — and
 * silently folding it into the sum would post a variance journal short by exactly that row's
 * value, with nothing on screen to flag it. Throw instead: this only runs at posting time for
 * a NEW opname (an already-posted journal is never recomputed), so a null here means the data
 * is wrong, not that the caller should guess.
 */
export async function opnameNetDelta(opnameId: string, client: AnyClient = prisma): Promise<number> {
  const rows = await client.stockLedgerEntry.findMany({
    where: { refType: OPNAME_REF_TYPE, refId: opnameId },
    select: { id: true, totalCost: true },
  });

  let sum = 0;
  for (const row of rows) {
    if (row.totalCost == null) {
      throw new Error(
        `opnameNetDelta: StockLedgerEntry ${row.id} for opname ${opnameId} has a null totalCost`,
      );
    }
    sum += Number(row.totalCost);
  }
  return sum;
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
