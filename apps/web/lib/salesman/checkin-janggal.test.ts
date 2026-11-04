import { describe, expect, it } from "vitest";
import {
  bacaTandaCheckin,
  nilaiCheckinJanggal,
  normalkanAkurasi,
  titikTerakhir,
  type MasukanCheckinJanggal,
} from "./checkin-janggal";

// Titik acuan di Yogyakarta. 0,01° lintang ≈ 1,11 km.
const SEKARANG = new Date("2026-09-30T10:00:00+07:00");
const menitLalu = (m: number) => new Date(SEKARANG.getTime() - m * 60_000);
const hariLalu = (h: number) => new Date(SEKARANG.getTime() - h * 86_400_000);

const dasar: MasukanCheckinJanggal = {
  storeId: "s1",
  lat: -7.78,
  lng: 110.37,
  waktu: SEKARANG,
  akurasiMeter: 20,
  batasAkurasiMeter: 100,
  sebelumnya: null,
  checkinTerbaru: [],
};

const kode = (m: MasukanCheckinJanggal) => nilaiCheckinJanggal(m).map((t) => t.kode);

describe("normalkanAkurasi", () => {
  it("angka wajar dibulatkan ke meter", () => {
    expect(normalkanAkurasi(12.6)).toBe(13);
    expect(normalkanAkurasi(0)).toBe(0);
  });

  it("tidak ada, bukan angka, negatif atau tak terhingga → null", () => {
    expect(normalkanAkurasi(undefined)).toBeNull();
    expect(normalkanAkurasi(null)).toBeNull();
    expect(normalkanAkurasi(Number.NaN)).toBeNull();
    expect(normalkanAkurasi(-5)).toBeNull();
    expect(normalkanAkurasi(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalkanAkurasi("20")).toBeNull();
  });

  it("angka raksasa dipotong supaya muat di kolom Int", () => {
    expect(normalkanAkurasi(5e12)).toBe(1_000_000);
  });
});

describe("akurasi", () => {
  it("akurasi baik → tanpa tanda", () => {
    expect(nilaiCheckinJanggal(dasar)).toEqual([]);
  });

  it("akurasi tepat di batas masih wajar; di atasnya AKURASI_BURUK", () => {
    expect(kode({ ...dasar, akurasiMeter: 100 })).toEqual([]);
    expect(nilaiCheckinJanggal({ ...dasar, akurasiMeter: 350 })).toEqual([
      { kode: "AKURASI_BURUK", akurasiMeter: 350, batasMeter: 100 },
    ]);
  });

  it("batas mengikuti setelan pemilik", () => {
    expect(kode({ ...dasar, akurasiMeter: 350, batasAkurasiMeter: 500 })).toEqual([]);
  });

  it("HP tidak melaporkan akurasi → AKURASI_TIDAK_ADA", () => {
    expect(nilaiCheckinJanggal({ ...dasar, akurasiMeter: null })).toEqual([{ kode: "AKURASI_TIDAK_ADA" }]);
  });
});

describe("titikTerakhir", () => {
  it("tanpa kunjungan sebelumnya → null", () => {
    expect(titikTerakhir(null)).toBeNull();
  });

  it("memakai titik check-out bila koordinatnya ada", () => {
    expect(
      titikTerakhir({
        checkinLat: 1,
        checkinLng: 2,
        checkinAt: menitLalu(60),
        checkoutLat: 3,
        checkoutLng: 4,
        checkoutAt: menitLalu(10),
      }),
    ).toEqual({ lat: 3, lng: 4, waktu: menitLalu(10) });
  });

  it("check-out tanpa koordinat (ditutup otomatis) atau belum check-out → titik check-in", () => {
    const tanpaKoordinat = {
      checkinLat: 1,
      checkinLng: 2,
      checkinAt: menitLalu(60),
      checkoutLat: null,
      checkoutLng: null,
      checkoutAt: menitLalu(5),
    };
    expect(titikTerakhir(tanpaKoordinat)).toEqual({ lat: 1, lng: 2, waktu: menitLalu(60) });
    expect(titikTerakhir({ ...tanpaKoordinat, checkoutAt: null })).toEqual({ lat: 1, lng: 2, waktu: menitLalu(60) });
  });
});

describe("lompatan mustahil", () => {
  const dari = (lat: number, lng: number, waktu: Date) => ({
    checkinLat: lat,
    checkinLng: lng,
    checkinAt: waktu,
    checkoutLat: null,
    checkoutLng: null,
    checkoutAt: null,
  });

  it("45 km dalam 10 menit (≈ 270 km/j) → LOMPATAN_MUSTAHIL", () => {
    const t = nilaiCheckinJanggal({ ...dasar, sebelumnya: dari(-7.78 + 0.405, 110.37, menitLalu(10)) });
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ kode: "LOMPATAN_MUSTAHIL", menit: 10 });
    const l = t[0] as { jarakMeter: number; kecepatanKmj: number };
    expect(l.jarakMeter).toBeGreaterThan(44_000);
    expect(l.jarakMeter).toBeLessThan(46_000);
    expect(l.kecepatanKmj).toBeGreaterThan(260);
    expect(l.kecepatanKmj).toBeLessThan(280);
  });

  it("45 km dalam 1 jam (≈ 45 km/j) wajar", () => {
    expect(kode({ ...dasar, sebelumnya: dari(-7.78 + 0.405, 110.37, menitLalu(60)) })).toEqual([]);
  });

  it("jarak di bawah 2 km tidak pernah ditandai, secepat apa pun", () => {
    // ≈ 1,1 km dalam 10 detik.
    expect(
      kode({ ...dasar, sebelumnya: dari(-7.78 + 0.01, 110.37, new Date(SEKARANG.getTime() - 10_000)) }),
    ).toEqual([]);
  });

  it("jarak > 2 km dengan selisih waktu nol atau negatif → mustahil, kecepatan tak terhingga (null)", () => {
    const t = nilaiCheckinJanggal({ ...dasar, sebelumnya: dari(-7.78 + 0.1, 110.37, SEKARANG) });
    expect(t).toEqual([expect.objectContaining({ kode: "LOMPATAN_MUSTAHIL", menit: 0, kecepatanKmj: null })]);
  });

  it("dibandingkan dengan titik check-out, bukan check-in, kunjungan sebelumnya", () => {
    // Check-in lama jauh (tidak mustahil dari sana), tapi check-out 5 menit lalu 20 km jauhnya.
    const sebelumnya = {
      checkinLat: -7.78 + 0.18,
      checkinLng: 110.37,
      checkinAt: menitLalu(120),
      checkoutLat: -7.78 + 0.18,
      checkoutLng: 110.37,
      checkoutAt: menitLalu(5),
    };
    expect(kode({ ...dasar, sebelumnya })).toEqual(["LOMPATAN_MUSTAHIL"]);
  });
});

