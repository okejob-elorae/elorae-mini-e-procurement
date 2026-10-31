import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { BALANCE_SHEET_COVERAGE_BODY, CAKUPAN_LAPORAN_BODY, SUMBER_BELUM_BERJURNAL } from "./cakupan-laporan";

describe("cakupan data Neraca dan laporan lanjutan", () => {
  it("menyebut setiap sumber yang belum berjurnal, dari daftar yang sama dengan Laba Rugi", () => {
    for (const sumber of SUMBER_BELUM_BERJURNAL) {
      expect(BALANCE_SHEET_COVERAGE_BODY).toContain(sumber);
      expect(CAKUPAN_LAPORAN_BODY).toContain(sumber);
    }
  });

  it("tidak meninggalkan kalimat kosong", () => {
    expect(BALANCE_SHEET_COVERAGE_BODY).not.toContain("termasuk: .");
    expect(CAKUPAN_LAPORAN_BODY).not.toContain("termasuk: .");
  });
});

/*
 * `disclosures.ts` membaca seluruh `id.json`; komponen klien yang mengimpornya
 * menyeret katalog itu ke bundel peramban. Klien mengambil teks cakupan dari
 * `cakupan-laporan.ts`, dan teks lain lewat `notes` di payload laporannya.
 */
describe("teks laporan di komponen klien", () => {
  const AKAR = join(__dirname, "..", "..", "..");

  function semuaBerkas(dir: string, out: string[] = []): string[] {
    for (const nama of readdirSync(dir)) {
      if (nama === "node_modules" || nama.startsWith(".")) continue;
      const p = join(dir, nama);
      if (statSync(p).isDirectory()) semuaBerkas(p, out);
      else if (/\.tsx?$/.test(nama)) out.push(p);
    }
    return out;
  }

  function klien(isi: string): boolean {
    const tanpaKomentar = isi.replace(/^(\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*/, "");
    return /^["']use client["']/.test(tanpaKomentar);
  }

  it("cakupan-laporan.ts tidak mengimpor apa pun", () => {
    expect(readFileSync(join(__dirname, "cakupan-laporan.ts"), "utf8")).not.toMatch(/^\s*import\s/m);
  });

  it("tidak ada komponen klien yang mengimpor disclosures.ts", () => {
    const pelanggar = ["app", "components", "lib"]
      .flatMap((d) => semuaBerkas(join(AKAR, d)))
      .filter((p) => {
        const isi = readFileSync(p, "utf8");
        return klien(isi) && /import\s+(?!type\b)[^;]*from\s+["']@\/lib\/finance\/reports\/disclosures["']/.test(isi);
      })
      .map((p) => relative(AKAR, p));
    expect(pelanggar).toEqual([]);
  });
});
