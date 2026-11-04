import { prisma } from "@elorae/db";

export type JubelioCreateEligibility =
  | "eligible"
  | "not_found"
  | "not_erp_finished_good"
  | "offline_channel"
  | "category_unmapped"
  | "already_mapped"
  | "already_requested"
  | "already_queued";

/**
 * Whether the item page may offer "Ajukan ke Jubelio" for an item. The button REQUESTS creation —
 * it pushes nothing; the product is created in Jubelio once its price is confirmed on Jubelio →
 * Konfirmasi harga (owner decision 2026-11-02, `lib/jubelio/harga/pengajuan.ts`). ERP finished
 * goods only; not one Jubelio already has, not one already requested, not one whose create push is
 * already on its way; and its category must be mapped, or the confirmation could never be sent.
 * Never an item sold in offline stores only (owner answer P3a): the button is hidden for it.
 */
export async function jubelioCreateEligibility(itemId: string): Promise<JubelioCreateEligibility> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { type: true, source: true, salesChannel: true, categoryId: true, jubelioCreateRequestedAt: true },
  });
  if (!item) return "not_found";
  if (item.type !== "FINISHED_GOOD" || item.source !== "ERP") return "not_erp_finished_good";
  if (item.salesChannel === "OFFLINE") return "offline_channel";
  if ((await prisma.jubelioProductMapping.count({ where: { itemId } })) > 0) return "already_mapped";
  if (item.jubelioCreateRequestedAt != null) return "already_requested";
  const queued = await prisma.jubelioOutbox.count({
    where: { entityType: "product_push", entityId: itemId, status: { in: ["PENDING", "PROCESSING"] } },
  });
  if (queued > 0) return "already_queued";
  if (!item.categoryId) return "category_unmapped";
  if ((await prisma.jubelioCategoryMapping.count({ where: { itemCategoryId: item.categoryId } })) === 0) {
    return "category_unmapped";
  }
  return "eligible";
}
