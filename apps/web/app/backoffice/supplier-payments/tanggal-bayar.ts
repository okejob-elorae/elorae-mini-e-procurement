import { formatDateOnlyJakarta, parseDateOnly, parseDateOnlyEnd } from "@/lib/date-only";

/*
 * Tanggal bayar pemasok. Murni (dipakai layar dan aksi `setPOPaidAt`).
 * Jurnal pembayaran pemasok diberi tanggal `paidAt`, jadi tanggal sesudah hari
 * ini (WIB) ditolak — kas tidak boleh keluar di hari yang belum terjadi.
 */

/** `paidAt` tidak lewat akhir hari ini WIB. */
export function tanggalBayarSah(paidAt: Date, sekarang: Date = new Date()): boolean {
  if (Number.isNaN(paidAt.getTime())) return false;
  const akhirHariIni = parseDateOnlyEnd(formatDateOnlyJakarta(sekarang));
  return akhirHariIni != null && paidAt.getTime() <= akhirHariIni.getTime();
}

/**
 * Isian "YYYY-MM-DD" dari dialog konfirmasi → `paidAt`. Hari ini = saat ini
 * (jamnya ikut tercatat, sama seperti tombol lama); hari lampau = awal hari itu
 * WIB. Sesudah hari ini atau isian rusak → null.
 */
export function tanggalBayarDariIsian(teks: string, sekarang: Date = new Date()): Date | null {
  const hari = teks.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hari)) return null;
  if (hari === formatDateOnlyJakarta(sekarang)) return sekarang;
  const awal = parseDateOnly(hari);
  if (!awal || !tanggalBayarSah(awal, sekarang)) return null;
  return awal;
}
