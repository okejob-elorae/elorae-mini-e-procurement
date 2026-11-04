import { describe, expect, it } from "vitest";
import {
  bacaPengaturanAbsensi,
  jamSah,
  koordinatSah,
  lamaKerjaMenit,
  menitTerlambat,
  PENGATURAN_ABSENSI_BAWAAN,
  periksaMasuk,
  periksaPengaturanAbsensi,
  periksaPulang,
  putuskanAbsenCheckin,
  putuskanAbsenCheckout,
  ringkasBulanAbsen,
  susunHariBulan,
  tanpaSwafoto,
  tautanPeta,
  type PengaturanAbsensi,
} from "./absensi";

const atur = (x: Partial<PengaturanAbsensi> = {}): PengaturanAbsensi => ({
  ...PENGATURAN_ABSENSI_BAWAAN,
  aktif: true,
  ...x,
});
/** Jam WIB pada 30 Sep 2026. */
const wib = (hhmm: string, hari = "2026-09-30") => new Date(`${hari}T${hhmm}:00+07:00`);

describe("pengaturan absensi", () => {
  it("bawaan MATI, swafoto wajib, masuk paling lambat 09:00, kuota cuti 12 hari", () => {
    expect(bacaPengaturanAbsensi(null)).toEqual({
      aktif: false,
      selfieWajib: true,
      jamMasukPaling: "09:00",
      kuotaCutiTahunan: 12,
    });
    expect(bacaPengaturanAbsensi("{rusak")).toEqual(PENGATURAN_ABSENSI_BAWAAN);
  });

  it("kolom rusak jatuh ke bawaan per kolom", () => {
    expect(
      bacaPengaturanAbsensi(JSON.stringify({ aktif: true, selfieWajib: 1, jamMasukPaling: "25:00", kuotaCutiTahunan: 2.5 })),
    ).toEqual({
      aktif: true,
      selfieWajib: true,
      jamMasukPaling: "09:00",
      kuotaCutiTahunan: 12,
    });
    // Baris lama, disimpan sebelum kuota cuti ada: kuotanya bawaan, sisanya utuh.
    expect(bacaPengaturanAbsensi(JSON.stringify({ aktif: true, selfieWajib: false, jamMasukPaling: "08:30" }))).toEqual({
      aktif: true,
      selfieWajib: false,
      jamMasukPaling: "08:30",
      kuotaCutiTahunan: 12,
    });
    expect(bacaPengaturanAbsensi(JSON.stringify({ aktif: true, selfieWajib: false, jamMasukPaling: "08:30", kuotaCutiTahunan: 0 })))
      .toMatchObject({ kuotaCutiTahunan: 0 });
    expect(bacaPengaturanAbsensi(JSON.stringify({ aktif: true, selfieWajib: false, jamMasukPaling: "08:30", kuotaCutiTahunan: -1 })))
      .toMatchObject({ kuotaCutiTahunan: 12 });
  });

  it("jamSah hanya HH:MM 24 jam", () => {
    for (const j of ["00:00", "08:30", "23:59"]) expect(jamSah(j)).toBe(true);
    for (const j of ["8:30", "24:00", "12:60", "", "0830", "08:30:00"]) expect(jamSah(j)).toBe(false);
  });

  it("periksaPengaturanAbsensi ketat, dan hasilnya terbaca kembali sama", () => {
    expect(periksaPengaturanAbsensi({ aktif: true, selfieWajib: false, jamMasukPaling: "08:00", kuotaCutiTahunan: 14 })).toEqual({
      aktif: true,
      selfieWajib: false,
      jamMasukPaling: "08:00",
      kuotaCutiTahunan: 14,
    });
    expect(periksaPengaturanAbsensi({ aktif: true, selfieWajib: false, jamMasukPaling: "8:00", kuotaCutiTahunan: 12 })).toBeNull();
    expect(periksaPengaturanAbsensi({ aktif: "1", selfieWajib: false, jamMasukPaling: "08:00", kuotaCutiTahunan: 12 })).toBeNull();
    // Kuota wajib ada saat menyimpan, bilangan bulat 0–365.
    expect(periksaPengaturanAbsensi({ aktif: true, selfieWajib: false, jamMasukPaling: "08:00" })).toBeNull();
    for (const k of [-1, 1.5, 366, "12", null]) {
      expect(periksaPengaturanAbsensi({ aktif: true, selfieWajib: false, jamMasukPaling: "08:00", kuotaCutiTahunan: k })).toBeNull();
    }
    expect(periksaPengaturanAbsensi({ aktif: true, selfieWajib: false, jamMasukPaling: "08:00", kuotaCutiTahunan: 0 })).toMatchObject({
      kuotaCutiTahunan: 0,
    });
    expect(periksaPengaturanAbsensi(undefined)).toBeNull();
    const p = atur({ jamMasukPaling: "07:45", kuotaCutiTahunan: 20 });
    expect(bacaPengaturanAbsensi(JSON.stringify(periksaPengaturanAbsensi(p)))).toEqual(p);
  });
});

