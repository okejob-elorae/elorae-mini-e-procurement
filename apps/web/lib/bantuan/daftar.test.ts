import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DAFTAR_BANTUAN } from "./daftar";
import { BAGIAN_HP, BAGIAN_KANTOR, sebagaiDaftar, untukHp, type Teks } from "./jenis";

/**
 * Jaring daftar Bantuan. Penjelasan yang menunjuk halaman yang sudah
 * dipindah, atau kunci i18n yang sudah dihapus, tidak gagal dengan berisik —
 * panelnya cuma menampilkan nama kunci. Tes ini yang berisik.
 */

const APP = path.resolve(__dirname, "../../app");
const pesan = {
  id: JSON.parse(readFileSync(path.resolve(__dirname, "../i18n/messages/id.json"), "utf8")),
  en: JSON.parse(readFileSync(path.resolve(__dirname, "../i18n/messages/en.json"), "utf8")),
};

function ambil(obj: unknown, kunci: string): unknown {
  return kunci.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

function semuaTeks(): { rute: string; teks: Teks }[] {
  return DAFTAR_BANTUAN.flatMap((e) => [
    { rute: e.rute, teks: e.judul },
    ...sebagaiDaftar(e.isi).map((teks) => ({ rute: e.rute, teks })),
    ...(e.kartu ?? []).flatMap((k) => [k.judul, ...sebagaiDaftar(k.isi)].map((teks) => ({ rute: e.rute, teks }))),
  ]);
}

describe("daftar Bantuan", () => {
  it("tidak punya dua entri untuk rute yang sama", () => {
    const rute = DAFTAR_BANTUAN.map((e) => e.rute);
    expect(rute.filter((r, i) => rute.indexOf(r) !== i)).toEqual([]);
  });

  it("setiap rute adalah halaman yang benar-benar ada", () => {
    const hilang = DAFTAR_BANTUAN.map((e) => e.rute).filter((r) => !existsSync(path.join(APP, r, "page.tsx")));
    expect(hilang).toEqual([]);
  });

  it("rute HP ada di kelompok HP, rute kantor di kelompok kantor", () => {
    const salah = DAFTAR_BANTUAN.filter((e) =>
      untukHp(e) ? !(BAGIAN_HP as readonly string[]).includes(e.bagian) : !(BAGIAN_KANTOR as readonly string[]).includes(e.bagian),
    ).map((e) => e.rute);
    expect(salah).toEqual([]);
  });

  it("setiap kunci i18n ada di kedua bahasa dan tidak butuh nilai sisipan", () => {
    const masalah: string[] = [];
    for (const { rute, teks } of semuaTeks()) {
      if (typeof teks === "string") continue;
      for (const [bahasa, isi] of Object.entries(pesan)) {
        const nilai = ambil(isi, teks.kunci);
        if (typeof nilai !== "string") masalah.push(`${rute}: ${teks.kunci} tidak ada di ${bahasa}`);
        else if (/\{[^}]*\}/.test(nilai)) masalah.push(`${rute}: ${teks.kunci} memakai {sisipan} (${bahasa})`);
      }
    }
    expect(masalah).toEqual([]);
  });

  it("teks biasa tidak kosong", () => {
    const kosong = semuaTeks().filter(({ teks }) => typeof teks === "string" && teks.trim() === "").map((x) => x.rute);
    expect(kosong).toEqual([]);
  });
});
