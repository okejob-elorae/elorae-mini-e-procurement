import { prisma } from "@elorae/db";

/*
 * Bacaan kredit retur pemasok per PO. Hanya retur yang SELESAI (COMPLETED)
 * mengurangi utang — retur yang masih diproses belum diakui pemasok.
 */

/** Σ `poCreditAmount` retur selesai per PO. PO tanpa retur tidak ada di peta. */
export async function kreditReturPerPo(poIds: readonly string[]): Promise<Map<string, number>> {
  const ids = [...new Set(poIds.filter((id) => typeof id === "string" && id.length > 0))];
  const peta = new Map<string, number>();
  if (ids.length === 0) return peta;
  const baris = await prisma.vendorReturn.groupBy({
    by: ["poId"],
    where: { poId: { in: ids }, status: "COMPLETED" },
    _sum: { poCreditAmount: true },
  });
  for (const b of baris) {
    if (b.poId) peta.set(b.poId, Number(b._sum.poCreditAmount ?? 0));
  }
  return peta;
}

export type ReturUntukPo = {
  id: string;
  docNumber: string;
  completedAt: string | null;
  poCreditAmount: number;
};

/** Retur selesai yang mengurangi utang satu PO, terbaru dulu. */
export async function returUntukPo(poId: string): Promise<ReturUntukPo[]> {
  if (!poId) return [];
  const rows = await prisma.vendorReturn.findMany({
    where: { poId, status: "COMPLETED" },
    select: { id: true, docNumber: true, completedAt: true, poCreditAmount: true },
    orderBy: { completedAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    docNumber: r.docNumber,
    completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    poCreditAmount: Number(r.poCreditAmount ?? 0),
  }));
}
