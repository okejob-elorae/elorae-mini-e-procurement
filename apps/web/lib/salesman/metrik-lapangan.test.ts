import { describe, expect, it } from "vitest";
import type { TokoRencana } from "./dasbor";
import type { TokoMenurun } from "./toko-menurun";
import {
  adaKegiatan,
  awalHari,
  bacaRentang,
  bacaTanggalHariIni,
  batasRentang,
  hariDalamRentang,
  hitungMetrikLapangan,
  jumlahkanMetrik,
  kalimatRingkasan,
  kalimatRingkasanTim,
  MAKS_HARI_RENTANG,
  rencanaVsRealisasi,
  rentangPreset,
  rincianKunjungan,
  sahKunciHari,
  TENGGANG_MENIT,
  tujuhHariTerakhir,
  type BahanMetrik,
  type KunjunganBahan,
  type PesananBahan,
} from "./metrik-lapangan";

// Rabu 30 Sep 2026, 17:00 WIB.
const SEKARANG = new Date("2026-09-30T10:00:00Z");
const HARI = "2026-09-30";
/** Jam WIB pada 30 Sep 2026. */
const jam = (hhmm: string, tanggal = HARI) => new Date(`${tanggal}T${hhmm}:00+07:00`);
const rapi = (s: string) => s.replace(/\u00a0/g, " ");

const kosong = (): BahanMetrik => ({ kunjungan: [], pesanan: [], klaim: [], retur: [], van: [], tokoBaru: [] });

let urut = 0;
const kunjungan = (x: Partial<KunjunganBahan> & { storeId: string; checkinAt: Date }): KunjunganBahan => ({
  id: `v${++urut}`,
  checkoutAt: null,
  outcome: null,
  diLuarRadius: false,
  tanda: null,
  ...x,
});
const pesanan = (x: Partial<PesananBahan> & { storeId: string; createdAt: Date }): PesananBahan => ({
  id: `o${++urut}`,
  visitId: null,
  orderType: "PUTUS",
  status: "PENDING_APPROVAL",
  total: 1_000_000,
  jarakJauh: false,
  ...x,
});

// ─── Tanggal & rentang ──────────────────────────────────────────────────────

describe("kunci hari", () => {
  it("hanya YYYY-MM-DD yang merupakan hari kalender sungguhan", () => {
    expect(sahKunciHari("2026-09-30")).toBe(true);
    expect(sahKunciHari("2026-02-30")).toBe(false);
    expect(sahKunciHari("2026-9-30")).toBe(false);
    expect(sahKunciHari("kemarin")).toBe(false);
    expect(sahKunciHari(undefined)).toBe(false);
    expect(sahKunciHari(20260930)).toBe(false);
  });

  it("awal hari = tengah malam WIB, bukan UTC", () => {
    expect(awalHari("2026-09-30").toISOString()).toBe("2026-09-29T17:00:00.000Z");
  });

  it("batas rentang setengah terbuka: sampai hari terakhir pukul 24.00 WIB", () => {
    const b = batasRentang({ dari: "2026-09-01", sampai: "2026-09-30" });
    expect(b.mulai.toISOString()).toBe("2026-08-31T17:00:00.000Z");
    expect(b.akhir.toISOString()).toBe("2026-09-30T17:00:00.000Z");
  });

  it("hari dalam rentang, melewati pergantian bulan", () => {
    expect(hariDalamRentang({ dari: "2026-09-29", sampai: "2026-10-02" })).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
    expect(hariDalamRentang({ dari: HARI, sampai: HARI })).toEqual([HARI]);
  });
});

