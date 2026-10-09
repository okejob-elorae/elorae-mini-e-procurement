import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as p from "../lib/panel.js";

const SEKARANG = Date.parse("2026-10-09T03:00:00Z");
const JAM = 3600;
const detikLalu = (jam) => Math.floor(SEKARANG / 1000) - jam * JAM;

const posting = (id, jamLalu, views, lain = {}) => ({
  id,
  dibuatPada: detikLalu(jamLalu),
  disematkan: false,
  views,
  like: 0,
  komentar: 0,
  share: 0,
  save: 0,
  ...lain,
});

describe("erPosting", () => {
  test("(like + komentar + share + save) ÷ views × 100, dua desimal", () => {
    assert.equal(p.erPosting(posting("a", 72, 1000, { like: 50, komentar: 5, share: 3, save: 2 })), 6);
    assert.equal(p.erPosting(posting("b", 72, 3, { like: 1 })), 33.33);
  });
  test("views 0 atau tak ada → null, bukan 0", () => {
    assert.equal(p.erPosting(posting("a", 72, 0, { like: 5 })), null);
    assert.equal(p.erPosting(null), null);
  });
});

describe("hitungErAkun — sama dengan aturan server (pantau-er.ts)", () => {
  test("rata-rata ER per posting, bukan total interaksi ÷ total views", () => {
    const daftar = [
      posting("a", 72, 100, { like: 10 }), // 10%
      posting("b", 96, 100, { like: 20 }), // 20%
      posting("c", 120, 1_000_000, { like: 0 }), // 0% (viral tanpa interaksi)
    ];
    const r = p.hitungErAkun(daftar, SEKARANG);
    assert.equal(r.er, 10);
    assert.equal(r.postsCounted, 3);
    assert.equal(r.avgViews, Math.round(1_000_200 / 3));
  });
  test("posting disematkan, belum 48 jam, dan views 0 dilewati; id ganda dihitung sekali", () => {
    const daftar = [
      posting("pin", 200, 100, { like: 90, disematkan: true }),
      posting("muda", 47, 100, { like: 90 }),
      posting("nol", 72, 0, { like: 90 }),
      posting("a", 72, 100, { like: 1 }),
      posting("a", 72, 100, { like: 99 }),
      posting("b", 73, 100, { like: 2 }),
      posting("c", 74, 100, { like: 3 }),
    ];
    const r = p.hitungErAkun(daftar, SEKARANG);
    assert.equal(r.postsCounted, 3);
    assert.equal(r.er, 2);
  });
  test("tepat 48 jam ikut dihitung", () => {
    const r = p.hitungErAkun([posting("a", 48, 100, { like: 1 }), posting("b", 49, 100), posting("c", 50, 100)], SEKARANG);
    assert.equal(r.postsCounted, 3);
  });
  test("hanya 12 posting terbaru yang dipakai", () => {
    const daftar = Array.from({ length: 20 }, (_, i) => posting(`v${i}`, 50 + i, 100, { like: i < 12 ? 10 : 90 }));
    const r = p.hitungErAkun(daftar, SEKARANG);
    assert.equal(r.postsCounted, 12);
    assert.equal(r.er, 10);
  });
  test("kurang dari 3 posting sah → er dan avgViews null", () => {
    assert.deepEqual(p.hitungErAkun([posting("a", 72, 100), posting("b", 73, 100)], SEKARANG), {
      er: null,
      avgViews: null,
      postsCounted: 2,
    });
    assert.deepEqual(p.hitungErAkun(undefined, SEKARANG), { er: null, avgViews: null, postsCounted: 0 });
  });
});

