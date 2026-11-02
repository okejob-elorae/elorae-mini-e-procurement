/**
 * Status laporan retur pembeli SPG — bagian murni, TANPA impor (aman di klien).
 *
 * Keputusan pemilik 2026-11-02: pembeli mestinya tidak mengembalikan barang di
 * konter; kalau terjadi, SPG MELAPORKANNYA dan laporan itu menunggu persetujuan
 * kantor sebelum berpengaruh apa pun (buku stok toko, penjualan bersih, komisi,
 * laporan konsinyasi, `SalesHistory`).
 *
 *   MENUNGGU → DISETUJUI | DITOLAK | DIBATALKAN (ditarik SPG pelapornya)
 *
 * Ketiganya final — tidak ada yang bisa dibalik atau dibuka lagi. Baris lama
 * (sebelum persetujuan kantor ada) bernilai DISETUJUI lewat isian bawaan
 * kolomnya, dengan `decidedAt` kosong: "berlaku langsung".
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
 * (disetujui) − yang masih menunggu kantor di laporan mana pun. Tidak pernah negatif.
 */
export function sisaReturPembeli(b: { qty: number; returnedQty: number; menunggu: number }): number {
  return Math.max(0, b.qty - b.returnedQty - b.menunggu);
}

/** Kategori `AdminNotification` untuk laporan yang baru masuk (penerimanya: `spg_returns:approve`). */
export const KATEGORI_NOTIF_RETUR_PEMBELI = "RETUR_PEMBELI_MENUNGGU";

/** `AuditLog.entityType` dan `StoreStockMovement.refType` retur pembeli. */
export const ENTITAS_RETUR_PEMBELI = "SpgSaleReturn";

/** Panjang alasan (pembeli, penolakan kantor, penarikan SPG) — sama dengan batas zod aksinya. */
export const BATAS_ALASAN_RETUR_PEMBELI = 500;

/* ------------------------------------------------------------ saringan kantor */

export type SaringanReturPembeliKantor = {
  status: StatusReturPembeli | "SEMUA";
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
 * `SEMUA` memang pilihan sendiri.
 */
export function bacaSaringanReturPembeli(sp: {
  status?: string | string[];
  toko?: string | string[];
  cari?: string | string[];
  halaman?: string | string[];
}): SaringanReturPembeliKantor {
  const s = satu(sp.status).toUpperCase();
  const status: StatusReturPembeli | "SEMUA" = s === "SEMUA" ? "SEMUA" : (bacaStatusReturPembeli(s) ?? "MENUNGGU");
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
