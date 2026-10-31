import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { KOLOM_BUKAN_FOTO_DB, KOLOM_FOTO } from "./pembersih";

/**
 * Jaring untuk kolom foto baru. Penyapu foto menghapus setiap foto yang tidak
 * ditunjuk kolom di `KOLOM_FOTO` — jadi kolom foto yang LUPA didaftarkan
 * berarti foto yang masih dipakai terhapus jam 03.10. Tes ini membaca skema
 * Prisma dan menuntut setiap kolom yang namanya mirip foto masuk salah satu
 * daftar. Sampai 2026-10-03 daftar itu hanya punya 4 dari 17 kolom.
 */

const SKEMA = path.resolve(__dirname, "../../../../packages/db/prisma/schema.postgres.prisma");
const POLA_NAMA = /(photo|foto|selfie|image|signature|struk|bukti)/i;

function kolomMiripFoto(): string[] {
  const hasil: string[] = [];
  let model: string | null = null;
  for (const baris of readFileSync(SKEMA, "utf8").split("\n")) {
    const m = /^model\s+(\w+)/.exec(baris);
    if (m) {
      model = m[1];
      continue;
    }
    if (/^\}/.test(baris)) {
      model = null;
      continue;
    }
    const f = /^\s+(\w+)\s+\S/.exec(baris);
    if (model && f && POLA_NAMA.test(f[1])) hasil.push(`${model}.${f[1]}`);
  }
  return hasil;
}

const terdaftar = new Set(KOLOM_FOTO.flatMap((k) => k.kolom.map((c) => `${k.model[0].toUpperCase()}${k.model.slice(1)}.${c}`)));

describe("daftar kolom foto penyapu", () => {
  it("mencakup setiap kolom skema yang namanya mirip foto", () => {
    const belum = kolomMiripFoto().filter((k) => !terdaftar.has(k) && !(k in KOLOM_BUKAN_FOTO_DB));
    expect(belum).toEqual([]);
  });

  it("hanya mendaftar kolom yang benar-benar ada di skema", () => {
    const skema = readFileSync(SKEMA, "utf8");
    for (const k of KOLOM_FOTO) {
      const model = `${k.model[0].toUpperCase()}${k.model.slice(1)}`;
      const blok = new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`).exec(skema)?.[1] ?? "";
      for (const kolom of k.kolom) expect(blok, `${model}.${kolom}`).toMatch(new RegExp(`\\n\\s+${kolom}\\s`));
    }
  });

  // Prisma menolak `not: null` pada kolom wajib — penyapu lalu melempar dan
  // dasbor pelunasan (pemakaianFoto) ikut gagal. Itu terjadi 2026-10-04 dengan
  // ItemImage.url; `wajib` di daftar harus sama dengan skemanya.
  it("menandai `wajib` tepat pada kolom yang di skema tidak boleh kosong", () => {
    const skema = readFileSync(SKEMA, "utf8");
    for (const k of KOLOM_FOTO) {
      if (k.json) continue;
      const model = `${k.model[0].toUpperCase()}${k.model.slice(1)}`;
      const blok = new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`).exec(skema)?.[1] ?? "";
      for (const kolom of k.kolom) {
        const tipe = new RegExp(`\\n\\s+${kolom}\\s+(\\S+)`).exec(blok)?.[1] ?? "";
        const bolehKosong = tipe.endsWith("?");
        expect(Boolean(k.wajib), `${model}.${kolom} (${tipe})`).toBe(!bolehKosong);
      }
    }
  });
});
