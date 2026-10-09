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