describe("menitTerlambat", () => {
  it("tepat atau lebih awal → 0; sesudahnya menit keterlambatan, per jam WIB", () => {
    expect(menitTerlambat(wib("08:59"), "09:00")).toBe(0);
    expect(menitTerlambat(wib("09:00"), "09:00")).toBe(0);
    expect(menitTerlambat(wib("09:01"), "09:00")).toBe(1);
    expect(menitTerlambat(wib("10:15"), "09:00")).toBe(75);
    // Detik di dalam menit batas masih tepat waktu.
    expect(menitTerlambat(new Date("2026-09-30T09:00:59+07:00"), "09:00")).toBe(0);
  });

  it("jam batas yang rusak → pakai bawaan 09:00, bukan melempar", () => {
    expect(menitTerlambat(wib("09:30"), "aneh")).toBe(30);
  });
});

describe("periksaMasuk", () => {
  const dasar = {
    pengaturan: atur(),
    sudahMasuk: false,
    selfieUrl: "/api/foto/abc",
    lat: -6.2,
    lng: 106.8,
    akurasi: 12.4,
    catatan: null,
  };

  it("sah → dinormalkan (akurasi dibulatkan, catatan dirapikan)", () => {
    expect(periksaMasuk({ ...dasar, catatan: "  macet  " })).toEqual({
      ok: true,
      nilai: { selfieUrl: "/api/foto/abc", lat: -6.2, lng: 106.8, akurasi: 12, catatan: "macet" },
    });
  });

  it("modul mati → NONAKTIF; sudah absen hari ini → SUDAH_MASUK", () => {
    expect(periksaMasuk({ ...dasar, pengaturan: atur({ aktif: false }) })).toEqual({ ok: false, kode: "NONAKTIF" });
    expect(periksaMasuk({ ...dasar, sudahMasuk: true })).toEqual({ ok: false, kode: "SUDAH_MASUK" });
  });

  it("swafoto wajib bila diatur wajib; bila tidak, boleh kosong", () => {
    expect(periksaMasuk({ ...dasar, selfieUrl: null })).toEqual({ ok: false, kode: "SWAFOTO_WAJIB" });
    const r = periksaMasuk({ ...dasar, selfieUrl: null, pengaturan: atur({ selfieWajib: false }) });
    expect(r.ok && r.nilai.selfieUrl).toBeNull();
    expect(periksaMasuk({ ...dasar, selfieUrl: "https://x.com/a.jpg" })).toEqual({ ok: false, kode: "SWAFOTO_TIDAK_SAH" });
  });

  it("lokasi wajib dan harus koordinat bumi", () => {
    expect(periksaMasuk({ ...dasar, lat: null, lng: null })).toEqual({ ok: false, kode: "LOKASI_WAJIB" });
    expect(periksaMasuk({ ...dasar, lat: 91, lng: 106 })).toEqual({ ok: false, kode: "LOKASI_WAJIB" });
    expect(periksaMasuk({ ...dasar, lat: Number.NaN, lng: 106 })).toEqual({ ok: false, kode: "LOKASI_WAJIB" });
    expect(koordinatSah(0, 0)).toBe(true);
    expect(koordinatSah(-6.2, 181)).toBe(false);
  });

  it("akurasi yang tidak masuk akal dibuang, bukan menolak absen", () => {
    const r = periksaMasuk({ ...dasar, akurasi: -5 });
    expect(r.ok && r.nilai.akurasi).toBeNull();
  });

  it("catatan dibatasi panjangnya", () => {
    expect(periksaMasuk({ ...dasar, catatan: "x".repeat(501) })).toEqual({ ok: false, kode: "CATATAN_TERLALU_PANJANG" });
  });
});

describe("periksaPulang", () => {
  it("belum masuk / sudah pulang ditolak", () => {
    expect(periksaPulang(null)).toEqual({ ok: false, kode: "BELUM_MASUK" });
    expect(periksaPulang({ clockOutAt: wib("17:00") })).toEqual({ ok: false, kode: "SUDAH_PULANG" });
    expect(periksaPulang({ clockOutAt: null })).toEqual({ ok: true });
  });
});

describe("hitungan kecil", () => {
  it("lamaKerjaMenit", () => {
    expect(lamaKerjaMenit(wib("08:00"), wib("17:30"))).toBe(570);
    expect(lamaKerjaMenit(wib("08:00"), null)).toBeNull();
    expect(lamaKerjaMenit(wib("08:00"), wib("07:00"))).toBeNull();
  });

  it("tautanPeta hanya untuk koordinat sah", () => {
    expect(tautanPeta(-6.2, 106.8)).toBe("https://www.google.com/maps?q=-6.2,106.8");
    expect(tautanPeta(null, 106.8)).toBeNull();
  });
});

