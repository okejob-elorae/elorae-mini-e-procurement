import { computeOrderPromos, type PromoInput } from "@elorae/db/promo";
import { distributeDiscountProRata } from "./promo-distribute";

export type PromoApplyLine = { itemId: string; qty: number; unitPrice: number; avgCost: number };
export type PromoApplyResult = {
  lineDiscounts: number[]; // aligned to the input `lines` order
  lineAppliedPromoId: Array<string | null>; // aligned to the input `lines` order
  orderDiscountAmount: number;
  appliedOrderPromoId: string | null;
};

/**
 * Apply putus promos with per-ITEM semantics over per-variant lines: aggregate an item's
 * variant lines into one synthetic promo line, run the engine, then pro-rate the resulting
 * discount back across that item's variant lines (by line total). Shared by createFieldSalesOrder
 * (honor-at-create) and previewFieldSalesPromos so the pre-Kirim quote == the recorded order.
 */
export function applyItemAggregatedPromos(lines: PromoApplyLine[], activePromos: PromoInput[]): PromoApplyResult {
  const lineDiscounts = new Array<number>(lines.length).fill(0);
  const lineAppliedPromoId = new Array<string | null>(lines.length).fill(null);

  // Group original line indices by itemId, preserving first-seen order.
  const idxByItem = new Map<string, number[]>();
  const itemOrder: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const id = lines[i].itemId;
    if (!idxByItem.has(id)) { idxByItem.set(id, []); itemOrder.push(id); }
    idxByItem.get(id)!.push(i);
  }

  const itemAgg = itemOrder.map((itemId) => {
    const idxs = idxByItem.get(itemId)!;
    return {
      itemId,
      qty: idxs.reduce((s, i) => s + lines[i].qty, 0),
      unitPrice: lines[idxs[0]].unitPrice, // item-level price (uniform across variants)
      avgCost: lines[idxs[0]].avgCost,
    };
  });

  const result = computeOrderPromos({ lines: itemAgg, activePromos });

  for (let a = 0; a < itemOrder.length; a++) {
    const idxs = idxByItem.get(itemOrder[a])!;
    const res = result.lines[a];
    const parts = distributeDiscountProRata(idxs.map((i) => lines[i].qty * lines[i].unitPrice), res.discountAmount);
    idxs.forEach((i, j) => { lineDiscounts[i] = parts[j]; lineAppliedPromoId[i] = res.appliedPromoId; });
  }

  return {
    lineDiscounts,
    lineAppliedPromoId,
    orderDiscountAmount: result.orderDiscountAmount,
    appliedOrderPromoId: result.appliedOrderPromoId,
  };
}