describe("batangViews", () => {
  test("12 video terbaru tanpa pin, urut lama → baru, tinggi relatif terhadap puncak", () => {
    const daftar = [
      posting("pin", 1, 9_999_999, { disematkan: true }),
      posting("baru", 10, 50),
      posting("tengah", 60, 200),
      posting("lama", 90, 100),
    ];
    const b = p.batangViews(daftar, SEKARANG);
    assert.deepEqual(
      b.map((x) => [x.id, x.tinggi, x.muda]),
      [
        ["lama", 0.5, false],
        ["tengah", 1, false],
        ["baru", 0.25, true],
      ],
    );
  });
  test("dibatasi 12 batang; semua views 0 → tinggi 0, tidak NaN", () => {
    const daftar = Array.from({ length: 15 }, (_, i) => posting(`v${i}`, 50 + i, 0));
    const b = p.batangViews(daftar, SEKARANG);
    assert.equal(b.length, 12);
    assert.ok(b.every((x) => x.tinggi === 0));
  });
});

describe("format angka", () => {
  // Intl memakai spasi tak-terputus di antara angka dan satuan ("12,3\u00a0rb") — sengaja, agar tidak terpotong baris.
  const spasi = (t) => t.replace(/\u00a0/g, " ");
  test("di bawah 10.000 lengkap, di atasnya ringkas tiga angka penting", () => {
    assert.equal(p.angkaPendek(1314), "1.314");
    assert.equal(spasi(p.angkaPendek(12_345)), "12,3 rb");
    assert.equal(spasi(p.angkaPendek(1_121_908)), "1,12 jt");
    assert.equal(spasi(p.angkaPendek(60_362_933)), "60,4 jt");
    assert.equal(p.angkaPendek(undefined), "—");
    assert.equal(p.angkaLengkap(1_121_908), "1.121.908");
  });
  test("persen dua desimal dengan koma; null → tanda pisah", () => {
    assert.equal(p.teksPersen(6.8), "6,80%");
    assert.equal(p.teksPersen(null), "—");
  });
  test("inisial dari handle", () => {
    assert.equal(p.inisial("@bellaclrs_"), "B");
    assert.equal(p.inisial("_9lala"), "9");
    assert.equal(p.inisial(""), "?");
  });
});

describe("ringkasAkun", () => {
  test("median views memakai posting ER — satu video viral tidak mengangkatnya", () => {
    const daftar = [
      posting("a", 60, 100_000),
      posting("b", 70, 120_000),
      posting("c", 80, 3_000_000),
      posting("d", 90, 90_000),
    ];
    const r = p.ringkasAkun(daftar, 1_000_000, SEKARANG);
    assert.equal(r.medianViews, 110_000);
    assert.equal(r.avgViews, 827_500);
    assert.equal(r.rasioViews, 82.8);
  });
  test("ER belum terhitung → median kosong; pengikut 0 → rasio kosong", () => {
    const r = p.ringkasAkun([posting("a", 60, 100)], 0, SEKARANG);
    assert.equal(r.medianViews, null);
    assert.equal(r.rasioViews, null);
  });
  test("video per minggu atas 28 hari terakhir; pin tidak dihitung", () => {
    const daftar = [
      ...Array.from({ length: 8 }, (_, i) => posting(`v${i}`, 24 * (i * 3 + 1), 10)),
      posting("tua", 24 * 40, 10),
      posting("pin", 24 * 2, 10, { disematkan: true }),
    ];
    const r = p.ringkasAkun(daftar, 10, SEKARANG);
    assert.equal(r.perMinggu, 2);
    assert.equal(r.hariDasar, 28);
  });
  test("daftar tertangkap lebih pendek dari 28 hari → dihitung atas rentang yang ada", () => {
    const daftar = Array.from({ length: 7 }, (_, i) => posting(`v${i}`, 24 * (i + 1), 10));
    const r = p.ringkasAkun(daftar, 10, SEKARANG);
    assert.equal(r.hariDasar, 7);
    assert.equal(r.perMinggu, 6);
  });
});

