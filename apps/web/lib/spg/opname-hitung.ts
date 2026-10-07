import type { Prisma } from "@elorae/db";
import { kunciBaris } from "./stok";

/*
 * Waktu hitung opname toko per barang — dipakai setiap penulis yang bertanggal
 * mundur (antrean HP, pembalik barang hilang): barang yang sudah dihitung
 * opname SESUDAH waktu itu tidak boleh menggerakkan buku lagi. Modul sendiri
 * (bukan di `stok-writer.ts`) supaya penulis barang hilang bisa memakainya
 * tanpa impor melingkar.
 */

/**
 * Barang (kunci item::varian) yang sudah dihitung di opname toko SESUDAH
 * `waktu`. Pekerjaan dari antrean HP yang bertanggal sebelum opname itu tidak
 * boleh menggerakkan buku untuk barang ini lagi: opname sudah melihat raknya.
 */
export async function terhitungSesudah(
  tx: Prisma.TransactionClient,
  storeId: string,
  itemIds: string[],
  waktu: Date,
): Promise<Set<string>> {
  return new Set((await waktuHitungTerakhir(tx, storeId, itemIds, waktu)).keys());
}

/**
 * Waktu hitung terakhir per kunci barang di opname toko, hanya yang SESUDAH
 * `sejak`. Waktu hitung baris = `StoreOpnameLine.countedAt`; baris lama (atau
 * dari klien tanpa waktu hitung) memakai waktu opnamenya.
 */
export async function waktuHitungTerakhir(
  tx: Prisma.TransactionClient,
  storeId: string,
  itemIds: string[],
  sejak: Date,
): Promise<Map<string, Date>> {
  const hasil = new Map<string, Date>();
  if (itemIds.length === 0) return hasil;
  const baris = await tx.storeOpnameLine.findMany({
    where: {
      itemId: { in: itemIds },
      opname: { storeId },
      OR: [{ countedAt: { gt: sejak } }, { countedAt: null, opname: { countedAt: { gt: sejak } } }],
    },
    select: { itemId: true, variantSku: true, countedAt: true, opname: { select: { countedAt: true } } },
  });
  for (const b of baris) {
    const t = b.countedAt ?? b.opname.countedAt;
    const k = kunciBaris(b.itemId, b.variantSku);
    const ada = hasil.get(k);
    if (!ada || t.getTime() > ada.getTime()) hasil.set(k, t);
  }
  return hasil;
}
