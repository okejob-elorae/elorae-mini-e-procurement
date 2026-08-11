/**
 * Disclosures the on-screen reports show, restated for the artifacts that leave
 * the app — the Excel exports and the browser-print views. Those are what gets
 * emailed to an accountant, so they must carry the same caveats as the screen.
 *
 * Indonesian only, and deliberately NOT wired through next-intl: the print
 * pages have no locale provider and the Excel sheets are generated server-side
 * outside a request locale. The wording mirrors the `financeReports.*` keys in
 * `id.json`; keep the two in step when either changes.
 */

export const TRIAL_BALANCE_BALANCED_NOTE =
  "Debit dan kredit seimbang. Setiap jurnal sudah divalidasi seimbang saat diposting, jadi kesamaan ini memang diharapkan — pemeriksaan ini hanya mendeteksi data yang rusak.";

export const TRIAL_BALANCE_UNBALANCED_NOTE =
  "Debit dan kredit TIDAK seimbang. Ini menandakan data jurnal rusak — periksa buku besar.";

export const INCOME_STATEMENT_COVERAGE_TITLE = "Cakupan data";

export const INCOME_STATEMENT_COVERAGE_BODY =
  "Laporan ini hanya mencakup transaksi yang sudah menghasilkan jurnal: penjualan marketplace, retur, settlement, penerimaan barang (GRN), hasil produksi, penyesuaian stock opname, dan jurnal manual. BELUM termasuk: penjualan lapangan (putus), penjualan kanvas, penjualan SPG, dan pembayaran ke pemasok.";

export const BALANCE_SHEET_OPENING_TITLE = "Saldo awal belum dicatat";

export function balanceSheetOpeningBody(dateLabel: string): string {
  return `Jurnal paling awal bertanggal ${dateLabel}. Posisi ini hanya mencakup jurnal sejak tanggal tersebut. Catat jurnal manual saldo awal (kas, piutang, persediaan, utang, ekuitas) bertanggal sebelum itu agar neraca mencerminkan posisi sebenarnya.`;
}

/** Day-month-year label for the opening-balance warning, in the business timezone (WIB). */
export function formatOpeningDate(iso: string): string {
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export const CASH_FLOW_COVERAGE_TITLE = "Cakupan data";

export const CASH_FLOW_COVERAGE_BODY =
  "Laporan ini disusun dari jurnal buku besar dengan metode tidak langsung. Cakupannya sama dengan Laba Rugi: BELUM termasuk penjualan lapangan (putus/konsi) dan penjualan SPG.";

export const CASH_FLOW_RECONCILED_NOTE =
  "Perubahan kas hasil perhitungan sama dengan pergerakan saldo kas sebenarnya. Karena setiap jurnal sudah divalidasi seimbang saat diposting, kesamaan ini memang diharapkan — pemeriksaan ini hanya mendeteksi data yang rusak.";

export const CASH_FLOW_UNRECONCILED_NOTE =
  "Perubahan kas hasil perhitungan TIDAK sama dengan pergerakan saldo kas sebenarnya. Ini menandakan data jurnal rusak — periksa buku besar.";

export const CASH_FLOW_UNCLASSIFIED_TITLE = "Ada akun yang belum diklasifikasi";

export const CASH_FLOW_UNCLASSIFIED_BODY =
  "Sebagian akun belum ditetapkan masuk aktivitas operasional, investasi, atau pendanaan, sehingga ditampilkan terpisah. Total tetap benar. Tetapkan lewat Keuangan → Klasifikasi Arus Kas.";
