/**
 * Saluran jual barang jadi (jawaban pemilik 2026-11-02, P3/P3a/P71–P76) — murni, tanpa impor, aman
 * untuk komponen klien maupun setiap pemilih di server.
 *
 * - MARKETPLACE = "Marketplace saja": diajukan / dikirim ke Jubelio, TIDAK tampil di pemilih jual
 *   offline (katalog salesman, SPG, portal toko, kanvas, konsi, dst.).
 * - OFFLINE = "Toko offline saja": tidak pernah dikirim ke Jubelio (P3a); yang sudah ada di Jubelio
 *   dinonaktifkan di sana, tidak dihapus (P72).
 * - BOTH = "Keduanya": barang lama dan barang dari impor katalog Jubelio (P71).
 *
 * Dipilih dengan dua centang di formulir barang dan impor barang oleh pemegang items:create /
 * items:edit (P76). Dokumen yang sudah memuat barang tetap dihormati (P73): saringan ini hanya untuk
 * PEMILIH barang baru, tidak pernah untuk penulis atau katalog retur.
 */

export const SALURAN_JUAL = ["MARKETPLACE", "OFFLINE", "BOTH"] as const;

export type SaluranJual = (typeof SALURAN_JUAL)[number];

/** Nama tindakan jejak audit perubahan saluran — satu ejaan, dicari persis. */
export const JEJAK_SALURAN_JUAL = "ITEM_SALES_CHANNEL_CHANGED";

export function bacaSaluranJual(v: unknown): SaluranJual | null {
  return typeof v === "string" && (SALURAN_JUAL as readonly string[]).includes(v) ? (v as SaluranJual) : null;
}

/** Dua centang → saluran; tidak ada yang dicentang → null (ditolak, wajib pilih). */
export function saluranDariCentang(c: { marketplace: boolean; offline: boolean }): SaluranJual | null {
  if (c.marketplace && c.offline) return "BOTH";
  if (c.marketplace) return "MARKETPLACE";
  if (c.offline) return "OFFLINE";
  return null;
}

/** Saluran → dua centang; null (barang jadi baru) = keduanya belum dicentang. */
export function centangDariSaluran(s: SaluranJual | null): { marketplace: boolean; offline: boolean } {
  return { marketplace: s === "MARKETPLACE" || s === "BOTH", offline: s === "OFFLINE" || s === "BOTH" };
}

export function dijualDiMarketplace(s: SaluranJual | null | undefined): boolean {
  return s === "MARKETPLACE" || s === "BOTH";
}

export function dijualOffline(s: SaluranJual | null | undefined): boolean {
  return s === "OFFLINE" || s === "BOTH";
}

/**
 * Saringan Prisma untuk SETIAP pemilih jual offline: barang "Marketplace saja" tidak tampil (P3a).
 * Selalu dipasangkan dengan `type: FINISHED_GOOD` oleh pemanggilnya.
 */
export function syaratDijualOffline(): { salesChannel: { in: Array<"OFFLINE" | "BOTH"> } } {
  return { salesChannel: { in: ["OFFLINE", "BOTH"] } };
}
