import { describe, expect, it } from "vitest";
import {
  akhirMasaManfaat,
  akumulasiTargetSampai,
  dalamMasaManfaat,
  jadwalPenyusutan,
  jumlahPenyusutanBulan,
  type SpesifikasiPenyusutan,
} from "./jadwal";

const GL = "STRAIGHT_LINE" as const;
const SM = "DECLINING_BALANCE" as const;

function spek(isi: Partial<SpesifikasiPenyusutan>): SpesifikasiPenyusutan {
  return { biaya: 48_000_000, nilaiSisa: 0, umurBulan: 48, metode: GL, tarifSaldoMenurun: null, mulai: { tahun: 2026, bulan: 1 }, ...isi };
}

const jumlahSen = (xs: number[]) => xs.reduce((s, x) => s + Math.round(x * 100), 0) / 100;

describe("jadwal penyusutan — garis lurus", () => {
  it("kelompok 1: 48 bulan × Rp1.000.000, berakhir Desember tahun keempat", () => {
    const j = jadwalPenyusutan(spek({}));
    expect(j).toHaveLength(48);
    expect(j[0]).toMatchObject({ periode: "2026-01", jumlah: 1_000_000, akumulasi: 1_000_000, nilaiBuku: 47_000_000 });
    expect(j.at(-1)).toMatchObject({ periode: "2029-12", akumulasi: 48_000_000, nilaiBuku: 0 });
    expect(akhirMasaManfaat(spek({}))).toEqual({ tahun: 2029, bulan: 12 });
  });

  it("pembulatan per sen: jumlahnya persis sama dengan harga perolehan", () => {
    const j = jadwalPenyusutan(spek({ biaya: 10_000_000 }));
    expect(jumlahSen(j.map((b) => b.jumlah))).toBe(10_000_000);
    for (const b of j) expect(Math.abs(b.jumlah - 208_333.33)).toBeLessThanOrEqual(0.011);
  });

  it("nilai sisa (komersial) tidak ikut disusutkan", () => {
    const j = jadwalPenyusutan(spek({ biaya: 12_000_000, nilaiSisa: 2_000_000, umurBulan: 10 }));
    expect(j.map((b) => b.jumlah)).toEqual(Array(10).fill(1_000_000));
    expect(j.at(-1)?.nilaiBuku).toBe(2_000_000);
  });

  it("tanah (umur 0) tidak punya jadwal", () => {
    expect(jadwalPenyusutan(spek({ umurBulan: 0 }))).toEqual([]);
    expect(akumulasiTargetSampai(spek({ umurBulan: 0 }), { tahun: 2030, bulan: 1 })).toBe(0);
    expect(dalamMasaManfaat(spek({ umurBulan: 0 }), { tahun: 2026, bulan: 1 })).toBe(false);
  });
});

describe("jadwal penyusutan — saldo menurun (fiskal)", () => {
  it("kelompok 1 mulai Januari: 50% atas nilai buku awal tahun, tahun terakhir menghabiskan sisa", () => {
    const j = jadwalPenyusutan(spek({ biaya: 100_000_000, metode: SM, tarifSaldoMenurun: 50 }));
    const perTahun = (th: number) => jumlahSen(j.filter((b) => b.periode.startsWith(String(th))).map((b) => b.jumlah));
    expect(perTahun(2026)).toBe(50_000_000);
    expect(perTahun(2027)).toBe(25_000_000);
    expect(perTahun(2028)).toBe(12_500_000);
    expect(perTahun(2029)).toBe(12_500_000);
    expect(j.at(-1)).toMatchObject({ periode: "2029-12", nilaiBuku: 0 });
  });

  it("perolehan Juli: tahun pertama pro rata 6/12, masa manfaat berakhir Juni tahun kelima dengan sisa dihabiskan", () => {
    const j = jadwalPenyusutan(spek({ biaya: 100_000_000, metode: SM, tarifSaldoMenurun: 50, mulai: { tahun: 2026, bulan: 7 } }));
    const perTahun = (th: number) => jumlahSen(j.filter((b) => b.periode.startsWith(String(th))).map((b) => b.jumlah));
    expect(perTahun(2026)).toBe(25_000_000);
    expect(perTahun(2027)).toBe(37_500_000);
    expect(perTahun(2028)).toBe(18_750_000);
    expect(perTahun(2029)).toBe(9_375_000);
    expect(perTahun(2030)).toBe(9_375_000);
    expect(j.at(-1)?.periode).toBe("2030-06");
    expect(jumlahSen(j.map((b) => b.jumlah))).toBe(100_000_000);
  });

  it("tidak pernah menyusutkan di bawah nilai sisa", () => {
    const j = jadwalPenyusutan(spek({ biaya: 10_000_000, nilaiSisa: 6_000_000, umurBulan: 24, metode: SM, tarifSaldoMenurun: 100 }));
    expect(Math.min(...j.map((b) => b.nilaiBuku))).toBe(6_000_000);
    expect(jumlahSen(j.map((b) => b.jumlah))).toBe(4_000_000);
  });
});

describe("jumlah penyusutan yang diposting sebulan", () => {
  it("di luar masa manfaat: target nol sebelum mulai, penuh sesudah berakhir", () => {
    expect(akumulasiTargetSampai(spek({}), { tahun: 2025, bulan: 12 })).toBe(0);
    expect(akumulasiTargetSampai(spek({}), { tahun: 2031, bulan: 1 })).toBe(48_000_000);
  });

  it("aset lama: akumulasi awal menutup bulan-bulan sebelumnya, bulan pertama di sistem satu bulan", () => {
    const s = spek({ mulai: { tahun: 2024, bulan: 1 } });
    expect(jumlahPenyusutanBulan(s, { tahun: 2026, bulan: 9 }, { akumulasiAwal: 33_000_000, sudahDiposting: 0 })).toBe(0);
    expect(jumlahPenyusutanBulan(s, { tahun: 2026, bulan: 10 }, { akumulasiAwal: 33_000_000, sudahDiposting: 0 })).toBe(1_000_000);
  });

  it("bulan yang terlewat (periode ditutup) disusulkan di bulan berikutnya", () => {
    expect(jumlahPenyusutanBulan(spek({}), { tahun: 2026, bulan: 3 }, { akumulasiAwal: 0, sudahDiposting: 1_000_000 })).toBe(2_000_000);
  });

  it("yang sudah diposting di bulan sesudahnya ikut dihitung — total tidak pernah melebihi target", () => {
    expect(jumlahPenyusutanBulan(spek({}), { tahun: 2026, bulan: 1 }, { akumulasiAwal: 0, sudahDiposting: 2_000_000 })).toBe(0);
  });

  it("tidak pernah melebihi sisa yang bisa disusutkan", () => {
    expect(jumlahPenyusutanBulan(spek({}), { tahun: 2031, bulan: 1 }, { akumulasiAwal: 47_500_000, sudahDiposting: 0 })).toBe(500_000);
    expect(jumlahPenyusutanBulan(spek({}), { tahun: 2031, bulan: 1 }, { akumulasiAwal: 50_000_000, sudahDiposting: 0 })).toBe(0);
  });
});
