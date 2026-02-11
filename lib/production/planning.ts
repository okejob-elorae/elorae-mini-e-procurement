'use server';

import { Decimal } from 'decimal.js';
import { prisma } from '../prisma';

export interface MaterialPlanItem {
  itemId: string;
  itemName: string;
  uomId: string;
  uomCode: string;
  qtyRequired: Decimal;
  wastePercent: Decimal;
  plannedQty: Decimal;
  availableStock: Decimal;
  shortage: Decimal;
}

/**
 * Generate material plan for a work order from BOM (consumption rules).
 * Used for WO creation and display (planned qty, available stock, shortage).
 */
export async function generateMaterialPlan(
  finishedGoodId: string,
  plannedOutput: Decimal
): Promise<MaterialPlanItem[]> {
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

  return rules.map((rule) => {
    const baseQty = plannedOutput.mul(rule.qtyRequired.toString());
    const wasteFactor = new Decimal(1).plus(
      new Decimal(rule.wastePercent.toString()).div(100)
    );
    const plannedQty = baseQty.mul(wasteFactor);
    const availableStock = new Decimal(
      rule.material.inventoryValue?.qtyOnHand?.toString() || 0
    );
    const shortage = plannedQty.gt(availableStock)
      ? plannedQty.minus(availableStock)
      : new Decimal(0);

    return {
      itemId: rule.materialId,
      itemName: rule.material.nameId,
      uomId: rule.material.uomId,
      uomCode: rule.material.uom.code,
      qtyRequired: new Decimal(rule.qtyRequired.toString()),
      wastePercent: new Decimal(rule.wastePercent.toString()),
      plannedQty,
      availableStock,
      shortage
    };
  });
}
