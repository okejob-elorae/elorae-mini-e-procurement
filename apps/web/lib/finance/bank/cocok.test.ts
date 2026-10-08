import { describe, expect, it } from "vitest";
import { cocokkanOtomatis, jumlahSenBarisBank, selisihHari } from "./cocok";
import { ringkasRekonsiliasi, saldoBankPadaTanggal } from "./rekonsiliasi";

describe("cocokkanOtomatis", () => {
  it("jumlah sama, tanggal ±3 hari, satu-satu, terdekat dulu", () => {
    const mutasi = [
      { id: "m1", tanggal: "2026-10-05", jumlahSen: -150_000_000 },
      { id: "m2", tanggal: "2026-10-06", jumlahSen: -1_000_000 },
      { id: "m3", tanggal: "2026-10-20", jumlahSen: 90_000_000 },
    ];
    const jurnal = [
      { id: "j1", tanggal: "2026-10-01", jumlahSen: -150_000_000 },
      { id: "j2", tanggal: "2026-10-04", jumlahSen: -150_000_000 },
      { id: "j3", tanggal: "2026-10-01", jumlahSen: -1_000_000 },
      { id: "j4", tanggal: "2026-10-20", jumlahSen: -90_000_000 },
    ];
    expect(cocokkanOtomatis(mutasi, jurnal)).toEqual([{ mutasiId: "m1", jurnalBarisId: "j2", selisihHari: 1 }]);
  });

  it("dua transaksi kembar mendapat pasangan berbeda; hasil tidak bergantung pada urutan masukan", () => {
    const mutasi = [
      { id: "a", tanggal: "2026-10-05", jumlahSen: -650_000 },
      { id: "b", tanggal: "2026-10-05", jumlahSen: -650_000 },
    ];
    const jurnal = [
      { id: "x", tanggal: "2026-10-05", jumlahSen: -650_000 },
      { id: "y", tanggal: "2026-10-05", jumlahSen: -650_000 },
      { id: "z", tanggal: "2026-10-06", jumlahSen: -650_000 },
    ];
    const satu = cocokkanOtomatis(mutasi, jurnal);
    const dua = cocokkanOtomatis([...mutasi].reverse(), [...jurnal].reverse());
    expect(satu).toEqual([
      { mutasiId: "a", jurnalBarisId: "x", selisihHari: 0 },
      { mutasiId: "b", jurnalBarisId: "y", selisihHari: 0 },
    ]);
    expect(dua).toEqual(satu);
  });

  it("tanda harus sama: uang masuk tidak pernah cocok dengan uang keluar", () => {
    expect(cocokkanOtomatis([{ id: "m", tanggal: "2026-10-05", jumlahSen: 100 }], [{ id: "j", tanggal: "2026-10-05", jumlahSen: -100 }])).toEqual([]);
  });

  it("selisih hari & arah baris bank", () => {
    expect(selisihHari("2026-12-30", "2027-01-02")).toBe(3);
    expect(jumlahSenBarisBank("1500000.00", 0)).toBe(150_000_000);
    expect(jumlahSenBarisBank(0, 10_000)).toBe(-1_000_000);
  });
});

describe("rekonsiliasi", () => {
  it("selisih nol bila semua belum-cocok menjelaskan bedanya", () => {
    // Bank 9.390.000; buku 9.000.000; setoran 400.000 belum di bank; biaya admin 10.000 belum dibukukan.
    const r = ringkasRekonsiliasi({
      saldoBukuSen: 900_000_000,
      saldoBankSen: 939_000_000,
      jurnalBelumCocok: [{ jumlahSen: 40_000_000 }, { jumlahSen: -80_000_000 }],
      mutasiBelumCocok: [{ jumlahSen: -1_000_000 }],
    });
    expect(r.saldoBankDisesuaikanSen).toBe(899_000_000);
    expect(r.saldoBukuDisesuaikanSen).toBe(899_000_000);
    expect(r.selisihSen).toBe(0);
    expect(r.cocok).toBe(true);
  });

  it("saldo bank tidak diketahui → selisih null", () => {
    const r = ringkasRekonsiliasi({ saldoBukuSen: 5, saldoBankSen: null, jurnalBelumCocok: [], mutasiBelumCocok: [] });
    expect(r.selisihSen).toBeNull();
    expect(r.cocok).toBe(false);
  });

  it("saldo bank: baris terakhir hari itu dipilih dari rantai saldonya, bukan urutan simpan", () => {
    const baris = [
      { tanggal: "2026-10-02", jumlahSen: 90_000_000, saldoSen: 939_000_000, urutan: 1 },
      { tanggal: "2026-10-02", jumlahSen: -1_000_000, saldoSen: 849_000_000, urutan: 2 },
      { tanggal: "2026-10-01", jumlahSen: -150_000_000, saldoSen: 850_000_000, urutan: 0 },
      { tanggal: "2026-10-09", jumlahSen: -5_000, saldoSen: 938_995_000, urutan: 3 },
    ];
    expect(saldoBankPadaTanggal(baris, "2026-10-02", null)).toBe(939_000_000);
    expect(saldoBankPadaTanggal(baris, "2026-10-01", null)).toBe(850_000_000);
    expect(saldoBankPadaTanggal(baris, "2026-09-30", null)).toBeNull();
    expect(saldoBankPadaTanggal(baris, "2026-09-30", { tanggal: "2026-10-01", sen: 1_000_000_000 })).toBeNull();
  });

  it("tanpa saldo per baris: saldo awal + Σ mutasi", () => {
    const baris = [
      { tanggal: "2026-10-01", jumlahSen: -100, saldoSen: null, urutan: 0 },
      { tanggal: "2026-10-03", jumlahSen: 500, saldoSen: null, urutan: 1 },
    ];
    expect(saldoBankPadaTanggal(baris, "2026-10-02", { tanggal: "2026-10-01", sen: 1000 })).toBe(900);
    expect(saldoBankPadaTanggal(baris, "2026-10-31", { tanggal: "2026-10-01", sen: 1000 })).toBe(1400);
  });
});
