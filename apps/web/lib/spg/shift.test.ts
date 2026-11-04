import { describe, expect, it } from "vitest";
import { bacaAturanShift, SHIFT_BAWAAN, type AturanShift } from "./pengaturan";
import {
  bacaMinggu,
  bedaDraf,
  checkinPertama,
  drafDariBaris,
  hariSeminggu,
  hariTukar,
  hasilTukar,
  isiHariKerjaKeDraf,
  jamWib,
  kunciSel,
  nilaiKenyataan,
  periksaAturanShift,
  periksaTukar,
  rapikanIsianSel,
  rencanakanSimpanJadwalSpg,
  salinMingguKeDraf,
  seninDari,
  tukarBentrok,
  type BarisShift,
} from "./shift";

const aturan: AturanShift = SHIFT_BAWAAN;
const pagi = (userId: string, day: string): BarisShift => ({ userId, day, kind: "KERJA", shiftCode: "PAGI", startTime: "10:00", endTime: "18:00" });
const siang = (userId: string, day: string): BarisShift => ({ userId, day, kind: "KERJA", shiftCode: "SIANG", startTime: "14:00", endTime: "22:00" });
const libur = (userId: string, day: string): BarisShift => ({ userId, day, kind: "LIBUR", shiftCode: null, startTime: null, endTime: null });

describe("minggu WIB", () => {
  it("Senin dari hari mana pun, Senin–Minggu", () => {
    // 2026-10-03 adalah Sabtu.
    expect(seninDari("2026-10-03")).toBe("2026-09-28");
    expect(seninDari("2026-09-28")).toBe("2026-09-28");
    expect(seninDari("2026-10-04")).toBe("2026-09-28");
    expect(hariSeminggu("2026-09-28")).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
  });

  it("minggu ini mengikuti hari WIB, bukan UTC", () => {
    // Minggu 2026-10-04 pukul 23.30 UTC = Senin 2026-10-05 06.30 WIB → minggu berikutnya.
    expect(bacaMinggu(undefined, new Date("2026-10-04T23:30:00Z"))).toBe("2026-10-05");
    expect(bacaMinggu(undefined, new Date("2026-10-04T16:00:00Z"))).toBe("2026-09-28");
    expect(bacaMinggu("2026-10-08", new Date("2026-10-04T16:00:00Z"))).toBe("2026-10-05");
    expect(bacaMinggu("2026-02-30", new Date("2026-10-04T16:00:00Z"))).toBe("2026-09-28");
  });

  it("jam WIB dari sebuah saat", () => {
    expect(jamWib(new Date("2026-10-03T02:58:00Z"))).toBe("09:58");
    expect(jamWib(new Date("2026-10-03T17:05:00Z"))).toBe("00:05");
  });
});

describe("rapikanIsianSel", () => {
  it("menerima bentuk sah, yang terakhir menang untuk sel yang sama", () => {
    expect(
      rapikanIsianSel([
        { userId: "a", day: "2026-10-05", isi: { jenis: "KERJA", kode: "PAGI" } },
        { userId: "a", day: "2026-10-05", isi: { jenis: "LIBUR" } },
        { userId: "b", day: "2026-10-05", isi: null },
      ]),
    ).toEqual([
      { userId: "a", day: "2026-10-05", isi: { jenis: "LIBUR" } },
      { userId: "b", day: "2026-10-05", isi: null },
    ]);
  });

  it("bentuk aneh menolak seluruhnya", () => {
    expect(rapikanIsianSel("x")).toBeNull();
    expect(rapikanIsianSel([{ userId: "a", day: "2026-10-05", isi: { jenis: "KERJA" } }])).toBeNull();
    expect(rapikanIsianSel([{ userId: "", day: "2026-10-05", isi: null }])).toBeNull();
    expect(rapikanIsianSel([{ userId: "a", day: "2026-10-05", isi: "PAGI" }])).toBeNull();
  });
});

