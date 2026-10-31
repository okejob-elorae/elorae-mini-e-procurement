import { describe, expect, it } from "vitest";
import {
  bacaPeriodeHari,
  bacaSaringMember,
  bacaStatusPelanggan,
  gabungRingkas,
  hariSejak,
  hitungSaringPelanggan,
  jendelaPeriode,
  kategoriFavorit,
  ringkasLacak,
  saringPelanggan,
  statusPelanggan,
  urutkanMember,
  urutkanPelanggan,
  type MasukanPelangganRingkas,
} from "./pelanggan-lacak";

const wib = (day: string, jam = "12:00") => new Date(`${day}T${jam}:00+07:00`);
// "Sekarang" 20 Okt 2026 pukul 00.30 WIB = 19 Okt 17.30 UTC: hari WIB sudah 20 Okt.
const SEKARANG = wib("2026-10-20", "00:30");

describe("periode", () => {
  it("reads only the offered periods and falls back to 90 days", () => {
    expect(bacaPeriodeHari("30")).toBe(30);
    expect(bacaPeriodeHari(["365"])).toBe(365);
    expect(bacaPeriodeHari("45")).toBe(90);
    expect(bacaPeriodeHari(undefined)).toBe(90);
  });

  it("covers the last N WIB calendar days including today, whatever the UTC date", () => {
    const j = jendelaPeriode(SEKARANG, 90);
    expect(j.hariAkhir).toBe("2026-10-20");
    expect(j.hariAwal).toBe("2026-07-23");
    expect(j.awal.toISOString()).toBe("2026-07-22T17:00:00.000Z");
    expect(j.akhir.toISOString()).toBe("2026-10-20T17:00:00.000Z");
    expect(jendelaPeriode(SEKARANG, 30).hariAwal).toBe("2026-09-21");
  });

  it("counts days since a purchase in WIB calendar days", () => {
    expect(hariSejak(wib("2026-10-20", "00:05"), SEKARANG)).toBe(0);
    // 23.59 WIB kemarin = kemarin, walau baru 31 menit yang lalu.
    expect(hariSejak(wib("2026-10-19", "23:59"), SEKARANG)).toBe(1);
    expect(hariSejak(wib("2026-07-22"), SEKARANG)).toBe(90);
  });
});

describe("statusPelanggan", () => {
  const o = { sekarang: SEKARANG, awalPeriode: jendelaPeriode(SEKARANG, 90).awal, hariTidur: 90 };

  it("no receipt is 'not bought yet', never active or dormant", () => {
    expect(statusPelanggan({ nota: 0, pertama: null, terakhir: null }, o)).toBe("BELUM_BELANJA");
  });

  it("new = first purchase inside the period and only one receipt", () => {
    expect(statusPelanggan({ nota: 1, pertama: wib("2026-10-01"), terakhir: wib("2026-10-01") }, o)).toBe("BARU");
    // Dua nota di dalam periode: sudah kembali, jadi aktif.
    expect(statusPelanggan({ nota: 2, pertama: wib("2026-10-01"), terakhir: wib("2026-10-10") }, o)).toBe("AKTIF");
    // Satu nota tetapi sebelum periode: aktif (belum tidur), bukan baru.
    expect(statusPelanggan({ nota: 1, pertama: wib("2026-07-22"), terakhir: wib("2026-07-23") }, { ...o, hariTidur: 120 })).toBe("AKTIF");
  });

  it("dormant from exactly hariTidur days without a purchase, and dormant wins over new", () => {
    expect(statusPelanggan({ nota: 3, pertama: wib("2026-01-01"), terakhir: wib("2026-07-22") }, o)).toBe("TIDUR");
    expect(statusPelanggan({ nota: 3, pertama: wib("2026-01-01"), terakhir: wib("2026-07-23") }, o)).toBe("AKTIF");
    // Periode 365 hari > hariTidur: satu nota 200 hari lalu = tidur, bukan baru.
    const panjang = { ...o, awalPeriode: jendelaPeriode(SEKARANG, 365).awal };
    expect(statusPelanggan({ nota: 1, pertama: wib("2026-04-03"), terakhir: wib("2026-04-03") }, panjang)).toBe("TIDUR");
  });
});

describe("kategoriFavorit", () => {
  it("picks the category with the most NET pieces and ignores lines without a category", () => {
    expect(
      kategoriFavorit([
        { kategori: "Kaos", qty: 3, kembali: 2 },
        { kategori: "Celana", qty: 2, kembali: 0 },
        { kategori: null, qty: 10, kembali: 0 },
        { kategori: "Kaos", qty: 1, kembali: 5 },
      ]),
    ).toEqual({ nama: "Celana", potong: 2 });
  });

  it("breaks ties by name and gives null when nothing net is left", () => {
    expect(kategoriFavorit([{ kategori: "Kemeja", qty: 2, kembali: 0 }, { kategori: "Celana", qty: 2, kembali: 0 }])).toEqual({ nama: "Celana", potong: 2 });
    expect(kategoriFavorit([{ kategori: "Kaos", qty: 2, kembali: 2 }])).toBeNull();
    expect(kategoriFavorit([])).toBeNull();
  });
});

