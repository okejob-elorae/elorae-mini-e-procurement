import { computeStorePrice, roundCents } from "@elorae/db/pricing";

export type SellThroughPricingLineInput = { key: string; billedQty: number; sellingPrice: number | null };

export type SellThroughPricedLine = { key: string; unitPrice: number | null; lineTotal: number };

export type SellThroughPricing = { lines: SellThroughPricedLine[]; total: number; unpricedKeys: string[] };

/**
 * The one pricing rule for a sell-through invoice, shared by the approve writer and the detail
 * screen's preview so the two can never disagree. Import-free beyond the client-safe pricing
 * subpath, so a client component may call it too.
 *
 * `computeStorePrice`'s KONSI branch never reads the discount (a KONSI store cannot hold one) and,
 * for a missing or out-of-range margin, returns the raw selling price with `flagged: true` rather
 * than null. A flagged price is therefore treated as no price: billing the raw selling price would
 * silently invoice below the store price.
 */
export function priceSellThroughLines(input: {
  marginPercent: number | null;
  lines: SellThroughPricingLineInput[];
}): SellThroughPricing {
  const lines = input.lines.map((l) => {
    const p = computeStorePrice({
      termsType: "KONSI",
      sellingPrice: l.sellingPrice,
      marginPercent: input.marginPercent,
      priceDiscountPercent: null,
    });
    const unitPrice = p.price === null || p.flagged || !Number.isFinite(p.price) ? null : p.price;
    const lineTotal = unitPrice === null ? 0 : roundCents(l.billedQty * unitPrice);
    return { key: l.key, unitPrice, lineTotal };
  });
  const unpricedKeys = lines.filter((l, i) => l.unitPrice === null && input.lines[i].billedQty > 0).map((l) => l.key);
  const total = roundCents(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  return { lines, total, unpricedKeys };
}
