import type { Prisma, PrismaClient } from "@elorae/db";
import { skuMatchKey } from "@/lib/items/sku-match-key";

export class VariantSkuTakenError extends Error {
  constructor(public readonly skus: string[]) {
    super(`Variant SKU already used by another item: ${skus.join(", ")}`);
    this.name = "VariantSkuTakenError";
  }
}

/**
 * Variant SKUs live inside Item.variants JSON with no index, so the database cannot refuse a
 * duplicate across items. This is the application-side check the import already runs, applied to
 * the single-item path. Compares under skuMatchKey because the collation folds case and accents.
 */
export async function findVariantSkuCollisions(
  client: PrismaClient | Prisma.TransactionClient,
  opts: { excludeItemId?: string; skus: string[] },
): Promise<string[]> {
  const wanted = opts.skus.filter((s) => s.trim() !== "");
  if (wanted.length === 0) return [];
  const others = await client.item.findMany({
    where: opts.excludeItemId ? { id: { not: opts.excludeItemId } } : {},
    select: { sku: true, variants: true },
  });
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
