import { prisma } from "@elorae/db";
import { adalahKodeHasil, type KodeHasil } from "@/lib/salesman/hasil-kunjungan";
import { bacaTandaCheckin, type TandaCheckin } from "@/lib/salesman/checkin-janggal";

/**
 * Hasil kunjungan dan tanda check-in untuk riwayat kunjungan di halaman toko
 * (backoffice). Terpisah dari `listVisitsForStore` supaya riwayat lama tetap
 * jalan tanpa kolom ini, dan kolom baru dibaca lewat satu penerjemah.
 */
export type DetailKunjungan = {
  /** Kode hasil yang dikenal; kosong atau kode tak dikenal → null. */
  outcome: KodeHasil | null;
  outcomeNote: string | null;
  /** Akurasi GPS saat check-in (meter), bila HP melaporkannya. */
  akurasiMeter: number | null;
  /** Tanda janggal; `[]` = diperiksa dan bersih, juga untuk kunjungan lama. */
  tanda: TandaCheckin[];
  /** Pengguna ini SPG (punya toko tetap): check-in = absensi, tanpa hasil kunjungan. */
  spg: boolean;
};

export async function detailKunjunganToko(visitIds: string[]): Promise<Map<string, DetailKunjungan>> {
  const hasil = new Map<string, DetailKunjungan>();
  if (visitIds.length === 0) return hasil;
  const baris = await prisma.storeVisit.findMany({
    where: { id: { in: visitIds } },
    select: {
      id: true,
      outcome: true,
      outcomeNote: true,
      checkinAccuracyMeters: true,
      checkinFlags: true,
      user: { select: { assignedStoreId: true } },
    },
  });
  for (const b of baris) {
    hasil.set(b.id, {
      outcome: adalahKodeHasil(b.outcome) ? b.outcome : null,
      outcomeNote: b.outcomeNote,
      akurasiMeter: b.checkinAccuracyMeters,
      tanda: bacaTandaCheckin(b.checkinFlags),
      spg: Boolean(b.user?.assignedStoreId),
    });
  }
  return hasil;
}
