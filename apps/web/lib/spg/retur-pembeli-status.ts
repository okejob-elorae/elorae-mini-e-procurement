/**
 * Status laporan retur pembeli SPG — bagian murni, TANPA impor (aman di klien).
 *
 * Keputusan pemilik 2026-11-02: pembeli mestinya tidak mengembalikan barang di
 * konter; kalau terjadi, SPG MELAPORKANNYA (foto barang wajib, P14/P77) dan
 * laporan itu menunggu persetujuan kantor sebelum berpengaruh apa pun (buku
 * stok toko, penjualan bersih, komisi, laporan konsinyasi, `SalesHistory`).
 * Selama menunggu barangnya DISISIHKAN (P12): tidak ke rak, tidak dijual, tidak
 * dihitung opname.
 *
 *   MENUNGGU   → DISETUJUI | DITOLAK | DIBATALKAN (ditarik SPG pelapornya)
 *   DITOLAK    → DISETUJUI, hanya lewat dua jalan: penolakan keliru dibatalkan
 *                kantor (P82) selama belum ada yang diambil dari SPG, atau
 *                sesudah SPG mengganti uangnya kantor memilih "kembalikan uang
 *                SPG — barang masuk stok" (P79). Selain itu final.
 *   DIBATALKAN → MENUNGGU, hanya bila pengembalian uang yang dicatat di HP SEBELUM
 *                laporannya ditarik baru sampai sesudahnya (P78: begitu uangnya
 *                tercatat, SPG tidak bisa menarik laporannya — kantor yang
 *                memutuskan). Selain itu final.
 *
 * Uangnya (P13, P13a): kasir mengembalikan uang pembeli HANYA sesudah kantor
 * menyetujui — HP yang menyuruhnya. Ditolak tanpa uang dikembalikan → barang
 * dikembalikan ke pembeli (P83). Ditolak padahal uangnya sudah dikembalikan
 * (dicatat SPG dengan foto struk — sebelum ditolak, atau sesudahnya karena
 * uangnya terlanjur keluar — atau ditandai kantor saat menolak, P78) → satu beban
 * SPG (`SpgCharge`, `./beban-spg`), dipotong dari komisi lalu gaji. Tanpa kredit
 * apa pun ke toko (P80). Laporan yang uangnya sudah tercatat dikembalikan tidak
 * bisa lagi ditarik SPG sendiri — kantor yang memutuskan.
 *
 * Satu-satunya arti "retur pembeli yang berlaku" untuk pembaca basis data ada
 * di `./retur-pembeli-berlaku` (`returPembeliBerlaku`); di memori,
 * `returPembeliSudahBerlaku`.
 */

export const STATUS_RETUR_PEMBELI = ["MENUNGGU", "DISETUJUI", "DITOLAK", "DIBATALKAN"] as const;
export type StatusReturPembeli = (typeof STATUS_RETUR_PEMBELI)[number];

export function bacaStatusReturPembeli(v: unknown): StatusReturPembeli | null {
  return typeof v === "string" && (STATUS_RETUR_PEMBELI as readonly string[]).includes(v) ? (v as StatusReturPembeli) : null;
}

/** Kembaran di memori dari `returPembeliBerlaku` — hanya yang DISETUJUI yang berpengaruh. */
export function returPembeliSudahBerlaku(status: string): boolean {
  return status === "DISETUJUI";
}

/**
 * Yang masih bisa dilaporkan dari satu baris nota: terjual − sudah kembali
 * (disetujui) − yang masih menunggu kantor di laporan mana pun − yang DITAHAN
 * laporan ditolak yang uangnya sudah dikembalikan (nasib potong itu lewat
 * bebannya: dibatalkan penolakannya atau diputuskan barangnya, tidak pernah
 * dilaporkan ulang). Tidak pernah negatif.
 */
export function sisaReturPembeli(b: { qty: number; returnedQty: number; menunggu: number; ditahan?: number }): number {
  return Math.max(0, b.qty - b.returnedQty - b.menunggu - (b.ditahan ?? 0));
}

/* ------------------------------------------------------------- uang retur */

/**
 * Keadaan uang pembeli sebuah laporan, untuk label HP dan kantor:
 * - MENUNGGU_BELUM: menunggu kantor, uang belum dikembalikan (jalan yang benar).
 * - MENUNGGU_SUDAH: menunggu kantor, tetapi uangnya sudah telanjur dikembalikan.
 * - SILAKAN_KEMBALIKAN: disetujui, uangnya belum dicatat kembali — HP menyuruh SPG.
 * - SUDAH_DIKEMBALIKAN: disetujui dan uangnya sudah kembali.
 * - JANGAN_KEMBALIKAN: ditolak tanpa uang dikembalikan — barang kembali ke pembeli (P83).
 * - DIBEBANKAN: ditolak padahal uangnya sudah dikembalikan — beban SPG.
 * - DITARIK: ditarik SPG pelapornya.
 */
