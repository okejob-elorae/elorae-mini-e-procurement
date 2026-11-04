import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bacaHalaman,
  jenisHalaman,
  kurangWajib,
  normalAkun,
  parseTeksJson,
  postingDariMedia,
  ringkasTangkapan,
  urlUntukTab,
} from "../lib/pengurai-instagram.js";

// Bentuk yang DIUKUR hanya profil tanpa masuk (follower_count di blob application/json);
// semua bentuk pengguna yang sudah masuk di sini TEBAKAN (fixture ber-_catatan).
const baca = (nama) => readFileSync(new URL(`./fixtures/${nama}`, import.meta.url), "utf8");
const profilLogout = baca("ig-profil-logout.html");
const feed = baca("ig-feed-masuk.json");
const lama = baca("ig-graphql-lama.json");
const posting = baca("ig-posting-masuk.html");

const profilKol = (akun, pengikut) =>
  `<html><head><script type="application/json">${JSON.stringify({ data: { user: { username: akun, follower_count: pengikut, id: "111", media_count: 4 } } })}</script></head><body></body></html>`;

describe("alamat Instagram", () => {
  test("jenisHalaman: profil, tab profil, reel, posting, posting ber-akun; halaman lain null", () => {
    assert.deepEqual(jenisHalaman("https://www.instagram.com/Kol.Satu/"), { jenis: "PROFIL", handle: "kol.satu" });
    assert.deepEqual(jenisHalaman("https://www.instagram.com/kol.satu/reels/"), { jenis: "PROFIL", handle: "kol.satu" });
    assert.deepEqual(jenisHalaman("https://www.instagram.com/reel/C9xYz_AbC-1/?igsh=x"), { jenis: "KONTEN", videoId: "C9xYz_AbC-1", bentuk: "REEL", handle: null });
    assert.deepEqual(jenisHalaman("https://www.instagram.com/p/C8aaaaaaaa2/"), { jenis: "KONTEN", videoId: "C8aaaaaaaa2", bentuk: "POST", handle: null });
    assert.deepEqual(jenisHalaman("https://www.instagram.com/kol.satu/reel/C9xYz_AbC-1/"), { jenis: "KONTEN", videoId: "C9xYz_AbC-1", bentuk: "REEL", handle: "kol.satu" });
    for (const u of ["https://www.instagram.com/", "https://www.instagram.com/explore/", "https://www.instagram.com/stories/kol/1/", "https://www.instagram.com/accounts/login/", "https://www.tiktok.com/@a"]) {
      assert.equal(jenisHalaman(u), null, u);
    }
  });

  test("urlUntukTab: bentuk baku www.instagram.com tanpa query", () => {
    assert.equal(urlUntukTab("instagram.com/kol.satu/reel/C9xYz_AbC-1/?igsh=x"), null); // tanpa skema bukan URL
    assert.equal(urlUntukTab("https://instagram.com/kol.satu/reel/C9xYz_AbC-1/?igsh=x"), "https://www.instagram.com/reel/C9xYz_AbC-1/");
    assert.equal(urlUntukTab("https://www.instagram.com/p/C8aaaaaaaa2"), "https://www.instagram.com/p/C8aaaaaaaa2/");
    assert.equal(urlUntukTab("https://www.instagram.com/Kol.Satu"), "https://www.instagram.com/kol.satu/");
  });

  test("normalAkun: huruf kecil tanpa @; ruas yang bukan akun → ''", () => {
    assert.equal(normalAkun("@Kol.Satu"), "kol.satu");
    assert.equal(normalAkun("https://www.instagram.com/Kol_Satu/?hl=id"), "kol_satu");
    assert.equal(normalAkun("reels"), "");
    assert.equal(normalAkun("bukan akun!"), "");
  });
});

describe("JSON Instagram", () => {
  test("parseTeksJson: awalan for(;;); dibuang; beberapa objek per baris jadi daftar", () => {
    assert.deepEqual(parseTeksJson('for (;;);{"a":1}'), { a: 1 });
    assert.deepEqual(parseTeksJson('{"a":1}\n{"b":2}\nbukan'), [{ a: 1 }, { b: 2 }]);
    assert.equal(parseTeksJson("bukan json"), null);
  });

  test("postingDariMedia (TEBAKAN): angka yang disembunyikan tidak dikirim; tidak pernah share/simpan", () => {
    const r = ringkasTangkapan("https://www.instagram.com/graphql/query", feed);
    const per = Object.fromEntries(r.media.map((m) => [m.posting.id, m.posting]));
    assert.deepEqual(per["C9xYz_AbC-1"], {
      id: "C9xYz_AbC-1",
      dibuatPada: 1727000000,
      disematkan: false,
      views: 15000,
      like: 900,
      komentar: 40,
      bentuk: "REEL",
      teks: "OOTD pakai @Elorae.Official 💛 #OOTD #EloraeStyle",
      sebutan: ["toko.lain", "elorae.official"],
      tagar: ["ootd", "eloraestyle"],
      penulis: "kol.satu",
    });
    assert.equal(per["C8aaaaaaaa2"].disematkan, true);
    assert.equal(per["C8aaaaaaaa2"].views, undefined);
    assert.equal(per["C8aaaaaaaa2"].bentuk, "POST");
    const tersembunyi = per["C7bbbbbbbb3"];
    assert.equal(tersembunyi.views, undefined);
    assert.equal(tersembunyi.like, undefined);
    assert.equal(tersembunyi.komentar, 3);
    assert.equal(tersembunyi.iklan, true);
    assert.deepEqual(tersembunyi.sebutan, ["brand.besar"]);
    for (const p of Object.values(per)) {
      assert.equal("share" in p, false);
      assert.equal("save" in p, false);
    }
  });

  test("nama kolom GraphQL lama juga dikenali (edge_followed_by, shortcode, taken_at_timestamp)", () => {
    const r = ringkasTangkapan("https://www.instagram.com/graphql/query", JSON.parse(lama));
    assert.deepEqual(r.pengguna, [{ username: "kol.dua", pengikut: 12000, id: "222", jumlahPosting: 2, privat: false }]);
    const p = r.media.find((m) => m.posting.id === "Bxxxxxxxxx1");
    assert.equal(p.posting.views, 300);
    assert.equal(p.posting.like, 10);
    assert.deepEqual(p.posting.sebutan, ["elorae.official"]);
    assert.equal(p.idPenulis, "222");
    assert.equal(postingDariMedia({ code: "abc" }), null);
  });
});

