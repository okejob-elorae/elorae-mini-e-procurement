import { describe, expect, it } from "vitest";
import { nilaiHitunganAwal } from "./nilai";

describe("nilaiHitunganAwal", () => {
  it("sums received qty × line price when the lines carry prices (consignment)", () => {
    expect(nilaiHitunganAwal([{ qty: 2, price: 100_000 }, { qty: 1, price: 50_000 }], [1, 1], 250_000)).toBe(150_000);
  });

  it("spreads the store's note total per piece when no line has a price (sold-outright store)", () => {
    expect(nilaiHitunganAwal([{ qty: 3, price: 0 }, { qty: 1, price: 0 }], [3, 0], 400_000)).toBe(300_000);
  });

  it("falls back to the claimed value when the note has no quantities", () => {
    expect(nilaiHitunganAwal([], [], 70_000)).toBe(70_000);
  });

  it("never counts a negative quantity", () => {
    expect(nilaiHitunganAwal([{ qty: 2, price: 10 }], [-5], 20)).toBe(0);
  });
});
