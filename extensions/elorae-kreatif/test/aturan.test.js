import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as a from "../lib/aturan.js";

const MENIT = 60_000;
// 2026-10-09 10:00 WIB = 03:00 UTC (di dalam jam kerja bawaan)
const SIANG = Date.parse("2026-10-09T03:00:00Z");
// 2026-10-09 19:00 WIB (di luar jam kerja bawaan)
const MALAM = Date.parse("2026-10-09T12:00:00Z");

const statusServer = (lain = {}) => ({
  ok: true,
  perangkat: { id: "p1", nama: "Laptop admin" },
  aktif: true,
  dijedaSampai: null,
  alasanJeda: null,
  pengaturan: { ...a.PENGATURAN_BAWAAN },
  hariIni: { selesai: 10, gagal: 1, kuota: 300, sisa: 289 },
  ...lain,
});

const keadaanSiap = (lain = {}) => ({
  tersambung: true,
  otomatis: true,
  status: statusServer(),
  jedaLokal: null,
  kunci: null,
  jadwal: {},
  ...lain,
});

describe("bersihkanPengaturan", () => {
  test("bawaan bila server tidak memberi apa-apa", () => {
    assert.deepEqual(a.bersihkanPengaturan(undefined), a.PENGATURAN_BAWAAN);
    assert.deepEqual(a.bersihkanPengaturan(null), a.PENGATURAN_BAWAAN);
  });
  test("pemantauan 24 jam (00:00–24:00) dari Elorae dipakai apa adanya", () => {
    const p = a.bersihkanPengaturan({ jamMulai: "00:00", jamSelesai: "24:00" });
    assert.equal(p.jamMulai, "00:00");
    assert.equal(p.jamSelesai, "24:00");
  });
  test("nilai sah dipakai, nilai rusak diganti bawaan, min/maks ditukar bila terbalik", () => {
    const p = a.bersihkanPengaturan({
      jamMulai: "09:00",
      jamSelesai: "zz",
      jedaMinDetik: 50,
      jedaMaksDetik: 20,
      istirahatSetiapMenit: -3,
      istirahatMinMenit: "7",
      istirahatMaksMenit: 12,
    });
    assert.equal(p.jamMulai, "09:00");
    assert.equal(p.jamSelesai, a.PENGATURAN_BAWAAN.jamSelesai);
    assert.equal(p.jedaMinDetik, 20);
    assert.equal(p.jedaMaksDetik, 50);
    assert.equal(p.istirahatSetiapMenit, a.PENGATURAN_BAWAAN.istirahatSetiapMenit);
    assert.equal(p.istirahatMinMenit, 7);
    assert.equal(p.istirahatMaksMenit, 12);
  });
});

describe("putuskanLangkah", () => {
  test("semua syarat terpenuhi → AMBIL", () => {
    assert.deepEqual(a.putuskanLangkah(keadaanSiap(), SIANG), { langkah: "AMBIL", keadaan: "SIAP" });
  });
  test("belum tersambung / otomatis mati", () => {
    assert.equal(a.putuskanLangkah(keadaanSiap({ tersambung: false }), SIANG).keadaan, "BELUM_TERSAMBUNG");
    assert.equal(a.putuskanLangkah(keadaanSiap({ otomatis: false }), SIANG).keadaan, "MATI");
  });
  test("kunci yang masih segar → SIBUK; kunci basi (> 3 menit) diabaikan", () => {
    const segar = a.putuskanLangkah(keadaanSiap({ kunci: { sejak: SIANG - 2 * MENIT } }), SIANG);
    assert.deepEqual([segar.langkah, segar.keadaan], ["DIAM", "SIBUK"]);
    const basi = a.putuskanLangkah(keadaanSiap({ kunci: { sejak: SIANG - 3 * MENIT } }), SIANG);
    assert.equal(basi.langkah, "AMBIL");
  });
  test("Elorae tak terjangkau → TAK_TERJANGKAU", () => {
    assert.equal(a.putuskanLangkah(keadaanSiap({ status: null }), SIANG).keadaan, "TAK_TERJANGKAU");
  });
  test("perangkat nonaktif / dijeda server", () => {
    assert.equal(a.putuskanLangkah(keadaanSiap({ status: statusServer({ aktif: false }) }), SIANG).keadaan, "NONAKTIF");
    const jeda = a.putuskanLangkah(
      keadaanSiap({
        status: statusServer({ dijedaSampai: new Date(SIANG + 30 * MENIT).toISOString(), alasanJeda: "CAPTCHA" }),
      }),
      SIANG,
    );
    assert.deepEqual(
      { langkah: jeda.langkah, keadaan: jeda.keadaan, alasan: jeda.alasan, sampai: jeda.sampai },
      { langkah: "DIAM", keadaan: "DIJEDA", alasan: "CAPTCHA", sampai: SIANG + 30 * MENIT },
    );
    const lewat = a.putuskanLangkah(
      keadaanSiap({ status: statusServer({ dijedaSampai: new Date(SIANG - MENIT).toISOString() }) }),
      SIANG,
    );
    assert.equal(lewat.langkah, "AMBIL");
  });
  test("server yang menjeda juga mengirim aktif:false — tetap dibaca sebagai DIJEDA beserta alasannya", () => {
    const r = a.putuskanLangkah(
      keadaanSiap({
        status: statusServer({ aktif: false, dijedaSampai: new Date(SIANG + 60 * MENIT).toISOString(), alasanJeda: "CAPTCHA" }),
      }),
      SIANG,
    );
    assert.deepEqual([r.langkah, r.keadaan, r.alasan], ["DIAM", "DIJEDA", "CAPTCHA"]);
  });
  test("jeda lokal: menunggu server (captcha) atau sampai waktu tertentu", () => {
    const captcha = a.putuskanLangkah(
      keadaanSiap({ jedaLokal: { alasan: "CAPTCHA", tungguServer: true, sejak: SIANG - MENIT } }),
      SIANG,
    );
    assert.deepEqual([captcha.keadaan, captcha.alasan], ["DIJEDA", "CAPTCHA"]);
    const gagal = a.putuskanLangkah(
      keadaanSiap({ jedaLokal: { alasan: "GAGAL_BERUNTUN", sampai: SIANG + 10 * MENIT } }),
      SIANG,
    );
    assert.deepEqual([gagal.keadaan, gagal.alasan, gagal.sampai], ["DIJEDA", "GAGAL_BERUNTUN", SIANG + 10 * MENIT]);
  });
  test("di luar jam kerja, kuota habis", () => {
    assert.equal(a.putuskanLangkah(keadaanSiap(), MALAM).keadaan, "DI_LUAR_JAM");
    const habis = statusServer({ hariIni: { selesai: 300, gagal: 0, kuota: 300, sisa: 0 } });
    assert.equal(a.putuskanLangkah(keadaanSiap({ status: habis }), SIANG).keadaan, "KUOTA_HABIS");
  });
  test("istirahat dan menunggu jeda acak", () => {
    const rehat = a.putuskanLangkah(keadaanSiap({ jadwal: { istirahatSampai: SIANG + 5 * MENIT } }), SIANG);
    assert.deepEqual([rehat.keadaan, rehat.sampai], ["ISTIRAHAT", SIANG + 5 * MENIT]);
    const tunggu = a.putuskanLangkah(keadaanSiap({ jadwal: { berikutnyaAt: SIANG + 20_000 } }), SIANG);
    assert.deepEqual([tunggu.langkah, tunggu.keadaan], ["DIAM", "MENUNGGU"]);
    const kosong = a.putuskanLangkah(
      keadaanSiap({ jadwal: { berikutnyaAt: SIANG + 4 * MENIT, alasanMundur: "ANTREAN_KOSONG" } }),
      SIANG,
    );
    assert.equal(kosong.keadaan, "ANTREAN_KOSONG");
    const sudah = a.putuskanLangkah(keadaanSiap({ jadwal: { berikutnyaAt: SIANG } }), SIANG);
    assert.equal(sudah.langkah, "AMBIL");
  });
});

