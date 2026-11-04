import { describe, expect, it } from "vitest";
import {
  bacaHariKerjaSpg,
  bertumpuk,
  bolehMelihatIzin,
  bolehMemutuskanIzin,
  bolehMengajukanIzin,
  geserHari,
  HARI_KERJA_SPG_BAWAAN,
  HARI_TIDAK_KERJA,
  hariKerja,
  hariTidakKerjaDari,
  hariTidakKerjaOrang,
  hitungHariIzinBulan,
  hitungHariKerja,
  izinPadaHari,
  jejakPindahIzin,
  labelRentangIzin,
  MAKS_HARI_AJUAN,
  MUNDUR_MAKS_HARI,
  periksaAjuanIzin,
  periksaHariKerjaSpg,
  periksaPindahIzin,
  petaHariIzin,
  ringkasCuti,
  tahunRentang,
  tanggalSah,
  terpakaiCuti,
  type AjuanLain,
} from "./izin";

/*
 * Kalender acuan Oktober 2026: 1 Okt = Kamis, 4 Okt = Minggu, 5 Okt = Senin.
 * Hari ini di semua tes = Kamis 1 Okt 2026 kecuali disebut lain.
 */
const HARI_INI = "2026-10-01";

const dasar = {
  jenis: "IZIN",
  mulai: "2026-10-05",
  selesai: "2026-10-05",
  alasan: "Urusan keluarga",
  fotoUrl: null as string | null,
};

const konteks = (x: Partial<{ hariIni: string; lain: AjuanLain[]; kuotaCutiTahunan: number }> = {}) => ({
  hariIni: HARI_INI,
  lain: [] as AjuanLain[],
  kuotaCutiTahunan: 12,
  ...x,
});

const cuti = (startDay: string, endDay: string, status = "DISETUJUI"): AjuanLain => ({
  type: "CUTI",
  startDay,
  endDay,
  status,
});

describe("tanggal & hari kerja", () => {
  it("tanggalSah hanya YYYY-MM-DD yang benar-benar ada", () => {
    for (const s of ["2026-10-01", "2028-02-29", "2026-12-31"]) expect(tanggalSah(s)).toBe(true);
    for (const s of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-1-01", "", "01-10-2026", null, 20261001]) {
      expect(tanggalSah(s)).toBe(false);
    }
  });

  it("geserHari melewati batas bulan dan tahun", () => {
    expect(geserHari("2026-10-01", -1)).toBe("2026-09-30");
    expect(geserHari("2026-12-31", 1)).toBe("2027-01-01");
    expect(geserHari("2026-10-01", -7)).toBe("2026-09-24");
  });

  it("Minggu bukan hari kerja; Senin–Sabtu hari kerja", () => {
    expect(HARI_TIDAK_KERJA).toEqual([0]);
    expect(hariKerja("2026-10-04")).toBe(false); // Minggu
    for (const d of ["2026-10-03", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]) {
      expect(hariKerja(d)).toBe(true);
    }
  });

  it("hitungHariKerja menghitung inklusif dan melewati Minggu", () => {
    expect(hitungHariKerja("2026-10-05", "2026-10-05")).toBe(1);
    // Senin 5 – Minggu 11: enam hari kerja.
    expect(hitungHariKerja("2026-10-05", "2026-10-11")).toBe(6);
    // Sabtu 3 – Senin 5: Sabtu + Senin.
    expect(hitungHariKerja("2026-10-03", "2026-10-05")).toBe(2);
    expect(hitungHariKerja("2026-10-04", "2026-10-04")).toBe(0);
    // Selesai sebelum mulai → nol, bukan negatif.
    expect(hitungHariKerja("2026-10-06", "2026-10-05")).toBe(0);
  });

  it("hitungHariKerja per tahun memotong rentang yang melintasi tahun", () => {
    // Senin 28 Des 2026 – Sabtu 2 Jan 2027: 4 hari di 2026 (28–31), 2 di 2027 (1–2).
    expect(hitungHariKerja("2026-12-28", "2027-01-02")).toBe(6);
    expect(hitungHariKerja("2026-12-28", "2027-01-02", "2026")).toBe(4);
    expect(hitungHariKerja("2026-12-28", "2027-01-02", "2027")).toBe(2);
    expect(hitungHariKerja("2026-12-28", "2027-01-02", "2025")).toBe(0);
    expect(tahunRentang("2026-12-28", "2027-01-02")).toEqual(["2026", "2027"]);
    expect(tahunRentang("2026-10-05", "2026-10-09")).toEqual(["2026"]);
  });

  it("bertumpuk: rentang yang berbagi satu hari pun bertumpuk; bersebelahan tidak", () => {
    expect(bertumpuk({ startDay: "2026-10-05", endDay: "2026-10-07" }, { startDay: "2026-10-07", endDay: "2026-10-09" })).toBe(true);
    expect(bertumpuk({ startDay: "2026-10-05", endDay: "2026-10-09" }, { startDay: "2026-10-06", endDay: "2026-10-06" })).toBe(true);
    expect(bertumpuk({ startDay: "2026-10-06", endDay: "2026-10-06" }, { startDay: "2026-10-05", endDay: "2026-10-09" })).toBe(true);
    expect(bertumpuk({ startDay: "2026-10-05", endDay: "2026-10-06" }, { startDay: "2026-10-07", endDay: "2026-10-09" })).toBe(false);
    expect(bertumpuk({ startDay: "2026-10-10", endDay: "2026-10-12" }, { startDay: "2026-10-05", endDay: "2026-10-09" })).toBe(false);
  });
});

