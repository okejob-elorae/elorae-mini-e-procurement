'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ItemType } from '@prisma/client';
import { generateSKU } from '@/lib/sku-generator';
import { itemSchema } from '@/lib/validations';

export { generateSKU };
import { getConsumptionRules as getConsumptionRulesFromLib, saveConsumptionRules as saveConsumptionRulesFromLib } from '@/lib/production/consumption';

export type ItemFormData = z.infer<typeof itemSchema>;

export async function createItem(data: ItemFormData) {
  const validated = itemSchema.parse(data);
  const sku = await generateSKU(validated.type);
  
  const item = await prisma.$transaction(async (tx) => {
    // Create item
    const newItem = await tx.item.create({
      data: {
        ...validated,
        sku,
        variants: validated.variants || [],
        reorderPoint: validated.reorderPoint || null,
      }
    });
    
    // Initialize inventory value record
    await tx.inventoryValue.create({
      data: {
        itemId: newItem.id,
        qtyOnHand: 0,
        avgCost: 0,
        totalValue: 0
      }
    });
    
    return newItem;
  });
  
  revalidatePath('/backoffice/items');
  return item;
}

export async function updateItem(id: string, data: ItemFormData) {
  const validated = itemSchema.parse(data);
  
  const item = await prisma.item.update({
    where: { id },
    data: {
      ...validated,
      variants: validated.variants || [],
      reorderPoint: validated.reorderPoint || null,
    }
  });
  
  revalidatePath('/backoffice/items');
  revalidatePath(`/backoffice/items/${id}`);
  return item;
}

export async function deleteItem(id: string) {
  // Check if item has any stock movements or PO items
  const [movements, poItems] = await Promise.all([
    prisma.stockMovement.count({ where: { itemId: id } }),
    prisma.pOItem.count({ where: { itemId: id } })
  ]);
  
  if (movements > 0 || poItems > 0) {
    throw new Error('Cannot delete item with existing transactions');
  }
  
  await prisma.$transaction(async (tx) => {
    // Delete consumption rules
    await tx.consumptionRule.deleteMany({
      where: {
        OR: [
          { finishedGoodId: id },
          { materialId: id }
        ]
      }
    });
    
    // Delete inventory value
    await tx.inventoryValue.deleteMany({
      where: { itemId: id }
    });
    
    // Delete item
    await tx.item.delete({
      where: { id }
    });
  });
  
  revalidatePath('/backoffice/items');
}

export async function getItems(filters?: {
  type?: ItemType;
  search?: string;
  isActive?: boolean;
}) {
  const where: any = {};
  
  if (filters?.type) {
    where.type = filters.type;
  }
  
  if (filters?.isActive !== undefined) {
    where.isActive = filters.isActive;
  }
  
  if (filters?.search) {
    where.OR = [
      { sku: { contains: filters.search, mode: 'insensitive' } },
      { nameId: { contains: filters.search, mode: 'insensitive' } },
      { nameEn: { contains: filters.search, mode: 'insensitive' } }
    ];
  }
  
  return await prisma.item.findMany({
    where,
    include: {
      uom: {
        select: {
          code: true,
          nameId: true,
          nameEn: true
        }
      },
      inventoryValue: {
        select: {
          qtyOnHand: true,
          avgCost: true,
          totalValue: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
}

export async function getItemById(id: string) {
  return await prisma.item.findUnique({
    where: { id },
    include: {
      uom: true,
      inventoryValue: true,
      fgConsumptions: {
        include: {
          material: {
            include: {
              uom: true
            }
          }
        }
      },
      materialUsages: {
        include: {
          finishedGood: {
            include: {
              uom: true
            }
          }
        }
      }
    }
  });
}

// Get items by type for dropdowns
export async function getItemsByType(type: ItemType) {
  return await prisma.item.findMany({
    where: { type, isActive: true },
    select: {
      id: true,
      sku: true,
      nameId: true,
      nameEn: true,
      uom: {
        select: {
          id: true,
          code: true
        }
      },
      inventoryValue: {
        select: {
          qtyOnHand: true
        }
      }
    },
    orderBy: { nameId: 'asc' }
  });
}

// Get finished goods with their consumption rules
export async function getFinishedGoodsWithBOM() {
  return await prisma.item.findMany({
    where: { type: 'FINISHED_GOOD', isActive: true },
    include: {
      uom: {
        select: {
          code: true,
          nameId: true
        }
      },
      fgConsumptions: {
        where: { isActive: true },
        include: {
          material: {
            include: {
              uom: true,
              inventoryValue: {
                select: {
                  qtyOnHand: true
                }
              }
            }
          }
        }
      }
    },
    orderBy: { nameId: 'asc' }
  });
}

// Consumption Rules (BOM) - delegate to lib/production/consumption.ts
export async function getConsumptionRules(finishedGoodId: string) {
  return getConsumptionRulesFromLib(finishedGoodId);
}

export async function saveConsumptionRules(
  finishedGoodId: string,
  rules: Array<{
    materialId: string;
    qtyRequired: number;
    wastePercent: number;
    notes?: string;
  }>
) {
  const result = await saveConsumptionRulesFromLib(finishedGoodId, rules);
  revalidatePath(`/backoffice/items/${finishedGoodId}`);
  return result;
}
