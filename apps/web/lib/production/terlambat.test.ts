import { describe, expect, it } from "vitest";
import { hariTerlambatWo, whereWoTerlambat } from "./terlambat";

// 6 Okt 2026, 08.00 WIB (01.00 UTC).
const SEKARANG = new Date("2026-10-06T01:00:00Z");

describe("hariTerlambatWo", () => {
  it("target 10 Sep 2026, sedang diproduksi → terlambat 26 hari (disimpan tengah malam UTC atau WIB sama saja)", () => {
    expect(hariTerlambatWo("2026-09-10T00:00:00Z", "IN_PRODUCTION", SEKARANG)).toBe(26);
    expect(hariTerlambatWo("2026-09-09T17:00:00Z", "IN_PRODUCTION", SEKARANG)).toBe(26);
    expect(hariTerlambatWo(new Date("2026-08-30T00:00:00Z"), "PARTIAL", SEKARANG)).toBe(37);
  });

  it("target hari ini atau nanti → tidak terlambat", () => {
    expect(hariTerlambatWo("2026-10-06T00:00:00Z", "ISSUED", SEKARANG)).toBeNull();
    expect(hariTerlambatWo("2026-10-05T17:00:00Z", "ISSUED", SEKARANG)).toBeNull();
    expect(hariTerlambatWo("2026-10-20T00:00:00Z", "ISSUED", SEKARANG)).toBeNull();
  });

  it("kemarin → 1 hari; draf, selesai, batal, tanpa target → tidak pernah terlambat", () => {
    expect(hariTerlambatWo("2026-10-05T00:00:00Z", "ISSUED", SEKARANG)).toBe(1);
    for (const status of ["DRAFT", "COMPLETED", "CANCELLED"]) {
      expect(hariTerlambatWo("2026-09-10T00:00:00Z", status, SEKARANG)).toBeNull();
    }
    expect(hariTerlambatWo(null, "ISSUED", SEKARANG)).toBeNull();
  });
});

it("whereWoTerlambat: status aktif, target sebelum 00.00 WIB hari ini", () => {
  expect(whereWoTerlambat(SEKARANG)).toEqual({
    status: { in: ["ISSUED", "IN_PRODUCTION", "PARTIAL"] },
    targetDate: { lt: new Date("2026-10-05T17:00:00Z") },
  });
});