describe("periksaAjuanIzin — bentuk", () => {
  it("ajuan sah mengembalikan nilai rapi dengan jumlah hari kerja", () => {
    const r = periksaAjuanIzin({ ...dasar, mulai: "2026-10-05", selesai: "2026-10-11", alasan: "  Pulang kampung  " }, konteks());
    expect(r).toEqual({
      ok: true,
      nilai: {
        jenis: "IZIN",
        mulai: "2026-10-05",
        selesai: "2026-10-11",
        alasan: "Pulang kampung",
        fotoUrl: null,
        hariKerja: 6,
        fotoDisarankan: false,
      },
    });
  });

  it("jenis, tanggal, dan urutan tanggal diperiksa", () => {
    expect(periksaAjuanIzin({ ...dasar, jenis: "LIBUR" }, konteks())).toEqual({ ok: false, kode: "JENIS_TIDAK_SAH" });
    expect(periksaAjuanIzin({ ...dasar, mulai: "2026-02-30" }, konteks())).toEqual({ ok: false, kode: "TANGGAL_TIDAK_SAH" });
    expect(periksaAjuanIzin({ ...dasar, selesai: "" }, konteks())).toEqual({ ok: false, kode: "TANGGAL_TIDAK_SAH" });
    expect(periksaAjuanIzin({ ...dasar, mulai: "2026-10-06", selesai: "2026-10-05" }, konteks())).toEqual({
      ok: false,
      kode: "SELESAI_SEBELUM_MULAI",
    });
  });

  it(`paling lama ${MAKS_HARI_AJUAN} hari kalender per ajuan`, () => {
    // 5 Okt – 3 Nov = 30 hari: boleh. Sampai 4 Nov = 31: ditolak.
    expect(periksaAjuanIzin({ ...dasar, mulai: "2026-10-05", selesai: "2026-11-03" }, konteks()).ok).toBe(true);
    expect(periksaAjuanIzin({ ...dasar, mulai: "2026-10-05", selesai: "2026-11-04" }, konteks())).toEqual({
      ok: false,
      kode: "TERLALU_PANJANG",
    });
  });

  it(`izin dan sakit boleh mulai paling jauh ${MUNDUR_MAKS_HARI} hari ke belakang`, () => {
    // Hari ini Kamis 1 Okt → paling awal Kamis 24 Sep.
    for (const jenis of ["IZIN", "SAKIT"]) {
      expect(periksaAjuanIzin({ ...dasar, jenis, mulai: "2026-09-24", selesai: "2026-09-25" }, konteks()).ok).toBe(true);
      expect(periksaAjuanIzin({ ...dasar, jenis, mulai: "2026-09-23", selesai: "2026-09-25" }, konteks())).toEqual({
        ok: false,
        kode: "TERLALU_LAMA_MUNDUR",
      });
    }
  });

  it("cuti harus mulai hari ini atau sesudahnya", () => {
    expect(periksaAjuanIzin({ ...dasar, jenis: "CUTI", mulai: HARI_INI, selesai: HARI_INI }, konteks()).ok).toBe(true);
    expect(periksaAjuanIzin({ ...dasar, jenis: "CUTI", mulai: "2026-09-30", selesai: "2026-10-02" }, konteks())).toEqual({
      ok: false,
      kode: "CUTI_TIDAK_BOLEH_MUNDUR",
    });
  });

  it("rentang yang hanya berisi hari Minggu ditolak — tidak ada hari kerja yang diizinkan", () => {
    expect(periksaAjuanIzin({ ...dasar, mulai: "2026-10-04", selesai: "2026-10-04" }, konteks())).toEqual({
      ok: false,
      kode: "TANPA_HARI_KERJA",
    });
  });

  it("alasan wajib dan dibatasi panjangnya", () => {
    expect(periksaAjuanIzin({ ...dasar, alasan: "   " }, konteks())).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(periksaAjuanIzin({ ...dasar, alasan: null }, konteks())).toEqual({ ok: false, kode: "ALASAN_WAJIB" });
    expect(periksaAjuanIzin({ ...dasar, alasan: "x".repeat(501) }, konteks())).toEqual({
      ok: false,
      kode: "ALASAN_TERLALU_PANJANG",
    });
  });

  it("foto boleh kosong; kalau ada, harus foto yang diunggah ke /api/foto", () => {
    expect(periksaAjuanIzin({ ...dasar, fotoUrl: "/api/foto/abc123" }, konteks())).toMatchObject({
      ok: true,
      nilai: { fotoUrl: "/api/foto/abc123" },
    });
    expect(periksaAjuanIzin({ ...dasar, fotoUrl: "https://contoh.com/a.jpg" }, konteks())).toEqual({
      ok: false,
      kode: "FOTO_TIDAK_SAH",
    });
  });

  it("sakit lebih dari satu hari kerja tanpa foto: tetap sah, tapi foto disarankan", () => {
    const satuHari = periksaAjuanIzin({ ...dasar, jenis: "SAKIT", mulai: "2026-09-30", selesai: "2026-09-30" }, konteks());
    expect(satuHari).toMatchObject({ ok: true, nilai: { fotoDisarankan: false } });
    const duaHari = periksaAjuanIzin({ ...dasar, jenis: "SAKIT", mulai: "2026-09-30", selesai: "2026-10-01" }, konteks());
    expect(duaHari).toMatchObject({ ok: true, nilai: { fotoDisarankan: true } });
    const denganSurat = periksaAjuanIzin(
      { ...dasar, jenis: "SAKIT", mulai: "2026-09-30", selesai: "2026-10-01", fotoUrl: "/api/foto/surat" },
      konteks(),
    );
    expect(denganSurat).toMatchObject({ ok: true, nilai: { fotoDisarankan: false } });
    // Sabtu + Minggu = satu hari kerja: tidak disarankan.
    const akhirPekan = periksaAjuanIzin({ ...dasar, jenis: "SAKIT", mulai: "2026-10-03", selesai: "2026-10-04" }, konteks());
    expect(akhirPekan).toMatchObject({ ok: true, nilai: { fotoDisarankan: false } });
    // Izin dua hari tanpa foto: tidak ada saran.
    const izin = periksaAjuanIzin({ ...dasar, mulai: "2026-10-05", selesai: "2026-10-06" }, konteks());
    expect(izin).toMatchObject({ ok: true, nilai: { fotoDisarankan: false } });
  });
});

