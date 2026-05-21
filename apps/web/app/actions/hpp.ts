'use server';

import { prisma } from '@/lib/prisma';
import { ItemType } from '@prisma/client';
import { getPpnRatePercent } from '@/app/actions/settings/ppn';

export type HPPCostLine = {
  category: 'FABRIC' | 'ACCESSORIES' | 'SERVICE';
  itemId?: string;
  itemName: string;
  unitCost: number;
  qtyPerPcs: number;
  costPerPcs: number;
  ppnIncluded: boolean;
  nettCostPerPcs?: number;
};

export type HPPBreakdown = {
  woId: string;
  woDocNumber: string;
  finishedGoodId: string;
  finishedGoodName: string;
  finishedGoodSku: string;
  plannedQty: number;
  actualQty: number;
  lines: HPPCostLine[];
  fabricCostPerPcs: number;
  accessoriesCostPerPcs: number;
  serviceCostPerPcs: number;
  subtotal: number;
  hasMixedPPN: boolean;
  nettSubtotal?: number;
  marginPercent: number | null;
  marginAmount: number | null;
  additionalCost: number | null;
  sellingPrice: number | null;
};

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

type MaterialIssueItem = {
  itemId: string;
  qty: number;
  uomId: string;
  avgCostAtIssue: number;
  ppnIncluded?: boolean;
  totalCost?: number;
};

