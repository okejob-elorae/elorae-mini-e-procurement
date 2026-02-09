'use server';

import { Decimal } from 'decimal.js';
import { prisma } from '../prisma';

interface CostCalculationResult {
  newAvgCost: Decimal;
  newTotalValue: Decimal;
  previousAvgCost: Decimal;
  previousQty: Decimal;
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
    newAvgCost,
    newTotalValue,
    previousAvgCost,
    previousQty
  };
}

// Reverse calculation for returns (negative quantity)
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
    newAvgCost,
    newTotalValue,
    previousAvgCost,
    previousQty
  };
}

// Get current inventory value for an item
export async function getInventoryValue(itemId: string) {
  return await prisma.inventoryValue.findUnique({
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
  
  const totalValue = values.reduce((sum, v) => sum + Number(v.totalValue), 0);
  
  return {
    items: values,
    totalValue,
    totalItems: values.length,
    lowStockItems: values.filter(v => 
      v.item.reorderPoint && v.qtyOnHand <= v.item.reorderPoint
    ).length
  };
}