describe("rencanakanSimpanJadwalSpg", () => {
  const dasar = { aturan, hariIni: "2026-10-03", spg: new Set(["a", "b"]) };

  it("menulis yang berubah, menghapus yang dikosongkan, melewati yang sama", () => {
    const r = rencanakanSimpanJadwalSpg({
      ...dasar,
      sebelum: [pagi("a", "2026-10-05"), libur("b", "2026-10-05"), pagi("a", "2026-10-06")],
      isian: [
        { userId: "a", day: "2026-10-05", isi: { jenis: "KERJA", kode: "PAGI" } },
        { userId: "b", day: "2026-10-05", isi: { jenis: "KERJA", kode: "SIANG" } },
        { userId: "a", day: "2026-10-06", isi: null },
        { userId: "b", day: "2026-10-04", isi: { jenis: "LIBUR" } },
      ],
    });
    if (!r.ok) throw new Error(r.kode);
    expect(r.tulis).toEqual([
      { kind: "KERJA", shiftCode: "SIANG", startTime: "14:00", endTime: "22:00", userId: "b", day: "2026-10-05" },
      { kind: "LIBUR", shiftCode: null, startTime: null, endTime: null, userId: "b", day: "2026-10-04" },
    ]);
    expect(r.hapus).toEqual([{ userId: "a", day: "2026-10-06" }]);
    expect(r.perubahan.map((p) => `${p.userId}|${p.day}`)).toEqual(["b|2026-10-04", "b|2026-10-05", "a|2026-10-06"]);
    expect(r.hariPertama).toEqual({ a: "2026-10-06", b: "2026-10-04" });
  });

  it("kode sama dengan jam pengaturan yang sudah berubah dihitung berubah", () => {
    const lama = { ...pagi("a", "2026-10-05"), startTime: "09:00" };
    const r = rencanakanSimpanJadwalSpg({ ...dasar, sebelum: [lama], isian: [{ userId: "a", day: "2026-10-05", isi: { jenis: "KERJA", kode: "PAGI" } }] });
    if (!r.ok) throw new Error(r.kode);
    expect(r.tulis[0].startTime).toBe("10:00");
    expect(r.perubahan[0].sebelum?.startTime).toBe("09:00");
  });

  it("tidak ada yang berubah → tanpa perubahan", () => {
    const r = rencanakanSimpanJadwalSpg({ ...dasar, sebelum: [pagi("a", "2026-10-05")], isian: [{ userId: "a", day: "2026-10-05", isi: { jenis: "KERJA", kode: "PAGI" } }] });
    expect(r).toEqual({ ok: true, tulis: [], hapus: [], perubahan: [], hariPertama: {} });
  });

  it("menolak hari lewat (hari ini masih boleh), bukan SPG toko, shift tak dikenal, tanggal rusak, kosong", () => {
    expect(rencanakanSimpanJadwalSpg({ ...dasar, sebelum: [], isian: [] })).toEqual({ ok: false, kode: "KOSONG" });
    expect(rencanakanSimpanJadwalSpg({ ...dasar, sebelum: [], isian: [{ userId: "a", day: "2026-10-02", isi: null }] })).toEqual({
      ok: false,
      kode: "HARI_LEWAT",
      day: "2026-10-02",
    });
    expect(rencanakanSimpanJadwalSpg({ ...dasar, sebelum: [], isian: [{ userId: "a", day: "2026-10-03", isi: { jenis: "LIBUR" } }] }).ok).toBe(true);
    expect(rencanakanSimpanJadwalSpg({ ...dasar, sebelum: [], isian: [{ userId: "x", day: "2026-10-05", isi: null }] })).toEqual({
      ok: false,
      kode: "BUKAN_SPG_TOKO",
      userId: "x",
    });
    expect(
      rencanakanSimpanJadwalSpg({ ...dasar, sebelum: [], isian: [{ userId: "a", day: "2026-10-05", isi: { jenis: "KERJA", kode: "MALAM" } }] }),
    ).toEqual({ ok: false, kode: "SHIFT_TIDAK_DIKENAL", shiftCode: "MALAM" });
    expect(rencanakanSimpanJadwalSpg({ ...dasar, sebelum: [], isian: [{ userId: "a", day: "2026-02-30", isi: null }] })).toEqual({
      ok: false,
      kode: "TANGGAL_TIDAK_SAH",
      day: "2026-02-30",
    });
  });
});

