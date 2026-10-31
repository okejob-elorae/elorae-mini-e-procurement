import { describe, expect, it } from "vitest";
import { batasPeriodeDicari, bacaPeriodeDicari } from "./periode";

const hariIni = "2026-10-08";

describe("periode Barang dicari pembeli", () => {
  it("rentang dari pemilih dipakai apa adanya; terbalik ditukar", () => {
    expect(bacaPeriodeDicari({ dari: "2026-09-01", sampai: "2026-09-30" }, hariIni)).toEqual({ dari: "2026-09-01", sampai: "2026-09-30" });
    expect(bacaPeriodeDicari({ dari: "2026-09-30", sampai: "2026-09-01" }, hariIni)).toEqual({ dari: "2026-09-01", sampai: "2026-09-30" });
  });

  it("alamat lama ?hari=7|30|90 = N hari terakhir termasuk hari ini", () => {
    expect(bacaPeriodeDicari({ hari: "7" }, hariIni)).toEqual({ dari: "2026-10-02", sampai: hariIni });
    expect(bacaPeriodeDicari({ hari: "90" }, hariIni)).toEqual({ dari: "2026-07-11", sampai: hariIni });
  });

  it("tanpa periode atau nilai tidak sah: 30 hari terakhir", () => {
    expect(bacaPeriodeDicari({}, hariIni)).toEqual({ dari: "2026-09-09", sampai: hariIni });
    expect(bacaPeriodeDicari({ hari: "14", dari: "2026-02-30", sampai: hariIni }, hariIni)).toEqual({ dari: "2026-09-09", sampai: hariIni });
  });

  it("batas kueri setengah terbuka pada tengah malam WIB", () => {
    const b = batasPeriodeDicari({ dari: "2026-10-01", sampai: "2026-10-08" });
    expect(b.sejak.toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(b.sebelum.toISOString()).toBe("2026-10-08T17:00:00.000Z");
  });
});
