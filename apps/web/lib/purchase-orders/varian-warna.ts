import { parseItemVariants, variantSelectOptions, type ItemVariantRow } from "@/lib/items/variants";

/*
 * Warna kain di PO = VARIAN bahan (keputusan sementara pemilik 2026-10-07,
 * opsi a). "+ Warna baru" di formulir PO menambah satu varian ke `Item.variants`
 * bahan non-barang-jadi: `{ <kunci warna>: "HITAM", sku: "<SKU>-HITAM",
 * pantone?: "19-4005 TCX" }`. Murni, aman di klien.
 *
 * Kunci warna mengikuti varian yang sudah ada ("Color" tetap "Color"); bahan
 * yang belum punya varian memakai "warna". `pantone` adalah kunci CADANGAN
 * seperti `sku`/`barcode`: bukan atribut varian, jadi formulir barang tidak
 * menjadikannya dimensi kombinasi (warna × pantone).
 *
 * Bahan yang variannya punya atribut lain (mis. ukuran, wash) DITOLAK: formulir
 * barang menyusun varian sebagai perkalian semua atribut, jadi satu warna tanpa
 * atribut lain akan hilang begitu barangnya disimpan dari Master Barang.
 */

export const KUNCI_PANTONE = "pantone";
export const MAKS_PANJANG_WARNA = 40;

const KUNCI_CADANGAN = new Set(["sku", "barcode", KUNCI_PANTONE]);
const POLA_KUNCI_WARNA = /^(warna|color|colour)$/i;

/** "  abu   muda " → "ABU MUDA". */
export function normalisasiWarna(teks: string | null | undefined): string {
  return (teks ?? "").trim().replace(/\s+/g, " ").toUpperCase();
}

/** Bagian SKU dari nama warna: "Abu Muda/2" → "ABU-MUDA-2". */
export function slugWarna(warna: string): string {
  return normalisasiWarna(warna)
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** SKU varian warna: `<SKU BAHAN>-<WARNA>`, huruf besar. */
export function skuVarianWarna(skuBarang: string, warna: string): string {
  return `${skuBarang.trim()}-${slugWarna(warna)}`.toUpperCase();
}

/** "19-4005" → "19-4005 TCX". */
export function labelPantone(tcx: string): string {
  return `${tcx.trim()} TCX`;
}

/** Atribut varian (tanpa kunci cadangan). */
export function atributVarian(baris: ItemVariantRow): string[] {
  return Object.keys(baris).filter((k) => !KUNCI_CADANGAN.has(k.toLowerCase()));
}

/** Kunci warna yang sudah dipakai varian barang ini, atau "warna". */
export function kunciWarnaBarang(baris: readonly ItemVariantRow[]): string {
  for (const b of baris) {
    const k = atributVarian(b).find((x) => POLA_KUNCI_WARNA.test(x));
    if (k) return k;
  }
  return "warna";
}

function nilaiWarna(baris: ItemVariantRow): string | null {
  const k = atributVarian(baris).find((x) => POLA_KUNCI_WARNA.test(x));
  const v = k ? String(baris[k] ?? "").trim() : "";
  return v || null;
}

function nilaiPantone(baris: ItemVariantRow): string | null {
  const k = Object.keys(baris).find((x) => x.toLowerCase() === KUNCI_PANTONE);
  const v = k ? String(baris[k] ?? "").trim() : "";
  return v || null;
}

export type TolakVarianWarna = "WARNA_KOSONG" | "WARNA_TERLALU_PANJANG" | "VARIAN_SUDAH_ADA" | "ATRIBUT_LAIN";

export type RencanaVarianWarna =
  | { ok: true; baris: ItemVariantRow; semua: ItemVariantRow[] }
  | { ok: false; kode: TolakVarianWarna; sku?: string };

/**
 * Varian warna baru untuk satu bahan: diperiksa terhadap varian yang ada.
 * Kembar = SKU sama ATAU nama warna sama (huruf besar/kecil tidak dibedakan);
 * SKU varian yang sudah ada ikut dikembalikan supaya layar bisa memilihnya.
 */
export function rencanaVarianWarna(
  variants: unknown,
  skuBarang: string,
  warnaMentah: string,
  pantone?: string | null,
): RencanaVarianWarna {
  const warna = normalisasiWarna(warnaMentah);
  if (!/[A-Z0-9]/.test(warna)) return { ok: false, kode: "WARNA_KOSONG" };
  if (warna.length > MAKS_PANJANG_WARNA) return { ok: false, kode: "WARNA_TERLALU_PANJANG" };

  const baris = parseItemVariants(variants);
  const kunci = kunciWarnaBarang(baris);
  if (baris.some((b) => atributVarian(b).some((k) => k !== kunci))) return { ok: false, kode: "ATRIBUT_LAIN" };

  const sku = skuVarianWarna(skuBarang, warna);
  const kembar = baris.find(
    (b) => (b.sku ?? "").trim().toUpperCase() === sku || normalisasiWarna(b[kunci]) === warna,
  );
  if (kembar) {
    const skuLama = (kembar.sku ?? "").trim();
    return { ok: false, kode: "VARIAN_SUDAH_ADA", ...(skuLama ? { sku: skuLama } : {}) };
  }

  const baru: ItemVariantRow = { [kunci]: warna, sku, ...(pantone?.trim() ? { [KUNCI_PANTONE]: pantone.trim() } : {}) };
  return { ok: true, baris: baru, semua: [...baris, baru] };
}

/** Warna (dan Pantone) sebuah varian bahan, untuk kolom Warna di layar dan di cetakan. */
export function warnaVarian(
  variants: unknown,
  variantSku: string | null | undefined,
): { warna: string; pantone: string | null } | null {
  const sku = (variantSku ?? "").trim();
  if (!sku) return null;
  const baris = parseItemVariants(variants).find((b) => (b.sku ?? "").trim() === sku);
  if (!baris) return null;
  const warna = nilaiWarna(baris);
  return warna ? { warna, pantone: nilaiPantone(baris) } : null;
}

/** "HITAM · 19-4005 TCX" / "HITAM". */
export function labelWarna(w: { warna: string; pantone: string | null }): string {
  return w.pantone ? `${w.warna} · ${w.pantone}` : w.warna;
}

export type OpsiVarianWarna = { sku: string; label: string; pantone: string | null };

/**
 * Pilihan varian bahan: label = nama warna (+ Pantone) bila variannya punya
 * warna, selain itu label bawaan pilihan varian PO/GRN.
 */
export function opsiVarianWarna(variants: unknown): OpsiVarianWarna[] {
  const baris = parseItemVariants(variants);
  return variantSelectOptions(baris).map((o) => {
    const b = baris.find((x) => (x.sku ?? "").trim() === o.sku);
    const warna = b ? nilaiWarna(b) : null;
    const pantone = b ? nilaiPantone(b) : null;
    return { sku: o.sku, label: warna ? labelWarna({ warna, pantone }) : o.label, pantone };
  });
}

/** Kode TCX dari teks Pantone tersimpan ("19-4005 TCX" → "19-4005"); null bila tidak terbaca. */
export function tcxDariLabel(teks: string | null | undefined): string | null {
  const m = (teks ?? "").match(/(\d{2}-\d{4})/);
  return m ? m[1] : null;
}
