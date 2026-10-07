import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";
import { peranPersediaan } from "@/lib/finance/journals/peran-persediaan";

type AnyClient = PrismaClient | Prisma.TransactionClient;

export async function opnameNetDelta(opnameId: string, client: AnyClient = prisma): Promise<number> {
  const moves = await client.stockMovement.findMany({
    where: { refType: "OPNAME", refId: opnameId },
    select: { totalCost: true },
  });
  return moves.reduce((sum, m) => sum + (m.totalCost == null ? 0 : Number(m.totalCost)), 0);
}

/**
 * Satu opname selalu satu jenis barang (`scope`), jadi persediaan yang disesuaikan
 * cukup satu peran: opname barang jadi menyentuh `INVENTORY_FG` — akun yang didebit
 * penerimaan barang jadi dan dikredit HPP penjualan — opname kain/aksesori
 * menyentuh `INVENTORY` (lihat peran-persediaan.ts).
 */
export async function postOpnameJournal(
  opnameId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const delta = await opnameNetDelta(opnameId, client);
  if (Math.abs(delta) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };

  const opname = await client.stockOpname.findUnique({ where: { id: opnameId }, select: { docNumber: true, scope: true } });
  // Lingkup opname memakai nama yang sama dengan tipe barang (FINISHED_GOOD / FABRIC / ACCESSORIES).
  const persediaan = peranPersediaan(opname?.scope);

  const lines =
    delta > 0
      ? [
          { role: persediaan, debit: delta, credit: 0 },
          { role: "INVENTORY_VARIANCE" as const, debit: 0, credit: delta },
        ]
      : [
          { role: "INVENTORY_VARIANCE" as const, debit: -delta, credit: 0 },
          { role: persediaan, debit: 0, credit: -delta },
        ];

  return generateAutoJournal(client, "OPNAME", opnameId, lines, {
    date: new Date(),
    description: `Opname adjustment ${opname?.docNumber ?? opnameId}`,
    postedById,
  });
}
