import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga statis untuk sambungan layar jual van ke `keranjang.ts`.
 *
 * Aturan kunci kirimnya sendiri dites murni di `keranjang.spec.ts` dan terhadap
 * basis data di `lib/canvassing/sale-writer.kirim-ulang.test.ts`; yang tersisa
 * adalah komponennya (tanpa pustaka render di repo ini). Kalau layar kembali
 * memanggil aksi langsung, membuat kunci dengan `crypto.randomUUID`, atau
 * mengganti kunci setelah sinyal putus, penjualan bisa tercatat dua kali — dan
 * semua tes murni tetap hijau.
 */

const VAN = path.resolve(__dirname);
const SHELL = readFileSync(path.join(VAN, "VanSellShell.tsx"), "utf8");

/** Isi cabang `if (<kondisi>) { ... }` sampai kurung tutupnya. */
function cabang(sumber: string, kondisi: string): string {
  const awal = sumber.indexOf(kondisi);
  if (awal < 0) throw new Error(`cabang tidak ditemukan: ${kondisi}`);
  const buka = sumber.indexOf("{", awal);
  let dalam = 0;
  for (let i = buka; i < sumber.length; i++) {
    if (sumber[i] === "{") dalam++;
    else if (sumber[i] === "}" && --dalam === 0) return sumber.slice(buka, i + 1);
  }
  throw new Error(`cabang tidak tertutup: ${kondisi}`);
}

function berkasSumber(dir: string): string[] {
  const hasil: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) hasil.push(...berkasSumber(p));
    else if (/\.tsx?$/.test(e.name) && !/\.(spec|test)\.tsx?$/.test(e.name)) hasil.push(p);
  }
  return hasil;
}

describe("layar jual van — kunci kirim", () => {
  it("tidak ada crypto.randomUUID di layar van (tidak ada di http LAN); kunci dari newLocalId", () => {
    for (const berkas of berkasSumber(VAN)) {
      expect(readFileSync(berkas, "utf8"), path.relative(VAN, berkas)).not.toMatch(/crypto\.randomUUID/);
    }
    expect(SHELL).toMatch(/import \{ newLocalId \} from "@\/lib\/pwa\/id-lokal";/);
    expect(SHELL).toMatch(/useState\(\(\) => newLocalId\(\)\)/);
  });

  it("aksi server hanya dipanggil lewat kirimPenjualanVan (simpan kunci dulu, hapus hanya setelah tercatat)", () => {
    const panggilan = SHELL.match(/recordVanSaleAction\(/g) ?? [];
    expect(panggilan).toHaveLength(1);
    const kirim = SHELL.indexOf("kirimPenjualanVan({");
    expect(kirim).toBeGreaterThan(-1);
    const aksi = SHELL.indexOf("recordVanSaleAction(");
    // Panggilannya berada di dalam argumen kirimPenjualanVan({ ... kirim: (kunci) => recordVanSaleAction(...) }).
    expect(aksi).toBeGreaterThan(kirim);
    expect(SHELL.slice(kirim, aksi)).toMatch(/kirim: \(kunci\) =>\s*$/);
    expect(SHELL.slice(aksi, aksi + 300)).toMatch(/idempotencyKey: kunci/);
  });

  it("sinyal putus mempertahankan keranjang dan kuncinya", () => {
    const putus = cabang(SHELL, 'if (hasil.jenis === "terputus")');
    expect(putus).not.toMatch(/setIdempotencyKey|setCart|newLocalId|tulisSimpananKeranjangVan/);
  });

  it("penolakan server juga mempertahankan kunci; kunci baru hanya setelah tercatat atau keranjang dikosongkan", () => {
    const tercatat = cabang(SHELL, 'if (hasil.jenis === "tercatat")');
    expect(tercatat).toMatch(/setIdempotencyKey\(newLocalId\(\)\)/);
    // Di luar cabang tercatat, pergantian kunci hanya lewat kunciSesudahUbah (keranjang dikosongkan) dan pemulihan.
    const tanpaTercatat = SHELL.replace(tercatat, "");
    const ganti = tanpaTercatat.match(/setIdempotencyKey\([^)]*\)/g) ?? [];
    expect(ganti.sort()).toEqual(["setIdempotencyKey(kunci)", "setIdempotencyKey(p.idempotencyKey)"]);
    expect(tanpaTercatat).toMatch(/kunciSesudahUbah\(cart\.size, next\.size, idempotencyKey, newLocalId\)/);
  });

  it("keranjang dipulihkan dari dan disimpan ke sessionStorage per pengguna", () => {
    expect(SHELL).toMatch(/pulihkanKeranjangVan\(bacaSimpananKeranjangVan\(sesi\(\), userId\)/);
    expect(SHELL).toMatch(/tulisSimpananKeranjangVan\(\s*sesi\(\),\s*userId,/);
    expect(SHELL).toMatch(/window\.sessionStorage/);
  });
});
