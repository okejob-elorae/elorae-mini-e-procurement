import type { StatusMutasi } from "./mutasi-aturan";

/**
 * Surat jalan satu mutasi antar toko — aturan murni, aman diimpor komponen
 * klien (tanpa basis data). Kuerinya di `surat-jalan-queries.ts`, dokumennya
 * di `lib/print/surat-jalan-mutasi-html.ts`.
 *
 * Keputusan pemilik (2026-10-03): surat jalan bisa dicetak DAN disimpan PDF.
 * Tidak ada pustaka PDF — dokumennya halaman HTML A4 yang dibuka di jendela
 * cetak peramban; di sana pengguna memilih printer atau "Simpan sebagai PDF".
 *
 * Aturan:
 * - Belum dikirim (DIAJUKAN/DISETUJUI) → boleh dicetak, dengan cap DRAF: SPG
 *   biasanya mencetaknya sebelum menyerahkan barang ke kurir.
 * - DIKIRIM/DITERIMA → surat jalan yang berlaku.
 * - DITOLAK/DIBATALKAN/DIKEMBALIKAN → tidak bisa dicetak. Mutasi yang dibatalkan
 *   sesudah dikirim (DIKEMBALIKAN) diperlakukan sama: dokumennya batal, dan
 *   kertas yang menyebut "asal → tujuan" untuk barang yang sedang PULANG akan
 *   menyesatkan kurirnya.
 * - Tidak ada harga atau nilai rupiah sama sekali (HP tidak pernah menerima
 *   harga konsinyasi).
 * - Toko tujuan baru boleh melihat surat jalannya sesudah barang berangkat —
 *   aturan yang sama dengan rincian mutasi di HP (`rincianMutasiHp`).
 */

/** `AuditLog.entityType` untuk jejak cetak (`PRINT`) — terpisah dari jejak keputusan mutasi. */
export const ENTITAS_SURAT_JALAN = "StoreTransferSuratJalan";

export type KeadaanSuratJalan = "DRAF" | "BERLAKU" | "TIDAK_BISA";

export function keadaanSuratJalan(status: StatusMutasi | string): KeadaanSuratJalan {
  if (status === "DIAJUKAN" || status === "DISETUJUI") return "DRAF";
  if (status === "DIKIRIM" || status === "DITERIMA") return "BERLAKU";
  return "TIDAK_BISA";
}

export const bisaDicetak = (status: StatusMutasi | string): boolean => keadaanSuratJalan(status) !== "TIDAK_BISA";

/** Label status di atas kertas — selalu bahasa Indonesia, sama dengan dokumennya. */
export const LABEL_STATUS_SURAT_JALAN: Record<StatusMutasi, string> = {
  DIAJUKAN: "Diajukan",
  DISETUJUI: "Disetujui",
  DIKIRIM: "Dikirim",
  DITERIMA: "Diterima",
  DITOLAK: "Ditolak",
  DIBATALKAN: "Dibatalkan",
  DIKEMBALIKAN: "Dibatalkan — barang kembali",
};

export type TokoSuratJalan = {
  id: string;
  kode: string;
  nama: string;
  alamat: string;
  telepon: string | null;
  kontak: string | null;
};

export type BarisSuratJalan = {
  /** SKU varian bila ada, kalau tidak SKU barang. */
  sku: string;
  nama: string;
  /** "Hitam · M", "M", atau null untuk barang tanpa varian. */
  varian: string | null;
  qty: number;
};

/** Semua yang dibutuhkan dokumen. Tanggal berupa ISO; diformat (WIB) oleh dokumennya. */
export type DataSuratJalan = {
  id: string;
  docNo: string;
  status: StatusMutasi;
  asal: TokoSuratJalan;
  tujuan: TokoSuratJalan;
  diajukanIso: string;
  disetujuiIso: string | null;
  dikirimIso: string | null;
  diterimaIso: string | null;
  /** Yang menandai dikirim. */
  pengirim: string | null;
  /** Yang mencatat terima (SPG tujuan, atau kantor atas nama toko). */
  penerima: string | null;
  alasan: string;
  catatanKantor: string | null;
  baris: BarisSuratJalan[];
};

export const totalPotong = (baris: { qty: number }[]): number => baris.reduce((n, b) => n + b.qty, 0);

/**
 * SPG toko `storeId` boleh membuka surat jalan ini: toko asal selalu; toko
 * tujuan hanya sesudah barangnya berangkat.
 */
export function bolehDibukaSpg(m: { status: StatusMutasi | string; asal: { id: string }; tujuan: { id: string } }, storeId: string): boolean {
  if (m.asal.id === storeId) return true;
  return m.tujuan.id === storeId && (m.status === "DIKIRIM" || m.status === "DITERIMA");
}

export const tautanSuratJalanHp = (transferId: string): string => `/pwa/spg/mutasi/${encodeURIComponent(transferId)}/surat-jalan`;
export const tautanSuratJalanKantor = (transferId: string): string => `/backoffice/spg-transfers/${encodeURIComponent(transferId)}/surat-jalan`;

/**
 * Teks "Bagikan" dari HP (mis. ke grup WA kurir). Selalu bahasa Indonesia —
 * dibaca orang lain — dan tanpa harga.
 */
export function teksBagikanSuratJalan(m: {
  docNo: string;
  status: StatusMutasi | string;
  asal: string;
  tujuan: string;
  baris: { qty: number }[];
}): string {
  const draf = keadaanSuratJalan(m.status) === "DRAF";
  const status = LABEL_STATUS_SURAT_JALAN[m.status as StatusMutasi] ?? m.status;
  return [
    `Surat jalan ${m.docNo}${draf ? " (DRAF — belum dikirim)" : ""}`,
    `Dari: ${m.asal}`,
    `Ke: ${m.tujuan}`,
    `${m.baris.length} barang, ${totalPotong(m.baris)} potong`,
    `Status: ${status}`,
  ].join("\n");
}
