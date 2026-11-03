import { describe, expect, it } from "vitest";
import type { TitikSalesman } from "./dasbor";
import type { TitikBulan } from "./riwayat-penjualan";
import { jumlahHp, pcsKonsiBulan, seriHp, trenHp } from "./penjualan-hp";

/*
 * Angka penjualan yang dikirim ke HP salesman. Jawaban pemilik 2026-11-02 (P18,
 * P56 "tampilkan semuanya saja"): angka HP = angka kantor — rupiah konsinyasi
 * laku ikut di setiap total, dan pcs konsinyasi tetap ditunjukkan.
 */

const KONSI = 41_237;
// 29 Sep 2026, 10:00 WIB.
const HARI_INI = new Date("2026-09-29T03:00:00Z");
const siang = (iso: string) => new Date(`${iso}T05:00:00Z`);

describe("jumlahHp", () => {
  it("total = putus + konsi + van, dengan pcs konsinyasi", () => {
    const resmi = { putus: 49_500, konsi: KONSI, van: 10_000 };
    expect(jumlahHp(resmi, 4)).toEqual({ putus: 49_500, konsi: KONSI, van: 10_000, total: 49_500 + KONSI + 10_000, pcsKonsi: 4 });
  });

  it("menjumlah dalam sen: 49.500,10 + 0,40 + 7.000,20 tidak jadi 56.500,699999", () => {
    expect(jumlahHp({ putus: 49_500.1, konsi: 0.4, van: 7_000.2 }, 0).total).toBe(56_500.7);
  });
});

describe("pcsKonsiBulan", () => {
  const pcs = [
    { tanggal: siang("2026-08-31"), pcs: 9 },
    // 23.30 WIB 31 Agustus = 16.30 UTC: masih Agustus.
    { tanggal: new Date("2026-08-31T16:30:00Z"), pcs: 2 },
    // 00.30 WIB 1 September = 17.30 UTC 31 Agustus: sudah September.
    { tanggal: new Date("2026-08-31T17:30:00Z"), pcs: 3 },
    { tanggal: siang("2026-09-10"), pcs: 4 },
    // Sesudah hari ini (WIB): tidak dihitung, sama dengan rupiahnya.
    { tanggal: siang("2026-09-30"), pcs: 50 },
  ];

  it("menjumlah pcs per bulan kalender WIB sampai hari ini", () => {
    expect(pcsKonsiBulan(pcs, "2026-09", HARI_INI)).toBe(7);
    expect(pcsKonsiBulan(pcs, "2026-08", HARI_INI)).toBe(11);
    expect(pcsKonsiBulan(pcs, "2026-07", HARI_INI)).toBe(0);
  });
});

describe("trenHp", () => {
  it("satu nilai per hari = putus + konsi + van", () => {
    const tren: TitikSalesman[] = [
      { tanggal: "2026-09-28", putus: 100, konsi: KONSI, van: 7 },
      { tanggal: "2026-09-29", putus: 0, konsi: 0, van: 0 },
    ];
    expect(trenHp(tren)).toEqual([
      { tanggal: "2026-09-28", nilai: 107 + KONSI },
      { tanggal: "2026-09-29", nilai: 0 },
    ]);
  });
});

describe("seriHp", () => {
  it("rupiah putus + konsi + van per bulan, ditambah pcs konsi bulan itu", () => {
    const seri: TitikBulan[] = [
      { bulan: "2026-08", putus: 20_000, konsi: 0, van: 0, total: 20_000 },
      { bulan: "2026-09", putus: 49_500, konsi: KONSI, van: 10_000, total: 49_500 + KONSI + 10_000 },
    ];
    expect(seriHp(seri, [{ tanggal: siang("2026-09-10"), pcs: 4 }], HARI_INI)).toEqual([
      { bulan: "2026-08", putus: 20_000, konsi: 0, van: 0, total: 20_000, pcsKonsi: 0 },
      { bulan: "2026-09", putus: 49_500, konsi: KONSI, van: 10_000, total: 49_500 + KONSI + 10_000, pcsKonsi: 4 },
    ]);
  });
});
