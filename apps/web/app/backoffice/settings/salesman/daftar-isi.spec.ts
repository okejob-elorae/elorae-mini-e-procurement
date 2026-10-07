import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DAFTAR_ISI_SALESMAN } from "./daftar-isi";

const halaman = readFileSync(path.join(__dirname, "page.tsx"), "utf8");

describe("daftar isi Pengaturan → Salesman", () => {
  const semua = DAFTAR_ISI_SALESMAN.flatMap((g) => g.kartu);

  it("setiap jangkar unik", () => {
    const id = semua.map((k) => k.id);
    expect(new Set(id).size).toBe(id.length);
  });

  it("setiap jangkar benar-benar dipasang di halaman", () => {
    for (const k of semua) {
      expect(halaman, `jangkar #${k.id} tidak ada di page.tsx`).toContain(`id="${k.id}"`);
    }
  });

  it("kartu SPG tidak lagi di halaman salesman (pindah ke Pengaturan → SPG)", () => {
    expect(halaman).not.toContain("<HariKerjaSpgCard");
    expect(halaman).not.toContain("<AturanMutasiCard");
  });

  it("tautan ke Pengaturan → SPG hanya untuk yang bisa membukanya (spg_sales:view)", () => {
    expect(halaman).toContain("bolehBukaSpg={hasPermission(izin, PERMISSIONS.SPG_SALES_VIEW)}");
    const judul = readFileSync(path.join(__dirname, "PengaturanSalesmanClient.tsx"), "utf8");
    expect(judul).toMatch(/bolehBukaSpg \? \(\s*<div[^]*?href="\/backoffice\/settings\/spg"/);
  });

  it("15 kartu lama minus 2 kartu SPG = 13 kartu terdaftar", () => {
    expect(semua).toHaveLength(13);
  });
});