describe("periksaAjuanIzin — bentrok", () => {
  const ajuan = { ...dasar, mulai: "2026-10-05", selesai: "2026-10-07" };

  it("ditolak bila bertumpuk dengan ajuan lain yang masih DIAJUKAN atau sudah DISETUJUI", () => {
    for (const status of ["DIAJUKAN", "DISETUJUI"]) {
      const lain = [{ type: "SAKIT", startDay: "2026-10-07", endDay: "2026-10-08", status }];
      expect(periksaAjuanIzin(ajuan, konteks({ lain }))).toEqual({ ok: false, kode: "BENTROK" });
    }
  });

  it("ajuan yang DITOLAK atau DIBATALKAN tidak menghalangi", () => {
    for (const status of ["DITOLAK", "DIBATALKAN"]) {
      const lain = [{ type: "IZIN", startDay: "2026-10-05", endDay: "2026-10-07", status }];
      expect(periksaAjuanIzin(ajuan, konteks({ lain })).ok).toBe(true);
    }
  });

  it("rentang yang bersebelahan tidak bentrok", () => {
    const lain = [cuti("2026-10-08", "2026-10-09"), cuti("2026-10-01", "2026-10-04", "DIAJUKAN")];
    expect(periksaAjuanIzin(ajuan, konteks({ lain })).ok).toBe(true);
  });
});

