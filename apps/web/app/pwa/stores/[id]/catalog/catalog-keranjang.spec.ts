import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga statis untuk sambungan katalog salesman ke `keranjang-katalog.ts`.
 *
 * Aturannya sendiri (jepit jumlah, isi per pack, simpanan + kunci kirim) dites
 * murni di `lib/field-sales/keranjang-katalog.test.ts`; yang tersisa adalah
 * komponennya, dan repo ini tidak punya pustaka render. Kalau layar kembali
 * membuat kunci per ketukan, memulihkan keranjang dokumen, atau stepper lama
 * (tanpa isian angka) kembali, semua tes murni tetap hijau.
 */

const DIR = path.resolve(__dirname);
const SHELL = readFileSync(path.join(DIR, "CatalogShell.tsx"), "utf8");
const SHEET = readFileSync(path.join(DIR, "VariantSheet.tsx"), "utf8");
const PAGE = readFileSync(path.join(DIR, "page.tsx"), "utf8");

/** Isi fungsi `function <nama>(...) { ... }` sampai kurung tutupnya. */
function badanFungsi(sumber: string, nama: string): string {
  const awal = sumber.indexOf(`function ${nama}(`);
  if (awal < 0) throw new Error(`fungsi tidak ditemukan: ${nama}`);
  const buka = sumber.indexOf("{", sumber.indexOf(")", awal));
  let dalam = 0;
  for (let i = buka; i < sumber.length; i++) {
    if (sumber[i] === "{") dalam++;
    else if (sumber[i] === "}" && --dalam === 0) return sumber.slice(buka, i + 1);
  }
  throw new Error(`fungsi tidak tertutup: ${nama}`);
}

describe("katalog salesman — kunci kirim per keranjang", () => {
  it("kirim memakai kunci keranjang yang tersimpan, bukan kunci baru per ketukan", () => {
    const kirim = badanFungsi(SHELL, "onSubmit");
    expect(kirim).toMatch(/const localId = \(kunciKirim\.current \?\?= newLocalId\(\)\);/);
    expect(kirim).not.toMatch(/const localId = newLocalId\(\)/);
    expect(kirim).toMatch(/idempotencyKey: localId/);
    expect(SHELL).not.toMatch(/crypto\.randomUUID/);
  });

  it("keranjang hanya dikosongkan lewat lepasKeranjang (simpanan dibuang + kunci baru), sesudah tercatat atau masuk antrean", () => {
    expect(SHELL.match(/setCart\(new Map\(\)\)/g) ?? []).toHaveLength(1);
    const lepas = badanFungsi(SHELL, "lepasKeranjang");
    expect(lepas).toMatch(/setCart\(new Map\(\)\)/);
    expect(lepas).toMatch(/tulisSimpananKatalog\(ambilSesi\(\), kunciSimpanan, null\)/);
    expect(lepas).toMatch(/kunciKirim\.current = null/);
    expect(badanFungsi(SHELL, "simpanKeAntrean")).toMatch(/lepasKeranjang\(\)/);
    expect(badanFungsi(SHELL, "onSubmit")).toMatch(/lepasKeranjang\(\)/);
  });
});

