import { prisma } from "@elorae/db";

/**
 * Kunjungan yang mengikat kiriman dari antrean HP (dicatat tanpa sinyal).
 *
 * Kiriman di konter memakai check-in yang MASIH aktif. Kiriman dari antrean
 * diikat ke kunjungan saat pekerjaannya dilakukan — kunjungan itu harus milik
 * pengguna ini di toko itu, tapi boleh sudah check-out: sinyal sering baru
 * kembali sesudah orangnya pulang.
 *
 * HP mengenal kunjungannya lewat salah satu dari dua:
 * - `visitClientId` — check-in yang dicatat TANPA sinyal (`StoreVisit.clientId`,
 *   dibuat HP). Antrean mengirim check-in lebih dulu, jadi saat kiriman ini
 *   tiba kunjungannya sudah ada — kecuali check-in itu ditolak server.
 * - `visitId` — check-in yang tercatat dengan sinyal.
 *
 * `visitClientId` didahulukan: kalau keduanya terkirim, yang dari antrean
 * adalah kunjungan yang benar-benar sedang berjalan di HP. Mengembalikan id
 * kunjungan, atau `null` (pemanggil menjawab `KUNJUNGAN_TIDAK_SAH`).
 */
export async function cariKunjunganAntrean(k: {
  userId: string;
  storeId: string;
  visitId?: string | null;
  visitClientId?: string | null;
}): Promise<string | null> {
  const clientId = k.visitClientId?.trim() || null;
  const id = k.visitId?.trim() || null;
  if (!clientId && !id) return null;
  const v = await prisma.storeVisit.findFirst({
    where: { userId: k.userId, storeId: k.storeId, ...(clientId ? { clientId } : { id: id as string }) },
    select: { id: true },
  });
  return v?.id ?? null;
}
