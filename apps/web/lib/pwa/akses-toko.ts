import { prisma } from "@elorae/db";
import { ambilTokoTetap } from "@/lib/pwa/peran";
import { tokoTerkunci } from "@/lib/salesman/queries";
import { bolehPegangToko } from "@/lib/stores/penanggung-jawab";

/**
 * Bolehkah pengguna HP membaca data SATU toko (katalog berharga, stok rak).
 * Aturan yang sama dengan check-in (`nilaiCheckIn`, app/pwa/stores/actions.ts)
 * dan halaman toko:
 * - SPG (punya `User.assignedStoreId`) hanya tokonya sendiri.
 * - Salesman: kunci "hanya toko sendiri" (`salesman.tokoTerkunci`) — selama
 *   menyala, hanya toko yang ia pegang; toko tanpa pemegang tertutup.
 *
 * Dijaga di rute data, bukan hanya di halaman: rute bisa dipanggil langsung
 * dengan `storeId` mana pun.
 */
export type AksesTokoHp =
  | { ok: true; spg: boolean }
  | { ok: false; code: "TOKO_TIDAK_ADA" | "STORE_NOT_ASSIGNED" };

export async function aksesTokoHp(userId: string, storeId: string): Promise<AksesTokoHp> {
  const tokoTetap = await ambilTokoTetap(userId);
  if (tokoTetap !== null) {
    return tokoTetap === storeId ? { ok: true, spg: true } : { ok: false, code: "STORE_NOT_ASSIGNED" };
  }
  const [terkunci, toko] = await Promise.all([
    tokoTerkunci(),
    prisma.store.findUnique({ where: { id: storeId }, select: { salesmanId: true } }),
  ]);
  if (!toko) return { ok: false, code: "TOKO_TIDAK_ADA" };
  if (!bolehPegangToko({ terkunci, penanggungJawabId: toko.salesmanId, userId })) {
    return { ok: false, code: "STORE_NOT_ASSIGNED" };
  }
  return { ok: true, spg: false };
}
