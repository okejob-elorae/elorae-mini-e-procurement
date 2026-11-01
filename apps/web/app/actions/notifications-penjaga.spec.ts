import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

/*
 * Pemicu notifikasi (kirim notifikasi ke semua pemegang izin dengan teks bebas,
 * jalankan pemeriksaan cron, `getActorName` yang membuka nama + email pengguna
 * mana pun dari id-nya) dulu tinggal di app/actions/notifications.ts yang
 * ber-'use server': setiap ekspornya menjadi titik panggil publik TANPA sesi.
 * Pemanggilnya semua kode server — aksi lain, rute API, dan cron (cron tidak
 * punya sesi, jadi pemeriksaan sesi per ekspor akan mematikannya). Kini
 * semuanya di lib/notifications/, yang BUKAN modul aksi server, jadi tidak satu
 * pun ekspornya bisa dipanggil dari peramban:
 *  - events.ts: pemicu per peristiwa dan pemeriksaan cron;
 *  - actor-name.ts: `getActorName`;
 *  - recipients.ts: `getUsersWithPermission` dan `sendNotificationToUsers`,
 *    yang menerima penerima dan teks apa pun.
 *
 * Penjaga ini menolak 'use server' di ketiganya, dan menolak komponen klien
 * yang mengimpor salah satunya (itu akan menyeret Prisma dan firebase-admin ke
 * peramban).
 */

const AKAR = join(__dirname, "..", "..");
const DIR_NOTIFIKASI = join(AKAR, "lib", "notifications");
const BERKAS = ["events", "actor-name", "recipients"] as const;

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

let sumber: Array<{ p: string; isi: string }> | null = null;
function semuaSumber(): Array<{ p: string; isi: string }> {
  sumber ??= ["app", "components", "hooks", "lib"]
    .flatMap((d) => semuaBerkas(join(AKAR, d)))
    .map((p) => ({ p, isi: readFileSync(p, "utf8") }));
  return sumber;
}

/** Impor lewat alias dari mana pun, atau relatif `./<nama>` dari dalam lib/notifications. */
function mengimpor(p: string, isi: string, nama: string): boolean {
  if (new RegExp(`from\\s+["']@/lib/notifications/${nama}["']`).test(isi)) return true;
  return dirname(p) === DIR_NOTIFIKASI && new RegExp(`from\\s+["']\\./${nama}["']`).test(isi);
}

describe.each(BERKAS)("lib/notifications/%s.ts bukan titik panggil publik", (nama) => {
  it("tidak ber-'use server'", () => {
    expect(arahan(readFileSync(join(DIR_NOTIFIKASI, `${nama}.ts`), "utf8"))).toBeNull();
  });

  it("tidak diimpor komponen klien mana pun", () => {
    const pengimpor = semuaSumber().filter(({ p, isi }) => mengimpor(p, isi, nama));
    expect(pengimpor.length).toBeGreaterThan(0);
    const klien = pengimpor.filter(({ isi }) => arahan(isi) === "client").map(({ p }) => relative(AKAR, p));
    expect(klien).toEqual([]);
  });
});

describe("pembantu penjaga", () => {
  it("pembaca arahan mengenali kedua bentuk kutip dan komentar di atasnya", () => {
    expect(arahan("'use server';\nexport const a = 1;")).toBe("server");
    expect(arahan('// catatan\n/* blok */\n"use client";\n')).toBe("client");
    expect(arahan("import x from 'y';\n'use server';")).toBeNull();
  });

  it("impor relatif hanya dihitung dari dalam lib/notifications", () => {
    const isi = 'import { getActorName } from "./actor-name";';
    expect(mengimpor(join(DIR_NOTIFIKASI, "x.ts"), isi, "actor-name")).toBe(true);
    expect(mengimpor(join(AKAR, "app", "x.ts"), isi, "actor-name")).toBe(false);
    expect(mengimpor(join(AKAR, "app", "x.ts"), "import { a } from '@/lib/notifications/recipients';", "recipients")).toBe(true);
  });
});
