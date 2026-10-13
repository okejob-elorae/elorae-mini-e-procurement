'use server';

import { prisma } from '@elorae/db';
import { serializeForClient } from '@/lib/serialize-for-client';
import { findOverlappingRules } from '@/lib/production/scoped-bom';

export type ConsumptionRuleInput = {
  materialId: string;
  qtyRequired: number;
  wastePercent: number;
  notes?: string;
  /** Variant scope (#437): null/empty = every colour / every size. */
  colorId?: string | null;
  size?: string | null;
};

// Save consumption rules (BOM) for a finished good
export async function saveConsumptionRules(
  finishedGoodId: string,
  input: ConsumptionRuleInput[]
) {
  const rules = input.map((r) => ({
    ...r,
    colorId: r.colorId?.trim() || null,
    size: r.size?.trim() || null,
  }));

  const overlaps = findOverlappingRules(rules);
  if (overlaps.length > 0) {
    const names = await prisma.item.findMany({
      where: { id: { in: overlaps.map(([i]) => rules[i].materialId) } },
      select: { nameId: true },
    });
    throw new Error(
      `Aturan BOM tumpang tindih: satu bahan punya dua aturan yang sama-sama berlaku untuk satu varian (${names.map((n) => n.nameId).join(', ')}). Bedakan warna/ukurannya atau gabungkan.`
    );
  }
  const colorIds = [...new Set(rules.map((r) => r.colorId).filter((id): id is string => id != null))];
  if (colorIds.length > 0) {
    const found = await prisma.variantColor.count({ where: { id: { in: colorIds } } });
    if (found !== colorIds.length) throw new Error('Warna pada aturan BOM tidak ada di master warna');
  }

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
          colorId: r.colorId,
          size: r.size,
          isActive: true
        }))
      });
    }

    return serializeForClient(
      await tx.consumptionRule.findMany({
        where: { finishedGoodId },
        include: {
          material: {
            select: {
              sku: true,
              nameId: true,
              nameEn: true,
            },
          },
          color: { select: { id: true, name: true } },
        },
      })
    );
  });
}

// Get consumption rules for a finished good
export async function getConsumptionRules(finishedGoodId: string) {
  const rules = await prisma.consumptionRule.findMany({
    where: { finishedGoodId, isActive: true },
    include: {
      material: {
        include: {
          uom: {
            select: {
              code: true,
              nameId: true,
            },
          },
          inventoryValues: {
            select: { qtyOnHand: true },
          },
        },
      },
      color: { select: { id: true, name: true } },
    },
  });
  return serializeForClient(rules);
}