/** Calculate HPP for a single work order: 3 cost layers (fabric, accessories, service) + PPN tracking. */
export async function calculateHPP(woId: string): Promise<HPPBreakdown> {
  const ppnRate = await getPpnRatePercent();

  const wo = await prisma.workOrder.findUnique({
    where: { id: woId },
    select: {
      id: true,
      docNumber: true,
      finishedGoodId: true,
      plannedQty: true,
      actualQty: true,
      hppMarginPercent: true,
      hppAdditionalCost: true,
      finishedGood: { select: { id: true, sku: true, nameId: true } },
      issues: { select: { issueType: true, items: true } },
      steps: { orderBy: { sequence: 'asc' }, select: { stepName: true, supplierId: true, servicePrice: true, servicePpnIncluded: true } },
    },
  });

  if (!wo) throw new Error('Work order not found');

  const plannedQty = Number(wo.plannedQty) || 0;
  const actualQty = Number(wo.actualQty ?? 0) || 0;
  const marginPercent = wo.hppMarginPercent != null ? Number(wo.hppMarginPercent) : null;
  const additionalCost = wo.hppAdditionalCost != null ? Number(wo.hppAdditionalCost) : null;

  const rules = await prisma.consumptionRule.findMany({
    where: { finishedGoodId: wo.finishedGoodId, isActive: true },
    select: { materialId: true, qtyRequired: true },
  });
  const qtyRequiredByMaterial: Record<string, number> = {};
  for (const r of rules) {
    qtyRequiredByMaterial[r.materialId] = Number(r.qtyRequired) || 0;
  }

  const itemIds = new Set<string>();
  for (const issue of wo.issues) {
    const raw = issue.items;
    const arr = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : Array.isArray(raw) ? raw : [];
    for (const line of arr as MaterialIssueItem[]) {
      if (line?.itemId) itemIds.add(line.itemId);
    }
  }
  const items = await prisma.item.findMany({
    where: { id: { in: Array.from(itemIds) } },
    select: { id: true, nameId: true },
  });
  const itemNameById: Record<string, string> = {};
  for (const i of items) itemNameById[i.id] = i.nameId;

  const lines: HPPCostLine[] = [];
  let fabricCostPerPcs = 0;
  let accessoriesCostPerPcs = 0;

  for (const issue of wo.issues) {
    const raw = issue.items;
    const arr = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : Array.isArray(raw) ? raw : [];
    const category = issue.issueType === 'FABRIC' ? 'FABRIC' : 'ACCESSORIES';

    for (const line of arr as MaterialIssueItem[]) {
      if (!line?.itemId || line.qty == null) continue;
      const avgCost = Number(line.avgCostAtIssue) || 0;
      const ppnIncluded = line.ppnIncluded !== false;
      const qtyRequired = qtyRequiredByMaterial[line.itemId] ?? 0;
      const costPerPcs = avgCost * qtyRequired;
      const nettCostPerPcs = ppnIncluded ? costPerPcs : costPerPcs * (1 + ppnRate / 100);

      lines.push({
        category,
        itemId: line.itemId,
        itemName: itemNameById[line.itemId] ?? line.itemId,
        unitCost: avgCost,
        qtyPerPcs: qtyRequired,
        costPerPcs,
        ppnIncluded,
        nettCostPerPcs,
      });

      if (category === 'FABRIC') fabricCostPerPcs += costPerPcs;
      else accessoriesCostPerPcs += costPerPcs;
    }
  }

  let serviceCostPerPcs = 0;
  const suppliers = await prisma.supplier.findMany({
    where: { id: { in: wo.steps.map((s) => s.supplierId) } },
    select: { id: true, name: true },
  });
  const supplierNameById: Record<string, string> = {};
  for (const s of suppliers) supplierNameById[s.id] = s.name;

  for (const step of wo.steps) {
    const price = Number(step.servicePrice) || 0;
    const ppnIncluded = step.servicePpnIncluded ?? false;
    const nettCostPerPcs = ppnIncluded ? price : price * (1 + ppnRate / 100);
    const stepName = step.stepName?.trim() || supplierNameById[step.supplierId] || step.supplierId;

    lines.push({
      category: 'SERVICE',
      itemName: stepName,
      unitCost: price,
      qtyPerPcs: 1,
      costPerPcs: price,
      ppnIncluded,
      nettCostPerPcs,
    });
    serviceCostPerPcs += price;
  }

  const subtotal = fabricCostPerPcs + accessoriesCostPerPcs + serviceCostPerPcs;
  const ppnFlags = lines.map((l) => l.ppnIncluded);
  const hasMixedPPN = ppnFlags.length > 0 && (new Set(ppnFlags).size > 1);
  const nettSubtotal = lines.reduce((sum, l) => sum + (l.nettCostPerPcs ?? l.costPerPcs), 0);
  const marginAmount = marginPercent != null ? (subtotal * marginPercent) / 100 : null;
  const sellingPrice =
    marginPercent != null
      ? subtotal * (1 + marginPercent / 100) + (additionalCost ?? 0)
      : additionalCost != null
        ? subtotal + additionalCost
        : null;

  return {
    woId: wo.id,
    woDocNumber: wo.docNumber,
    finishedGoodId: wo.finishedGoodId,
    finishedGoodName: wo.finishedGood?.nameId ?? '',
    finishedGoodSku: wo.finishedGood?.sku ?? '',
    plannedQty,
    actualQty,
    lines,
    fabricCostPerPcs,
    accessoriesCostPerPcs,
    serviceCostPerPcs,
    subtotal,
    hasMixedPPN,
    nettSubtotal,
    marginPercent,
    marginAmount,
    additionalCost,
    sellingPrice,
  };
}

export type HPPListFilters = {
  finishedGoodId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  vendorId?: string;
};

/** List WO-centric HPP breakdowns with optional filters. */
export async function getHPPList(filters?: HPPListFilters): Promise<HPPBreakdown[]> {
  const where: Record<string, unknown> = {};
  if (filters?.finishedGoodId) where.finishedGoodId = filters.finishedGoodId;
  if (filters?.vendorId) where.vendorId = filters.vendorId;
  if (filters?.dateFrom || filters?.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) (where.createdAt as Record<string, Date>).gte = filters.dateFrom;
    if (filters.dateTo) (where.createdAt as Record<string, Date>).lte = filters.dateTo;
  }

  const wos = await prisma.workOrder.findMany({
    where,
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });

  const results: HPPBreakdown[] = [];
  for (const wo of wos) {
    try {
      results.push(await calculateHPP(wo.id));
    } catch {
      // skip WOs that fail (e.g. no data)
    }
  }
  return results;
}

/** Legacy: list finished goods with HPP-related data from FG receipts (kept for backward compatibility). */
export async function getHPPListLegacy(): Promise<HPPRow[]> {
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
