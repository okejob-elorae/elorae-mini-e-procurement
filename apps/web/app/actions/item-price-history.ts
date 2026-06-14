"use server";

import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";

export type ItemPriceHistoryRow = {
  id: string;
  changedAt: Date;
  triggerReason: "FG_RECEIPT" | "MARGIN_CHANGE" | "DEFAULTS_CHANGE" | "MANUAL_EDIT";
  oldSellingPrice: number | null;
  newSellingPrice: number | null;
  newAvgCost: number | null;
  marginPercentUsed: number | null;
  additionalCostUsed: number | null;
  fgReceiptDocNumber: string | null;
  changedByName: string | null;
};

export async function getItemPriceHistory(
  itemId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ rows: ItemPriceHistoryRow[]; total: number }> {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.ITEMS_VIEW);

  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const [rows, total] = await Promise.all([
    prisma.itemPriceChangeLog.findMany({
      where: { itemId },
      orderBy: { changedAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        fgReceipt: { select: { docNumber: true } },
        changedBy: { select: { name: true } },
      },
    }),
    prisma.itemPriceChangeLog.count({ where: { itemId } }),
  ]);

  return {
    rows: rows.map((r) => ({
      id: r.id,
      changedAt: r.changedAt,
      triggerReason: r.triggerReason,
      oldSellingPrice: r.oldSellingPrice != null ? Number(r.oldSellingPrice) : null,
      newSellingPrice: r.newSellingPrice != null ? Number(r.newSellingPrice) : null,
      newAvgCost: r.newAvgCost != null ? Number(r.newAvgCost) : null,
      marginPercentUsed: r.marginPercentUsed != null ? Number(r.marginPercentUsed) : null,
      additionalCostUsed: r.additionalCostUsed != null ? Number(r.additionalCostUsed) : null,
      fgReceiptDocNumber: r.fgReceipt?.docNumber ?? null,
      changedByName: r.changedBy?.name ?? null,
    })),
    total,
  };
}
