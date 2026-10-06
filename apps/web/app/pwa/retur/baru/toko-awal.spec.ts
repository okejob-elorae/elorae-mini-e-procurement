import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * "Lapor retur" dari halaman toko membuka `/pwa/retur/baru?toko=<id>`.
 *
 * Toko itu terpilih HANYA bila ada di pemilih toko formulir salesman — aturan
 * yang sama: toko aktif, dan dengan kunci "hanya toko sendiri" hanya toko yang
 * ia pegang (`tokoUntukRetur`). Selain itu diabaikan diam-diam. SPG tidak
 * memakai pemilih toko sama sekali. Tanpa basis data — semua tiruan.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  tokoTetap: null as string | null,
  terkunci: false,
  opsiPemilih: [] as unknown[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => state.tokoTetap) }));
vi.mock("@/lib/salesman/queries", () => ({ tokoTerkunci: vi.fn(async () => state.terkunci) }));
vi.mock("@/lib/receivables/return-queries", () => ({
  bahanSalinRetur: vi.fn(async () => null),
  tokoUntukRetur: vi.fn(async (opsi?: { hanyaMilik?: string }) => {
    state.opsiPemilih.push(opsi);
    const semua = [
      { id: "toko-saya", name: "Toko Saya", salesmanId: "sales-1" },
      { id: "toko-orang", name: "Toko Orang", salesmanId: "sales-2" },
    ];
    return semua.filter((t) => !opsi?.hanyaMilik || t.salesmanId === opsi.hanyaMilik).map(({ id, name }) => ({ id, name }));
  }),
}));
// Komponen klien diganti tiruan: yang diuji hanya props yang dikirim halaman.
vi.mock("./ReturBaruClient", () => ({ ReturBaruClient: () => null }));
vi.mock("./ReturSpgClient", () => ({ ReturSpgClient: () => null }));

const { default: Halaman } = await import("./page");
const { ReturBaruClient } = await import("./ReturBaruClient");

function cari(node: ReactNode): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const ketemu = cari(n);
      if (ketemu) return ketemu;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === ReturBaruClient) return node as ReactElement<Record<string, unknown>>;
  return cari((node.props as { children?: ReactNode }).children);
}

const buka = async (q: Record<string, string | string[] | undefined>) => {
  const el = await Halaman({ searchParams: Promise.resolve(q) as never });
  const klien = cari(el);
  if (!klien) throw new Error("ReturBaruClient tidak dirender");
  return klien.props;
};

beforeEach(() => {
  state.sesi = { user: { id: "sales-1", permissions: ["pwa:access"] } };
  state.tokoTetap = null;
  state.terkunci = false;
  state.opsiPemilih = [];
});

describe("formulir retur HP (salesman) — pra-isi toko dari ?toko=", () => {
  it("tanpa kunci: toko mana pun di pemilih → terpilih", async () => {
    expect((await buka({ toko: "toko-orang" })).tokoAwal).toBe("toko-orang");
    expect(state.opsiPemilih).toEqual([undefined]);
  });

  it("kunci toko sendiri: toko orang lain tidak ada di pemilih → diabaikan", async () => {
    state.terkunci = true;
    expect((await buka({ toko: "toko-orang" })).tokoAwal).toBeNull();
    expect((await buka({ toko: "toko-saya" })).tokoAwal).toBe("toko-saya");
    expect(state.opsiPemilih).toEqual([{ hanyaMilik: "sales-1" }, { hanyaMilik: "sales-1" }]);
  });

  it("tanpa ?toko, toko tak dikenal, atau ?toko ganda → tanpa pra-isi", async () => {
    expect((await buka({})).tokoAwal).toBeNull();
    expect((await buka({ toko: "toko-hilang" })).tokoAwal).toBeNull();
    expect((await buka({ toko: ["toko-saya", "toko-orang"] })).tokoAwal).toBeNull();
  });
});
