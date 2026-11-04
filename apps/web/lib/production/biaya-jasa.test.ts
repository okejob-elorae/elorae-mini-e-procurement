import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { PPN_BAWAAN, type PengaturanPpn } from "@/lib/finance/pajak/ppn";
import { bagiHutangJasaPerLangkah, jasaPenerimaan, nilaiJasaKumulatif, type LangkahJasa } from "./biaya-jasa";

/*
 * Ongkos jahit (CMT) dan jasa langkah WO lainnya masuk HPP barang jadi
 * (keputusan sementara pemilik 34, PSAK 14 — biaya konversi bagian dari biaya
 * persediaan). Jasa dihitung per pcs yang LOLOS QC, dari harga per pcs langkah
 * WO. "Belum termasuk PPN" = pemasok menambahkan PPN di atas harga (sama dengan
 * baris PO "Exclude PPN"); "Sudah termasuk PPN" = harga sudah memuat PPN.
 */

const PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "PKP" };
const NON_PKP: PengaturanPpn = { ...PPN_BAWAAN, statusPkp: "NON_PKP" };
const BELUM: PengaturanPpn = { ...PPN_BAWAAN };
const HARI = new Date("2026-10-08T03:00:00.000Z");

const jahitTanpaPpn: LangkahJasa = { id: "s1", supplierId: "p1", servicePrice: 15_000, servicePpnIncluded: false };
const sablonTermasukPpn: LangkahJasa = { id: "s2", supplierId: "p2", servicePrice: 11_100, servicePpnIncluded: true };

const n = (d: Decimal) => d.toNumber();

describe("nilaiJasaKumulatif", () => {
  it("harga belum termasuk PPN: pemasok menambah PPN 12% × 11/12 (11%) — 100 pcs × 15.000 → 1.500.000 + 165.000", () => {
    const v = nilaiJasaKumulatif(jahitTanpaPpn, 100, BELUM);
    expect([n(v.dpp), n(v.ppn), n(v.tagihan)]).toEqual([1_500_000, 165_000, 1_665_000]);
  });

  it("PPN pemasok TIDAK bergantung status PKP Elorae (pemasok yang memungut)", () => {
    for (const p of [PKP, NON_PKP, BELUM]) {
      expect(n(nilaiJasaKumulatif(jahitTanpaPpn, 100, p).tagihan)).toBe(1_665_000);
    }
  });

  it("harga sudah termasuk PPN: tagihan = harga × qty persis, DPP + PPN = tagihan", () => {
    const v = nilaiJasaKumulatif(sablonTermasukPpn, 100, BELUM);
    expect(n(v.tagihan)).toBe(1_110_000);
    expect(n(v.dpp) + n(v.ppn)).toBe(1_110_000);
    expect(n(v.ppn)).toBe(110_000);
  });

  it("pemasok BUKAN PKP (isPkp false) tidak memungut PPN: tagihan = DPP = harga × qty, apa pun tanda termasuk/belum PPN", () => {
    for (const l of [jahitTanpaPpn, { ...sablonTermasukPpn, servicePrice: 15_000 }]) {
      const v = nilaiJasaKumulatif({ ...l, pemasokPkp: false }, 100, PKP);
      expect([n(v.dpp), n(v.ppn), n(v.tagihan)]).toEqual([1_500_000, 0, 1_500_000]);
    }
    // null (belum diisi) dan true = perilaku lama: PPN dipungut.
    expect(n(nilaiJasaKumulatif({ ...jahitTanpaPpn, pemasokPkp: null }, 100, PKP).ppn)).toBe(165_000);
    expect(n(nilaiJasaKumulatif({ ...jahitTanpaPpn, pemasokPkp: true }, 100, PKP).ppn)).toBe(165_000);
  });

  it("qty 0 atau harga 0 → semua nol", () => {
    expect(n(nilaiJasaKumulatif(jahitTanpaPpn, 0, PKP).tagihan)).toBe(0);
    expect(n(nilaiJasaKumulatif({ ...jahitTanpaPpn, servicePrice: 0 }, 50, PKP).tagihan)).toBe(0);
  });
});

