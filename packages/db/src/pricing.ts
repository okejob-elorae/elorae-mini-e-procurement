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

/* Half-up to two decimal places (sen). Applied inside the helper only. */
function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
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
