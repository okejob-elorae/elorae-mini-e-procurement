import { describe, expect, it } from "vitest";
import {
  bacaTarifPajak,
  bagiJumlah,
  hitungDariNeto,
  hitungPph,
  hitungTermin,
  TARIF_PAJAK_BAWAAN,
  validasiTarifPajak,
  type SubjekPajak,
  type TarifPajakKreatif,
} from "./pph";

const OP: SubjekPajak = { jenis: "ORANG_PRIBADI", adaNpwp: true };
const OP_TANPA_NPWP: SubjekPajak = { jenis: "ORANG_PRIBADI", adaNpwp: false };
const BADAN: SubjekPajak = { jenis: "BADAN", adaNpwp: true };
const BADAN_TANPA_NPWP: SubjekPajak = { jenis: "BADAN", adaNpwp: false };
const BEBAS: SubjekPajak = { jenis: "TIDAK_DIPOTONG", adaNpwp: false };

describe("hitungPph — PPh 21 bukan pegawai", () => {
  it("DPP 50% bruto, lapisan pertama 5%", () => {
    const r = hitungPph(10_000_000, OP);
    expect(r).toMatchObject({ pasal: "21", bruto: 10_000_000, dpp: 5_000_000, pph: 250_000, neto: 9_750_000, grossUp: false });
    expect(r.lapisan).toEqual([{ dari: 0, sampai: 60_000_000, persen: 5, dasar: 5_000_000, pph: 250_000 }]);
    expect(r.tambahanTanpaNpwpPersen).toBe(0);
  });

  it("tanpa NPWP: PPh 20% lebih tinggi", () => {
    const r = hitungPph(10_000_000, OP_TANPA_NPWP);
    expect(r.pph).toBe(300_000);
    expect(r.neto).toBe(9_700_000);
    expect(r.tambahanTanpaNpwpPersen).toBe(20);
  });

  it("melewati beberapa lapisan Pasal 17", () => {
    // DPP 100 jt: 60 jt × 5% + 40 jt × 15%
    const r = hitungPph(200_000_000, OP);
    expect(r.dpp).toBe(100_000_000);
    expect(r.pph).toBe(3_000_000 + 6_000_000);
    expect(r.lapisan.map((l) => [l.persen, l.dasar])).toEqual([
      [5, 60_000_000],
      [15, 40_000_000],
    ]);
  });

  it("tepat di batas lapisan tidak menyentuh lapisan berikutnya", () => {
    const r = hitungPph(120_000_000, OP);
    expect(r.dpp).toBe(60_000_000);
    expect(r.pph).toBe(3_000_000);
    expect(r.lapisan).toHaveLength(1);
  });

  it("semua lapisan sampai 35%", () => {
    // DPP 6 M: 60jt×5% + 190jt×15% + 250jt×25% + 4,5M×30% + 1M×35%
    const r = hitungPph(12_000_000_000, OP);
    expect(r.dpp).toBe(6_000_000_000);
    expect(r.pph).toBe(3_000_000 + 28_500_000 + 62_500_000 + 1_350_000_000 + 350_000_000);
    expect(r.lapisan.at(-1)).toMatchObject({ persen: 35, sampai: null, dasar: 1_000_000_000 });
  });

  it("PPh dibulatkan ke bawah ke rupiah penuh", () => {
    // DPP 500.000,50 → 5% = 25.000,025
    const r = hitungPph(1_000_001, OP);
    expect(r.dpp).toBe(500_000.5);
    expect(r.pph).toBe(25_000);
    expect(r.neto).toBe(975_001);
  });

  it("bruto nol atau tidak sah → semuanya nol", () => {
    expect(hitungPph(0, OP)).toMatchObject({ bruto: 0, dpp: 0, pph: 0, neto: 0 });
    expect(hitungPph(Number.NaN, OP)).toMatchObject({ bruto: 0, pph: 0 });
    expect(hitungPph(-5, OP)).toMatchObject({ bruto: 0, pph: 0 });
  });
});