describe("perbaruiJedaLokal", () => {
  const captcha = { alasan: "CAPTCHA", tungguServer: true, sejak: SIANG - MENIT, terlihatDijeda: false, laporTerkirim: true };
  const dijeda = statusServer({ dijedaSampai: new Date(SIANG + 60 * MENIT).toISOString() });
  test("captcha: tetap berhenti selama server masih menjeda, lalu tandai terlihat", () => {
    const r = a.perbaruiJedaLokal(captcha, dijeda, SIANG);
    assert.equal(r.terlihatDijeda, true);
  });
  test("captcha: dilepas begitu server tidak menjeda lagi (sesudah pernah terlihat dijeda)", () => {
    assert.equal(a.perbaruiJedaLokal({ ...captcha, terlihatDijeda: true }, statusServer(), SIANG), null);
  });
  test("captcha: server belum pernah terlihat menjeda → tunggu, kecuali laporan sudah terkirim > 2 menit lalu", () => {
    assert.notEqual(a.perbaruiJedaLokal(captcha, statusServer(), SIANG), null);
    assert.equal(a.perbaruiJedaLokal({ ...captcha, sejak: SIANG - 2 * MENIT }, statusServer(), SIANG), null);
    const belumTerkirim = { ...captcha, laporTerkirim: false, sejak: SIANG - 60 * MENIT };
    assert.notEqual(a.perbaruiJedaLokal(belumTerkirim, statusServer(), SIANG), null);
  });
  test("captcha: Elorae tak terjangkau → tidak berubah", () => {
    assert.deepEqual(a.perbaruiJedaLokal(captcha, null, SIANG), captcha);
  });
  test("jeda berwaktu dilepas setelah lewat", () => {
    const j = { alasan: "GAGAL_BERUNTUN", sampai: SIANG };
    assert.equal(a.perbaruiJedaLokal(j, statusServer(), SIANG), null);
    assert.deepEqual(a.perbaruiJedaLokal(j, statusServer(), SIANG - 1), j);
    assert.equal(a.perbaruiJedaLokal(null, statusServer(), SIANG), null);
  });
});

describe("setelahTugas", () => {
  test("berhasil atau akun memang tak ada/privat → hitungan gagal kembali 0", () => {
    for (const kode of ["OK", "TIDAK_DITEMUKAN", "PRIVAT"]) {
      assert.deepEqual(a.setelahTugas(2, kode, SIANG), { gagalBeruntun: 0, jedaLokal: null });
    }
  });
  test("gagal muat / tak terbaca menambah hitungan; ketiga kali → jeda lokal 60 menit", () => {
    assert.deepEqual(a.setelahTugas(0, "GAGAL_MUAT", SIANG), { gagalBeruntun: 1, jedaLokal: null });
    assert.deepEqual(a.setelahTugas(1, "TIDAK_TERBACA", SIANG), { gagalBeruntun: 2, jedaLokal: null });
    assert.deepEqual(a.setelahTugas(2, "GAGAL_MUAT", SIANG), {
      gagalBeruntun: 0,
      jedaLokal: { alasan: "GAGAL_BERUNTUN", sejak: SIANG, sampai: SIANG + 60 * MENIT },
    });
  });
  test("lama jeda gagal beruntun mengikuti jedaOtomatisMenit dari Elorae; nilai rusak → 60 menit", () => {
    assert.equal(a.setelahTugas(2, "GAGAL_MUAT", SIANG, 30).jedaLokal.sampai, SIANG + 30 * MENIT);
    for (const rusak of [undefined, null, 0, -5, "30", Number.NaN]) {
      assert.equal(a.setelahTugas(2, "GAGAL_MUAT", SIANG, rusak).jedaLokal.sampai, SIANG + 60 * MENIT);
    }
  });
  test("captcha/login → berhenti sampai server melepas", () => {
    assert.deepEqual(a.setelahTugas(1, "CAPTCHA", SIANG), {
      gagalBeruntun: 0,
      jedaLokal: { alasan: "CAPTCHA", tungguServer: true, sejak: SIANG, terlihatDijeda: false, laporTerkirim: false },
    });
    assert.equal(a.setelahTugas(0, "LOGIN", SIANG).jedaLokal.alasan, "LOGIN");
  });
  test("diblokir TikTok → jeda berwaktu selama jeda otomatis Elorae (bukan menunggu server)", () => {
    assert.deepEqual(a.setelahTugas(2, "DIBLOKIR_TIKTOK", SIANG, 45), {
      gagalBeruntun: 0,
      jedaLokal: { alasan: "DIBLOKIR_TIKTOK", sejak: SIANG, sampai: SIANG + 45 * MENIT },
    });
    assert.equal(a.setelahTugas(0, "DIBLOKIR_TIKTOK", SIANG).jedaLokal.sampai, SIANG + 60 * MENIT);
    // "Cek sekarang" melewati jeda berwaktu; jeda ini juga lepas begitu Elorae terlihat menjeda lalu melepasnya.
    const j = a.setelahTugas(0, "DIBLOKIR_TIKTOK", SIANG, 45).jedaLokal;
    const dijeda = { dijedaSampai: new Date(SIANG + 45 * MENIT).toISOString() };
    const terlihat = a.perbaruiJedaLokal(j, dijeda, SIANG + MENIT);
    assert.equal(terlihat.terlihatDijeda, true);
    assert.equal(a.perbaruiJedaLokal(terlihat, { dijedaSampai: null }, SIANG + 2 * MENIT), null);
  });
});

