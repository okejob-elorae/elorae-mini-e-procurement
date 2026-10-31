import { describe, expect, it } from "vitest";
import { alamatBrand, bacaParamBrand, RUTE_BRAND } from "./brand-param";

describe("bacaParamBrand / alamatBrand", () => {
  it("bawaan: semua, halaman 1, tanpa brand", () => {
    expect(bacaParamBrand({})).toEqual({ cari: "", saring: "semua", halaman: 1, brand: null });
    expect(alamatBrand(bacaParamBrand({}))).toBe(RUTE_BRAND);
  });

  it("isian sah dibaca; brand dirapikan; yang aneh jatuh ke bawaan", () => {
    expect(bacaParamBrand({ cari: "  toko ", saring: "kompetitor", halaman: "3", brand: "@Toko.Lain" })).toEqual({
      cari: "toko",
      saring: "kompetitor",
      halaman: 3,
      brand: "toko.lain",
    });
    expect(bacaParamBrand({ saring: "lain", halaman: "-2", brand: "dua kata" })).toEqual({ cari: "", saring: "semua", halaman: 1, brand: null });
  });

  it("alamat bolak-balik", () => {
    const p = { cari: "a b", saring: "elorae" as const, halaman: 2, brand: "x.y" };
    expect(bacaParamBrand(Object.fromEntries(new URL(`http://h${alamatBrand(p)}`).searchParams))).toEqual(p);
  });
});
