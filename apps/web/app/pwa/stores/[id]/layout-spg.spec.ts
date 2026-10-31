import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * SPG hanya boleh membuka toko tetapnya — juga SUBHALAMANNYA.
 *
 * Halaman toko (`/pwa/stores/[id]`) sudah menolak SPG di toko lain, tetapi
 * subhalaman seperti `/checklist`, `/harga-pesaing`, `/analisa`, `/catalog`
 * hanya memeriksa `pwa:access`, jadi SPG yang mengetik alamat toko lain
 * membuka checklist, harga pesaing, dan analisanya. Layout di `[id]` kini
 * mengembalikan SPG ke /pwa sebelum halaman mana pun di bawahnya dirender.
 * Salesman tidak tersentuh. Tanpa basis data — semua tiruan.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  tokoTetap: null as string | null,
  ditanya: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));
vi.mock("@/lib/pwa/peran", () => ({
  ambilTokoTetap: vi.fn(async (userId: string) => {
    state.ditanya.push(userId);
    return state.tokoTetap;
  }),
}));

const { default: TokoLayout } = await import("./layout");

const ISI = createElement("main", null, "isi subhalaman");

const buka = (id: string) => TokoLayout({ children: ISI, params: Promise.resolve({ id }) });

beforeEach(() => {
  state.sesi = null;
  state.tokoTetap = null;
  state.ditanya = [];
});

describe("layout toko PWA — SPG hanya di toko tetapnya", () => {
  it("tanpa sesi → login, tanpa membaca toko tetap", async () => {
    await expect(buka("toko-lain")).rejects.toThrow("__REDIRECT__:/login?callbackUrl=/pwa");
    expect(state.ditanya).toEqual([]);
  });

  it("SPG di toko LAIN → /pwa, subhalaman tidak dirender", async () => {
    state.sesi = { user: { id: "spg-1", permissions: ["pwa:access", "spg_sales:record"] } };
    state.tokoTetap = "toko-spg";
    await expect(buka("toko-lain")).rejects.toThrow("__REDIRECT__:/pwa");
    expect(state.ditanya).toEqual(["spg-1"]);
  });

  it("SPG di tokonya sendiri → subhalaman dirender apa adanya", async () => {
    state.sesi = { user: { id: "spg-1", permissions: ["pwa:access", "spg_sales:record"] } };
    state.tokoTetap = "toko-spg";
    await expect(buka("toko-spg")).resolves.toBe(ISI);
  });

  it("salesman (tanpa toko tetap) → toko mana pun tetap dirender", async () => {
    state.sesi = { user: { id: "sales-1", permissions: ["pwa:access"] } };
    state.tokoTetap = null;
    await expect(buka("toko-lain")).resolves.toBe(ISI);
    await expect(buka("toko-spg")).resolves.toBe(ISI);
  });
});
