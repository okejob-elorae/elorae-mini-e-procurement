import { describe, expect, it } from "vitest";
import { pilihanTahunForecast, tahunForecastBawaan, tahunForecastDariUrl } from "./tahun-forecast";

describe("tahun forecast", () => {
  it("Oktober 2026 → pilihan 2024–2028, bawaan 2027 (tahun depan)", () => {
    const okt = new Date("2026-10-06T01:00:00Z");
    expect(pilihanTahunForecast(okt)).toEqual([2024, 2025, 2026, 2027, 2028]);
    expect(tahunForecastBawaan(okt)).toBe(2027);
  });

  it("Juni 2026 → bawaan 2026; 1 Juli 00.30 WIB (30 Juni UTC) → sudah 2027", () => {
    expect(tahunForecastBawaan(new Date("2026-06-15T05:00:00Z"))).toBe(2026);
    expect(tahunForecastBawaan(new Date("2026-06-30T17:30:00Z"))).toBe(2027);
  });

  it("tahun di URL hanya dipakai bila termasuk pilihan", () => {
    const okt = new Date("2026-10-06T01:00:00Z");
    expect(tahunForecastDariUrl("2028", okt)).toBe(2028);
    expect(tahunForecastDariUrl("2030", okt)).toBe(2027);
    expect(tahunForecastDariUrl(null, okt)).toBe(2027);
    expect(tahunForecastDariUrl("abc", okt)).toBe(2027);
  });
});
