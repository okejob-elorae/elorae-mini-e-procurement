import { describe, expect, it } from "vitest";
import {
  bacaAngkaOpsional,
  formatRupiahSen,
  hargaRekomendasi,
  rekomendasiHargaJual,
  type MasukanRekomendasi,
} from "./rekomendasi-harga";

/*
 * Rekomendasi harga jual (keputusan pemilik 2026-11-01): HPP terbaru ×
 * (1 + margin ÷ 100) + biaya tambahan — hanya saran; harga akhir diketik sendiri.
 */

const dasar = (lain: Partial<MasukanRekomendasi> = {}): MasukanRekomendasi => ({
  hppTerbaru: { perPcs: 50_000, dokumen: "RCPT/2026/0001", tanggal: "2026-10-01T03:00:00.000Z" },
  marginBarang: 40,
  biayaBarang: 2_000,
  marginBawaan: null,
  biayaBawaan: null,
  ...lain,
});

describe("hargaRekomendasi", () => {
  it("contoh pemilik: HPP 50.000, margin 40%, biaya tambahan 2.000 → Rp 72.000", () => {
    expect(hargaRekomendasi(50_000, 40, 2_000)).toBe(72_000);
  });

  it("penerimaan yang lebih baru ber-HPP 55.000 → Rp 79.000", () => {
    expect(hargaRekomendasi(55_000, 40, 2_000)).toBe(79_000);
  });

  it("dibulatkan ke sen, setengah ke atas, tanpa galat pecahan biner", () => {
    expect(hargaRekomendasi(53_750.25, 40, 0)).toBe(75_250.35);
    expect(hargaRekomendasi(0.1, 50, 0.2)).toBe(0.35);
    expect(hargaRekomendasi(10_000.005, 0, 0)).toBe(10_000.01);
  });
});

describe("rekomendasiHargaJual", () => {
  it("margin dan biaya barang sendiri dipakai lebih dulu", () => {
    expect(rekomendasiHargaJual(dasar({ marginBawaan: 10, biayaBawaan: 500 }))).toEqual({
      ada: true,
      harga: 72_000,
      hpp: 50_000,
      dokumen: "RCPT/2026/0001",
      tanggal: "2026-10-01T03:00:00.000Z",
      margin: 40,
      marginBawaan: false,
      biaya: 2_000,
      sumberBiaya: "BARANG",
    });
  });

  it("HPP terbaru dari penerimaan yang lebih baru (55.000) → Rp 79.000", () => {
    const r = rekomendasiHargaJual(
      dasar({ hppTerbaru: { perPcs: 55_000, dokumen: "RCPT/2026/0002", tanggal: "2026-11-01T03:00:00.000Z" } }),
    );
    expect(r).toMatchObject({ ada: true, harga: 79_000, hpp: 55_000, dokumen: "RCPT/2026/0002" });
  });

  it("barang tanpa margin dan biaya sendiri → margin dan biaya bawaan", () => {
    const r = rekomendasiHargaJual(dasar({ marginBarang: null, biayaBarang: null, marginBawaan: 40, biayaBawaan: 2_000 }));
    expect(r).toMatchObject({ ada: true, harga: 72_000, marginBawaan: true, sumberBiaya: "BAWAAN" });
  });

  it("biaya tambahan kosong di barang dan bawaan → 0", () => {
    const r = rekomendasiHargaJual(dasar({ biayaBarang: null }));
    expect(r).toMatchObject({ ada: true, harga: 70_000, biaya: 0, sumberBiaya: "NOL" });
  });

  it("margin 0 adalah margin, bukan kosong", () => {
    expect(rekomendasiHargaJual(dasar({ marginBarang: 0, marginBawaan: 40 }))).toMatchObject({
      ada: true,
      harga: 52_000,
      margin: 0,
      marginBawaan: false,
    });
  });

  it("belum ada HPP → tidak ada rekomendasi, dan disebut yang kurang: HPP", () => {
    expect(rekomendasiHargaJual(dasar({ hppTerbaru: null }))).toEqual({ ada: false, kurang: ["HPP"] });
  });

  it("HPP 0 dianggap belum ada HPP (harga dari biaya tambahan saja menyesatkan)", () => {
    expect(
      rekomendasiHargaJual(dasar({ hppTerbaru: { perPcs: 0, dokumen: "GRN/1", tanggal: "2026-10-01T03:00:00.000Z" } })),
    ).toEqual({ ada: false, kurang: ["HPP"] });
  });

  it("tanpa margin barang dan tanpa margin bawaan → kurang margin", () => {
    expect(rekomendasiHargaJual(dasar({ marginBarang: null }))).toEqual({ ada: false, kurang: ["MARGIN"] });
  });

  it("keduanya kurang → keduanya disebut", () => {
    expect(rekomendasiHargaJual(dasar({ hppTerbaru: null, marginBarang: null }))).toEqual({
      ada: false,
      kurang: ["HPP", "MARGIN"],
    });
  });

  it("isian margin yang bukan angka (NaN) jatuh ke margin bawaan", () => {
    expect(rekomendasiHargaJual(dasar({ marginBarang: Number.NaN, marginBawaan: 30 }))).toMatchObject({
      ada: true,
      margin: 30,
      marginBawaan: true,
    });
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
    expect(formatRupiahSen(72_000)).toBe("Rp 72.000");
    expect(formatRupiahSen(75_250.35)).toBe("Rp 75.250,35");
    expect(formatRupiahSen(10.5)).toBe("Rp 10,50");
  });
});
