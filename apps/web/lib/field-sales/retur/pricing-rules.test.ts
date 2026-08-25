import { describe, expect, it } from "vitest";
import { classifyPriceCandidates, effectiveUnitPrice, round2 } from "./pricing-rules";

describe("effectiveUnitPrice", () => {
  it("divides the line total by its quantity", () => {
    expect(effectiveUnitPrice(10_000_000, 12)).toBeCloseTo(833_333.3333, 4);
  });

  it("returns null for a zero quantity rather than dividing by zero", () => {
    expect(effectiveUnitPrice(10_000_000, 0)).toBeNull();
  });

  it("returns null for a negative quantity", () => {
    expect(effectiveUnitPrice(10_000_000, -3)).toBeNull();
  });

  it("does NOT round — the caller needs the exact ratio to compute an exact line total", () => {
    expect(effectiveUnitPrice(10, 3)).not.toBe(3.33);
  });
});

describe("classifyPriceCandidates", () => {
  it("auto-prices when exactly one distinct price exists", () => {
    expect(classifyPriceCandidates([833_333.3333])).toEqual({ kind: "AUTO", price: 833_333.3333 });
  });

  it("auto-prices when several deliveries carry the SAME price — there is no decision to make", () => {
    expect(classifyPriceCandidates([500, 500, 500])).toEqual({ kind: "AUTO", price: 500 });
  });

  it("is ambiguous when two distinct prices exist", () => {
    expect(classifyPriceCandidates([500, 450])).toEqual({ kind: "AMBIGUOUS" });
  });

  it("is unpriceable when no delivery priced these goods", () => {
    expect(classifyPriceCandidates([])).toEqual({ kind: "UNPRICEABLE" });
  });
});

describe("round2", () => {
  it("rounds to two decimals", () => {
    expect(round2(833_333.3333)).toBe(833_333.33);
  });

  it("rounds half away from zero rather than to even", () => {
    expect(round2(0.005)).toBe(0.01);
  });
});
