import { prisma } from "@elorae/db";
import { itemHasSkuVariants, parseItemVariants, variantSelectOptions } from "@/lib/items/variants";

export type StocktakeItemOption = {
  itemId: string;
  itemSku: string;
  itemName: string;
  variantSku: string;
  /** The variant's display label, or null for an item without SKU variants. */
  variantLabel: string | null;
};

export const STOCKTAKE_ITEM_SEARCH_LIMIT = 30;

/**
 * The stocktake add-item pickers' search: active items whose SKU or name contains `q`, flattened
 * to one option per SKU variant. Reads only the four columns the picker shows, and at most
 * `STOCKTAKE_ITEM_SEARCH_LIMIT` items, instead of the whole catalogue with its stock and BOM
 * relations. `truncated` says more items matched, so the picker can ask for a narrower search.
 */
export async function searchStocktakeItems(q: string): Promise<{ options: StocktakeItemOption[]; truncated: boolean }> {
  const needle = q.trim();
  const items = await prisma.item.findMany({
    where: {
      isActive: true,
      ...(needle ? { OR: [{ sku: { contains: needle } }, { nameId: { contains: needle } }] } : {}),
    },
    orderBy: { sku: "asc" },
    take: STOCKTAKE_ITEM_SEARCH_LIMIT + 1,
    select: { id: true, sku: true, nameId: true, variants: true },
  });

  const truncated = items.length > STOCKTAKE_ITEM_SEARCH_LIMIT;
  const options: StocktakeItemOption[] = [];
  for (const item of items.slice(0, STOCKTAKE_ITEM_SEARCH_LIMIT)) {
    if (itemHasSkuVariants(item.variants)) {
      for (const variant of variantSelectOptions(parseItemVariants(item.variants))) {
        options.push({ itemId: item.id, itemSku: item.sku, itemName: item.nameId, variantSku: variant.sku, variantLabel: variant.label });
      }
    } else {
      options.push({ itemId: item.id, itemSku: item.sku, itemName: item.nameId, variantSku: "", variantLabel: null });
    }
  }
  return { options, truncated };
}
