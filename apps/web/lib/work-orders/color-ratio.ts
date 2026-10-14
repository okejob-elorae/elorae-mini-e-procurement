import { sizeMatchKey } from "@elorae/db/variant-axes";

/** A finished-good variant with its resolved colour and size, for the colour-first WO ratio (#410). */
export type VariantAxisRow = {
  variantSku: string;
  /** Colour master id, or `label:<matchKey>` for a colour text the master does not know, or `none`. */
  colorKey: string;
  colorName: string | null;
  size: string | null;
};

export type RatioRow = { variantSku: string; ratioPercent: number };

const SIZE_ORDER = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "3XL", "4XL", "5XL", "ALLSIZE", "FREESIZE"];

function sizeRank(size: string | null): number {
  if (!size) return SIZE_ORDER.length + 1;
  const i = SIZE_ORDER.indexOf(sizeMatchKey(size));
  return i === -1 ? SIZE_ORDER.length : i;
}

/** Variants grouped by colour in first-seen order, each colour's sizes in garment order (S, M, L, XL…). */
export function groupVariantsByColor(rows: VariantAxisRow[]): Array<{ colorKey: string; colorName: string | null; variants: VariantAxisRow[] }> {
  const groups: Array<{ colorKey: string; colorName: string | null; variants: VariantAxisRow[] }> = [];
  for (const row of rows) {
    let g = groups.find((x) => x.colorKey === row.colorKey);
    if (!g) {
      g = { colorKey: row.colorKey, colorName: row.colorName, variants: [] };
      groups.push(g);
    }
    g.variants.push(row);
  }
  // Array.prototype.sort is stable, so sizes the order does not know keep their listed order.
  for (const g of groups) g.variants.sort((a, b) => sizeRank(a.size) - sizeRank(b.size));
  return groups;
}

/** Whole-percent even split that sums to 100; the remainder goes to the first variant. */
export function evenRatios(variantSkus: string[]): RatioRow[] {
  if (variantSkus.length === 0) return [];
  const each = Math.floor(100 / variantSkus.length);
  const remainder = 100 - each * variantSkus.length;
  return variantSkus.map((variantSku, i) => ({ variantSku, ratioPercent: i === 0 ? each + remainder : each }));
}