describe("rentangPreset & bacaRentang", () => {
  it("hari ini / minggu ini (mulai Senin) / bulan ini — semuanya berakhir hari ini", () => {
    expect(rentangPreset("hari", SEKARANG)).toEqual({ dari: HARI, sampai: HARI });
    expect(rentangPreset("minggu", SEKARANG)).toEqual({ dari: "2026-09-28", sampai: HARI });
    expect(rentangPreset("bulan", SEKARANG)).toEqual({ dari: "2026-09-01", sampai: HARI });
  });

  it("minggu ini pada hari Minggu dimulai Senin enam hari sebelumnya", () => {
    const minggu = new Date("2026-10-04T05:00:00Z");
    expect(rentangPreset("minggu", minggu)).toEqual({ dari: "2026-09-28", sampai: "2026-10-04" });
  });

  it("hari WIB, bukan UTC: 00.30 WIB tanggal 1 sudah bulan baru", () => {
    const tengahMalam = new Date("2026-09-30T17:30:00Z");
    expect(rentangPreset("bulan", tengahMalam)).toEqual({ dari: "2026-10-01", sampai: "2026-10-01" });
  });

  it("tanpa parameter → hari ini", () => {
    expect(bacaRentang({}, SEKARANG)).toEqual({ preset: "hari", rentang: { dari: HARI, sampai: HARI } });
    expect(bacaRentang({ rentang: "tahun" }, SEKARANG).preset).toBe("hari");
  });

  it("kustom: dibalik bila terbalik, satu tanggal saja jadi satu hari", () => {
    expect(bacaRentang({ rentang: "kustom", dari: "2026-09-20", sampai: "2026-09-10" }, SEKARANG)).toEqual({
      preset: "kustom",
      rentang: { dari: "2026-09-10", sampai: "2026-09-20" },
    });
    expect(bacaRentang({ rentang: "kustom", dari: "2026-09-12" }, SEKARANG)).toEqual({
      preset: "kustom",
      rentang: { dari: "2026-09-12", sampai: "2026-09-12" },
    });
  });

  it("kustom rusak → kembali ke hari ini", () => {
    expect(bacaRentang({ rentang: "kustom", dari: "x", sampai: "2026-02-31" }, SEKARANG)).toEqual({
      preset: "hari",
      rentang: { dari: HARI, sampai: HARI },
    });
  });

  it(`kustom lebih dari ${MAKS_HARI_RENTANG} hari dipotong dari depan`, () => {
    const r = bacaRentang({ rentang: "kustom", dari: "2020-01-01", sampai: "2026-09-30" }, SEKARANG);
    expect(r.rentang.sampai).toBe("2026-09-30");
    expect(hariDalamRentang(r.rentang)).toHaveLength(MAKS_HARI_RENTANG);
  });
});

describe("tanggal layar Hari Ini (HP)", () => {
  it("tujuh hari terakhir, hari ini paling depan", () => {
    expect(tujuhHariTerakhir(SEKARANG)).toEqual([
      "2026-09-30",
      "2026-09-29",
      "2026-09-28",
      "2026-09-27",
      "2026-09-26",
      "2026-09-25",
      "2026-09-24",
    ]);
  });

  it("hanya tanggal di tujuh hari itu yang diterima; lainnya jadi hari ini", () => {
    expect(bacaTanggalHariIni("2026-09-24", SEKARANG)).toBe("2026-09-24");
    expect(bacaTanggalHariIni("2026-09-23", SEKARANG)).toBe(HARI);
    expect(bacaTanggalHariIni("2026-10-01", SEKARANG)).toBe(HARI);
    expect(bacaTanggalHariIni(["2026-09-25"], SEKARANG)).toBe("2026-09-25");
    expect(bacaTanggalHariIni(undefined, SEKARANG)).toBe(HARI);
  });
});

// ─── Kunjungan efektif ──────────────────────────────────────────────────────

