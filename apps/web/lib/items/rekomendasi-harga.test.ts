import { describe, expect, it } from "vitest";
import {
  aturanDariKolom,
  aturanHargaSah,
  bacaAngkaOpsional,
  formatPersenSatuDesimal,
  formatRupiahSen,
  hargaRekomendasi,
  marginDariMarkup,
  markupDariMargin,
  rekomendasiHargaJual,
  type AturanHarga,
  type MasukanRekomendasi,
} from "./rekomendasi-harga";

/*
 * Rekomendasi harga jual: hanya saran; harga akhir diketik sendiri (keputusan pemilik 2026-11-01).
 * Satu aturan per barang, diisi sebagai markup ATAU margin (P4), bantalan margin di atasnya (Q5).
 */

const markup = (persen: number): AturanHarga => ({ dasar: "MARKUP", persen });
const margin = (persen: number): AturanHarga => ({ dasar: "MARGIN", persen });

const dasar = (lain: Partial<MasukanRekomendasi> = {}): MasukanRekomendasi => ({
  hppTerbaru: { perPcs: 50_000, dokumen: "RCPT/2026/0001", tanggal: "2026-10-01T03:00:00.000Z" },
  aturanBarang: markup(40),
  biayaBarang: 2_000,
  aturanBawaan: null,
  biayaBawaan: null,
  ...lain,
});

describe("markup ↔ margin (contoh pemilik P4)", () => {
  it("markup 178% = margin 64,0%", () => {
    expect(formatPersenSatuDesimal(marginDariMarkup(178))).toBe("64,0");
  });

  it("margin 40% = markup 66,7%", () => {
    expect(formatPersenSatuDesimal(markupDariMargin(40)!)).toBe("66,7");
  });

  it("margin 100% atau lebih tidak punya markup", () => {
    expect(markupDariMargin(100)).toBeNull();
  });

  it("angka besar ditulis dengan pemisah ribuan", () => {
    expect(formatPersenSatuDesimal(markupDariMargin(99.99)!)).toBe("999.900,0");
  });
});

describe("hargaRekomendasi", () => {
  it("MARKUP: HPP 100.000, markup 50%, bantalan 2.000 → Rp 152.000", () => {
    expect(hargaRekomendasi(100_000, markup(50), 2_000)).toBe(152_000);
  });

  it("MARGIN: HPP 100.000, margin 40%, tanpa bantalan → Rp 166.666,67", () => {
    expect(hargaRekomendasi(100_000, margin(40), 0)).toBe(166_666.67);
  });

  it("contoh lama tetap sama sebagai markup: HPP 50.000, 40%, biaya 2.000 → Rp 72.000", () => {
    expect(hargaRekomendasi(50_000, markup(40), 2_000)).toBe(72_000);
    expect(hargaRekomendasi(55_000, markup(40), 2_000)).toBe(79_000);
  });

  it("dibulatkan ke sen, setengah ke atas, tanpa galat pecahan biner", () => {
    expect(hargaRekomendasi(53_750.25, markup(40), 0)).toBe(75_250.35);
    expect(hargaRekomendasi(0.1, markup(50), 0.2)).toBe(0.35);
    expect(hargaRekomendasi(10_000.005, markup(0), 0)).toBe(10_000.01);
  });

  it("margin 100% → tidak ada harga", () => {
    expect(hargaRekomendasi(50_000, margin(100), 0)).toBeNull();
  });
});

describe("aturanHargaSah", () => {
  it("batas per dasar: markup 0–999,99; margin 0–99,99", () => {
    expect(aturanHargaSah(markup(999.99))).toBe(true);
    expect(aturanHargaSah(markup(1000))).toBe(false);
    expect(aturanHargaSah(margin(99.99))).toBe(true);
    expect(aturanHargaSah(margin(100))).toBe(false);
    expect(aturanHargaSah(markup(-1))).toBe(false);
    expect(aturanHargaSah(markup(Number.NaN))).toBe(false);
    expect(aturanHargaSah(null)).toBe(false);
  });
});

describe("aturanDariKolom", () => {
  it("persen lama tanpa dasar dibaca sebagai markup; kosong → null", () => {
    expect(aturanDariKolom(40, null)).toEqual(markup(40));
    expect(aturanDariKolom("40.00", "MARGIN")).toEqual(margin(40));
    expect(aturanDariKolom(null, "MARGIN")).toBeNull();
  });
});

