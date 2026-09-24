import { roundCents } from "@elorae/db/pricing";

export type SellThroughPricingLineInput = { key: string; billedQty: number; sellingPrice: number | null };

export type SellThroughPricedLine = { key: string; unitPrice: number | null; lineTotal: number };

export type SellThroughPricing = { lines: SellThroughPricedLine[]; total: number; unpricedKeys: string[] };

/**
 * The one pricing rule for a sell-through invoice, shared by the approve writer and the detail
 * screen's preview so the two can never disagree. Import-free beyond the client-safe pricing
 * subpath, so a client component may call it too.
 *
 * A konsi store is invoiced at the item's catalog selling price. The store's markup is the retail
 * price its own customer pays at the SPG POS, which the store keeps, so it never reaches the
 * invoice and this rule does not read it. A billed line is unpriced only when its item has no
 * usable selling price.
 */
export function priceSellThroughLines(input: { lines: SellThroughPricingLineInput[] }): SellThroughPricing {
  const lines = input.lines.map((l) => {
    const unitPrice = l.sellingPrice === null || !Number.isFinite(l.sellingPrice) ? null : roundCents(l.sellingPrice);
    const lineTotal = unitPrice === null ? 0 : roundCents(l.billedQty * unitPrice);
    return { key: l.key, unitPrice, lineTotal };
  });
  const unpricedKeys = lines.filter((l, i) => l.unitPrice === null && input.lines[i].billedQty > 0).map((l) => l.key);
  const total = roundCents(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  return { lines, total, unpricedKeys };
}
