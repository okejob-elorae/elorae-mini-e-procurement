import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as p from "../lib/pengurai.js";

const fixture = (nama) => JSON.parse(readFileSync(new URL(`./fixtures/${nama}`, import.meta.url), "utf8"));

/** Halaman TikTok tiruan: skrip rehidrasi + isi badan. */
const halaman = (data, badan = "") =>
  "<!DOCTYPE html><html><head>" +
  (data === null
    ? ""
    : `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(data)}</script>`) +
  `</head><body>${badan}</body></html>`;

/** Dokumen tiruan secukupnya untuk jalur "document-like". */
function dokumen({ data = null, teks = "", selektor = [], jalur = "/" } = {}) {
  const skrip = data === null ? null : { textContent: JSON.stringify(data) };
  return {
    location: { pathname: jalur },
    body: { innerText: teks },
    getElementById: (id) => (id === "__UNIVERSAL_DATA_FOR_REHYDRATION__" ? skrip : null),
    querySelector: (sel) => (selektor.includes(sel) ? {} : null),
  };
}

const URL_PROFIL = "https://www.tiktok.com/@budi.santoso";
const URL_VIDEO = "https://www.tiktok.com/@budi.santoso/video/7421234567890123456";

describe("normalHandle", () => {
  test("membuang @, spasi, huruf besar", () => {
    assert.equal(p.normalHandle("  @Budi.Santoso "), "budi.santoso");
    assert.equal(p.normalHandle("budi_01"), "budi_01");
  });
  test("mengambil handle dari link profil maupun video", () => {
    assert.equal(p.normalHandle("https://www.tiktok.com/@Budi_01?lang=id"), "budi_01");
    assert.equal(p.normalHandle("https://www.tiktok.com/@budi/video/123"), "budi");
    assert.equal(p.normalHandle("tiktok.com/@budi.s/"), "budi.s");
  });
  test("kosong untuk masukan yang bukan handle", () => {
    assert.equal(p.normalHandle(""), "");
    assert.equal(p.normalHandle("@"), "");
    assert.equal(p.normalHandle(null), "");
    assert.equal(p.normalHandle(undefined), "");
    assert.equal(p.normalHandle(42), "");
  });
});

describe("jenisHalaman", () => {
  test("profil", () => {
    assert.deepEqual(p.jenisHalaman(URL_PROFIL), { jenis: "PROFIL", handle: "budi.santoso" });
    assert.deepEqual(p.jenisHalaman("https://www.tiktok.com/@Budi.Santoso/?lang=id"), {
      jenis: "PROFIL",
      handle: "budi.santoso",
    });
  });
  test("video dan foto", () => {
    assert.deepEqual(p.jenisHalaman(URL_VIDEO), {
      jenis: "KONTEN",
      handle: "budi.santoso",
      videoId: "7421234567890123456",
    });
    assert.deepEqual(p.jenisHalaman("https://www.tiktok.com/@budi/photo/7420000000000000009?is_from_webapp=1"), {
      jenis: "KONTEN",
      handle: "budi",
      videoId: "7420000000000000009",
    });
  });
  test("halaman lain dan situs lain bukan profil/konten", () => {
    assert.equal(p.jenisHalaman("https://www.tiktok.com/foryou"), null);
    assert.equal(p.jenisHalaman("https://www.tiktok.com/@budi/live"), null);
    assert.equal(p.jenisHalaman("https://contoh.com/@budi"), null);
    assert.equal(p.jenisHalaman("bukan url"), null);
  });
});

