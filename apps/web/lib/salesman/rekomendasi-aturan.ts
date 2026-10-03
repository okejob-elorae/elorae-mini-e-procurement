import { labelVarianSerap } from "./penyerapan";

/**
 * Rekomendasi barang dari salesman ke toko — aturan murni, aman untuk klien.
 * Penulisnya di `rekomendasi.ts`, kuerinya di `rekomendasi-queries.ts`.
 *
 * Alurnya: salesman (pemegang toko) MENGIRIM rekomendasi → SPG toko itu
 * MENERIMA atau MENOLAK (alasan wajib); untuk toko tanpa SPG, salesman
 * pembuatnya menandai "toko setuju" sesudah manager menjawab lewat WhatsApp
 * atau langsung. Rekomendasi yang diterima menjadi keranjang katalog
 * (`?isi=rekomendasi:<id>`) — tetap ditinjau dan dikirim salesman sebagai
 * pesanan biasa — lalu SELESAI begitu pesanannya tercatat. Pembuatnya boleh
 * membatalkan selama belum menjadi pesanan.
 *
 * Rekomendasi tidak pernah membawa harga: baris hanya barang, ukuran, jumlah,
 * dan alasannya.
 */

export const STATUS_REKOMENDASI = ["TERKIRIM", "DITERIMA", "DITOLAK", "SELESAI", "DIBATALKAN"] as const;
export type StatusRekomendasi = (typeof STATUS_REKOMENDASI)[number];

/** Sama dengan `StockRequestLine.alasan` — satu kosakata untuk permintaan dan rekomendasi. */
export const ALASAN_REKOMENDASI = ["LAKU_DI_SINI", "LAKU_DI_TOKO_LAIN", "BARANG_BARU", "SERING_DIKIRIM", "MANUAL"] as const;
export type AlasanRekomendasi = (typeof ALASAN_REKOMENDASI)[number];

export const BATAS_BARIS_REKOMENDASI = 100;
export const QTY_MAKS_REKOMENDASI = 9999;
export const BATAS_TEKS_REKOMENDASI = 500;
export const KUNCI_MAKS_REKOMENDASI = 100;

/** Cara toko tanpa SPG menjawab — dicatat di catatan jawaban. */
export const SUMBER_SETUJU_TOKO = ["WHATSAPP", "LANGSUNG"] as const;
export type SumberSetujuToko = (typeof SUMBER_SETUJU_TOKO)[number];

export const ENTITAS_REKOMENDASI = "StoreRecommendation";
export const JEJAK_REKOMENDASI = {
  DIKIRIM: "STORE_RECOMMENDATION_SENT",
  DITERIMA: "STORE_RECOMMENDATION_ACCEPTED",
  DITOLAK: "STORE_RECOMMENDATION_REJECTED",
  DISETUJUI_TOKO: "STORE_RECOMMENDATION_STORE_AGREED",
  DIBATALKAN: "STORE_RECOMMENDATION_CANCELLED",
  DIPESAN: "STORE_RECOMMENDATION_ORDERED",
} as const;

export const bacaStatusRekomendasi = (s: unknown): StatusRekomendasi | null =>
  (STATUS_REKOMENDASI as readonly unknown[]).includes(s) ? (s as StatusRekomendasi) : null;

/** Saringan daftar rekomendasi salesman (`?status=`). */
export type FilterRekomendasi = "SEMUA" | StatusRekomendasi;
export const FILTER_REKOMENDASI: FilterRekomendasi[] = ["SEMUA", ...STATUS_REKOMENDASI];
export const bacaFilterRekomendasi = (raw: unknown): FilterRekomendasi =>
  (FILTER_REKOMENDASI as readonly unknown[]).includes(raw) ? (raw as FilterRekomendasi) : "SEMUA";

