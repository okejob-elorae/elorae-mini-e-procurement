import { describe, expect, it } from "vitest";
import { resolveRate } from "./resolve-rate";

const rates = [
  { itemCategoryId: "cat-a", effectiveFrom: "2026-11", amountPerPiece: 1500 },
  { itemCategoryId: "cat-a", effectiveFrom: "2026-08", amountPerPiece: 1000 },
  { itemCategoryId: "cat-a", effectiveFrom: "2027-02", amountPerPiece: 2000 },
  { itemCategoryId: "cat-b", effectiveFrom: "2026-10", amountPerPiece: 500 },
];

describe("resolveRate", () => {
  it("returns null when the category has no rate at all", () => {
    expect(resolveRate(rates, "cat-none", "2026-10")).toBeNull();
    expect(resolveRate([], "cat-a", "2026-10")).toBeNull();
  });

  it("uses a rate effective from exactly that month", () => {
    expect(resolveRate(rates, "cat-a", "2026-11")?.amountPerPiece).toBe(1500);
    expect(resolveRate(rates, "cat-b", "2026-10")?.amountPerPiece).toBe(500);
  });

  it("uses the latest rate effective from an earlier month", () => {
    expect(resolveRate(rates, "cat-a", "2026-09")?.amountPerPiece).toBe(1000);
    expect(resolveRate(rates, "cat-a", "2027-01")?.amountPerPiece).toBe(1500);
    expect(resolveRate(rates, "cat-a", "2027-06")?.amountPerPiece).toBe(2000);
  });

  it("returns null when the category's only rates start later", () => {
    expect(resolveRate(rates, "cat-a", "2026-07")).toBeNull();
    expect(resolveRate(rates, "cat-b", "2026-09")).toBeNull();
  });

  it("never takes another category's rate", () => {
    expect(resolveRate(rates, "cat-b", "2027-06")?.amountPerPiece).toBe(500);
  });

  it("orders across a year boundary", () => {
    const yearly = [
      { itemCategoryId: "cat-y", effectiveFrom: "2026-12", amountPerPiece: 100 },
      { itemCategoryId: "cat-y", effectiveFrom: "2027-01", amountPerPiece: 200 },
    ];
    expect(resolveRate(yearly, "cat-y", "2026-12")?.amountPerPiece).toBe(100);
    expect(resolveRate(yearly, "cat-y", "2027-01")?.amountPerPiece).toBe(200);
  });
});