describe("urlTugasSah", () => {
  test("link TikTok apa pun dibuka lewat https (tautan pendek dialihkan TikTok sendiri)", () => {
    assert.equal(p.urlTugasSah("https://www.tiktok.com/@budi/video/1"), "https://www.tiktok.com/@budi/video/1");
    assert.equal(p.urlTugasSah("  https://vt.tiktok.com/ZSabc123/ "), "https://vt.tiktok.com/ZSabc123/");
    assert.equal(p.urlTugasSah("tiktok.com/@budi/video/1?lang=id"), "https://tiktok.com/@budi/video/1?lang=id");
    assert.equal(p.urlTugasSah("http://m.tiktok.com/@budi"), "https://m.tiktok.com/@budi");
  });
  test("selain tiktok.com ditolak", () => {
    for (const salah of ["https://tiktok.com.evil.example/@x", "https://evil.example/tiktok.com/@x", "javascript:alert(1)", "", null, "ftp://www.tiktok.com/@x"]) {
      assert.equal(p.urlTugasSah(salah), null, String(salah));
    }
  });
});

describe("angkaBulat dan pilihAngka", () => {
  test("angkaBulat hanya menerima bulat >= 0, angka maupun teks digit", () => {
    assert.equal(p.angkaBulat(5), 5);
    assert.equal(p.angkaBulat(0), 0);
    assert.equal(p.angkaBulat("12"), 12);
    assert.equal(p.angkaBulat(" 7 "), 7);
    for (const salah of ["1.2M", "", "12a", -1, 1.5, null, undefined, true, NaN, Infinity, 2 ** 60, "-3", {}]) {
      assert.equal(p.angkaBulat(salah), undefined, `harus tak terbaca: ${String(salah)}`);
    }
  });
  test("pilihAngka memilih yang paling teliti (nol di belakang paling sedikit)", () => {
    assert.equal(p.pilihAngka("1234567", 1200000), 1234567);
    assert.equal(p.pilihAngka("1200000", 1234567), 1234567);
    assert.equal(p.pilihAngka("15230", 15230), 15230);
  });
  test("pilihAngka memakai yang terbaca saja; nol kalah dari angka lain", () => {
    assert.equal(p.pilihAngka(undefined, 5), 5);
    assert.equal(p.pilihAngka("x", "9"), 9);
    assert.equal(p.pilihAngka("0", 5), 5);
    assert.equal(p.pilihAngka("0", 0), 0);
    assert.equal(p.pilihAngka("x", undefined), undefined);
    assert.equal(p.pilihAngka(), undefined);
  });
});

describe("uraiProfil", () => {
  test("memetakan userInfo ke HasilProfil", () => {
    const hasil = p.uraiProfil(fixture("rehidrasi-profil.json").__DEFAULT_SCOPE__);
    assert.deepEqual(hasil, {
      jenis: "PROFIL",
      uniqueId: "Budi.Santoso",
      secUid: "MS4wLjABAAAAbudiSecUid",
      pengikut: 15230,
      totalLike: 987654,
      jumlahVideo: 87,
      posting: [],
    });
    assert.deepEqual(p.kurangWajib(hasil), []);
  });

  test("angka yang tidak terbaca TIDAK menjadi 0 — kolomnya tidak ada", () => {
    const data = fixture("rehidrasi-profil.json");
    const info = data.__DEFAULT_SCOPE__["webapp.user-detail"].userInfo;
    delete info.stats.followerCount;
    info.statsV2.followerCount = "";
    delete info.stats.videoCount;
    delete info.statsV2.videoCount;
    const hasil = p.uraiProfil(data.__DEFAULT_SCOPE__);
    assert.equal("pengikut" in hasil, false);
    assert.equal("jumlahVideo" in hasil, false);
    assert.deepEqual(p.kurangWajib(hasil), ["pengikut"]);
  });

  test("heartCount diutamakan atas heart (heart bisa meluap)", () => {
    const data = fixture("rehidrasi-profil.json");
    const info = data.__DEFAULT_SCOPE__["webapp.user-detail"].userInfo;
    info.stats.heart = -1294967296;
    info.statsV2.heart = "-1294967296";
    info.stats.heartCount = 3000000000;
    info.statsV2.heartCount = "3000000000";
    assert.equal(p.uraiProfil(data.__DEFAULT_SCOPE__).totalLike, 3000000000);
  });

  test("posting yang tertanam di halaman ikut terbaca", () => {
    const data = fixture("rehidrasi-profil.json");
    data.__DEFAULT_SCOPE__["webapp.user-detail"].userInfo.itemList = fixture("item-list.json").itemList.slice(0, 2);
    const hasil = p.uraiProfil(data.__DEFAULT_SCOPE__);
    assert.deepEqual(
      hasil.posting.map((x) => x.id),
      ["7420000000000000002", "7420000000000000001"],
    );
  });
});

