import { prisma } from "@elorae/db";
import { isStockableVariantKey } from "@/lib/items/variants";
import type { KonsiAssortmentGapSuggestion, KonsiSuggestion } from "./queries";

/**
 * The writers refuse a `""` row for an item with SKU variants (it would reserve against a pooled
 * variantless row the per-variant paths never see) and a non-empty row that names no real variant
 * SKU — both `NO_INVENTORY`. Either list can surface such a row: the never-sent core builds from
 * raw `InventoryValue` rows, so a variant item stocked only on a pooled `null` row shows up as a
 * `""` suggestion, and a gap row can name a stale SKU on an item whose variants changed since the
 * assortment line was set. Dropping them here, through the same `isStockableVariantKey` predicate
 * the writers enforce, means a ticked row can never come back refused.
 */
export async function filterStageableSuggestions(
  gaps: KonsiAssortmentGapSuggestion[],
  neverSent: KonsiSuggestion[],
): Promise<[KonsiAssortmentGapSuggestion[], KonsiSuggestion[]]> {
  const itemIds = Array.from(new Set([...gaps.map((g) => g.itemId), ...neverSent.map((n) => n.itemId)]));
  if (itemIds.length === 0) return [gaps, neverSent];

  const items = await prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, variants: true } });
  const variantsByItemId = new Map(items.map((i) => [i.id, i.variants]));
  const stageable = (itemId: string, variantSku: string) => isStockableVariantKey(variantsByItemId.get(itemId), variantSku);

  return [
    gaps.filter((g) => stageable(g.itemId, g.variantSku)),
    neverSent.filter((n) => stageable(n.itemId, n.variantSku)),
  ];
}
