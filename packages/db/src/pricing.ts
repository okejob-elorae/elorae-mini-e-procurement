export type StorePriceInput = {
  sellingPrice: number | null;
  termsType: "PUTUS" | "KONSI";
  marginPercent: number | null;
  priceDiscountPercent: number | null;
};

export type StorePrice = {
  price: number | null;
  label: string | null;
  flagged: boolean;
};

const SALE_LABEL = "Harga";
const KONSI_LABEL = "Retail (info)";

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

export function computeStorePrice(input: StorePriceInput): StorePrice {
  const { sellingPrice, termsType, marginPercent, priceDiscountPercent } = input;
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

  // KONSI: gross up to the store's retail price (informational). Unaffected by priceDiscountPercent.
  const m = marginPercent;
  if (m === null || m < 0 || m >= 100) {
    return { price: sellingPrice, label: SALE_LABEL, flagged: true };
  }
  return { price: roundCents(sellingPrice / (1 - m / 100)), label: KONSI_LABEL, flagged: false };
}
