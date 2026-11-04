import { describe, expect, it } from "vitest";
import { Prisma } from "@elorae/db";
import { adalahDecimal, decimalKeAngka } from "./decimal-ke-angka";

describe("decimalKeAngka", () => {
  it("turns every Decimal column into a number and leaves the rest alone", () => {
    const dibuat = new Date("2026-10-06T03:00:00Z");
    const uom = { id: "u1", code: "PCS" };
    const hasil = decimalKeAngka({
      id: "i1",
      sellingPrice: new Prisma.Decimal("75000.00"),
      commissionPerPcs: new Prisma.Decimal("2500.50"),
      reorderPoint: null,
      createdAt: dibuat,
      uom,
    });
    expect(hasil).toEqual({ id: "i1", sellingPrice: 75000, commissionPerPcs: 2500.5, reorderPoint: null, createdAt: dibuat, uom });
    expect(Object.values(hasil).some(adalahDecimal)).toBe(false);
  });

  it("does not mistake a date or a plain object for a Decimal", () => {
    expect(adalahDecimal(new Date())).toBe(false);
    expect(adalahDecimal({ id: "x" })).toBe(false);
    expect(adalahDecimal(new Prisma.Decimal(1))).toBe(true);
  });
});