export const KEADAAN_UANG_RETUR = [
  "MENUNGGU_BELUM",
  "MENUNGGU_SUDAH",
  "SILAKAN_KEMBALIKAN",
  "SUDAH_DIKEMBALIKAN",
  "JANGAN_KEMBALIKAN",
  "DIBEBANKAN",
  "DITARIK",
] as const;
export type KeadaanUangRetur = (typeof KEADAAN_UANG_RETUR)[number];

/**
 * Uangnya sudah dikembalikan menurut sistem: dicatat SPG (`refundedAt`, dengan
 * foto struk) ATAU ditandai kantor saat menolak (`refundMarkedById`, P78 —
 * harinya tidak diketahui, jadi `refundedAt` tetap kosong).
 */
export function uangReturTercatat(r: { refundedAt: Date | string | null; refundMarkedById: string | null }): boolean {
  return r.refundedAt !== null || r.refundMarkedById !== null;
}

export function keadaanUangRetur(r: { status: StatusReturPembeli; uangTercatat: boolean }): KeadaanUangRetur {
  switch (r.status) {
    case "MENUNGGU":
      return r.uangTercatat ? "MENUNGGU_SUDAH" : "MENUNGGU_BELUM";
    case "DISETUJUI":
      return r.uangTercatat ? "SUDAH_DIKEMBALIKAN" : "SILAKAN_KEMBALIKAN";
    case "DITOLAK":
      return r.uangTercatat ? "DIBEBANKAN" : "JANGAN_KEMBALIKAN";
    case "DIBATALKAN":
      return "DITARIK";
  }
}

/** Kategori `AdminNotification` untuk laporan retur pembeli (penerimanya: `spg_returns:approve`). */
export const KATEGORI_NOTIF_RETUR_PEMBELI = "RETUR_PEMBELI_MENUNGGU";

/** `AuditLog.entityType` dan `StoreStockMovement.refType` retur pembeli. */
export const ENTITAS_RETUR_PEMBELI = "SpgSaleReturn";

/** Panjang alasan (pembeli, penolakan kantor, penarikan SPG, tanda uang, besar beban) — sama dengan batas zod aksinya. */
export const BATAS_ALASAN_RETUR_PEMBELI = 500;

/* ------------------------------------------------------------ saringan kantor */

/** Tab kantor: satu status, semua, atau beban yang sudah diganti SPG dan menunggu keputusan barangnya (P79). */
export type TabReturPembeliKantor = StatusReturPembeli | "SEMUA" | "KEPUTUSAN_BARANG";

export type SaringanReturPembeliKantor = {
  status: TabReturPembeliKantor;
  storeId: string | null;
  /** Nomor nota (sebagian), dicari tanpa membedakan huruf besar-kecil. */
  cari: string;
  /** Mulai dari 1. */
  halaman: number;
  ukuran: number;
};

export const UKURAN_HALAMAN_RETUR_PEMBELI = 25;

const satu = (v: string | string[] | undefined): string => (Array.isArray(v) ? (v[0] ?? "") : (v ?? "")).trim();

/**
 * Saringan dari parameter URL halaman kantor (`?status=&toko=&cari=&halaman=`).
 * Status yang tidak dikenal atau kosong → MENUNGGU (yang perlu diputuskan);
 * `SEMUA` dan `KEPUTUSAN_BARANG` memang pilihan sendiri.
 */
export function bacaSaringanReturPembeli(sp: {
  status?: string | string[];
  toko?: string | string[];
  cari?: string | string[];
  halaman?: string | string[];
}): SaringanReturPembeliKantor {
  const s = satu(sp.status).toUpperCase();
  const status: TabReturPembeliKantor =
    s === "SEMUA" || s === "KEPUTUSAN_BARANG" ? s : (bacaStatusReturPembeli(s) ?? "MENUNGGU");
  const toko = satu(sp.toko).slice(0, 64);
  const halaman = Number.parseInt(satu(sp.halaman), 10);
  return {
    status,
    storeId: toko || null,
    cari: satu(sp.cari).slice(0, 64),
    halaman: Number.isFinite(halaman) && halaman >= 1 ? halaman : 1,
    ukuran: UKURAN_HALAMAN_RETUR_PEMBELI,
  };
}
