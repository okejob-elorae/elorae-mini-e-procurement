import { describe, expect, it } from "vitest";
import { periodeTertutupSejak, tanggalJurnalSaldoAwal } from "./tanggal";

describe("tanggalJurnalSaldoAwal", () => {
  it("sehari sebelum tanggal mulai, lintas bulan dan tahun", () => {
    expect(tanggalJurnalSaldoAwal("2026-08-01")).toBe("2026-07-31");
    expect(tanggalJurnalSaldoAwal("2027-01-01")).toBe("2026-12-31");
    expect(tanggalJurnalSaldoAwal("2028-03-01")).toBe("2028-02-29");
  });
});

describe("periodeTertutupSejak", () => {
  it("bebas bila tidak ada periode tertutup sejak bulan itu", () => {
    expect(periodeTertutupSejak("2026-07-31", [{ year: 2026, month: 6, status: "CLOSED" }])).toBeNull();
    expect(periodeTertutupSejak("2026-07-31", [{ year: 2026, month: 7, status: "OPEN" }])).toBeNull();
  });

  it("bulan jurnal itu sendiri atau bulan sesudahnya yang ditutup menolak (saldo awal mengalir ke neraca berikutnya)", () => {
    expect(periodeTertutupSejak("2026-07-31", [{ year: 2026, month: 7, status: "CLOSED" }])).toEqual({ tahun: 2026, bulan: 7 });
    expect(
      periodeTertutupSejak("2026-07-31", [
        { year: 2026, month: 9, status: "CLOSED" },
        { year: 2026, month: 8, status: "CLOSED" },
      ]),
    ).toEqual({ tahun: 2026, bulan: 8 });
  });

  it("tahun yang ditutup menutup seluruh bulannya", () => {
    expect(periodeTertutupSejak("2026-07-31", [], [{ year: 2026, status: "CLOSED" }])).toEqual({ tahun: 2026, bulan: null });
    expect(periodeTertutupSejak("2026-07-31", [], [{ year: 2025, status: "CLOSED" }])).toBeNull();
    expect(periodeTertutupSejak("2026-12-31", [], [{ year: 2027, status: "CLOSED" }])).toEqual({ tahun: 2027, bulan: null });
    expect(periodeTertutupSejak("2026-07-31", [], [{ year: 2026, status: "OPEN" }])).toBeNull();
  });
});