describe("jadwalSetelahTugas", () => {
  const p = a.PENGATURAN_BAWAAN;
  test("jeda acak 15–40 detik; jadwal istirahat dimulai pada tugas pertama sesi", () => {
    const j = a.jadwalSetelahTugas({}, p, SIANG, () => 0);
    assert.equal(j.berikutnyaAt, SIANG + 15_000);
    assert.equal(j.terakhirKerjaAt, SIANG);
    assert.equal(j.istirahatSampai, null);
    assert.equal(j.alasanMundur, null);
    // 45 menit × 0,85 (goyangan terendah)
    assert.equal(j.istirahatBerikutAt, SIANG + Math.round(45 * MENIT * 0.85));
  });
  test("waktunya istirahat → istirahat 5–10 menit, tugas berikut sesudahnya", () => {
    const sebelum = { terakhirKerjaAt: SIANG - 30_000, istirahatBerikutAt: SIANG - 1 };
    const j = a.jadwalSetelahTugas(sebelum, p, SIANG, () => 0.9999999);
    assert.equal(j.istirahatSampai, SIANG + 10 * MENIT);
    assert.equal(j.berikutnyaAt, SIANG + 10 * MENIT);
    assert.ok(j.istirahatBerikutAt > j.istirahatSampai);
  });
  test("jeda panjang sejak tugas terakhir dihitung sebagai istirahat — jadwal istirahat dimulai ulang", () => {
    const sebelum = { terakhirKerjaAt: SIANG - 20 * MENIT, istirahatBerikutAt: SIANG - 1 };
    const j = a.jadwalSetelahTugas(sebelum, p, SIANG, () => 0);
    assert.equal(j.istirahatSampai, null);
    assert.ok(j.istirahatBerikutAt > SIANG);
  });
});

describe("jadwalSetelahAlasan", () => {
  test("mundur sesuai alasan server", () => {
    const j = a.jadwalSetelahAlasan({ terakhirKerjaAt: 1 }, "ANTREAN_KOSONG", SIANG);
    assert.deepEqual(j, { terakhirKerjaAt: 1, berikutnyaAt: SIANG + 5 * MENIT, alasanMundur: "ANTREAN_KOSONG" });
    assert.equal(a.jadwalSetelahAlasan({}, "KUOTA_HABIS", SIANG).berikutnyaAt, SIANG + 30 * MENIT);
    assert.equal(a.jadwalSetelahAlasan({}, "ALASAN_BARU", SIANG).berikutnyaAt, SIANG + 5 * MENIT);
  });
});

describe("putuskanTunggu", () => {
  test("captcha langsung dikirim", () => {
    assert.equal(a.putuskanTunggu({ jenis: "PROFIL", sejakMs: 0, status: "CAPTCHA", adaItemList: false }), "KIRIM");
  });
  test("konten OK langsung dikirim", () => {
    assert.equal(a.putuskanTunggu({ jenis: "KONTEN", sejakMs: 500, status: "OK", adaItemList: false }), "KIRIM");
  });
  test("profil OK menunggu item_list sampai batasnya", () => {
    assert.equal(a.putuskanTunggu({ jenis: "PROFIL", sejakMs: 2000, status: "OK", adaItemList: false }), "TUNGGU");
    assert.equal(a.putuskanTunggu({ jenis: "PROFIL", sejakMs: 2000, status: "OK", adaItemList: true }), "KIRIM");
    assert.equal(
      a.putuskanTunggu({ jenis: "PROFIL", sejakMs: a.BATAS_TUNGGU_ITEMLIST_MS, status: "OK", adaItemList: false }),
      "KIRIM",
    );
  });
  test("belum terbaca / tanpa jawaban menunggu sampai batas data", () => {
    assert.equal(a.putuskanTunggu({ jenis: "KONTEN", sejakMs: 1000, status: "TIDAK_TERBACA" }), "TUNGGU");
    assert.equal(a.putuskanTunggu({ jenis: "KONTEN", sejakMs: 1000, status: null }), "TUNGGU");
    assert.equal(a.putuskanTunggu({ jenis: "KONTEN", sejakMs: a.BATAS_TUNGGU_DATA_MS, status: "LOGIN" }), "KIRIM");
    assert.equal(a.putuskanTunggu({ jenis: "KONTEN", sejakMs: a.BATAS_TUNGGU_DATA_MS, status: null }), "KIRIM");
  });
  test("pemeriksaan keamanan TikTok tidak ditunggu 25 detik", () => {
    const dasar = { jenis: "KONTEN", status: "TIDAK_TERBACA", tanpaSkrip: true };
    assert.equal(a.putuskanTunggu({ ...dasar, sejakMs: a.BATAS_TUNGGU_PEMERIKSAAN_MS - 1, pemeriksaan: true }), "TUNGGU");
    assert.equal(a.putuskanTunggu({ ...dasar, sejakMs: a.BATAS_TUNGGU_PEMERIKSAAN_MS, pemeriksaan: true }), "KIRIM");
    assert.equal(a.putuskanTunggu({ ...dasar, sejakMs: a.BATAS_TUNGGU_PEMERIKSAAN_MS }), "TUNGGU");
    assert.ok(a.BATAS_TUNGGU_PEMERIKSAAN_MS < a.BATAS_TUNGGU_TANPA_SKRIP_MS);
  });
});

