'use server';

import { Decimal } from 'decimal.js';
import { prisma } from '../prisma';

export interface CostCalculationResult {
  previousQty: Decimal;
  previousAvgCost: Decimal;
  previousTotalValue: Decimal;
  incomingQty: Decimal;
  incomingUnitCost: Decimal;
  incomingTotalValue: Decimal;
  newQty: Decimal;
  newAvgCost: Decimal;
  newTotalValue: Decimal;
}

// Prisma compound unique keys don't accept null; use '' for non-variant items.
const normalizeVariantSku = (variantSku?: string | null) => variantSku ?? '';

const compositeKey = (itemId: string, variantSku?: string | null) => ({
  itemId_variantSku: { itemId, variantSku: normalizeVariantSku(variantSku) },
});

export async function calculateMovingAverage(
  itemId: string,
  incomingQty: Decimal,
  incomingCost: Decimal,
  tx?: any,
  variantSku?: string | null
): Promise<CostCalculationResult> {
  const prismaClient = tx || prisma;
  const where = compositeKey(itemId, variantSku);

  // Get current inventory state
  const current = await prismaClient.inventoryValue.findUnique({
    where,
  });

  const previousQty = current?.qtyOnHand ? new Decimal(current.qtyOnHand.toString()) : new Decimal(0);
  const previousAvgCost = current?.avgCost ? new Decimal(current.avgCost.toString()) : new Decimal(0);
  const previousTotalValue = previousQty.mul(previousAvgCost);

  // Calculate new totals
  const newTotalQty = previousQty.plus(incomingQty);
  const incomingTotalValue = incomingQty.mul(incomingCost);
  const newTotalValue = previousTotalValue.plus(incomingTotalValue);

  // Calculate new average cost
  // Formula: (PreviousTotalValue + IncomingTotalValue) / (PreviousQty + IncomingQty)
  let newAvgCost: Decimal;
  if (newTotalQty.gt(0)) {
    newAvgCost = newTotalValue.div(newTotalQty);
  } else {
    newAvgCost = new Decimal(0);
  }

  // Update or create inventory record
  await prismaClient.inventoryValue.upsert({
    where,
    create: {
      itemId,
      variantSku: normalizeVariantSku(variantSku),
      qtyOnHand: newTotalQty.toNumber(),
      avgCost: newAvgCost.toNumber(),
      totalValue: newTotalValue.toNumber(),
      lastUpdated: new Date(),
    },
    update: {
      qtyOnHand: newTotalQty.toNumber(),
      avgCost: newAvgCost.toNumber(),
      totalValue: newTotalValue.toNumber(),
      lastUpdated: new Date(),
    },
  });

  return {
    previousQty,
    previousAvgCost,
    previousTotalValue,
    incomingQty,
    incomingUnitCost: incomingCost,
    incomingTotalValue,
    newQty: newTotalQty,
    newAvgCost,
    newTotalValue,
  };
}

/**
 * Reverse inventory value for returns/negative adjustments.
 * Outgoing value is at current avg cost; throws if insufficient stock.
 */
export async function reverseInventoryValue(
  itemId: string,
  outgoingQty: Decimal,
  outgoingUnitCost: Decimal,
  tx?: any,
  variantSku?: string | null
): Promise<{ newQty: Decimal; newAvgCost: Decimal; newTotalValue: Decimal }> {
  const prismaClient = tx || prisma;
  const where = compositeKey(itemId, variantSku);

  const current = await prismaClient.inventoryValue.findUnique({
    where,
  });

  if (!current) throw new Error('No inventory record found');

  const currentQty = new Decimal(current.qtyOnHand.toString());
  const currentAvgCost = new Decimal(current.avgCost.toString());

  if (currentQty.lt(outgoingQty)) {
    throw new Error('Insufficient stock');
  }

  const newQty = currentQty.minus(outgoingQty);
  const outgoingValue = outgoingQty.mul(currentAvgCost);
  const newTotalValue = new Decimal(current.totalValue.toString()).minus(outgoingValue);

  const newAvgCost = newQty.gt(0)
    ? newTotalValue.div(newQty)
    : new Decimal(0);

  await prismaClient.inventoryValue.update({
    where,
    data: {
      qtyOnHand: newQty.toNumber(),
      avgCost: newAvgCost.toNumber(),
      totalValue: newTotalValue.toNumber(),
      lastUpdated: new Date(),
    },
  });

  return { newQty, newAvgCost, newTotalValue };
}

