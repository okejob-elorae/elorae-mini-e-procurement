import { describe, it, expect } from "vitest";
import { computeStorePrice, isValidMarkupPercent, MARKUP_PERCENT_MAX, roundToWholeRupiah } from "./pricing";

describe("computeStorePrice", () => {
  it("PUTUS returns sellingPrice as-is with sale label, ignoring any markup", () => {
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "PUTUS", markupPercent: 20, priceDiscountPercent: null }))
      .toEqual({ price: 10000, label: "Harga", flagged: false });
  });

  it("KONSI marks the catalog price up by the store markup", () => {
    /* 100000 * (1 + 20/100) = 120000 */
    expect(computeStorePrice({ sellingPrice: 100000, termsType: "KONSI", markupPercent: 20, priceDiscountPercent: null }))
      .toEqual({ price: 120000, label: "Harga retail", flagged: false });
  });

  it("KONSI with markup 0 returns sellingPrice unchanged and unflagged", () => {
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "KONSI", markupPercent: 0, priceDiscountPercent: null }))
      .toEqual({ price: 10000, label: "Harga retail", flagged: false });
  });

  it("cents-rounds an off-cent KONSI markup", () => {
    /* 9999 * (1 + 12.34/100) = 11232.8766 unrounded; fails if roundCents is dropped from the KONSI branch */
    expect(computeStorePrice({ sellingPrice: 9999, termsType: "KONSI", markupPercent: 12.34, priceDiscountPercent: null }))
      .toEqual({ price: 11232.88, label: "Harga retail", flagged: false });
  });

  it("accepts the column ceiling as a markup", () => {
    /* 10000 * (1 + 999.99/100) = 109999 */
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "KONSI", markupPercent: MARKUP_PERCENT_MAX, priceDiscountPercent: null }))
      .toEqual({ price: 109999, label: "Harga retail", flagged: false });
  });

  it("null sellingPrice yields no price regardless of terms", () => {
    expect(computeStorePrice({ sellingPrice: null, termsType: "PUTUS", markupPercent: 20, priceDiscountPercent: 10 }))
      .toEqual({ price: null, label: null, flagged: false });
    expect(computeStorePrice({ sellingPrice: null, termsType: "KONSI", markupPercent: 20, priceDiscountPercent: 10 }))
      .toEqual({ price: null, label: null, flagged: false });
  });

  it("KONSI with a null, negative or above-ceiling markup falls back to sellingPrice and flags", () => {
    for (const markupPercent of [null, -5, 1000]) {
      expect(computeStorePrice({ sellingPrice: 10000, termsType: "KONSI", markupPercent, priceDiscountPercent: null }))
        .toEqual({ price: 10000, label: "Harga", flagged: true });
    }
  });

  it("flags an undefined or NaN markup instead of pricing NaN", () => {
    /* undefined is what a store select that omitted the column hands over, and what a caller still sending the old field name arrives as */
    for (const markupPercent of [undefined, Number.NaN]) {
      expect(computeStorePrice({ sellingPrice: 10000, termsType: "KONSI", markupPercent: markupPercent as unknown as number | null, priceDiscountPercent: null }))
        .toEqual({ price: 10000, label: "Harga", flagged: true });
    }
  });

  it("ignores priceDiscountPercent entirely on a KONSI store", () => {
    /* the discount is a PUTUS-only concept: 10000 * (1 + 20/100) = 12000 whatever discount the row carries */
    for (const priceDiscountPercent of [null, 0, 50]) {
      expect(computeStorePrice({ sellingPrice: 10000, termsType: "KONSI", markupPercent: 20, priceDiscountPercent }))
        .toEqual({ price: 12000, label: "Harga retail", flagged: false });
    }
  });

  it("rounds a non-terminating discount to sen — the client's named documented example", () => {
    /*
     * 33333 * (1 - 10/100) = 29999.700000000004 unrounded, but 29999.7 IS the nearest
     * double to that value, so this case cannot fail if roundCents is removed — it
     * documents the client's named example, not a regression guard. See the next test
     * for the case that actually discriminates.
     */
    expect(computeStorePrice({ sellingPrice: 33333, termsType: "PUTUS", markupPercent: null, priceDiscountPercent: 10 }).price)
      .toBe(29999.7);
  });

  it("rounds a PUTUS discount that would otherwise leave float noise", () => {
    /*
     * 45678 * (1 - 10/100) = 41110.200000000004 unrounded — this DOES change under
     * rounding, unlike the 33333 case above, so it fails if roundCents is dropped
     * from the PUTUS branch.
     */
    expect(computeStorePrice({ sellingPrice: 45678, termsType: "PUTUS", markupPercent: null, priceDiscountPercent: 10 }))
      .toEqual({ price: 41110.2, label: "Harga", flagged: false });
  });

  it("treats null and 0 discount as today's passthrough on PUTUS", () => {
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "PUTUS", markupPercent: null, priceDiscountPercent: null }))
      .toEqual({ price: 10000, label: "Harga", flagged: false });
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "PUTUS", markupPercent: null, priceDiscountPercent: 0 }))
      .toEqual({ price: 10000, label: "Harga", flagged: false });
  });

  it("flags rather than throws on an out-of-range discount", () => {
    for (const priceDiscountPercent of [-5, 100, 150]) {
      expect(computeStorePrice({ sellingPrice: 10000, termsType: "PUTUS", markupPercent: null, priceDiscountPercent }))
        .toEqual({ price: 10000, label: "Harga", flagged: true });
    }
  });

  it("applies a clean discount that needs no rounding", () => {
    /* 10000 * (1 - 0.10) = 9000 exactly — proves the discount math itself, not the rounding */
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "PUTUS", markupPercent: null, priceDiscountPercent: 10 }))
      .toEqual({ price: 9000, label: "Harga", flagged: false });
  });
});

describe("isValidMarkupPercent", () => {
  it("accepts 0 through the column ceiling", () => {
    for (const markupPercent of [0, 20, 12.34, MARKUP_PERCENT_MAX]) {
      expect(isValidMarkupPercent(markupPercent)).toBe(true);
    }
  });

  it("refuses null, undefined, NaN, Infinity, negatives and anything above the ceiling", () => {
    for (const markupPercent of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1000]) {
      expect(isValidMarkupPercent(markupPercent)).toBe(false);
    }
  });
});

describe("roundToWholeRupiah", () => {
  it("rounds a fraction below the half down", () => {
    expect(roundToWholeRupiah(26666.4)).toBe(26666);
  });

  it("rounds a fraction above the half up", () => {
    expect(roundToWholeRupiah(26666.6)).toBe(26667);
  });

  it("rounds exactly half up", () => {
    expect(roundToWholeRupiah(26666.5)).toBe(26667);
  });

  it("leaves an already-whole value unchanged", () => {
    expect(roundToWholeRupiah(20000)).toBe(20000);
  });
});
