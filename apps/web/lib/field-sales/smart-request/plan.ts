import { expandPack, type PackRatioRow } from "@elorae/db/pack-ratio";

export type PlanCandidate = {
  itemId: string;
  sku: string;
  variants: Array<{ variantSku: string; size: string }>;
  available: Record<string, number>;
};
export type PlanHistory = {
  neverOrdered: Set<string>;
  qtyByItem: Map<string, number>;
};
export type PlanCategoryInput = { categoryId: string; packs: number; candidates: PlanCandidate[] };
export type PlannedLine = { itemId: string; variantSku: string; size: string; qty: number };
export type DroppedArticle = {
  categoryId: string;
  itemId: string;
  sku: string;
  reason: "MISSING_SIZE" | "INSUFFICIENT_STOCK" | "EMPTY_RATIO";
  detail?: string;
};
export type CategoryUnderfill = { categoryId: string; requestedPacks: number; placedPacks: number };
export type SmartRequestPlan = { lines: PlannedLine[]; dropped: DroppedArticle[]; underfill: CategoryUnderfill[] };

function rankCandidates(candidates: PlanCandidate[], history: PlanHistory): PlanCandidate[] {
  return [...candidates].sort((a, b) => {
    const aNew = history.neverOrdered.has(a.itemId) ? 0 : 1;
    const bNew = history.neverOrdered.has(b.itemId) ? 0 : 1;
    if (aNew !== bNew) return aNew - bNew;
    const aQty = history.qtyByItem.get(a.itemId) ?? 0;
    const bQty = history.qtyByItem.get(b.itemId) ?? 0;
    if (aQty !== bQty) return bQty - aQty;
    return a.sku.localeCompare(b.sku);
  });
}

export function planSmartRequest(
  categories: PlanCategoryInput[],
  history: PlanHistory,
  ratio: PackRatioRow[],
): SmartRequestPlan {
  const lines: PlannedLine[] = [];
  const dropped: DroppedArticle[] = [];
  const underfill: CategoryUnderfill[] = [];

  for (const cat of categories) {
    const ranked = rankCandidates(cat.candidates, history);
    let placed = 0;
    for (const cand of ranked) {
      if (placed >= cat.packs) break;
      const r = expandPack({ ratio, variants: cand.variants, available: cand.available });
      if (r.ok) {
        for (const line of r.lines) {
          lines.push({ itemId: cand.itemId, variantSku: line.variantSku, size: line.size, qty: line.qty });
        }
        placed++;
        continue;
      }
      let detail: string | undefined;
      if (r.reason === "MISSING_SIZE") detail = r.size;
      else if (r.reason === "INSUFFICIENT_STOCK") detail = `${r.size}: butuh ${r.needed}, ada ${r.have}`;
      dropped.push({ categoryId: cat.categoryId, itemId: cand.itemId, sku: cand.sku, reason: r.reason, detail });
    }
    if (placed < cat.packs) underfill.push({ categoryId: cat.categoryId, requestedPacks: cat.packs, placedPacks: placed });
  }
  return { lines, dropped, underfill };
}
