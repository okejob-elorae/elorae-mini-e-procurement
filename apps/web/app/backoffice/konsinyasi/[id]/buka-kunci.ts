/**
 * Kenapa sebuah siklus tidak bisa dibuka kuncinya — aturan `bukaKunci`
 * (`lib/konsinyasi/writer.ts`) dibaca dari data rincian, supaya tombolnya mati
 * dengan alasan alih-alih ditolak sesudah diklik. Penulisnya tetap penjaga.
 *
 * Urutannya SAMA dengan penulis: gaji dibayar → nomor nota → faktur pajak →
 * pembayaran toko.
 */
export type AlasanTolakBukaKunci =
  | "BELUM_DIKUNCI"
  | "ADA_GAJI_SUDAH_DIBAYAR"
  | "ADA_NOTA"
  | "ADA_FAKTUR_PAJAK"
  | "ADA_PEMBAYARAN_TOKO";

export function alasanTolakBukaKunci(s: {
  terkunci: boolean;
  noNota: string | null;
  noFakturPajak: string | null;
  komisi: { dibayarPada: string | null }[];
  pembayaranToko: { dibatalkanPada: string | null }[];
}): AlasanTolakBukaKunci | null {
  if (!s.terkunci) return "BELUM_DIKUNCI";
  if (s.komisi.some((k) => k.dibayarPada !== null)) return "ADA_GAJI_SUDAH_DIBAYAR";
  if (s.noNota) return "ADA_NOTA";
  if (s.noFakturPajak) return "ADA_FAKTUR_PAJAK";
  if (s.pembayaranToko.some((p) => p.dibatalkanPada === null)) return "ADA_PEMBAYARAN_TOKO";
  return null;
}
