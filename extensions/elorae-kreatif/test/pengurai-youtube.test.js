import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ambilObjekJs,
  angkaPersis,
  angkaRingkas,
  bacaHalaman,
  jenisHalaman,
  sebutanDeskripsi,
  urlUntukTab,
} from "../lib/pengurai-youtube.js";

// Fixture mengikuti bentuk yang DIUKUR 2026-10-10 (dirampingkan; lihat komentar di dalamnya).
const baca = (nama) => readFileSync(new URL(`./fixtures/${nama}`, import.meta.url), "utf8");
const video = baca("yt-video.html");
const kanal = baca("yt-kanal.html");

describe("angka ringkas YouTube", () => {
  test("Indonesia dan Inggris; tanpa satuan = persis", () => {
    const kasus = [
      ["46,5 jt subscriber", { angka: 46_500_000, perkiraan: true }],
      ["1,2 rb", { angka: 1200, perkiraan: true }],
      ["3 rb subscriber", { angka: 3000, perkiraan: true }],
      ["12K subscribers", { angka: 12_000, perkiraan: true }],
      ["1.2M subscribers", { angka: 1_200_000, perkiraan: true }],
      ["1,5 M subscriber", { angka: 1_500_000_000, perkiraan: true }],
      ["2.5B", { angka: 2_500_000_000, perkiraan: true }],
      ["987 subscriber", { angka: 987, perkiraan: false }],
      ["1.234 subscriber", { angka: 1234, perkiraan: false }],
    ];
    for (const [teks, harap] of kasus) assert.deepEqual(angkaRingkas(teks), harap, teks);
  });

  test("bahasa yang disebut memutuskan arti M dan pemisah desimal", () => {
    assert.deepEqual(angkaRingkas("2 M", { bahasa: "id" }), { angka: 2_000_000_000, perkiraan: true });
    assert.deepEqual(angkaRingkas("2 M", { bahasa: "en" }), { angka: 2_000_000, perkiraan: true });
    assert.deepEqual(angkaRingkas("46.5 jt", { bahasa: "en" }), { angka: 46_500_000, perkiraan: true });
    assert.equal(angkaRingkas("subscriber"), null);
    assert.equal(angkaRingkas(null), null);
  });

  test("angkaPersis: pemisah ribuan dibuang; teks ringkas atau pecahan ditolak", () => {
    assert.equal(angkaPersis("1.234.567"), 1_234_567);
    assert.equal(angkaPersis("1,234"), 1234);
    assert.equal(angkaPersis("753"), 753);
    assert.equal(angkaPersis("1,2 rb"), undefined);
    assert.equal(angkaPersis("12.5"), undefined);
  });
});

