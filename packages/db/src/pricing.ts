export type StorePriceInput = {
  sellingPrice: number | null;
  termsType: "PUTUS" | "KONSI";
  marginPercent: number | null;
};

export type StorePrice = {
  price: number | null;
  label: string | null;
  flagged: boolean;
};

const SALE_LABEL = "Harga";
const KONSI_LABEL = "Retail (info)";

export function computeStorePrice(input: StorePriceInput): StorePrice {
  const { sellingPrice, termsType, marginPercent } = input;
  if (sellingPrice === null) return { price: null, label: null, flagged: false };

  if (termsType === "PUTUS") {
    return { price: sellingPrice, label: SALE_LABEL, flagged: false };
  }

  // KONSI: gross up to the store's retail price (informational).
  const m = marginPercent;
  if (m === null || m < 0 || m >= 100) {
    return { price: sellingPrice, label: SALE_LABEL, flagged: true };
  }
  return { price: sellingPrice / (1 - m / 100), label: KONSI_LABEL, flagged: false };
}
