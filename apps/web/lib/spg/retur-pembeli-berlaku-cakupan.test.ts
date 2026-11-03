import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga: setiap pembaca `SpgSaleReturn` / `SpgSaleReturnLine` yang MENGHITUNG
 * retur pembeli lewat satu definisi "yang berlaku" (`./retur-pembeli-berlaku`).
 *
 * Sejak 2026-11-02 laporan retur pembeli menunggu persetujuan kantor dulu.
 * Sebelumnya setiap baris langsung berlaku, jadi semua pembaca lama menyaring
 * hanya toko + tanggal — pembaca baru yang ditulis dengan pola itu diam-diam
 * menghitung laporan yang masih menunggu, ditolak, atau ditarik, dan tidak ada
 * type-check atau tes murni yang menangkapnya. Tes ini yang menangkapnya.
 *
 * Aturan per pemanggilan baca (`findMany`/`findFirst`/`findUnique`/`groupBy`/
 * `count`/`aggregate`, termasuk varian `OrThrow`): argumennya menyebut
 * `returPembeliBerlaku`, `RETUR_PEMBELI_BERLAKU`, atau salah satu saringan
 * bernama yang sengaja membaca yang BELUM berlaku — `RETUR_PEMBELI_MENUNGGU`
 * (yang menunggu), `RETUR_PEMBELI_UANG_KEMBALI_BELUM_BERLAKU` (penjelas selisih
 * kasir di tutup hari), `RETUR_PEMBELI_DITAHAN_BEBAN` (potong yang ditahan
 * beban SPG); ATAU ia memilih `status` dan berkasnya
 * memeriksa `returPembeliSudahBerlaku(...)` di memori (penulis nota retur).
 * Layar yang memang menampilkan SEMUA status ada di `DIIZINKAN`, dengan alasannya.
 *
 * Juga ditolak: menyebarkan FUNGSI `returPembeliBerlaku` dari
 * `retur-pembeli-berlaku` (`{ ...returPembeliBerlaku }` menghasilkan objek
 * kosong tanpa galat). Yang boleh disebar adalah KONSTANTA bernama sama dari
 * `retur-pembeli`.
 *
 * Tidak dipindai: saringan relasi dari model lain (`SpgSale.returns`) — saat
 * ini tidak ada pembacanya; `SpgSaleLine.returnLines` dipindai di bawah.
 */

const AKAR = join(__dirname, "../..");
const FOLDER = ["lib", "app"];
const EKSTENSI = /\.(ts|tsx)$/;
const TES = /\.(test|spec)\.(ts|tsx)$/;

const DIIZINKAN: Record<string, string> = {
  "lib/spg/retur-pembeli.ts": "penulis laporan: kunci kiriman, status, dan riwayat semua laporan per nota",
  "lib/spg/retur-pembeli-queries.ts": "antrean kantor dan daftar laporan SPG — menampilkan setiap status",
  "app/pwa/api/upload/spg-sale-return-photo/route.ts": "membaca laporannya sendiri untuk mengikat foto bukti; tidak menghitung apa pun",
};

