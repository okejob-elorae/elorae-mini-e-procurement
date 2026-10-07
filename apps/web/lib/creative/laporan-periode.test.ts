import { describe, expect, it } from "vitest";
import { bacaPilihanPeriode, paramPeriode, periodeDari, periodeRekap } from "./laporan-periode";

const HARI_INI = "2026-10-07";

describe("periodeDari", () => {
  it("chip tetap dihitung dari hari ini WIB", () => {
    expect(periodeDari({ pilihan: "hariIni", hariIni: HARI_INI })).toEqual({ dari: HARI_INI, sampai: HARI_INI });
    expect(periodeDari({ pilihan: "tujuhHari", hariIni: HARI_INI })).toEqual({ dari: "2026-10-01", sampai: HARI_INI });
    expect(periodeDari({ pilihan: "tigaPuluhHari", hariIni: HARI_INI })).toEqual({ dari: "2026-09-08", sampai: HARI_INI });
    expect(periodeDari({ pilihan: "bulanIni", hariIni: HARI_INI })).toEqual({ dari: "2026-10-01", sampai: HARI_INI });
    expect(periodeDari({ pilihan: "bulanLalu", hariIni: HARI_INI })).toEqual({ dari: "2026-09-01", sampai: "2026-09-30" });
    expect(periodeDari({ pilihan: "semua", hariIni: HARI_INI })).toBeNull();
  });

  it("rentang diurutkan; tanpa tanggal sah jatuh ke 30 hari", () => {
    expect(periodeDari({ pilihan: "rentang", dari: "2026-10-05", sampai: "2026-10-01", hariIni: HARI_INI })).toEqual({
      dari: "2026-10-01",
      sampai: "2026-10-05",
    });
    expect(periodeDari({ pilihan: "rentang", dari: "2026-10-05", hariIni: HARI_INI })).toEqual({ dari: "2026-10-05", sampai: "2026-10-05" });
    expect(periodeDari({ pilihan: "rentang", dari: "kemarin", sampai: "", hariIni: HARI_INI })).toEqual({ dari: "2026-09-08", sampai: HARI_INI });
  });
});

describe("periodeRekap", () => {
  it("Semua = sejak KOL pertama sampai hari ini", () => {
    expect(periodeRekap(null, "2026-01-15", HARI_INI)).toEqual({ dari: "2026-01-15", sampai: HARI_INI });
    expect(periodeRekap(null, null, HARI_INI)).toEqual({ dari: HARI_INI, sampai: HARI_INI });
    expect(periodeRekap({ dari: "2026-10-01", sampai: "2026-10-02" }, "2026-01-15", HARI_INI)).toEqual({ dari: "2026-10-01", sampai: "2026-10-02" });
  });
});

describe("bacaPilihanPeriode dan paramPeriode", () => {
  it("pilihan asing jatuh ke bawaan; bawaan tidak ditulis ke URL", () => {
    expect(bacaPilihanPeriode("tahunIni", "bulanIni")).toBe("bulanIni");
    expect(bacaPilihanPeriode("semua", "bulanIni")).toBe("semua");
    expect(paramPeriode("bulanIni", { dari: "2026-10-01", sampai: HARI_INI }, "bulanIni")).toEqual({});
    expect(paramPeriode("semua", null, "bulanIni")).toEqual({ periode: "semua" });
    expect(paramPeriode("rentang", { dari: "2026-10-01", sampai: "2026-10-03" }, "bulanIni")).toEqual({
      periode: "rentang",
      dari: "2026-10-01",
      sampai: "2026-10-03",
    });
  });
});
