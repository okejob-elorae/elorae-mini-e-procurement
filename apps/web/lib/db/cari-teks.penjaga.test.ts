import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga: opsi abai-huruf Prisma HANYA boleh ditulis di lib/db/cari-teks.ts.
 *
 * Produksi memakai MariaDB, dan klien Prisma yang dibangkitkan dari
 * schema.prisma (mysql) tidak punya field `mode` — satu saja yang tertulis
 * langsung di kueri membuat build Docker gagal type-check, atau pencarian
 * melempar "Unknown argument" saat jalan. Di PostgreSQL lokal keduanya tidak
 * terlihat, jadi yang menjaga hanya tes ini. Pakai `cariTeks` / `samaTeks`.
 */

const AKAR = join(__dirname, "../..");
// Seluruh apps/web: tsconfig meng-include **/*.ts, jadi scripts/, hooks/, types/
// dan berkas di akar ikut type-check `next build`. Yang dilewati hanya folder
// akar berisi hasil bangkitan / pihak ketiga, node_modules, dan folder bertitik.
const DILEWATI_DI_AKAR = new Set(["public", "tessdata"]);
const DIIZINKAN = new Set(["lib/db/cari-teks.ts"]);
const EKSTENSI = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

// Pola dirakit agar sumber tes ini sendiri tidak cocok dengan polanya.
const POLA = [/mode\s*:\s*["'`]insensitive["'`]/, /QueryMode\s*\.\s*insensitive/, /QueryMode\s*\[\s*["'`]insensitive/];

function semuaBerkas(folder: string): string[] {
  const hasil: string[] = [];
  for (const entri of readdirSync(folder, { withFileTypes: true })) {
    if (entri.name === "node_modules" || entri.name.startsWith(".")) continue;
    if (folder === AKAR && DILEWATI_DI_AKAR.has(entri.name)) continue;
    const jalur = join(folder, entri.name);
    if (entri.isDirectory()) hasil.push(...semuaBerkas(jalur));
    else if (EKSTENSI.test(entri.name)) hasil.push(jalur);
  }
  return hasil;
}

/** Jalur relatif terhadap apps/web, dipisah "/". */
function berkasDipindai(): string[] {
  return semuaBerkas(AKAR).map((b) => relative(AKAR, b).split(sep).join("/"));
}

function pelanggaran(): string[] {
  const temuan: string[] = [];
  for (const nama of berkasDipindai()) {
    if (DIIZINKAN.has(nama)) continue;
    const isi = readFileSync(join(AKAR, nama), "utf8");
    if (!POLA.some((p) => p.test(isi))) continue;
    const baris = isi.split("\n").flatMap((b, i) => (POLA.some((p) => p.test(b)) ? [`${nama}:${i + 1}`] : []));
    // Pola yang terbelah ke beberapa baris tetap dilaporkan, minimal per berkas.
    temuan.push(...(baris.length > 0 ? baris : [nama]));
  }
  return temuan;
}

describe("pencarian abai-huruf hanya lewat lib/db/cari-teks.ts", () => {
  it("tidak ada opsi abai-huruf Prisma yang ditulis langsung di mana pun di apps/web", () => {
    expect(pelanggaran()).toEqual([]);
  });

  it("penjaganya sendiri benar-benar menangkap pola itu (bukan lulus karena memindai nol berkas)", () => {
    expect(semuaBerkas(join(AKAR, "lib")).length).toBeGreaterThan(100);
    const contoh = ["{ contains: q, mode: ", '"insensitive" }'].join("");
    const contohTunggal = ["mode:", "'insensitive'"].join("");
    const contohMultiBaris = ["mode:\n", '  "insensitive"'].join("");
    const contohEnum = ["Prisma.QueryMode", ".insensitive"].join("");
    for (const c of [contoh, contohTunggal, contohMultiBaris, contohEnum]) {
      expect(POLA.some((p) => p.test(c)), c).toBe(true);
    }
    expect(readFileSync(join(AKAR, "lib", "db", "cari-teks.ts"), "utf8")).toMatch(POLA[0]);
  });

  it("memindai SEMUA sumber yang ikut type-check build (tsconfig: **/*.ts), bukan hanya app/lib/components", () => {
    // `next build` memeriksa tipe seluruh include tsconfig — satu opsi abai-huruf
    // di scripts/ atau hooks/ juga mematahkan build MariaDB.
    const dipindai = new Set(berkasDipindai());
    for (const wajib of ["proxy.ts", "instrumentation.ts", "hooks/use-barcode-wedge-scanner.ts", "scripts/verify-hpp.ts", "types/audit.ts"]) {
      expect(dipindai.has(wajib), wajib).toBe(true);
    }
    for (const nama of dipindai) {
      expect(nama.startsWith("node_modules/") || nama.startsWith(".next/") || nama.startsWith("public/"), nama).toBe(false);
    }
  });
});