describe("bacaHalaman Instagram", () => {
  test("DIUKUR: profil tanpa masuk → pengikut terbaca, posting kosong, tanpa tangkapan", () => {
    const h = bacaHalaman(profilLogout, { url: "https://www.instagram.com/instagram/" });
    assert.equal(h.status, "OK");
    assert.deepEqual(h.data, { platform: "INSTAGRAM", jenis: "PROFIL", uniqueId: "instagram", pengikut: 686570511, posting: [], idPlatform: "25025320", jumlahVideo: 8231 });
    assert.equal(h.adaItemList, false);
  });

  test("profil + tangkapan linimasa (TEBAKAN): hanya posting milik akun itu, urut terbaru, penulis diisi", () => {
    const h = bacaHalaman(profilKol("kol.satu", 50_000), {
      url: "https://www.instagram.com/kol.satu/",
      itemList: [ringkasTangkapan("https://www.instagram.com/graphql/query", feed)],
    });
    assert.equal(h.status, "OK");
    assert.equal(h.adaItemList, true);
    assert.deepEqual(
      h.data.posting.map((p) => [p.id, p.penulis]),
      [
        ["C9xYz_AbC-1", "kol.satu"],
        ["C8aaaaaaaa2", "kol.satu"],
        ["C7bbbbbbbb3", "kol.satu"],
      ],
    );
    assert.deepEqual(kurangWajib(h.data), []);
  });

  test("tangkapan mentah { url, body: teks } juga diterima", () => {
    const h = bacaHalaman(profilKol("kol.satu", 1), { url: "https://www.instagram.com/kol.satu/", itemList: [{ url: "https://www.instagram.com/graphql/query", body: feed }] });
    assert.equal(h.data.posting.length, 3);
  });

  test("posting (TEBAKAN): media dari blob halaman; penanda iklan; akun di alamat harus sama", () => {
    const h = bacaHalaman(posting, { url: "https://www.instagram.com/reel/C9xYz_AbC-1/" });
    assert.equal(h.status, "OK");
    assert.deepEqual(h.data, {
      platform: "INSTAGRAM",
      jenis: "KONTEN",
      videoId: "C9xYz_AbC-1",
      uniqueId: "kol.satu",
      views: 15500,
      like: 910,
      komentar: 41,
      dibuatPada: 1727000000,
      bentuk: "REEL",
      teks: "OOTD pakai @elorae.official #ootd",
      sebutan: ["elorae.official"],
      tagar: ["ootd"],
      iklan: true,
      penulis: "kol.satu",
    });
    const lain = bacaHalaman(posting, { url: "https://www.instagram.com/akun.lain/reel/C9xYz_AbC-1/" });
    assert.equal(lain.status, "TIDAK_TERBACA");
    assert.equal(lain.alasan, "DATA_TIDAK_COCOK");
  });

  test("halaman tanpa data: masuk → LOGIN; tidak tersedia → TIDAK_DITEMUKAN; selebihnya TIDAK_TERBACA dengan diagnosa", () => {
    assert.equal(bacaHalaman("<html></html>", { url: "https://www.instagram.com/accounts/login/?next=/kol/" }).status, "LOGIN");
    const formMasuk = '<form><input name="username"><input name="password" type="password"></form>';
    assert.equal(bacaHalaman(formMasuk, { url: "https://www.instagram.com/reel/C9xYz_AbC-1/" }).status, "LOGIN");
    assert.equal(bacaHalaman("<body>Sorry, this page isn't available.</body>", { url: "https://www.instagram.com/kol.satu/" }).status, "TIDAK_DITEMUKAN");
    assert.equal(bacaHalaman("<body>Help us confirm it's you</body>", { url: "https://www.instagram.com/challenge/" }).status, "CAPTCHA");
    const h = bacaHalaman("<html><title>Instagram</title><body>…</body></html>", { url: "https://www.instagram.com/reel/C9xYz_AbC-1/" });
    assert.equal(h.status, "TIDAK_TERBACA");
    assert.match(h.diagnosa, /blob json: 0/);
    assert.equal(h.tanpaSkrip, true);
  });

  test("konten tanpa satu pun angka → angka tidak terbaca (tidak dikirim sebagai 0)", () => {
    const tanpaAngka = `<script type="application/json">${JSON.stringify({ items: [{ code: "C9xYz_AbC-1", taken_at: 1727000000, like_and_view_counts_disabled: true, like_count: 0, comment_count: null, user: { username: "kol.satu" } }] })}</script>`;
    const h = bacaHalaman(tanpaAngka, { url: "https://www.instagram.com/reel/C9xYz_AbC-1/" });
    assert.equal(h.status, "TIDAK_TERBACA");
    assert.deepEqual(h.kurang, ["angka"]);
  });
});
