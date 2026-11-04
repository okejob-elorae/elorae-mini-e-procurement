/**
 * Laporan rekonsiliasi bank per tanggal — MURNI, dites.
 *
 *   saldo bank disesuaikan = saldo bank + Σ jurnal belum cocok
 *     (setoran dalam perjalanan masuk positif, pembayaran yang belum didebet bank negatif)
 *   saldo buku disesuaikan = saldo buku + Σ mutasi belum cocok
 *     (biaya admin, bunga, dan transfer yang belum dicatat)
 *   selisih = saldo bank disesuaikan − saldo buku  (harus 0)
 *
 * Kedua cara itu sama: selisih = (bank + jurnal belum cocok) − (buku). Bila
 * semua mutasi sudah dibukukan dan dicocokkan, kedua saldo disesuaikan sama.
 * Jurnal belum cocok hanya dihitung SEJAK mutasi pertama yang diimpor (sebelum
 * itu bank tidak punya data untuk dicocokkan).
 *
 * Semua angka dalam sen.
 */

export type RingkasanRekonsiliasi = {
  saldoBukuSen: number;
  saldoBankSen: number | null;
  jurnalBelumCocokSen: number;
  mutasiBelumCocokSen: number;
  saldoBankDisesuaikanSen: number | null;
  saldoBukuDisesuaikanSen: number;
  /** null bila saldo bank tidak diketahui. */
  selisihSen: number | null;
  cocok: boolean;
};

export function ringkasRekonsiliasi(input: {
  saldoBukuSen: number;
  saldoBankSen: number | null;
  jurnalBelumCocok: readonly { jumlahSen: number }[];
  mutasiBelumCocok: readonly { jumlahSen: number }[];
}): RingkasanRekonsiliasi {
  const jurnalBelumCocokSen = input.jurnalBelumCocok.reduce((s, j) => s + j.jumlahSen, 0);
  const mutasiBelumCocokSen = input.mutasiBelumCocok.reduce((s, m) => s + m.jumlahSen, 0);
  const saldoBukuDisesuaikanSen = input.saldoBukuSen + mutasiBelumCocokSen;
  const saldoBankDisesuaikanSen = input.saldoBankSen == null ? null : input.saldoBankSen + jurnalBelumCocokSen;
  const selisihSen = saldoBankDisesuaikanSen == null ? null : saldoBankDisesuaikanSen - saldoBukuDisesuaikanSen;
  return {
    saldoBukuSen: input.saldoBukuSen,
    saldoBankSen: input.saldoBankSen,
    jurnalBelumCocokSen,
    mutasiBelumCocokSen,
    saldoBankDisesuaikanSen,
    saldoBukuDisesuaikanSen,
    selisihSen,
    cocok: selisihSen === 0,
  };
}

/**
 * Saldo bank pada akhir sebuah hari dari baris mutasi yang membawa saldo. Di
 * antara baris pada tanggal terakhir ≤ `tanggal`, yang diambil adalah baris
 * yang saldonya BUKAN saldo-sebelum (saldo − jumlah) baris lain di hari itu —
 * yaitu baris terakhir hari itu tanpa bergantung pada urutan penyimpanan.
 * Bila tidak bisa ditentukan, baris terakhir menurut `urutan`.
 *
 * Tanpa baris bersaldo: saldo awal impor tertua + Σ mutasi sampai tanggal itu
 * (null bila saldo awalnya pun tidak diketahui).
 */
export function saldoBankPadaTanggal(
  baris: readonly { tanggal: string; jumlahSen: number; saldoSen: number | null; urutan: number }[],
  tanggal: string,
  saldoAwal: { tanggal: string; sen: number } | null,
): number | null {
  const sampai = baris.filter((b) => b.tanggal <= tanggal);
  const bersaldo = sampai.filter((b) => b.saldoSen != null);
  if (bersaldo.length > 0) {
    const hariTerakhir = bersaldo.reduce((t, b) => (b.tanggal > t ? b.tanggal : t), bersaldo[0].tanggal);
    const hari = bersaldo.filter((b) => b.tanggal === hariTerakhir).sort((a, b) => a.urutan - b.urutan);
    const sebelum = new Set(hari.map((b) => (b.saldoSen as number) - b.jumlahSen));
    const akhir = hari.filter((b) => !sebelum.has(b.saldoSen as number));
    const pilih = akhir.length === 1 ? akhir[0] : hari[hari.length - 1];
    return pilih.saldoSen;
  }
  if (!saldoAwal || tanggal < saldoAwal.tanggal) return null;
  return saldoAwal.sen + sampai.filter((b) => b.tanggal >= saldoAwal.tanggal).reduce((s, b) => s + b.jumlahSen, 0);
}
