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
      // Kolom opsional kontrak: caption dan penulis ada; data ini tidak membawa textExtra maupun
      // challenges, jadi sebutan/tagar TIDAK dikirim (bukan [] — "#ootd" di caption tidak ditebak).
      teks: "Review baju Elorae #ootd",
      penulis: "budi.santoso",
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
        penulis: "budi.santoso",
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
        penulis: "budi.santoso",
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
        penulis: "budi.santoso",
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
    const wajib = ["dibuatPada", "disematkan", "id", "komentar", "like", "save", "share", "views"];
    for (const x of r.data.posting) {
      for (const k of wajib) assert.ok(k in x, `kolom wajib hilang: ${k}`);
      for (const k of Object.keys(x)) assert.ok(wajib.includes(k) || p.KOLOM_TANDA.includes(k), `kolom di luar kontrak: ${k}`);
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
  test("00:00–24:00 = sepanjang hari (Elorae menyimpan pilihan 24 jam begini)", () => {
    for (const iso of ["2026-10-09T16:59:59Z", "2026-10-09T17:00:00Z", "2026-10-09T05:30:00Z", "2026-10-09T16:16:00Z"]) {
      assert.equal(p.dalamJamKerja(t(iso), "00:00", "24:00"), true, iso);
    }
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

describe("jalan pengganti lewat profil", () => {
  const profil = {
    jenis: "PROFIL",
    uniqueId: "lystianovilda",
    pengikut: 555_300,
    posting: [
      { id: "7689069333120634120", dibuatPada: 1_790_000_000, disematkan: false, views: 31_900, like: 1_498, komentar: 27, share: 127, save: 506 },
      { id: "7600000000000000001", dibuatPada: 1_789_000_000, disematkan: false, views: 10, like: 1, komentar: 0, share: 0, save: 0 },
    ],
  };
  test("angka video diambil dari daftar video profil", () => {
    assert.deepEqual(p.kontenDariProfil(profil, "7689069333120634120"), {
      jenis: "KONTEN",
      videoId: "7689069333120634120",
      uniqueId: "lystianovilda",
      views: 31_900,
      like: 1_498,
      komentar: 27,
      share: 127,
      save: 506,
      dibuatPada: 1_790_000_000,
    });
  });
  test("video tidak ada di daftar / bukan profil → null", () => {
    assert.equal(p.kontenDariProfil(profil, "7999999999999999999"), null);
    assert.equal(p.kontenDariProfil({ jenis: "KONTEN" }, "7689069333120634120"), null);
  });
  test("halaman pemeriksaan keamanan dikenali dari diagnosa", () => {
    assert.equal(p.halamanPemeriksaan({ tanpaSkrip: true, diagnosa: "skrip data tidak ada (html: 1519 b; tanda: challenge,waf)" }), true);
    assert.equal(p.halamanPemeriksaan({ tanpaSkrip: true, diagnosa: "skrip data tidak ada (html: 300000 b)" }), false);
    assert.equal(p.halamanPemeriksaan({ tanpaSkrip: false, diagnosa: "tanda: waf" }), false);
  });
});

describe("urlUntukTabTikTok (cek cepat dari tab www.tiktok.com)", () => {
  test("profil dan video dinormalkan ke https://www.tiktok.com", () => {
    assert.equal(p.urlUntukTabTikTok("https://www.tiktok.com/@novherr/video/7690552579637447943?is_from_webapp=1"), "https://www.tiktok.com/@novherr/video/7690552579637447943");
    assert.equal(p.urlUntukTabTikTok("tiktok.com/@Rossafarahdiba"), "https://www.tiktok.com/@Rossafarahdiba");
    assert.equal(p.urlUntukTabTikTok("http://m.tiktok.com/@a/photo/123"), "https://www.tiktok.com/@a/photo/123");
  });
  test("tautan pendek, domain lain, dan halaman lain → null (dikerjakan dengan cara lama)", () => {
    assert.equal(p.urlUntukTabTikTok("https://vt.tiktok.com/ZSabc123/"), null);
    assert.equal(p.urlUntukTabTikTok("https://www.tiktok.com/t/ZT8abc/"), null);
    assert.equal(p.urlUntukTabTikTok("https://www.tiktok.com.evil.test/@a"), null);
    assert.equal(p.urlUntukTabTikTok("https://www.tiktok.com/foryou"), null);
    assert.equal(p.urlUntukTabTikTok(null), null);
  });
});

describe("kolom opsional kontrak: teks, sebutan, tagar, iklan, penulis", () => {
  const URL_TANDA = "https://www.tiktok.com/@lystianovilda/video/7689069333120634120";
  const itemTanda = () => fixture("rehidrasi-video-tanda.json").__DEFAULT_SCOPE__["webapp.video-detail"].itemInfo.itemStruct;

  test("bentuk terukur 2026-10-10: handle asli dari textExtra type 0, bukan nama tampilan di caption", () => {
    const r = p.bacaHalaman(halaman(fixture("rehidrasi-video-tanda.json")), { url: URL_TANDA });
    assert.equal(r.status, "OK");
    assert.equal(r.data.teks, "Outfit kerja minggu ini bareng @Eloraé 🤍 #ootd #OOTDIndonesia #fyp");
    assert.deepEqual(r.data.sebutan, ["elorae.official"]);
    assert.deepEqual(r.data.tagar, ["ootd", "ootdindonesia", "fyp"]);
    assert.equal(r.data.penulis, "lystianovilda");
    assert.equal(r.data.uniqueId, "LystianoVilda");
    assert.equal("iklan" in r.data, false, "isAd false → kolom iklan tidak dikirim");
  });

  test("isAd === true → iklan: true; selain true tidak dikirim", () => {
    assert.equal(p.tandaPosting({ ...itemTanda(), isAd: true }).iklan, true);
    for (const v of [false, "true", 1, null, undefined]) assert.equal("iklan" in p.tandaPosting({ ...itemTanda(), isAd: v }), false, String(v));
  });

  test("tanpa textExtra dan challenges → sebutan/tagar tidak dikirim; ada tapi kosong → []", () => {
    const tanpa = p.tandaPosting({ desc: "halo", author: { uniqueId: "a" } });
    assert.equal("sebutan" in tanpa, false);
    assert.equal("tagar" in tanpa, false);
    assert.deepEqual(p.tandaPosting({ textExtra: [] }), { sebutan: [], tagar: [] });
    assert.deepEqual(p.tandaPosting({ challenges: [] }), { tagar: [] });
  });

  test("hanya challenges (tanpa textExtra): tagar terbaca, sebutan tidak dikirim", () => {
    const h = p.tandaPosting({ challenges: [{ title: "#Elorae" }, { title: "elorae" }, { title: "" }, {}] });
    assert.deepEqual(h, { tagar: ["elorae"] });
  });

  test("textExtra di contents[] (posting foto) ikut dibaca", () => {
    const h = p.tandaPosting({
      contents: [{ desc: "x", textExtra: [{ type: 0, userUniqueId: "Brand.A" }] }, { textExtra: [{ type: 1, hashtagName: "Kolab" }] }],
    });
    assert.deepEqual(h, { sebutan: ["brand.a"], tagar: ["kolab"] });
  });

  test("handle dan tagar dirapikan: huruf kecil, tanpa @/#, unik, yang tidak sah dibuang", () => {
    const h = p.tandaPosting({
      textExtra: [
        { type: 0, userUniqueId: "@Elorae.Official" },
        { type: 0, userUniqueId: "elorae.official" },
        { type: 0, userUniqueId: "dua kata" },
        { type: 0, userUniqueId: "a@b" },
        { type: 0, userUniqueId: "" },
        { type: 0 },
        { type: 1, hashtagName: "#OOTD" },
        { type: 1, hashtagName: "ootd" },
        { type: 1, hashtagName: "dua kata" },
        { type: 1, hashtagName: "x".repeat(101) },
        { type: 2, userUniqueId: "bukan.sebutan", hashtagName: "bukantagar" },
        { userUniqueId: "tanpa.jenis" },
        { hashtagName: "TanpaJenis" },
        null,
        "rusak",
      ],
    });
    assert.deepEqual(h.sebutan, ["elorae.official", "tanpa.jenis"]);
    assert.deepEqual(h.tagar, ["ootd", "tanpajenis"]);
  });

  test("batas jumlah: sebutan ≤ 30, tagar ≤ 50; label > 100 karakter dibuang", () => {
    const textExtra = [];
    for (let i = 0; i < 40; i++) textExtra.push({ type: 0, userUniqueId: `akun${i}` });
    for (let i = 0; i < 60; i++) textExtra.push({ type: 1, hashtagName: `tagar${i}` });
    textExtra.unshift({ type: 0, userUniqueId: "a".repeat(101) });
    const h = p.tandaPosting({ textExtra });
    assert.equal(h.sebutan.length, p.MAKS_SEBUTAN);
    assert.equal(h.sebutan[0], "akun0");
    assert.equal(h.tagar.length, p.MAKS_TAGAR);
    assert.ok(h.sebutan.every((x) => x.length <= 100) && h.tagar.every((x) => x.length <= 100));
  });

  test("caption dipotong 500 unit tanpa membelah emoji; caption kosong tidak dikirim", () => {
    const panjang = "a".repeat(499) + "🤍" + "b".repeat(20);
    const t = p.tandaPosting({ desc: panjang }).teks;
    assert.equal(t.length, 499);
    assert.ok(t.length <= p.MAKS_TEKS);
    assert.equal(p.tandaPosting({ desc: "c".repeat(800) }).teks.length, 500);
    assert.equal("teks" in p.tandaPosting({ desc: "   " }), false);
    assert.equal("teks" in p.tandaPosting({ desc: 42 }), false);
  });

  test("posting profil (item_list) membawa kolom yang sama", () => {
    const item = { ...itemTanda(), id: "7689069333120634120", createTime: 1790000000, isAd: true };
    const posting = p.postingDariItem(item);
    assert.equal(posting.views, 31900);
    assert.deepEqual(posting.sebutan, ["elorae.official"]);
    assert.deepEqual(posting.tagar, ["ootd", "ootdindonesia", "fyp"]);
    assert.equal(posting.iklan, true);
    assert.equal(posting.penulis, "lystianovilda");
    const ringkas = p.ringkasItemList("https://www.tiktok.com/api/post/item_list/?secUid=x", { itemList: [item] });
    assert.deepEqual(ringkas.butir[0], { penulis: "LystianoVilda", posting });
  });

  test("angka yang tidak terbaca tetap menggagalkan posting meski caption ada", () => {
    const item = { ...itemTanda(), createTime: 1790000000 };
    delete item.stats.playCount;
    delete item.statsV2.playCount;
    assert.equal(p.postingDariItem(item), null);
  });

  test("jalan pengganti lewat profil menyalin kolom opsional ke HasilKonten", () => {
    const profil = {
      jenis: "PROFIL",
      uniqueId: "lystianovilda",
      pengikut: 1,
      posting: [{ id: "7689", dibuatPada: 1, disematkan: false, views: 9, like: 1, komentar: 0, share: 0, save: 0, sebutan: ["elorae.official"], tagar: [], iklan: true, penulis: "lystianovilda", teks: "hai" }],
    };
    const k = p.kontenDariProfil(profil, "7689");
    assert.deepEqual(k.sebutan, ["elorae.official"]);
    assert.deepEqual(k.tagar, []);
    assert.equal(k.iklan, true);
    assert.equal(k.teks, "hai");
    assert.equal(k.penulis, "lystianovilda");
  });
});

describe("rampingkanData (badan Elorae ≤ 256 KB)", () => {
  const posting = (i, teks) => ({
    id: String(7400000000000000000n + BigInt(i)),
    dibuatPada: 1_790_000_000 - i * 3600,
    disematkan: false,
    views: 1000 + i,
    like: 10,
    komentar: 1,
    share: 0,
    save: 0,
    teks,
    sebutan: ["elorae.official"],
    tagar: ["ootd", "fyp"],
    penulis: "budi",
  });
  const profil = (n, teks) => ({ jenis: "PROFIL", uniqueId: "budi", pengikut: 5, posting: Array.from({ length: n }, (_, i) => posting(i, teks)) });

  test("data yang muat dikembalikan apa adanya (objek yang sama)", () => {
    const d = profil(30, "pendek");
    assert.equal(p.rampingkanData(d), d);
    const k = { jenis: "KONTEN", videoId: "1", uniqueId: "a", views: 1, like: 1, komentar: 1, share: 1, save: 1, teks: "x".repeat(500) };
    assert.equal(p.rampingkanData(k, 10), k);
  });

  test("terlalu besar → caption posting terlama dibuang dulu sampai muat; angka dan jumlah posting utuh", () => {
    const d = profil(200, "x".repeat(500));
    const maks = 80_000;
    assert.ok(JSON.stringify(d).length > maks);
    const r = p.rampingkanData(d, maks);
    assert.ok(JSON.stringify(r).length <= maks);
    assert.equal(r.posting.length, 200);
    assert.ok("teks" in r.posting[0], "posting terbaru tetap membawa caption");
    assert.equal("teks" in r.posting[199], false, "posting terlama kehilangan caption dulu");
    assert.deepEqual(r.posting[199].sebutan, ["elorae.official"], "sebutan baru dibuang setelah semua caption");
    for (let i = 0; i < 200; i++) assert.equal(r.posting[i].views, d.posting[i].views);
    assert.equal(d.posting[199].teks.length, 500, "data asli tidak diubah");
  });

  test("bila caption saja tidak cukup, tagar lalu sebutan ikut dibuang", () => {
    const d = profil(200, "x".repeat(500));
    const r = p.rampingkanData(d, 30_000);
    assert.ok(JSON.stringify(r).length <= 30_000);
    assert.equal(r.posting.some((x) => "teks" in x), false);
    assert.equal(r.posting.length, 200);
  });

  test("bawaan memakai BATAS_MUATAN_KARAKTER (200 posting di batas kontrak)", () => {
    const d = profil(200, "🤍".repeat(250));
    for (const x of d.posting) {
      x.sebutan = Array.from({ length: 30 }, (_, i) => `a${i}`.padEnd(100, "x"));
      x.tagar = Array.from({ length: 50 }, (_, i) => `t${i}`.padEnd(100, "y"));
    }
    assert.ok(JSON.stringify(d).length > p.BATAS_MUATAN_KARAKTER);
    const r = p.rampingkanData(d);
    assert.ok(JSON.stringify(r).length <= p.BATAS_MUATAN_KARAKTER);
    assert.equal(r.posting.length, 200);
  });
});
