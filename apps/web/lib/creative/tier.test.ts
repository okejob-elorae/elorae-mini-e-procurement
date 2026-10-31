import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SEMUA_TIER } from "./aturan";
import { AMBANG_TIER_BAWAAN, bacaAmbangTier, KUNCI_TIER, validasiAmbangTier } from "./tier";

describe("ambang tier — bawaan", () => {
  it("bawaan mengikuti konsep KOL Manager: mikro 10 rb, mid 100 rb, makro 500 rb, mega 1 jt", () => {
    expect(AMBANG_TIER_BAWAAN).toEqual({ mikro: 10_000, mid: 100_000, makro: 500_000, mega: 1_000_000 });
    expect(KUNCI_TIER).toBe("kreatif.tier");
  });
});

describe("bacaAmbangTier — pembaca pemaaf", () => {
  it("baris kosong, rusak, atau bukan objek jatuh ke bawaan", () => {
    expect(bacaAmbangTier(null)).toEqual(AMBANG_TIER_BAWAAN);
    expect(bacaAmbangTier("")).toEqual(AMBANG_TIER_BAWAAN);
    expect(bacaAmbangTier("{rusak")).toEqual(AMBANG_TIER_BAWAAN);
    expect(bacaAmbangTier("[1,2,3]")).toEqual(AMBANG_TIER_BAWAAN);
  });

  it("membaca teks JSON dan objek yang sah", () => {
    const sah = { mikro: 5_000, mid: 50_000, makro: 250_000, mega: 2_000_000 };
    expect(bacaAmbangTier(JSON.stringify(sah))).toEqual(sah);
    expect(bacaAmbangTier(sah)).toEqual(sah);
  });

  it("isi yang tidak naik berurutan jatuh SELURUHNYA ke bawaan, bukan dicampur", () => {
    // Mencampur satu angka simpanan dengan bawaan bisa menghasilkan urutan yang
    // tidak naik (mikro 200 rb > mid bawaan 100 rb) — tier jadi tak bermakna.
    expect(bacaAmbangTier({ mikro: 200_000, mid: 100_000, makro: 500_000, mega: 1_000_000 })).toEqual(AMBANG_TIER_BAWAAN);
    expect(bacaAmbangTier({ mikro: 10_000 })).toEqual(AMBANG_TIER_BAWAAN);
  });
});

describe("validasiAmbangTier — penyimpanan", () => {
  it("menerima bilangan bulat positif yang naik berurutan", () => {
    const r = validasiAmbangTier({ mikro: 1, mid: 2, makro: 3, mega: 4 });
    expect(r).toEqual({ ok: true, ambang: { mikro: 1, mid: 2, makro: 3, mega: 4 } });
  });

  it("menolak angka yang bukan bilangan bulat positif, per kunci", () => {
    const r = validasiAmbangTier({ mikro: 0, mid: 100_000.5, makro: "500000", mega: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.galat.map((g) => g.kunci).sort()).toEqual(["makro", "mega", "mid", "mikro"]);
      expect(r.galat.every((g) => g.sebab === "BUKAN_ANGKA")).toBe(true);
    }
  });

  it("menolak urutan yang tidak naik — sama dengan juga ditolak", () => {
    const sama = validasiAmbangTier({ mikro: 10_000, mid: 10_000, makro: 500_000, mega: 1_000_000 });
    expect(sama).toEqual({ ok: false, galat: [{ kunci: "mid", sebab: "TIDAK_NAIK" }] });
    const turun = validasiAmbangTier({ mikro: 10_000, mid: 100_000, makro: 2_000_000, mega: 1_000_000 });
    expect(turun).toEqual({ ok: false, galat: [{ kunci: "mega", sebab: "TIDAK_NAIK" }] });
  });

  it("kunci yang hilang ditolak, tidak diam-diam diganti bawaan", () => {
    const r = validasiAmbangTier({ mikro: 10_000, mid: 100_000, makro: 500_000 });
    expect(r).toEqual({ ok: false, galat: [{ kunci: "mega", sebab: "BUKAN_ANGKA" }] });
  });

  it("menolak masukan yang bukan objek", () => {
    expect(validasiAmbangTier(null).ok).toBe(false);
    expect(validasiAmbangTier("x").ok).toBe(false);
  });

  it("menolak angka di atas batas wajar (lebih dari 1 miliar)", () => {
    const r = validasiAmbangTier({ mikro: 10_000, mid: 100_000, makro: 500_000, mega: 2_000_000_000 });
    expect(r).toEqual({ ok: false, galat: [{ kunci: "mega", sebab: "BUKAN_ANGKA" }] });
  });
});

describe("label tier", () => {
  const pesan = (b: string) => JSON.parse(readFileSync(path.resolve(__dirname, `../i18n/messages/${b}.json`), "utf8"));
  it("setiap tier berlabel di kedua bahasa (layar memakai creative.tier_<tier>)", () => {
    for (const b of ["id", "en"]) {
      const c = pesan(b).creative as Record<string, string>;
      for (const t of SEMUA_TIER) expect(typeof c[`tier_${t}`], `${b}: tier_${t}`).toBe("string");
    }
  });
});
