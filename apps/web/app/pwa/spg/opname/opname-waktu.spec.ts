import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga: umur hitungan dan waktu antrean opname memakai SATU jam yang sama.
 *
 * Server menghitung "kapan barang ini dihitung" = waktu tangkap antrean −
 * umur hitungan. Dulu umur diambil saat tombol Simpan ditekan, tetapi waktu
 * antrean diambil lagi di `simpanDiHp` — sesudah kiriman daring kehabisan
 * waktu (`denganBatasWaktu`) dan jatuh ke antrean. Selisih jamnya menggeser
 * waktu hitung ke depan sebesar lama menunggu jawaban, sehingga barang yang
 * terjual di sela itu bisa dinilai "sudah ikut terhitung".
 *
 * Layar ini komponen klien tanpa tes DOM, jadi penjaganya membaca sumbernya.
 */

const sumber = readFileSync(join(__dirname, "OpnameClient.tsx"), "utf8");
const awal = sumber.indexOf("const simpan = () => {");
const akhir = sumber.indexOf("const varianLembar", awal);
const badan = sumber.slice(awal, akhir);

describe("OpnameClient simpan(): satu waktu untuk umur dan antrean", () => {
  it("badan simpan() ditemukan", () => {
    expect(awal).toBeGreaterThan(0);
    expect(akhir).toBeGreaterThan(awal);
    expect(badan).toContain("antreOpname(");
  });

  it("Date.now() diambil SEKALI di simpan()", () => {
    expect(badan.match(/Date\.now\(\)/g) ?? []).toHaveLength(1);
    // Jam kedua lewat jalan lain sama salahnya: `new Date()` / `performance.now()`.
    expect(badan).not.toMatch(/new\s+Date\s*\(|performance\.now\s*\(/);
  });

  it("umur hitungan dan waktu antrean memakai variabel jam yang sama", () => {
    const jam = /const\s+(\w+)\s*=\s*Date\.now\(\)/.exec(badan)?.[1];
    expect(jam).toBeTruthy();
    expect(badan).toMatch(new RegExp(`umurHitungMs\\(b\\.waktu,\\s*${jam}\\)`));
    expect(badan).toMatch(new RegExp(`waktu:\\s*${jam}\\b`));
  });
});
