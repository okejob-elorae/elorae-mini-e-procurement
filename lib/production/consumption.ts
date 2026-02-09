'use server';

import { Decimal } from 'decimal.js';
import { prisma } from '../prisma';

export interface MaterialRequirement {
  itemId: string;
  itemName: string;
  itemSku: string;
  qtyRequired: Decimal;
  uomId: string;
  uomCode: string;
  wastePercent: Decimal;
  totalNeeded: Decimal;
  availableStock: Decimal;
  shortage: Decimal;
}

export async function calculateMaterialNeeds(
  finishedGoodId: string,
  plannedOutput: Decimal
): Promise<MaterialRequirement[]> {
  const rules = await prisma.consumptionRule.findMany({
    where: { finishedGoodId, isActive: true },
    include: { 
      material: { 
        include: { 
          uom: true,
          inventoryValue: true
        } 
      } 
    }
  });
  
  return rules.map(rule => {
    const baseQty = plannedOutput.mul(rule.qtyRequired.toString());
    const wasteMultiplier = new Decimal(1).plus(new Decimal(rule.wastePercent.toString()).div(100));
    const totalNeeded = baseQty.mul(wasteMultiplier);
    const availableStock = new Decimal(rule.material.inventoryValue?.qtyOnHand?.toString() || 0);
    
    return {
      itemId: rule.materialId,
      itemName: rule.material.nameId,
      itemSku: rule.material.sku,
      qtyRequired: rule.qtyRequired,
      uomId: rule.material.uomId,
      uomCode: rule.material.uom.code,
      wastePercent: rule.wastePercent,
      totalNeeded,
      availableStock,
      shortage: totalNeeded.gt(availableStock) ? totalNeeded.minus(availableStock) : new Decimal(0)
    };
  });
}

// Save consumption rules (BOM) for a finished good
export async function saveConsumptionRules(
  finishedGoodId: string,
  rules: Array<{
    materialId: string;
    qtyRequired: number;
    wastePercent: number;
    notes?: string;
  }>
) {
  return await prisma.$transaction(async (tx) => {
    // Delete existing rules
    await tx.consumptionRule.deleteMany({
      where: { finishedGoodId }
    });
    
    // Create new rules
    if (rules.length > 0) {
      await tx.consumptionRule.createMany({
        data: rules.map(r => ({
          finishedGoodId,
          materialId: r.materialId,
          qtyRequired: r.qtyRequired,
          wastePercent: r.wastePercent,
          notes: r.notes || null,
          isActive: true
        }))
      });
    }
    
    return await tx.consumptionRule.findMany({
      where: { finishedGoodId },
      include: {
        material: {
          select: {
            sku: true,
            nameId: true,
            nameEn: true
          }
        }
      }
    });
  });
}

// Get consumption rules for a finished good
export async function getConsumptionRules(finishedGoodId: string) {
  return await prisma.consumptionRule.findMany({
    where: { finishedGoodId, isActive: true },
    include: {
      material: {
        include: {
          uom: {
            select: {
              code: true,
              nameId: true
            }
          },
          inventoryValue: {
            select: {
              qtyOnHand: true
            }
          }
        }
      }
    }
  });
}

// Check if all materials are available for a work order
export async function checkMaterialAvailability(
  finishedGoodId: string,
  plannedQty: Decimal
): Promise<{
  available: boolean;
  requirements: MaterialRequirement[];
  shortages: MaterialRequirement[];
}> {
  const requirements = await calculateMaterialNeeds(finishedGoodId, plannedQty);
  const shortages = requirements.filter(r => r.shortage.gt(0));
  
  return {
    available: shortages.length === 0,
    requirements,
    shortages
  };
}
