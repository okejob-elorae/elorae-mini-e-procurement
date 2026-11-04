import { prisma, type Prisma } from "@elorae/db";

type Klien = Prisma.TransactionClient | typeof prisma;

/**
 * Saldo buku stok toko untuk barang-barang ini, dikunci `${itemId}::${variantSku}`
 * (bentuk `kunciBaris`). Dihitung dari gerakan, tidak disimpan — sama dengan
 * layar stok SPG. Dibaca dengan klien transaksi pemanggil kalau ada, supaya
 * keputusan "sudah ada" dan perubahan statusnya melihat buku yang sama.
 */
export async function saldoBarangToko(klien: Klien, storeId: string, itemIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(itemIds.filter(Boolean))];
  if (ids.length === 0) return new Map();
  const grup = await klien.storeStockMovement.groupBy({
    by: ["itemId", "variantSku"],
    where: { storeId, itemId: { in: ids } },
    _sum: { qty: true },
  });
  return new Map(grup.map((g) => [`${g.itemId}::${g.variantSku}`, g._sum.qty ?? 0]));
}