describe("periksaAjuanIzin — kuota cuti", () => {
  const ajuanCuti = (mulai: string, selesai: string) => ({ ...dasar, jenis: "CUTI", mulai, selesai });

  it("cuti dihitung per hari kerja terhadap kuota tahunan, termasuk yang masih menunggu", () => {
    // 2026: 6 hari disetujui + 3 menunggu = 9 terpakai, kuota 12 → sisa 3.
    const lain = [cuti("2026-11-02", "2026-11-07"), cuti("2026-11-16", "2026-11-18", "DIAJUKAN")];
    // Tiga hari kerja: pas.
    expect(periksaAjuanIzin(ajuanCuti("2026-10-05", "2026-10-07"), konteks({ lain })).ok).toBe(true);
    // Empat hari kerja: lewat satu.
    expect(periksaAjuanIzin(ajuanCuti("2026-10-05", "2026-10-08"), konteks({ lain }))).toEqual({
      ok: false,
      kode: "KUOTA_CUTI_HABIS",
      tahun: "2026",
      sisa: 3,
    });
    // Senin–Minggu = 6 hari kerja walau 7 hari kalender: Minggu tidak memakan kuota.
    expect(periksaAjuanIzin(ajuanCuti("2026-10-05", "2026-10-11"), konteks({ lain, kuotaCutiTahunan: 15 })).ok).toBe(true);
  });

  it("izin dan sakit tidak memakan kuota cuti, dan kuota tidak menghalangi mereka", () => {
    const lain = [cuti("2026-11-02", "2026-11-14")]; // 12 hari kerja: kuota habis
    expect(terpakaiCuti(lain, "2026")).toBe(12);
    expect(periksaAjuanIzin({ ...dasar, jenis: "SAKIT", mulai: "2026-10-05", selesai: "2026-10-06" }, konteks({ lain })).ok).toBe(true);
    expect(periksaAjuanIzin(ajuanCuti("2026-10-05", "2026-10-05"), konteks({ lain }))).toMatchObject({
      ok: false,
      kode: "KUOTA_CUTI_HABIS",
      sisa: 0,
    });
    // Izin/sakit lain tidak dihitung sebagai cuti terpakai.
    expect(terpakaiCuti([{ type: "SAKIT", startDay: "2026-10-05", endDay: "2026-10-30", status: "DISETUJUI" }], "2026")).toBe(0);
  });

  it("kuota dihitung per tahun WIB: cuti lintas tahun memakai kuota masing-masing tahun", () => {
    // 2026 sudah 10 terpakai. Cuti 28 Des – 2 Jan: 4 hari di 2026 → lewat (10+4 > 12).
    const lain = [cuti("2026-11-02", "2026-11-12")]; // Senin 2 – Kamis 12: 10 hari kerja
    expect(terpakaiCuti(lain, "2026")).toBe(10);
    expect(periksaAjuanIzin(ajuanCuti("2026-12-28", "2027-01-02"), konteks({ lain }))).toEqual({
      ok: false,
      kode: "KUOTA_CUTI_HABIS",
      tahun: "2026",
      sisa: 2,
    });
    // 30–31 Des (2 hari) + 1–2 Jan (2 hari, kuota 2027 masih penuh): boleh.
    expect(periksaAjuanIzin(ajuanCuti("2026-12-30", "2027-01-02"), konteks({ lain })).ok).toBe(true);
  });

  it("ajuan cuti yang ditolak/dibatalkan tidak memakan kuota", () => {
    const lain = [cuti("2026-11-02", "2026-11-14", "DITOLAK"), cuti("2026-11-16", "2026-11-28", "DIBATALKAN")];
    expect(terpakaiCuti(lain, "2026")).toBe(0);
    expect(periksaAjuanIzin(ajuanCuti("2026-10-05", "2026-10-07"), konteks({ lain })).ok).toBe(true);
  });

  it("kuota nol berarti cuti tidak bisa diajukan", () => {
    expect(periksaAjuanIzin(ajuanCuti("2026-10-05", "2026-10-05"), konteks({ kuotaCutiTahunan: 0 }))).toMatchObject({
      ok: false,
      kode: "KUOTA_CUTI_HABIS",
    });
  });

  it("ringkasCuti memisahkan yang disetujui dan yang menunggu, sisa tidak pernah negatif", () => {
    const lain = [cuti("2026-11-02", "2026-11-07"), cuti("2026-11-16", "2026-11-18", "DIAJUKAN"), cuti("2026-12-01", "2026-12-01", "DITOLAK")];
    expect(ringkasCuti(lain, "2026", 12)).toEqual({ tahun: "2026", kuota: 12, disetujui: 6, menunggu: 3, sisa: 3 });
    expect(ringkasCuti(lain, "2026", 5)).toEqual({ tahun: "2026", kuota: 5, disetujui: 6, menunggu: 3, sisa: 0 });
    expect(ringkasCuti(lain, "2027", 12)).toEqual({ tahun: "2027", kuota: 12, disetujui: 0, menunggu: 0, sisa: 12 });
  });
});

