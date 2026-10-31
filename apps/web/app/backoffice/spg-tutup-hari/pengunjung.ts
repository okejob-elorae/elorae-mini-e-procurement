/**
 * Satu angka pengunjung untuk semua layar kantor (aturan yang sama dengan
 * Kinerja SPG): penghitung +1 di HP SPG lebih dulu, angka yang diketik di
 * laporan tutup hari hanya bila hari itu tidak ada yang menghitung. Murni —
 * aman diimpor komponen klien.
 */

export type SumberPengunjung = "PENGHITUNG" | "LAPORAN";

export type PengunjungDipakai = {
  angka: number | null;
  sumber: SumberPengunjung | null;
  /** Angka laporan tutup hari yang berbeda dari penghitung — ditampilkan berdampingan. */
  laporanBeda: number | null;
};

/** Satu toko satu hari. `null` = tidak ada hitungan (beda dengan 0). */
export function pengunjungDipakai(penghitung: number | null, laporan: number | null): PengunjungDipakai {
  if (penghitung !== null) {
    return { angka: penghitung, sumber: "PENGHITUNG", laporanBeda: laporan !== null && laporan !== penghitung ? laporan : null };
  }
  if (laporan !== null) return { angka: laporan, sumber: "LAPORAN", laporanBeda: null };
  return { angka: null, sumber: null, laporanBeda: null };
}

/** Satu toko untuk rentang: jumlah angka yang dipakai per hari. */
export function pengunjungRentang(hari: readonly { penghitung: number | null; laporan: number | null }[]): {
  angka: number | null;
  /** Ada hari yang angkanya dari laporan tutup hari (tanpa penghitung). */
  adaDariLaporan: boolean;
} {
  let angka: number | null = null;
  let adaDariLaporan = false;
  for (const h of hari) {
    const p = pengunjungDipakai(h.penghitung, h.laporan);
    if (p.angka === null) continue;
    angka = (angka ?? 0) + p.angka;
    if (p.sumber === "LAPORAN") adaDariLaporan = true;
  }
  return { angka, adaDariLaporan };
}

/** Kunci peta toko × hari yang dikirim halaman ke klien. */
export const kunciTokoHari = (storeId: string, day: string) => `${storeId}|${day}`;
