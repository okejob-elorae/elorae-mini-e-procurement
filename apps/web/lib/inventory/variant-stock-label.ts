import { parseItemVariants } from "@/lib/items/variants";

export type VariantStockChip = {
  variantSku: string;
  qtyOnHand: number;
  reservedQty: number;
  available: number;
  label: string;
};

export type VariantStockRowInput = {
  variantSku: string | null | undefined;
  qtyOnHand: number;
  reservedQty: number;
};

const SIZE_ORDER = [
  "XXS",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "XXL",
  "2XL",
  "3XL",
  "4XL",
  "5XL",
] as const;

const sizeRank = new Map<string, number>(
  SIZE_ORDER.map((s, i) => [s.toLowerCase(), i]),
);

function attrCaseInsensitive(
  row: Record<string, string>,
  key: string,
): string | null {
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(row)) {
    if (k.toLowerCase() === lower && v != null && String(v).trim() !== "") {
      return String(v).trim();
    }
  }
  return null;
}

/** Prefer size; else color; else variantSku. When size+color both exist, size wins (mock chips). */
export function resolveVariantStockLabel(
  variantSku: string,
  itemVariants: unknown,
): string {
  const sku = variantSku.trim();
  if (!sku) return "";

  const rows = parseItemVariants(itemVariants);
  const match = rows.find((v) => (v.sku ?? "").trim() === sku);
  if (!match) return sku;

  const size = attrCaseInsensitive(match, "size");
  if (size) return size;

  const color = attrCaseInsensitive(match, "color");
  if (color) return color;

  return sku;
}

function compareVariantLabels(a: string, b: string): number {
  const ra = sizeRank.get(a.toLowerCase());
  const rb = sizeRank.get(b.toLowerCase());
  if (ra != null && rb != null) return ra - rb;
  if (ra != null) return -1;
  if (rb != null) return 1;
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/**
 * Build labeled chips from factual InventoryValue-like rows.
 * Drops empty/null/"" variantSku. Sorted by apparel size order then label.
 */
export function buildVariantStockChips(
  rows: VariantStockRowInput[],
  itemVariants: unknown,
): VariantStockChip[] {
  const chips: VariantStockChip[] = [];

  for (const row of rows) {
    const variantSku = (row.variantSku ?? "").trim();
    if (!variantSku) continue;

    const qtyOnHand = row.qtyOnHand;
    const reservedQty = row.reservedQty;
    chips.push({
      variantSku,
      qtyOnHand,
      reservedQty,
      available: qtyOnHand - reservedQty,
      label: resolveVariantStockLabel(variantSku, itemVariants),
    });
  }

  chips.sort(
    (a, b) =>
      compareVariantLabels(a.label, b.label) ||
      a.variantSku.localeCompare(b.variantSku),
  );
  return chips;
}