describe("uraiKonten", () => {
  test("memetakan itemStruct ke HasilKonten; statsV2 yang lebih teliti menang", () => {
    const hasil = p.uraiKonten(fixture("rehidrasi-video.json").__DEFAULT_SCOPE__);
    assert.deepEqual(hasil, {
      jenis: "KONTEN",
      videoId: "7421234567890123456",
      uniqueId: "budi.santoso",
      views: 1234567,
      like: 4210,
      komentar: 156,
      share: 87,
      save: 312,
      dibuatPada: 1727740800,
    });
    assert.deepEqual(p.kurangWajib(hasil), []);
  });

  test("tanpa statsV2 tetap terbaca dari stats (termasuk angka bertipe teks)", () => {
    const data = fixture("rehidrasi-video.json");
    delete data.__DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct.statsV2;
    const hasil = p.uraiKonten(data.__DEFAULT_SCOPE__);
    assert.equal(hasil.views, 1200000);
    assert.equal(hasil.save, 312);
  });

  test("angka yang hilang tidak menjadi 0", () => {
    const data = fixture("rehidrasi-video.json");
    const item = data.__DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct;
    delete item.stats.shareCount;
    delete item.statsV2.shareCount;
    item.stats.collectCount = null;
    delete item.statsV2.collectCount;
    const hasil = p.uraiKonten(data.__DEFAULT_SCOPE__);
    assert.equal("share" in hasil, false);
    assert.equal("save" in hasil, false);
    assert.deepEqual(p.kurangWajib(hasil), ["share", "save"]);
  });

  test("penulis versi lama (author berupa teks) tetap terbaca", () => {
    const data = fixture("rehidrasi-video.json");
    data.__DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct.author = "budi.santoso";
    assert.equal(p.uraiKonten(data.__DEFAULT_SCOPE__).uniqueId, "budi.santoso");
  });
});

describe("uraiItemList", () => {
  test("hanya posting yang semua angkanya terbaca; urut terbaru dulu", () => {
    const posting = p.uraiItemList(fixture("item-list.json"));
    assert.deepEqual(posting, [
      {
        id: "7420000000000000002",
        dibuatPada: 1727600000,
        disematkan: false,
        views: 8000,
        like: 400,
        komentar: 20,
        share: 5,
        save: 15,
      },
      {
        id: "7420000000000000003",
        dibuatPada: 1727500000,
        disematkan: false,
        views: 0,
        like: 0,
        komentar: 0,
        share: 0,
        save: 0,
      },
      {
        id: "7420000000000000001",
        dibuatPada: 1727000000,
        disematkan: true,
        views: 50000,
        like: 2500,
        komentar: 100,
        share: 40,
        save: 60,
      },
    ]);
  });
  test("badan yang bukan daftar menghasilkan []", () => {
    assert.deepEqual(p.uraiItemList(null), []);
    assert.deepEqual(p.uraiItemList({ statusCode: 10201 }), []);
    assert.deepEqual(p.uraiItemList({ itemList: "x" }), []);
  });
  test("apakahUrlItemList", () => {
    assert.equal(p.apakahUrlItemList("https://www.tiktok.com/api/post/item_list/?secUid=x&count=35"), true);
    assert.equal(p.apakahUrlItemList("https://www.tiktok.com/api/user/detail/?x=1"), false);
    assert.equal(p.apakahUrlItemList(undefined), false);
  });
});

