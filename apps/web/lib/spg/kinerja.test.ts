import { describe, expect, it } from "vitest";
import {
  bagiPengunjungHari,
  hariSebulan,
  ringkasKinerja,
  simpulkanHari,
  urutkanBaris,
  type HariKinerja,
  type LainKinerja,
} from "./kinerja";

// 3 Okt 2026 (Sabtu) 12.00 WIB.
const SEKARANG = new Date("2026-10-03T05:00:00Z");
const HARI_INI = "2026-10-03";
const wib = (day: string, jam: string) => new Date(`${day}T${jam}:00+07:00`);
const KERJA = { kind: "KERJA", startTime: "10:00" };

const simpul = (o: Partial<Parameters<typeof simpulkanHari>[0]>) =>
  simpulkanHari({
    day: "2026-10-02",
    sel: KERJA,
    checkin: null,
    izin: null,
    hariIni: HARI_INI,
    sekarang: SEKARANG,
    toleransiMenit: 15,
    liburSpg: [],
    ...o,
  });

describe("simpulkanHari", () => {
  it("is on time up to start + tolerance, late after it, counting minutes from the start", () => {
    expect(simpul({ checkin: wib("2026-10-02", "10:10") })).toMatchObject({ masuk: true, terlambatMenit: null, dijadwalkan: true, tidakMasuk: false });
    // Tepat di batas toleransi belum terlambat.
    expect(simpul({ checkin: wib("2026-10-02", "10:15") }).terlambatMenit).toBeNull();
    expect(simpul({ checkin: wib("2026-10-02", "10:20") })).toMatchObject({ masuk: true, terlambatMenit: 20 });
  });

  it("counts a scheduled past day with no check-in and no approved leave as absent", () => {
    expect(simpul({})).toMatchObject({ tidakMasuk: true, masuk: false, izin: null, dijadwalkan: true });
  });

  it("an approved leave on a scheduled day is a leave day, not an absence", () => {
    expect(simpul({ izin: "SAKIT" })).toMatchObject({ tidakMasuk: false, izin: "SAKIT" });
    // Datang juga di hari izinnya: masuk, bukan izin.
    expect(simpul({ izin: "SAKIT", checkin: wib("2026-10-02", "09:55") })).toMatchObject({ masuk: true, izin: null });
  });

  it("does not judge today before it is over, nor future days", () => {
    expect(simpul({ day: HARI_INI })).toMatchObject({ dijadwalkan: true, tidakMasuk: false });
    expect(simpul({ day: "2026-10-05" })).toMatchObject({ dijadwalkan: false, kenyataan: null, tidakMasuk: false, masuk: false });
  });

  it("counts leave only on working days: never on a scheduled day off, and by the SPG working days when unscheduled", () => {
    expect(simpul({ sel: { kind: "LIBUR", startTime: null }, izin: "CUTI" })).toMatchObject({ izin: null, libur: true, tidakMasuk: false });
    // 2026-10-04 Minggu. Tanpa jadwal: hari kerja SPG menurut pengaturan.
    expect(simpul({ day: "2026-09-27", sel: null, izin: "CUTI", liburSpg: [0] }).izin).toBeNull();
    expect(simpul({ day: "2026-09-27", sel: null, izin: "CUTI", liburSpg: [] }).izin).toBe("CUTI");
    expect(simpul({ day: "2026-09-27", sel: null, izin: "BUKAN_JENIS" }).izin).toBeNull();
  });

  it("without a schedule a check-in is simply a day present — never late, never absent", () => {
    expect(simpul({ sel: null, checkin: wib("2026-10-02", "13:00") })).toMatchObject({ masuk: true, terlambatMenit: null, dijadwalkan: false });
    expect(simpul({ sel: null })).toMatchObject({ masuk: false, tidakMasuk: false, dijadwalkan: false });
  });
});

describe("bagiPengunjungHari", () => {
  it("uses each SPG's own counter", () => {
    const r = bagiPengunjungHari({ hitungan: new Map([["a", 30], ["b", 12]]), tutup: null, hadir: ["a", "b"] });
    expect([...r]).toEqual([
      ["a", { jumlah: 30, dariTutup: false }],
      ["b", { jumlah: 12, dariTutup: false }],
    ]);
  });

  it("without counters splits the daily-close figure evenly among the SPGs present, largest remainder by id", () => {
    const r = bagiPengunjungHari({ hitungan: new Map(), tutup: 7, hadir: ["b", "a", "a"] });
    expect(r.get("a")).toEqual({ jumlah: 4, dariTutup: true });
    expect(r.get("b")).toEqual({ jumlah: 3, dariTutup: true });
  });

  it("gives only the part of the daily close the counters did not cover to the SPG who did not count", () => {
    const r = bagiPengunjungHari({ hitungan: new Map([["a", 30]]), tutup: 50, hadir: ["a", "b"] });
    expect(r.get("a")).toEqual({ jumlah: 30, dariTutup: false });
    expect(r.get("b")).toEqual({ jumlah: 20, dariTutup: true });
  });

  it("leaves an SPG without a counter unknown when nothing is left over, and gives nobody a figure when nobody was present", () => {
    expect(bagiPengunjungHari({ hitungan: new Map([["a", 30]]), tutup: 25, hadir: ["a", "b"] }).has("b")).toBe(false);
    expect(bagiPengunjungHari({ hitungan: new Map(), tutup: 40, hadir: [] }).size).toBe(0);
  });
});