describe("kodeMasalah", () => {
  test("status halaman → kode /masalah", () => {
    for (const k of ["CAPTCHA", "LOGIN", "GAGAL_MUAT", "TIDAK_TERBACA", "TIDAK_DITEMUKAN", "PRIVAT", "DIBLOKIR_TIKTOK"]) {
      assert.equal(a.kodeMasalah(k), k);
    }
    assert.equal(a.kodeMasalah("ANEH"), "TIDAK_TERBACA");
    assert.equal(a.kodeMasalah(undefined), "TIDAK_TERBACA");
  });
});

describe("teksKeadaan dan jamWib", () => {
  test("jamWib memakai WIB dengan titik", () => {
    assert.equal(a.jamWib(Date.parse("2026-10-09T03:05:00Z")), "10.05");
    assert.equal(a.jamWib(Date.parse("2026-10-09T17:30:00Z")), "00.30");
  });
  test("teks keadaan berbahasa Indonesia", () => {
    assert.equal(a.teksKeadaan({ keadaan: "SIAP" }), "Berjalan");
    assert.equal(a.teksKeadaan({ keadaan: "MENUNGGU" }), "Berjalan");
    assert.equal(a.teksKeadaan({ keadaan: "ANTREAN_KOSONG" }), "Antrean kosong");
    assert.equal(a.teksKeadaan({ keadaan: "KUOTA_HABIS" }), "Kuota hari ini habis");
    assert.equal(
      a.teksKeadaan({ keadaan: "DI_LUAR_JAM" }, a.PENGATURAN_BAWAAN),
      "Di luar jam kerja (08.00–17.00 WIB)",
    );
    assert.equal(
      a.teksKeadaan({ keadaan: "ISTIRAHAT", sampai: Date.parse("2026-10-09T03:40:00Z") }, undefined, SIANG),
      "Istirahat sampai 10.40",
    );
    assert.match(a.teksKeadaan({ keadaan: "DIJEDA", alasan: "CAPTCHA" }), /^Dijeda: TikTok meminta captcha/);
    assert.equal(
      a.teksKeadaan({ keadaan: "DIJEDA", alasan: "Dijeda admin", sampai: Date.parse("2026-10-09T04:00:00Z") }, undefined, SIANG),
      "Dijeda: Dijeda admin (sampai 11.00)",
    );
  });
  test("jeda manual dari Elorae (disimpan sampai tahun 2100) tidak menampilkan jam", () => {
    assert.equal(
      a.teksKeadaan({ keadaan: "DIJEDA", alasan: "MANUAL", sampai: Date.parse("2100-01-01T00:00:00Z") }, undefined, SIANG),
      "Dijeda: dijeda dari Elorae — lanjutkan di Kreatif → Pemantauan",
    );
  });
  test("jeda yang berakhir di hari lain menyebut tanggalnya", () => {
    assert.equal(
      a.teksKeadaan({ keadaan: "DIJEDA", alasan: "GAGAL_BERUNTUN", sampai: Date.parse("2026-10-10T01:30:00Z") }, undefined, SIANG),
      "Dijeda: gagal berturut-turut (sampai 10 Okt 08.30)",
    );
    assert.equal(a.waktuWib(Date.parse("2026-10-09T09:00:00Z"), SIANG), "16.00");
    assert.equal(a.waktuWib(Date.parse("2026-10-08T23:00:00Z"), Date.parse("2026-10-09T03:00:00Z")), "06.00");
    assert.equal(a.waktuWib(Date.parse("2026-12-31T20:00:00Z"), SIANG), "1 Jan 03.00");
  });
});

describe("putuskanLangkah — permintaan langsung (Cek sekarang)", () => {
  const langsung = (lain = {}) => statusServer({ permintaanLangsung: 2, ...lain });
  test("di luar jam kerja tetap AMBIL bila ada permintaan langsung", () => {
    assert.deepEqual(a.putuskanLangkah(keadaanSiap(), MALAM), { langkah: "DIAM", keadaan: "DI_LUAR_JAM" });
    assert.deepEqual(a.putuskanLangkah(keadaanSiap({ status: langsung() }), MALAM), { langkah: "AMBIL", keadaan: "PERMINTAAN" });
  });
  test("jeda berwaktu karena gagal beruntun, istirahat, dan mundur antrean kosong dilewati", () => {
    const k = keadaanSiap({
      status: langsung(),
      jedaLokal: { alasan: "GAGAL_BERUNTUN", sampai: SIANG + 40 * MENIT },
      jadwal: { istirahatSampai: SIANG + 5 * MENIT, berikutnyaAt: SIANG + 5 * MENIT, alasanMundur: "ANTREAN_KOSONG" },
    });
    assert.deepEqual(a.putuskanLangkah(k, SIANG), { langkah: "AMBIL", keadaan: "PERMINTAAN" });
  });
  test("captcha/login, jeda dari server, kuota habis, dan jeda acak pendek sesudah tugas tetap ditunggu", () => {
    assert.equal(a.putuskanLangkah(keadaanSiap({ status: langsung(), jedaLokal: { alasan: "CAPTCHA", tungguServer: true } }), SIANG).keadaan, "DIJEDA");
    assert.equal(
      a.putuskanLangkah(keadaanSiap({ status: langsung({ dijedaSampai: new Date(SIANG + 30 * MENIT).toISOString(), alasanJeda: "CAPTCHA", aktif: false }) }), SIANG).keadaan,
      "DIJEDA",
    );
    assert.equal(a.putuskanLangkah(keadaanSiap({ status: langsung({ hariIni: { selesai: 300, gagal: 0, kuota: 300, sisa: 0 } }) }), SIANG).keadaan, "KUOTA_HABIS");
    const jitter = keadaanSiap({ status: langsung(), jadwal: { berikutnyaAt: SIANG + 20_000, alasanMundur: null } });
    assert.equal(a.putuskanLangkah(jitter, SIANG).keadaan, "MENUNGGU");
  });
  test("teks popup untuk permintaan langsung", () => {
    assert.match(a.teksKeadaan({ keadaan: "PERMINTAAN" }), /Cek sekarang/);
  });
});