describe("katalog salesman — keranjang tersimpan", () => {
  it("keranjang dari dokumen (?ganti=, ?isi=) tidak dipulihkan dan tidak disimpan", () => {
    expect(PAGE).toMatch(/simpanKeranjang=\{rawGanti === undefined && rawIsi === undefined\}/);
    expect(SHELL).toMatch(/const kunciSimpanan = simpanKeranjang \? kunciSimpananKatalog\(userId, storeId, indenPesan\?\.id \?\? null\) : null;/);
  });

  it("keranjang dikosongkan sendiri = simpanan dibuang; isi yang sama tidak ditulis ulang (umur tidak diperpanjang)", () => {
    // lepasKeranjang + cabang keranjang kosong di efek penulis.
    expect(SHELL.match(/tulisSimpananKatalog\(ambilSesi\(\), kunciSimpanan, null\)/g) ?? []).toHaveLength(2);
    expect(SHELL).toMatch(/if \(isiSimpananSama\(bacaSimpananKatalog\(sesi, kunciSimpanan, sekarang\), baru\)\) return;\s+tulisSimpananKatalog\(sesi, kunciSimpanan, baru\);/);
  });

  it("pesanan terakhir (?ulang=) menang atas simpanan lama", () => {
    expect(SHELL).toMatch(/if \(!kunciSimpanan \|\| isiAwal\?\.length\) return;/);
  });

  it("dipulihkan dengan aturan stok sekarang dan memberi tahu salesman", () => {
    expect(SHELL).toMatch(/pulihkanKeranjangKatalog\(simpanan, items, isKonsi\)/);
    expect(SHELL).toMatch(/kunciKirim\.current = simpanan\.idempotencyKey;/);
    expect(SHELL).toMatch(/t\("keranjangDipulihkan"/);
  });
});

describe("katalog salesman — jumlah diketik dan per pack", () => {
  it("kartu barang, layar tinjau, dan lembar varian memakai satu QtyStepper (tanpa stepper sebaris lama)", () => {
    expect(SHELL.match(/<QtyStepper/g) ?? []).toHaveLength(2);
    expect(SHEET.match(/<QtyStepper/g) ?? []).toHaveLength(1);
    expect(SHELL).not.toMatch(/<Minus\b/);
    expect(SHEET).not.toMatch(/<Minus\b/);
  });

  it("QtyStepper menjalankan aturan murni: ketik dijepit + diberi tahu, 0 saat ditinggalkan, −/+ dari angka yang tampil", () => {
    const STEPPER = readFileSync(path.join(DIR, "QtyStepper.tsx"), "utf8");
    const ketik = badanFungsi(STEPPER, "ketik");
    expect(ketik).toMatch(/ketikJumlah\(teksBaru, max, value\)/);
    expect(ketik).toMatch(/if \(h\.dijepit\) onJepit\?\.\(/);
    expect(ketik).toMatch(/if \(h\.qty !== null\) onChange\(h\.qty\)/);
    expect(badanFungsi(STEPPER, "selesai")).toMatch(/selesaiJumlah\(draf, max, value\)/);
    const langkah = badanFungsi(STEPPER, "langkah");
    expect(langkah).toMatch(/langkahJumlah\(arah, draf, max, value\)/);
    expect(langkah).toMatch(/setIsian\(null\)/);
    // Ketikan gugur bila jumlah keranjang berubah dari luar (mis. "+1 pack") selagi isian fokus.
    expect(STEPPER).toMatch(/const draf = isian !== null && isian\.nilai === value \? isian\.teks : null;/);
    expect(STEPPER).toMatch(/onBlur=\{selesai\}/);
    expect(STEPPER).toMatch(/inputMode="numeric"/);
    // Setiap pemakai meneruskan batas tombol + dan pemberi tahu jepitan.
    for (const sumber of [SHELL, SHEET]) {
      for (const blok of sumber.split("<QtyStepper").slice(1)) {
        expect(blok.slice(0, blok.indexOf("/>"))).toMatch(/max=\{[^}]+\}[\s\S]*onJepit=\{/);
      }
    }
  });

  it("rasio pack dan ukuran varian dikirim server ke lembar varian", () => {
    expect(PAGE).toMatch(/const rasioPack = await getPackRatio\(\);/);
    expect(PAGE).toMatch(/const petaUkuran = await muatUkuranPack\(rasioPack\);/);
    expect(SHELL).toMatch(/rasioPack=\{rasioPack\}\s+petaUkuran=\{petaUkuran\}/);
    expect(SHEET).toMatch(/tambahSatuPack\(\{ rasio: rasioPack, varian: item\.variants, peta: petaUkuran, grup: g, jumlah \}\)/);
  });

  it("tanpa rasio pack, atau barang tanpa varian berukuran, tombol pack tidak tampil; hanya saat keranjang terbuka", () => {
    expect(SHEET).toMatch(/item && rasioPack\.length > 0 \? grupPack\(item\.variants, petaUkuran\) : \[\]/);
    expect(SHEET).toMatch(/\{hasActiveVisit && grup\.length > 0 && \(/);
    expect(SHEET.match(/tambahPack\(/g) ?? []).toHaveLength(2);
  });
});
