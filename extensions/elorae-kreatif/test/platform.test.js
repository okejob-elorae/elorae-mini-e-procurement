import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { cocokDenganUrl, jenisHalaman, kurangWajib, platformDariUrl, platformHalaman, urlUntukTab } from "../lib/platform.js";
import {
  bacaanLengkap,
  JEDA_CEPAT_INSTAGRAM_MAKS_MS,
  JEDA_CEPAT_INSTAGRAM_MIN_MS,
  JEDA_CEPAT_MAKS_MS,
  jadwalSetelahTugasCepat,
  kunciKirimOtomatis,
  pilihTabHost,
  platformSanggup,
  putuskanKirimOtomatis,
  rapikanJedaPlatform,
} from "../lib/aturan.js";
import { hitungErAkun } from "../lib/panel.js";

// Instagram dan YouTube (v0.11.0): pemilih pengurai per platform dan aturan yang membedakannya.

describe("pemilih platform", () => {
  test("platformDariUrl mengenali semua subdomain; platformHalaman hanya asal panel (www.)", () => {
    assert.equal(platformDariUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ"), "YOUTUBE");
    assert.equal(platformDariUrl("https://youtu.be/dQw4w9WgXcQ"), "YOUTUBE");
    assert.equal(platformDariUrl("https://www.instagram.com/p/C9xYz_AbC-1/"), "INSTAGRAM");
    assert.equal(platformDariUrl("https://vt.tiktok.com/ZS/"), "TIKTOK");
    assert.equal(platformDariUrl("https://www.threads.net/@a"), null);
    assert.equal(platformDariUrl("https://www.facebook.com/x"), null);
    assert.equal(platformHalaman("https://www.instagram.com/kol/"), "INSTAGRAM");
    assert.equal(platformHalaman("https://m.youtube.com/watch?v=dQw4w9WgXcQ"), null);
    assert.equal(platformHalaman("https://evil.com/www.tiktok.com"), null);
  });

  test("jenisHalaman membawa platform; kurangWajib dan cocokDenganUrl memakai aturan platform data", () => {
    const t = jenisHalaman("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.deepEqual(t, { jenis: "KONTEN", videoId: "dQw4w9WgXcQ", bentuk: "VIDEO", handle: null, platform: "YOUTUBE" });
    const yt = { platform: "YOUTUBE", jenis: "KONTEN", videoId: "dQw4w9WgXcQ", uniqueId: "kol", views: 10 };
    assert.deepEqual(kurangWajib(yt), []);
    assert.deepEqual(kurangWajib({ ...yt, views: undefined }), ["views"]);
    assert.equal(cocokDenganUrl(yt, t), true);
    // Data TikTok (tanpa platform) tidak pernah cocok dengan halaman YouTube.
    assert.equal(cocokDenganUrl({ ...yt, platform: undefined }, t), false);
    assert.deepEqual(kurangWajib({ jenis: "KONTEN", videoId: "1", uniqueId: "a", views: 1, like: 1, komentar: 1, share: 1 }), ["save"]);
    assert.equal(urlUntukTab("INSTAGRAM", "https://www.instagram.com/kol/reel/C9xYz_AbC-1/"), "https://www.instagram.com/reel/C9xYz_AbC-1/");
    assert.equal(urlUntukTab("THREADS", "https://x"), null);
  });
});

describe("kiriman otomatis per platform", () => {
  test("kunci: TikTok tanpa awalan (riwayat lama berlaku); Instagram/YouTube berawalan platform", () => {
    assert.equal(kunciKirimOtomatis({ jenis: "PROFIL", uniqueId: "@Kol" }), "PROFIL:kol");
    assert.equal(kunciKirimOtomatis({ jenis: "KONTEN", videoId: "7301" }), "KONTEN:7301");
    assert.equal(kunciKirimOtomatis({ platform: "INSTAGRAM", jenis: "PROFIL", uniqueId: "Kol.Satu" }), "INSTAGRAM:PROFIL:kol.satu");
    assert.equal(kunciKirimOtomatis({ platform: "INSTAGRAM", jenis: "KONTEN", videoId: "C9xYz_AbC-1" }), "INSTAGRAM:KONTEN:C9xYz_AbC-1");
    assert.equal(kunciKirimOtomatis({ platform: "YOUTUBE", jenis: "KONTEN", videoId: "dQw4w9WgXcQ" }), "YOUTUBE:KONTEN:dQw4w9WgXcQ");
    assert.equal(kunciKirimOtomatis({ jenis: "KONTEN", videoId: "C9xYz_AbC-1" }), null);
  });

  test("bacaanLengkap: kanal YouTube cukup pengikut; profil Instagram butuh posting yang tertangkap", () => {
    const kanal = { platform: "YOUTUBE", jenis: "PROFIL", uniqueId: "kol", pengikut: 46_500_000, pengikutPerkiraan: true, posting: [] };
    assert.equal(bacaanLengkap({ status: "OK", data: kanal }, "https://www.youtube.com/@kol/videos"), true);
    const ig = { platform: "INSTAGRAM", jenis: "PROFIL", uniqueId: "kol", pengikut: 100, posting: [] };
    assert.equal(bacaanLengkap({ status: "OK", data: ig, adaItemList: false }, "https://www.instagram.com/kol/"), false);
    const post = { id: "C9xYz_AbC-1", dibuatPada: 1, disematkan: false, like: 1 };
    assert.equal(bacaanLengkap({ status: "OK", data: { ...ig, posting: [post] }, adaItemList: true }, "https://www.instagram.com/kol/"), true);
    const reel = { platform: "INSTAGRAM", jenis: "KONTEN", videoId: "C9xYz_AbC-1", uniqueId: "kol", like: 3 };
    assert.equal(bacaanLengkap({ status: "OK", data: reel }, "https://www.instagram.com/reel/C9xYz_AbC-1/"), true);
    // Halaman TikTok dengan data Instagram: tidak lengkap (bukan milik halaman itu).
    assert.equal(bacaanLengkap({ status: "OK", data: reel }, "https://www.tiktok.com/@kol"), false);
  });

  test("putuskanKirimOtomatis berlaku sama untuk YouTube (6 jam per kunci berawalan)", () => {
    const data = { platform: "YOUTUBE", jenis: "KONTEN", videoId: "dQw4w9WgXcQ", uniqueId: "kol", views: 5 };
    const k = { tersambung: true, hasil: { status: "OK", data }, url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", riwayat: {} };
    assert.deepEqual(putuskanKirimOtomatis(k, 1_000_000), { kirim: true, kunci: "YOUTUBE:KONTEN:dQw4w9WgXcQ" });
    const riwayat = { "YOUTUBE:KONTEN:dQw4w9WgXcQ": { hasil: "DISIMPAN", at: 999_000 } };
    assert.equal(putuskanKirimOtomatis({ ...k, riwayat }, 1_000_000).alasan, "SUDAH_DIKIRIM");
  });
});

describe("tugas per platform", () => {
  test("platformSanggup: TikTok selalu; YouTube kecuali dijeda; Instagram hanya dengan tab dan tanpa jeda", () => {
    assert.deepEqual(platformSanggup({ adaTabInstagram: false }, 0), ["TIKTOK", "YOUTUBE"]);
    assert.deepEqual(platformSanggup({ adaTabInstagram: true }, 0), ["TIKTOK", "YOUTUBE", "INSTAGRAM"]);
    assert.deepEqual(platformSanggup({ adaTabInstagram: true, jedaPlatform: { INSTAGRAM: 100, YOUTUBE: 100 } }, 50), ["TIKTOK"]);
    assert.deepEqual(platformSanggup({ adaTabInstagram: true, jedaPlatform: { INSTAGRAM: 100 } }, 150), ["TIKTOK", "YOUTUBE", "INSTAGRAM"]);
    assert.deepEqual(rapikanJedaPlatform({ INSTAGRAM: 100, YOUTUBE: 300, X: "a" }, 200), { YOUTUBE: 300 });
  });

  test("jeda cepat Instagram lebih panjang daripada TikTok", () => {
    const ig = jadwalSetelahTugasCepat({}, 0, () => 0.999, "INSTAGRAM");
    assert.ok(ig.berikutnyaAt >= JEDA_CEPAT_INSTAGRAM_MIN_MS && ig.berikutnyaAt < JEDA_CEPAT_INSTAGRAM_MAKS_MS);
    assert.ok(jadwalSetelahTugasCepat({}, 0, () => 0.999).berikutnyaAt < JEDA_CEPAT_MAKS_MS);
    assert.ok(JEDA_CEPAT_INSTAGRAM_MIN_MS > JEDA_CEPAT_MAKS_MS);
  });

  test("pilihTabHost: hanya host itu, bukan tab otomatis, termuat, terakhir dibuka dulu", () => {
    const tabs = [
      { id: 1, url: "https://www.instagram.com/", status: "complete", lastAccessed: 1 },
      { id: 2, url: "https://www.instagram.com/kol/", status: "complete", lastAccessed: 5 },
      { id: 3, url: "https://www.instagram.com/x", status: "loading", lastAccessed: 9 },
      { id: 4, url: "https://www.tiktok.com/", status: "complete", lastAccessed: 9 },
      { id: 5, url: "https://www.instagram.com/y", status: "complete", lastAccessed: 9 },
    ];
    assert.deepEqual(pilihTabHost(tabs, [5], "www.instagram.com"), [2, 1]);
  });
});

describe("ER panel tanpa share/simpan (Instagram)", () => {
  test("angka yang tidak dikirim dihitung 0, bukan NaN — sama dengan server", () => {
    const sekarang = 1_000_000_000_000;
    const detik = Math.floor(sekarang / 1000) - 72 * 3600;
    const p = (id, views, like, komentar) => ({ id, dibuatPada: detik, disematkan: false, views, like, komentar });
    assert.deepEqual(hitungErAkun([p("a", 1000, 90, 10), p("b", 2000, 180, 20), p("c", 500, 45, 5), { id: "foto", dibuatPada: detik, disematkan: false, like: 9 }], sekarang), {
      er: 10,
      avgViews: 1167,
      postsCounted: 3,
    });
  });
});
