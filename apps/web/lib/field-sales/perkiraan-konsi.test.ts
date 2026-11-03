import { describe, expect, it } from "vitest";
import { hargaKonsiHp, perkiraanNilaiKonsi } from "./perkiraan-konsi";

describe("hargaKonsiHp", () => {
  it("marks the catalog price up by the store's markup (100.000 at 20% = 120.000)", () => {
    expect(hargaKonsiHp(100_000, 20)).toBe(120_000);
  });

  it("returns null for an unpriced item", () => {
    expect(hargaKonsiHp(null, 20)).toBeNull();
  });

  it("returns null when the store's markup is empty or out of range, never the bare catalog price", () => {
    expect(hargaKonsiHp(100_000, null)).toBeNull();
    expect(hargaKonsiHp(100_000, -1)).toBeNull();
    expect(hargaKonsiHp(100_000, 1000)).toBeNull();
  });

  it("a markup of 0 is valid and keeps the catalog price", () => {
    expect(hargaKonsiHp(100_000, 0)).toBe(100_000);
  });
});

describe("perkiraanNilaiKonsi", () => {
  it("sums qty × price over every priced line", () => {
    expect(perkiraanNilaiKonsi([{ qty: 2, harga: 120_000 }, { qty: 1, harga: 60_000 }])).toEqual({ nilai: 300_000, lengkap: true });
  });

  it("flags a partial figure when some line has no price", () => {
    expect(perkiraanNilaiKonsi([{ qty: 2, harga: 120_000 }, { qty: 3, harga: null }])).toEqual({ nilai: 240_000, lengkap: false });
  });

  it("returns null when no line has a price", () => {
    expect(perkiraanNilaiKonsi([{ qty: 3, harga: null }])).toBeNull();
    expect(perkiraanNilaiKonsi([])).toBeNull();
  });

  it("adds in whole cents, so fractional prices never drift", () => {
    /* 0,1 + 0,2 in floating point is 0,30000000000000004. */
    expect(perkiraanNilaiKonsi([{ qty: 1, harga: 0.1 }, { qty: 1, harga: 0.2 }])).toEqual({ nilai: 0.3, lengkap: true });
    expect(perkiraanNilaiKonsi([{ qty: 3, harga: 33_333.33 }])).toEqual({ nilai: 99_999.99, lengkap: true });
  });
});
