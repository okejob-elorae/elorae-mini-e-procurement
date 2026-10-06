import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { bagiBiayaPerBaris, hitungBiayaPenerimaanFG } from "./biaya-penerimaan";

/*
 * Biaya bahan perintah kerja dibebankan ke penerimaan barang jadi secara
 * bertahap. Dulu SETIAP penerimaan sebagian memikul seluruh biaya bahan, jadi
 * HPP per pcs berlipat (dan harga jual otomatis ikut naik ke Jubelio).
 */
describe("hitungBiayaPenerimaanFG", () => {
  const dasar = { totalBiayaBahan: 1_000_000, qtyRencana: 100 };

  it("terima 40 lalu 60 dari rencana 100 → 10.000/pcs pada keduanya, Σ = 1.000.000", () => {
    const a = hitungBiayaPenerimaanFG({ ...dasar, sudahDibebankan: 0, sudahDiterima: 0, qtyDiterima: 40, qtyLolos: 40 });
    expect(a.biaya.toNumber()).toBe(400_000);
    expect(a.biayaPerUnit.toNumber()).toBe(10_000);
    expect(a.penerimaanTerakhir).toBe(false);

    const b = hitungBiayaPenerimaanFG({ ...dasar, sudahDibebankan: a.biaya, sudahDiterima: 40, qtyDiterima: 60, qtyLolos: 60 });
    expect(b.biaya.toNumber()).toBe(600_000);
    expect(b.biayaPerUnit.toNumber()).toBe(10_000);
    expect(b.penerimaanTerakhir).toBe(true);
    expect(a.biaya.plus(b.biaya).toNumber()).toBe(1_000_000);
  });

  it("tiga penerimaan 33/33/34 tidak kehilangan sen: Σ tepat sama dengan biaya bahan", () => {
    const total = 1_000_000.01;
    const r1 = hitungBiayaPenerimaanFG({ totalBiayaBahan: total, qtyRencana: 100, sudahDibebankan: 0, sudahDiterima: 0, qtyDiterima: 33, qtyLolos: 33 });
    const r2 = hitungBiayaPenerimaanFG({ totalBiayaBahan: total, qtyRencana: 100, sudahDibebankan: r1.biaya, sudahDiterima: 33, qtyDiterima: 33, qtyLolos: 33 });
    const r3 = hitungBiayaPenerimaanFG({
      totalBiayaBahan: total,
      qtyRencana: 100,
      sudahDibebankan: r1.biaya.plus(r2.biaya),
      sudahDiterima: 66,
      qtyDiterima: 34,
      qtyLolos: 34,
    });
    for (const r of [r1, r2, r3]) expect(r.biaya.decimalPlaces()).toBeLessThanOrEqual(2);
    expect(r1.biaya.plus(r2.biaya).plus(r3.biaya).toFixed(2)).toBe("1000000.01");
  });

  it("barang reject ikut menghabiskan bahan: biayanya dipikul barang yang lolos", () => {
    // 40 lolos, lalu 55 lolos + 5 reject → penerimaan kedua menutup rencana 100.
    const a = hitungBiayaPenerimaanFG({ ...dasar, sudahDibebankan: 0, sudahDiterima: 0, qtyDiterima: 40, qtyLolos: 40 });
    const b = hitungBiayaPenerimaanFG({ ...dasar, sudahDibebankan: a.biaya, sudahDiterima: 40, qtyDiterima: 60, qtyLolos: 55 });
    expect(b.biaya.toNumber()).toBe(600_000);
    expect(b.biayaPerUnit.toDecimalPlaces(2).toNumber()).toBe(10_909.09);
  });

  it("penerimaan yang seluruhnya reject tidak membebankan apa pun; sisanya dipikul penerimaan berikutnya", () => {
    const a = hitungBiayaPenerimaanFG({ ...dasar, sudahDibebankan: 0, sudahDiterima: 0, qtyDiterima: 10, qtyLolos: 0 });
    expect(a.biaya.toNumber()).toBe(0);
    expect(a.biayaPerUnit.toNumber()).toBe(0);
    const b = hitungBiayaPenerimaanFG({ ...dasar, sudahDibebankan: 0, sudahDiterima: 10, qtyDiterima: 90, qtyLolos: 90 });
    expect(b.biaya.toNumber()).toBe(1_000_000);
  });

  it("lebih produksi dalam satu penerimaan: seluruh biaya dibagi ke semua pcs", () => {
    const r = hitungBiayaPenerimaanFG({ ...dasar, sudahDibebankan: 0, sudahDiterima: 0, qtyDiterima: 125, qtyLolos: 125 });
    expect(r.biaya.toNumber()).toBe(1_000_000);
    expect(r.biayaPerUnit.toNumber()).toBe(8_000);
  });

  it("bahan tambahan sesudah penerimaan sebagian dibagi ke sisa rencana", () => {
    // 40 sudah memikul 400.000; bahan tambahan 120.000 → sisa 720.000 untuk 60 pcs.
    const r = hitungBiayaPenerimaanFG({ totalBiayaBahan: 1_120_000, qtyRencana: 100, sudahDibebankan: 400_000, sudahDiterima: 40, qtyDiterima: 60, qtyLolos: 60 });
    expect(r.biaya.toNumber()).toBe(720_000);
    expect(r.biayaPerUnit.toNumber()).toBe(12_000);
  });

  it("penerimaan lama yang sudah memikul lebih dari total tidak membuat biaya negatif", () => {
    const r = hitungBiayaPenerimaanFG({ ...dasar, sudahDibebankan: 1_000_000, sudahDiterima: 40, qtyDiterima: 60, qtyLolos: 60 });
    expect(r.biaya.toNumber()).toBe(0);
    expect(r.biayaPerUnit.toNumber()).toBe(0);
  });
});

describe("bagiBiayaPerBaris", () => {
  it("membagi biaya ke baris varian dengan sisa terbesar sehingga Σ tepat", () => {
    const hasil = bagiBiayaPerBaris(new Decimal(100), [1, 1, 1]);
    expect(hasil.map((d) => d.toFixed(2))).toEqual(["33.34", "33.33", "33.33"]);
    expect(hasil.reduce((s, d) => s.plus(d), new Decimal(0)).toFixed(2)).toBe("100.00");
  });

  it("proporsional dengan qty", () => {
    const hasil = bagiBiayaPerBaris(new Decimal(600_000), [20, 40]);
    expect(hasil.map((d) => d.toNumber())).toEqual([200_000, 400_000]);
  });

  it("baris qty nol mendapat nol", () => {
    const hasil = bagiBiayaPerBaris(new Decimal(10), [0, 4]);
    expect(hasil.map((d) => d.toNumber())).toEqual([0, 10]);
  });
});