/** SPG menjawab hanya yang masih TERKIRIM. */
export const bisaDijawab = (s: StatusRekomendasi) => s === "TERKIRIM";
/** Pembuat membatalkan selama belum menjadi pesanan. */
export const bisaDibatalkan = (s: StatusRekomendasi) => s === "TERKIRIM" || s === "DITERIMA";
/** Keranjang katalog hanya terisi dari rekomendasi yang DITERIMA (`muatIsiKeranjang`). */
export const bisaDipesan = (s: StatusRekomendasi) => s === "DITERIMA";

/**
 * Saran umum (barang baru, laku di toko lain, andalan toko) hanya untuk barang
 * yang BELUM ada di daftar penyerapan toko ini. Saran umum menilai "belum
 * pernah dikirim" dari pesanan lapangan saja, jadi barang yang masuk lewat
 * opname awal atau mutasi antar toko — sudah di rak, mungkin malah lambat —
 * pernah tersaran sebagai "barang baru, belum pernah dikirim" di layar yang
 * sama yang menandainya "jangan kirim dulu". Penyerapan toko itu sendiri
 * selalu lebih tahu.
 */
export function saringSaranUmum<T extends { itemId: string }>(saran: readonly T[], sudahDiToko: Iterable<string>): T[] {
  const ada = new Set(sudahDiToko);
  return saran.filter((s) => !ada.has(s.itemId));
}

/**
 * Siapa yang boleh membuat rekomendasi untuk sebuah toko: pemegangnya
 * (`Store.salesmanId`). Toko yang belum punya pemegang terbuka untuk salesman
 * mana pun — kecuali kunci "hanya toko sendiri" menyala, yang menutup toko
 * tanpa pemegang untuk semua orang (sama dengan `bolehPegangToko`).
 */
export function bolehBuatRekomendasi(opts: { terkunci: boolean; pemegangId: string | null; userId: string }): boolean {
  if (opts.pemegangId !== null) return opts.pemegangId === opts.userId;
  return !opts.terkunci;
}

/** Alasan saran tawar (`saran-tawar.ts`) → alasan baris rekomendasi. */
export function alasanDariSaranTawar(alasan: "ANDALAN_TOKO" | "LARIS_DI_AREA" | "BARU"): AlasanRekomendasi {
  if (alasan === "LARIS_DI_AREA") return "LAKU_DI_TOKO_LAIN";
  if (alasan === "BARU") return "BARANG_BARU";
  return "LAKU_DI_SINI";
}

export type BarisRekomendasi = { itemId: string; variantSku: string; qty: number; alasan: AlasanRekomendasi };

export type KodeTolakBaris = "TANPA_BARIS" | "TERLALU_BANYAK_BARIS" | "JUMLAH_TIDAK_VALID" | "BARIS_GANDA" | "ISIAN_TIDAK_VALID";

/**
 * Baris dari HP → baris yang dipercaya: barang, ukuran, jumlah bulat 1–9999,
 * alasan dari kosakata tetap. Satu barang × ukuran hanya sekali. Nama barang
 * dan label ukurannya disusun SERVER, bukan dari HP.
 */
export function rapikanBarisRekomendasi(raw: unknown): { ok: true; baris: BarisRekomendasi[] } | { ok: false; kode: KodeTolakBaris } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, kode: "TANPA_BARIS" };
  if (raw.length > BATAS_BARIS_REKOMENDASI) return { ok: false, kode: "TERLALU_BANYAK_BARIS" };
  const hasil: BarisRekomendasi[] = [];
  const terlihat = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") return { ok: false, kode: "ISIAN_TIDAK_VALID" };
    const o = r as Record<string, unknown>;
    const itemId = typeof o.itemId === "string" ? o.itemId.trim() : "";
    const variantSku = o.variantSku == null ? "" : typeof o.variantSku === "string" ? o.variantSku.trim() : null;
    const alasan = o.alasan ?? "MANUAL";
    if (!itemId || itemId.length > 64 || variantSku === null || variantSku.length > 120) return { ok: false, kode: "ISIAN_TIDAK_VALID" };
    if (!(ALASAN_REKOMENDASI as readonly unknown[]).includes(alasan)) return { ok: false, kode: "ISIAN_TIDAK_VALID" };
    if (typeof o.qty !== "number" || !Number.isInteger(o.qty) || o.qty < 1 || o.qty > QTY_MAKS_REKOMENDASI) {
      return { ok: false, kode: "JUMLAH_TIDAK_VALID" };
    }
    const kunci = `${itemId}::${variantSku}`;
    if (terlihat.has(kunci)) return { ok: false, kode: "BARIS_GANDA" };
    terlihat.add(kunci);
    hasil.push({ itemId, variantSku, qty: o.qty, alasan: alasan as AlasanRekomendasi });
  }
  return { ok: true, baris: hasil };
}

