import { describe, expect, it } from "vitest";
import {
  BULAN,
  bacaAngkaIsian,
  tulisAngkaIsian,
  bacaIsianAnggaran,
  capaianAnggaran,
  ratakanTahunan,
  rentangBulan,
  salinDenganPersen,
  totalBaris,
} from "./aturan";

describe("ratakanTahunan", () => {
  it("membagi rata dalam rupiah utuh; sisanya di bulan terakhir, jumlahnya persis", () => {
    const hasil = ratakanTahunan(1_000_000);
    expect(hasil).toHaveLength(12);
    expect(hasil.slice(0, 11).every((v) => v === 83_333)).toBe(true);
    expect(hasil[11]).toBe(83_337);
    expect(hasil.reduce((a, b) => a + b, 0)).toBe(1_000_000);
  });

  it("nilai negatif (akun kontra) dibagi dengan cara yang sama", () => {
    expect(ratakanTahunan(-120).reduce((a, b) => a + b, 0)).toBe(-120);
  });
});

describe("salinDenganPersen", () => {
  it("menaikkan/menurunkan setiap bulan, dibulatkan ke rupiah", () => {
    expect(salinDenganPersen([100_000, 0, null, 33_333], 10)).toEqual([110_000, 0, null, 36_666]);
    expect(salinDenganPersen([100_000], -15)).toEqual([85_000]);
  });
});

describe("totalBaris", () => {
  it("menjumlah sel terisi, null = belum diisi", () => {
    expect(totalBaris([1, null, 2.5])).toBe(3.5);
    expect(totalBaris([null, null])).toBeNull();
  });
});

describe("bacaIsianAnggaran", () => {
  it("menerima tahun wajar dan 12 sel per akun (angka atau kosong)", () => {
    const hasil = bacaIsianAnggaran({
      tahun: 2027,
      baris: [{ chartAccountId: "a", bulan: [1000, null, ...new Array(10).fill(0)] }],
    });
    expect(hasil).toEqual({
      ok: true,
      isian: { tahun: 2027, baris: [{ chartAccountId: "a", bulan: [1000, null, ...new Array(10).fill(0)] }] },
    });
  });

  it("menolak tahun di luar 2000–2100", () => {
    expect(bacaIsianAnggaran({ tahun: 1999, baris: [] })).toEqual({ ok: false, kode: "TAHUN_TIDAK_SAH" });
    expect(bacaIsianAnggaran({ tahun: "2027", baris: [] })).toEqual({ ok: false, kode: "TAHUN_TIDAK_SAH" });
  });

  it("menolak sel bukan angka atau jumlah sel salah", () => {
    expect(bacaIsianAnggaran({ tahun: 2027, baris: [{ chartAccountId: "a", bulan: [1] }] })).toEqual({ ok: false, kode: "ISIAN_RUSAK" });
    expect(
      bacaIsianAnggaran({ tahun: 2027, baris: [{ chartAccountId: "a", bulan: ["x", ...new Array(11).fill(null)] }] }),
    ).toEqual({ ok: false, kode: "NILAI_TIDAK_SAH" });
    expect(
      bacaIsianAnggaran({ tahun: 2027, baris: [{ chartAccountId: "a", bulan: [1e16, ...new Array(11).fill(null)] }] }),
    ).toEqual({ ok: false, kode: "NILAI_TIDAK_SAH" });
  });

  it("membulatkan ke sen dan menolak akun ganda", () => {
    const ok = bacaIsianAnggaran({ tahun: 2027, baris: [{ chartAccountId: "a", bulan: [0.125, ...new Array(11).fill(null)] }] });
    expect(ok.ok && ok.isian.baris[0].bulan[0]).toBe(0.13);
    expect(
      bacaIsianAnggaran({
        tahun: 2027,
        baris: [
          { chartAccountId: "a", bulan: new Array(12).fill(null) },
          { chartAccountId: "a", bulan: new Array(12).fill(null) },
        ],
      }),
    ).toEqual({ ok: false, kode: "ISIAN_RUSAK" });
  });
});

describe("capaianAnggaran", () => {
  it("pendapatan: di atas anggaran = baik", () => {
    expect(capaianAnggaran("PENDAPATAN", 1000, 1200)).toEqual({ selisih: 200, persenCapaian: 120, baik: true });
    expect(capaianAnggaran("PENDAPATAN", 1000, 800)).toEqual({ selisih: -200, persenCapaian: 80, baik: false });
  });

  it("beban dan HPP: di bawah anggaran = baik", () => {
    expect(capaianAnggaran("BEBAN", 1000, 800)).toEqual({ selisih: -200, persenCapaian: 80, baik: true });
    expect(capaianAnggaran("HPP", 1000, 1100)).toEqual({ selisih: 100, persenCapaian: 110, baik: false });
  });

  it("tanpa anggaran: tidak ada persen dan tidak dinilai", () => {
    expect(capaianAnggaran("BEBAN", null, 500)).toEqual({ selisih: 500, persenCapaian: null, baik: null });
    expect(capaianAnggaran("BEBAN", 0, 500)).toEqual({ selisih: 500, persenCapaian: null, baik: false });
  });
});

describe("rentangBulan", () => {
  it("satu bulan atau sejak Januari", () => {
    expect(rentangBulan(5, "bulan")).toEqual([5]);
    expect(rentangBulan(3, "ytd")).toEqual([1, 2, 3]);
    expect(BULAN).toHaveLength(12);
  });
});

describe("bacaAngkaIsian / tulisAngkaIsian", () => {
  it("membaca penulisan Indonesia dan angka polos", () => {
    expect(bacaAngkaIsian("1.250.000")).toBe(1_250_000);
    expect(bacaAngkaIsian("Rp 1.250.000")).toBe(1_250_000);
    expect(bacaAngkaIsian("1.250.000,50")).toBe(1_250_000.5);
    expect(bacaAngkaIsian("250.000")).toBe(250_000);
    expect(bacaAngkaIsian("1250000")).toBe(1_250_000);
    expect(bacaAngkaIsian("12.5")).toBe(12.5);
    expect(bacaAngkaIsian("-500")).toBe(-500);
    expect(bacaAngkaIsian("(500)")).toBe(-500);
    expect(bacaAngkaIsian("0")).toBe(0);
  });

  it("kosong = belum dianggarkan; sampah = rusak", () => {
    expect(bacaAngkaIsian("")).toBeNull();
    expect(bacaAngkaIsian("   ")).toBeNull();
    expect(bacaAngkaIsian("abc")).toBe("rusak");
    expect(bacaAngkaIsian("1,2,3")).toBe("rusak");
  });

  it("menulis kembali dengan pemisah titik", () => {
    expect(tulisAngkaIsian(1_250_000)).toBe("1.250.000");
    expect(tulisAngkaIsian(1_250_000.5)).toBe("1.250.000,50");
    expect(tulisAngkaIsian(-500)).toBe("-500");
    expect(tulisAngkaIsian(null)).toBe("");
    expect(bacaAngkaIsian(tulisAngkaIsian(98_765.43))).toBe(98_765.43);
  });
});