describe("rincianKunjungan — kunjungan efektif", () => {
  it("hasil TRANSAKSI atau TRANSAKSI_TERTUNDA efektif walau dokumennya belum terlihat", () => {
    const b = kosong();
    b.kunjungan = [
      kunjungan({ storeId: "s1", checkinAt: jam("09:00"), checkoutAt: jam("09:20"), outcome: "TRANSAKSI" }),
      kunjungan({ storeId: "s2", checkinAt: jam("10:00"), checkoutAt: jam("10:20"), outcome: "TRANSAKSI_TERTUNDA" }),
      kunjungan({ storeId: "s3", checkinAt: jam("11:00"), checkoutAt: jam("11:20"), outcome: "HARGA" }),
    ];
    expect(rincianKunjungan(b, SEKARANG).map((r) => r.efektif)).toEqual([true, true, false]);
  });

  it("pesanan yang terikat visitId membuat kunjungan efektif — juga yang ditolak kemudian", () => {
    const b = kosong();
    const v = kunjungan({ storeId: "s1", checkinAt: jam("09:00"), checkoutAt: jam("09:30") });
    b.kunjungan = [v];
    b.pesanan = [pesanan({ storeId: "s1", visitId: v.id, createdAt: jam("13:00"), status: "REJECTED" })];
    const [r] = rincianKunjungan(b, SEKARANG);
    // Transaksinya terjadi di kunjungan itu; ditolak kantor sesudahnya tidak mengubah kerja lapangannya.
    expect(r.efektif).toBe(true);
    expect(r.pesanan).toBe(0);
    expect(r.pesananDitolak).toBe(1);
  });

  it("satu dokumen hanya milik satu kunjungan: yang check-in-nya paling akhir sebelum dokumen itu", () => {
    const b = kosong();
    b.kunjungan = [
      kunjungan({ storeId: "s1", checkinAt: jam("09:00"), checkoutAt: jam("09:30") }),
      kunjungan({ storeId: "s1", checkinAt: jam("09:45"), checkoutAt: jam("10:00") }),
    ];
    // 09.50: masih di tenggang kunjungan pertama, tapi sudah di dalam kunjungan kedua.
    b.klaim = [{ id: "k1", storeId: "s1", status: "DIKIRIM", nilai: 1, createdAt: jam("09:50"), verifiedAt: null }];
    expect(rincianKunjungan(b, SEKARANG).map((r) => r.klaim)).toEqual([0, 1]);
  });

  it("klaim, retur, van dan pesanan tanpa visitId: toko sama, di jendela kunjungan (+ tenggang)", () => {
    expect(TENGGANG_MENIT).toBe(30);
    const b = kosong();
    b.kunjungan = [kunjungan({ storeId: "s1", checkinAt: jam("09:00"), checkoutAt: jam("09:30") })];
    b.klaim = [{ id: "k1", storeId: "s1", status: "DIKIRIM", nilai: 500_000, createdAt: jam("09:55"), verifiedAt: null }];
    const [r] = rincianKunjungan(b, SEKARANG);
    expect(r.efektif).toBe(true);
    expect(r.klaim).toBe(1);
    expect(r.nilaiKlaim).toBe(500_000);
  });

  it("dokumen toko lain, sebelum check-in, atau lewat tenggang tidak dihitung", () => {
    const b = kosong();
    b.kunjungan = [kunjungan({ storeId: "s1", checkinAt: jam("09:00"), checkoutAt: jam("09:30") })];
    b.klaim = [
      { id: "k1", storeId: "s2", status: "DIKIRIM", nilai: 1, createdAt: jam("09:10"), verifiedAt: null },
      { id: "k2", storeId: "s1", status: "DIKIRIM", nilai: 1, createdAt: jam("08:59"), verifiedAt: null },
      { id: "k3", storeId: "s1", status: "DIKIRIM", nilai: 1, createdAt: jam("10:01"), verifiedAt: null },
    ];
    b.retur = [{ id: "r1", storeId: "s2", status: "MENUNGGU", createdAt: jam("09:10") }];
    b.van = [{ id: "n1", storeId: null, total: 10, createdAt: jam("09:10") }];
    b.pesanan = [pesanan({ storeId: "s2", createdAt: jam("09:10") })];
    expect(rincianKunjungan(b, SEKARANG)[0].efektif).toBe(false);
  });

  it("pesanan milik kunjungan LAIN tidak ditautkan lewat toko+waktu", () => {
    const b = kosong();
    const a = kunjungan({ storeId: "s1", checkinAt: jam("09:00"), checkoutAt: jam("09:30") });
    b.kunjungan = [a];
    b.pesanan = [pesanan({ storeId: "s1", visitId: "kunjungan-kemarin", createdAt: jam("09:10") })];
    expect(rincianKunjungan(b, SEKARANG)[0].efektif).toBe(false);
  });

  it("kunjungan terbuka: jendelanya sampai sekarang (hari ini) atau akhir hari check-in (hari lalu)", () => {
    const b = kosong();
    b.kunjungan = [
      kunjungan({ storeId: "s1", checkinAt: jam("16:00") }),
      kunjungan({ storeId: "s2", checkinAt: jam("16:00", "2026-09-29") }),
    ];
    b.retur = [
      { id: "r1", storeId: "s1", status: "MENUNGGU", createdAt: jam("16:50") },
      { id: "r2", storeId: "s2", status: "MENUNGGU", createdAt: jam("08:00") },
    ];
    const [hariIni, kemarin] = rincianKunjungan(b, SEKARANG);
    expect(hariIni.efektif).toBe(true);
    expect(hariIni.durasiMenit).toBeNull();
    expect(kemarin.efektif).toBe(false);
  });

  it("retur BATAL dan klaim DIBATALKAN tidak membuat kunjungan efektif", () => {
    const b = kosong();
    b.kunjungan = [kunjungan({ storeId: "s1", checkinAt: jam("09:00"), checkoutAt: jam("09:30") })];
    b.retur = [{ id: "r1", storeId: "s1", status: "BATAL", createdAt: jam("09:10") }];
    b.klaim = [{ id: "k1", storeId: "s1", status: "DIBATALKAN", nilai: 1, createdAt: jam("09:10"), verifiedAt: null }];
    expect(rincianKunjungan(b, SEKARANG)[0].efektif).toBe(false);
  });

  it("kode hasil: hasil tercatat dipakai; kunjungan lama tanpa hasil tapi bertransaksi dibaca TRANSAKSI", () => {
    const b = kosong();
    const lama = kunjungan({ storeId: "s1", checkinAt: jam("09:00"), checkoutAt: jam("09:30") });
    b.kunjungan = [
      lama,
      kunjungan({ storeId: "s2", checkinAt: jam("10:00"), checkoutAt: jam("10:30") }),
      kunjungan({ storeId: "s3", checkinAt: jam("11:00"), checkoutAt: jam("11:30"), outcome: "PESAING" }),
      kunjungan({ storeId: "s4", checkinAt: jam("12:00"), checkoutAt: jam("12:30"), outcome: "BUKAN_KODE" }),
    ];
    b.pesanan = [pesanan({ storeId: "s1", visitId: lama.id, createdAt: jam("09:10") })];
    expect(rincianKunjungan(b, SEKARANG).map((r) => r.kodeHasil)).toEqual(["TRANSAKSI", "KOSONG", "PESAING", "KOSONG"]);
  });

  it("durasi, tanda janggal, dan nilai putus (konsi hanya dihitung, tanpa nilai)", () => {
    const b = kosong();
    const v = kunjungan({
      storeId: "s1",
      checkinAt: jam("09:00"),
      checkoutAt: jam("09:45"),
      diLuarRadius: true,
      tanda: [{ kode: "AKURASI_BURUK", akurasiMeter: 300, batasMeter: 100 }, { kode: "ANEH" }],
    });
    b.kunjungan = [v];
    b.pesanan = [
      pesanan({ storeId: "s1", visitId: v.id, createdAt: jam("09:10"), total: 750_000 }),
      pesanan({ storeId: "s1", visitId: v.id, createdAt: jam("09:20"), orderType: "KONSI", total: 9_999_999 }),
    ];
    const [r] = rincianKunjungan(b, SEKARANG);
    expect(r.durasiMenit).toBe(45);
    expect(r.diLuarRadius).toBe(true);
    expect(r.tanda.map((t) => t.kode)).toEqual(["AKURASI_BURUK"]);
    expect(r.janggal).toBe(true);
    expect(r.pesanan).toBe(2);
    expect(r.nilaiPutus).toBe(750_000);
    expect(r.konsi).toBe(1);
  });
});

