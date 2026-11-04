import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Setiap layar HP memasang ⓘ di samping judulnya. Penjelasan layar tidak lagi
 * tertulis di layar (keputusan pemilik 2026-10-05), jadi layar tanpa ⓘ adalah
 * layar yang penjelasannya tidak bisa dibuka dari mana pun selain halaman
 * Bantuan.
 *
 * Pemeriksaan statis: dari `page.tsx` ikuti impor ke berkas lain di `app/`,
 * dan cari `<TombolBantuanHp`, `<TombolBantuan`, atau `<PageHeader` (yang
 * memasang ⓘ sendiri).
 */

const WEB = path.resolve(__dirname, "../..");
const PWA = path.join(WEB, "app/pwa");

/** Layar yang sengaja tanpa ⓘ, dengan alasannya. */
const DIKECUALIKAN: Record<string, string> = {
  "/pwa/offline": "pemberitahuan sedang tidak ada sinyal, tanpa entri Bantuan",
  "/pwa/bantuan": "halaman Bantuan itu sendiri",
};

const PENANDA = /<(TombolBantuanHp|TombolBantuan|PageHeader)\b/;

function halaman(dir: string, rute: string): { rute: string; berkas: string }[] {
  const hasil: { rute: string; berkas: string }[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) hasil.push(...halaman(path.join(dir, e.name), `${rute}/${e.name}`));
    else if (e.name === "page.tsx") hasil.push({ rute, berkas: path.join(dir, e.name) });
  }
  return hasil;
}

function selesaikan(dari: string, spes: string): string | null {
  let dasar: string;
  if (spes.startsWith("@/app/")) dasar = path.join(WEB, spes.slice(2));
  else if (spes.startsWith(".")) dasar = path.resolve(path.dirname(dari), spes);
  else return null;
  for (const akhiran of [".tsx", ".ts", "/index.tsx", "/index.ts"]) {
    if (existsSync(dasar + akhiran)) return dasar + akhiran;
  }
  return null;
}

/** Pembungkusnya sendiri tidak dihitung: yang dicari adalah layar yang MEMAKAINYA. */
const PEMBUNGKUS = path.join(PWA, "TombolBantuanHp.tsx");

function punyaTombol(berkas: string, dilihat = new Set<string>()): boolean {
  if (berkas === PEMBUNGKUS || dilihat.has(berkas)) return false;
  dilihat.add(berkas);
  const isi = readFileSync(berkas, "utf8");
  if (PENANDA.test(isi)) return true;
  for (const m of isi.matchAll(/from\s+["']([^"']+)["']/g)) {
    const tujuan = selesaikan(berkas, m[1]);
    if (tujuan && punyaTombol(tujuan, dilihat)) return true;
  }
  return false;
}

describe("ⓘ di setiap layar HP", () => {
  const semua = halaman(PWA, "/pwa");

  it("setiap layar HP sampai ke tombol ⓘ", () => {
    const tanpa = semua.filter((h) => !(h.rute in DIKECUALIKAN) && !punyaTombol(h.berkas)).map((h) => h.rute);
    expect(tanpa).toEqual([]);
  });

  it("pengecualian hanya berisi layar yang masih ada dan memang tanpa ⓘ", () => {
    for (const r of Object.keys(DIKECUALIKAN)) {
      const h = semua.find((x) => x.rute === r);
      expect(h, r).toBeDefined();
      expect(punyaTombol(h!.berkas), r).toBe(false);
    }
  });

  it("ⓘ HP membuka panel dari bawah dan menaut ke Bantuan HP", () => {
    const isi = readFileSync(path.join(PWA, "TombolBantuanHp.tsx"), "utf8");
    expect(isi).toContain('sisi="bottom"');
    expect(isi).toContain('semuaHref="/pwa/bantuan"');
  });
});
