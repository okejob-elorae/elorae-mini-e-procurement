import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { PPN_BAWAAN, type PengaturanPpn } from "@/lib/finance/pajak/ppn";
import {
  bagianBahanPenerimaan,
  bagiBiayaPerBaris,
  hitungBiayaPenerimaanFG,
  komponenJurnalPenerimaan,
  rincianBiayaPenerimaan,
  type DasarBiayaPenerimaan,
} from "./biaya-penerimaan";
import { nilaiJasaKumulatif } from "./biaya-jasa";

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

/*
 * Biaya penerimaan LENGKAP (keputusan sementara pemilik 34): bahan dipikul
 * sebanding setoran (seperti di atas), jasa langkah WO dan biaya tambahan per
 * pcs dipikul per pcs LOLOS. Σ semua penerimaan = total biaya WO.
 */
describe("rincianBiayaPenerimaan", () => {
  const NON_PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "NON_PKP" };
  const PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "PKP" };
  const HARI = new Date("2026-10-08T03:00:00.000Z");
  const jahit = { id: "s1", supplierId: "p1", servicePrice: 15_000, servicePpnIncluded: true };

  function dasar(over: Partial<DasarBiayaPenerimaan> = {}): DasarBiayaPenerimaan {
    return {
      totalBiayaBahan: 1_000_000,
      qtyRencana: 100,
      bahanSudahDibebankan: 0,
      sudahDiterima: 0,
      sudahLolos: 0,
      langkah: [jahit],
      biayaTambahanPerPcs: 2_000,
      pengaturanPpn: NON_PKP,
      ...over,
    };
  }

  it("non-PKP: 40 pcs → bahan 400.000 + jasa 600.000 + tambahan 80.000 = 1.080.000 (27.000/pcs)", () => {
    const r = rincianBiayaPenerimaan(dasar(), { qtyDiterima: 40, qtyLolos: 40, tanggal: HARI });
    expect(r.bahan.toNumber()).toBe(400_000);
    expect(r.jasa.tagihan.toNumber()).toBe(600_000);
    expect(r.tambahan.toNumber()).toBe(80_000);
    expect(r.total.toNumber()).toBe(1_080_000);
    expect(r.perUnit.toNumber()).toBe(27_000);
    // Dasar harga jual otomatis tetap biaya BAHAN per pcs (harga jual tidak ikut naik).
    expect(r.bahanPerUnit.toNumber()).toBe(10_000);
    expect(r.ppnMasukan.toNumber()).toBe(0);
  });

  it("PKP: PPN jasa (termasuk dalam harga) dipisah ke PPN Masukan, persediaan memikul DPP", () => {
    const r = rincianBiayaPenerimaan(dasar({ pengaturanPpn: PKP, biayaTambahanPerPcs: null }), {
      qtyDiterima: 40,
      qtyLolos: 40,
      tanggal: HARI,
    });
    expect(r.jasa.tagihan.toNumber()).toBe(600_000);
    expect(r.jasa.ppnMasukan.toNumber()).toBeGreaterThan(0);
    expect(r.total.toNumber()).toBe(400_000 + r.jasa.dpp.toNumber());
    expect(r.ppnMasukan.toNumber()).toBe(r.jasa.ppn.toNumber());
    // Σ yang dikredit (bahan + tagihan jasa + tambahan) = persediaan + PPN Masukan.
    expect(r.bahan.plus(r.jasa.tagihan).plus(r.tambahan).toFixed(2)).toBe(r.total.plus(r.ppnMasukan).toFixed(2));
  });

  it("40 lolos + 5 cacat dari 45 disetor: bahan sebanding SETORAN, jasa & tambahan per pcs LOLOS", () => {
    const r = rincianBiayaPenerimaan(dasar(), { qtyDiterima: 45, qtyLolos: 40, tanggal: HARI });
    expect(r.bahan.toNumber()).toBe(450_000);
    expect(r.jasa.tagihan.toNumber()).toBe(600_000);
    expect(r.tambahan.toNumber()).toBe(80_000);
    expect(r.total.toNumber()).toBe(1_130_000);
  });

  it("tiga penerimaan 33/33/34: Σ = bahan + jasa × 100 + tambahan × 100 persis", () => {
    let d = dasar({ totalBiayaBahan: "1000000.01", langkah: [jahit, { id: "s2", supplierId: "p2", servicePrice: "333.33", servicePpnIncluded: false }] });
    let total = new Decimal(0);
    for (const q of [33, 33, 34]) {
      const r = rincianBiayaPenerimaan(d, { qtyDiterima: q, qtyLolos: q, tanggal: HARI });
      total = total.plus(r.total);
      d = {
        ...d,
        bahanSudahDibebankan: new Decimal(d.bahanSudahDibebankan).plus(r.bahan),
        sudahDiterima: new Decimal(d.sudahDiterima).plus(q),
        sudahLolos: new Decimal(d.sudahLolos).plus(q),
      };
    }
    const jasa100 = d.langkah
      .map((l) => nilaiJasaKumulatif(l, 100, NON_PKP).tagihan)
      .reduce((s, x) => s.plus(x), new Decimal(0));
    expect(total.toFixed(2)).toBe(new Decimal("1000000.01").plus(jasa100).plus(200_000).toFixed(2));
  });

  it("penerimaan seluruhnya cacat: tidak ada biaya sama sekali", () => {
    const r = rincianBiayaPenerimaan(dasar(), { qtyDiterima: 10, qtyLolos: 0, tanggal: HARI });
    expect([r.bahan, r.jasa.tagihan, r.tambahan, r.total, r.perUnit].map((x) => x.toNumber())).toEqual([0, 0, 0, 0, 0]);
  });

  it("lebih produksi sesudah bahan habis dibebankan: jasa & tambahan tetap dipikul, bahan 0", () => {
    const r = rincianBiayaPenerimaan(dasar({ bahanSudahDibebankan: 1_000_000, sudahDiterima: 100, sudahLolos: 100 }), {
      qtyDiterima: 10,
      qtyLolos: 10,
      tanggal: HARI,
    });
    expect(r.bahan.toNumber()).toBe(0);
    expect(r.bahanPerUnit.toNumber()).toBe(0);
    expect(r.total.toNumber()).toBe(150_000 + 20_000);
  });
});