// ─── Metrik satu sales ──────────────────────────────────────────────────────

describe("hitungMetrikLapangan", () => {
  const rentang = { dari: HARI, sampai: HARI };

  it("tanpa kegiatan → nol, persen efektif null", () => {
    const m = hitungMetrikLapangan(kosong(), rentang, SEKARANG);
    expect(m.kunjungan).toBe(0);
    expect(m.persenEfektif).toBeNull();
    expect(m.lapangan).toEqual({ menit: 0, hariAktif: 0, mulai: null, selesai: null });
    expect(adaKegiatan(m)).toBe(false);
  });

  it("kunjungan, toko unik, efektif, persen, berlangsung", () => {
    const b = kosong();
    b.kunjungan = [
      kunjungan({ storeId: "s1", checkinAt: jam("08:00"), checkoutAt: jam("08:30"), outcome: "TRANSAKSI" }),
      kunjungan({ storeId: "s2", checkinAt: jam("09:00"), checkoutAt: jam("09:30"), outcome: "TOKO_TUTUP" }),
      kunjungan({ storeId: "s1", checkinAt: jam("13:00"), checkoutAt: jam("13:20"), outcome: "KUNJUNGAN_RUTIN" }),
      kunjungan({ storeId: "s3", checkinAt: jam("16:30") }),
    ];
    const m = hitungMetrikLapangan(b, rentang, SEKARANG);
    expect(m.kunjungan).toBe(4);
    expect(m.tokoDikunjungi).toBe(3);
    expect(m.efektif).toBe(1);
    expect(m.persenEfektif).toBe(25);
    expect(m.berlangsung).toBe(1);
    // Ringkasan hasil hanya kunjungan yang sudah selesai.
    expect(m.hasil.total).toBe(3);
    expect(m.hasil.perKode).toEqual([
      { kode: "TRANSAKSI", jumlah: 1 },
      { kode: "TOKO_TUTUP", jumlah: 1 },
      { kode: "KUNJUNGAN_RUTIN", jumlah: 1 },
    ]);
  });

  it("baris di luar rentang diabaikan walau ikut terkirim", () => {
    const b = kosong();
    b.kunjungan = [kunjungan({ storeId: "s1", checkinAt: jam("09:00", "2026-09-29"), checkoutAt: jam("09:30", "2026-09-29") })];
    b.pesanan = [pesanan({ storeId: "s1", createdAt: jam("23:59", "2026-09-29") })];
    const m = hitungMetrikLapangan(b, rentang, SEKARANG);
    expect(m.kunjungan).toBe(0);
    expect(m.pesanan.jumlah).toBe(0);
  });

  it("pesanan: putus bernilai, konsi hanya jumlah, ditolak dan jarak jauh dipisah", () => {
    const b = kosong();
    b.pesanan = [
      pesanan({ storeId: "s1", createdAt: jam("09:00"), total: 1_500_000 }),
      pesanan({ storeId: "s2", createdAt: jam("10:00"), total: 2_700_000, status: "APPROVED", jarakJauh: true }),
      pesanan({ storeId: "s3", createdAt: jam("11:00"), orderType: "KONSI", total: 5_000_000 }),
      pesanan({ storeId: "s4", createdAt: jam("12:00"), total: 9_000_000, status: "REJECTED" }),
    ];
    const m = hitungMetrikLapangan(b, rentang, SEKARANG);
    expect(m.pesanan).toEqual({ jumlah: 3, putus: 2, nilaiPutus: 4_200_000, konsi: 1, ditolak: 1, jarakJauh: 1 });
  });

  it("pelunasan: dilaporkan (bukan yang dibatalkan) vs terverifikasi pada rentang verifikasinya", () => {
    const b = kosong();
    b.klaim = [
      { id: "k1", storeId: "s1", status: "DIKIRIM", nilai: 1_000_000, createdAt: jam("09:00"), verifiedAt: null },
      { id: "k2", storeId: "s2", status: "TERVERIFIKASI", nilai: 2_000_000, createdAt: jam("10:00"), verifiedAt: jam("15:00") },
      { id: "k3", storeId: "s3", status: "DIBATALKAN", nilai: 3_000_000, createdAt: jam("11:00"), verifiedAt: null },
      // Dilaporkan kemarin, diverifikasi hari ini: terverifikasi HARI INI, bukan dilaporkan hari ini.
      {
        id: "k4",
        storeId: "s4",
        status: "TERVERIFIKASI",
        nilai: 4_000_000,
        createdAt: jam("10:00", "2026-09-29"),
        verifiedAt: jam("08:00"),
      },
      { id: "k5", storeId: "s5", status: "DITOLAK", nilai: 500_000, createdAt: jam("12:00"), verifiedAt: jam("13:00") },
    ];
    const m = hitungMetrikLapangan(b, rentang, SEKARANG);
    expect(m.pelunasan).toEqual({
      dilaporkan: 3,
      nilaiDilaporkan: 3_500_000,
      terverifikasi: 2,
      nilaiTerverifikasi: 6_000_000,
    });
  });

  it("retur (tanpa yang batal), van, toko baru unik", () => {
    const b = kosong();
    b.retur = [
      { id: "r1", storeId: "s1", status: "MENUNGGU", createdAt: jam("09:00") },
      { id: "r2", storeId: "s1", status: "BATAL", createdAt: jam("09:10") },
    ];
    b.van = [{ id: "n1", storeId: null, total: 250_000, createdAt: jam("10:00") }];
    b.tokoBaru = [
      { storeId: "baru1", tanggal: jam("11:00"), sumber: "USULAN" },
      { storeId: "baru1", tanggal: jam("12:00"), sumber: "PESANAN_PERTAMA" },
      { storeId: "baru2", tanggal: jam("12:00"), sumber: "PESANAN_PERTAMA" },
      { storeId: "lama", tanggal: jam("12:00", "2026-09-01"), sumber: "USULAN" },
    ];
    const m = hitungMetrikLapangan(b, rentang, SEKARANG);
    expect(m.retur).toBe(1);
    expect(m.van).toEqual({ jumlah: 1, nilai: 250_000 });
    expect(m.tokoBaru).toBe(2);
    expect(adaKegiatan(m)).toBe(true);
  });

  it("check-in janggal: di luar radius atau bertanda — satu kunjungan dihitung sekali, rinciannya per tanda", () => {
    const b = kosong();
    b.kunjungan = [
      kunjungan({ storeId: "s1", checkinAt: jam("08:00"), diLuarRadius: true, tanda: [{ kode: "AKURASI_TIDAK_ADA" }] }),
      kunjungan({ storeId: "s2", checkinAt: jam("09:00"), tanda: [{ kode: "AKURASI_TIDAK_ADA" }] }),
      kunjungan({ storeId: "s3", checkinAt: jam("10:00"), tanda: "rusak" }),
      kunjungan({ storeId: "s4", checkinAt: jam("11:00") }),
    ];
    const m = hitungMetrikLapangan(b, rentang, SEKARANG);
    expect(m.janggal).toBe(2);
    expect(m.perTanda).toEqual([
      { kode: "AKURASI_TIDAK_ADA", jumlah: 2 },
      { kode: "LUAR_RADIUS", jumlah: 1 },
    ]);
  });

  it("waktu di lapangan: check-in pertama → check-out terakhir per hari, dijumlah antarhari", () => {
    const b = kosong();
    b.kunjungan = [
      kunjungan({ storeId: "s1", checkinAt: jam("08:15"), checkoutAt: jam("08:45") }),
      kunjungan({ storeId: "s2", checkinAt: jam("13:00"), checkoutAt: jam("15:30") }),
    ];
    const satuHari = hitungMetrikLapangan(b, rentang, SEKARANG);
    expect(satuHari.lapangan).toEqual({ menit: 435, hariAktif: 1, mulai: jam("08:15"), selesai: jam("15:30") });

    b.kunjungan.push(
      kunjungan({ storeId: "s3", checkinAt: jam("09:00", "2026-09-29"), checkoutAt: jam("10:00", "2026-09-29") }),
    );
    const duaHari = hitungMetrikLapangan(b, { dari: "2026-09-29", sampai: HARI }, SEKARANG);
    expect(duaHari.lapangan).toEqual({ menit: 495, hariAktif: 2, mulai: null, selesai: null });
  });

  it("kunjungan yang masih terbuka hari ini dihitung sampai sekarang", () => {
    const b = kosong();
    b.kunjungan = [kunjungan({ storeId: "s1", checkinAt: jam("16:00") })];
    expect(hitungMetrikLapangan(b, rentang, SEKARANG).lapangan).toEqual({
      menit: 60,
      hariAktif: 1,
      mulai: jam("16:00"),
      selesai: SEKARANG,
    });
  });
});

