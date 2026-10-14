'use server';

import { Decimal } from 'decimal.js';
import { prisma } from '@elorae/db';
import { loadColorIndex } from '@/lib/items/variant-colors';
import { parseItemVariants } from '@/lib/items/variants';
import {
  buildVariantMix,
  equalVariantMix,
  isScopedRule,
  MaterialPlanBlockedError,
  planMaterialQuantities,
  unresolvedMixVariants,
} from '@/lib/production/scoped-bom';

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

export type MaterialPlanOptions = {
  /** The WO's SKU breakdown; scoped rules apply to the pieces of the variants they cover. */
  skuBreakdown?: { variantSku: string } | Array<{ variantSku: string; ratioPercent: number }> | null;
  /** With no breakdown, split the output evenly over the item's variants (an estimate). */
  fallbackToEqualSplit?: boolean;
};

/**
 * Generate material plan for a work order from BOM (consumption rules).
 * Used for WO creation and display (planned qty, available stock, shortage).
 * One line per material: a colour/size-scoped rule counts only the pieces of the variants it
 * covers (#437), so `qtyRequired` is the material's average per piece of THIS output and
 * `wastePercent` the waste that average carries; for an unscoped rule both equal the rule's.
 */
export async function generateMaterialPlan(
  finishedGoodId: string,
  plannedOutput: Decimal,
  opts: MaterialPlanOptions = {}
): Promise<MaterialPlanItem[]> {
  const rules = await prisma.consumptionRule.findMany({
    where: { finishedGoodId, isActive: true },
    include: {
      material: {
        include: {
          uom: true,
          inventoryValues: { select: { qtyOnHand: true } },
        },
      },
    },
  });

  let mix = null;
  if (rules.some(isScopedRule)) {
    const [fg, index] = await Promise.all([
      prisma.item.findUnique({ where: { id: finishedGoodId }, select: { variants: true } }),
      loadColorIndex(),
    ]);
    const variants = parseItemVariants(fg?.variants);
    mix = opts.skuBreakdown
      ? buildVariantMix(plannedOutput, opts.skuBreakdown, variants, index)
      : opts.fallbackToEqualSplit
        ? equalVariantMix(plannedOutput, variants, index)
        : null;
    const unresolved = mix && !opts.fallbackToEqualSplit ? unresolvedMixVariants(rules, mix) : [];
    if (unresolved.length > 0) {
      throw new MaterialPlanBlockedError(
        `Varian tanpa warna/ukuran yang dikenali (cek master warna), BOM per warna/ukuran tidak bisa dihitung: ${unresolved.join(', ')}`
      );
    }
  }

  const quantities = planMaterialQuantities(rules, plannedOutput, mix);
  const materials = new Map(rules.map((r) => [r.materialId, r.material]));
  const firstRule = new Map<string, (typeof rules)[number]>();
  for (const r of rules) if (!firstRule.has(r.materialId)) firstRule.set(r.materialId, r);

  return [...quantities].map(([materialId, q]) => {
    const material = materials.get(materialId)!;
    const rule = firstRule.get(materialId)!;
    // At zero output there is no average to take; show the material's (first) rule as before.
    const qtyRequired = plannedOutput.isZero()
      ? new Decimal(rule.qtyRequired.toString())
      : q.baseQty.div(plannedOutput);
    const wastePercent = q.baseQty.isZero()
      ? new Decimal(rule.wastePercent.toString())
      : q.plannedQty.div(q.baseQty).minus(1).mul(100);
    const availableStock = new Decimal(
      (material.inventoryValues ?? []).reduce((sum, r) => sum + Number(r.qtyOnHand), 0)
    );
    const shortage = q.plannedQty.gt(availableStock)
      ? q.plannedQty.minus(availableStock)
      : new Decimal(0);

    return {
      itemId: materialId,
      itemName: material.nameId,
      uomId: material.uomId,
      uomCode: material.uom.code,
      qtyRequired,
      wastePercent,
      plannedQty: q.plannedQty,
      availableStock,
      shortage
    };
  });
}
