import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DAFTAR_BANTUAN } from "./daftar";

/**
 * Setiap halaman kantor dan HP punya penjelasan di Bantuan. Penjelasan sudah
 * tidak tertulis di layar (keputusan pemilik 2026-10-05), jadi halaman baru
 * tanpa entri berarti halaman yang tidak dijelaskan di mana pun — tes ini yang
 * mengingatkan.
 */

const APP = path.resolve(__dirname, "../../app");

/** Halaman yang sengaja tanpa entri, dengan alasannya. */
const DIKECUALIKAN: Record<string, string> = {
  "/backoffice": "hanya mengalihkan ke beranda",
  "/backoffice/bantuan": "halaman Bantuan itu sendiri",
  "/backoffice/sales-orders/[id]/pick-list": "halaman cetak, langsung memanggil print",
  "/backoffice/sales-orders/[id]/packing-slip": "halaman cetak, langsung memanggil print",
  "/pwa/offline": "pemberitahuan sedang tidak ada sinyal",
};

function halaman(dir: string, rute: string[] = []): string[] {
  const hasil: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const segmen = e.name.startsWith("(") ? [] : [e.name];
      hasil.push(...halaman(path.join(dir, e.name), [...rute, ...segmen]));
    } else if (e.name === "page.tsx") {
      hasil.push("/" + rute.join("/"));
    }
  }
  return hasil;
}

describe("cakupan Bantuan", () => {
  const semua = [...halaman(path.join(APP, "backoffice"), ["backoffice"]), ...halaman(path.join(APP, "pwa"), ["pwa"])];
  const terdaftar = new Set(DAFTAR_BANTUAN.map((e) => e.rute));

  it("setiap halaman kantor dan HP punya entri Bantuan", () => {
    const belum = semua.filter((r) => !terdaftar.has(r) && !(r in DIKECUALIKAN));
    expect(belum).toEqual([]);
  });

  it("daftar pengecualian hanya berisi halaman yang masih ada dan memang tanpa entri", () => {
    for (const r of Object.keys(DIKECUALIKAN)) {
      expect(semua, r).toContain(r);
      expect(terdaftar.has(r), r).toBe(false);
    }
  });
});