describe("perpindahan status", () => {
  it("pemohon hanya boleh membatalkan ajuannya yang masih DIAJUKAN; catatan tidak wajib", () => {
    expect(periksaPindahIzin("DIAJUKAN", "DIBATALKAN", "PEMOHON", null)).toEqual({ ok: true, catatan: null });
    expect(periksaPindahIzin("DIAJUKAN", "DIBATALKAN", "PEMOHON", "  batal  ")).toEqual({ ok: true, catatan: "batal" });
    expect(periksaPindahIzin("DISETUJUI", "DIBATALKAN", "PEMOHON", "x")).toEqual({ ok: false, kode: "TRANSISI_TIDAK_SAH" });
    expect(periksaPindahIzin("DIAJUKAN", "DISETUJUI", "PEMOHON", null)).toEqual({ ok: false, kode: "TRANSISI_TIDAK_SAH" });
    expect(periksaPindahIzin("DIAJUKAN", "DITOLAK", "PEMOHON", "x")).toEqual({ ok: false, kode: "TRANSISI_TIDAK_SAH" });
  });

  it("kantor menyetujui (catatan opsional) atau menolak (catatan wajib) yang DIAJUKAN", () => {
    expect(periksaPindahIzin("DIAJUKAN", "DISETUJUI", "KANTOR", undefined)).toEqual({ ok: true, catatan: null });
    expect(periksaPindahIzin("DIAJUKAN", "DISETUJUI", "KANTOR", "ok, hati-hati")).toEqual({ ok: true, catatan: "ok, hati-hati" });
    expect(periksaPindahIzin("DIAJUKAN", "DITOLAK", "KANTOR", " ")).toEqual({ ok: false, kode: "CATATAN_WAJIB" });
    expect(periksaPindahIzin("DIAJUKAN", "DITOLAK", "KANTOR", "Sedang stok opname")).toEqual({
      ok: true,
      catatan: "Sedang stok opname",
    });
    // Kantor tidak "membatalkan" ajuan yang belum diputuskan — itu menolak.
    expect(periksaPindahIzin("DIAJUKAN", "DIBATALKAN", "KANTOR", "x")).toEqual({ ok: false, kode: "TRANSISI_TIDAK_SAH" });
  });

  it("yang sudah DISETUJUI hanya bisa dibatalkan kantor, dengan catatan", () => {
    expect(periksaPindahIzin("DISETUJUI", "DIBATALKAN", "KANTOR", "")).toEqual({ ok: false, kode: "CATATAN_WAJIB" });
    expect(periksaPindahIzin("DISETUJUI", "DIBATALKAN", "KANTOR", "Ternyata masuk")).toEqual({ ok: true, catatan: "Ternyata masuk" });
    expect(periksaPindahIzin("DISETUJUI", "DITOLAK", "KANTOR", "x")).toEqual({ ok: false, kode: "TRANSISI_TIDAK_SAH" });
  });

  it("ditolak dan dibatalkan adalah akhir; status asing ditolak", () => {
    for (const dari of ["DITOLAK", "DIBATALKAN", "ANEH"]) {
      for (const ke of ["DISETUJUI", "DITOLAK", "DIBATALKAN"] as const) {
        for (const pelaku of ["PEMOHON", "KANTOR"] as const) {
          expect(periksaPindahIzin(dari, ke, pelaku, "x")).toEqual({ ok: false, kode: "TRANSISI_TIDAK_SAH" });
        }
      }
    }
  });

  it("catatan dibatasi panjangnya", () => {
    expect(periksaPindahIzin("DIAJUKAN", "DITOLAK", "KANTOR", "x".repeat(501))).toEqual({
      ok: false,
      kode: "CATATAN_TERLALU_PANJANG",
    });
  });

  it("nama jejak membedakan penarikan oleh pemohon dari pembatalan oleh kantor", () => {
    expect(jejakPindahIzin("DISETUJUI", "KANTOR")).toBe("LEAVE_REQUEST_APPROVED");
    expect(jejakPindahIzin("DITOLAK", "KANTOR")).toBe("LEAVE_REQUEST_REJECTED");
    expect(jejakPindahIzin("DIBATALKAN", "PEMOHON")).toBe("LEAVE_REQUEST_WITHDRAWN");
    expect(jejakPindahIzin("DIBATALKAN", "KANTOR")).toBe("LEAVE_REQUEST_CANCELLED");
  });
});

