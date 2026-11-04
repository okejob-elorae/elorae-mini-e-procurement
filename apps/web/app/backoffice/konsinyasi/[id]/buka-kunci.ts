/**
 * Kenapa sebuah siklus tidak bisa dikunci atau dibuka kuncinya — aturan `kunciAngka` dan
 * `bukaKunci` (`lib/konsinyasi/writer.ts`) dibaca dari data rincian, supaya tombolnya mati dengan
 * alasan alih-alih ditolak sesudah diklik. Penulisnya tetap penjaga. Aman untuk peramban.
 */

/** Penghalang tagihan siklus di Piutang — salinan `KodePenghalangBatal` (modulnya ber-Prisma). */
export type PenghalangTagihan = "ADA_BKM" | "ADA_KONTRABON" | "ADA_PEMBAYARAN_TOKO" | "ADA_TUGAS_TAGIH";

/**
 * Urutannya SAMA dengan penulis: gaji dibayar → nomor nota → faktur pajak → penghalang tagihan
 * siklus di Piutang (BKM, kontrabon, uang toko, tugas tagih).
 */
export type AlasanTolakBukaKunci = "BELUM_DIKUNCI" | "ADA_GAJI_SUDAH_DIBAYAR" | "ADA_NOTA" | "ADA_FAKTUR_PAJAK" | PenghalangTagihan;

export function alasanTolakBukaKunci(s: {
  terkunci: boolean;
  noNota: string | null;
  noFakturPajak: string | null;
  komisi: { dibayarPada: string | null }[];
  penghalangTagihan: PenghalangTagihan | null;
}): AlasanTolakBukaKunci | null {
  if (!s.terkunci) return "BELUM_DIKUNCI";
  if (s.komisi.some((k) => k.dibayarPada !== null)) return "ADA_GAJI_SUDAH_DIBAYAR";
  if (s.noNota) return "ADA_NOTA";
  if (s.noFakturPajak) return "ADA_FAKTUR_PAJAK";
  return s.penghalangTagihan;
}

export type AlasanTolakKunci =
  | "SUDAH_DIKUNCI"
  | "BULAN_BELUM_SELESAI"
  | "SIKLUS_PERTAMA_BELUM_DIATUR"
  | "SEBELUM_SIKLUS_PERTAMA"
  | "LAPORAN_BELUM_LENGKAP"
  | "TOKO_TANPA_PEMEGANG";

/**
 * Urutannya SAMA dengan `kunciAngka`: sudah dikunci → bulan belum selesai (P30) → bulan siklus
 * pertama belum diatur / siklus sebelum bulan itu (P59) → laporan SPG dan toko belum keduanya →
 * toko tanpa salesman pemegang (P47). Nomor tagihan yang terpakai hanya diketahui penulisnya.
 */
export function alasanTolakKunci(s: {
  terkunci: boolean;
  bulanSelesai: boolean;
  siklusPertama: "BELUM_DIATUR" | "SEBELUM" | "OK";
  adaLaporanSpg: boolean;
  adaLaporanToko: boolean;
  adaPemegang: boolean;
}): AlasanTolakKunci | null {
  if (s.terkunci) return "SUDAH_DIKUNCI";
  if (!s.bulanSelesai) return "BULAN_BELUM_SELESAI";
  if (s.siklusPertama === "BELUM_DIATUR") return "SIKLUS_PERTAMA_BELUM_DIATUR";
  if (s.siklusPertama === "SEBELUM") return "SEBELUM_SIKLUS_PERTAMA";
  if (!s.adaLaporanSpg || !s.adaLaporanToko) return "LAPORAN_BELUM_LENGKAP";
  if (!s.adaPemegang) return "TOKO_TANPA_PEMEGANG";
  return null;
}
