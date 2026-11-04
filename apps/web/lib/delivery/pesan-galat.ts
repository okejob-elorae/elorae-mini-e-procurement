/**
 * Kalimat penolakan sebuah aksi pengiriman untuk layar (backoffice dan HP). Murni, aman di klien.
 *
 * Dua penolakan membawa `detail` yang BUKAN nomor dokumen dan tidak boleh tampil mentah:
 * - `TERIMA_GAGAL`: `detail` = kode alasan tanda terima toko (`AlasanTolakTerima`, mis.
 *   `SUDAH_DITERIMA`). Diterjemahkan lewat kalimat penerimaan toko (`pwa.spgTerima.err.<kode>`);
 *   kode yang tidak punya kalimat memakai kalimat umum, tidak pernah kodenya.
 * - `RECEIVABLE_PAID` tanpa `detail` (sudah dibayar, tanpa laporan bernomor): kalimatnya sendiri,
 *   supaya tidak terbaca "sudah dibayar ()".
 * Penolakan lain: `err.<kode>` dengan `detail` apa adanya (nomor dokumen, atau kosong).
 *
 * Penerjemah dioper sebagai fungsi biasa supaya modul ini tidak bergantung pada tipe next-intl.
 */
export type PenerjemahGalat = {
  /** `deliveryShipments.<kunci>` dengan nilainya. */
  teks: (kunci: string, nilai?: Record<string, string>) => string;
  /** Ada kalimat penerimaan toko untuk kode ini (`pwa.spgTerima.err.<kode>`)? */
  adaSebab: (kode: string) => boolean;
  /** Kalimat penerimaan toko untuk kode ini. */
  sebab: (kode: string) => string;
};

export function pesanGagalPengiriman(reason: string, detail: string | undefined, t: PenerjemahGalat): string {
  const isi = detail?.trim() ?? "";
  if (reason === "TERIMA_GAGAL") {
    const sebab = isi && t.adaSebab(isi) ? t.sebab(isi) : t.teks("err.TERIMA_GAGAL_LAIN");
    return t.teks("err.TERIMA_GAGAL", { detail: sebab });
  }
  if (reason === "RECEIVABLE_PAID" && !isi) return t.teks("err.RECEIVABLE_PAID_TANPA_LAPORAN");
  return t.teks(`err.${reason}`, { detail: isi });
}
