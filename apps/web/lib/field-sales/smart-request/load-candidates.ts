import { prisma } from "@elorae/db";
import { parseItemVariants } from "@/lib/items/variants";
import type { PlanCandidate } from "./plan";

/**
 * Active finished goods in the given categories, shaped for the planner:
 * raw variants (variantSku + size) + main-WH available (qtyOnHand - reservedQty).
 * Items with no variant rows contribute a single null-sku bucket so a
 * ratio that names sizes will simply not match them (they drop MISSING_SIZE) —
 * expected, smart-request is a sized-pack flow.
 */
export async function loadSmartRequestCandidates(categoryIds: string[]): Promise<Map<string, PlanCandidate[]>> {
  const items = await prisma.item.findMany({
    where: { isActive: true, type: "FINISHED_GOOD", categoryId: { in: categoryIds } },
    select: {
      id: true,
      sku: true,
      categoryId: true,
      variants: true,
      inventoryValues: { select: { variantSku: true, qtyOnHand: true, reservedQty: true } },
    },
  });

  const byCategory = new Map<string, PlanCandidate[]>();
  for (const it of items) {
    const availByVariant: Record<string, number> = {};
    for (const iv of it.inventoryValues) {
      const key = iv.variantSku ?? "";
      availByVariant[key] = Number(iv.qtyOnHand) - Number(iv.reservedQty ?? 0);
    }
    const variants = parseItemVariants(it.variants)
      .map((v) => ({ variantSku: (v.sku ?? "").trim(), size: (v.size ?? "").trim() }))
      .filter((v) => v.variantSku !== "");
    const candidate: PlanCandidate = { itemId: it.id, sku: it.sku, variants, available: availByVariant };
    const cat = it.categoryId ?? "";
    const list = byCategory.get(cat) ?? [];
    list.push(candidate);
    byCategory.set(cat, list);
  }
  return byCategory;
}
