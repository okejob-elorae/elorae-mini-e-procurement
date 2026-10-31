import type { PromoKonter } from "./promo-konter";
import { alamatMinta } from "./saran-minta";

/**
 * Info produk untuk pembeli di HP SPG — aturan dan bentuk data, murni, aman
 * diimpor komponen klien (kueri ada di `produk-queries.ts`, hanya server).
 *
 * Yang SENGAJA tidak pernah sampai ke HP: angka stok gudang (hanya
 * keterangan Ada / Sisa sedikit / Kosong), harga pokok, dan rupiah toko lain.
 * Toko SPG lain hanya muncul sebagai nama + jumlah potong.
 */

/** Tersedia di gudang sebanyak ini atau lebih = "Ada di gudang". */
export const BATAS_GUDANG_ADA = 10;
/** Toko SPG lain yang ditampilkan per varian. */
export const MAKS_TOKO_LAIN = 5;

export type LabelGudang = "ADA" | "SEDIKIT" | "KOSONG";

export function labelGudang(tersedia: number): LabelGudang {
  if (!Number.isFinite(tersedia) || tersedia <= 0) return "KOSONG";
  return tersedia >= BATAS_GUDANG_ADA ? "ADA" : "SEDIKIT";
}

const angka = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Tersedia di gudang (qtyOnHand − reservedQty) untuk satu varian.
 *
 * Barang tanpa varian: semua baris barang itu. Barang bervarian: baris varian
 * itu DITAMBAH baris gabungan tanpa varian — penerimaan gudang lewat ERP bisa
 * menulis stok gabungan yang belum dipecah per ukuran, dan gudang yang memilih
 * ukurannya saat mengirim (aturan yang sama dengan saran minta kiriman).
 */
export function tersediaGudang(
  baris: readonly { variantSku: string | null; qtyOnHand: unknown; reservedQty: unknown }[],
  variantSku: string,
  bervarian: boolean,
): number {
  const tersedia = (b: { qtyOnHand: unknown; reservedQty: unknown }) => angka(b.qtyOnHand) - angka(b.reservedQty);
  if (!bervarian) return baris.reduce((n, b) => n + tersedia(b), 0);
  const gabungan = baris.filter((b) => !b.variantSku).reduce((n, b) => n + tersedia(b), 0);
  const sendiri = baris.filter((b) => b.variantSku === variantSku).reduce((n, b) => n + tersedia(b), 0);
  return sendiri + Math.max(0, gabungan);
}

export type TokoLain = { nama: string; qty: number };

/** Toko lain dengan stok positif, terbanyak dulu, paling banyak `maks`. */
export function tokoLainTeratas(baris: readonly TokoLain[], maks = MAKS_TOKO_LAIN): TokoLain[] {
  return baris
    .filter((b) => b.qty > 0)
    .sort((a, b) => b.qty - a.qty || a.nama.localeCompare(b.nama))
    .slice(0, maks);
}

/** Promo konter menyasar barang ini (sama dengan aturan mesin promo). */
export function promoMenyasarBarang(
  p: Pick<PromoKonter, "allItems" | "itemIds" | "categoryIds">,
  itemId: string,
  categoryId: string | null,
): boolean {
  if (p.allItems) return true;
  if (p.itemIds.includes(itemId)) return true;
  return categoryId !== null && p.categoryIds.includes(categoryId);
}

/**
 * SKU (dan barcode) varian dari `Item.variants`. Kolom itu bisa berupa larik
 * atau teks JSON, dan kuncinya bisa berhuruf besar (`SKU`, `Barcode`). Baris
 * tanpa SKU dibuang; SKU ganda hanya diambil sekali.
 */