describe("jasaPenerimaan", () => {
  it("Elorae PKP: PPN jasa jadi PPN Masukan, persediaan memikul DPP saja", () => {
    const j = jasaPenerimaan({ langkah: [jahitTanpaPpn], qtySebelum: 0, qtyLolos: 40, pengaturan: PKP, tanggal: HARI });
    expect([n(j.tagihan), n(j.dpp), n(j.ppn)]).toEqual([666_000, 600_000, 66_000]);
    expect(j.ppnDikreditkan).toBe(true);
    expect(n(j.dikapitalisasi)).toBe(600_000);
    expect(n(j.ppnMasukan)).toBe(66_000);
  });

  it("Elorae belum PKP / non-PKP: PPN jasa ikut biaya persediaan", () => {
    for (const p of [NON_PKP, BELUM]) {
      const j = jasaPenerimaan({ langkah: [jahitTanpaPpn], qtySebelum: 0, qtyLolos: 40, pengaturan: p, tanggal: HARI });
      expect(j.ppnDikreditkan).toBe(false);
      expect(n(j.dikapitalisasi)).toBe(666_000);
      expect(n(j.ppnMasukan)).toBe(0);
    }
  });

  it("PKP sebelum tanggal berlaku: belum boleh dikreditkan", () => {
    const p: PengaturanPpn = { ...PKP, berlakuSejak: "2026-11-01" };
    const j = jasaPenerimaan({ langkah: [jahitTanpaPpn], qtySebelum: 0, qtyLolos: 10, pengaturan: p, tanggal: HARI });
    expect(j.ppnDikreditkan).toBe(false);
    expect(n(j.dikapitalisasi)).toBe(n(j.tagihan));
  });

  it("bertahap 33 + 33 + 34: Σ per penerimaan = nilai 100 pcs sekaligus, tanpa sen hilang", () => {
    const langkah = [jahitTanpaPpn, sablonTermasukPpn, { id: "s3", supplierId: "p1", servicePrice: "1234.57", servicePpnIncluded: false }];
    let q = 0;
    const jumlah = { tagihan: new Decimal(0), dpp: new Decimal(0), ppn: new Decimal(0) };
    for (const lolos of [33, 33, 34]) {
      const j = jasaPenerimaan({ langkah, qtySebelum: q, qtyLolos: lolos, pengaturan: PKP, tanggal: HARI });
      jumlah.tagihan = jumlah.tagihan.plus(j.tagihan);
      jumlah.dpp = jumlah.dpp.plus(j.dpp);
      jumlah.ppn = jumlah.ppn.plus(j.ppn);
      expect(n(j.dpp.plus(j.ppn))).toBe(n(j.tagihan));
      q += lolos;
    }
    const sekaligus = langkah
      .map((l) => nilaiJasaKumulatif(l, 100, PKP))
      .reduce((s, v) => ({ tagihan: s.tagihan.plus(v.tagihan), dpp: s.dpp.plus(v.dpp), ppn: s.ppn.plus(v.ppn) }), {
        tagihan: new Decimal(0),
        dpp: new Decimal(0),
        ppn: new Decimal(0),
      });
    expect(jumlah.tagihan.toFixed(2)).toBe(sekaligus.tagihan.toFixed(2));
    expect(jumlah.dpp.toFixed(2)).toBe(sekaligus.dpp.toFixed(2));
    expect(jumlah.ppn.toFixed(2)).toBe(sekaligus.ppn.toFixed(2));
  });

  it("rincian per langkah menjumlah ke total dan membawa pemasoknya", () => {
    const j = jasaPenerimaan({ langkah: [jahitTanpaPpn, sablonTermasukPpn], qtySebelum: 10, qtyLolos: 20, pengaturan: NON_PKP, tanggal: HARI });
    expect(j.perLangkah.map((l) => [l.id, l.supplierId])).toEqual([
      ["s1", "p1"],
      ["s2", "p2"],
    ]);
    expect(n(j.perLangkah.reduce((s, l) => s.plus(l.tagihan), new Decimal(0)))).toBe(n(j.tagihan));
    expect(n(j.perLangkah[0].tagihan)).toBe(333_000); // 20 × 15.000 + 11%
    expect(n(j.perLangkah[1].tagihan)).toBe(222_000); // 20 × 11.100 termasuk PPN
  });

  it("penerimaan tanpa barang lolos tidak menagih jasa (jasa per pcs lolos)", () => {
    const j = jasaPenerimaan({ langkah: [jahitTanpaPpn], qtySebelum: 40, qtyLolos: 0, pengaturan: PKP, tanggal: HARI });
    expect(n(j.tagihan)).toBe(0);
    expect(n(j.dikapitalisasi)).toBe(0);
  });

  it("tanpa langkah jasa → nol", () => {
    const j = jasaPenerimaan({ langkah: [], qtySebelum: 0, qtyLolos: 10, pengaturan: PKP, tanggal: HARI });
    expect([n(j.tagihan), n(j.dikapitalisasi), n(j.ppnMasukan)]).toEqual([0, 0, 0]);
  });
});

describe("bagiHutangJasaPerLangkah", () => {
  it("hitungan langkah sama dengan yang tercatat → apa adanya", () => {
    const hasil = bagiHutangJasaPerLangkah(new Decimal(1_000), [
      { tagihan: new Decimal(600), dpp: new Decimal(540) },
      { tagihan: new Decimal(400), dpp: new Decimal(360) },
    ]);
    expect(hasil.map((h) => [n(h.hutang), n(h.dasarPotong)])).toEqual([
      [600, 540],
      [400, 360],
    ]);
  });

  it("selisih (pengaturan PPN berubah di antara penerimaan) → Σ dipaksa sama dengan yang tercatat di buku", () => {
    const hasil = bagiHutangJasaPerLangkah(new Decimal("1000.01"), [
      { tagihan: new Decimal(500), dpp: new Decimal(450) },
      { tagihan: new Decimal(500), dpp: new Decimal(450) },
    ]);
    expect(hasil.reduce((s, h) => s.plus(h.hutang), new Decimal(0)).toFixed(2)).toBe("1000.01");
    for (const h of hasil) expect(h.hutang.decimalPlaces()).toBeLessThanOrEqual(2);
  });

  it("semua langkah bernilai nol tetapi ada yang tercatat → dibagi rata", () => {
    const hasil = bagiHutangJasaPerLangkah(new Decimal(10), [
      { tagihan: new Decimal(0), dpp: new Decimal(0) },
      { tagihan: new Decimal(0), dpp: new Decimal(0) },
    ]);
    expect(hasil.map((h) => n(h.hutang))).toEqual([5, 5]);
  });
});
