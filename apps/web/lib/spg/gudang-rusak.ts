/**
 * Gudang barang rusak — aturan murni, satu tempat.
 *
 * Tanpa basis data dan tanpa `@elorae/db`, supaya aman diimpor komponen klien
 * (layar kantor, layar HP SPG, formulir nota retur).
 *
 * Buku gudang barang rusak adalah `DamagedStockMovement`: saldo per barang ×
 * varian = Σ qty bertanda, dihitung, tidak disimpan.
 *
 * Alurnya (keputusan pemilik 2026-10-03, "barang rusak yang dikembalikan
 * pembeli masuk ke gudang barang rusak"):
 * 1. Barang RUSAK/EXPIRED kembali dari toko lewat nota retur toko (NRT) —
 *    rusak dari pembeli di konter (`spgSaleReturnLineId`), rusak dari kiriman
 *    (`storeReceiptLineId`), atau nota retur biasa.
 * 2. Gudang menghitung NRI: setiap baris RUSAK/EXPIRED ber-barang katalog MASUK
 *    ke sini (`MASUK_RETUR`, +qty, satu gerakan per baris NRI).
 * 3. Kantor (`inventory:manage`) memutuskan, dengan catatan wajib:
 *    - `PERBAIKI`   — layak jual lagi: keluar dari sini dan MASUK stok jual
 *                     gudang (`InventoryValue` + penyesuaian POSITIVE);
 *    - `JUAL_OBRAL` — dijual murah: keluar dari sini, nilai jualnya dicatat
 *                     (opsional), stok jual tidak disentuh;
 *    - `MUSNAHKAN`  — dibuang: keluar saja.
 *    Keluar tidak pernah melebihi saldo.
 */

export const JENIS_GERAK_RUSAK = ["MASUK_RETUR", "PERBAIKI", "JUAL_OBRAL", "MUSNAHKAN"] as const;
export type JenisGerakRusak = (typeof JENIS_GERAK_RUSAK)[number];

export const KEPUTUSAN_GUDANG_RUSAK = ["PERBAIKI", "JUAL_OBRAL", "MUSNAHKAN"] as const;
export type KeputusanGudangRusak = (typeof KEPUTUSAN_GUDANG_RUSAK)[number];

/** Nama tindakan jejak (`AuditLog.action`) — label di i18n `auditActions.actions.*`. */
export const JEJAK_GUDANG_RUSAK = {
  DIPUTUSKAN: "DAMAGED_STOCK_DECIDED",
} as const;

/** `AuditLog.entityType` untuk keputusan — satu gerakan keluar per keputusan. */
export const ENTITAS_GERAK_RUSAK = "DamagedStockMovement";
/** `DamagedStockMovement.refType` gerakan masuk: satu baris hitungan gudang (NRI). */
export const REF_BARIS_NRI = "WarehouseReturnItem";
/** `DamagedStockMovement.refType` gerakan PERBAIKI: penyesuaian stok jual yang dibuatnya. */
export const REF_PENYESUAIAN = "StockAdjustment";

/** Panjang maksimum catatan keputusan kantor. */
export const BATAS_CATATAN_GUDANG_RUSAK = 300;

export const KONDISI_RUSAK = ["RUSAK", "EXPIRED"] as const;
export type KondisiRusak = (typeof KONDISI_RUSAK)[number];

/** Kondisi yang masuk gudang barang rusak (bukan LAYAK). */
export function kondisiRusak(v: unknown): v is KondisiRusak {
  return typeof v === "string" && (KONDISI_RUSAK as readonly string[]).includes(v);
}

export function bacaKeputusanGudangRusak(v: unknown): KeputusanGudangRusak | null {
  return typeof v === "string" && (KEPUTUSAN_GUDANG_RUSAK as readonly string[]).includes(v) ? (v as KeputusanGudangRusak) : null;
}

export function bacaJenisGerakRusak(v: unknown): JenisGerakRusak | null {
  return typeof v === "string" && (JENIS_GERAK_RUSAK as readonly string[]).includes(v) ? (v as JenisGerakRusak) : null;
}

/** Catatan rapi (spasi dirapatkan), atau null kalau kosong / terlalu panjang. */
export function rapikanCatatanGudangRusak(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const rapi = v.replace(/\s+/g, " ").trim();
  if (!rapi || rapi.length > BATAS_CATATAN_GUDANG_RUSAK) return null;
  return rapi;
}

export type AlasanTolakKeputusanRusak =
  | "KEPUTUSAN_TIDAK_SAH"
  | "JUMLAH_TIDAK_SAH"
  | "CATATAN_WAJIB"
  | "NILAI_TIDAK_SAH"
  /** Jumlah yang diputuskan melebihi saldo barang itu di gudang barang rusak. */
  | "SALDO_KURANG";

