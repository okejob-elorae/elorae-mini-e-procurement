import { describe, expect, it } from "vitest";
import { tahunForecastBawaan } from "@/app/backoffice/forecast/tahun-forecast";
import { usulanTahunPlan } from "./usulan-tahun";

// 8 Okt 2026 10.00 WIB dan 15 Mar 2026 10.00 WIB.
const OKTOBER = new Date("2026-10-08T03:00:00Z");
const MARET = new Date("2026-03-15T03:00:00Z");

describe("usulanTahunPlan", () => {
  it("sama dengan tahun bawaan Forecast", () => {
    expect(usulanTahunPlan([], OKTOBER)).toBe(tahunForecastBawaan(OKTOBER));
    expect(usulanTahunPlan([], MARET)).toBe(tahunForecastBawaan(MARET));
  });

  it("sesudah Juni mengusulkan tahun depan", () => {
    expect(usulanTahunPlan([], OKTOBER)).toBe(2027);
  });

  it("sebelum Juli mengusulkan tahun berjalan", () => {
    expect(usulanTahunPlan([], MARET)).toBe(2026);
  });

  it("melewati tahun yang sudah punya plan", () => {
    expect(usulanTahunPlan([2027], OKTOBER)).toBe(2028);
    expect(usulanTahunPlan([2026, 2027, 2028], MARET)).toBe(2029);
  });
});
