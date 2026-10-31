import { describe, expect, it } from "vitest";
import { rentangBulanWib, susunBahanLaporan } from "./laporan-spg";

describe("susunBahanLaporan", () => {
  it("sums every variant of an item into one report line, by item", () => {
    expect(
      susunBahanLaporan([
        { itemId: "a", itemName: "Kemeja", qty: 2 },
        { itemId: "a", itemName: "Kemeja", qty: 3 },
        { itemId: "b", itemName: "Blus", qty: 1 },
      ]),
    ).toEqual([
      { itemId: "b", itemName: "Blus", qty: 1 },
      { itemId: "a", itemName: "Kemeja", qty: 5 },
    ]);
  });

  it("subtracts goods returned by shoppers (negative rows) and drops items with nothing left", () => {
    expect(
      susunBahanLaporan([
        { itemId: "a", itemName: "Kemeja", qty: 5 },
        { itemId: "a", itemName: "Kemeja", qty: -2 },
        { itemId: "b", itemName: "Blus", qty: 1 },
        { itemId: "b", itemName: "Blus", qty: -1 },
      ]),
    ).toEqual([{ itemId: "a", itemName: "Kemeja", qty: 3 }]);
  });

  it("returns nothing for a month without sales, so the form stays for manual entry", () => {
    expect(susunBahanLaporan([])).toEqual([]);
  });
});

describe("rentangBulanWib", () => {
  it("covers the Jakarta calendar month, midnight WIB to midnight WIB", () => {
    const { awal, akhir } = rentangBulanWib(2026, 9);
    expect(awal.toISOString()).toBe("2026-08-31T17:00:00.000Z");
    expect(akhir.toISOString()).toBe("2026-09-30T17:00:00.000Z");
  });

  it("rolls December into January of the next year", () => {
    expect(rentangBulanWib(2026, 12).akhir.toISOString()).toBe("2026-12-31T17:00:00.000Z");
  });
});