describe("hari izin di riwayat absen", () => {
  const disetujui = [
    { type: "SAKIT", startDay: "2026-09-29", endDay: "2026-10-02" },
    { type: "CUTI", startDay: "2026-10-10", endDay: "2026-10-12" },
  ];

  it("petaHariIzin hanya memuat hari di bulan yang diminta, termasuk Minggu di dalam rentang", () => {
    const peta = petaHariIzin(disetujui, "2026-10");
    expect([...peta.entries()]).toEqual([
      ["2026-10-01", "SAKIT"],
      ["2026-10-02", "SAKIT"],
      ["2026-10-10", "CUTI"],
      ["2026-10-11", "CUTI"],
      ["2026-10-12", "CUTI"],
    ]);
    expect(petaHariIzin(disetujui, "2026-09").get("2026-09-29")).toBe("SAKIT");
    expect(petaHariIzin(disetujui, "2026-11").size).toBe(0);
  });

  it("izinPadaHari menemukan ajuan yang meliputi satu hari", () => {
    expect(izinPadaHari(disetujui, "2026-10-11")).toBe("CUTI");
    expect(izinPadaHari(disetujui, "2026-09-29")).toBe("SAKIT");
    expect(izinPadaHari(disetujui, "2026-10-05")).toBeNull();
  });

  it("rekap menghitung hari KERJA yang sudah lewat dan tidak dihadiri", () => {
    const peta = petaHariIzin(disetujui, "2026-10");
    // Sampai 12 Okt: sakit 1–2 (2), cuti 10 & 12 (11 = Minggu, tidak dihitung).
    expect(hitungHariIzinBulan(peta, new Set(), "2026-10-12")).toEqual({ IZIN: 0, SAKIT: 2, CUTI: 2 });
    // Hari depan belum terjadi: sampai 10 Okt, cuti baru satu hari.
    expect(hitungHariIzinBulan(peta, new Set(), "2026-10-10")).toEqual({ IZIN: 0, SAKIT: 2, CUTI: 1 });
    // Hari yang tetap absen masuk dihitung hadir, bukan izin.
    expect(hitungHariIzinBulan(peta, new Set(["2026-10-02"]), "2026-10-31")).toEqual({ IZIN: 0, SAKIT: 1, CUTI: 2 });
  });
});

