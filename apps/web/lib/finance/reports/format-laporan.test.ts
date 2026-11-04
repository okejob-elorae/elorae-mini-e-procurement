import { describe, expect, it } from "vitest";
import { persenLaporan, rasioLaporan, rupiahLaporan, selisihPersen } from "./format-laporan";

const NBSP = "\u00a0";

describe("rupiahLaporan", () => {
  it("menulis angka positif seperti rupiah biasa", () => {
    expect(rupiahLaporan(350000)).toBe(`Rp${NBSP}350.000`);
  });

  it("menulis angka negatif dalam kurung, satu format untuk semua laporan keuangan", () => {
    expect(rupiahLaporan(-350000)).toBe(`(Rp${NBSP}350.000)`);
    expect(rupiahLaporan(-11947300.4)).toBe(`(Rp${NBSP}11.947.300)`);
  });

  it("nol dan pecahan sen yang membulat ke nol tidak pernah bertanda", () => {
    expect(rupiahLaporan(0)).toBe(`Rp${NBSP}0`);
    expect(rupiahLaporan(-0.4)).toBe(`Rp${NBSP}0`);
    expect(rupiahLaporan(Number.NaN)).toBe(`Rp${NBSP}0`);
  });
});

describe("persenLaporan", () => {
  it("satu desimal dengan koma, negatif dalam kurung", () => {
    expect(persenLaporan(12.345)).toBe("12,3%");
    expect(persenLaporan(-4)).toBe("(4,0%)");
  });

  it("null atau tak terhingga ditulis tanda pisah", () => {
    expect(persenLaporan(null)).toBe("—");
    expect(persenLaporan(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("rasioLaporan", () => {
  it("dua desimal dengan akhiran ×", () => {
    expect(rasioLaporan(1.5)).toBe("1,50×");
    expect(rasioLaporan(null)).toBe("—");
  });
});

describe("selisihPersen", () => {
  it("selisih dalam sen dan persen terhadap besaran pembanding", () => {
    expect(selisihPersen(150, 100)).toEqual({ selisih: 50, persen: 50 });
    expect(selisihPersen(50, 100)).toEqual({ selisih: -50, persen: -50 });
  });

  it("pembanding negatif: persen dihitung terhadap besarannya, jadi membaik tetap positif", () => {
    // Rugi 100 menjadi rugi 50: naik 50, membaik 50%.
    expect(selisihPersen(-50, -100)).toEqual({ selisih: 50, persen: 50 });
  });

  it("pembanding nol tidak punya persen", () => {
    expect(selisihPersen(10, 0)).toEqual({ selisih: 10, persen: null });
    expect(selisihPersen(0, 0)).toEqual({ selisih: 0, persen: null });
  });

  it("tidak meninggalkan sisa pecahan floating point", () => {
    expect(selisihPersen(0.3, 0.1).selisih).toBe(0.2);
  });
});
