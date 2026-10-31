import { describe, expect, it } from "vitest";
import { MAKS_KG_PER_ROLL, bacaKgPerRoll, periksaKgPerRoll } from "./kg-per-roll";

describe("kg per roll", () => {
  it("tidak dikirim / dikosongkan / angka dua desimal", () => {
    expect(bacaKgPerRoll(undefined)).toBeUndefined();
    expect(bacaKgPerRoll(null)).toBeNull();
    expect(bacaKgPerRoll("  ")).toBeNull();
    expect(bacaKgPerRoll(25)).toBe(25);
    expect(bacaKgPerRoll("22,555")).toBe(22.56);
  });

  it("nol, negatif, bukan angka, atau terlalu besar ditolak", () => {
    expect(periksaKgPerRoll(bacaKgPerRoll("abc"))).toMatch(/^kgPerRoll:/);
    expect(periksaKgPerRoll(0)).toMatch(/^kgPerRoll:/);
    expect(periksaKgPerRoll(-1)).toMatch(/^kgPerRoll:/);
    expect(periksaKgPerRoll(MAKS_KG_PER_ROLL + 1)).toMatch(/^kgPerRoll:/);
    expect(periksaKgPerRoll(25)).toBeNull();
    expect(periksaKgPerRoll(null)).toBeNull();
    expect(periksaKgPerRoll(undefined)).toBeNull();
  });
});