const hari = (o: Partial<HariKinerja>): HariKinerja => ({
  day: "2026-10-01",
  kenyataan: null,
  dijadwalkan: false,
  masuk: false,
  terlambatMenit: null,
  tidakMasuk: false,
  izin: null,
  libur: false,
  nota: 0,
  potong: 0,
  nilaiSen: 0,
  pengunjung: null,
  pengunjungDariTutup: false,
  tutup: false,
  ...o,
});
const LAIN: LainKinerja = {
  jadwalDisusun: true,
  titipDibuat: 3,
  titipSelesai: 1,
  qtyTerjual: 20,
  qtyKembali: 2,
  target: 2_000_000,
  nilaiOrang: 500_000,
  notaBerpembeli: 2,
  memberBaru: 1,
};

describe("ringkasKinerja", () => {
  const daftar = [
    hari({ day: "2026-10-01", dijadwalkan: true, masuk: true, terlambatMenit: 20, nota: 4, potong: 6, nilaiSen: 40_000_000, pengunjung: 20, tutup: true }),
    hari({ day: "2026-10-02", dijadwalkan: true, masuk: true, terlambatMenit: 5, nota: 2, potong: 3, nilaiSen: 10_000_000, pengunjung: null }),
    hari({ day: "2026-10-03", dijadwalkan: true, tidakMasuk: true }),
    hari({ day: "2026-10-04", izin: "SAKIT" }),
    hari({ day: "2026-10-05", nota: 1, potong: 1, nilaiSen: 5_000_000, pengunjung: 5, pengunjungDariTutup: true, tutup: true }),
  ];

  it("adds up attendance, lateness and sales", () => {
    const r = ringkasKinerja(daftar, LAIN);
    expect(r).toMatchObject({
      hariDijadwalkan: 3,
      hariMasuk: 2,
      terlambatKali: 2,
      terlambatMenit: 25,
      tidakMasuk: 1,
      hariIzin: 1,
      nota: 7,
      potong: 10,
      nilai: 550_000,
      titipDibuat: 3,
      titipSelesai: 1,
    });
    expect(r.rataNota).toBeCloseTo(550_000 / 7);
  });

  it("converts only on days whose visitor count is known, and flags days filled from the daily close", () => {
    const r = ringkasKinerja(daftar, LAIN);
    expect(r.pengunjung).toBe(25);
    expect(r.hariPengunjungDariTutup).toBe(1);
    // Hari 2 Okt (2 nota) tanpa angka pengunjung tidak ikut: (4 + 1) / 25.
    expect(r.konversiPersen).toBeCloseTo(20);
  });

  it("measures day-close compliance over days with sales, returns over pieces sold, and achievement over the monthly target", () => {
    const r = ringkasKinerja(daftar, LAIN);
    expect(r.hariJual).toBe(3);
    expect(r.hariJualDitutup).toBe(2);
    expect(r.kepatuhanTutupPersen).toBeCloseTo(66.67, 1);
    expect(r.persenKembali).toBeCloseTo(10);
    expect(r.capaianPersen).toBeCloseTo(25);
  });

  it("shows schedule columns as unknown — not zero — when no schedule was made, and leaves empty ratios empty", () => {
    const r = ringkasKinerja([hari({ masuk: true })], { ...LAIN, jadwalDisusun: false, target: null, qtyTerjual: 0, qtyKembali: 0 });
    expect(r).toMatchObject({
      jadwalDisusun: false,
      hariDijadwalkan: null,
      terlambatKali: null,
      terlambatMenit: null,
      tidakMasuk: null,
      hariMasuk: 1,
      rataNota: null,
      pengunjung: null,
      konversiPersen: null,
      kepatuhanTutupPersen: null,
      persenKembali: null,
      capaianPersen: null,
      persenBerpembeli: null,
    });
  });

  it("measures receipts with a recorded buyer over all receipts and carries the new members", () => {
    const r = ringkasKinerja(daftar, LAIN);
    expect(r.notaBerpembeli).toBe(2);
    expect(r.persenBerpembeli).toBeCloseTo((2 / 7) * 100);
    expect(r.memberBaru).toBe(1);
    // Tidak pernah di atas 100%, walau angka berpembeli lebih besar dari nota harian yang dihitung.
    expect(ringkasKinerja(daftar, { ...LAIN, notaBerpembeli: 9 }).persenBerpembeli).toBe(100);
  });
});

describe("urutkanBaris", () => {
  const baris = [
    { nama: "Budi", n: 3 as number | null },
    { nama: "Ani", n: null },
    { nama: "Cici", n: 10 },
    { nama: "Dodi", n: 3 },
  ];
  it("sorts both ways with empty values always last and ties broken by name", () => {
    expect(urutkanBaris(baris, (b) => b.n, "naik", (b) => b.nama).map((b) => b.nama)).toEqual(["Budi", "Dodi", "Cici", "Ani"]);
    expect(urutkanBaris(baris, (b) => b.n, "turun", (b) => b.nama).map((b) => b.nama)).toEqual(["Cici", "Budi", "Dodi", "Ani"]);
    expect(urutkanBaris(baris, (b) => b.nama, "turun", (b) => b.nama).map((b) => b.nama)).toEqual(["Dodi", "Cici", "Budi", "Ani"]);
  });
});

describe("hariSebulan", () => {
  it("lists every calendar day of the month", () => {
    expect(hariSebulan("2028-02")).toHaveLength(29);
    expect(hariSebulan("2026-10")[30]).toBe("2026-10-31");
  });
});
