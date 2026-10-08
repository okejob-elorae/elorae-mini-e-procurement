import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import id from "@/lib/i18n/messages/id.json";
import en from "@/lib/i18n/messages/en.json";
import { DAFTAR_ISI_SALESMAN } from "../salesman/daftar-isi";
import { DAFTAR_ISI_SPG, TAUTAN_TARGET_SPG } from "./daftar-isi";

const halaman = readFileSync(path.join(__dirname, "page.tsx"), "utf8");
const ambil = (pesan: unknown, kunci: string): unknown =>
  kunci.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), pesan);

describe("daftar isi Pengaturan → SPG", () => {
  const semua = DAFTAR_ISI_SPG.flatMap((g) => g.kartu);

  it("delapan kartu, jangkar unik", () => {
    expect(semua).toHaveLength(8);
    const ids = semua.map((k) => k.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("setiap jangkar dipasang di halaman, dalam urutan daftar isi", () => {
    const letak = semua.map((k) => {
      const i = halaman.indexOf(`id="${k.id}"`);
      expect(i, `jangkar #${k.id} tidak ada di page.tsx`).toBeGreaterThan(-1);
      return i;
    });
    expect([...letak].sort((a, b) => a - b)).toEqual(letak);
  });

  it("setiap kartu dirender sekali", () => {
    for (const kartu of ["DiskonManualCard", "TutupHariCard", "TitipPesanCard", "ShiftCard", "HariKerjaSpgCard", "KomisiPutusCard", "BarangHilangCard", "AturanMutasiCard"]) {
      expect(halaman.split(`<${kartu}`).length - 1, kartu).toBe(1);
    }
  });

  it("judul kelompok dan kartu punya teks di kedua bahasa, kelompok tampil sebagai judul di halaman", () => {
    for (const g of DAFTAR_ISI_SPG) {
      expect(halaman).toContain(`<JudulKelompok kunci="${g.judul}" />`);
      for (const kunci of [g.judul, ...g.kartu.map((k) => k.judul)]) {
        expect(typeof ambil(id, kunci), `id ${kunci}`).toBe("string");
        expect(typeof ambil(en, kunci), `en ${kunci}`).toBe("string");
      }
    }
    expect(typeof ambil(id, "settings.spg.toc.label")).toBe("string");
    expect(typeof ambil(id, "settings.spg.toc.targetLink")).toBe("string");
  });

  it("tautan target SPG menunjuk jangkar yang memang ada di Pengaturan → Salesman", () => {
    const [rute, jangkar] = TAUTAN_TARGET_SPG.split("#");
    expect(rute).toBe("/backoffice/settings/salesman");
    expect(DAFTAR_ISI_SALESMAN.flatMap((g) => g.kartu).map((k) => k.id)).toContain(jangkar);
  });

  it("tautan target hanya untuk yang bisa membuka Pengaturan → Salesman", () => {
    expect(halaman).toContain("<JudulPengaturanSpg bolehBukaTarget={hasPermission(izin, PERMISSIONS.FIELD_SALES_ORDERS_VIEW)} />");
    const judul = readFileSync(path.join(__dirname, "JudulPengaturanSpg.tsx"), "utf8");
    expect(judul).toMatch(/bolehBukaTarget \? \(\s*<Link href=\{TAUTAN_TARGET_SPG\}/);
  });
});
