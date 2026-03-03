'use server';

import { prisma } from '@/lib/prisma';
import { ItemType } from '@prisma/client';

export type HPPRow = {
  itemId: string;
  sku: string;
  nameId: string;
  nameEn: string | null;
  receiptCount: number;
  lastAvgCostPerUnit: number | null;
  lastMaterialCost: number | null;
  lastReceiptAt: Date | null;
};

/** List finished goods with HPP-related data from FG receipts. */
export async function getHPPList(): Promise<HPPRow[]> {
  const [items, receipts] = await Promise.all([
    prisma.item.findMany({
      where: { type: ItemType.FINISHED_GOOD, isActive: true },
      select: { id: true, sku: true, nameId: true, nameEn: true },
      orderBy: { sku: 'asc' },
    }),
    prisma.fGReceipt.findMany({
      include: { wo: { select: { finishedGoodId: true } } },
      orderBy: { receivedAt: 'desc' },
    }),
  ]);

  const byFg: Record<
    string,
    { count: number; last: { avgCostPerUnit: number | null; materialCost: number | null; receivedAt: Date } }
  > = {};
  for (const r of receipts) {
    const fgId = r.wo.finishedGoodId;
    if (!byFg[fgId]) {
      byFg[fgId] = {
        count: 0,
        last: {
          avgCostPerUnit: r.avgCostPerUnit != null ? Number(r.avgCostPerUnit) : null,
          materialCost: r.materialCost != null ? Number(r.materialCost) : null,
          receivedAt: r.receivedAt,
        },
      };
    }
    byFg[fgId].count += 1;
  }

  return items.map((item) => {
    const agg = byFg[item.id];
    return {
      itemId: item.id,
      sku: item.sku,
      nameId: item.nameId,
      nameEn: item.nameEn,
      receiptCount: agg?.count ?? 0,
      lastAvgCostPerUnit: agg?.last.avgCostPerUnit ?? null,
      lastMaterialCost: agg?.last.materialCost ?? null,
      lastReceiptAt: agg?.last.receivedAt ?? null,
    };
  });
}

/**
 * Automatic HPP: material cost and avg cost per unit are stored on each FG receipt in receiveFG.
 * This getter returns the effective HPP for one FG item from its latest receipt (for use in pricing/reports).
 * Labor/CMT and overhead can be added later via WO or allocation rules.
 */
export async function getEffectiveHPPForItem(finishedGoodId: string): Promise<{
  avgCostPerUnit: number | null;
  materialCost: number | null;
  lastReceiptAt: Date | null;
} | null> {
  const last = await prisma.fGReceipt.findFirst({
    where: { wo: { finishedGoodId } },
    orderBy: { receivedAt: 'desc' },
    select: { avgCostPerUnit: true, materialCost: true, receivedAt: true },
  });
  if (!last) return null;
  return {
    avgCostPerUnit: last.avgCostPerUnit != null ? Number(last.avgCostPerUnit) : null,
    materialCost: last.materialCost != null ? Number(last.materialCost) : null,
    lastReceiptAt: last.receivedAt,
  };
}