describe("hitungPph — PPh 23 dan tidak dipotong", () => {
  it("PPh 23 2% bruto, DPP = bruto", () => {
    expect(hitungPph(5_000_000, BADAN)).toMatchObject({ pasal: "23", dpp: 5_000_000, pph: 100_000, neto: 4_900_000 });
  });

  it("PPh 23 tanpa NPWP 100% lebih tinggi (4%)", () => {
    expect(hitungPph(5_000_000, BADAN_TANPA_NPWP)).toMatchObject({ pph: 200_000, neto: 4_800_000, tambahanTanpaNpwpPersen: 100 });
  });

  it("tidak dipotong: PPh nol, neto = bruto", () => {
    expect(hitungPph(5_000_000, BEBAS)).toMatchObject({ pasal: null, dpp: 0, pph: 0, neto: 5_000_000 });
  });
});

/** Bruto minimal: neto tercapai, dan satu rupiah lebih kecil tidak mencapainya. */
function periksaGrossUp(neto: number, subjek: SubjekPajak, tarif: TarifPajakKreatif = TARIF_PAJAK_BAWAAN) {
  const r = hitungDariNeto(neto, subjek, tarif);
  expect(r.grossUp).toBe(true);
  expect(Number.isInteger(r.bruto)).toBe(true);
  expect(r.neto).toBeGreaterThanOrEqual(neto);
  expect(r.neto).toBe(r.bruto - r.pph);
  expect(hitungPph(r.bruto, subjek, tarif)).toMatchObject({ pph: r.pph, neto: r.neto });
  const kurang = hitungPph(r.bruto - 1, subjek, tarif);
  expect(kurang.neto).toBeLessThan(neto);
  return r;
}

describe("hitungDariNeto — gross-up", () => {
  it("bruto minimal: karena PPh dibulatkan ke bawah, satu rupiah di bawah bruto bulat sudah cukup", () => {
    // 9.999.999 → DPP 4.999.999,5 → PPh 249.999,975 → 249.999 → neto 9.750.000
    expect(periksaGrossUp(9_750_000, OP).bruto).toBe(9_999_999);
    expect(periksaGrossUp(980_000, BADAN).bruto).toBe(999_999);
    expect(periksaGrossUp(9_700_000, OP_TANPA_NPWP).bruto).toBe(9_999_999);
  });

  it("neto ganjil: bruto minimal, dibulatkan ke rupiah ke atas", () => {
    for (const n of [1, 999, 1_234_567, 2_500_001, 75_000_000, 333_333_333]) {
      periksaGrossUp(n, OP);
      periksaGrossUp(n, OP_TANPA_NPWP);
      periksaGrossUp(n, BADAN);
      periksaGrossUp(n, BADAN_TANPA_NPWP);
    }
  });

  it("tepi lapisan progresif: neto tepat di batas 60 jt DPP dan satu rupiah di atasnya", () => {
    // bruto 120 jt → DPP 60 jt → PPh 3 jt → neto 117 jt (masih lapisan 5%)
    expect(periksaGrossUp(117_000_000, OP).bruto).toBe(119_999_999);
    // Satu rupiah lebih: masuk lapisan 15% — bruto minimal tetap terpenuhi
    const lewat = periksaGrossUp(117_000_001, OP);
    expect(lewat.bruto).toBeGreaterThan(120_000_000);
    expect(lewat.lapisan.map((l) => l.persen)).toEqual([5, 15]);
    // Jauh di lapisan 15%: setiap rupiah bruto tambahan menambah PPh 7,5%
    const jauh = periksaGrossUp(200_000_000, OP);
    expect(jauh.lapisan.map((l) => l.persen)).toEqual([5, 15]);
  });

  it("melewati lapisan 25% dan 30%", () => {
    periksaGrossUp(450_000_000, OP);
    periksaGrossUp(3_000_000_000, OP);
  });

  it("tidak dipotong: bruto = neto", () => {
    expect(hitungDariNeto(1_500_000, BEBAS)).toMatchObject({ bruto: 1_500_000, pph: 0, neto: 1_500_000, grossUp: true });
  });

  it("neto nol → nol", () => {
    expect(hitungDariNeto(0, OP)).toMatchObject({ bruto: 0, pph: 0, neto: 0 });
  });
});

describe("hitungTermin", () => {
  it("DIPOTONG: jumlah = bruto; GROSS_UP: jumlah = neto", () => {
    expect(hitungTermin(10_000_000, "DIPOTONG", OP)).toMatchObject({ bruto: 10_000_000, neto: 9_750_000, grossUp: false });
    expect(hitungTermin(9_750_000, "GROSS_UP", OP)).toMatchObject({ bruto: 9_999_999, neto: 9_750_000, grossUp: true });
  });
});

