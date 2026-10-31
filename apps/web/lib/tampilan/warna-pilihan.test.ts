import { describe, expect, it } from "vitest";
import {
  BAWAAN_GRAFIK,
  RONA_PANTONE,
  SLOT_GRAFIK,
  bacaPermintaanWarnaGrafik,
  bacaWarnaGrafik,
  bacaWarnaPantone,
  contohSpektrum,
  namaVarSlot,
  normalHex,
  normalTcx,
  tulisWarnaGrafik,
  urutRona,
  varCssGrafik,
  warnaSlot,
} from "./warna-pilihan";

const CLASSIC_BLUE = { tcx: "19-4052", nama: "Classic Blue", hex: "#0f4c81" };

describe("normalHex / normalTcx", () => {
  it("hex 6 digit dengan atau tanpa # → #rrggbb kecil; selain itu null", () => {
    expect(normalHex("#AbC123")).toBe("#abc123");
    expect(normalHex(" abc123 ")).toBe("#abc123");
    for (const x of ["#abc", "red", "", null, 123]) expect(normalHex(x)).toBeNull();
  });
  it("kode TCX dengan atau tanpa akhiran TCX → bentuk katalog; selain itu null", () => {
    expect(normalTcx("19-4052")).toBe("19-4052");
    expect(normalTcx(" 19-4052 TCX ")).toBe("19-4052");
    for (const x of ["194052", "19-405", "Classic Blue", "", null, 7]) expect(normalTcx(x)).toBeNull();
  });
});

describe("slot dan rona", () => {
  it("setiap slot punya bawaan; slot tanpa pilihan jatuh ke bawaan lewat var()", () => {
    for (const { kunci } of SLOT_GRAFIK) expect(BAWAAN_GRAFIK[kunci]).toMatch(/^var\(--/);
    expect(namaVarSlot("umur.h1_30")).toBe("--warna-umur-h1_30");
    expect(warnaSlot("tren.shopee")).toBe("var(--warna-tren-shopee, var(--viz-2))");
  });
  it("saringan rona memakai tag hue katalog yang ada", () => {
    expect(RONA_PANTONE.map((r) => r.tag)).toEqual(
      expect.arrayContaining(["Red", "Blue", "Teal/Cyan", "Gray", "Black", "White"]),
    );
    expect(new Set(RONA_PANTONE.map((r) => r.kunci)).size).toBe(RONA_PANTONE.length);
  });
});

describe("baca/tulis User.chartColors", () => {
  it("hanya slot dikenal dengan kode Pantone + hex sah", () => {
    const json = JSON.stringify({ "umur.lebih60": CLASSIC_BLUE, "umur.x": CLASSIC_BLUE, "stok.jadi": "#a8a29e", "tren.van": { tcx: "salah", hex: "#000000" } });
    expect(bacaWarnaGrafik(json)).toEqual({ "umur.lebih60": CLASSIC_BLUE });
    for (const x of [null, undefined, "", "bukan json", "[1]", 7]) expect(bacaWarnaGrafik(x)).toEqual({});
    expect(bacaWarnaPantone({ tcx: "19-4052 TCX", hex: "0F4C81" })).toEqual({ tcx: "19-4052", hex: "#0f4c81", nama: "" });
  });
  it("tulis berurutan slot; kosong → null (ikut bawaan); var CSS memakai hex", () => {
    const tulis = tulisWarnaGrafik({ "stok.jadi": CLASSIC_BLUE, "umur.belum": CLASSIC_BLUE });
    expect(Object.keys(JSON.parse(tulis!))).toEqual(["umur.belum", "stok.jadi"]);
    expect(tulisWarnaGrafik({})).toBeNull();
    expect(varCssGrafik({ "umur.h31_60": CLASSIC_BLUE })).toEqual({ "--warna-umur-h31_60": "#0f4c81" });
  });
  it("permintaan simpan dari layar hanya membawa kode TCX per slot", () => {
    expect(bacaPermintaanWarnaGrafik({ "umur.belum": "19-4052 TCX", "umur.x": "19-4052", "stok.bahan": "#ff0000" })).toEqual({ "umur.belum": "19-4052" });
    expect(bacaPermintaanWarnaGrafik(null)).toEqual({});
  });
});

describe("contohSpektrum", () => {
  const baris = (tcx: string, rona: string[], L: number | null, C: number | null, hex = "#808080") => ({ tcx, nama: tcx, hex, rona, L, C });

  it("satu baris per rona berurutan RONA_PANTONE, terang ke gelap, hanya yang berkroma ≥ median", () => {
    const data = [
      baris("19-1664", ["Red"], 40, 60),
      baris("11-1305", ["Red"], 90, 5),
      baris("14-1660", ["Red"], 65, 70),
      baris("17-1563", ["Red"], 50, 65),
      baris("19-4052", ["Blue"], 32, 40),
    ];
    const hasil = contohSpektrum(data, 8);
    expect(hasil.map((h) => h.kunci)).toEqual(["merah", "biru"]);
    // median kroma merah = 60 → 11-1305 (C 5) tersaring; urut L turun.
    expect(hasil[0].warna.map((w) => w.tcx)).toEqual(["14-1660", "17-1563", "19-1664"]);
  });

  it("menyebar rata bila calon lebih banyak dari perRona, dan satu warna tidak muncul dua kali", () => {
    const abu = Array.from({ length: 9 }, (_, i) => baris(`1${i}-0000`, ["Gray", "Black"], 90 - i * 10, 1));
    const hasil = contohSpektrum(abu, 3);
    expect(hasil.find((h) => h.kunci === "abu")!.warna.map((w) => w.tcx)).toEqual(["10-0000", "14-0000", "18-0000"]);
    const hitam = hasil.find((h) => h.kunci === "hitam")!.warna.map((w) => w.tcx);
    expect(hitam.some((t) => ["10-0000", "14-0000", "18-0000"].includes(t))).toBe(false);
  });

  it("L kosong diperkirakan dari hex; hex tidak sah dilewati", () => {
    const hasil = contohSpektrum(
      [baris("11-0000", ["White"], null, null, "#ffffff"), baris("19-0000", ["White"], null, null, "#111111"), baris("12-0000", ["White"], 80, 0, "bukan")],
      8,
    );
    expect(hasil[0].warna.map((w) => w.tcx)).toEqual(["11-0000", "19-0000"]);
  });
});

describe("urutRona", () => {
  const baris = (tcx: string, rona: string[], L: number, C: number) => ({ tcx, nama: tcx, hex: "#808080", rona, L, C });

  it("kroma tertinggi dulu per halaman, dan di dalam halaman terang ke gelap; rona lain tidak ikut", () => {
    const data = [
      baris("11-1305", ["Red"], 92, 4),
      baris("19-1664", ["Red"], 40, 60),
      baris("14-1660", ["Red"], 65, 70),
      baris("17-1563", ["Red"], 50, 65),
      baris("19-4052", ["Blue"], 32, 40),
    ];
    // Halaman 1 = dua warna terjenuh (70, 65) → urut L: 14-1660 (65), 17-1563 (50); halaman 2 = 60 lalu 4.
    expect(urutRona(data, "Red", 2).map((w) => w.tcx)).toEqual(["14-1660", "17-1563", "11-1305", "19-1664"]);
  });
});