describe("rekomendasiHargaJual", () => {
  it("aturan dan biaya barang sendiri dipakai lebih dulu, kedua angka ditampilkan", () => {
    const r = rekomendasiHargaJual(dasar({ aturanBawaan: margin(10), biayaBawaan: 500 }));
    expect(r).toMatchObject({
      ada: true,
      harga: 72_000,
      hpp: 50_000,
      dokumen: "RCPT/2026/0001",
      dasar: "MARKUP",
      persen: 40,
      markup: 40,
      aturanBawaan: false,
      biaya: 2_000,
      sumberBiaya: "BARANG",
    });
    expect(r.ada && formatPersenSatuDesimal(r.margin)).toBe("28,6");
  });

  it("barang tanpa aturan memakai PASANGAN bawaan utuh, dengan dasarnya sendiri", () => {
    const r = rekomendasiHargaJual(dasar({ aturanBarang: null, biayaBarang: null, aturanBawaan: margin(40), biayaBawaan: 0 }));
    expect(r).toMatchObject({ ada: true, dasar: "MARGIN", persen: 40, margin: 40, aturanBawaan: true, sumberBiaya: "BAWAAN" });
    expect(r.ada && r.harga).toBe(83_333.33);
  });

  it("bantalan margin kosong di barang dan bawaan → 0", () => {
    expect(rekomendasiHargaJual(dasar({ biayaBarang: null }))).toMatchObject({ ada: true, harga: 70_000, biaya: 0, sumberBiaya: "NOL" });
  });

  it("persen 0 adalah aturan, bukan kosong", () => {
    expect(rekomendasiHargaJual(dasar({ aturanBarang: markup(0), aturanBawaan: markup(40) }))).toMatchObject({
      ada: true,
      harga: 52_000,
      persen: 0,
      aturanBawaan: false,
    });
  });

  it("belum ada HPP / HPP 0 → kurang HPP", () => {
    expect(rekomendasiHargaJual(dasar({ hppTerbaru: null }))).toEqual({ ada: false, kurang: ["HPP"] });
    expect(
      rekomendasiHargaJual(dasar({ hppTerbaru: { perPcs: 0, dokumen: "GRN/1", tanggal: "2026-10-01T03:00:00.000Z" } })),
    ).toEqual({ ada: false, kurang: ["HPP"] });
  });

  it("tanpa aturan barang dan bawaan → kurang ATURAN; keduanya kurang → keduanya disebut", () => {
    expect(rekomendasiHargaJual(dasar({ aturanBarang: null }))).toEqual({ ada: false, kurang: ["ATURAN"] });
    expect(rekomendasiHargaJual(dasar({ hppTerbaru: null, aturanBarang: null }))).toEqual({ ada: false, kurang: ["HPP", "ATURAN"] });
  });

  it("aturan barang yang tidak sah (NaN, margin 100) jatuh ke bawaan", () => {
    expect(rekomendasiHargaJual(dasar({ aturanBarang: markup(Number.NaN), aturanBawaan: markup(30) }))).toMatchObject({
      ada: true,
      persen: 30,
      aturanBawaan: true,
    });
    expect(rekomendasiHargaJual(dasar({ aturanBarang: margin(100), aturanBawaan: markup(30) }))).toMatchObject({ persen: 30 });
  });
});

describe("bacaAngkaOpsional", () => {
  it("kosong → null, angka → angka, koma desimal diterima, selain angka → NaN", () => {
    expect(bacaAngkaOpsional("  ")).toBeNull();
    expect(bacaAngkaOpsional("40")).toBe(40);
    expect(bacaAngkaOpsional("12,5")).toBe(12.5);
    expect(bacaAngkaOpsional("abc")).toBeNaN();
  });
});

describe("formatRupiahSen", () => {
  it("angka bulat tanpa sen, sen ditulis dengan koma", () => {
    expect(formatRupiahSen(72_000)).toBe("Rp 72.000");
    expect(formatRupiahSen(75_250.35)).toBe("Rp 75.250,35");
    expect(formatRupiahSen(10.5)).toBe("Rp 10,50");
  });
});
