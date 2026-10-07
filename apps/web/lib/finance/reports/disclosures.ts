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

/**
 * Sumber yang SUDAH membuat jurnal otomatis (pemanggil `generateAutoJournal` /
 * `postJournal`). SATU daftar untuk layar (bahasa Indonesia), cetak, dan Excel —
 * sumber baru yang mulai dijurnal dipindah dari daftar di bawahnya ke sini.
 */
export const SUMBER_BERJURNAL: readonly string[] = [
  "penjualan marketplace",
  "retur marketplace",
  "settlement",
  "penjualan kanvas",
  "penerimaan barang (GRN)",
  "hasil produksi",
  "penyesuaian stock opname",
  "pembayaran ke pemasok",
  "jurnal manual",
];

/** Sumber yang BELUM pernah membuat jurnal (audit 2026-10-06). */
export const SUMBER_BELUM_BERJURNAL: readonly string[] = [
  "penjualan lapangan (putus) dan nota tagihannya",
  "pelunasan piutang (BKM dan giro)",
  "retur toko (NRI)",
  "konsinyasi (kiriman, penjualan toko, pembayaran toko, komisi)",
  "penjualan SPG",
  "barang hilang",
  "tukar barang",
  "penyesuaian stok manual",
  "retur ke pemasok",
  "biaya perjalanan sales",
];

function daftarKalimat(butir: readonly string[]): string {
  if (butir.length <= 1) return butir.join("");
  return `${butir.slice(0, -1).join(", ")}, dan ${butir[butir.length - 1]}`;
}

export const INCOME_STATEMENT_COVERAGE_BODY = `Laporan ini hanya mencakup transaksi yang sudah menghasilkan jurnal: ${daftarKalimat(SUMBER_BERJURNAL)}. BELUM termasuk: ${daftarKalimat(SUMBER_BELUM_BERJURNAL)}.`;

/**
 * Ditulis di versi cetak selama buku besar belum aktif (pemetaan akun belum
 * lengkap, belum ada jurnal, atau tanggal mulai belum ditetapkan) — sama dengan
 * spanduk di layar.
 */
export const LEDGER_NOT_ACTIVE_NOTE =
  "Buku besar belum aktif — laporan ini belum mencerminkan transaksi operasional.";

export function ledgerPendingNote(jumlah: number): string {
  return `${jumlah} jurnal gagal diposting — laporan ini belum memuat dokumennya.`;
}

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

export const CASH_FLOW_COVERAGE_BODY = `Laporan ini disusun dari jurnal buku besar dengan metode tidak langsung. Cakupannya sama dengan Laba Rugi: BELUM termasuk ${daftarKalimat(SUMBER_BELUM_BERJURNAL)}.`;

/**
 * Shown in place of the statement when no account is classified KAS. Without a
 * cash account every section computes to zero, which would otherwise ship as a
 * statement reporting no cash movement — carrying the reconciled note, since
 * zero does equal zero. Refusing is the only honest output.
 */
export const CASH_FLOW_NO_CASH_ACCOUNT_NOTE =
  "Laporan arus kas tidak dapat disusun tanpa akun kas. Pilih akun Bank atau Kas di Keuangan → Pemetaan Akun, atau tetapkan sebuah akun sebagai Kas di Klasifikasi Arus Kas.";

export const CASH_FLOW_RECONCILED_NOTE =
  "Perubahan kas hasil perhitungan sama dengan pergerakan saldo kas sebenarnya. Karena setiap jurnal sudah divalidasi seimbang saat diposting, kesamaan ini memang diharapkan — pemeriksaan ini hanya mendeteksi data yang rusak.";

export const CASH_FLOW_UNRECONCILED_NOTE =
  "Perubahan kas hasil perhitungan TIDAK sama dengan pergerakan saldo kas sebenarnya. Ini menandakan data jurnal rusak — periksa buku besar.";

export const CASH_FLOW_UNCLASSIFIED_TITLE = "Ada akun yang belum diklasifikasi";

export const CASH_FLOW_UNCLASSIFIED_BODY =
  "Sebagian akun belum ditetapkan masuk aktivitas operasional, investasi, atau pendanaan, sehingga ditampilkan terpisah. Total tetap benar. Tetapkan lewat Keuangan → Klasifikasi Arus Kas.";

/** Keadaan kosong versi cetak/Excel — pengganti deretan Rp 0 saat periode tanpa jurnal. */
export const REPORT_EMPTY_PERIOD_NOTE = "Belum ada jurnal pada periode ini.";

/** Laba Rugi kosong: jurnal yang hanya menyentuh akun neraca (mis. penerimaan barang) tidak mengisinya. */
export const INCOME_STATEMENT_EMPTY_NOTE = "Belum ada jurnal pendapatan, HPP, atau beban pada periode ini.";

export const BALANCE_SHEET_EMPTY_NOTE = "Belum ada jurnal sampai tanggal ini.";
