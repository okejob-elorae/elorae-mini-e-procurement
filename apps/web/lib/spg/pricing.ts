import { computeStorePrice, isValidMarkupPercent } from "@elorae/db/pricing";

export type SpgStorePricing = {
  termsType: "PUTUS" | "KONSI";
  markupPercent: number | null;
  priceDiscountPercent: number | null;
};

/**
 * The store columns SPG pricing reads. `recordSpgSale` and `getSellableCatalogForSpg` both select
 * exactly this, so the price the SPG sees and the price the writer charges come from the same
 * figures — a preview that forgot a column would otherwise show a price the writer never charges.
 */
export const SPG_STORE_PRICING_SELECT = { termsType: true, markupPercent: true, priceDiscountPercent: true } as const;

type DecimalLike = { toNumber(): number };

export function spgStorePricingFrom(row: {
  termsType: "PUTUS" | "KONSI";
  markupPercent: DecimalLike | null;
  priceDiscountPercent: DecimalLike | null;
}): SpgStorePricing {
  return {
    termsType: row.termsType,
    markupPercent: row.markupPercent === null ? null : row.markupPercent.toNumber(),
    priceDiscountPercent: row.priceDiscountPercent === null ? null : row.priceDiscountPercent.toNumber(),
  };
}

/**
 * The unit price an SPG charges a walk-in customer, priced with the store's REAL terms: a KONSI
 * store at the catalog price plus its markup, a PUTUS store at list less its priceDiscountPercent.
 * Null means the line cannot be sold — the item has no selling price, or a KONSI store has no
 * valid markup. The KONSI case refuses rather than falling back to the catalog price, which would
 * undercharge with nothing on screen to say so. A PUTUS store with an out-of-range discount still
 * sells at list, as it always has; the store write boundary refuses that value in the first place.
 */
export function spgUnitPrice(store: SpgStorePricing, sellingPrice: number | null): number | null {
  const { price, flagged } = computeStorePrice({
    sellingPrice,
    termsType: store.termsType,
    markupPercent: store.markupPercent,
    priceDiscountPercent: store.priceDiscountPercent,
  });
  if (price === null) return null;
  if (store.termsType === "KONSI" && flagged) return null;
  return price;
}

/* True when a KONSI store's products cannot be priced at all because the store carries no valid markup. */
export function isSpgStoreMarkupMissing(store: SpgStorePricing): boolean {
  return store.termsType === "KONSI" && !isValidMarkupPercent(store.markupPercent);
}