describe("siapa boleh apa", () => {
  it("mengajukan = akses aplikasi HP; memutuskan = penyetuju pesanan lapangan; melihat = atasan", () => {
    expect(bolehMengajukanIzin(["pwa:access"])).toBe(true);
    expect(bolehMengajukanIzin(["field_sales_orders:approve"])).toBe(false);
    expect(bolehMemutuskanIzin(["field_sales_orders:approve"])).toBe(true);
    expect(bolehMemutuskanIzin(["field_sales_orders:view"])).toBe(false);
    expect(bolehMemutuskanIzin(["*"])).toBe(true);
    expect(bolehMelihatIzin(["field_sales_orders:view"])).toBe(true);
    expect(bolehMelihatIzin(["field_sales_orders:approve"])).toBe(true);
    expect(bolehMelihatIzin(["pwa:access"])).toBe(false);
    expect(bolehMelihatIzin(undefined)).toBe(false);
  });
});

describe("labelRentangIzin", () => {
  it("satu hari, satu bulan, satu tahun, lintas tahun", () => {
    expect(labelRentangIzin("2026-10-05", "2026-10-05")).toBe("5 Okt 2026");
    expect(labelRentangIzin("2026-10-05", "2026-10-07")).toBe("5–7 Okt 2026");
    expect(labelRentangIzin("2026-09-28", "2026-10-02")).toBe("28 Sep – 2 Okt 2026");
    expect(labelRentangIzin("2026-12-28", "2027-01-02")).toBe("28 Des 2026 – 2 Jan 2027");
  });
});