describe("jumlahkanMetrik", () => {
  it("menjumlah per kolom dan menghitung ulang persen dari jumlahnya, bukan rata-rata persen", () => {
    const rentang = { dari: HARI, sampai: HARI };
    const a = kosong();
    a.kunjungan = [
      kunjungan({ storeId: "s1", checkinAt: jam("08:00"), checkoutAt: jam("08:30"), outcome: "TRANSAKSI" }),
      kunjungan({ storeId: "s2", checkinAt: jam("09:00"), checkoutAt: jam("09:30"), outcome: "HARGA" }),
      kunjungan({ storeId: "s3", checkinAt: jam("10:00"), checkoutAt: jam("10:30"), outcome: "HARGA" }),
      kunjungan({ storeId: "s4", checkinAt: jam("11:00"), checkoutAt: jam("11:30"), outcome: "HARGA", diLuarRadius: true }),
    ];
    const b = kosong();
    b.kunjungan = [kunjungan({ storeId: "s9", checkinAt: jam("08:00"), checkoutAt: jam("09:00"), outcome: "TRANSAKSI" })];
    b.pesanan = [pesanan({ storeId: "s9", createdAt: jam("08:10"), total: 300_000 })];

    const t = jumlahkanMetrik([hitungMetrikLapangan(a, rentang, SEKARANG), hitungMetrikLapangan(b, rentang, SEKARANG)]);
    expect(t.kunjungan).toBe(5);
    expect(t.efektif).toBe(2);
    expect(t.persenEfektif).toBe(40);
    expect(t.pesanan.nilaiPutus).toBe(300_000);
    expect(t.janggal).toBe(1);
    expect(t.hasil.total).toBe(5);
    expect(t.hasil.transaksi).toBe(2);
    expect(t.hasil.perKode).toEqual([
      { kode: "HARGA", jumlah: 3 },
      { kode: "TRANSAKSI", jumlah: 2 },
    ]);
    expect(t.lapangan).toEqual({ menit: 270, hariAktif: 2, mulai: null, selesai: null });
  });

  it("daftar kosong → metrik nol", () => {
    const t = jumlahkanMetrik([]);
    expect(t.kunjungan).toBe(0);
    expect(t.persenEfektif).toBeNull();
    expect(t.hasil).toEqual({ total: 0, transaksi: 0, perKode: [] });
  });
});