describe("rekap bulan", () => {
  const rows = [
    { dayKey: "2026-09-01", clockInAt: wib("08:50", "2026-09-01"), clockOutAt: wib("17:00", "2026-09-01") },
    { dayKey: "2026-09-02", clockInAt: wib("09:20", "2026-09-02"), clockOutAt: null },
    { dayKey: "2026-09-03", clockInAt: wib("10:00", "2026-09-03"), clockOutAt: wib("18:00", "2026-09-03") },
  ];

  it("ringkasBulanAbsen: hadir, terlambat, total menit terlambat, tanpa absen pulang", () => {
    expect(ringkasBulanAbsen(rows, "09:00")).toEqual({
      hadir: 3,
      terlambat: 2,
      menitTerlambat: 80,
      tanpaPulang: 1,
    });
    expect(ringkasBulanAbsen([], "09:00")).toEqual({ hadir: 0, terlambat: 0, menitTerlambat: 0, tanpaPulang: 0 });
  });

  it("susunHariBulan: hari terbaru dulu, hanya sampai hari ini untuk bulan berjalan", () => {
    const hari = susunHariBulan("2026-09", rows, "09:00", "2026-09-03");
    expect(hari.map((h) => h.dayKey)).toEqual(["2026-09-03", "2026-09-02", "2026-09-01"]);
    expect(hari[0]).toMatchObject({ dayKey: "2026-09-03", hadir: true, menitTerlambat: 60 });
    expect(hari[2]).toMatchObject({ dayKey: "2026-09-01", hadir: true, menitTerlambat: 0 });
  });

  it("susunHariBulan: hari tanpa absen tetap muncul (bukan dilompati), bulan lampau utuh", () => {
    const hari = susunHariBulan("2026-02", [], "09:00", "2026-09-30");
    expect(hari).toHaveLength(28);
    expect(hari[0]).toMatchObject({ dayKey: "2026-02-28", hadir: false, menitTerlambat: 0 });
    expect(susunHariBulan("2026-10", [], "09:00", "2026-09-30")).toEqual([]);
  });

  it("susunHariBulan: hari kosong yang izinnya disetujui membawa jenisnya; hari yang dihadiri tidak", () => {
    const izin = new Map([
      ["2026-09-03", "SAKIT" as const],
      ["2026-09-04", "SAKIT" as const],
    ]);
    const hari = susunHariBulan("2026-09", rows, "09:00", "2026-09-05", izin);
    const per = new Map(hari.map((h) => [h.dayKey, h]));
    // 3 Sep tetap absen masuk → hadir, bukan sakit.
    expect(per.get("2026-09-03")).toMatchObject({ hadir: true, izin: null });
    expect(per.get("2026-09-04")).toMatchObject({ hadir: false, izin: "SAKIT" });
    expect(per.get("2026-09-05")).toMatchObject({ hadir: false, izin: null });
  });
});

describe("absen SPG lewat check-in toko", () => {
  it("check-in pertama hari itu = absen masuk; hanya bila absensi menyala", () => {
    expect(putuskanAbsenCheckin({ pengaturan: atur(), absen: null })).toBe("MASUK");
    expect(putuskanAbsenCheckin({ pengaturan: atur({ aktif: false }), absen: null })).toBe("LEWATI");
  });

  it("swafoto wajib tidak menahan check-in: absen tetap tercatat, ditandai tanpa swafoto", () => {
    expect(putuskanAbsenCheckin({ pengaturan: atur({ selfieWajib: true }), absen: null })).toBe("MASUK");
    expect(tanpaSwafoto({ selfieUrl: null }, atur({ selfieWajib: true }))).toBe(true);
    expect(tanpaSwafoto({ selfieUrl: null }, atur({ selfieWajib: false }))).toBe(false);
    expect(tanpaSwafoto({ selfieUrl: "/api/foto/x" }, atur({ selfieWajib: true }))).toBe(false);
  });

  it("tidak pernah absen masuk dua kali; kembali sesudah check-out membuka harinya lagi", () => {
    expect(putuskanAbsenCheckin({ pengaturan: atur(), absen: { clockOutAt: null } })).toBe("LEWATI");
    expect(putuskanAbsenCheckin({ pengaturan: atur(), absen: { clockOutAt: wib("12:00") } })).toBe("BUKA_LAGI");
    // Absensi dimatikan siang hari: tidak ada yang diubah lagi oleh check-in.
    expect(putuskanAbsenCheckin({ pengaturan: atur({ aktif: false }), absen: { clockOutAt: wib("12:00") } })).toBe("LEWATI");
  });

  it("check-out menutup hari yang masih terbuka, walau absensi sudah dimatikan", () => {
    expect(putuskanAbsenCheckout(null)).toBe("LEWATI");
    expect(putuskanAbsenCheckout({ clockOutAt: null })).toBe("PULANG");
    expect(putuskanAbsenCheckout({ clockOutAt: wib("17:00") })).toBe("LEWATI");
  });
});
