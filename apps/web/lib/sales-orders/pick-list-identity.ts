import { prisma } from "@elorae/db";
import { variantDetailForSku } from "@/lib/items/variants";

export type PickListLineIdentity = {
  itemId: string;
  variantSku: string | null;
  code: string;
  nameId: string;
  nameEn: string;
  variantDetail: string | null;
};

export type PickListLineSource = {
  id: string;
  jubelioItemId: number;
  itemId: string | null;
};

type MappingRow = { jubelioItemId: number; itemId: string; erpVariantSku: string };
export type PickListItemRow = { id: string; sku: string; nameId: string; nameEn: string; variants: unknown };

/**
 * The mapping wins over `SalesOrderItem.itemId`: it is what the reservation path resolves a
 * Jubelio line through, and the line's own `itemId` is only stamped at ingest. Without a mapping
 * the variant is unknown, so the line prints at item level rather than guessing one.
 */
export function resolvePickListLineIdentity(
  line: PickListLineSource,
  mapping: MappingRow | undefined,
  itemsById: Map<string, PickListItemRow>,
): PickListLineIdentity | null {
  const itemId = mapping?.itemId ?? line.itemId;
  if (itemId === null) return null;
  const item = itemsById.get(itemId);
  if (!item) return null;

  const mappedVariant = mapping?.erpVariantSku.trim() ?? "";
  const variantSku = mappedVariant === "" ? null : mappedVariant;
  return {
    itemId: item.id,
    variantSku,
    code: variantSku ?? item.sku,
    nameId: item.nameId,
    nameEn: item.nameEn,
    variantDetail: variantDetailForSku(item.variants, variantSku),
  };
}

/** Lines with no resolvable Elorae item are absent from the result; callers print the Jubelio fields for them. */
export async function getPickListLineIdentities(
  lines: PickListLineSource[],
): Promise<Record<string, PickListLineIdentity>> {
  if (lines.length === 0) return {};

  const jubelioItemIds = Array.from(new Set(lines.map((l) => l.jubelioItemId)));
  const mappings: MappingRow[] = await prisma.jubelioProductMapping.findMany({
    where: { jubelioItemId: { in: jubelioItemIds } },
    select: { jubelioItemId: true, itemId: true, erpVariantSku: true },
  });
  const mappingByJubelioId = new Map(mappings.map((m) => [m.jubelioItemId, m]));

  const itemIds = new Set<string>();
  for (const line of lines) {
    const itemId = mappingByJubelioId.get(line.jubelioItemId)?.itemId ?? line.itemId;
    if (itemId !== null) itemIds.add(itemId);
  }
  if (itemIds.size === 0) return {};

  const items: PickListItemRow[] = await prisma.item.findMany({
    where: { id: { in: Array.from(itemIds) } },
    select: { id: true, sku: true, nameId: true, nameEn: true, variants: true },
  });
  const itemsById = new Map(items.map((i) => [i.id, i]));

  const out: Record<string, PickListLineIdentity> = {};
  for (const line of lines) {
    const identity = resolvePickListLineIdentity(line, mappingByJubelioId.get(line.jubelioItemId), itemsById);
    if (identity) out[line.id] = identity;
  }
  return out;
}
