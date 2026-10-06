import { prisma } from "@elorae/db";
import { parseItemVariants } from "@/lib/items/variants";
import { skuMatchKey } from "@/lib/items/sku-match-key";
import type { ItemImportLookups } from "./validate";

/**
 * One read of everything the validator compares against. Every item's variants JSON is flattened
 * in memory — variant SKUs and barcodes live inside that JSON and cannot be looked up in SQL.
 */
export async function loadItemImportLookups(): Promise<ItemImportLookups> {
  const [uoms, categories, items] = await Promise.all([
    prisma.uOM.findMany({ where: { isActive: true }, select: { id: true, code: true } }),
    prisma.itemCategory.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true } }),
    prisma.item.findMany({ select: { sku: true, variants: true } }),
  ]);
  const existingItemSkus = new Set<string>();
  const existingVariantSkus = new Set<string>();
  const existingBarcodes = new Set<string>();
  for (const item of items) {
    existingItemSkus.add(skuMatchKey(item.sku));
    for (const v of parseItemVariants(item.variants)) {
      const sku = v.sku ?? "";
      if (sku.trim() !== "") existingVariantSkus.add(skuMatchKey(sku));
      const barcode = v.barcode ?? "";
      if (barcode.trim() !== "") existingBarcodes.add(skuMatchKey(barcode));
    }
  }
  return { uoms, categories, existingItemSkus, existingVariantSkus, existingBarcodes };
}
