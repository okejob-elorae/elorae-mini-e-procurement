import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bacaRateFormat, FORMAT_RATE, isiRateFormat, tulisRateFormat, validasiRateFormat } from "./rate-format";

describe("rate card per format — format yang dikenal", () => {
  it("kuncinya sama persis dengan enum ContentFormat Prisma", () => {
    expect(FORMAT_RATE).toEqual(["FEED", "REELS", "STORY", "VIDEO", "LIVE", "CAROUSEL"]);
  });
});

describe("bacaRateFormat — pembaca pemaaf untuk kolom teks", () => {
  it("kosong, rusak, atau bukan objek = tanpa tarif", () => {
    expect(bacaRateFormat(null)).toEqual({});
    expect(bacaRateFormat("")).toEqual({});
    expect(bacaRateFormat("{rusak")).toEqual({});
    expect(bacaRateFormat("[1,2]")).toEqual({});
  });

  it("membaca teks JSON; kunci tak dikenal dan angka tak sah dibuang satu per satu", () => {
    expect(bacaRateFormat('{"FEED":500000,"REELS":750000}')).toEqual({ FEED: 500_000, REELS: 750_000 });
    expect(bacaRateFormat({ FEED: 500_000, TWEET: 10, STORY: -5, LIVE: 1.5, VIDEO: "1000" })).toEqual({ FEED: 500_000 });
  });
});

describe("validasiRateFormat — isian formulir", () => {
  it("menerima rupiah bulat ≥ 0, nol berarti gratis (tetap tersimpan)", () => {
    expect(validasiRateFormat({ FEED: 500_000, STORY: 0 })).toEqual({ ok: true, rate: { FEED: 500_000, STORY: 0 } });
  });

  it("null/undefined per format = tidak diisi", () => {
    expect(validasiRateFormat({ FEED: null, REELS: undefined, LIVE: 2_000_000 })).toEqual({ ok: true, rate: { LIVE: 2_000_000 } });
    expect(validasiRateFormat({})).toEqual({ ok: true, rate: {} });
  });

  it("menolak pecahan, negatif, NaN, teks, dan kunci yang tidak dikenal — per format", () => {
    const r = validasiRateFormat({ FEED: 1.5, REELS: -1, STORY: Number.NaN, VIDEO: "1000", TWEET: 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.galat.sort()).toEqual(["FEED", "REELS", "STORY", "TWEET", "VIDEO"]);
  });

  it("menolak angka di atas batas Decimal(15,2) yang wajar", () => {
    const r = validasiRateFormat({ FEED: 10_000_000_000_000 });
    expect(r).toEqual({ ok: false, galat: ["FEED"] });
  });

  it("menolak masukan yang bukan objek", () => {
    expect(validasiRateFormat("x")).toEqual({ ok: false, galat: [] });
    expect(validasiRateFormat([1])).toEqual({ ok: false, galat: [] });
  });
});

describe("tulisRateFormat — bentuk simpan", () => {
  it("urutan kunci tetap (urutan FORMAT_RATE), apa pun urutan isian", () => {
    expect(tulisRateFormat({ LIVE: 3, FEED: 1 })).toBe('{"FEED":1,"LIVE":3}');
  });

  it("tanpa satu tarif pun = null (kolom dikosongkan)", () => {
    expect(tulisRateFormat({})).toBeNull();
  });

  it("bolak-balik baca/tulis sama", () => {
    const rate = { FEED: 500_000, CAROUSEL: 0 };
    expect(bacaRateFormat(tulisRateFormat(rate))).toEqual(rate);
  });
});

describe("isiRateFormat — daftar tampil", () => {
  it("hanya format yang diisi, dalam urutan FORMAT_RATE", () => {
    expect(isiRateFormat({ LIVE: 3, FEED: 1, STORY: 0 })).toEqual([
      { format: "FEED", rupiah: 1 },
      { format: "STORY", rupiah: 0 },
      { format: "LIVE", rupiah: 3 },
    ]);
  });
});

describe("label format", () => {
  it("setiap format berlabel di kedua bahasa (creative.format<FORMAT>)", () => {
    for (const b of ["id", "en"]) {
      const c = JSON.parse(readFileSync(path.resolve(__dirname, `../i18n/messages/${b}.json`), "utf8")).creative as Record<string, string>;
      for (const f of FORMAT_RATE) expect(typeof c[`format${f}`], `${b}: format${f}`).toBe("string");
    }
  });
});
