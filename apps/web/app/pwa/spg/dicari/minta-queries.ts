import { prisma } from "@elorae/db";
import type { BarisPembeli } from "../stok/minta/dari-pembeli";

/**
 * Barang/varian catatan "barang dicari" milik SPG ini DI TOKONYA SEKARANG, untuk
 * tautan "Minta ke salesman" per baris. Dikunci ke pencatat (sama dengan daftar
 * di layar) DAN ke toko: catatan dari toko lama SPG yang dipindah tidak boleh
 * menjadi permintaan "dicari pembeli" untuk toko barunya. Hanya untuk server
 * component (menarik Prisma).
 */
export async function barangDicariUntukMinta(
  userId: string,
  storeId: string,
  ids: readonly string[],
): Promise<Map<string, BarisPembeli>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.lostSale.findMany({
    where: { userId, storeId, id: { in: [...ids] } },
    select: { id: true, itemId: true, variantSku: true, qty: true },
  });
  return new Map(rows.map((r) => [r.id, { itemId: r.itemId, variantSku: r.variantSku, qty: r.qty }]));
}
