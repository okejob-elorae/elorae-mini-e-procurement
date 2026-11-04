import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Penjaga: tidak ada berkas di `lib/` yang ber-`"use server"`.
 *
 * Arahan itu menjadikan SETIAP ekspor berkasnya server action — titik akhir
 * yang bisa dipanggil siapa pun yang sudah masuk, dengan argumen apa pun.
 * `lib/` adalah pustaka: fungsinya dipanggil kode server yang sudah memeriksa
 * izin, dan sebagian menulis (mis. `calculateMovingAverage` menulis
 * `InventoryValue`). Aksi yang memang boleh dipanggil klien tinggal di
 * `app/actions/`, berpenjaga sendiri.
 *
 * Arahan di tingkat fungsi (baris `"use server"` di dalam badan fungsi) juga
 * membuat aksi, jadi ikut ditolak.
 */

const AKAR_LIB = path.resolve(__dirname);
const POLA_ARAHAN = /^\s*["']use server["'];?\s*$/m;

function berkasSumber(dir: string): string[] {
  const hasil: string[] = [];
  for (const nama of readdirSync(dir)) {
    if (nama === "node_modules") continue;
    const penuh = path.join(dir, nama);
    if (statSync(penuh).isDirectory()) {
      hasil.push(...berkasSumber(penuh));
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(nama) && !/\.(test|spec)\.[tj]sx?$/.test(nama)) {
      hasil.push(penuh);
    }
  }
  return hasil;
}

describe("lib/ tanpa \"use server\"", () => {
  it("pola arahan mengenali kedua bentuk kutip dan arahan di dalam fungsi", () => {
    expect(POLA_ARAHAN.test(`"use server";\nexport const a = 1;`)).toBe(true);
    expect(POLA_ARAHAN.test(`'use server'\n`)).toBe(true);
    expect(POLA_ARAHAN.test(`export async function f() {\n  "use server";\n}`)).toBe(true);
    expect(POLA_ARAHAN.test(`// jangan pakai "use server" di sini\nexport const a = 1;`)).toBe(false);
  });

  it("tidak ada berkas pustaka yang menjadi titik akhir server action", () => {
    const pelanggar = berkasSumber(AKAR_LIB)
      .filter((f) => POLA_ARAHAN.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(path.resolve(AKAR_LIB, ".."), f));
    expect(pelanggar).toEqual([]);
  });
});
