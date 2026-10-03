/**
 * Barang rusak yang tiba di kiriman ke toko SPG — aturan murni, satu tempat.
 *
 * Tanpa basis data dan tanpa `@elorae/db`, supaya aman diimpor komponen klien
 * (layar terima di HP dan layar kantor).
 *
 * Alurnya:
 * 1. SPG menerima kiriman dan mencatat per baris berapa yang RUSAK (≤ diterima),
 *    dengan keterangan wajib dan foto opsional. `qtyReceived` tetap jumlah yang
 *    TIBA; buku stok toko hanya bertambah `diterima − rusak`; barisnya
 *    `damageStatus = TERBUKA`.
 * 2. Gudang (`inventory:manage`) memutuskan per baris, dengan catatan wajib:
 *    - `LAYAK_JUAL`     — ternyata masih bisa dijual: masuk buku toko sebesar
 *                         `qtyDamaged` (jenis yang sama dengan penerimaannya).
 *    - `KEMBALI_GUDANG` — SPG mengirimnya balik lewat nota retur yang barisnya
 *                         menunjuk baris tanda terima ini (tanpa RETUR_KELUAR,
 *                         karena barangnya tidak pernah masuk buku toko).
 *    - `DIHAPUSKAN`     — klaim ekspedisi / dihapus; tidak ada gerakan barang.
 *    Keputusan bersifat akhir.
 */

export const STATUS_RUSAK = ["TERBUKA", "LAYAK_JUAL", "KEMBALI_GUDANG", "DIHAPUSKAN"] as const;
export type StatusRusak = (typeof STATUS_RUSAK)[number];

export const KEPUTUSAN_RUSAK = ["LAYAK_JUAL", "KEMBALI_GUDANG", "DIHAPUSKAN"] as const;
export type KeputusanRusak = (typeof KEPUTUSAN_RUSAK)[number];

/** Nama tindakan jejak (`AuditLog.action`) — label di i18n `auditActions.actions.*`. */
export const JEJAK_RUSAK = {
  DIPUTUSKAN: "STORE_RECEIPT_DAMAGE_DECIDED",
} as const;

export const ENTITAS_RUSAK = "StoreReceiptLine";
/** Kategori catatan kantor (`AdminNotification`) — penerimanya `inventory:manage`. */
export const KATEGORI_NOTIF_RUSAK = "STORE_RECEIPT_DAMAGED";

/** Panjang maksimum keterangan SPG dan catatan keputusan gudang. */
export const BATAS_TEKS_RUSAK = 300;

export function bacaKeputusanRusak(v: unknown): KeputusanRusak | null {
  return typeof v === "string" && (KEPUTUSAN_RUSAK as readonly string[]).includes(v) ? (v as KeputusanRusak) : null;
}

export function bacaStatusRusak(v: unknown): StatusRusak | null {
  return typeof v === "string" && (STATUS_RUSAK as readonly string[]).includes(v) ? (v as StatusRusak) : null;
}

/** Teks rapi (spasi dirapatkan), atau null kalau kosong / terlalu panjang. */
export function rapikanTeksRusak(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const rapi = v.replace(/\s+/g, " ").trim();
  if (!rapi || rapi.length > BATAS_TEKS_RUSAK) return null;
  return rapi;
}

/** Foto hanya dari unggahan aplikasi ini (`/api/foto/<id>`) — sama dengan bukti terima. */
export function fotoRusakSah(url: string): boolean {
  return /^\/api\/foto\/[A-Za-z0-9_-]{1,64}$/.test(url);
}

export type IsianRusak = { qtyReceived: number; qtyDamaged?: number | null; damageNote?: string | null; damagePhotoUrl?: string | null };

export type HasilPeriksaRusak =
  | { ok: true; qtyDamaged: number; damageNote: string | null; damagePhotoUrl: string | null }
  | { ok: false; alasan: "RUSAK_TIDAK_VALID" | "KETERANGAN_RUSAK_WAJIB" };

/**
 * Periksa isian rusak satu baris. Rusak = bilangan bulat 0..diterima; kalau
 * lebih dari nol, keterangannya wajib dan fotonya (opsional) harus foto kita.
 * Rusak nol membuang keterangan dan foto — keduanya tidak berarti apa-apa.
 */
export function periksaIsianRusak(b: IsianRusak): HasilPeriksaRusak {
  const rusak = b.qtyDamaged ?? 0;
  if (!Number.isInteger(rusak) || rusak < 0 || rusak > b.qtyReceived) return { ok: false, alasan: "RUSAK_TIDAK_VALID" };
  if (rusak === 0) return { ok: true, qtyDamaged: 0, damageNote: null, damagePhotoUrl: null };
  const catatan = rapikanTeksRusak(b.damageNote);
  if (!catatan) return { ok: false, alasan: "KETERANGAN_RUSAK_WAJIB" };
  const foto = b.damagePhotoUrl?.trim() || null;
  if (foto && !fotoRusakSah(foto)) return { ok: false, alasan: "RUSAK_TIDAK_VALID" };
  return { ok: true, qtyDamaged: rusak, damageNote: catatan, damagePhotoUrl: foto };
}

/** Yang masuk buku stok toko saat diterima: yang tiba dikurangi yang rusak. */
export function masukBukuSaatTerima(qtyReceived: number, qtyDamaged: number): number {
  return Math.max(0, qtyReceived - qtyDamaged);
}

/** Barang rusak KEMBALI_GUDANG yang belum dikirim balik lewat nota retur yang hidup. */
export function sisaKirimBalik(qtyDamaged: number, sudahDikembalikan: number): number {
  return Math.max(0, qtyDamaged - sudahDikembalikan);
}

/**
 * Jenis gerakan buku saat LAYAK_JUAL: sama dengan penerimaannya — kiriman
 * gudang masuk sebagai TERIMA, mutasi antar toko sebagai MUTASI_MASUK.
 */
export function jenisGerakLayakJual(sourceType: string): "TERIMA" | "MUTASI_MASUK" {
  return sourceType === "MUTASI" || sourceType === "MUTASI_KEMBALI" ? "MUTASI_MASUK" : "TERIMA";
}

/** Daftar id baris dari alamat (`?dariRusak=a,b`) — unik, rapi, paling banyak 50. */
export function bacaIdRusak(v: unknown): string[] {
  if (typeof v !== "string") return [];
  const ids = v
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_-]{1,64}$/.test(s));
  return [...new Set(ids)].slice(0, 50);
}
