import { matchKey } from "@/lib/items/variant-rows";
import { parseItemVariants, variantSelectOptions } from "@/lib/items/variants";

/** `variantSku: ""` is the pooled (sizeless) key; the screen supplies its label. */
export type ReturVariantOption = { variantSku: string; variantLabel: string };

type VariantSources = {
  variants: unknown;
  inventorySkus: Array<string | null>;
  storeStockSkus: string[];
};

type KeyEntry = { display: string; label: string; spellings: Set<string>; valid: boolean };

/**
 * Decides which variant keys a retur line may name, so stock lands on the bucket that actually
 * holds it. A variant item can hold ONE pooled `InventoryValue` row (`null`/`""`) instead of
 * per-variant rows; a declared variant on such an item has no row of its own, so approving it
 * would open a new main row beside the pooled one and drive a fresh store row negative while
 * the pooled store row keeps the stock — crediting and billing the store for the same units.
 *
 * - A non-empty key is valid when an `InventoryValue` row or this store's `StoreStock` row
 *   exists for it, or when the item declares it and has NO pooled `InventoryValue` row.
 * - `""` is valid for a simple item (no declared variants), an item with a pooled
 *   `InventoryValue` row, or one this store holds a `""` `StoreStock` row for.
 *
 * Keys are grouped by `matchKey`, the database collation's fold, and shown in the catalog's
 * own spelling. The fold only groups: a key is accepted in a spelling one of the sources
 * actually holds, never in an invented one.
 */
function resolveReturnableKeys(input: VariantSources) {
  const declared = variantSelectOptions(parseItemVariants(input.variants));
  const simple = declared.length === 0;
  const pooled = input.inventorySkus.some((sku) => matchKey(sku) === "");
  const storePooled = input.storeStockSkus.some((sku) => matchKey(sku) === "");

  const entries = new Map<string, KeyEntry>();
  const note = (sku: string, label: string | null, valid: boolean) => {
    const key = matchKey(sku);
    if (key === "") return;
    const entry = entries.get(key);
    if (entry) {
      entry.spellings.add(sku);
      if (valid) entry.valid = true;
      return;
    }
    entries.set(key, { display: sku, label: label ?? sku, spellings: new Set([sku]), valid });
  };
  for (const o of declared) note(o.sku, o.label, !pooled);
  for (const sku of input.inventorySkus) if (sku != null) note(sku, null, true);
  for (const sku of input.storeStockSkus) note(sku, null, true);

  return { simple, emptyValid: simple || pooled || storePooled, entries };
}

/**
 * The retur picker's options for one item: exactly the keys `isReturnableVariantKey` accepts.
 * Empty for a simple item whose only returnable key is `""`, which the screen renders without a
 * variant picker; otherwise the pooled `""` option comes first whenever it is valid.
 */
export function returVariantOptions(input: VariantSources): ReturVariantOption[] {
  const { simple, emptyValid, entries } = resolveReturnableKeys(input);
  const options = Array.from(entries.values())
    .filter((e) => e.valid)
    .map((e) => ({ variantSku: e.display, variantLabel: e.label }))
    .sort((a, b) => a.variantLabel.localeCompare(b.variantLabel));
  if (simple && options.length === 0) return [];
  return emptyValid ? [{ variantSku: "", variantLabel: "" }, ...options] : options;
}

/** Write-side rule for a retur line's `variantSku`, shared with the picker through `resolveReturnableKeys`. */
export function isReturnableVariantKey(input: VariantSources & { variantSku: string }): boolean {
  const { emptyValid, entries } = resolveReturnableKeys(input);
  if (input.variantSku === "") return emptyValid;
  const entry = entries.get(matchKey(input.variantSku));
  return entry !== undefined && entry.valid && entry.spellings.has(input.variantSku);
}
