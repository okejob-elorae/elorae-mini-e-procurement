import type { Prisma, PrismaClient } from "@elorae/db";
import { skuMatchKey } from "@/lib/items/sku-match-key";

export class VariantSkuTakenError extends Error {
  constructor(public readonly skus: string[]) {
    super(`Variant SKU already used by another item: ${skus.join(", ")}`);
    this.name = "VariantSkuTakenError";
  }
}

export class VariantBarcodeTakenError extends Error {
  constructor(public readonly barcodes: string[]) {
    super(`Variant barcode already used by another item: ${barcodes.join(", ")}`);
    this.name = "VariantBarcodeTakenError";
  }
}

export type OtherItemRow = { sku: string; variants: unknown };

/**
 * Every other item's SKU and variants, read once per save so the SKU and barcode finders share a
 * single scan of Item.variants instead of one each.
 */
export async function loadOtherItemsForCollisions(
  client: PrismaClient | Prisma.TransactionClient,
  excludeItemId?: string,
): Promise<OtherItemRow[]> {
  return client.item.findMany({
    where: excludeItemId ? { id: { not: excludeItemId } } : {},
    select: { sku: true, variants: true },
  });
}

/**
 * Variant SKUs live inside Item.variants JSON with no index, so the database cannot refuse a
 * duplicate across items. This is the application-side check the import already runs, applied to
 * the single-item path. Compares under skuMatchKey because the collation folds case and accents.
 */
export function findVariantSkuCollisions(others: OtherItemRow[], opts: { skus: string[] }): string[] {
  const wanted = opts.skus.filter((s) => s.trim() !== "");
  if (wanted.length === 0) return [];
  const taken = new Set<string>();
  for (const item of others) {
    taken.add(skuMatchKey(item.sku));
    const variants = Array.isArray(item.variants) ? item.variants : [];
    for (const v of variants) {
      const sku = (v as Record<string, unknown>)?.sku;
      if (typeof sku === "string" && sku.trim() !== "") taken.add(skuMatchKey(sku));
    }
  }
  return wanted.filter((s) => taken.has(skuMatchKey(s)));
}

/**
 * The barcode twin of findVariantSkuCollisions: variant barcodes also live in Item.variants JSON
 * with no index. Compared under skuMatchKey, like the import's BARCODE_TAKEN check.
 */
export function findVariantBarcodeCollisions(others: OtherItemRow[], opts: { barcodes: string[] }): string[] {
  const wanted = opts.barcodes.filter((b) => b.trim() !== "");
  if (wanted.length === 0) return [];
  const taken = new Set<string>();
  for (const item of others) {
    const variants = Array.isArray(item.variants) ? item.variants : [];
    for (const v of variants) {
      const barcode = (v as Record<string, unknown>)?.barcode;
      if (typeof barcode === "string" && barcode.trim() !== "") taken.add(skuMatchKey(barcode));
    }
  }
  return wanted.filter((b) => taken.has(skuMatchKey(b)));
}

/**
 * The SKUs an edit adds to an item, compared under skuMatchKey. A SKU the item already carries is
 * not re-checked, so a legacy duplicate does not block unrelated edits.
 */
export function skusIntroducedByEdit(saved: string[], next: string[]): string[] {
  const savedKeys = new Set(saved.map((s) => skuMatchKey(s)));
  return next.filter((s) => !savedKeys.has(skuMatchKey(s)));
}