describe("bagiJumlah — pecah termin", () => {
  it("menurut persen, sisa terbesar, jumlahnya persis", () => {
    expect(bagiJumlah(1_000_000, [50, 50])).toEqual([500_000, 500_000]);
    expect(bagiJumlah(1_000_000, [33.33, 33.33, 33.34])).toEqual([333_300, 333_300, 333_400]);
    const tiga = bagiJumlah(1_000_000, [1, 1, 1]);
    expect(tiga).toEqual([333_334, 333_333, 333_333]);
    expect(tiga.reduce((a, b) => a + b, 0)).toBe(1_000_000);
  });

  it("total bersen dipecah dalam sen", () => {
    const r = bagiJumlah(100.01, [1, 1]);
    expect(r.reduce((a, b) => Math.round((a + b) * 100) / 100, 0)).toBe(100.01);
    expect(r).toEqual([50.01, 50]);
  });

  it("satu bagian atau bobot nol", () => {
    expect(bagiJumlah(750_000, [100])).toEqual([750_000]);
    expect(bagiJumlah(750_000, [0, 100])).toEqual([0, 750_000]);
    expect(bagiJumlah(750_000, [])).toEqual([]);
    expect(bagiJumlah(750_000, [0, 0])).toEqual([0, 0]);
  });

  it("jumlahnya selalu persis untuk banyak total dan bobot", () => {
    for (const total of [1, 7, 999_999, 1_234_567, 10_000_000]) {
      for (const bobot of [[30, 70], [10, 20, 30, 40], [1, 2, 3], [25, 25, 25, 25], [99.99, 0.01]]) {
        const r = bagiJumlah(total, bobot);
        expect(r.reduce((a, b) => a + b, 0)).toBe(total);
        expect(r.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
      }
    }
  });
});

describe("tarif — baca & validasi", () => {
  it("baris kosong atau rusak → bawaan", () => {
    expect(bacaTarifPajak(null)).toEqual(TARIF_PAJAK_BAWAAN);
    expect(bacaTarifPajak("bukan json")).toEqual(TARIF_PAJAK_BAWAAN);
    expect(bacaTarifPajak(JSON.stringify({ pph23: { tarifPersen: 2.5, tambahanTanpaNpwpPersen: 100 } }))).toEqual({
      ...TARIF_PAJAK_BAWAAN,
      pph23: { tarifPersen: 2.5, tambahanTanpaNpwpPersen: 100 },
    });
  });

  it("bagian yang tidak sah memakai bawaannya sendiri", () => {
    const r = bacaTarifPajak({ pph21: { porsiDppPersen: 500, lapisan: [], tambahanTanpaNpwpPersen: 20 }, pph23: { tarifPersen: 3, tambahanTanpaNpwpPersen: 100 } });
    expect(r.pph21).toEqual(TARIF_PAJAK_BAWAAN.pph21);
    expect(r.pph23.tarifPersen).toBe(3);
  });

  it("validasi menolak lapisan tak berurutan, lapisan akhir tidak terbuka, persen di luar 0–100", () => {
    expect(validasiTarifPajak(TARIF_PAJAK_BAWAAN)).toEqual({ ok: true, tarif: TARIF_PAJAK_BAWAAN });
    const tidakUrut = structuredClone(TARIF_PAJAK_BAWAAN);
    tidakUrut.pph21.lapisan[1].sampai = 10_000_000;
    expect(validasiTarifPajak(tidakUrut)).toMatchObject({ ok: false });
    const tertutup = structuredClone(TARIF_PAJAK_BAWAAN);
    tertutup.pph21.lapisan.at(-1)!.sampai = 9_000_000_000;
    expect(validasiTarifPajak(tertutup)).toMatchObject({ ok: false });
    const besar = structuredClone(TARIF_PAJAK_BAWAAN);
    besar.pph23.tarifPersen = 120;
    expect(validasiTarifPajak(besar)).toMatchObject({ ok: false });
    expect(validasiTarifPajak("x")).toMatchObject({ ok: false });
  });

  it("tarif yang diubah dipakai hitungan", () => {
    const t: TarifPajakKreatif = { ...TARIF_PAJAK_BAWAAN, pph23: { tarifPersen: 2.5, tambahanTanpaNpwpPersen: 100 } };
    expect(hitungPph(1_000_000, BADAN, t).pph).toBe(25_000);
    periksaGrossUp(1_234_567, BADAN, t);
  });
});
