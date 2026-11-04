import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AMBANG_BAWAAN } from "./ambang";
import { SEMUA_JENIS_AGENDA, SEMUA_JENIS_KERJA_SAMA, SEMUA_STATUS_BAYAR, SEMUA_STATUS_DRAF, SEMUA_TAHAP, LABEL_TAHAP } from "./tahap";
import { JUDUL_TUGAS, URUTAN_TUGAS } from "./tugas";

/**
 * Teks buatan mesin (rekap, cetak) memakai label di kode; layar memakai i18n.
 * Keduanya harus sama persis dalam bahasa Indonesia, dan setiap nilai enum
 * harus punya label di kedua bahasa — kalau tidak, layar menampilkan nama
 * kuncinya.
 */

const baca = (b: string) =>
  JSON.parse(readFileSync(path.resolve(__dirname, `../i18n/messages/${b}.json`), "utf8")).kreatifRuang as Record<
    string,
    Record<string, string>
  >;
const id = baca("id");
const en = baca("en");

describe("label Ruang KOL", () => {
  it("label tahap di kode sama dengan i18n bahasa Indonesia", () => {
    for (const t of SEMUA_TAHAP) {
      expect(id.tahap[t]).toBe(LABEL_TAHAP[t]);
      expect(en.tahap[t]).toBeTruthy();
    }
  });

  it("judul tugas di kode sama dengan i18n bahasa Indonesia, dan setiap tugas punya saran", () => {
    for (const k of URUTAN_TUGAS) {
      expect(id.tugas[k]).toBe(JUDUL_TUGAS[k]);
      expect(en.tugas[k]).toBeTruthy();
      expect(id.tugasSaran[k]).toBeTruthy();
      expect(en.tugasSaran[k]).toBeTruthy();
    }
  });

  it("setiap nilai enum dan setiap ambang berlabel di kedua bahasa", () => {
    const pasangan: [string, readonly string[]][] = [
      ["jenis", SEMUA_JENIS_KERJA_SAMA],
      ["bayar", SEMUA_STATUS_BAYAR],
      ["draf", SEMUA_STATUS_DRAF],
      ["agenda", SEMUA_JENIS_AGENDA],
      ["ambang", Object.keys(AMBANG_BAWAAN)],
    ];
    for (const [ns, kunci] of pasangan) {
      for (const k of kunci) {
        expect(id[ns][k], `id.${ns}.${k}`).toBeTruthy();
        expect(en[ns][k], `en.${ns}.${k}`).toBeTruthy();
      }
    }
  });
});
