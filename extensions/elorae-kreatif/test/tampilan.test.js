import { describe, test } from "node:test";
import assert from "node:assert/strict";
import * as t from "../lib/tampilan.js";

describe("bersihkanTampilan", () => {
  test("kosong → bawaan", () => {
    assert.deepEqual(t.bersihkanTampilan(undefined), { ...t.TAMPILAN_BAWAAN });
  });
  test("nilai sah dipakai, rusak diganti bawaan; kunci lama (asumsi harga) dibuang", () => {
    const s = t.bersihkanTampilan({ tema: "gelap", aksen: "#FF00AA", ukuran: "x", posisi: "kiri", periode: "90", cpmMin: 30000 });
    assert.deepEqual(s, { tema: "gelap", aksen: "#ff00aa", ukuran: "lengkap", posisi: "kiri", periode: 90, rentang: null });
  });
  test("periode rentang sendiri disimpan bersama tanggalnya; tanggal rusak dibuang", () => {
    assert.deepEqual(t.bersihkanTampilan({ periode: "atur", rentang: { dari: "2026-09-01", sampai: "2026-09-30" } }), {
      ...t.TAMPILAN_BAWAAN,
      periode: "atur",
      rentang: { dari: "2026-09-01", sampai: "2026-09-30" },
    });
    assert.equal(t.bersihkanTampilan({ periode: "atur", rentang: { dari: "1/9", sampai: "2026-09-30" } }).rentang, null);
  });
  test("aksen dan periode tak dikenal → bawaan", () => {
    const s = t.bersihkanTampilan({ aksen: "ungu", periode: 14 });
    assert.equal(s.aksen, "lilac");
    assert.equal(s.periode, 30);
  });
});

describe("temaEfektif", () => {
  test("pilihan tetap menang", () => {
    assert.equal(t.temaEfektif("terang", "rgb(0, 0, 0)", true), "terang");
    assert.equal(t.temaEfektif("gelap", "rgb(255, 255, 255)", false), "gelap");
  });
  test("otomatis mengikuti latar halaman TikTok", () => {
    assert.equal(t.temaEfektif("otomatis", "rgb(18, 18, 18)", false), "gelap");
    assert.equal(t.temaEfektif("otomatis", "rgb(255, 255, 255)", true), "terang");
  });
  test("latar transparan/tak terbaca → ikut sistem", () => {
    assert.equal(t.temaEfektif("otomatis", "rgba(0, 0, 0, 0)", true), "gelap");
    assert.equal(t.temaEfektif("otomatis", "", false), "terang");
  });
});

describe("warnaAksen", () => {
  test("teks di atas aksen dipilih yang kontrasnya tertinggi", () => {
    assert.deepEqual(t.warnaAksen("lilac", "gelap"), { aksen: "#c9b8ff", teks: "#16121f" });
    assert.equal(t.warnaAksen("#1a237e", "gelap").teks, "#ffffff");
  });
  test("monokrom mengikuti tema", () => {
    assert.equal(t.warnaAksen("mono", "gelap").aksen, "#f5f3fb");
    assert.equal(t.warnaAksen("mono", "terang").aksen, "#17151d");
    assert.equal(t.warnaAksen("mono", "terang").teks, "#ffffff");
  });
  test("setiap pilihan siap pakai lolos kontras teks ≥ 4,5:1", () => {
    for (const k of Object.keys(t.AKSEN)) {
      for (const tema of ["terang", "gelap"]) {
        const { aksen, teks } = t.warnaAksen(k, tema);
        const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
        assert.ok(t.kontras(rgb(aksen), rgb(teks)) >= 4.5, `${k}/${tema}`);
      }
    }
  });
});

describe("PALET", () => {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  test("teks, teks redup, naik dan turun terbaca di atas latar dan kartu (≥ 4,5:1)", () => {
    for (const [tema, p] of Object.entries(t.PALET)) {
      for (const latar of [p.ink, p.kartu, p.kartu2]) {
        for (const k of ["teks", "redup", "naik", "turun"]) {
          assert.ok(t.kontras(rgb(p[k]), rgb(latar)) >= 4.5, `${tema}: ${k} di ${latar}`);
        }
      }
    }
  });
  test("variabelCss memuat aksen dan teks di atasnya", () => {
    const v = t.variabelCss("terang", "mint");
    assert.equal(v["--aksen"], "#7fe3b4");
    assert.equal(v["--ink"], "#ffffff");
    assert.equal(v["--aksen-teks"], "#16121f");
    assert.equal(v["--skema"], "light");
    assert.equal(t.variabelCss("gelap", "mint")["--skema"], "dark");
  });
});