describe("draf: salin minggu lalu dan isi hari kerja", () => {
  it("salin Senin ke Senin, tanpa menimpa, melewati hari lewat, shift terhapus, dan orang yang bukan SPG toko lagi", () => {
    // Minggu tujuan 2026-09-28 (Senin) — hari ini Rabu 2026-09-30.
    const sumber = [
      pagi("a", "2026-09-21"), // Senin → 2026-09-28: lewat
      siang("a", "2026-09-23"), // Rabu → 2026-09-30: disalin (hari ini)
      libur("a", "2026-09-27"), // Minggu → 2026-10-04: disalin
      pagi("b", "2026-09-24"), // Kamis → 2026-10-01: sudah terisi di draf
      { ...pagi("b", "2026-09-25"), shiftCode: "MALAM" }, // shift sudah dihapus
      pagi("c", "2026-09-26"), // c bukan SPG toko ini lagi
    ];
    const r = salinMingguKeDraf({
      sumber,
      draf: { [kunciSel("b", "2026-10-01")]: { jenis: "LIBUR" } },
      seninTujuan: "2026-09-28",
      hariIni: "2026-09-30",
      spg: ["a", "b"],
      aturan,
    });
    expect(r.disalin).toBe(2);
    expect(r.dilewati).toEqual({ sudahAda: 1, hariLewat: 1, shiftTidakAda: 1 });
    expect(r.draf).toEqual({
      [kunciSel("a", "2026-09-30")]: { jenis: "KERJA", kode: "SIANG" },
      [kunciSel("a", "2026-10-04")]: { jenis: "LIBUR" },
      [kunciSel("b", "2026-10-01")]: { jenis: "LIBUR" },
    });
  });

  it("isi hari kerja: hanya hari kerja yang belum lewat, sel kosong, dan bukan hari izin", () => {
    // Hari kerja Senin–Sabtu (Minggu = 0 libur). Hari ini Jumat 2026-10-02.
    const r = isiHariKerjaKeDraf({
      draf: { [kunciSel("a", "2026-10-03")]: { jenis: "LIBUR" } },
      senin: "2026-09-28",
      hariIni: "2026-10-02",
      spg: ["a", "b"],
      hariKerja: [1, 2, 3, 4, 5, 6],
      kode: "PAGI",
      izin: [{ userId: "b", type: "SAKIT", startDay: "2026-10-02", endDay: "2026-10-02" }],
    });
    expect(r.diisi).toBe(2);
    expect(r.dilewati).toEqual({ sudahAda: 1, izin: 1 });
    expect(Object.keys(r.draf).sort()).toEqual([kunciSel("a", "2026-10-02"), kunciSel("a", "2026-10-03"), kunciSel("b", "2026-10-03")].sort());
  });

  it("beda draf hanya mengirim sel yang berubah", () => {
    const awal = drafDariBaris([pagi("a", "2026-10-05"), libur("b", "2026-10-05")]);
    const draf = { ...awal, [kunciSel("a", "2026-10-05")]: { jenis: "KERJA" as const, kode: "PAGI" }, [kunciSel("b", "2026-10-06")]: { jenis: "LIBUR" as const } };
    delete (draf as Record<string, unknown>)[kunciSel("b", "2026-10-05")];
    expect(bedaDraf(awal, draf)).toEqual([
      { userId: "b", day: "2026-10-05", isi: null },
      { userId: "b", day: "2026-10-06", isi: { jenis: "LIBUR" } },
    ]);
  });
});

