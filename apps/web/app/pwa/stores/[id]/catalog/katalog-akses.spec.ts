import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Halaman katalog HP memakai penjaga yang sama dengan rute datanya
 * (`aksesTokoHp`, /pwa/api/catalog). Dulu halaman tetap dirender untuk toko
 * orang lain saat kunci "hanya toko sendiri" menyala, lalu rutenya menjawab 403
 * dan layar berkata "katalog gagal dimuat". Kini layar BukanTokoSaya, sebelum
 * apa pun dibaca — termasuk pratinjau pre-order (`?inden=`). Tanpa basis data.
 */

const state = vi.hoisted(() => ({
  akses: { ok: true, spg: false } as { ok: true; spg: boolean } | { ok: false; code: "TOKO_TIDAK_ADA" | "STORE_NOT_ASSIGNED" },
  dibaca: [] as string[],
}));

const catat = <T,>(nama: string, nilai: T) =>
  vi.fn(async () => {
    state.dibaca.push(nama);
    return nilai;
  });

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "sales-9", permissions: ["pwa:access"] } })) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
  notFound: () => {
    throw new Error("__NOT_FOUND__");
  },
}));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => null) }));
vi.mock("@/lib/pwa/akses-toko", () => ({ aksesTokoHp: vi.fn(async () => state.akses) }));
vi.mock("@/lib/stores/queries", () => ({
  getStore: vi.fn(async (id: string) => ({ id, name: `Nama ${id}`, termsType: "PUTUS", marginPercent: null, salesmanId: "sales-2" })),
  getActiveVisit: catat("getActiveVisit", null),
}));
vi.mock("@/lib/field-sales/isi-keranjang", () => ({ muatIsiKeranjang: catat("muatIsiKeranjang", null) }));
vi.mock("@/lib/field-sales/isi-keranjang-sumber", () => ({ bacaSumberKeranjang: () => null, tulisSumberKeranjang: () => "" }));
vi.mock("@/lib/salesman/queries", () => ({ barisPesananUntukUlang: catat("barisPesananUntukUlang", null) }));
vi.mock("@/lib/field-sales/kredit-toko", () => ({ muatKreditToko: catat("muatKreditToko", null) }));
vi.mock("@/lib/field-sales/minimum-toko", () => ({ muatMinimumKatalog: catat("muatMinimumKatalog", null) }));
vi.mock("@/lib/field-sales/jarak-jauh", () => ({ bacaSaluran: () => null }));
vi.mock("@/lib/field-sales/jarak-jauh-toko", () => ({ izinJarakJauh: catat("izinJarakJauh", null) }));
vi.mock("@/lib/field-sales/inden", () => ({ bacaIdInden: (v: string) => v, rentangKirim: () => "" }));
vi.mock("@/lib/field-sales/inden-queries", () => ({
  jendelaIndenTerbuka: catat("jendelaIndenTerbuka", []),
  jendelaUntukKatalog: catat("jendelaUntukKatalog", null),
}));
vi.mock("@/lib/field-sales/ganti-pesanan", () => ({ bacaIdGanti: () => null }));
vi.mock("@/lib/field-sales/pwa-queries", () => ({ pesananUntukDiganti: catat("pesananUntukDiganti", null) }));
vi.mock("@/app/actions/settings/pack-ratio", () => ({ getPackRatio: catat("getPackRatio", []) }));
vi.mock("@/app/pwa/stores/[id]/catalog/ukuran-pack", () => ({ muatUkuranPack: catat("muatUkuranPack", {}) }));
vi.mock("@/app/pwa/stores/[id]/BukanTokoSaya", () => ({ BukanTokoSaya: function BukanTokoSaya() { return null; } }));
vi.mock("@/app/pwa/stores/[id]/catalog/CatalogShell", () => ({ CatalogShell: function CatalogShell() { return null; } }));

const { default: PwaStoreCatalog } = await import("@/app/pwa/stores/[id]/catalog/page");

function cari(node: ReactNode, nama: string): ReactElement | null {
  if (!isValidElement(node)) return null;
  const jenis = node.type as { name?: string };
  if (typeof node.type === "function" && jenis.name === nama) return node;
  const anak = (node.props as { children?: ReactNode }).children;
  for (const a of Array.isArray(anak) ? anak : [anak]) {
    const ketemu = cari(a as ReactNode, nama);
    if (ketemu) return ketemu;
  }
  return null;
}

const buka = (id: string, cari: Record<string, string> = {}) =>
  PwaStoreCatalog({ params: Promise.resolve({ id }), searchParams: Promise.resolve(cari) });

beforeEach(() => {
  state.akses = { ok: true, spg: false };
  state.dibaca = [];
});

describe("katalog HP — penjaga toko sendiri", () => {
  it("toko orang lain saat kunci menyala → BukanTokoSaya, tidak ada data toko yang dibaca", async () => {
    state.akses = { ok: false, code: "STORE_NOT_ASSIGNED" };
    const hasil = await buka("toko-lain");
    expect(cari(hasil as ReactNode, "BukanTokoSaya")).not.toBeNull();
    expect(cari(hasil as ReactNode, "CatalogShell")).toBeNull();
    expect(state.dibaca).toEqual([]);
  });

  it("pratinjau pre-order (?inden=) di toko orang lain ikut dijaga — jendelanya tidak dibaca", async () => {
    state.akses = { ok: false, code: "STORE_NOT_ASSIGNED" };
    const hasil = await buka("toko-lain", { inden: "jendela-1" });
    expect(cari(hasil as ReactNode, "BukanTokoSaya")).not.toBeNull();
    expect(state.dibaca).not.toContain("jendelaUntukKatalog");
  });

  it("toko yang hilang di antara dua bacaan → 404", async () => {
    state.akses = { ok: false, code: "TOKO_TIDAK_ADA" };
    await expect(buka("toko-hilang")).rejects.toThrow("__NOT_FOUND__");
  });

  it("toko sendiri (atau kunci mati) → katalog seperti biasa, pre-order dibaca", async () => {
    const hasil = await buka("toko-saya", { inden: "jendela-1" });
    expect(cari(hasil as ReactNode, "CatalogShell")).not.toBeNull();
    expect(cari(hasil as ReactNode, "BukanTokoSaya")).toBeNull();
    expect(state.dibaca).toContain("jendelaUntukKatalog");
  });
});
