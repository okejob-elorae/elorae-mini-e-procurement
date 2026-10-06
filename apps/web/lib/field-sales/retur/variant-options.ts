import { parseItemVariants, variantSelectOptions } from "@/lib/items/variants";

export type ReturVariantOption = { variantSku: string; variantLabel: string };

type VariantSources = {
  variants: unknown;
  inventorySkus: Array<string | null>;
  storeStockSkus: string[];
};

/**
 * The returnable variant keys of an item: declared variant SKUs, plus every non-empty
 * `InventoryValue` and `StoreStock` spelling. Each source has blind spots a lone one cannot
 * cover (a pooled inventory row names no variant, a declared variant may never have been
 * stocked, a store may hold stock for a variant since removed), so the union is the contract.
 */
export function returVariantOptions(input: VariantSources): ReturVariantOption[] {
  const labelBySku = new Map<string, string>();
  for (const o of variantSelectOptions(parseItemVariants(input.variants))) {
    if (!labelBySku.has(o.sku)) labelBySku.set(o.sku, o.label);
  }
  const keys = new Set<string>(labelBySku.keys());
  for (const sku of input.inventorySkus) {
    if (sku != null && sku.trim() !== "") keys.add(sku);
  }
  for (const sku of input.storeStockSkus) {
    if (sku.trim() !== "") keys.add(sku);
  }
  return Array.from(keys)
    .map((variantSku) => ({ variantSku, variantLabel: labelBySku.get(variantSku) ?? variantSku }))
    .sort((a, b) => a.variantLabel.localeCompare(b.variantLabel));
}

/**
 * Write-side rule for a retur line's `variantSku`, matched on the EXACT spelling — never
 * `matchKey`, which is a display-side fold. `""` is accepted only for a simple item (no
 * returnable key at all) or when the store holds legacy pooled `""` stock for it.
 */
export function isReturnableVariantKey(input: VariantSources & { variantSku: string }): boolean {
  const options = returVariantOptions(input);
  if (input.variantSku === "") {
    return options.length === 0 || input.storeStockSkus.includes("");
  }
  return options.some((o) => o.variantSku === input.variantSku);
}