describe("kenyataan: terlambat, tidak masuk, izin", () => {
  const dasar = { hariIni: "2026-10-03", sekarang: new Date("2026-10-03T05:00:00Z"), toleransiMenit: 15, izin: null };

  it("hadir tepat waktu dan dalam toleransi", () => {
    expect(nilaiKenyataan({ ...dasar, day: "2026-10-02", sel: pagi("a", "2026-10-02"), checkin: new Date("2026-10-02T02:58:00Z") })).toEqual({
      status: "HADIR",
      jamMasuk: "09:58",
    });
    // 10:15 tepat = batas, belum terlambat.
    expect(nilaiKenyataan({ ...dasar, day: "2026-10-02", sel: pagi("a", "2026-10-02"), checkin: new Date("2026-10-02T03:15:00Z") })).toEqual({
      status: "HADIR",
      jamMasuk: "10:15",
    });
  });

  it("terlambat: lewat mulai + toleransi, menit dihitung dari jam mulai", () => {
    expect(nilaiKenyataan({ ...dasar, day: "2026-10-02", sel: pagi("a", "2026-10-02"), checkin: new Date("2026-10-02T03:16:30Z") })).toEqual({
      status: "TERLAMBAT",
      jamMasuk: "10:16",
      menit: 16,
    });
  });

  it("tidak masuk hanya untuk hari lalu; hari ini = belum masuk sesudah batas", () => {
    expect(nilaiKenyataan({ ...dasar, day: "2026-10-02", sel: pagi("a", "2026-10-02"), checkin: null })).toEqual({ status: "TIDAK_MASUK" });
    // Hari ini 12.00 WIB, shift pagi 10.00 + 15 → belum masuk.
    expect(nilaiKenyataan({ ...dasar, day: "2026-10-03", sel: pagi("a", "2026-10-03"), checkin: null })).toEqual({ status: "BELUM_MASUK" });
    // Shift siang 14.00 belum mulai → tidak ada apa-apa.
    expect(nilaiKenyataan({ ...dasar, day: "2026-10-03", sel: siang("a", "2026-10-03"), checkin: null })).toBeNull();
    expect(nilaiKenyataan({ ...dasar, day: "2026-10-04", sel: pagi("a", "2026-10-04"), checkin: null })).toBeNull();
  });

  it("izin yang disetujui, libur, tanpa jadwal", () => {
    expect(nilaiKenyataan({ ...dasar, day: "2026-10-02", sel: pagi("a", "2026-10-02"), checkin: null, izin: "SAKIT" })).toEqual({
      status: "IZIN",
      jenis: "SAKIT",
    });
    // Datang di hari izin tetap hadir.
    expect(
      nilaiKenyataan({ ...dasar, day: "2026-10-02", sel: pagi("a", "2026-10-02"), checkin: new Date("2026-10-02T03:00:00Z"), izin: "SAKIT" })?.status,
    ).toBe("HADIR");
    expect(nilaiKenyataan({ ...dasar, day: "2026-10-02", sel: libur("a", "2026-10-02"), checkin: null })).toBeNull();
    expect(nilaiKenyataan({ ...dasar, day: "2026-10-02", sel: libur("a", "2026-10-02"), checkin: new Date("2026-10-02T03:00:00Z") })).toEqual({
      status: "MASUK_SAAT_LIBUR",
      jamMasuk: "10:00",
    });
    expect(nilaiKenyataan({ ...dasar, day: "2026-10-02", sel: null, checkin: null })).toBeNull();
    expect(nilaiKenyataan({ ...dasar, day: "2026-10-02", sel: null, checkin: new Date("2026-10-02T03:00:00Z") })?.status).toBe("HADIR");
  });

  it("check-in pertama per orang per hari WIB", () => {
    const p = checkinPertama([
      { userId: "a", checkinAt: new Date("2026-10-02T05:00:00Z") },
      { userId: "a", checkinAt: new Date("2026-10-02T03:00:00Z") },
      // 2026-10-02 18.00 UTC = 2026-10-03 01.00 WIB.
      { userId: "a", checkinAt: new Date("2026-10-02T18:00:00Z") },
    ]);
    expect(p.get(kunciSel("a", "2026-10-02"))?.toISOString()).toBe("2026-10-02T03:00:00.000Z");
    expect(p.get(kunciSel("a", "2026-10-03"))?.toISOString()).toBe("2026-10-02T18:00:00.000Z");
  });
});

describe("pengaturan shift", () => {
  it("menerima daftar sah dan merapikan kode/label", () => {
    expect(
      periksaAturanShift({ daftar: [{ kode: " pagi ", label: " Pagi ", mulai: "09:00", selesai: "17:00" }], toleransiTerlambatMenit: 10 }),
    ).toEqual({ ok: true, nilai: { daftar: [{ kode: "PAGI", label: "Pagi", mulai: "09:00", selesai: "17:00" }], toleransiTerlambatMenit: 10 } });
  });

  it("yang disimpan terbaca kembali persis sama oleh pembacanya (termasuk toleransi 0)", () => {
    const r = periksaAturanShift({
      daftar: [
        { kode: "A", label: "Buka", mulai: "08:00", selesai: "16:00" },
        { kode: "MALAM_2", label: "Malam", mulai: "22:00", selesai: "06:00" },
      ],
      toleransiTerlambatMenit: 0,
    });
    if (!r.ok) throw new Error(r.kode);
    const nilai = JSON.stringify(r.nilai);
    expect(JSON.stringify(bacaAturanShift(nilai))).toBe(nilai);
  });

  it("menolak kosong, kode ganda, LIBUR, jam rusak, toleransi rusak", () => {
    expect(periksaAturanShift({ daftar: [], toleransiTerlambatMenit: 10 })).toMatchObject({ ok: false, kode: "DAFTAR_KOSONG" });
    const s = { kode: "A", label: "A", mulai: "09:00", selesai: "17:00" };
    expect(periksaAturanShift({ daftar: [s, { ...s, label: "B" }], toleransiTerlambatMenit: 10 })).toMatchObject({ ok: false, kode: "KODE_GANDA", indeks: 1 });
    expect(periksaAturanShift({ daftar: [{ ...s, kode: "LIBUR" }], toleransiTerlambatMenit: 10 })).toMatchObject({ ok: false, kode: "SHIFT_TIDAK_SAH" });
    expect(periksaAturanShift({ daftar: [{ ...s, mulai: "25:00" }], toleransiTerlambatMenit: 10 })).toMatchObject({ ok: false, kode: "SHIFT_TIDAK_SAH" });
    expect(periksaAturanShift({ daftar: [{ ...s, kode: "A-1" }], toleransiTerlambatMenit: 10 })).toMatchObject({ ok: false, kode: "SHIFT_TIDAK_SAH" });
    expect(periksaAturanShift({ daftar: [s], toleransiTerlambatMenit: 1.5 })).toMatchObject({ ok: false, kode: "TOLERANSI_TIDAK_SAH" });
    expect(periksaAturanShift({ daftar: [s], toleransiTerlambatMenit: 241 })).toMatchObject({ ok: false, kode: "TOLERANSI_TIDAK_SAH" });
  });
});