describe("perbaruiJedaLokal — jeda berwaktu dilepas saat Elorae melepasnya", () => {
  const jeda = { alasan: "GAGAL_BERUNTUN", sampai: SIANG + 60 * MENIT };
  const dijeda = statusServer({ dijedaSampai: new Date(SIANG + 60 * MENIT).toISOString(), alasanJeda: "GAGAL_BERUNTUN", aktif: false });
  test("Elorae terlihat menjeda → ditandai; lalu Elorae melepas (Lanjutkan / Cek sekarang) → jeda lokal lepas", () => {
    const tanda = a.perbaruiJedaLokal(jeda, dijeda, SIANG);
    assert.equal(tanda.terlihatDijeda, true);
    assert.equal(a.perbaruiJedaLokal(tanda, statusServer(), SIANG + MENIT), null);
  });
  test("Elorae belum pernah terlihat menjeda (laporan belum sampai) → jeda lokal tetap sampai waktunya", () => {
    assert.deepEqual(a.perbaruiJedaLokal(jeda, statusServer(), SIANG), jeda);
    assert.equal(a.perbaruiJedaLokal(jeda, statusServer(), SIANG + 61 * MENIT), null);
  });
  test("Elorae tak terjangkau → jeda tetap", () => {
    assert.deepEqual(a.perbaruiJedaLokal({ ...jeda, terlihatDijeda: true }, null, SIANG), { ...jeda, terlihatDijeda: true });
  });
});

describe("putuskanTunggu — halaman tanpa skrip data ditunggu lebih lama", () => {
  test("tanpa skrip: tunggu sampai 25 detik; dengan skrip tapi angka kurang: 8 detik", () => {
    assert.equal(a.putuskanTunggu({ jenis: "KONTEN", sejakMs: 10_000, status: "TIDAK_TERBACA", tanpaSkrip: true }), "TUNGGU");
    assert.equal(a.putuskanTunggu({ jenis: "KONTEN", sejakMs: 25_000, status: "TIDAK_TERBACA", tanpaSkrip: true }), "KIRIM");
    assert.equal(a.putuskanTunggu({ jenis: "KONTEN", sejakMs: 10_000, status: "TIDAK_TERBACA", tanpaSkrip: false }), "KIRIM");
    assert.equal(a.putuskanTunggu({ jenis: "KONTEN", sejakMs: 1_000, status: "CAPTCHA", tanpaSkrip: true }), "KIRIM");
  });
});

describe("cek cepat lewat tab TikTok yang terbuka", () => {
  const tab = (id, url, lain = {}) => ({ id, url, status: "complete", discarded: false, lastAccessed: id * 10, ...lain });
  test("hanya tab www.tiktok.com milik orang (bukan tab otomatis), yang termuat, terbaru dulu", () => {
    const daftar = [
      tab(1, "https://www.tiktok.com/@a"),
      tab(2, "https://www.tiktok.com/foryou"),
      tab(3, "https://www.tiktok.com/@b/video/7600000000000000001"),
      tab(4, "https://elorae.cloud/backoffice/kreatif/performa"),
      tab(5, "https://www.tiktok.com/@c", { discarded: true }),
      tab(6, "https://www.tiktok.com/@d", { status: "loading" }),
      tab(7, "https://www.tiktok.com.evil.test/@e"),
      tab(8, "https://www.tiktok.com/@f"),
    ];
    assert.deepEqual(a.pilihTabTikTok(daftar, [3, 8]), [2, 1]);
    assert.deepEqual(a.pilihTabTikTok([], []), []);
    assert.deepEqual(a.pilihTabTikTok(null, null), []);
  });
  test("jeda antar video 1–2,5 detik, tanpa istirahat panjang; jadwal istirahat lama dibiarkan", () => {
    const lama = { istirahatBerikutAt: SIANG + 60 * MENIT, istirahatSampai: SIANG - 1, alasanMundur: "ANTREAN_KOSONG" };
    const kecil = a.jadwalSetelahTugasCepat(lama, SIANG, () => 0);
    assert.deepEqual(kecil, {
      istirahatBerikutAt: SIANG + 60 * MENIT,
      istirahatSampai: null,
      berikutnyaAt: SIANG + a.JEDA_CEPAT_MIN_MS,
      terakhirKerjaAt: SIANG,
      alasanMundur: null,
    });
    assert.equal(a.jadwalSetelahTugasCepat({}, SIANG, () => 0.999999).berikutnyaAt, SIANG + a.JEDA_CEPAT_MAKS_MS - 1);
    assert.ok(a.JEDA_CEPAT_MIN_MS >= 1000 && a.JEDA_CEPAT_MAKS_MS <= 3000);
    for (const r of [0, 0.3, 0.7, 0.99]) assert.equal(a.jedaCepatMs(() => r) >= a.JEDA_CEPAT_MIN_MS, true);
  });
  test("teks keadaan: sedang cek cepat menyebut jumlah yang sudah selesai", () => {
    assert.equal(a.teksKeadaan({ keadaan: "CEPAT", selesai: 12 }), "Berjalan cepat lewat tab TikTok — 12 halaman sudah dicek");
    assert.equal(a.teksKeadaan({ keadaan: "CEPAT" }), "Berjalan cepat lewat tab TikTok");
  });
  test("diblokir TikTok: teks meminta tab TikTok dimuat ulang", () => {
    assert.match(a.teksAlasan("DIBLOKIR_TIKTOK"), /muat ulang tab TikTok/i);
  });
});

