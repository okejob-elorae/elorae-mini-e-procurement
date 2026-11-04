/**
 * Teks cakupan laporan keuangan yang aman diimpor komponen klien: semuanya
 * dibangun dari dua daftar sumber di bawah, tanpa membaca katalog bahasa.
 *
 * `disclosures.ts` mengekspor ulang semuanya untuk Excel dan payload cetak.
 * Komponen klien (layar laporan dan halaman `/print/finance/*`) mengimpor dari
 * SINI, bukan dari `disclosures.ts`: modul itu membaca seluruh `id.json`
 * (ratusan KB) dan akan menyeretnya ke bundel peramban.
 */

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
  "pembayaran ke pemasok (sebagian, uang muka, dan potongan PPh)",
  "voucher kas & bank (pengeluaran, penerimaan, transfer, kas kecil, dan biaya bank dari rekonsiliasi)",
  "fee, pembayaran, dan sampel KOL",
  "penjualan lapangan putus (nota tagihan)",
  "pelunasan piutang toko (BKM dan giro)",
  "retur toko putus (NRI)",
  "tukar barang",
  "penyelesaian masa PPN, PPh final, dan setoran pajak",
  "konsinyasi (kiriman, retur, penjualan toko dari siklus yang dikunci, pembayaran toko, gaji dan komisi SPG)",
  "komisi SPG toko putus",
  "barang hilang di toko konsinyasi",
  "keputusan gudang barang rusak",
  "penyesuaian stok manual",
  "retur ke pemasok",
  "biaya perjalanan sales",
  "perolehan, penyusutan, dan pelepasan aset tetap",
  "jurnal berulang dan akrual",
  "jurnal manual yang sudah disetujui",
  "laporan sell-through konsi yang sudah ditagihkan",
  "pembayaran piutang (kwitansi)",
];

/**
 * Sumber yang BELUM membuat jurnal. Penjualan SPG sengaja tidak dijurnal
 * sendiri (keputusan sementara pemilik no. 37): di toko putus barangnya sudah
 * milik toko sejak nota tagihan, di toko konsinyasi pendapatannya diakui lewat
 * siklus yang dikunci.
 */
export const SUMBER_BELUM_BERJURNAL: readonly string[] = [
  "perubahan stok dari Jubelio (webhook stok dan rekonsiliasi)",
  "komisi salesman (dibayar di luar sistem)",
  "retur lapangan saat disetujui (barang yang dikembalikan toko; pendapatannya berkurang ketika kreditnya dipotongkan ke tagihan)",
];

function daftarKalimat(butir: readonly string[]): string {
  if (butir.length <= 1) return butir.join("");
  return `${butir.slice(0, -1).join(", ")}, dan ${butir[butir.length - 1]}`;
}

/** Kalimat "BELUM termasuk …" — kosong begitu semua sumber sudah berjurnal. */
function kalimatBelumBerjurnal(): string {
  return SUMBER_BELUM_BERJURNAL.length ? ` BELUM termasuk: ${daftarKalimat(SUMBER_BELUM_BERJURNAL)}.` : "";
}

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

export const INCOME_STATEMENT_COVERAGE_BODY = `Laporan ini hanya mencakup transaksi yang sudah menghasilkan jurnal: ${daftarKalimat(SUMBER_BERJURNAL)}. BELUM termasuk: ${daftarKalimat(SUMBER_BELUM_BERJURNAL)}.`;

export const CASH_FLOW_COVERAGE_BODY = `Laporan ini disusun dari jurnal buku besar dengan metode tidak langsung. Cakupannya sama dengan Laba Rugi: BELUM termasuk ${daftarKalimat(SUMBER_BELUM_BERJURNAL)}.`;

/** Neraca (layar, cetak, Excel): saldonya sama lengkapnya dengan jurnal yang ada. */
export const BALANCE_SHEET_COVERAGE_BODY = `Posisi ini disusun dari jurnal buku besar, jadi saldonya hanya memuat transaksi yang sudah menghasilkan jurnal.${kalimatBelumBerjurnal()}`;

/** Laporan lanjutan (perbandingan, rasio, laba per kanal, anggaran vs realisasi). */
export const CAKUPAN_LAPORAN_BODY = `Laporan ini disusun dari jurnal buku besar dan hanya memuat transaksi yang sudah menghasilkan jurnal.${kalimatBelumBerjurnal()}`;
