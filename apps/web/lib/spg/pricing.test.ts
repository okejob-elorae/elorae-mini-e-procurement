import { describe, it, expect } from "vitest";
import { isSpgStoreMarkupMissing, spgStorePricingFrom, spgUnitPrice, type SpgStorePricing } from "./pricing";

const konsi = (markupPercent: number | null): SpgStorePricing => ({ termsType: "KONSI", markupPercent, priceDiscountPercent: null });
const putus = (priceDiscountPercent: number | null): SpgStorePricing => ({ termsType: "PUTUS", markupPercent: null, priceDiscountPercent });

describe("spgUnitPrice", () => {
  it("prices a KONSI store at the catalog price plus its markup", () => {
    expect(spgUnitPrice(konsi(20), 5000)).toBe(6000);
  });

  it("cents-rounds an off-cent KONSI markup", () => {
    /* 9999 * (1 + 12.34/100) = 11232.8766 */
    expect(spgUnitPrice(konsi(12.34), 9999)).toBe(11232.88);
  });

  it("returns no price at a KONSI store with a missing or out-of-range markup, never the catalog price", () => {
    for (const markupPercent of [null, -5, 1000]) {
      expect(spgUnitPrice(konsi(markupPercent), 5000)).toBeNull();
    }
  });

  it("returns no price for an item with no selling price, on either terms", () => {
    expect(spgUnitPrice(konsi(20), null)).toBeNull();
    expect(spgUnitPrice(putus(null), null)).toBeNull();
  });

  it("prices a PUTUS store at the selling price less its discount", () => {
    /* 5000 * (1 - 12/100) = 4400 */
    expect(spgUnitPrice(putus(12), 5000)).toBe(4400);
  });

  it("prices a PUTUS store at list, unchanged, when its discount is out of range", () => {
    expect(spgUnitPrice(putus(150), 5000)).toBe(5000);
  });

  it("prices a PUTUS store at list regardless of any markup it carries", () => {
    expect(spgUnitPrice({ termsType: "PUTUS", markupPercent: 20, priceDiscountPercent: null }, 5000)).toBe(5000);
  });
});

describe("spgStorePricingFrom", () => {
  it("converts the store row's decimals to numbers and keeps nulls", () => {
    expect(spgStorePricingFrom({ termsType: "KONSI", markupPercent: { toNumber: () => 20 }, priceDiscountPercent: null }))
      .toEqual({ termsType: "KONSI", markupPercent: 20, priceDiscountPercent: null });
  });
});

describe("isSpgStoreMarkupMissing", () => {
  it("is true only for a KONSI store without a valid markup", () => {
    expect(isSpgStoreMarkupMissing(konsi(null))).toBe(true);
    expect(isSpgStoreMarkupMissing(konsi(-5))).toBe(true);
    expect(isSpgStoreMarkupMissing(konsi(20))).toBe(false);
    expect(isSpgStoreMarkupMissing(putus(null))).toBe(false);
  });
});