describe("hari kerja SPG (counter buka akhir pekan)", () => {
  // 4 Okt 2026 = Minggu, 5 Okt = Senin, 10 Okt = Sabtu, 11 Okt = Minggu.
  const SEMUA = HARI_KERJA_SPG_BAWAAN;
  const liburSpg = hariTidakKerjaDari(SEMUA);

  it("bawaan SPG Senin–Minggu: tidak ada hari libur; salesman tetap libur Minggu", () => {
    expect([...SEMUA].sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(liburSpg).toEqual([]);
    expect(hariTidakKerjaOrang({ spg: false, hariKerjaSpg: SEMUA })).toEqual(HARI_TIDAK_KERJA);
    expect(hariTidakKerjaOrang({ spg: true, hariKerjaSpg: SEMUA })).toEqual([]);
    expect(hariTidakKerjaOrang({ spg: true, hariKerjaSpg: [1, 2, 3, 4, 5] })).toEqual([0, 6]);
  });

  it("menghitung hari kerja memakai hari kerja orangnya", () => {
    expect(hariKerja("2026-10-04")).toBe(false);
    expect(hariKerja("2026-10-04", liburSpg)).toBe(true);
    // Senin 5 – Minggu 11 Okt: salesman 6 hari, SPG 7 hari.
    expect(hitungHariKerja("2026-10-05", "2026-10-11")).toBe(6);
    expect(hitungHariKerja("2026-10-05", "2026-10-11", undefined, liburSpg)).toBe(7);
    expect(hitungHariKerja("2026-12-30", "2027-01-02", "2027", liburSpg)).toBe(2);
  });

  it("izin hari Minggu: salesman ditolak (tanpa hari kerja), SPG boleh", () => {
    const minggu = { ...dasar, mulai: "2026-10-04", selesai: "2026-10-04" };
    expect(periksaAjuanIzin(minggu, konteks())).toEqual({ ok: false, kode: "TANPA_HARI_KERJA" });
    const r = periksaAjuanIzin(minggu, { ...konteks(), hariTidakKerja: liburSpg });
    expect(r.ok && r.nilai.hariKerja).toBe(1);
  });

  it("kuota cuti SPG memakan hari Minggu juga", () => {
    // Cuti seminggu penuh (5–11 Okt) dengan kuota 6: salesman pas, SPG kelebihan satu hari.
    const isi = { ...dasar, jenis: "CUTI", mulai: "2026-10-05", selesai: "2026-10-11" };
    expect(periksaAjuanIzin(isi, konteks({ kuotaCutiTahunan: 6 })).ok).toBe(true);
    expect(periksaAjuanIzin(isi, { ...konteks({ kuotaCutiTahunan: 6 }), hariTidakKerja: liburSpg })).toEqual({
      ok: false,
      kode: "KUOTA_CUTI_HABIS",
      tahun: "2026",
      sisa: 6,
    });
    const lain = [cuti("2026-10-12", "2026-10-18")];
    expect(terpakaiCuti(lain, "2026")).toBe(6);
    expect(terpakaiCuti(lain, "2026", liburSpg)).toBe(7);
    expect(ringkasCuti(lain, "2026", 12, liburSpg)).toMatchObject({ disetujui: 7, sisa: 5 });
  });

  it("rekap bulan menghitung Minggu sebagai hari izin untuk SPG", () => {
    const peta = petaHariIzin([{ type: "CUTI", startDay: "2026-10-10", endDay: "2026-10-12" }], "2026-10");
    expect(hitungHariIzinBulan(peta, new Set(), "2026-10-31")).toEqual({ IZIN: 0, SAKIT: 0, CUTI: 2 });
    expect(hitungHariIzinBulan(peta, new Set(), "2026-10-31", liburSpg)).toEqual({ IZIN: 0, SAKIT: 0, CUTI: 3 });
  });

  it("setelan: dibaca longgar dengan bawaan, disimpan ketat", () => {
    expect(bacaHariKerjaSpg(null)).toEqual(HARI_KERJA_SPG_BAWAAN);
    expect(bacaHariKerjaSpg("bukan json")).toEqual(HARI_KERJA_SPG_BAWAAN);
    expect(bacaHariKerjaSpg(JSON.stringify({ hariKerja: [] }))).toEqual(HARI_KERJA_SPG_BAWAAN);
    expect(bacaHariKerjaSpg(JSON.stringify({ hariKerja: [6, 1, 1, 9, "x"] }))).toEqual([1, 6]);
    expect(periksaHariKerjaSpg({ hariKerja: [6, 1, 2] })).toEqual({ hariKerja: [1, 2, 6] });
    expect(periksaHariKerjaSpg({ hariKerja: [] })).toBeNull();
    expect(periksaHariKerjaSpg({ hariKerja: [1, 7] })).toBeNull();
    expect(periksaHariKerjaSpg({ hariKerja: [1, 1] })).toBeNull();
    expect(periksaHariKerjaSpg({ hariKerja: [1.5] })).toBeNull();
    expect(periksaHariKerjaSpg([1, 2])).toBeNull();
    // Yang disimpan terbaca kembali persis sama.
    const simpan = periksaHariKerjaSpg({ hariKerja: [0, 5, 6] })!;
    expect(JSON.stringify({ hariKerja: bacaHariKerjaSpg(JSON.stringify(simpan)) })).toBe(JSON.stringify(simpan));
  });
});
