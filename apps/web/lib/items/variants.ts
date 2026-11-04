import { resolveVariantAxes } from '@elorae/db/variant-axes';

export type ItemVariantRow = Record<string, string>;

/**
 * Baris varian sebuah barang. Toleran terhadap dua bentuk data lama yang nyata
 * (2026-10-03): varian yang tersimpan sebagai TEKS JSON alih-alih larik, dan
 * kunci berhuruf besar ("SKU", "Barcode"). Tanpa ini layar jual, minta kiriman,
 * dan katalog menganggap barang itu tanpa varian, sementara Info produk dan
 * analisa (yang membaca lewat `bacaVarian`) melihat ukurannya.
 */
export function parseItemVariants(raw: unknown): ItemVariantRow[] {
  let v = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  return v
    .filter((r): r is ItemVariantRow => r != null && typeof r === 'object' && !Array.isArray(r))
    .map((r) => {
      const baris = r as Record<string, unknown>;
      if (baris.sku !== undefined && baris.barcode !== undefined) return r;
      const salin: Record<string, unknown> = { ...baris };
      for (const [k, nilai] of Object.entries(baris)) {
        const kecil = k.toLowerCase();
        if ((kecil === 'sku' || kecil === 'barcode') && salin[kecil] === undefined) {
          salin[kecil] = nilai;
          delete salin[k];
        }
      }
      return salin as ItemVariantRow;
    });
}

const NO_COLORS = new Map<string, string>();

/** Options for PO/GRN variant selects; skips rows without sku. */
/** Human-readable attributes for a variant row (excludes sku key). */
export function variantDetailForSku(
  variants: unknown,
  variantSku: string | null | undefined
): string | null {
  if (!variantSku?.trim()) return null;
  const rows = parseItemVariants(variants);
  const row = rows.find((v) => (v.sku ?? '').trim() === variantSku.trim());
  if (!row) return null;
  const parts = Object.entries(row)
    .filter(([k, v]) => k !== 'sku' && k !== 'barcode' && v != null && String(v).trim() !== '')
    .map(([k, v]) => `${k}: ${String(v).trim()}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function variantSelectOptions(variants: ItemVariantRow[]): { sku: string; label: string }[] {
  const out: { sku: string; label: string }[] = [];
  for (const v of variants) {
    const sku = (v.sku ?? '').trim();
    if (!sku) continue;
    const axes = resolveVariantAxes(v, NO_COLORS);
    const labelParts = [axes.colorLabel, axes.size, v.name, v.nameId]
      .map((x) => (x != null ? String(x).trim() : ''))
      .filter(Boolean);
    const label = labelParts.length > 0 ? `${labelParts.join(' · ')} (${sku})` : sku;
    out.push({ sku, label });
  }
  return out;
}

/** True when the item has at least one variant row with a non-empty SKU. */
export function itemHasSkuVariants(variants: unknown): boolean {
  return variantSelectOptions(parseItemVariants(variants)).length > 0;
}

/**
 * True when a stock row can exist for this variant key on an item with these variant rows — a
 * variant item only stocks its own trimmed SKUs, and a variantless item only stocks the pooled
 * `""` key. Shared by the konsi push and approve writers' refusals and by
 * `filterStageableSuggestions`, so they agree on which suggestion rows are stageable.
 */
export function isStockableVariantKey(variants: unknown, variantSku: string): boolean {
  if (!itemHasSkuVariants(variants)) return variantSku === "";
  const variantSkus = new Set(
    parseItemVariants(variants)
      .map((v) => (v.sku ?? "").trim())
      .filter((sku) => sku !== ""),
  );
  return variantSkus.has(variantSku);
}
