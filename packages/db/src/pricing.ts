export type StorePriceInput = {
  sellingPrice: number | null;
  termsType: "PUTUS" | "KONSI";
  markupPercent: number | null;
  priceDiscountPercent: number | null;
};

export type StorePrice = {
  price: number | null;
  label: string | null;
  flagged: boolean;
};

const SALE_LABEL = "Harga";
const KONSI_LABEL = "Harga retail";

/**
 * The largest markup a store can carry: the ceiling of the `Store.markupPercent` Decimal(5,2)
 * column. The store write boundary refuses above it and `computeStorePrice` flags above it, and
 * both read this one constant so the two bounds cannot drift apart.
 */
export const MARKUP_PERCENT_MAX = 999.99;

/* Half-up to two decimal places (sen). */
export function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Half-up to whole rupiah. Applied ONLY at the cash boundary — the total a human actually
 * collects and compares payment against (VanSale.total / SpgSale.total) — never to a line's
 * unitPrice, which stays at 2dp (Decimal(15,2)) exactly as computeStorePrice produces it. Sen do
 * not exist as physical currency: a store discount (or any fractional Item.sellingPrice, which
 * Decimal(14,2) permits regardless of discount) can leave the exact line sum on a sub-rupiah
 * fraction, and a drawer cannot take that fraction whatever caused it. The exact 2dp sum stays
 * available as `subtotal`, so `total - subtotal` is always the derivable rounding adjustment —
 * nothing is silently lost, just charged at whole rupiah.
 *
 * A single, client-safe home (this module has zero imports) is load-bearing: the writer and the
 * PWA cash-screen preview MUST derive the charged total from this same function, or the preview
 * total drifts from what the writer actually persists and compares payment against — the same
 * preview-vs-writer mismatch this file's `computeStorePrice` discount rounding already fixed once.
 */
export function roundToWholeRupiah(value: number): number {
  return Math.round(value);
}

/**
 * Whether a store markup can price a KONSI sale: a finite number from 0 to MARKUP_PERCENT_MAX
 * inclusive. `undefined` counts as invalid on purpose — it is what a Prisma `select` that forgot
 * the column hands over, and treating it as invalid flags the price instead of computing NaN.
 * The one spelling of the rule: the KONSI pricing branch, the store write boundary and the konsi
 * order screen all call it.
 */
export function isValidMarkupPercent(markupPercent: number | null | undefined): markupPercent is number {
  return (
    typeof markupPercent === "number" &&
    Number.isFinite(markupPercent) &&
    markupPercent >= 0 &&
    markupPercent <= MARKUP_PERCENT_MAX
  );
}

export function computeStorePrice(input: StorePriceInput): StorePrice {
  const { sellingPrice, termsType, markupPercent, priceDiscountPercent } = input;
  if (sellingPrice === null) return { price: null, label: null, flagged: false };

  if (termsType === "PUTUS") {
    const pct = priceDiscountPercent;
    if (pct === null || pct === 0) {
      return { price: sellingPrice, label: SALE_LABEL, flagged: false };
    }
    if (pct < 0 || pct >= 100) {
      return { price: sellingPrice, label: SALE_LABEL, flagged: true };
    }
    return { price: roundCents(sellingPrice * (1 - pct / 100)), label: SALE_LABEL, flagged: false };
  }

  /**
   * KONSI: the retail price a konsi store's customer pays, the catalog price marked up by the
   * store's markupPercent — 100,000 at 20% is 120,000. Unaffected by priceDiscountPercent. A
   * missing or out-of-range markup returns the catalog price flagged: a caller that charges this
   * price must refuse a flagged one rather than undercharge at the catalog price.
   */
  if (!isValidMarkupPercent(markupPercent)) {
    return { price: sellingPrice, label: SALE_LABEL, flagged: true };
  }
  return { price: roundCents(sellingPrice * (1 + markupPercent / 100)), label: KONSI_LABEL, flagged: false };
}