describe("kiriman otomatis panel (D3)", () => {
  const JAM = 60 * MENIT;
  const URL_P = "https://www.tiktok.com/@Budi.Santoso?lang=id";
  const URL_V = "https://www.tiktok.com/@budi.santoso/video/7421234567890123456";
  const posting = { id: "7420000000000000002", dibuatPada: 1727600000, disematkan: false, views: 8000, like: 400, komentar: 20, share: 5, save: 15 };
  const profil = (lain = {}) => ({ status: "OK", adaItemList: true, data: { jenis: "PROFIL", uniqueId: "Budi.Santoso", pengikut: 15230, posting: [posting] }, ...lain });
  const video = () => ({ status: "OK", data: { jenis: "KONTEN", videoId: "7421234567890123456", uniqueId: "budi.santoso", views: 1, like: 1, komentar: 1, share: 1, save: 1 } });
  const siap = (lain = {}) => ({ tersambung: true, sakelar: undefined, tabOtomatis: false, hasil: profil(), url: URL_P, riwayat: {}, mundurSampai: null, ...lain });

  test("sakelar bawaan NYALA; hanya false yang mematikan", () => {
    assert.equal(a.sakelarKirimOtomatis(undefined), true);
    assert.equal(a.sakelarKirimOtomatis(true), true);
    assert.equal(a.sakelarKirimOtomatis(null), true);
    assert.equal(a.sakelarKirimOtomatis(false), false);
  });

  test("kunci pembatas: handle profil (huruf kecil) atau id video", () => {
    assert.equal(a.kunciKirimOtomatis(profil().data), "PROFIL:budi.santoso");
    assert.equal(a.kunciKirimOtomatis(video().data), "KONTEN:7421234567890123456");
    assert.equal(a.kunciKirimOtomatis({ jenis: "PROFIL", uniqueId: "" }), null);
    assert.equal(a.kunciKirimOtomatis({ jenis: "KONTEN", videoId: "abc" }), null);
    assert.equal(a.kunciKirimOtomatis(null), null);
  });

  test("bacaan lengkap: profil butuh daftar video; data harus milik halaman yang terbuka", () => {
    assert.equal(a.bacaanLengkap(profil(), URL_P), true);
    assert.equal(a.bacaanLengkap(video(), URL_V), true);
    // Daftar video belum tertangkap dan tidak ada yang tertanam → belum.
    assert.equal(a.bacaanLengkap(profil({ adaItemList: false, data: { ...profil().data, posting: [] } }), URL_P), false);
    // Tertanam di halaman tanpa item_list → cukup; akun tanpa video dengan item_list kosong → cukup.
    assert.equal(a.bacaanLengkap(profil({ adaItemList: false }), URL_P), true);
    assert.equal(a.bacaanLengkap(profil({ data: { ...profil().data, posting: [] } }), URL_P), true);
    // Akun yang memang tanpa video tidak menunggu daftar video yang tidak pernah dimuat.
    assert.equal(a.bacaanLengkap(profil({ adaItemList: false, data: { ...profil().data, posting: [], jumlahVideo: 0 } }), URL_P), true);
    assert.equal(a.bacaanLengkap(profil({ adaItemList: false, data: { ...profil().data, posting: [], jumlahVideo: 5 } }), URL_P), false);
    assert.equal(a.bacaanLengkap(profil(), "https://www.tiktok.com/@orang.lain"), false);
    assert.equal(a.bacaanLengkap(video(), URL_P), false);
    assert.equal(a.bacaanLengkap({ status: "CAPTCHA" }, URL_P), false);
    assert.equal(a.bacaanLengkap({ ...video(), data: { ...video().data, views: undefined } }, URL_V), false);
    assert.equal(a.bacaanLengkap(profil(), "https://www.tiktok.com/foryou"), false);
  });

  test("alasan bacaan belum lengkap disebut persis (untuk catatan di popup)", () => {
    assert.equal(a.alasanBelumLengkap(profil(), URL_P), null);
    assert.equal(a.alasanBelumLengkap({ status: "CAPTCHA" }, URL_P), "STATUS_CAPTCHA");
    assert.equal(a.alasanBelumLengkap({ status: "OK" }, URL_P), "TANPA_DATA");
    assert.equal(a.alasanBelumLengkap({ ...video(), data: { ...video().data, views: undefined } }, URL_V), "KURANG:views");
    assert.equal(a.alasanBelumLengkap(profil(), "https://www.tiktok.com/foryou"), "BUKAN_HALAMAN_AKUN_ATAU_VIDEO");
    assert.equal(a.alasanBelumLengkap(profil(), "https://www.tiktok.com/@orang.lain"), "BUKAN_MILIK_HALAMAN:orang.lain≠budi.santoso");
    assert.equal(
      a.alasanBelumLengkap(profil({ adaItemList: false, data: { ...profil().data, posting: [], jumlahVideo: 5 } }), URL_P),
      "DAFTAR_VIDEO_BELUM_TERTANGKAP",
    );
  });

  test("catatan kiriman otomatis terakhir → satu kalimat di popup", () => {
    const at = SIANG;
    const c = (lain) => ({ at, kunci: "PROFIL:bellaclrs_", ...lain });
    assert.equal(a.teksKirimOtomatisTerakhir(null), null);
    assert.equal(a.teksKirimOtomatisTerakhir(c({ alasan: "DIKIRIM", hasil: "DISIMPAN" }), at), "@bellaclrs_ · tersimpan di Elorae (10.00)");
    assert.equal(a.teksKirimOtomatisTerakhir(c({ alasan: "DIKIRIM", hasil: "DIABAIKAN" }), at), "@bellaclrs_ · diabaikan Elorae: akun belum ada di Elorae dan tidak menandai Elorae (10.00)");
    assert.equal(
      a.teksKirimOtomatisTerakhir(c({ alasan: "BELUM_LENGKAP", rincian: "DAFTAR_VIDEO_BELUM_TERTANGKAP" }), at),
      "@bellaclrs_ · belum dikirim: daftar video belum tertangkap (10.00)",
    );
    assert.equal(
      a.teksKirimOtomatisTerakhir({ at, kunci: "KONTEN:7421234567890123456", alasan: "LATAR_TIDAK_MENJAWAB" }, at),
      "video 7421234567890123456 · belum dikirim: ekstensi tidak menjawab panel — muat ulang tab ini (10.00)",
    );
    // Alasan yang tidak dikenal tetap tampil apa adanya, tidak hilang.
    assert.equal(a.teksKirimOtomatisTerakhir({ at, alasan: "ANEH", rincian: "x" }, at), "belum dikirim: ANEH (x) (10.00)");
  });

  test("konten.js memakai kunci penyimpanan yang sama dengan popup", async () => {
    const { readFileSync } = await import("node:fs");
    const teks = readFileSync(new URL("../konten.js", import.meta.url), "utf8");
    assert.ok(teks.includes(`"${a.KUNCI_KIRIM_OTOMATIS_TERAKHIR}"`));
  });

  test("semua syarat terpenuhi → kirim dengan kuncinya", () => {
    assert.deepEqual(a.putuskanKirimOtomatis(siap(), SIANG), { kirim: true, kunci: "PROFIL:budi.santoso" });
    assert.deepEqual(a.putuskanKirimOtomatis(siap({ hasil: video(), url: URL_V }), SIANG), { kirim: true, kunci: "KONTEN:7421234567890123456" });
  });

  test("tidak pernah mengirim tanpa sambungan, dengan sakelar mati, atau dari tab putaran otomatis", () => {
    assert.equal(a.putuskanKirimOtomatis(siap({ tersambung: false }), SIANG).alasan, "BELUM_TERSAMBUNG");
    assert.equal(a.putuskanKirimOtomatis(siap({ sakelar: false }), SIANG).alasan, "MATI");
    assert.equal(a.putuskanKirimOtomatis(siap({ tabOtomatis: true }), SIANG).alasan, "TAB_OTOMATIS");
    assert.equal(a.putuskanKirimOtomatis(siap({ hasil: { status: "TIDAK_TERBACA" } }), SIANG).alasan, "BELUM_LENGKAP");
    assert.equal(a.putuskanKirimOtomatis(null, SIANG).alasan, "BELUM_TERSAMBUNG");
  });

  test("satu kiriman per kunci per 6 jam; gagal/sedang mengirim boleh diulang setelah 10 menit", () => {
    const kunci = "PROFIL:budi.santoso";
    const tersimpan = { [kunci]: { hasil: "DISIMPAN", at: SIANG - 5 * JAM } };
    const r = a.putuskanKirimOtomatis(siap({ riwayat: tersimpan }), SIANG);
    assert.equal(r.alasan, "SUDAH_DIKIRIM");
    assert.equal(r.sebelumnya.hasil, "DISIMPAN");
    assert.equal(a.putuskanKirimOtomatis(siap({ riwayat: { [kunci]: { hasil: "DISIMPAN", at: SIANG - 6 * JAM } } }), SIANG).kirim, true);
    for (const hasil of ["DIABAIKAN", "DITOLAK", "MANUAL"]) {
      assert.equal(a.putuskanKirimOtomatis(siap({ riwayat: { [kunci]: { hasil, at: SIANG - 2 * JAM } } }), SIANG).kirim, false, hasil);
    }
    for (const hasil of ["GAGAL", "MENGIRIM"]) {
      assert.equal(a.putuskanKirimOtomatis(siap({ riwayat: { [kunci]: { hasil, at: SIANG - 5 * MENIT } } }), SIANG).kirim, false, hasil);
      assert.equal(a.putuskanKirimOtomatis(siap({ riwayat: { [kunci]: { hasil, at: SIANG - 10 * MENIT } } }), SIANG).kirim, true, hasil);
    }
    // Kunci lain tidak terhalang.
    assert.equal(a.putuskanKirimOtomatis(siap({ riwayat: { "PROFIL:orang.lain": { hasil: "DISIMPAN", at: SIANG } } }), SIANG).kirim, true);
  });

  test("mundur bersama (429 / Elorae lama) menahan semua kunci sampai waktunya", () => {
    const r = a.putuskanKirimOtomatis(siap({ mundurSampai: SIANG + MENIT }), SIANG);
    assert.equal(r.alasan, "MUNDUR");
    assert.equal(r.sampai, SIANG + MENIT);
    assert.equal(a.putuskanKirimOtomatis(siap({ mundurSampai: SIANG }), SIANG).kirim, true);
  });

  test("riwayat dipangkas: yang kedaluwarsa, rusak, atau dari masa depan dibuang; paling banyak 500 terbaru", () => {
    const riwayat = {
      lama: { hasil: "DISIMPAN", at: SIANG - 7 * JAM },
      segar: { hasil: "DISIMPAN", at: SIANG - JAM },
      gagalLama: { hasil: "GAGAL", at: SIANG - 11 * MENIT },
      gagalBaru: { hasil: "GAGAL", at: SIANG - MENIT },
      depan: { hasil: "DISIMPAN", at: SIANG + 2 * JAM },
      rusak: { hasil: "DISIMPAN" },
      kosong: null,
    };
    assert.deepEqual(Object.keys(a.pangkasRiwayatKirim(riwayat, SIANG)).sort(), ["gagalBaru", "segar"]);
    assert.deepEqual(a.pangkasRiwayatKirim(undefined, SIANG), {});
    assert.deepEqual(a.pangkasRiwayatKirim([1, 2], SIANG), {});
    const banyak = {};
    for (let i = 0; i < 520; i++) banyak[`k${i}`] = { hasil: "DISIMPAN", at: SIANG - i * 1000 };
    const p = a.pangkasRiwayatKirim(banyak, SIANG);
    assert.equal(Object.keys(p).length, a.MAKS_RIWAYAT_KIRIM);
    assert.ok("k0" in p && !("k519" in p));
  });

  test("catatKirimOtomatis menimpa catatan kunci itu dengan waktu sekarang dan memangkas sisanya", () => {
    const r = a.catatKirimOtomatis({ x: { hasil: "MENGIRIM", at: SIANG - MENIT }, basi: { hasil: "DISIMPAN", at: SIANG - 8 * JAM } }, "x", { hasil: "DISIMPAN", videoMasuk: 2 }, SIANG);
    assert.deepEqual(r, { x: { hasil: "DISIMPAN", videoMasuk: 2, at: SIANG } });
  });

  test("jawaban Elorae → catatan, mundur, kabar", () => {
    const ok = a.setelahKirimOtomatis({ json: { ok: true, hasil: "DISIMPAN", kol: { id: "k1", nama: "@budi" }, videoMasuk: 3, brand: 2 }, status: 200 }, SIANG);
    assert.deepEqual(ok.catatan, { hasil: "DISIMPAN", videoMasuk: 3, brand: 2, kol: { id: "k1", nama: "@budi" } });
    assert.equal(ok.mundurSampai, null);
    assert.equal(ok.kabar.ok, true);
    assert.equal(a.catatanFinal(ok.catatan), true);

    const abai = a.setelahKirimOtomatis({ json: { ok: true, hasil: "DIABAIKAN", videoMasuk: 0, brand: 0 }, status: 200 }, SIANG);
    assert.equal(abai.catatan.hasil, "DIABAIKAN");
    assert.equal(a.catatanFinal(abai.catatan), true);
    // Angka rusak dari server tidak dipakai mentah.
    assert.equal(a.setelahKirimOtomatis({ json: { ok: true, hasil: "DISIMPAN", videoMasuk: -1, brand: "2" } }, SIANG).catatan.videoMasuk, 0);

    const sering = a.setelahKirimOtomatis({ gagal: "TERLALU_SERING", status: 429 }, SIANG);
    assert.equal(sering.catatan.hasil, "GAGAL");
    assert.equal(sering.mundurSampai, SIANG + a.MUNDUR_TERLALU_SERING_MS);

    for (const gagal of ["JARINGAN", "TOKEN_TIDAK_SAH", "BELUM_TERSAMBUNG"]) {
      const g = a.setelahKirimOtomatis({ gagal }, SIANG);
      assert.equal(g.catatan.hasil, "GAGAL", gagal);
      assert.equal(a.catatanFinal(g.catatan), false);
      assert.equal(g.mundurSampai, null);
      assert.deepEqual(g.kabar, { ok: false, kode: gagal });
    }

    const lama = a.setelahKirimOtomatis({ gagal: "HTTP", status: 404 }, SIANG);
    assert.equal(lama.catatan.hasil, "DITOLAK");
    assert.equal(lama.mundurSampai, SIANG + a.MUNDUR_TITIK_TIDAK_ADA_MS);
    assert.equal(a.setelahKirimOtomatis({ gagal: "HTTP", status: 413 }, SIANG).mundurSampai, null);

    const tolak = a.setelahKirimOtomatis({ json: { ok: false, kode: "TANPA_IZIN" }, status: 403 }, SIANG);
    assert.deepEqual(tolak.catatan, { hasil: "DITOLAK", kode: "TANPA_IZIN" });
    assert.deepEqual(tolak.kabar, { ok: false, kode: "TANPA_IZIN" });
  });

  test("teks di panel: tersimpan, video baru masuk Performa, diam untuk DIABAIKAN dan gangguan jaringan", () => {
    assert.deepEqual(a.teksKabarOtomatis({ ok: true, hasil: "DISIMPAN", videoMasuk: 0 }), { teks: "Tersimpan otomatis ke Elorae", jenis: "baik" });
    assert.deepEqual(a.teksKabarOtomatis({ ok: true, hasil: "DISIMPAN", videoMasuk: 0, kol: { nama: "@budi" } }), { teks: "Tersimpan otomatis untuk @budi", jenis: "baik" });
    assert.deepEqual(a.teksKabarOtomatis({ ok: true, hasil: "DISIMPAN", videoMasuk: 2 }), { teks: "2 video baru masuk Performa video", jenis: "sorot" });
    assert.equal(a.teksKabarOtomatis({ ok: true, hasil: "DIABAIKAN", videoMasuk: 0 }), null);
    for (const kode of ["JARINGAN", "TERLALU_SERING", "MUATAN_TIDAK_SAH", "HTTP_404", "KOL_DIBLOKIR"]) assert.equal(a.teksKabarOtomatis({ ok: false, kode }), null, kode);
    assert.equal(a.teksKabarOtomatis({ ok: false, kode: "TOKEN_TIDAK_SAH" }).jenis, "galat");
    assert.equal(a.teksKabarOtomatis({ ok: false, kode: "TANPA_IZIN" }).jenis, "galat");
    assert.equal(a.teksKabarOtomatis(null), null);
  });

  test("dibuka lagi dalam 6 jam: yang tersimpan menyebut jamnya, yang diabaikan tetap diam", () => {
    const k = a.kabarDariRiwayat({ hasil: "DISIMPAN", at: SIANG - JAM, kol: { id: "k", nama: "@budi" } });
    assert.deepEqual(a.teksKabarOtomatis(k, SIANG), { teks: "Sudah tersimpan di Elorae · 09.00", jenis: "baik" });
    assert.equal(a.teksKabarOtomatis(a.kabarDariRiwayat({ hasil: "MANUAL", at: SIANG }), SIANG).teks, "Sudah tersimpan di Elorae · 10.00");
    for (const hasil of ["DIABAIKAN", "GAGAL", "MENGIRIM", "DITOLAK"]) assert.equal(a.kabarDariRiwayat({ hasil, at: SIANG }), null, hasil);
    assert.equal(a.kabarDariRiwayat(undefined), null);
  });
});
