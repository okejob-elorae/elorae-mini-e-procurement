import { describe, it, expect } from "vitest";
import { computeStorePrice } from "./pricing";

describe("computeStorePrice", () => {
  it("PUTUS returns sellingPrice as-is with sale label", () => {
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "PUTUS", marginPercent: 20, priceDiscountPercent: null }))
      .toEqual({ price: 10000, label: "Harga", flagged: false });
  });

  it("KONSI grosses up by margin", () => {
    // 10000 / (1 - 0.20) = 12500
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "KONSI", marginPercent: 20, priceDiscountPercent: null }))
      .toEqual({ price: 12500, label: "Retail (info)", flagged: false });
  });

  it("KONSI with margin 0 returns sellingPrice unchanged", () => {
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "KONSI", marginPercent: 0, priceDiscountPercent: null }))
      .toEqual({ price: 10000, label: "Retail (info)", flagged: false });
  });

  it("null sellingPrice yields no price regardless of terms", () => {
    expect(computeStorePrice({ sellingPrice: null, termsType: "PUTUS", marginPercent: 20, priceDiscountPercent: 10 }))
      .toEqual({ price: null, label: null, flagged: false });
    expect(computeStorePrice({ sellingPrice: null, termsType: "KONSI", marginPercent: 20, priceDiscountPercent: 10 }))
      .toEqual({ price: null, label: null, flagged: false });
  });

  it("KONSI with null margin falls back to sellingPrice and flags", () => {
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "KONSI", marginPercent: null, priceDiscountPercent: null }))
      .toEqual({ price: 10000, label: "Harga", flagged: true });
  });

  it("KONSI with margin >= 100 falls back to sellingPrice and flags", () => {
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "KONSI", marginPercent: 100, priceDiscountPercent: null }))
      .toEqual({ price: 10000, label: "Harga", flagged: true });
  });

  it("rounds a non-terminating discount to sen — the client's named case", () => {
    /* 33333 * (1 - 10/100) = 29999.700000000004 unrounded */
    expect(computeStorePrice({ sellingPrice: 33333, termsType: "PUTUS", marginPercent: null, priceDiscountPercent: 10 }).price)
      .toBe(29999.7);
  });

  it("treats null and 0 discount as today's passthrough on PUTUS", () => {
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "PUTUS", marginPercent: null, priceDiscountPercent: null }))
      .toEqual({ price: 10000, label: "Harga", flagged: false });
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "PUTUS", marginPercent: null, priceDiscountPercent: 0 }))
      .toEqual({ price: 10000, label: "Harga", flagged: false });
  });

  it("treats null and 0 discount as today's passthrough on KONSI (gross-up unaffected)", () => {
    // 10000 / (1 - 0.20) = 12500, same whether priceDiscountPercent is null or 0
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "KONSI", marginPercent: 20, priceDiscountPercent: null }))
      .toEqual({ price: 12500, label: "Retail (info)", flagged: false });
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "KONSI", marginPercent: 20, priceDiscountPercent: 0 }))
      .toEqual({ price: 12500, label: "Retail (info)", flagged: false });
  });

  it("ignores priceDiscountPercent entirely on a KONSI store", () => {
    // A KONSI gross-up carrying a store discount is still 10000 / (1 - 0.20) = 12500 —
    // the discount is a PUTUS-only concept and must not touch the KONSI branch at all.
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "KONSI", marginPercent: 20, priceDiscountPercent: 50 }))
      .toEqual({ price: 12500, label: "Retail (info)", flagged: false });
  });

  it("cents-rounds the KONSI gross-up", () => {
    // 10000 / (1 - 0.15) = 11764.705882352941 unrounded, today's shipped behaviour returns
    // that float noise; this rounds it to 11764.71.
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "KONSI", marginPercent: 15, priceDiscountPercent: null }))
      .toEqual({ price: 11764.71, label: "Retail (info)", flagged: false });
  });

  it("flags rather than throws on an out-of-range discount", () => {
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "PUTUS", marginPercent: null, priceDiscountPercent: -5 }))
      .toEqual({ price: 10000, label: "Harga", flagged: true });
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "PUTUS", marginPercent: null, priceDiscountPercent: 100 }))
      .toEqual({ price: 10000, label: "Harga", flagged: true });
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "PUTUS", marginPercent: null, priceDiscountPercent: 150 }))
      .toEqual({ price: 10000, label: "Harga", flagged: true });
  });

  it("applies a clean discount that needs no rounding", () => {
    // 10000 * (1 - 0.10) = 9000 exactly — the round is a no-op here, so this test
    // proves the discount math itself, not the rounding.
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "PUTUS", marginPercent: null, priceDiscountPercent: 10 }))
      .toEqual({ price: 9000, label: "Harga", flagged: false });
  });
});
