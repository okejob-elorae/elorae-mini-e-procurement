import { describe, expect, it } from "vitest";
import {
  BINGKAI_UJI_MUTU,
  campurHex,
  DURASI_HAUS_MS,
  fase,
  HURUF_TERANG,
  jarakKamera,
  kecerahan,
  LEWATI_KE_MS,
  MAKS_LANGKAH_MS,
  MAKS_TERTINGGAL_MS,
  majuWaktu,
  pelan,
  keputusanMutu,
  rasioKontras,
  rgbKeHex,
  uraiHex,
  WAKTU,
  warnaHurufTema,
  warnaRuang,
} from "./haus-elorae";

describe("lini waktu", () => {
  it("runs at least ten seconds and keeps its acts in order", () => {
    expect(DURASI_HAUS_MS).toBeGreaterThanOrEqual(10_000);
    expect(WAKTU.susun[0]).toBeGreaterThan(WAKTU.hurufMuncul);
    expect(WAKTU.buka).toBeGreaterThan(WAKTU.susun[1]);
    expect(WAKTU.buka).toBeLessThan(WAKTU.putih[0]);
    expect(WAKTU.app[1]).toBe(DURASI_HAUS_MS);
  });

  it("clamps phase progress to 0–1", () => {
    expect(fase(0, 100, 200)).toBe(0);
    expect(fase(150, 100, 200)).toBeCloseTo(0.5);
    expect(fase(999, 100, 200)).toBe(1);
  });

  it("eases from 0 to 1", () => {
    for (const f of Object.values(pelan)) {
      expect(f(0)).toBeCloseTo(0);
      expect(f(1)).toBeCloseTo(1);
    }
  });
});

