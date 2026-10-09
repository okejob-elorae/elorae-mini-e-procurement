import { describe, expect, it } from "vitest";
import {
  BAWAAN_GRAFIK,
  PALET_PILIHAN,
  SLOT_GRAFIK,
  bacaWarnaGrafik,
  namaVarSlot,
  normalHex,
  tulisWarnaGrafik,
  varCssGrafik,
  warnaSlot,
} from "./warna-pilihan";

describe("normalHex", () => {
  it("menerima 6 digit hex dengan atau tanpa #, huruf apa pun → #rrggbb kecil", () => {
    expect(normalHex("#AbC123")).toBe("#abc123");
    expect(normalHex(" abc123 ")).toBe("#abc123");
  });
  it("selain itu null — tidak menebak", () => {
    for (const x of ["#abc", "red", "#abcdeg", "", null, undefined, 123, "#abc1234"]) expect(normalHex(x)).toBeNull();
  });
});

describe("palet dan slot", () => {
  it("palet pilihan semuanya hex sah dan tidak kembar", () => {
    expect(PALET_PILIHAN.every((h) => normalHex(h) === h)).toBe(true);
    expect(new Set(PALET_PILIHAN).size).toBe(PALET_PILIHAN.length);
  });
  it("setiap slot punya warna bawaan; slot tanpa pilihan jatuh ke bawaan lewat var()", () => {
    for (const { kunci } of SLOT_GRAFIK) expect(BAWAAN_GRAFIK[kunci]).toMatch(/^var\(--/);
    expect(namaVarSlot("umur.h1_30")).toBe("--warna-umur-h1_30");
    expect(warnaSlot("tren.shopee")).toBe("var(--warna-tren-shopee, var(--viz-2))");
  });
});

describe("baca/tulis User.chartColors", () => {
  it("JSON teks atau objek → hanya slot dikenal dengan hex sah", () => {
    expect(bacaWarnaGrafik('{"umur.lebih60":"#DC2626","umur.x":"#000000","stok.jadi":"merah"}')).toEqual({ "umur.lebih60": "#dc2626" });
    expect(bacaWarnaGrafik({ "tren.van": "16a34a" })).toEqual({ "tren.van": "#16a34a" });
    for (const x of [null, undefined, "", "bukan json", "[1]", 7]) expect(bacaWarnaGrafik(x)).toEqual({});
  });
  it("tulis berurutan slot; kosong → null (ikut bawaan)", () => {
    expect(tulisWarnaGrafik({ "stok.jadi": "#a8a29e", "umur.belum": "#57534e" })).toBe('{"umur.belum":"#57534e","stok.jadi":"#a8a29e"}');
    expect(tulisWarnaGrafik({})).toBeNull();
    expect(tulisWarnaGrafik({ "umur.belum": "bukan" } as never)).toBeNull();
  });
  it("custom property hanya untuk slot yang dipilih", () => {
    expect(varCssGrafik({ "umur.h31_60": "#ea580c" })).toEqual({ "--warna-umur-h31_60": "#ea580c" });
  });
});
