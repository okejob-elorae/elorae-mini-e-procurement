import { prisma, Prisma, type PrismaClient } from "@elorae/db";
import { generateAutoJournal, type GenerateAutoJournalResult } from "@/lib/finance/journal";
import { bagiTotalPerPeranPersediaan, type NilaiPerPeran } from "@/lib/finance/journals/peran-persediaan";

type AnyClient = PrismaClient | Prisma.TransactionClient;

type BarisGrnTersimpan = { itemId?: unknown; itemType?: unknown; totalCost?: unknown; qty?: unknown; unitCost?: unknown };

function bacaBaris(raw: unknown): BarisGrnTersimpan[] {
  let arr: unknown = raw;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return Array.isArray(arr) ? (arr as BarisGrnTersimpan[]) : [];
}

/**
 * Nilai GRN dipecah per peran persediaan menurut tipe barang tiap baris: barang
 * jadi yang dibeli jadi masuk `INVENTORY_FG` (akun yang dikredit HPP saat
 * barang itu terjual), kain/aksesori masuk `INVENTORY`. Σ pecahan = `totalAmount`
 * persis (nilai hutang yang dibayar pemasok tidak berubah).
 */
async function grnValue(
  grnId: string,
  client: AnyClient,
): Promise<{ value: number; docNumber: string; grnDate: Date; perPeran: NilaiPerPeran[] } | null> {
  const grn = await client.gRN.findUnique({ where: { id: grnId }, select: { totalAmount: true, docNumber: true, grnDate: true, items: true } });
  if (!grn) return null;
  const value = Number(grn.totalAmount);
  const baris = bacaBaris(grn.items);
  const tanpaTipe = [...new Set(baris.filter((b) => typeof b.itemType !== "string" && typeof b.itemId === "string").map((b) => b.itemId as string))];
  const tipeBarang = new Map(
    tanpaTipe.length
      ? (await client.item.findMany({ where: { id: { in: tanpaTipe } }, select: { id: true, type: true } })).map((i) => [i.id, i.type as string])
      : [],
  );
  const perPeran = bagiTotalPerPeranPersediaan(
    value,
    baris.map((b) => ({
      tipeBarang: typeof b.itemType === "string" ? b.itemType : typeof b.itemId === "string" ? tipeBarang.get(b.itemId) : null,
      nilai: b.totalCost != null ? Number(b.totalCost) : Number(b.qty ?? 0) * Number(b.unitCost ?? 0),
    })),
  );
  return { value, docNumber: grn.docNumber, grnDate: grn.grnDate, perPeran };
}

export async function postGrnJournal(
  grnId: string,
  postedById: string,
  client: AnyClient = prisma,
): Promise<GenerateAutoJournalResult> {
  const grn = await grnValue(grnId, client);
  if (!grn || Math.abs(grn.value) < 0.01) return { ok: false, code: "NOTHING_TO_POST" };
  const lines = [
    ...grn.perPeran.map((p) => ({ role: p.role, debit: p.nilai, credit: 0 })),
    { role: "AP" as const, debit: 0, credit: grn.value },
  ];
  return generateAutoJournal(client, "GRN", grnId, lines, {
    date: grn.grnDate ?? new Date(),
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
    ...grn.perPeran.map((p) => ({ role: p.role, debit: 0, credit: p.nilai })),
  ];
  return generateAutoJournal(client, "GRN_REVERSAL", grnId, lines, {
    date: new Date(),
    description: `GRN reversal ${grn.docNumber}`,
    postedById,
  });
}
