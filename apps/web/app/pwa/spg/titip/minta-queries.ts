import { prisma } from "@elorae/db";
import type { BarisPembeli } from "../stok/minta/dari-pembeli";

/**
 * Barang titip pesan yang masih MENUNGGU, untuk tautan "Minta ke salesman".
 * Dikunci ke toko pemanggil; yang sudah datang/dikabari/ditutup tidak perlu
 * diminta lagi. Hanya untuk server component (menarik Prisma).
 */
export async function barangTitipMenunggu(storeId: string, ids: readonly string[]): Promise<Map<string, BarisPembeli>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.customerRequest.findMany({
    where: { storeId, id: { in: [...ids] }, status: "MENUNGGU" },
    select: { id: true, itemId: true, variantSku: true, qty: true },
  });
  return new Map(rows.map((r) => [r.id, { itemId: r.itemId, variantSku: r.variantSku, qty: r.qty }]));
}