describe("warna", () => {
  it("parses and mixes hex colors", () => {
    expect(uraiHex("#c8f04a")).toEqual([200, 240, 74]);
    expect(uraiHex("oklch(0.9 0.1 120)")).toBeNull();
    expect(campurHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(campurHex("#000000", "bukan-warna", 0.5)).toBe("#000000");
  });

  it("reads rgb() strings from the browser", () => {
    expect(rgbKeHex("rgb(12, 34, 56)")).toBe("#0c2238");
    expect(rgbKeHex("rgba(255,255,255,0.5)")).toBe("#ffffff");
    expect(rgbKeHex("transparent")).toBeNull();
  });

  it("measures brightness", () => {
    expect(kecerahan("#ffffff")).toBeCloseTo(1);
    expect(kecerahan("#000000")).toBeCloseTo(0);
  });

  it("builds a pale gallery for a light dashboard and a dark one for a dark dashboard", () => {
    const terang = warnaRuang({ latar: "#ffffff", teks: "#0f172a", redup: "#475569", utama: "#c8f04a" });
    const gelap = warnaRuang({ latar: "#0b0b0d", teks: "#f1f5f9", redup: "#94a3b8", utama: "#c8f04a" });
    expect(terang.gelap).toBe(false);
    expect(gelap.gelap).toBe(true);
    expect(kecerahan(terang.dinding)).toBeGreaterThan(0.5);
    expect(kecerahan(gelap.dinding)).toBeLessThan(0.1);
    // Wordmark: hitam di tema terang, warna tema di tema gelap — selalu terbaca.
    expect(terang.huruf).toBe(HURUF_TERANG);
    expect(gelap.huruf).toBe("#c8f04a");
    expect(rasioKontras(terang.huruf, terang.dinding)).toBeGreaterThanOrEqual(3);
    expect(rasioKontras(gelap.huruf, gelap.dinding)).toBeGreaterThanOrEqual(3);
    // Satu cincin memakai warna utama tema.
    expect(terang.cincinAksen).toBe("#c8f04a");
  });

  it("tints the walls toward the theme color", () => {
    const pink = warnaRuang({ latar: "#ffffff", teks: "#111111", redup: "#555555", utama: "#ff4fa3" });
    const biru = warnaRuang({ latar: "#ffffff", teks: "#111111", redup: "#555555", utama: "#2d5bff" });
    expect(pink.dinding).not.toBe(biru.dinding);
  });
});

describe("kamera", () => {
  it("moves back on a portrait phone so the name still fits", () => {
    expect(jarakKamera(4, 32, 0.46)).toBeGreaterThan(jarakKamera(4, 32, 1.6));
    expect(jarakKamera(1, 32, 3)).toBe(6.2);
  });
});

describe("warna wordmark", () => {
  it("is black on a light theme, whatever the theme color", () => {
    expect(warnaHurufTema("#c8f04a", "#e9ead9", false)).toBe(HURUF_TERANG);
    expect(warnaHurufTema("#1d4ed8", "#eeeeee", false)).toBe(HURUF_TERANG);
    expect(rasioKontras(HURUF_TERANG, "#e9ead9")).toBeGreaterThanOrEqual(3);
  });

  it("is the theme color on a dark theme", () => {
    expect(warnaHurufTema("#c8f04a", "#141414", true)).toBe("#c8f04a");
  });

  it("lightens a too-dark theme color on a dark wall, keeping it readable", () => {
    const h = warnaHurufTema("#1e293b", "#121214", true);
    expect(h).not.toBe("#1e293b");
    expect(rasioKontras(h, "#121214")).toBeGreaterThanOrEqual(3);
  });
});

describe("waktu pertunjukan sesudah bingkai macet", () => {
  const maju = (tm: number, dt: number, nyata: number, lewati = false) => majuWaktu({ tm, dt, nyata, lewati });

  it("bingkai biasa maju sebesar jarak bingkainya", () => {
    expect(maju(1000, 16.7, 1016.7)).toBeCloseTo(1016.7);
  });

  it("macet satu detik tidak melompati babak: maju paling banyak satu langkah", () => {
    expect(maju(3000, 1000, 4000)).toBe(3000 + MAKS_LANGKAH_MS);
  });

  it("tidak pernah tertinggal dari jam dinding lebih dari batasnya", () => {
    expect(maju(2000, 1000, 9000)).toBe(9000 - MAKS_TERTINGGAL_MS);
  });

  it("sesudah Lewati berjalan 1,25× lebih cepat", () => {
    expect(maju(LEWATI_KE_MS, 16, LEWATI_KE_MS, true)).toBeCloseTo(LEWATI_KE_MS + 20);
  });

  it("tidak pernah melewati akhir dan tidak mundur oleh jam yang mundur", () => {
    expect(maju(DURASI_HAUS_MS - 5, 40, DURASI_HAUS_MS + 50_000)).toBe(DURASI_HAUS_MS);
    expect(maju(500, -30, 400)).toBe(500);
  });
});

describe("turunkan mutu gambar di perangkat lambat", () => {
  const ulang = (ms: number, n: number) => Array.from({ length: n }, () => ms);

  it("belum memutuskan sebelum cukup bingkai", () => {
    expect(keputusanMutu(ulang(40, BINGKAI_UJI_MUTU - 1))).toBe("BELUM");
  });

  it("60 dan 45 bingkai per detik tetap mutu penuh; di bawah ±40 bingkai per detik diturunkan", () => {
    expect(keputusanMutu(ulang(16.7, BINGKAI_UJI_MUTU))).toBe("PENUH");
    expect(keputusanMutu(ulang(22, BINGKAI_UJI_MUTU))).toBe("PENUH");
    expect(keputusanMutu(ulang(30, BINGKAI_UJI_MUTU))).toBe("TURUNKAN");
  });

  it("satu-dua macet tidak menurunkan mutu, dan jeda tab tersembunyi tidak dihitung", () => {
    expect(keputusanMutu([...ulang(16.7, BINGKAI_UJI_MUTU - 2), 400, 1000])).toBe("BELUM");
    expect(keputusanMutu([...ulang(16.7, BINGKAI_UJI_MUTU), ...ulang(1000, 30)])).toBe("PENUH");
  });
});