describe("tukar shift", () => {
  const peta = (...b: BarisShift[]) => new Map(b.map((x) => [x.day, x]));

  it("periksa: pengaju harus bekerja, rekan bekerja di hari tukar balik, tidak lewat, tidak terlalu jauh", () => {
    const dasar = { hariIni: "2026-10-03", pengaju: peta(pagi("a", "2026-10-05")), rekan: peta(siang("b", "2026-10-07")) };
    expect(periksaTukar({ ...dasar, day: "2026-10-05", partnerDay: null })).toBeNull();
    expect(periksaTukar({ ...dasar, day: "2026-10-05", partnerDay: "2026-10-07" })).toBeNull();
    expect(periksaTukar({ ...dasar, day: "2026-10-06", partnerDay: null })).toBe("PENGAJU_TIDAK_KERJA");
    expect(periksaTukar({ ...dasar, day: "2026-10-05", partnerDay: "2026-10-08" })).toBe("REKAN_TIDAK_KERJA");
    expect(periksaTukar({ ...dasar, day: "2026-10-02", partnerDay: null })).toBe("HARI_LEWAT");
    expect(periksaTukar({ ...dasar, day: "2026-10-17", partnerDay: null })).toBe("TERLALU_JAUH");
    expect(periksaTukar({ ...dasar, day: "2026-10-17", partnerDay: null, tanpaBatasJauh: true })).toBe("PENGAJU_TIDAK_KERJA");
    expect(periksaTukar({ ...dasar, day: "x", partnerDay: null })).toBe("TANGGAL_TIDAK_SAH");
  });

  it("bentrok dengan ajuan terbuka di orang-hari yang sama", () => {
    const terbuka = [{ id: "s1", requesterId: "c", partnerId: "b", day: "2026-10-09", partnerDay: "2026-10-07" }];
    expect(tukarBentrok({ requesterId: "a", partnerId: "b", day: "2026-10-05", partnerDay: "2026-10-07" }, terbuka)).toBe("s1");
    expect(tukarBentrok({ requesterId: "a", partnerId: "b", day: "2026-10-05", partnerDay: null }, terbuka)).toBeNull();
    expect(tukarBentrok({ requesterId: "a", partnerId: "d", day: "2026-10-07", partnerDay: null }, terbuka)).toBeNull();
    expect(hariTukar({ day: "2026-10-07", partnerDay: "2026-10-05" })).toEqual(["2026-10-05", "2026-10-07"]);
  });

  it("hasil: isi sel bertukar; rekan libur atau kosong → shift berpindah, pengaju libur", () => {
    const r = hasilTukar({
      pengajuId: "a",
      rekanId: "b",
      hari: ["2026-10-05", "2026-10-07"],
      baris: [pagi("a", "2026-10-05"), libur("b", "2026-10-05"), siang("b", "2026-10-07")],
    });
    expect(r.tulis).toEqual([
      { kind: "LIBUR", shiftCode: null, startTime: null, endTime: null, userId: "a", day: "2026-10-05" },
      { kind: "KERJA", shiftCode: "PAGI", startTime: "10:00", endTime: "18:00", userId: "b", day: "2026-10-05" },
      { kind: "KERJA", shiftCode: "SIANG", startTime: "14:00", endTime: "22:00", userId: "a", day: "2026-10-07" },
      { kind: "LIBUR", shiftCode: null, startTime: null, endTime: null, userId: "b", day: "2026-10-07" },
    ]);
    expect(r.perubahan).toHaveLength(4);
  });

  it("hasil: dua shift di hari yang sama bertukar kode dan jam", () => {
    const r = hasilTukar({ pengajuId: "a", rekanId: "b", hari: ["2026-10-05"], baris: [pagi("a", "2026-10-05"), siang("b", "2026-10-05")] });
    expect(r.tulis.map((t) => `${t.userId}:${t.shiftCode}`)).toEqual(["a:SIANG", "b:PAGI"]);
  });
});
