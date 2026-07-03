import { describe, it, expect } from "vitest";
import { computeStorePrice } from "./pricing";

describe("computeStorePrice", () => {
  it("PUTUS returns sellingPrice as-is with sale label", () => {
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "PUTUS", marginPercent: 20 }))
      .toEqual({ price: 10000, label: "Harga", flagged: false });
  });

  it("KONSI grosses up by margin", () => {
    // 10000 / (1 - 0.20) = 12500
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "KONSI", marginPercent: 20 }))
      .toEqual({ price: 12500, label: "Retail (info)", flagged: false });
  });

  it("KONSI with margin 0 returns sellingPrice unchanged", () => {
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "KONSI", marginPercent: 0 }))
      .toEqual({ price: 10000, label: "Retail (info)", flagged: false });
  });

  it("null sellingPrice yields no price regardless of terms", () => {
    expect(computeStorePrice({ sellingPrice: null, termsType: "PUTUS", marginPercent: 20 }))
      .toEqual({ price: null, label: null, flagged: false });
    expect(computeStorePrice({ sellingPrice: null, termsType: "KONSI", marginPercent: 20 }))
      .toEqual({ price: null, label: null, flagged: false });
  });

  it("KONSI with null margin falls back to sellingPrice and flags", () => {
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "KONSI", marginPercent: null }))
      .toEqual({ price: 10000, label: "Harga", flagged: true });
  });

  it("KONSI with margin >= 100 falls back to sellingPrice and flags", () => {
    expect(computeStorePrice({ sellingPrice: 10000, termsType: "KONSI", marginPercent: 100 }))
      .toEqual({ price: 10000, label: "Harga", flagged: true });
  });
});