describe("ringkasLacak", () => {
  const awalPeriode = jendelaPeriode(SEKARANG, 90).awal;
  const p = (phone: string, nota: number, pertama: string | null, terakhir: string | null, notaPeriode: number): MasukanPelangganRingkas => ({
    phone,
    nota,
    pertama: pertama ? wib(pertama) : null,
    terakhir: terakhir ? wib(terakhir) : null,
    notaPeriode,
  });
  const pelanggan = [
    p("6281", 1, "2026-10-01", "2026-10-01", 1), // baru
    p("6282", 3, "2026-01-01", "2026-10-15", 2), // kembali, aktif
    p("6283", 2, "2026-02-01", "2026-03-01", 0), // tidur
    p("6284", 0, null, null, 0), // belum belanja
  ];
  const r = ringkasLacak({ pelanggan, notaPeriode: 10, notaBerpembeli: 3, memberAktif: new Set(["6282", "6283", "6299"]), sekarang: SEKARANG, awalPeriode, hariTidur: 90 });

  it("measures coverage as receipts with a recorded buyer over ALL SPG receipts in the period", () => {
    expect(r).toMatchObject({ pelanggan: 4, notaPeriode: 10, notaBerpembeli: 3, cakupanPersen: 30 });
  });

  it("returning = buyers in the period that have at least two receipts", () => {
    expect(r).toMatchObject({ pembeliPeriode: 2, kembali: 1, kembaliPersen: 50 });
  });

  it("counts first purchases in the period, dormant and never-bought customers, and members among this store's customers only", () => {
    expect(r).toMatchObject({ baru: 1, tidur: 1, belumBelanja: 1, member: 2 });
  });

  it("leaves ratios empty — not zero — without a denominator", () => {
    const kosong = ringkasLacak({ pelanggan: [], notaPeriode: 0, notaBerpembeli: 0, memberAktif: new Set(), sekarang: SEKARANG, awalPeriode, hariTidur: 90 });
    expect(kosong.cakupanPersen).toBeNull();
    expect(kosong.kembaliPersen).toBeNull();
  });

  it("all stores: sums the counts, recomputes the ratios from the sums, and takes Elorae's active member count", () => {
    const lain = ringkasLacak({ pelanggan: [p("6281", 2, "2026-09-01", "2026-10-10", 2)], notaPeriode: 30, notaBerpembeli: 27, memberAktif: new Set(["6281"]), sekarang: SEKARANG, awalPeriode, hariTidur: 90 });
    const g = gabungRingkas([r, lain], 4);
    expect(g).toMatchObject({ pelanggan: 5, member: 4, notaPeriode: 40, notaBerpembeli: 30, pembeliPeriode: 3, kembali: 2, baru: 2, tidur: 1, belumBelanja: 1 });
    // (3 + 27) / (10 + 30) — bukan rata-rata 30% dan 90%.
    expect(g.cakupanPersen).toBeCloseTo(75);
    expect(g.kembaliPersen).toBeCloseTo((2 / 3) * 100);
  });
});

describe("daftar pelanggan", () => {
  const baris = [
    { id: "a", nama: "Ani", terakhir: "2026-10-01T05:00:00.000Z", status: "BARU" as const, member: null },
    { id: "b", nama: "Budi", terakhir: null, status: "BELUM_BELANJA" as const, member: { tingkat: "Gold", aktif: true } },
    { id: "c", nama: "Cici", terakhir: "2026-10-15T05:00:00.000Z", status: "AKTIF" as const, member: { tingkat: "Member", aktif: false } },
    { id: "d", nama: "Dodi", terakhir: "2026-10-15T05:00:00.000Z", status: "AKTIF" as const, member: { tingkat: "Silver", aktif: true } },
  ];

  it("sorts by last purchase, newest first, never-bought last, ties by name", () => {
    expect(urutkanPelanggan(baris).map((b) => b.id)).toEqual(["c", "d", "a", "b"]);
  });

  it("filters by status and by ACTIVE membership — a deactivated member counts as not a member", () => {
    expect(saringPelanggan(baris, { status: "AKTIF", member: null }).map((b) => b.id)).toEqual(["c", "d"]);
    expect(saringPelanggan(baris, { status: null, member: "ya" }).map((b) => b.id)).toEqual(["b", "d"]);
    expect(saringPelanggan(baris, { status: "AKTIF", member: "tidak" }).map((b) => b.id)).toEqual(["c"]);
    expect(hitungSaringPelanggan(baris)).toEqual({
      semua: 4,
      status: { BARU: 1, AKTIF: 2, TIDUR: 0, BELUM_BELANJA: 1 },
      member: { ya: 2, tidak: 2 },
    });
  });

  it("reads only known filter values from the address", () => {
    expect(bacaStatusPelanggan("TIDUR")).toBe("TIDUR");
    expect(bacaStatusPelanggan("tidur")).toBeNull();
    expect(bacaSaringMember("ya")).toBe("ya");
    expect(bacaSaringMember("semua")).toBeNull();
  });

  it("lists members newest first", () => {
    expect(
      urutkanMember([
        { id: "1", nama: "B", bergabung: "2026-09-01T00:00:00.000Z" },
        { id: "2", nama: "A", bergabung: "2026-10-01T00:00:00.000Z" },
        { id: "3", nama: "C", bergabung: "2026-09-01T00:00:00.000Z" },
      ]).map((m) => m.id),
    ).toEqual(["2", "1", "3"]);
  });
});
