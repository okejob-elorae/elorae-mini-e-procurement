import { describe, expect, it } from "vitest";
import type { BarisJual, TitikSalesman } from "./dasbor";
import type { TitikBulan } from "./riwayat-penjualan";
import { jumlahHp, komisiBisaNaikOlehKonsi, omzetTanpaKonsi, pcsKonsiBulan, seriHp, tanpaKonsi, trenHp } from "./penjualan-hp";

/*
 * Angka penjualan yang dikirim ke HP salesman. Aturan mutlak: rupiah
 * konsinyasi tidak pernah sampai ke HP — tidak sebagai kanal, tidak di dalam
 * total. Konsinyasi hanya sebagai pcs. Nilai konsi di sini sengaja angka yang
 * mudah dikenali (41.237) supaya tes bisa memastikan ia tidak ada di JSON.
 */

const KONSI = 41_237;
// 29 Sep 2026, 10:00 WIB.
const HARI_INI = new Date("2026-09-29T03:00:00Z");
const siang = (iso: string) => new Date(`${iso}T05:00:00Z`);

const baris: BarisJual[] = [
  { tanggal: siang("2026-09-03"), jenis: "putus", nilai: 49_500 },
  { tanggal: siang("2026-09-10"), jenis: "konsi", nilai: KONSI },
  { tanggal: siang("2026-09-12"), jenis: "van", nilai: 10_000 },
];

describe("tanpaKonsi", () => {
  it("membuang baris konsinyasi, putus dan van tetap", () => {
    expect(tanpaKonsi(baris).map((b) => b.jenis)).toEqual(["putus", "van"]);
  });
});

describe("jumlahHp", () => {
  it("total = putus + van; konsinyasi hanya pcs, tanpa kunci rupiah konsi", () => {
    // Bentuk omzet resmi (dengan konsi) masuk apa adanya — yang keluar tetap bersih.
    const resmi = { putus: 49_500, konsi: KONSI, van: 10_000, total: 49_500 + KONSI + 10_000 };
    const j = jumlahHp(resmi, 4);
    expect(j).toEqual({ putus: 49_500, van: 10_000, total: 59_500, pcsKonsi: 4 });
    expect(Object.keys(j)).not.toContain("konsi");
    expect(JSON.stringify(j)).not.toContain(String(KONSI));
    // Total resmi (dengan konsi) pun tidak boleh ikut: total − putus − van = konsi.
    expect(JSON.stringify(j)).not.toContain(String(49_500 + KONSI + 10_000));
  });

  it("menjumlah dalam sen: 49.500,10 + 7.000,20 tidak jadi 56.500,299999", () => {
    expect(jumlahHp({ putus: 49_500.1, van: 7_000.2 }, 0).total).toBe(56_500.3);
  });
});

describe("omzetTanpaKonsi", () => {
  it("bentuk omzet komisi dengan konsi nol, apa pun yang masuk", () => {
    const resmi = { putus: 49_500, konsi: KONSI, van: 10_000, total: 100_737 };
    expect(omzetTanpaKonsi(resmi)).toEqual({
      putus: 49_500,
      konsi: 0,
      van: 10_000,
      total: 59_500,
    });
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
  it("satu nilai per hari = putus + van; konsi tidak ikut", () => {
    const tren: TitikSalesman[] = [
      { tanggal: "2026-09-28", putus: 100, konsi: KONSI, van: 7 },
      { tanggal: "2026-09-29", putus: 0, konsi: 0, van: 0 },
    ];
    const hasil = trenHp(tren);
    expect(hasil).toEqual([
      { tanggal: "2026-09-28", nilai: 107 },
      { tanggal: "2026-09-29", nilai: 0 },
    ]);
    expect(JSON.stringify(hasil)).not.toContain(String(KONSI));
  });
});

describe("seriHp", () => {
  it("rupiah putus + van per bulan; konsi sebagai pcs bulan itu", () => {
    const seri: TitikBulan[] = [
      { bulan: "2026-08", putus: 20_000, konsi: 0, van: 0, total: 20_000 },
      { bulan: "2026-09", putus: 49_500, konsi: KONSI, van: 10_000, total: 49_500 + KONSI + 10_000 },
    ];
    const hasil = seriHp(seri, [{ tanggal: siang("2026-09-10"), pcs: 4 }], HARI_INI);
    expect(hasil).toEqual([
      { bulan: "2026-08", putus: 20_000, van: 0, total: 20_000, pcsKonsi: 0 },
      { bulan: "2026-09", putus: 49_500, van: 10_000, total: 59_500, pcsKonsi: 4 },
    ]);
    expect(JSON.stringify(hasil)).not.toContain(String(KONSI));
    expect(JSON.stringify(hasil)).not.toContain('"konsi"');
  });
});

describe("komisiBisaNaikOlehKonsi", () => {
  const berikut = { capaianPersen: 100, tarifPersen: 3, kurangNilai: 40_500 };
  it("dasar PENJUALAN: konsi masuk nilai dasar, jadi final bisa lebih tinggi", () => {
    expect(komisiBisaNaikOlehKonsi({ pcsKonsi: 4, dasar: "PENJUALAN", tingkatBerikut: null })).toBe(true);
  });
  it("dasar TERTAGIH: hanya bila masih ada tingkat tarif di atas", () => {
    expect(komisiBisaNaikOlehKonsi({ pcsKonsi: 4, dasar: "TERTAGIH", tingkatBerikut: berikut })).toBe(true);
    expect(komisiBisaNaikOlehKonsi({ pcsKonsi: 4, dasar: "TERTAGIH", tingkatBerikut: null })).toBe(false);
  });
  it("tanpa konsinyasi bulan itu: tidak pernah", () => {
    expect(komisiBisaNaikOlehKonsi({ pcsKonsi: 0, dasar: "PENJUALAN", tingkatBerikut: berikut })).toBe(false);
  });
});