// ─── Rencana vs realisasi ───────────────────────────────────────────────────

describe("rencanaVsRealisasi", () => {
  const toko = (storeId: string, tagih = false): TokoRencana => ({
    storeId,
    nama: storeId.toUpperCase(),
    kunjunganTerakhir: null,
    tagih,
    sisaTagihan: tagih ? 1_000_000 : 0,
    lat: null,
    lng: null,
  });
  const menurun = (storeId: string): TokoMenurun => ({
    storeId,
    nama: storeId,
    alasan: "JARANG",
    hariSejakTerakhir: 40,
    jarakBiasa: 14,
    nilai90: null,
    nilai90Sebelumnya: null,
  });

  it("satu hari: lewat batas + belum pernah + tagihan + menurun direncanakan; yang baru dikunjungi tidak", () => {
    const r = rencanaVsRealisasi({
      toko: [toko("lama"), toko("baru"), toko("belum"), toko("tagih", true), toko("turun")],
      kunjunganSebelum: new Map([
        ["lama", jam("10:00", "2026-09-10")],
        ["baru", jam("10:00", "2026-09-25")],
        ["tagih", jam("10:00", "2026-09-28")],
        ["turun", jam("10:00", "2026-09-28")],
      ]),
      kunjungan: [
        { storeId: "lama", checkinAt: jam("09:00") },
        { storeId: "baru", checkinAt: jam("10:00") },
      ],
      menurun: [menurun("turun")],
      rentang: { dari: HARI, sampai: HARI },
      batasHari: 14,
      hariIni: HARI,
    });
    expect(r.direncanakan).toBe(4);
    expect(r.dikunjungi).toBe(1);
    expect(r.persen).toBe(25);
    expect(r.toko).toEqual([
      // Urutan rencana itu sendiri: tagihan, menurun, lalu yang belum pernah didatangi di depan.
      { storeId: "tagih", nama: "TAGIH", alasan: ["tagih"], dikunjungi: false },
      { storeId: "turun", nama: "TURUN", alasan: ["menurun"], dikunjungi: false },
      { storeId: "belum", nama: "BELUM", alasan: ["lama"], dikunjungi: false },
      { storeId: "lama", nama: "LAMA", alasan: ["lama"], dikunjungi: true },
    ]);
  });

  it("hari lalu: tagihan dan toko menurun hanya diketahui untuk hari ini, jadi tidak ikut", () => {
    const r = rencanaVsRealisasi({
      toko: [toko("tagih", true), toko("turun")],
      kunjunganSebelum: new Map([
        ["tagih", jam("10:00", "2026-09-20")],
        ["turun", jam("10:00", "2026-09-20")],
      ]),
      kunjungan: [],
      menurun: [menurun("turun")],
      rentang: { dari: "2026-09-29", sampai: "2026-09-29" },
      batasHari: 14,
      hariIni: HARI,
    });
    expect(r).toEqual({ direncanakan: 0, dikunjungi: 0, persen: null, toko: [] });
  });

  it("beberapa hari: toko jatuh tempo di tengah rentang, dikunjungi sesudahnya → terealisasi; kunjungan menggeser tempo", () => {
    const r = rencanaVsRealisasi({
      toko: [toko("a"), toko("b"), toko("c")],
      kunjunganSebelum: new Map([
        // a jatuh tempo 28 Sep (14 hari), dikunjungi 29 Sep.
        ["a", jam("10:00", "2026-09-14")],
        // b jatuh tempo 29 Sep, tidak dikunjungi.
        ["b", jam("10:00", "2026-09-15")],
        // c dikunjungi 27 Sep lalu tidak jatuh tempo lagi.
        ["c", jam("10:00", "2026-09-13")],
      ]),
      kunjungan: [
        { storeId: "c", checkinAt: jam("09:00", "2026-09-27") },
        { storeId: "a", checkinAt: jam("09:00", "2026-09-29") },
      ],
      menurun: [],
      rentang: { dari: "2026-09-27", sampai: HARI },
      batasHari: 14,
      hariIni: HARI,
    });
    expect(r.direncanakan).toBe(3);
    expect(r.dikunjungi).toBe(2);
    expect(r.toko.filter((t) => !t.dikunjungi).map((t) => t.storeId)).toEqual(["b"]);
  });

  it("hari sesudah hari ini di rentang kustom tidak direncanakan", () => {
    const r = rencanaVsRealisasi({
      toko: [toko("x")],
      kunjunganSebelum: new Map([["x", jam("10:00", "2026-09-25")]]),
      kunjungan: [],
      menurun: [],
      rentang: { dari: HARI, sampai: "2026-10-31" },
      batasHari: 14,
      hariIni: HARI,
    });
    expect(r.direncanakan).toBe(0);
  });
});

