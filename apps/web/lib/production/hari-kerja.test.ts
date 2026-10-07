import { describe, expect, it } from "vitest";
import {
  bacaHariKerjaProduksi,
  bacaTanggalMerah,
  HARI_KERJA_PRODUKSI_BAWAAN,
  hariKerjaKah,
  jumlahHariKerja,
  kalenderKerja,
  kurangiHariKerja,
  liburTetapTahun,
  tambahHariKerja,
} from "./hari-kerja";

// 2026-10-05 = Senin, 2026-10-09 = Jumat, 2026-10-10/11 = Sabtu/Minggu.
const SENIN_JUMAT = kalenderKerja(HARI_KERJA_PRODUKSI_BAWAAN, []);

describe("hari kerja produksi", () => {
  it("default is Monday–Friday, like the SSG program", () => {
    expect([...HARI_KERJA_PRODUKSI_BAWAAN]).toEqual([1, 2, 3, 4, 5]);
    expect(hariKerjaKah("2026-10-09", SENIN_JUMAT)).toBe(true);
    expect(hariKerjaKah("2026-10-10", SENIN_JUMAT)).toBe(false);
    expect(hariKerjaKah("2026-10-11", SENIN_JUMAT)).toBe(false);
  });

  it("adding working days does not count the start day and skips the weekend", () => {
    expect(tambahHariKerja("2026-10-05", 1, SENIN_JUMAT)).toBe("2026-10-06");
    expect(tambahHariKerja("2026-10-09", 1, SENIN_JUMAT)).toBe("2026-10-12");
    expect(tambahHariKerja("2026-10-05", 10, SENIN_JUMAT)).toBe("2026-10-19");
    expect(tambahHariKerja("2026-10-05", 0, SENIN_JUMAT)).toBe("2026-10-05");
  });

  it("a start on a weekend still counts only working days after it", () => {
    expect(tambahHariKerja("2026-10-10", 1, SENIN_JUMAT)).toBe("2026-10-12");
  });

  it("public holidays are skipped too", () => {
    const kal = kalenderKerja(HARI_KERJA_PRODUKSI_BAWAAN, [{ tanggal: "2026-10-06", nama: "Libur" }]);
    expect(hariKerjaKah("2026-10-06", kal)).toBe(false);
    expect(tambahHariKerja("2026-10-05", 1, kal)).toBe("2026-10-07");
  });

  it("subtracting is the exact reverse when the deadline is a working day", () => {
    expect(kurangiHariKerja("2026-10-19", 10, SENIN_JUMAT)).toBe("2026-10-05");
    expect(tambahHariKerja(kurangiHariKerja("2026-10-23", 7, SENIN_JUMAT), 7, SENIN_JUMAT)).toBe("2026-10-23");
  });

  it("counts working days in (from, to]", () => {
    expect(jumlahHariKerja("2026-10-05", "2026-10-12", SENIN_JUMAT)).toBe(5);
    expect(jumlahHariKerja("2026-10-05", "2026-10-05", SENIN_JUMAT)).toBe(0);
    expect(jumlahHariKerja("2026-10-12", "2026-10-05", SENIN_JUMAT)).toBe(-5);
  });

  it("a six-day week counts Saturday", () => {
    const enamHari = kalenderKerja([1, 2, 3, 4, 5, 6], []);
    expect(tambahHariKerja("2026-10-09", 1, enamHari)).toBe("2026-10-10");
  });

  it("reads settings defensively: empty or invalid working days fall back to the default", () => {
    expect(bacaHariKerjaProduksi(null)).toEqual([1, 2, 3, 4, 5]);
    expect(bacaHariKerjaProduksi({ hariKerja: [] })).toEqual([1, 2, 3, 4, 5]);
    expect(bacaHariKerjaProduksi({ hariKerja: [6, 1, 1, 9, "x"] })).toEqual([1, 6]);
    expect(bacaHariKerjaProduksi("[0,1,2]")).toEqual([0, 1, 2]);
  });

  it("reads public holidays, dropping bad dates and duplicates, sorted", () => {
    expect(
      bacaTanggalMerah([
        { tanggal: "2026-12-25", nama: "Natal" },
        { tanggal: "2026-08-17", nama: "Kemerdekaan" },
        { tanggal: "2026-08-17", nama: "dobel" },
        { tanggal: "17-08-2026", nama: "salah" },
        { tanggal: "2026-02-30", nama: "tidak ada" },
        "sampah",
      ]),
    ).toEqual([
      { tanggal: "2026-08-17", nama: "Kemerdekaan" },
      { tanggal: "2026-12-25", nama: "Natal" },
    ]);
    expect(bacaTanggalMerah(null)).toEqual([]);
  });

  it("offers the fixed-date national holidays of a year", () => {
    const daftar = liburTetapTahun(2027).map((l) => l.tanggal);
    expect(daftar).toEqual(["2027-01-01", "2027-05-01", "2027-06-01", "2027-08-17", "2027-12-25"]);
  });

  it("never loops forever, even if every day were a holiday", () => {
    const tanpaHariKerja = kalenderKerja([1], []);
    // Satu hari kerja per minggu tetap selesai.
    expect(tambahHariKerja("2026-10-05", 2, tanpaHariKerja)).toBe("2026-10-19");
  });
});
