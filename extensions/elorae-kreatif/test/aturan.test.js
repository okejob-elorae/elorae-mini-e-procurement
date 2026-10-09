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
});

describe("kodeMasalah", () => {
  test("status halaman → kode /masalah", () => {
    for (const k of ["CAPTCHA", "LOGIN", "GAGAL_MUAT", "TIDAK_TERBACA", "TIDAK_DITEMUKAN", "PRIVAT"]) {
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
