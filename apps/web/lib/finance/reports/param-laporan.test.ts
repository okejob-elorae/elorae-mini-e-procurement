import { describe, expect, it } from "vitest";
import { bacaJenisPerbandingan, bacaKelompok, bacaSaringKanal, bacaTahunBulan, bacaTampilkanNol, periodeBulanBerjalan } from "./param-laporan";

describe("periodeBulanBerjalan", () => {
  it("kosong = tanggal 1 bulan ini s.d. hari ini", () => {
    expect(periodeBulanBerjalan({}, "2026-10-08")).toEqual({ dari: "2026-10-01", sampai: "2026-10-08" });
  });

  it("hanya sampai = awal bulan tanggal itu", () => {
    expect(periodeBulanBerjalan({ sampai: "2026-09-30" }, "2026-10-08")).toEqual({ dari: "2026-09-01", sampai: "2026-09-30" });
  });

  it("terbalik ditukar; tanggal rusak diabaikan", () => {
    expect(periodeBulanBerjalan({ dari: "2026-09-30", sampai: "2026-09-01" }, "2026-10-08")).toEqual({
      dari: "2026-09-01",
      sampai: "2026-09-30",
    });
    expect(periodeBulanBerjalan({ dari: "2026-02-31", sampai: "x" }, "2026-10-08")).toEqual({ dari: "2026-10-01", sampai: "2026-10-08" });
  });
});

describe("pembaca parameter", () => {
  it("kelompok, kanal, jenis, nol", () => {
    expect(bacaKelompok("toko")).toBe("toko");
    expect(bacaKelompok("x")).toBe("kanal");
    expect(bacaSaringKanal("SHOPEE")).toBe("SHOPEE");
    expect(bacaSaringKanal("shopee")).toBeNull();
    expect(bacaJenisPerbandingan("neraca")).toBe("neraca");
    expect(bacaJenisPerbandingan(undefined)).toBe("laba-rugi");
    expect(bacaTampilkanNol("1")).toBe(true);
    expect(bacaTampilkanNol("0")).toBe(false);
  });

  it("tahun/bulan anggaran", () => {
    expect(bacaTahunBulan({}, "2026-10-08")).toEqual({ tahun: 2026, bulan: 10, cakupan: "ytd" });
    expect(bacaTahunBulan({ tahun: "2027", bulan: "3", cakupan: "bulan" }, "2026-10-08")).toEqual({ tahun: 2027, bulan: 3, cakupan: "bulan" });
    expect(bacaTahunBulan({ tahun: "1500", bulan: "13" }, "2026-10-08")).toEqual({ tahun: 2026, bulan: 10, cakupan: "ytd" });
  });
});
