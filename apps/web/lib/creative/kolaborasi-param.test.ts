import { describe, expect, it } from "vitest";
import { alamatKolaborasi, bacaParamKolaborasi, PARAM_KOLABORASI_AWAL } from "./kolaborasi-param";

describe("bacaParamKolaborasi / alamatKolaborasi", () => {
  it("alamat kosong = keadaan awal, dan keadaan awal = alamat tanpa parameter", () => {
    expect(bacaParamKolaborasi({})).toEqual(PARAM_KOLABORASI_AWAL);
    expect(alamatKolaborasi(PARAM_KOLABORASI_AWAL)).toBe("/backoffice/kreatif/kolaborasi");
  });

  it("membaca semua saringan dan menuliskannya kembali tanpa kehilangan apa pun", () => {
    const p = bacaParamKolaborasi({
      tahap: "deal",
      campaign: "c1",
      platform: "tiktok",
      pic: "u1",
      cari: " @ayu ",
      tampilan: "papan",
      halaman: "3",
    });
    expect(p).toEqual({ tahap: "DEAL", campaign: "c1", platform: "TIKTOK", pic: "u1", cari: "@ayu", tampilan: "papan", halaman: 3 });
    expect(bacaParamKolaborasi(Object.fromEntries(new URL(`http://x${alamatKolaborasi(p)}`).searchParams))).toEqual(p);
  });

  it("nilai yang tidak dikenal jatuh ke bawaan; KELUAR adalah chip sendiri", () => {
    expect(bacaParamKolaborasi({ tahap: "MANA", platform: "FB", tampilan: "galeri", halaman: "-2" })).toEqual(PARAM_KOLABORASI_AWAL);
    expect(bacaParamKolaborasi({ tahap: "keluar" }).tahap).toBe("KELUAR");
    expect(bacaParamKolaborasi({ tahap: ["NEGO", "DEAL"] }).tahap).toBe("NEGO");
  });
});