describe("koordinat kembar", () => {
  it("koordinat sama persis (6 desimal) dengan check-in di toko LAIN dalam 30 hari → KOORDINAT_KEMBAR", () => {
    const t = nilaiCheckinJanggal({
      ...dasar,
      lat: -7.7812343,
      lng: 110.3712342,
      checkinTerbaru: [{ storeId: "s2", namaToko: "Toko Dua", lat: -7.7812339, lng: 110.3712338, waktu: hariLalu(3) }],
    });
    expect(t).toEqual([
      { kode: "KOORDINAT_KEMBAR", storeId: "s2", namaToko: "Toko Dua", waktu: hariLalu(3).toISOString() },
    ]);
  });

  it("toko yang sama tidak dihitung — kembali ke toko yang sama itu wajar", () => {
    expect(
      kode({ ...dasar, checkinTerbaru: [{ storeId: "s1", namaToko: null, lat: -7.78, lng: 110.37, waktu: hariLalu(1) }] }),
    ).toEqual([]);
  });

  it("beda di desimal ke-6 tidak kembar; lebih dari 30 hari lalu tidak dihitung", () => {
    expect(
      kode({
        ...dasar,
        checkinTerbaru: [{ storeId: "s2", namaToko: null, lat: -7.780001, lng: 110.37, waktu: hariLalu(1) }],
      }),
    ).toEqual([]);
    expect(
      kode({ ...dasar, checkinTerbaru: [{ storeId: "s2", namaToko: null, lat: -7.78, lng: 110.37, waktu: hariLalu(31) }] }),
    ).toEqual([]);
  });

  it("beberapa yang kembar → dilaporkan satu, yang paling baru", () => {
    const t = nilaiCheckinJanggal({
      ...dasar,
      checkinTerbaru: [
        { storeId: "s2", namaToko: "Dua", lat: -7.78, lng: 110.37, waktu: hariLalu(9) },
        { storeId: "s3", namaToko: "Tiga", lat: -7.78, lng: 110.37, waktu: hariLalu(2) },
      ],
    });
    expect(t).toEqual([{ kode: "KOORDINAT_KEMBAR", storeId: "s3", namaToko: "Tiga", waktu: hariLalu(2).toISOString() }]);
  });
});

it("beberapa tanda sekaligus dilaporkan semua, urutan tetap", () => {
  const t = nilaiCheckinJanggal({
    ...dasar,
    akurasiMeter: 800,
    sebelumnya: {
      checkinLat: -7.78 + 0.405,
      checkinLng: 110.37,
      checkinAt: menitLalu(10),
      checkoutLat: null,
      checkoutLng: null,
      checkoutAt: null,
    },
    checkinTerbaru: [{ storeId: "s2", namaToko: null, lat: -7.78, lng: 110.37, waktu: hariLalu(1) }],
  });
  expect(t.map((x) => x.kode)).toEqual(["AKURASI_BURUK", "LOMPATAN_MUSTAHIL", "KOORDINAT_KEMBAR"]);
});

describe("bacaTandaCheckin", () => {
  it("membaca kembali persis yang ditulis", () => {
    const t = nilaiCheckinJanggal({
      ...dasar,
      akurasiMeter: null,
      checkinTerbaru: [{ storeId: "s2", namaToko: "Dua", lat: -7.78, lng: 110.37, waktu: hariLalu(1) }],
    });
    expect(bacaTandaCheckin(JSON.parse(JSON.stringify(t)))).toEqual(t);
  });

  it("null, bukan larik, atau entri rusak/tak dikenal dibuang tanpa melempar", () => {
    expect(bacaTandaCheckin(null)).toEqual([]);
    expect(bacaTandaCheckin({ kode: "AKURASI_TIDAK_ADA" })).toEqual([]);
    expect(
      bacaTandaCheckin([
        { kode: "AKURASI_BURUK", akurasiMeter: "banyak", batasMeter: 100 },
        { kode: "ANEH" },
        "teks",
        { kode: "AKURASI_TIDAK_ADA" },
        { kode: "LOMPATAN_MUSTAHIL", jarakMeter: 5000, menit: 1, kecepatanKmj: null },
      ]),
    ).toEqual([
      { kode: "AKURASI_TIDAK_ADA" },
      { kode: "LOMPATAN_MUSTAHIL", jarakMeter: 5000, menit: 1, kecepatanKmj: null },
    ]);
  });
});