/** Teks bebas (catatan/alasan): dirapikan; kosong → null, atau ditolak bila wajib. */
export function rapikanTeksRekomendasi(
  raw: unknown,
  wajib: boolean,
): { ok: true; teks: string | null } | { ok: false; kode: "ALASAN_WAJIB" | "TEKS_TERLALU_PANJANG" } {
  const teks = typeof raw === "string" ? raw.trim() : "";
  if (teks.length > BATAS_TEKS_REKOMENDASI) return { ok: false, kode: "TEKS_TERLALU_PANJANG" };
  if (!teks) return wajib ? { ok: false, kode: "ALASAN_WAJIB" } : { ok: true, teks: null };
  return { ok: true, teks };
}

/** Catatan jawaban saat salesman menandai toko tanpa SPG setuju. */
export function catatanSetujuToko(sumber: SumberSetujuToko, catatan: string | null): string {
  const asal = sumber === "WHATSAPP" ? "Toko setuju lewat WhatsApp" : "Toko setuju langsung";
  return catatan ? `${asal}: ${catatan}` : asal;
}

// ─── Varian barang ───────────────────────────────────────────────────────────

/**
 * SKU varian yang tercatat di `Item.variants`. Sebagian data lama menyimpan
 * varian sebagai TEKS JSON dengan kunci campuran huruf besar ("SKU", "Sku") —
 * dibaca tanpa peduli bentuknya, seperti `bacaVarian`.
 */
export function skuVarianBarang(variants: unknown): string[] {
  let v = variants;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  const hasil: string[] = [];
  for (const baris of v) {
    if (!baris || typeof baris !== "object" || Array.isArray(baris)) continue;
    for (const [k, nilai] of Object.entries(baris as Record<string, unknown>)) {
      if (k.toLowerCase() !== "sku") continue;
      const s = nilai == null ? "" : String(nilai).trim();
      if (s && !hasil.includes(s)) hasil.push(s);
    }
  }
  return hasil;
}

/**
 * Pilihan ukuran sebuah barang untuk rekomendasi: yang tercatat di master
 * barang (urutannya dipertahankan — biasanya S, M, L, XL) lalu varian lain
 * yang hanya ada di stok gudang, dengan label "Hitam · M". Kosong = barang
 * tanpa varian (baris memakai variantSku "").
 */
export function opsiVarianBarang(input: { variants: unknown; skuInduk: string; skuStok: readonly (string | null)[] }): { sku: string; label: string }[] {
  const master = skuVarianBarang(input.variants);
  const lain = [...new Set(input.skuStok.map((s) => (s ?? "").trim()).filter((s) => s && !master.includes(s)))];
  const beriLabel = (sku: string) => ({ sku, label: labelVarianSerap(input.variants, sku, input.skuInduk) ?? sku });
  return [...master.map(beriLabel), ...lain.map(beriLabel).sort((a, b) => a.label.localeCompare(b.label, "id", { numeric: true }))];
}

/** Nama baris yang disimpan: "Kaos — Hitam · M", atau nama barang saja. */
export function namaBarisRekomendasi(nama: string, labelVarian: string | null): string {
  return labelVarian ? `${nama} — ${labelVarian}` : nama;
}
