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

export async function calculateMovingAverage(
  itemId: string,
  incomingQty: Decimal,
  incomingCost: Decimal,
  tx?: any
): Promise<CostCalculationResult> {
  const prismaClient = tx || prisma;
  
  // Get current inventory state
  const current = await prismaClient.inventoryValue.findUnique({
    where: { itemId }
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
    where: { itemId },
    create: {
      itemId,
      qtyOnHand: newTotalQty.toNumber(),
      avgCost: newAvgCost.toNumber(),
      totalValue: newTotalValue.toNumber(),
      lastUpdated: new Date()
    },
    update: {
      qtyOnHand: newTotalQty.toNumber(),
      avgCost: newAvgCost.toNumber(),
      totalValue: newTotalValue.toNumber(),
      lastUpdated: new Date()
    }
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
    newTotalValue
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
  tx?: any
): Promise<{ newQty: Decimal; newAvgCost: Decimal; newTotalValue: Decimal }> {
  const prismaClient = tx || prisma;

  const current = await prismaClient.inventoryValue.findUnique({
    where: { itemId }
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
    where: { itemId },
    data: {
      qtyOnHand: newQty.toNumber(),
      avgCost: newAvgCost.toNumber(),
      totalValue: newTotalValue.toNumber(),
      lastUpdated: new Date()
    }
  });

  return { newQty, newAvgCost, newTotalValue };
}

// Reverse calculation for returns (negative quantity) - uses passed cost
export async function reverseMovingAverage(
  itemId: string,
  outgoingQty: Decimal,
  outgoingCost: Decimal,
  tx?: any
): Promise<CostCalculationResult> {
  const prismaClient = tx || prisma;
  
  // Get current inventory state
  const current = await prismaClient.inventoryValue.findUnique({
    where: { itemId }
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
    where: { itemId },
    data: {
      qtyOnHand: newTotalQty.toNumber(),
      avgCost: newAvgCost.toNumber(),
      totalValue: newTotalValue.toNumber(),
      lastUpdated: new Date()
    }
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
    newTotalValue
  };
}

// Get current inventory value for an item (serialized for client)
export async function getInventoryValue(itemId: string) {
  const v = await prisma.inventoryValue.findUnique({
    where: { itemId },
    include: {
      item: {
        select: {
          sku: true,
          nameId: true,
          nameEn: true,
          uom: {
            select: {
              code: true,
              nameId: true
            }
          }
        }
      }
    }
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

// Get inventory snapshot (all items with their values)
export async function getInventorySnapshot() {
  const values = await prisma.inventoryValue.findMany({
    include: {
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
    },
    orderBy: {
      item: {
        sku: 'asc'
      }
    }
  });

  const toNum = (v: unknown) => (v == null ? null : Number(v));
  const items = values.map((v) => ({
    ...v,
    qtyOnHand: toNum(v.qtyOnHand),
    avgCost: toNum(v.avgCost),
    totalValue: toNum(v.totalValue),
    item: {
      ...v.item,
      reorderPoint: v.item.reorderPoint != null ? toNum(v.item.reorderPoint) : null,
    },
  }));

  const totalValue = items.reduce((sum, v) => sum + (v.totalValue as number), 0);

  return {
    items,
    totalValue,
    totalItems: items.length,
    lowStockItems: items.filter(
      (v) =>
        v.item.reorderPoint != null &&
        (v.qtyOnHand as number) <= Number(v.item.reorderPoint)
    ).length,
  };
}