describe("ringkasPeriode", () => {
  const HARI = 24;
  test("jendela digeser 48 jam: video < 48 jam tidak dihitung di periode mana pun", () => {
    const daftar = [
      posting("muda", 20, 999_999),
      posting("k1", 3 * HARI, 100, { like: 10 }),
      posting("k2", 8 * HARI, 300, { like: 30 }),
      posting("l1", 10 * HARI, 50, { like: 1 }),
      posting("tua", 20 * HARI, 1),
    ];
    const r = p.ringkasPeriode(daftar, 7, SEKARANG);
    assert.equal(r.mudaDilewati, 1);
    assert.deepEqual([r.kini.video, r.kini.views, r.kini.rataViews, r.kini.er], [2, 400, 200, 10]);
    assert.deepEqual([r.lalu.video, r.lalu.views, r.lalu.er], [1, 50, 2]);
    assert.equal(r.lengkapKini, true);
    assert.equal(r.lengkapLalu, true);
  });
  test("daftar tidak mencakup jendela lalu → lengkapLalu false; pin tua tidak dianggap cakupan", () => {
    const daftar = [posting("pin", 300 * HARI, 5, { disematkan: true }), posting("k1", 3 * HARI, 100), posting("k2", 8 * HARI, 100)];
    const r = p.ringkasPeriode(daftar, 30, SEKARANG);
    assert.equal(r.lengkapKini, false);
    assert.equal(r.lengkapLalu, false);
  });
  test("seluruh video akun tertangkap → dianggap lengkap walau akunnya baru", () => {
    const daftar = [posting("k1", 3 * HARI, 100), posting("k2", 8 * HARI, 100)];
    const r = p.ringkasPeriode(daftar, 30, SEKARANG, { jumlahVideo: 2 });
    assert.equal(r.lengkapLalu, true);
    assert.equal(r.lalu.video, 0);
    assert.equal(r.lalu.er, null);
  });
  test("perubahan persen; pembanding 0 → null", () => {
    assert.equal(p.perubahanPersen(150, 100), 50);
    assert.equal(p.perubahanPersen(80, 120), -33.3);
    assert.equal(p.perubahanPersen(5, 0), null);
    assert.equal(p.perubahanPersen(null, 10), null);
  });
});

describe("harga", () => {
  test("perkiraan = median views × harga per 1.000 views, dibulatkan 50 rb", () => {
    assert.deepEqual(p.perkiraanHarga(267_000, 30_000, 60_000), { min: 8_000_000, maks: 16_000_000, tengah: 12_000_000 });
    assert.equal(p.perkiraanHarga(0, 30_000, 60_000), null);
    assert.equal(p.perkiraanHarga(1000, 60_000, 30_000), null);
  });
  test("harga diminta dinilai terhadap rentang", () => {
    assert.deepEqual(p.nilaiHargaDiminta(15_000_000, 200_000, 30_000, 60_000), { cpm: 75_000, nilai: "MAHAL" });
    assert.deepEqual(p.nilaiHargaDiminta(9_000_000, 200_000, 30_000, 60_000), { cpm: 45_000, nilai: "WAJAR" });
    assert.deepEqual(p.nilaiHargaDiminta(4_000_000, 200_000, 30_000, 60_000), { cpm: 20_000, nilai: "MURAH" });
    assert.equal(p.nilaiHargaDiminta(1, 0, 30_000, 60_000), null);
  });
  test("ketikan harga gaya Indonesia", () => {
    assert.equal(p.bacaRupiah("15jt"), 15_000_000);
    assert.equal(p.bacaRupiah("12,5 juta"), 12_500_000);
    assert.equal(p.bacaRupiah("Rp 15.000.000"), 15_000_000);
    assert.equal(p.bacaRupiah("800rb"), 800_000);
    assert.equal(p.bacaRupiah("800k"), 800_000);
    assert.equal(p.bacaRupiah("lima juta"), null);
    assert.equal(p.bacaRupiah("99999999999"), null);
  });
});