describe("deteksiHalaman (teks HTML)", () => {
  const profil = fixture("rehidrasi-profil.json");
  test("profil terbaca → OK", () => {
    assert.equal(p.deteksiHalaman(halaman(profil)), "OK");
    assert.equal(p.deteksiHalaman(halaman(fixture("rehidrasi-video.json"))), "OK");
  });
  test("captcha mengalahkan segalanya, termasuk data yang terbaca", () => {
    assert.equal(p.deteksiHalaman(halaman(profil, '<div id="captcha-verify-container"></div>')), "CAPTCHA");
    assert.equal(p.deteksiHalaman(halaman(null, "<div class='TUXModal captcha_verify_container x'></div>")), "CAPTCHA");
    assert.equal(p.deteksiHalaman(halaman(null, '<div id="captcha_container"></div>')), "CAPTCHA");
  });
  test("tembok login tanpa data → LOGIN; dengan data tetap OK", () => {
    const tembok = '<div data-e2e="login-modal"><h2>Log in to TikTok</h2></div>';
    assert.equal(p.deteksiHalaman(halaman(null, tembok)), "LOGIN");
    assert.equal(p.deteksiHalaman(halaman(profil, tembok)), "OK");
    assert.equal(p.deteksiHalaman(halaman(null, "<p>Masuk ke TikTok</p>")), "LOGIN");
    assert.equal(p.deteksiHalaman(halaman(null, ""), { url: "https://www.tiktok.com/login?redirect_url=x" }), "LOGIN");
  });
  test("akun privat → PRIVAT", () => {
    const data = fixture("rehidrasi-profil.json");
    data.__DEFAULT_SCOPE__["webapp.user-detail"].userInfo.user.privateAccount = true;
    assert.equal(p.deteksiHalaman(halaman(data)), "PRIVAT");
    assert.equal(p.deteksiHalaman(halaman(null, "<p>This account is private</p>")), "PRIVAT");
    assert.equal(p.deteksiHalaman(halaman(null, "<p>Akun ini bersifat pribadi</p>")), "PRIVAT");
  });
  test("akun/video tidak ditemukan → TIDAK_DITEMUKAN", () => {
    const hilang = { __DEFAULT_SCOPE__: { "webapp.user-detail": { userInfo: {}, statusCode: 10221, statusMsg: "" } } };
    assert.equal(p.deteksiHalaman(halaman(hilang)), "TIDAK_DITEMUKAN");
    assert.equal(p.deteksiHalaman(halaman(null, "<p>Couldn&#x27;t find this account</p>")), "TIDAK_DITEMUKAN");
    assert.equal(p.deteksiHalaman(halaman(null, "<p>Couldn’t find this account</p>")), "TIDAK_DITEMUKAN");
    assert.equal(p.deteksiHalaman(halaman(null, "<p>Akun ini tidak ditemukan</p>")), "TIDAK_DITEMUKAN");
    assert.equal(p.deteksiHalaman(halaman(null, "<p>Video currently unavailable</p>")), "TIDAK_DITEMUKAN");
    const videoHilang = { __DEFAULT_SCOPE__: { "webapp.video-detail": { itemInfo: {}, statusCode: 10204 } } };
    assert.equal(p.deteksiHalaman(halaman(videoHilang)), "TIDAK_DITEMUKAN");
  });
  test("teks di dalam <script> tidak dihitung sebagai teks halaman", () => {
    const html = halaman(null, '<script>var t = {"x":"Couldn\'t find this account", "c":"captcha_container"};</script><p>Halo</p>');
    assert.equal(p.deteksiHalaman(html), "TIDAK_TERBACA");
  });
  test("tanpa data dan tanpa tanda apa pun → TIDAK_TERBACA", () => {
    assert.equal(p.deteksiHalaman(halaman(null, "<p>Something went wrong</p>")), "TIDAK_TERBACA");
    assert.equal(p.deteksiHalaman(""), "TIDAK_TERBACA");
    assert.equal(p.deteksiHalaman(halaman({ __DEFAULT_SCOPE__: {} })), "TIDAK_TERBACA");
  });
  test("JSON rehidrasi rusak → TIDAK_TERBACA, tidak melempar", () => {
    const html = '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">{rusak</script>';
    assert.equal(p.deteksiHalaman(html), "TIDAK_TERBACA");
  });
});

