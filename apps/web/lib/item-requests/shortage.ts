import { Decimal } from "decimal.js";
import { generateMaterialPlan, type MaterialPlanOptions } from "@/lib/production/planning";

export type WoShortage = { itemId: string; itemName: string; uomId: string; uomCode: string; shortage: number };

type WoForShortage = {
  finishedGoodId: string;
  plannedQty: Decimal.Value | { toString(): string };
  outputMode: string;
  skuBreakdown: unknown;
};

/**
 * Materials the WO's BOM needs beyond what is on hand right now. Same plan `createWorkOrder`
 * builds, so the DRAFT lock, the Issue guard and the request lines all agree on one number.
 */
export async function getWoShortages(wo: WoForShortage): Promise<WoShortage[]> {
  const raw = typeof wo.skuBreakdown === "string" ? JSON.parse(wo.skuBreakdown) : wo.skuBreakdown;
  const plan = await generateMaterialPlan(wo.finishedGoodId, new Decimal(wo.plannedQty.toString()), {
    skuBreakdown: wo.outputMode === "SKU" ? ((raw ?? null) as MaterialPlanOptions["skuBreakdown"]) : null,
  });
  return plan
    .filter((m) => m.shortage.gt(0))
    .map((m) => ({
      itemId: m.itemId,
      itemName: m.itemName,
      uomId: m.uomId,
      uomCode: m.uomCode,
      // Round up so a request never asks for less than the gap.
      shortage: m.shortage.toDecimalPlaces(2, Decimal.ROUND_UP).toNumber(),
    }));
}

export function formatShortages(shortages: WoShortage[]): string {
  return shortages.map((s) => `${s.itemName} (kurang ${s.shortage.toFixed(2)} ${s.uomCode})`).join(", ");
}