export function barisVarianProduk(variants: unknown): { sku: string; barcode: string | null }[] {
  let v = variants;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  const hasil: { sku: string; barcode: string | null }[] = [];
  const dilihat = new Set<string>();
  for (const r of v) {
    if (!r || typeof r !== "object" || Array.isArray(r)) continue;
    let sku = "";
    let barcode = "";
    for (const [k, nilai] of Object.entries(r as Record<string, unknown>)) {
      const kunci = k.toLowerCase();
      if (kunci === "sku" && !sku) sku = String(nilai ?? "").trim();
      if (kunci === "barcode" && !barcode) barcode = String(nilai ?? "").trim();
    }
    if (!sku || dilihat.has(sku.toLowerCase())) continue;
    dilihat.add(sku.toLowerCase());
    hasil.push({ sku, barcode: barcode || null });
  }
  return hasil;
}

// ─── Bentuk data yang dikirim ke HP ───────────────────────────────────────────

/** Satu barang di daftar Info produk. */
export type ProdukDaftar = {
  itemId: string;
  nama: string;
  sku: string;
  /** Harga eceran (sama dengan katalog jual); null = belum diset. */
  harga: number | null;
  foto: string | null;
  /** Untuk pencarian dan pemindai: SKU dan barcode setiap varian. */
  varian: { variantSku: string; barcode: string | null }[];
};

export type PromoProduk = {
  id: string;
  nama: string;
  /** Satu kalimat dari `ringkasPromoKonter`. */
  ringkas: string;
  /** Berlaku sekarang; false = baru mulai nanti (`mulaiLabel`). */
  berlaku: boolean;
  mulaiLabel: string | null;
  sampaiLabel: string | null;
};

export type TabelUkuranProduk = {
  nama: string;
  satuan: "cm" | "inci";
  kolom: string[];
  baris: { ukuran: string; nilai: (number | null)[] }[];
  catatan: string | null;
  /** Dipasang di barang ini, atau ikut bawaan kategorinya. */
  sumber: "BARANG" | "KATEGORI";
};

export type VarianProduk = {
  /** "" untuk barang tanpa varian. */
  variantSku: string;
  label: string;
  barcode: string | null;
  /** Saldo buku stok toko ini; null bila buku toko belum dimulai. Boleh negatif. */
  stokToko: number | null;
  /** Hanya keterangan — angka gudang tidak pernah dikirim. */
  gudang: LabelGudang;
  tokoLain: TokoLain[];
};

export type InfoProduk = {
  itemId: string;
  nama: string;
  sku: string;
  /** Barang dinonaktifkan di master — tidak dijual lagi, tapi infonya tetap bisa dibaca. */
  aktif: boolean;
  kategori: string | null;
  deskripsi: string | null;
  bahan: string | null;
  caraRawat: string | null;
  harga: number | null;
  foto: { url: string; variantSku: string | null }[];
  promo: PromoProduk[];
  tabelUkuran: TabelUkuranProduk | null;
  /** Toko ini sudah punya buku stok (penerimaan atau opname pertama). */
  bukuDimulai: boolean;
  bervarian: boolean;
  varian: VarianProduk[];
};

/** Halaman satu barang; `variantSku` (hasil pindai kode varian) langsung terpilih. */
export function alamatInfoProduk(itemId: string, variantSku?: string | null): string {
  const dasar = `/pwa/spg/produk/${encodeURIComponent(itemId)}`;
  return variantSku ? `${dasar}?${new URLSearchParams({ varian: variantSku }).toString()}` : dasar;
}

/** Alamat "Titip pesan untuk pembeli" — layar titip menerima barang dan variannya. */
export function alamatTitipProduk(itemId: string, variantSku: string): string {
  const q = new URLSearchParams({ itemId });
  if (variantSku) q.set("variantSku", variantSku);
  return `/pwa/spg/titip/baru?${q.toString()}`;
}

/**
 * Alamat "Minta kiriman" dengan barang ini sudah terisi (satu potong, alasan
 * MANUAL). Barang bervarian tanpa ukuran terpilih membuka formulir dengan
 * pencarian terisi SKU barangnya — formulir yang menanyakan ukurannya.
 */
export function alamatMintaProduk(itemId: string, variantSku: string): string {
  return alamatMinta([{ itemId, variantSku, qty: 1, alasan: "MANUAL" }]);
}
