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

  const totalValue = rows.reduce((s, r) => s + Number(r.totalValue), 0);
  const totalQty = rows.reduce((s, r) => s + Number(r.qtyOnHand), 0);
  const details: InventorySnapshotDetail[] = rows.map((r) => ({
    itemId: r.item.id,
    sku: r.item.sku,
    name: r.item.nameEn || r.item.nameId,
    type: r.item.type,
    uomCode: r.item.uom?.code ?? '',
    qtyOnHand: Number(r.qtyOnHand),
    avgCost: Number(r.avgCost),
    totalValue: Number(r.totalValue),
    percentageOfTotal: totalValue > 0 ? (Number(r.totalValue) / totalValue) * 100 : 0,
  }));

  const categories: Record<string, { totalValue: number; count: number }> = {};
  for (const d of details) {
    const key = d.type;
    if (!categories[key]) categories[key] = { totalValue: 0, count: 0 };
    categories[key].totalValue += d.totalValue;
    categories[key].count += 1;
  }

  const lowStockAlerts = rows
    .filter((r) => {
      const rp = r.item.reorderPoint != null ? Number(r.item.reorderPoint) : null;
      return rp != null && Number(r.qtyOnHand) <= rp;
    })
    .map((r) => ({
      itemId: r.item.id,
      sku: r.item.sku,
      name: r.item.nameEn || r.item.nameId,
      qtyOnHand: Number(r.qtyOnHand),
      reorderPoint: Number(r.item.reorderPoint),
    }));

  return {
    generatedAt: new Date(),
    asOfDate,
    summary: {
      totalItems: rows.length,
      totalSKUs: rows.length,
      totalQuantity: totalQty,
      totalValue,
      avgValuePerItem: rows.length > 0 ? totalValue / rows.length : 0,
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
  let rawValue = 0;
  let finishedValue = 0;
  let rawCount = 0;
  let finishedCount = 0;
  for (const r of rows) {
    const val = Number(r.totalValue);
    if (r.item.type === 'FINISHED_GOOD') {
      finishedValue += val;
      finishedCount += 1;
    } else {
      rawValue += val;
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
