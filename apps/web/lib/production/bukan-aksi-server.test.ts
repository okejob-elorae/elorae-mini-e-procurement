import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Pustaka produksi BUKAN aksi server. Berkas ber-`"use server"` membuat setiap
 * ekspornya titik akhir yang bisa dipanggil siapa pun yang sudah masuk — dan
 * pustaka ini tidak memeriksa sesi atau izin sama sekali, karena pemagarnya
 * adalah pembungkus di `app/actions/*` (mis. `saveConsumptionRules` di
 * `app/actions/items.ts` menuntut `items:edit`). Dengan direktif itu, penulis
 * aturan konsumsi dan pembaca rencana bahan bisa dipanggil langsung, melewati
 * pembungkusnya. Pemanggilnya semua kode server, jadi direktif itu tidak perlu.
 */

const PUSTAKA = [
  "consumption.ts",
  "planning.ts",
  "reconciliation.ts",
  "biaya-penerimaan.ts",
  "biaya-penerimaan-queries.ts",
  "biaya-jasa.ts",
  "biaya-dasar-harga-jual.ts",
  "biaya-bahan-queries.ts",
  "fg-receipt-journal.ts",
  "fg-receipt-journal-aman.ts",
  "hutang-jasa-queries.ts",
  "sapuan.ts",
  "galat-produksi.ts",
  "kembali-bahan.ts",
  "kembali-bahan-writer.ts",
  "kembali-bahan-queries.ts",
  "terlambat.ts",
  "rekonsiliasi-tampil.ts",
];

/** Direktif hanya berlaku sebagai pernyataan pertama berkas (setelah komentar). */
function direktifPertama(sumber: string): string | null {
  let sisa = sumber;
  for (;;) {
    const lepas = sisa.replace(/^\s*(\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)/, "");
    if (lepas === sisa) break;
    sisa = lepas;
  }
  const m = sisa.match(/^\s*(["'])(use [a-z]+)\1/);
  return m ? m[2] : null;
}

describe("pustaka produksi bukan titik akhir aksi server", () => {
  it.each(PUSTAKA)("%s tidak ber-'use server'", (berkas) => {
    const sumber = readFileSync(path.join(__dirname, berkas), "utf8");
    expect(direktifPertama(sumber)).not.toBe("use server");
  });

  it("pemeriksa direktif benar-benar mengenali 'use server'", () => {
    expect(direktifPertama("'use server';\nexport async function a() {}")).toBe("use server");
    expect(direktifPertama('/* x */\n"use server";\n')).toBe("use server");
    expect(direktifPertama("// a\n// b\n/* c */\n'use server';")).toBe("use server");
    expect(direktifPertama("import x from 'y';\n'use server';")).toBeNull();
  });
});
