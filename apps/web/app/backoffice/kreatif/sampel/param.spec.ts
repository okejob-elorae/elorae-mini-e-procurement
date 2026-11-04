import { describe, expect, it } from "vitest";
import { alamatSampel, bacaParamSampel } from "./param";

describe("param layar Sampel", () => {
  it("nilai rusak jatuh ke bawaan", () => {
    expect(bacaParamSampel({ tab: "x", halaman: "-3", cari: "  ", campaign: "" })).toEqual({
      tab: "perlu-dikirim",
      cari: "",
      campaign: null,
      kolaborasi: null,
      halaman: 1,
    });
  });

  it("bolak-balik alamat ↔ param tanpa menulis nilai bawaan", () => {
    const p = bacaParamSampel({ tab: "dalam-perjalanan", cari: " jne ", campaign: "c1", kolaborasi: "k9", halaman: "3" });
    expect(p).toEqual({ tab: "dalam-perjalanan", cari: "jne", campaign: "c1", kolaborasi: "k9", halaman: 3 });
    expect(alamatSampel(p)).toBe("/backoffice/kreatif/sampel?tab=dalam-perjalanan&cari=jne&campaign=c1&kolaborasi=k9&halaman=3");
    expect(alamatSampel({ tab: "perlu-dikirim", cari: "", campaign: null, kolaborasi: null, halaman: 1 })).toBe("/backoffice/kreatif/sampel");
  });

  it("tautan Hari ini (?tab=…&kolaborasi=…) terbaca", () => {
    expect(bacaParamSampel({ tab: "perlu-dikirim", kolaborasi: "c1" })).toMatchObject({ tab: "perlu-dikirim", kolaborasi: "c1" });
  });

  it("nilai berulang memakai yang pertama", () => {
    expect(bacaParamSampel({ tab: ["sudah-sampai", "perlu-dikirim"] }).tab).toBe("sudah-sampai");
  });
});