const BACA = /\.spgSaleReturn(?:Line)?\s*\.\s*(?:findMany|findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow|groupBy|count|aggregate)\s*\(/g;
const PENANDA =
  /\breturPembeliBerlaku\b|\bRETUR_PEMBELI_BERLAKU\b|\bRETUR_PEMBELI_MENUNGGU\b|\bRETUR_PEMBELI_UANG_KEMBALI_BELUM_BERLAKU\b|\bRETUR_PEMBELI_DITAHAN_BEBAN\b/;
const RELASI_BARIS_NOTA = /\breturnLines\s*:\s*\{/g;

function semuaBerkas(folder: string): string[] {
  const hasil: string[] = [];
  for (const entri of readdirSync(folder, { withFileTypes: true })) {
    if (entri.name === "node_modules" || entri.name.startsWith(".")) continue;
    const jalur = join(folder, entri.name);
    if (entri.isDirectory()) hasil.push(...semuaBerkas(jalur));
    else if (EKSTENSI.test(entri.name) && !TES.test(entri.name)) hasil.push(jalur);
  }
  return hasil;
}

/** Teks argumen pemanggilan yang tanda kurung bukanya ada di `buka`. */
function argumen(isi: string, buka: number): string {
  let dalam = 0;
  for (let i = buka; i < isi.length; i++) {
    if (isi[i] === "(") dalam++;
    else if (isi[i] === ")") {
      dalam--;
      if (dalam === 0) return isi.slice(buka + 1, i);
    }
  }
  return isi.slice(buka + 1);
}

const nomorBaris = (isi: string, indeks: number) => isi.slice(0, indeks).split("\n").length;

function pindai(): { baca: string[]; relasi: string[]; sebar: string[]; dipindai: number } {
  const baca: string[] = [];
  const relasi: string[] = [];
  const sebar: string[] = [];
  let dipindai = 0;
  for (const f of FOLDER) {
    for (const berkas of semuaBerkas(join(AKAR, f))) {
      const nama = relative(AKAR, berkas).split(sep).join("/");
      const isi = readFileSync(berkas, "utf8");
      const periksaMemori = /\breturPembeliSudahBerlaku\s*\(/.test(isi);

      if (!(nama in DIIZINKAN)) {
        for (const m of isi.matchAll(BACA)) {
          dipindai++;
          const arg = argumen(isi, (m.index ?? 0) + m[0].length - 1);
          const sah = PENANDA.test(arg) || (periksaMemori && /\bstatus\s*:\s*true\b/.test(arg));
          if (!sah) baca.push(`${nama}:${nomorBaris(isi, m.index ?? 0)}`);
        }
        for (const m of isi.matchAll(RELASI_BARIS_NOTA)) {
          // Saringan relasi: penandanya harus ada di blok yang sama (beberapa baris sesudahnya).
          const blok = isi.slice(m.index ?? 0, (m.index ?? 0) + 400);
          if (!PENANDA.test(blok)) relasi.push(`${nama}:${nomorBaris(isi, m.index ?? 0)}`);
        }
      }

      const impor = isi.match(/import\s*\{([^}]*)\}\s*from\s*["'][^"']*retur-pembeli-berlaku["']/);
      if (impor && /\breturPembeliBerlaku\b/.test(impor[1])) {
        for (const m of isi.matchAll(/\.\.\.\s*returPembeliBerlaku\b(?!\s*\()/g)) sebar.push(`${nama}:${nomorBaris(isi, m.index ?? 0)}`);
      }
    }
  }
  return { baca, relasi, sebar, dipindai };
}

describe("pembaca retur pembeli lewat returPembeliBerlaku", () => {
  const hasil = pindai();

  it("finds the readers it is meant to guard (the scan is not silently empty)", () => {
    // laku bersih, tutup hari, barang rusak dari pembeli, bahan laporan SPG, promo Elorae,
    // komisi, penulis nota retur — jauh lebih dari lima pemanggilan.
    expect(hasil.dipindai).toBeGreaterThan(5);
  });

  it("every counting read of SpgSaleReturn / SpgSaleReturnLine goes through the shared fragment", () => {
    expect(hasil.baca).toEqual([]);
  });

  it("a relation filter on SpgSaleLine.returnLines names the fragment too", () => {
    expect(hasil.relasi).toEqual([]);
  });

  it("nobody spreads the returPembeliBerlaku FUNCTION (that silently drops the status)", () => {
    expect(hasil.sebar).toEqual([]);
  });

  it("the allow-list only names files that exist", () => {
    for (const nama of Object.keys(DIIZINKAN)) expect(() => readFileSync(join(AKAR, nama), "utf8")).not.toThrow();
  });
});
