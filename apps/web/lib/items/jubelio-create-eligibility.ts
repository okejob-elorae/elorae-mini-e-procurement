import { prisma } from "@elorae/db";

export type JubelioCreateEligibility =
  | "eligible"
  | "not_found"
  | "not_erp_finished_good"
  | "category_unmapped"
  | "already_mapped"
  | "already_queued";

/**
 * Whether an item may be created in Jubelio by hand. Mirrors `enqueueProductPushOnCreate`'s own
 * gate (ERP finished goods only) and adds what a manual button must also respect: the push
 * handler skips an item whose category has no Jubelio mapping, a mapped item already exists in
 * Jubelio, and a queued push is already on its way.
 */
export async function jubelioCreateEligibility(itemId: string): Promise<JubelioCreateEligibility> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { type: true, source: true, categoryId: true },
  });
  if (!item) return "not_found";
  if (item.type !== "FINISHED_GOOD" || item.source !== "ERP") return "not_erp_finished_good";
  if (!item.categoryId) return "category_unmapped";
  if ((await prisma.jubelioCategoryMapping.count({ where: { itemCategoryId: item.categoryId } })) === 0) {
    return "category_unmapped";
  }
  if ((await prisma.jubelioProductMapping.count({ where: { itemId } })) > 0) return "already_mapped";
  const queued = await prisma.jubelioOutbox.count({
    where: { entityType: "product_push", entityId: itemId, status: { in: ["PENDING", "PROCESSING"] } },
  });
  return queued > 0 ? "already_queued" : "eligible";
}
