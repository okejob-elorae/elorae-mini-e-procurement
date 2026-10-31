import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/*
 * app/actions/notifications.ts dulu ber-'use server': ke-20 ekspornya (kirim
 * notifikasi ke semua pemegang izin dengan teks bebas, jalankan pemeriksaan
 * cron, `getActorName` yang membuka nama + email pengguna mana pun dari id-nya)
 * menjadi titik panggil publik TANPA sesi. Pemanggilnya semua kode server —
 * aksi lain, rute API, dan cron (cron tidak punya sesi, jadi pemeriksaan sesi
 * per ekspor akan mematikannya). Perbaikannya: berkas ini BUKAN modul aksi
 * server, jadi tidak satu pun ekspornya bisa dipanggil dari peramban.
 *
 * Penjaga ini menolak 'use server' kembali, dan menolak komponen klien yang
 * mengimpornya (itu akan menyeret Prisma dan firebase-admin ke peramban).
 */

const AKAR = join(__dirname, "..", "..");
const BERKAS = join(__dirname, "notifications.ts");

function arahan(isi: string): string | null {
  // Arahan hanya sah sebagai pernyataan pertama (sesudah komentar/baris kosong).
  const tanpaKomentar = isi.replace(/^(\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*/, "");
  const m = tanpaKomentar.match(/^["']use (server|client)["']/);
  return m ? m[1] : null;
}

function semuaBerkas(dir: string, out: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    if (nama === "node_modules" || nama.startsWith(".")) continue;
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) semuaBerkas(p, out);
    else if (/\.(ts|tsx)$/.test(nama)) out.push(p);
  }
  return out;
}

describe("app/actions/notifications.ts bukan titik panggil publik", () => {
  it("tidak ber-'use server'", () => {
    expect(arahan(readFileSync(BERKAS, "utf8"))).toBeNull();
  });

  it("tidak diimpor komponen klien mana pun", () => {
    const pengimpor = ["app", "components", "hooks", "lib"]
      .flatMap((d) => semuaBerkas(join(AKAR, d)))
      .filter((p) => /from\s+["']@\/app\/actions\/notifications["']/.test(readFileSync(p, "utf8")));
    expect(pengimpor.length).toBeGreaterThan(0);
    const klien = pengimpor.filter((p) => arahan(readFileSync(p, "utf8")) === "client").map((p) => relative(AKAR, p));
    expect(klien).toEqual([]);
  });

  it("pembaca arahan mengenali kedua bentuk kutip dan komentar di atasnya", () => {
    expect(arahan("'use server';\nexport const a = 1;")).toBe("server");
    expect(arahan('// catatan\n/* blok */\n"use client";\n')).toBe("client");
    expect(arahan("import x from 'y';\n'use server';")).toBeNull();
  });
});
