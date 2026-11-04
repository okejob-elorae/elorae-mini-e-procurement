import { describe, expect, it } from "vitest";
import {
  BATAS_HARI_BAWAAN,
  bacaBatasHari,
  bacaTargetBulan,
  bacaTokoTerkunci,
  bulanWib,
  tulisTargetBulan,
} from "./pengaturan";

describe("bacaBatasHari", () => {
  it("reads the owner's chosen number of days", () => {
    expect(bacaBatasHari("21")).toEqual({ hari: 21, diatur: true });
  });

  it("falls back to the default, and says so, when unset or unusable", () => {
    for (const v of [null, "", "abc", "0", "-3", "400"]) {
      expect(bacaBatasHari(v)).toEqual({ hari: BATAS_HARI_BAWAAN, diatur: false });
    }
  });
});

describe("target per salesman per month", () => {
  it("reads one salesman's target for one month", () => {
    const v = JSON.stringify({ u1: { "2026-09": 50_000_000 }, u2: { "2026-09": 30_000_000 } });
    expect(bacaTargetBulan(v, "u1", "2026-09")).toBe(50_000_000);
    expect(bacaTargetBulan(v, "u1", "2026-10")).toBeNull();
    expect(bacaTargetBulan(v, "u3", "2026-09")).toBeNull();
  });

  it("treats a malformed setting as no targets rather than crashing the home screen", () => {
    expect(bacaTargetBulan("bukan json", "u1", "2026-09")).toBeNull();
    expect(bacaTargetBulan(JSON.stringify({ u1: { "2026-09": "banyak" } }), "u1", "2026-09")).toBeNull();
  });

  it("writes a target without disturbing other salesmen or months, and clears with null", () => {
    const awal = JSON.stringify({ u1: { "2026-08": 40_000_000 }, u2: { "2026-09": 30_000_000 } });
    const setelah = JSON.parse(tulisTargetBulan(awal, "u1", "2026-09", 50_000_000));
    expect(setelah).toEqual({ u1: { "2026-08": 40_000_000, "2026-09": 50_000_000 }, u2: { "2026-09": 30_000_000 } });
    expect(JSON.parse(tulisTargetBulan(JSON.stringify(setelah), "u2", "2026-09", null))).toEqual({
      u1: { "2026-08": 40_000_000, "2026-09": 50_000_000 },
    });
  });

  it("names the month by the Jakarta calendar", () => {
    expect(bulanWib(new Date("2026-09-30T17:30:00Z"))).toBe("2026-10"); // 00:30 WIB 1 Okt
  });
});

describe("own-stores-only lock", () => {
  it("is on only when explicitly switched on", () => {
    expect(bacaTokoTerkunci("1")).toBe(true);
  });

  it("stays off when unset or holding anything else — locking salesmen out is the costly mistake", () => {
    for (const v of [null, undefined, "", "0", "true", "ya"]) expect(bacaTokoTerkunci(v)).toBe(false);
  });
});
