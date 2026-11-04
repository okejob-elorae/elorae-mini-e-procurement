import { prisma } from "@elorae/db";

/**
 * Catatan "barang dicari tapi tidak ada" milik SATU SPG, untuk layar HP-nya.
 *
 * Dibatasi ke pencatatnya sendiri (bukan ke tokonya): layar ini menjawab
 * "apa yang sudah SAYA laporkan", supaya SPG tidak mencatat hal yang sama dua
 * kali. Rekap lintas toko ada di kantor (`daftarBarangDicari`).
 *
 * `LostSale` tidak punya relasi ke `Item`, jadi nama/SKU barang yang ditautkan
 * dicari dengan kueri kedua — satu kali untuk seluruh daftar, bukan per baris.
 */

export type BarangDicariSaya = {
  id: string;
  keterangan: string;
  qty: number;
  /** ISO — diformat di server component, bukan di klien. */
  waktu: string;
  itemId: string | null;
  /** SKU varian kalau ada, SKU barang kalau tidak; null kalau tak ditautkan. */
  sku: string | null;
};

export async function barangDicariSpg(userId: string, opsi: { batas?: number } = {}): Promise<BarangDicariSaya[]> {
  const rows = await prisma.lostSale.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: opsi.batas ?? 20,
    select: { id: true, description: true, qty: true, createdAt: true, itemId: true, variantSku: true },
  });

  const itemIds = [...new Set(rows.map((r) => r.itemId).filter((id): id is string => !!id))];
  const items = itemIds.length
    ? await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, sku: true } })
    : [];
  const skuBarang = new Map(items.map((i) => [i.id, i.sku]));

  return rows.map((r) => ({
    id: r.id,
    keterangan: r.description,
    qty: r.qty,
    waktu: r.createdAt.toISOString(),
    itemId: r.itemId,
    sku: r.itemId ? r.variantSku || skuBarang.get(r.itemId) || null : null,
  }));
}
