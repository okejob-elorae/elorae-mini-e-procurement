import { parseItemVariants } from '@/lib/items/variants';

type ItemLookup = {
  findMany: (args: {
    where: { id: { in: string[] } };
    select: { id: true; sku: true; variants: true };
  }) => Promise<Array<{ id: string; sku: string; variants: unknown }>>;
};

/** Ensures variantSku is set iff item has variants (per Item.variants[].sku). */
export async function assertLinesVariantSkusMatchItemDefinitions(
  itemDelegate: ItemLookup,
  lines: Array<{ itemId: string; variantSku?: string | null | undefined }>
) {
  const ids = [...new Set(lines.map((l) => l.itemId).filter(Boolean))];
  if (ids.length === 0) return;
  const rows = await itemDelegate.findMany({
    where: { id: { in: ids } },
    select: { id: true, sku: true, variants: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const line of lines) {
    const row = byId.get(line.itemId);
    if (!row) throw new Error(`Item not found: ${line.itemId}`);
    const variants = parseItemVariants(row.variants);
    const allowed = new Set(variants.map((v) => (v.sku ?? '').trim()).filter(Boolean));
    if (allowed.size > 0) {
      const v = line.variantSku?.trim();
      if (!v || !allowed.has(v)) {
        throw new Error(`Select a valid variant for item ${row.sku}`);
      }
    } else if (line.variantSku?.trim()) {
      throw new Error(`Item ${row.sku} has no variants; clear variant selection`);
    }
  }
}