// Reverse calculation for returns (negative quantity) - uses passed cost
export async function reverseMovingAverage(
  itemId: string,
  outgoingQty: Decimal,
  outgoingCost: Decimal,
  tx?: any,
  variantSku?: string | null
): Promise<CostCalculationResult> {
  const prismaClient = tx || prisma;
  const where = compositeKey(itemId, variantSku);

  // Get current inventory state
  const current = await prismaClient.inventoryValue.findUnique({
    where,
  });

  const previousQty = current?.qtyOnHand ? new Decimal(current.qtyOnHand.toString()) : new Decimal(0);
  const previousAvgCost = current?.avgCost ? new Decimal(current.avgCost.toString()) : new Decimal(0);
  const previousTotalValue = previousQty.mul(previousAvgCost);

  // Calculate new totals (subtracting)
  const newTotalQty = previousQty.minus(outgoingQty);
  const outgoingTotalValue = outgoingQty.mul(outgoingCost);
  const newTotalValue = previousTotalValue.minus(outgoingTotalValue);

  // Average cost remains the same for outgoing (FIFO-like behavior)
  const newAvgCost = previousAvgCost;

  // Update inventory record
  await prismaClient.inventoryValue.update({
    where,
    data: {
      qtyOnHand: newTotalQty.toNumber(),
      avgCost: newAvgCost.toNumber(),
      totalValue: newTotalValue.toNumber(),
      lastUpdated: new Date(),
    },
  });

  return {
    previousQty,
    previousAvgCost,
    previousTotalValue,
    incomingQty: outgoingQty,
    incomingUnitCost: outgoingCost,
    incomingTotalValue: outgoingTotalValue,
    newQty: newTotalQty,
    newAvgCost,
    newTotalValue,
  };
}

// Get current inventory value for an item (or item+variant). Serialized for client.
export async function getInventoryValue(itemId: string, variantSku?: string | null) {
  const v = await prisma.inventoryValue.findUnique({
    where: compositeKey(itemId, variantSku),
    include: {
      item: {
        select: {
          sku: true,
          nameId: true,
          nameEn: true,
          uom: {
            select: {
              code: true,
              nameId: true,
            },
          },
        },
      },
    },
  });
  if (!v) return null;
  return {
    ...v,
    qtyOnHand: Number(v.qtyOnHand),
    avgCost: Number(v.avgCost),
    totalValue: Number(v.totalValue),
  };
}

// Get stock card (movement history) for an item
export async function getStockCard(itemId: string, limit: number = 100) {
  const movements = await prisma.stockMovement.findMany({
    where: { itemId },
    orderBy: { createdAt: 'desc' },
    take: limit
  });
  
  return movements;
}

const inventorySnapshotInclude = {
  item: {
    select: {
      sku: true,
      nameId: true,
      nameEn: true,
      type: true,
      reorderPoint: true,
      uom: {
        select: {
          code: true,
          nameId: true
        }
      }
    }
  }
};

const inventorySnapshotOrderBy = {
  item: {
    sku: 'asc' as const
  }
};

// Aggregate InventoryValue rows by itemId (one row per item; sum qty/value, weighted avg cost)
function aggregateSnapshotByItemId(
  values: Awaited<ReturnType<typeof prisma.inventoryValue.findMany>> & { item: NonNullable<Awaited<ReturnType<typeof prisma.inventoryValue.findMany>>[0]['item']> }[],
  toNum: (v: unknown) => number | null
) {
  const byItem = new Map<string, { qtyOnHand: number; totalValue: number; item: typeof values[0]['item'] }>();
  for (const v of values) {
    const qty = toNum(v.qtyOnHand) ?? 0;
    const val = toNum(v.totalValue) ?? 0;
    const existing = byItem.get(v.itemId);
    if (existing) {
      existing.qtyOnHand += qty;
      existing.totalValue += val;
    } else {
      byItem.set(v.itemId, { qtyOnHand: qty, totalValue: val, item: v.item });
    }
  }
  const rows = Array.from(byItem.entries()).map(([itemId, agg]) => ({
    itemId,
    qtyOnHand: agg.qtyOnHand,
    totalValue: agg.totalValue,
    avgCost: agg.qtyOnHand > 0 ? agg.totalValue / agg.qtyOnHand : 0,
    item: {
      ...agg.item,
      reorderPoint: agg.item.reorderPoint != null ? toNum(agg.item.reorderPoint) : null,
    },
  }));
  rows.sort((a, b) => (a.item.sku ?? '').localeCompare(b.item.sku ?? ''));
  return rows;
}

// Get inventory snapshot (one row per item, aggregated from variant-level rows)
export async function getInventorySnapshot(opts?: { page: number; pageSize: number }) {
  const toNum = (v: unknown) => (v == null ? null : Number(v));

  const values = await prisma.inventoryValue.findMany({
    include: inventorySnapshotInclude,
    orderBy: inventorySnapshotOrderBy,
  });

  const allItems = aggregateSnapshotByItemId(
    values as (typeof values & { item: NonNullable<(typeof values)[0]['item']> })[],
    toNum
  );
  const totalValue = allItems.reduce((sum, v) => sum + v.totalValue, 0);
  const lowStockItems = allItems.filter(
    (v) => v.item.reorderPoint != null && v.qtyOnHand <= Number(v.item.reorderPoint)
  ).length;

  if (opts?.page != null && opts?.pageSize != null && opts.pageSize > 0) {
    const start = (opts.page - 1) * opts.pageSize;
    const items = allItems.slice(start, start + opts.pageSize);
    return {
      items,
      totalCount: allItems.length,
      totalValue,
      totalItems: allItems.length,
      lowStockItems,
    };
  }

  return {
    items: allItems,
    totalValue,
    totalItems: allItems.length,
    lowStockItems,
  };
}