// ─── Kalimat ringkasan (kabar) ──────────────────────────────────────────────

describe("kalimat ringkasan", () => {
  const rentang = { dari: HARI, sampai: HARI };

  it("contoh pemilik: 5 kunjungan · 3 pesanan Rp 4,2 jt · 1 pelunasan", () => {
    const b = kosong();
    b.kunjungan = Array.from({ length: 5 }, (_, i) => kunjungan({ storeId: `s${i}`, checkinAt: jam(`0${i + 1}:00`) }));
    b.pesanan = [
      pesanan({ storeId: "s1", createdAt: jam("09:00"), total: 1_700_000 }),
      pesanan({ storeId: "s2", createdAt: jam("09:10"), total: 2_500_000 }),
      pesanan({ storeId: "s3", createdAt: jam("09:20"), orderType: "KONSI", total: 1 }),
    ];
    b.klaim = [{ id: "k1", storeId: "s1", status: "DIKIRIM", nilai: 1, createdAt: jam("09:00"), verifiedAt: null }];
    expect(rapi(kalimatRingkasan(hitungMetrikLapangan(b, rentang, SEKARANG)))).toBe(
      "5 kunjungan · 3 pesanan Rp 4,2 jt · 1 pelunasan",
    );
  });

  it("hanya bagian yang ada isinya; pesanan konsi saja tanpa rupiah", () => {
    const b = kosong();
    b.pesanan = [pesanan({ storeId: "s1", createdAt: jam("09:00"), orderType: "KONSI" })];
    b.retur = [{ id: "r1", storeId: "s1", status: "MENUNGGU", createdAt: jam("09:00") }];
    b.van = [{ id: "n1", storeId: null, total: 350_000, createdAt: jam("10:00") }];
    b.tokoBaru = [{ storeId: "x", tanggal: jam("10:00"), sumber: "USULAN" }];
    expect(rapi(kalimatRingkasan(hitungMetrikLapangan(b, rentang, SEKARANG)))).toBe(
      "0 kunjungan · 1 pesanan · 1 retur · 1 jual van Rp 350 rb · 1 toko baru",
    );
  });

  it("ringkasan tim untuk atasan", () => {
    const b = kosong();
    b.kunjungan = [
      kunjungan({ storeId: "s1", checkinAt: jam("08:00"), checkoutAt: jam("08:30"), outcome: "TRANSAKSI" }),
      kunjungan({ storeId: "s2", checkinAt: jam("09:00"), checkoutAt: jam("09:30"), outcome: "HARGA", diLuarRadius: true }),
    ];
    b.pesanan = [pesanan({ storeId: "s1", createdAt: jam("08:10"), total: 18_400_000 })];
    b.klaim = [
      { id: "k1", storeId: "s1", status: "TERVERIFIKASI", nilai: 7_200_000, createdAt: jam("08:00"), verifiedAt: jam("15:00") },
    ];
    const m = hitungMetrikLapangan(b, rentang, SEKARANG);
    expect(rapi(kalimatRingkasanTim(m, 4))).toBe(
      "4 sales aktif · 2 kunjungan (efektif 50%) · 1 pesanan Rp 18,4 jt · 1 pelunasan · 1 check-in janggal",
    );
  });
});