describe("alamat YouTube", () => {
  test("jenisHalaman: watch, shorts, youtu.be, kanal @handle (dan tabnya), /channel/UC…", () => {
    assert.deepEqual(jenisHalaman("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1s"), { jenis: "KONTEN", videoId: "dQw4w9WgXcQ", bentuk: "VIDEO", handle: null });
    assert.deepEqual(jenisHalaman("https://www.youtube.com/shorts/dQw4w9WgXcQ"), { jenis: "KONTEN", videoId: "dQw4w9WgXcQ", bentuk: "SHORTS", handle: null });
    assert.deepEqual(jenisHalaman("https://youtu.be/dQw4w9WgXcQ"), { jenis: "KONTEN", videoId: "dQw4w9WgXcQ", bentuk: "VIDEO", handle: null });
    assert.deepEqual(jenisHalaman("https://www.youtube.com/@YouTube/videos"), { jenis: "PROFIL", handle: "youtube", channelId: null });
    assert.deepEqual(jenisHalaman("https://www.youtube.com/channel/UCBR8-60-B28hp2BmDPdntcQ"), { jenis: "PROFIL", handle: null, channelId: "UCBR8-60-B28hp2BmDPdntcQ" });
    assert.equal(jenisHalaman("https://www.youtube.com/feed/subscriptions"), null);
    assert.equal(jenisHalaman("https://www.youtube.com/watch?v=pendek"), null);
  });

  test("urlUntukTab: hanya halaman video, bentuk baku", () => {
    assert.equal(urlUntukTab("https://youtu.be/dQw4w9WgXcQ?si=x"), "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    assert.equal(urlUntukTab("https://m.youtube.com/shorts/dQw4w9WgXcQ"), "https://www.youtube.com/shorts/dQw4w9WgXcQ");
    assert.equal(urlUntukTab("https://www.youtube.com/@YouTube"), null);
  });
});

describe("bacaHalaman YouTube (bentuk terukur)", () => {
  test("video: views persis, like dari tombol, komentar dari contextualInfo, pemilik, tanggal, promosi berbayar", () => {
    const h = bacaHalaman(video, { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    assert.equal(h.status, "OK");
    assert.deepEqual(h.data, {
      platform: "YOUTUBE",
      jenis: "KONTEN",
      videoId: "dQw4w9WgXcQ",
      uniqueId: "youtube",
      penulis: "youtube",
      views: 1_234_567,
      like: 753,
      komentar: 173,
      dibuatPada: Math.floor(Date.parse("2024-05-01T05:00:07-07:00") / 1000),
      teks: "Outfit hari ini dari @elorae.official dan @Toko.Lain 🙏\nKontak: halo@contoh.com #OOTD #EloraeStyle",
      sebutan: ["elorae.official", "toko.lain"],
      tagar: ["ootd", "eloraestyle"],
      iklan: true,
    });
  });

  test("like versi bahasa Inggris; tanpa tombol like / komentar → kolomnya tidak ada (bukan 0)", () => {
    const inggris = video.replaceAll("suka video ini bersama 753 orang lainnya", "like this video along with 1,024 other people");
    assert.equal(bacaHalaman(inggris, { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }).data.like, 1024);
    const tanpa = video.replaceAll("suka video ini bersama 753 orang lainnya", "Suka").replace('"contextualInfo":{"runs":[{"text":"173"}]}', '"contextualInfo":{"runs":[{"text":"1,2 rb"}]}');
    const h = bacaHalaman(tanpa, { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    assert.equal(h.status, "OK");
    assert.equal("like" in h.data, false);
    assert.equal("komentar" in h.data, false);
  });

  test("halaman video lain (pindah halaman tanpa muat ulang) → DATA_TIDAK_COCOK, perlu halaman segar", () => {
    const h = bacaHalaman(video, { url: "https://www.youtube.com/watch?v=aaaaaaaaaaa" });
    assert.equal(h.status, "TIDAK_TERBACA");
    assert.equal(h.alasan, "DATA_TIDAK_COCOK");
  });

  test("video tidak tersedia, privat, captcha, halaman persetujuan, tanpa data", () => {
    const galat = '<script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"ERROR","reason":"Video tidak tersedia"}};</script>';
    assert.equal(bacaHalaman(galat, { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }).status, "TIDAK_DITEMUKAN");
    const privat = '<script>var ytInitialPlayerResponse = {"playabilityStatus":{"status":"LOGIN_REQUIRED"}};</script>';
    assert.equal(bacaHalaman(privat, { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }).status, "PRIVAT");
    assert.equal(bacaHalaman("<body>Our systems have detected unusual traffic</body>", { url: "https://www.google.com/sorry/index" }).status, "CAPTCHA");
    const setuju = bacaHalaman("<body>Before you continue to YouTube</body>", { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    assert.equal(setuju.status, "TIDAK_TERBACA");
    assert.match(setuju.diagnosa, /persetujuan/);
    const kosong = bacaHalaman("<html></html>", { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" });
    assert.equal(kosong.status, "TIDAK_TERBACA");
    assert.equal(kosong.tanpaSkrip, true);
  });

  test("kanal: pengikut perkiraan dari teks ringkas, id kanal, handle; posting tidak dikirim", () => {
    const h = bacaHalaman(kanal, { url: "https://www.youtube.com/@YouTube/videos" });
    assert.equal(h.status, "OK");
    assert.deepEqual(h.data, {
      platform: "YOUTUBE",
      jenis: "PROFIL",
      uniqueId: "youtube",
      idPlatform: "UCBR8-60-B28hp2BmDPdntcQ",
      pengikut: 46_500_000,
      pengikutPerkiraan: true,
      posting: [],
    });
    const lewatId = bacaHalaman(kanal, { url: "https://www.youtube.com/channel/UCBR8-60-B28hp2BmDPdntcQ" });
    assert.equal(lewatId.status, "OK");
    assert.equal(bacaHalaman(kanal, { url: "https://www.youtube.com/@lain" }).alasan, "DATA_TIDAK_COCOK");
  });
});

describe("bantu", () => {
  test("ambilObjekJs: kurung di dalam teks tidak mengacaukan; JSON rusak → null", () => {
    assert.deepEqual(ambilObjekJs('var ytInitialData = {"a":"}{","b":{"c":1}};x()', "ytInitialData"), { a: "}{", b: { c: 1 } });
    assert.equal(ambilObjekJs("var ytInitialData = {rusak;", "ytInitialData"), null);
  });

  test("sebutanDeskripsi: alamat surel dan kanal sendiri bukan sebutan", () => {
    assert.deepEqual(sebutanDeskripsi("cek @Elorae.Official, surel kami@contoh.com, dan @youtube", "youtube"), ["elorae.official"]);
  });
});