describe("bagianBahanPenerimaan & komponenJurnalPenerimaan", () => {
  it("penerimaan lama (tanpa rincian jasa) memikul bahan sebesar totalCostValue", () => {
    expect(bagianBahanPenerimaan({ materialCost: null, totalCostValue: 400_000 }).toNumber()).toBe(400_000);
    expect(bagianBahanPenerimaan({ materialCost: 300_000, totalCostValue: 400_000 }).toNumber()).toBe(300_000);
    expect(bagianBahanPenerimaan({ materialCost: null, totalCostValue: null }).toNumber()).toBe(0);
  });

  it("PPN Masukan = bahan + jasa + tambahan − nilai persediaan; penerimaan lama → 0 dan bahan = totalCostValue", () => {
    expect(
      komponenJurnalPenerimaan({ materialCost: 400_000, serviceCost: 666_000, additionalCost: 80_000, totalCostValue: 1_080_000 }),
    ).toEqual({ persediaan: 1_080_000, ppnMasukan: 66_000, bahan: 400_000, jasa: 666_000, tambahan: 80_000 });
    expect(
      komponenJurnalPenerimaan({ materialCost: 400_000, serviceCost: null, additionalCost: null, totalCostValue: 400_000 }),
    ).toEqual({ persediaan: 400_000, ppnMasukan: 0, bahan: 400_000, jasa: 0, tambahan: 0 });
    expect(
      komponenJurnalPenerimaan({ materialCost: null, serviceCost: null, additionalCost: null, totalCostValue: 500 }),
    ).toEqual({ persediaan: 500, ppnMasukan: 0, bahan: 500, jasa: 0, tambahan: 0 });
  });

  it("rincian tersimpan yang tidak masuk akal (persediaan > Σ kredit) → null, jurnal tidak diposting", () => {
    expect(
      komponenJurnalPenerimaan({ materialCost: 100, serviceCost: 100, additionalCost: 0, totalCostValue: 300 }),
    ).toBeNull();
  });
});