export type HasilPeriksaKeputusan =
  | { ok: true; keputusan: KeputusanGudangRusak; qty: number; catatan: string; nilai: number | null }
  | { ok: false; alasan: AlasanTolakKeputusanRusak };

/**
 * Periksa isian keputusan kantor terhadap saldo saat ini.
 *
 * Jumlah = bilangan bulat ≥ 1 dan ≤ saldo. Nilai hanya berarti untuk
 * `JUAL_OBRAL` (rupiah total hasil jual, ≥ 0, dibulatkan sen); untuk keputusan
 * lain diabaikan. Kosong = belum diketahui (null), BUKAN nol.
 */
export function periksaKeputusanRusak(
  isi: { keputusan: unknown; qty: unknown; catatan: unknown; nilai?: unknown },
  saldo: number,
): HasilPeriksaKeputusan {
  const keputusan = bacaKeputusanGudangRusak(isi.keputusan);
  if (!keputusan) return { ok: false, alasan: "KEPUTUSAN_TIDAK_SAH" };
  const qty = isi.qty;
  if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1) return { ok: false, alasan: "JUMLAH_TIDAK_SAH" };
  const catatan = rapikanCatatanGudangRusak(isi.catatan);
  if (!catatan) return { ok: false, alasan: "CATATAN_WAJIB" };
  let nilai: number | null = null;
  if (keputusan === "JUAL_OBRAL" && isi.nilai !== null && isi.nilai !== undefined && isi.nilai !== "") {
    const n = typeof isi.nilai === "number" ? isi.nilai : Number(isi.nilai);
    if (!Number.isFinite(n) || n < 0) return { ok: false, alasan: "NILAI_TIDAK_SAH" };
    nilai = Math.round(n * 100) / 100;
  }
  if (qty > saldo) return { ok: false, alasan: "SALDO_KURANG" };
  return { ok: true, keputusan, qty, catatan, nilai };
}

/** Qty bertanda sebuah gerakan: masuk positif, setiap keputusan keluar negatif. */
export function qtyBertanda(jenis: JenisGerakRusak, qty: number): number {
  return jenis === "MASUK_RETUR" ? Math.abs(qty) : -Math.abs(qty);
}

/** Dari mana barang rusak sebuah baris NRI datang. */
export const ASAL_RUSAK = ["RETUR_PEMBELI", "KIRIMAN_RUSAK", "NRT", "TANPA_NOTA"] as const;
export type AsalRusak = (typeof ASAL_RUSAK)[number];

type BarisNrtAsal = {
  itemId: string | null;
  variantSku: string | null;
  condition: string;
  spgSaleReturnLineId?: string | null;
  storeReceiptLineId?: string | null;
};

/**
 * Asal barang rusak sebuah baris NRI, dibaca dari nota retur toko (NRT)
 * pasangannya: baris NRT dengan barang + varian yang sama dan kondisi bukan
 * LAYAK. Retur pembeli dan rusak kiriman dikenali dari penunjuknya; sisanya
 * nota retur toko biasa. Hitungan gudang tanpa nota (barang lewat ekspedisi
 * mendahului notanya) = `TANPA_NOTA`.
 *
 * Bisa lebih dari satu asal (satu nota membawa barang yang sama dari dua
 * jalan). Urutannya tetap mengikuti `ASAL_RUSAK`.
 */
export function asalBarisNri(
  baris: { itemId: string | null; variantSku: string | null },
  nrt: { items: BarisNrtAsal[] } | null,
): AsalRusak[] {
  if (!nrt) return ["TANPA_NOTA"];
  const varian = baris.variantSku?.trim() ?? "";
  const cocok = nrt.items.filter(
    (i) => i.itemId === baris.itemId && (i.variantSku?.trim() ?? "") === varian && i.condition !== "LAYAK",
  );
  const asal = new Set<AsalRusak>();
  for (const i of cocok) {
    if (i.spgSaleReturnLineId) asal.add("RETUR_PEMBELI");
    else if (i.storeReceiptLineId) asal.add("KIRIMAN_RUSAK");
    else asal.add("NRT");
  }
  if (asal.size === 0) asal.add("NRT");
  return ASAL_RUSAK.filter((a) => asal.has(a));
}

/** Barang rusak dari pembeli yang belum dikirim balik lewat nota retur yang hidup. */
export function sisaKirimBalikPembeli(qtyRusak: number, sudahDikirim: number): number {
  return Math.max(0, qtyRusak - sudahDikirim);
}

/** Kunci baris saldo: barang + varian. */
export function kunciRusak(itemId: string, variantSku: string | null | undefined): string {
  return `${itemId}::${variantSku?.trim() ?? ""}`;
}
