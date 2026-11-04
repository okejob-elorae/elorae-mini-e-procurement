import { describe, expect, it } from "vitest";
import { bacaBulanUrl, bulanAwalKalender } from "@/components/planning/kalender-bulan";

/* Tab Kalender Plan Kerja: bulan yang dibuka (?bulan=, lalu bulan ini WIB, lalu Januari). */

describe("bacaBulanUrl", () => {
  it("hanya 1–12 bulat", () => {
    expect(bacaBulanUrl("1")).toBe(1);
    expect(bacaBulanUrl("12")).toBe(12);
    expect(bacaBulanUrl("09")).toBe(9);
    for (const salah of [null, "", "0", "13", "1.5", "-1", "abc", "123"]) {
      expect(bacaBulanUrl(salah)).toBeNull();
    }
  });
});

describe("bulanAwalKalender", () => {
  it("URL menang; tanpa URL → bulan ini bila tahun plan = tahun WIB ini, selain itu Januari", () => {
    expect(bulanAwalKalender(4, 2026, "2026-10-07")).toBe(4);
    expect(bulanAwalKalender(null, 2026, "2026-10-07")).toBe(10);
    expect(bulanAwalKalender(null, 2027, "2026-10-07")).toBe(1);
    expect(bulanAwalKalender(null, 2025, "2026-01-01")).toBe(1);
  });
});
