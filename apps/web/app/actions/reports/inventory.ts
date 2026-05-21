'use server';

import { prisma } from '@/lib/prisma';
import { ItemType } from '@prisma/client';
import * as XLSX from 'xlsx';

export type InventorySnapshotDetail = {
  itemId: string;
  sku: string;
  name: string;
  type: ItemType;
  uomCode: string;
  qtyOnHand: number;
  avgCost: number;
  totalValue: number;
  percentageOfTotal: number;
};

export type InventorySnapshotResult = {
  generatedAt: Date;
  asOfDate: Date;
  summary: {
    totalItems: number;
    totalSKUs: number;
    totalQuantity: number;
    totalValue: number;
    avgValuePerItem: number;
  };
  categories: Record<string, { totalValue: number; count: number }>;
  details: InventorySnapshotDetail[];
  lowStockAlerts: Array<{ itemId: string; sku: string; name: string; qtyOnHand: number; reorderPoint: number }>;
};

export async function getInventoryValueSnapshot(
  _asOfDate?: Date
): Promise<InventorySnapshotResult> {
  const asOfDate = _asOfDate ? new Date(_asOfDate) : new Date();
  asOfDate.setHours(0, 0, 0, 0);

  const rows = await prisma.inventoryValue.findMany({
    where: { qtyOnHand: { gt: 0 } },
    include: {
      item: {
        select: {
          id: true,
          sku: true,
          nameId: true,
          nameEn: true,
          type: true,
          reorderPoint: true,
          uom: { select: { code: true } },
        },
      },
    },
  });

  // Aggregate by itemId (one row per item)
  const byItem = new Map<
    string,
    { qtyOnHand: number; totalValue: number; item: (typeof rows)[0]['item'] }
  >();
  for (const r of rows) {
    const qty = Number(r.qtyOnHand);
    const val = Number(r.totalValue);
    const existing = byItem.get(r.itemId);
    if (existing) {
      existing.qtyOnHand += qty;
      existing.totalValue += val;
    } else {
      byItem.set(r.itemId, { qtyOnHand: qty, totalValue: val, item: r.item });
    }
  }
  const totalValue = Array.from(byItem.values()).reduce((s, a) => s + a.totalValue, 0);
  const totalQty = Array.from(byItem.values()).reduce((s, a) => s + a.qtyOnHand, 0);
  const details: InventorySnapshotDetail[] = Array.from(byItem.entries()).map(([itemId, agg]) => ({
    itemId,
    sku: agg.item.sku,
    name: agg.item.nameEn || agg.item.nameId,
    type: agg.item.type,
    uomCode: agg.item.uom?.code ?? '',
    qtyOnHand: agg.qtyOnHand,
    avgCost: agg.qtyOnHand > 0 ? agg.totalValue / agg.qtyOnHand : 0,
    totalValue: agg.totalValue,
    percentageOfTotal: totalValue > 0 ? (agg.totalValue / totalValue) * 100 : 0,
  }));

  const categories: Record<string, { totalValue: number; count: number }> = {};
  for (const d of details) {
    const key = d.type;
    if (!categories[key]) categories[key] = { totalValue: 0, count: 0 };
    categories[key].totalValue += d.totalValue;
    categories[key].count += 1;
  }

  const lowStockAlerts = details.filter((d) => {
    const item = byItem.get(d.itemId)?.item;
    const rp = item?.reorderPoint != null ? Number(item.reorderPoint) : null;
    return rp != null && d.qtyOnHand <= rp;
  }).map((d) => ({
    itemId: d.itemId,
    sku: d.sku,
    name: d.name,
    qtyOnHand: d.qtyOnHand,
    reorderPoint: Number(byItem.get(d.itemId)!.item.reorderPoint),
  }));

  const itemCount = byItem.size;
  return {
    generatedAt: new Date(),
    asOfDate,
    summary: {
      totalItems: itemCount,
      totalSKUs: itemCount,
      totalQuantity: totalQty,
      totalValue,
      avgValuePerItem: itemCount > 0 ? totalValue / itemCount : 0,
    },
    categories,
    details,
    lowStockAlerts,
  };
}

/** COGS / inventory value split: raw materials (FABRIC + ACCESSORIES) vs finished goods. */
export async function getCOGSRawVsFinished(): Promise<{
  rawValue: number;
  finishedValue: number;
  rawCount: number;
  finishedCount: number;
}> {
  const rows = await prisma.inventoryValue.findMany({
    where: { qtyOnHand: { gt: 0 } },
    include: {
      item: { select: { type: true } },
    },
  });
  const byItem = new Map<string, { totalValue: number; type: string }>();
  for (const r of rows) {
    const val = Number(r.totalValue);
    const existing = byItem.get(r.itemId);
    if (existing) {
      existing.totalValue += val;
    } else {
      byItem.set(r.itemId, { totalValue: val, type: r.item.type });
    }
  }
  let rawValue = 0;
  let finishedValue = 0;
  let rawCount = 0;
  let finishedCount = 0;
  for (const a of byItem.values()) {
    if (a.type === 'FINISHED_GOOD') {
      finishedValue += a.totalValue;
      finishedCount += 1;
    } else {
      rawValue += a.totalValue;
      rawCount += 1;
    }
  }
  return { rawValue, finishedValue, rawCount, finishedCount };
}

export async function exportInventorySnapshotReport(
  format: 'csv' | 'excel'
): Promise<{ data: string; filename: string } | { base64: string; filename: string }> {
  const snap = await getInventoryValueSnapshot();
  const data = snap.details.map((d) => ({
    SKU: d.sku,
    Name: d.name,
    Type: d.type,
    UOM: d.uomCode,
    'Qty On Hand': d.qtyOnHand,
    'Avg Cost': d.avgCost,
    'Total Value': d.totalValue,
    '% of Total': Math.round(d.percentageOfTotal * 100) / 100,
  }));

  if (format === 'csv') {
    const headers = data.length ? Object.keys(data[0]).join(',') : 'SKU,Name,Type,UOM,Qty On Hand,Avg Cost,Total Value,% of Total';
    const lines = data.map((r) => Object.values(r).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    return { data: [headers, ...lines].join('\n'), filename: `inventory-snapshot-${Date.now()}.csv` };
  }
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'Inventory Snapshot');
  const buffer = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  return { base64: buffer.toString('base64'), filename: `inventory-snapshot-${Date.now()}.xlsx` };
}