describe("deteksiHalaman (dokumen)", () => {
  test("captcha lewat selektor", () => {
    const doc = dokumen({ data: fixture("rehidrasi-profil.json"), selektor: ["#captcha-verify-container"] });
    assert.equal(p.deteksiHalaman(doc), "CAPTCHA");
  });
  test("teks halaman lewat innerText", () => {
    assert.equal(p.deteksiHalaman(dokumen({ teks: "Couldn't find this account\nLooking for videos?" })), "TIDAK_DITEMUKAN");
    assert.equal(p.deteksiHalaman(dokumen({ teks: "Verify to continue:" })), "CAPTCHA");
  });
  test("data terbaca → OK; jalur /login tanpa data → LOGIN", () => {
    assert.equal(p.deteksiHalaman(dokumen({ data: fixture("rehidrasi-video.json") })), "OK");
    assert.equal(p.deteksiHalaman(dokumen({ jalur: "/login" })), "LOGIN");
  });
  test("querySelector yang melempar tidak menggagalkan deteksi", () => {
    const doc = dokumen({ data: fixture("rehidrasi-profil.json") });
    doc.querySelector = () => {
      throw new Error("selektor tidak sah");
    };
    assert.equal(p.deteksiHalaman(doc), "OK");
  });
  test("daftar pola ada di SATU konstanta", () => {
    assert.deepEqual(Object.keys(p.POLA_HALAMAN).sort(), ["CAPTCHA", "LOGIN", "PRIVAT", "TIDAK_DITEMUKAN"]);
    for (const pola of Object.values(p.POLA_HALAMAN)) {
      for (const sel of pola.selektor ?? []) {
        assert.match(sel, /^(#[\w-]+|\.[\w-]+|\[[\w-]+="[^"]*"\])$/, `bentuk selektor tidak didukung: ${sel}`);
      }
    }
  });
});

describe("bacaHalaman", () => {
  const profil = fixture("rehidrasi-profil.json");
  const tangkapan = (body, secUid = "MS4wLjABAAAAbudiSecUid") => ({
    url: `https://www.tiktok.com/api/post/item_list/?aid=1988&count=35&cursor=0&secUid=${secUid}`,
    body,
  });

  test("profil + item_list milik akun ini → posting dari item_list", () => {
    const r = p.bacaHalaman(halaman(profil), {
      url: URL_PROFIL,
      itemList: [tangkapan(fixture("item-list.json")), tangkapan(fixture("item-list-akun-lain.json"), "LAIN")],
    });
    assert.equal(r.status, "OK");
    assert.equal(r.adaItemList, true);
    assert.equal(r.data.pengikut, 15230);
    assert.deepEqual(
      r.data.posting.map((x) => x.id),
      ["7420000000000000002", "7420000000000000003", "7420000000000000001"],
    );
  });

  test("item_list tanpa secUid di URL disaring lewat penulis", () => {
    const r = p.bacaHalaman(halaman(profil), {
      url: URL_PROFIL,
      itemList: [
        { url: "https://www.tiktok.com/api/post/item_list/?count=35", body: fixture("item-list-akun-lain.json") },
      ],
    });
    assert.equal(r.status, "OK");
    assert.equal(r.adaItemList, false);
    assert.deepEqual(r.data.posting, []);
  });

  test("tangkapan yang sudah diringkas diterima juga, dan duplikat digabung", () => {
    const ringkas = p.ringkasItemList(tangkapan(fixture("item-list.json")).url, fixture("item-list.json"));
    const r = p.bacaHalaman(halaman(profil), { url: URL_PROFIL, itemList: [ringkas, ringkas] });
    assert.equal(r.data.posting.length, 3);
  });

  test("konten → HasilKonten", () => {
    const r = p.bacaHalaman(halaman(fixture("rehidrasi-video.json")), { url: URL_VIDEO });
    assert.equal(r.status, "OK");
    assert.equal(r.data.jenis, "KONTEN");
    assert.equal(r.data.videoId, "7421234567890123456");
  });

  test("data halaman lama (navigasi tanpa muat ulang) → TIDAK_TERBACA DATA_TIDAK_COCOK", () => {
    const r = p.bacaHalaman(halaman(profil), { url: URL_VIDEO });
    assert.equal(r.status, "TIDAK_TERBACA");
    assert.equal(r.alasan, "DATA_TIDAK_COCOK");
    const r2 = p.bacaHalaman(halaman(profil), { url: "https://www.tiktok.com/@orang.lain" });
    assert.equal(r2.alasan, "DATA_TIDAK_COCOK");
  });

  test("angka wajib tak terbaca → TIDAK_TERBACA dengan daftar kurang", () => {
    const data = fixture("rehidrasi-video.json");
    delete data.__DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct.stats.playCount;
    delete data.__DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct.statsV2.playCount;
    const r = p.bacaHalaman(halaman(data), { url: URL_VIDEO });
    assert.equal(r.status, "TIDAK_TERBACA");
    assert.equal(r.alasan, "ANGKA_TIDAK_TERBACA");
    assert.deepEqual(r.kurang, ["views"]);
  });

  test("status selain OK diteruskan apa adanya", () => {
    assert.deepEqual(p.bacaHalaman(halaman(null, '<div id="captcha_container"></div>'), { url: URL_PROFIL }), {
      status: "CAPTCHA",
    });
  });

  test("hasil OK hanya berisi kolom kontrak", () => {
    const r = p.bacaHalaman(halaman(profil), { url: URL_PROFIL, itemList: [tangkapan(fixture("item-list.json"))] });
    assert.deepEqual(Object.keys(r.data).sort(), ["jenis", "jumlahVideo", "pengikut", "posting", "secUid", "totalLike", "uniqueId"]);
    for (const x of r.data.posting) {
      assert.deepEqual(Object.keys(x).sort(), ["dibuatPada", "disematkan", "id", "komentar", "like", "save", "share", "views"]);
    }
  });
});

describe("jedaAcak", () => {
  test("rentang inklusif dan bulat", () => {
    assert.equal(p.jedaAcak(15, 40, () => 0), 15);
    assert.equal(p.jedaAcak(15, 40, () => 0.9999999), 40);
    assert.equal(p.jedaAcak(15, 40, () => 0.5), 28);
    assert.equal(p.jedaAcak(40, 15, () => 0), 15);
    assert.equal(p.jedaAcak(5, 5, () => 0.7), 5);
  });
  test("rand di luar [0,1) dijepit", () => {
    assert.equal(p.jedaAcak(1, 3, () => 1), 3);
    assert.equal(p.jedaAcak(1, 3, () => -2), 1);
  });
  test("bawaan memakai Math.random dan tetap dalam rentang", () => {
    for (let i = 0; i < 200; i++) {
      const v = p.jedaAcak(15, 40);
      assert.ok(Number.isInteger(v) && v >= 15 && v <= 40);
    }
  });
});

describe("dalamJamKerja (WIB)", () => {
  const t = (iso) => new Date(iso);
  test("08:00 sampai sebelum 17:00 WIB", () => {
    assert.equal(p.dalamJamKerja(t("2026-10-09T00:59:59Z"), "08:00", "17:00"), false);
    assert.equal(p.dalamJamKerja(t("2026-10-09T01:00:00Z"), "08:00", "17:00"), true);
    assert.equal(p.dalamJamKerja(t("2026-10-09T09:59:00Z"), "08:00", "17:00"), true);
    assert.equal(p.dalamJamKerja(t("2026-10-09T10:00:00Z"), "08:00", "17:00"), false);
  });
  test("tengah malam UTC = 07.00 WIB, sore UTC = dini hari WIB", () => {
    assert.equal(p.dalamJamKerja(t("2026-10-09T00:00:00Z"), "07:00", "08:00"), true);
    assert.equal(p.dalamJamKerja(t("2026-10-08T18:30:00Z"), "08:00", "17:00"), false);
  });
  test("menerima angka milidetik", () => {
    assert.equal(p.dalamJamKerja(Date.parse("2026-10-09T03:00:00Z"), "08:00", "17:00"), true);
  });
  test("rentang melewati tengah malam", () => {
    assert.equal(p.dalamJamKerja(t("2026-10-09T16:00:00Z"), "22:00", "06:00"), true);
    assert.equal(p.dalamJamKerja(t("2026-10-09T05:00:00Z"), "22:00", "06:00"), false);
  });
  test("jam tidak sah atau sama → di luar (tidak berjalan saat ragu)", () => {
    assert.equal(p.dalamJamKerja(t("2026-10-09T03:00:00Z"), "8", "17:00"), false);
    assert.equal(p.dalamJamKerja(t("2026-10-09T03:00:00Z"), "08:00", "25:00"), false);
    assert.equal(p.dalamJamKerja(t("2026-10-09T03:00:00Z"), "08:00", "08:00"), false);
    assert.equal(p.dalamJamKerja(new Date("x"), "08:00", "17:00"), false);
  });
});

describe("perluHalamanSegar", () => {
  test("data halaman tidak ada atau milik halaman lain → ambil HTML segar", () => {
    assert.equal(p.perluHalamanSegar({ status: "TIDAK_TERBACA" }), true);
    assert.equal(p.perluHalamanSegar({ status: "TIDAK_TERBACA", alasan: "DATA_TIDAK_COCOK" }), true);
  });
  test("angka kurang, captcha, login, privat, tidak ditemukan, OK → tidak", () => {
    assert.equal(p.perluHalamanSegar({ status: "TIDAK_TERBACA", alasan: "ANGKA_TIDAK_TERBACA" }), false);
    for (const status of ["OK", "CAPTCHA", "LOGIN", "PRIVAT", "TIDAK_DITEMUKAN"]) assert.equal(p.perluHalamanSegar({ status }), false);
    assert.equal(p.perluHalamanSegar(null), false);
  });
  test("teks HTML hasil fetch terbaca sama dengan dokumen", () => {
    const html = `<html><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify(fixture("rehidrasi-profil.json"))}</script></body></html>`;
    const h = p.bacaHalaman(html, { url: "https://www.tiktok.com/@budi.santoso" });
    assert.equal(h.status, "OK");
    assert.equal(h.data.uniqueId.toLowerCase(), "budi.santoso");
  });
});

describe("diagnosaHalaman", () => {
  test("tanpa skrip data", () => {
    assert.equal(p.diagnosaHalaman("<html><body>halo</body></html>"), "skrip data tidak ada (html: 30 b)");
  });
  test("halaman perantara: judul, panjang, dan kata penanda dilaporkan; isi halaman tidak", () => {
    const html = "<html><head><title>Security Check</title></head><body><div id=captcha-verify-container>rahasia 123</div></body></html>";
    const d = p.diagnosaHalaman(html);
    assert.match(d, /^skrip data tidak ada \(judul: Security Check; html: \d+ b; tanda: captcha,verify\)$/);
    assert.doesNotMatch(d, /rahasia/);
    const h = p.bacaHalaman(html, { url: "https://www.tiktok.com/@a/video/7301234567890123456" });
    assert.equal(h.tanpaSkrip, true);
  });
  test("skrip ada tapi bagian video kosong → kunci dan statusCode dilaporkan, tanpa angka", () => {
    const html = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
      __DEFAULT_SCOPE__: { "webapp.app-context": {}, "webapp.video-detail": { statusCode: 99999, itemInfo: {} } },
    })}</script>`;
    const d = p.diagnosaHalaman(html);
    assert.match(d, /kunci: webapp\.app-context,webapp\.video-detail/);
    assert.match(d, /webapp\.video-detail: statusCode=99999 item=tidak/);
    const h = p.bacaHalaman(html, { url: "https://www.tiktok.com/@a/video/7301234567890123456" });
    assert.equal(h.status, "TIDAK_TERBACA");
    assert.equal(h.diagnosa, d);
  });
});
