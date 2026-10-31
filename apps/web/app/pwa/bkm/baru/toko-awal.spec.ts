import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * "Lapor pelunasan" dari halaman toko membuka `/pwa/bkm/baru?toko=<id>`.
 *
 * Formulir memilih toko itu HANYA bila toko itu ada di pemilih toko formulir —
 * aturan yang sama: toko dengan faktur terbuka yang ditagih orang ini
 * (`bahanKlaimBaru({ penagihId })`). Toko lain diabaikan diam-diam, formulir
 * terbuka tanpa toko terpilih. Tanpa basis data — semua tiruan.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  tokoTetap: null as string | null,
  penagih: [] as Array<string | undefined>,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => state.tokoTetap) }));
vi.mock("@/lib/receivables/claim-queries", () => ({
  bahanKlaimBaru: vi.fn(async (opsi?: { penagihId?: string }) => {
    state.penagih.push(opsi?.penagihId);
    return {
      toko: [
        { id: "toko-tagih", name: "Toko Tagih", pkp: false },
        { id: "toko-dua", name: "Toko Dua", pkp: true },
      ],
      piutangPerToko: {},
      returPerToko: {},
      jenisPotongan: [],
    };
  }),
  bahanSalinKlaim: vi.fn(async () => null),
}));
// Komponen klien diganti tiruan: yang diuji hanya props yang dikirim halaman.
vi.mock("@/app/backoffice/pelunasan/baru/KlaimBaruClient", () => ({ KlaimBaruClient: () => null }));
vi.mock("../../TautanKembali", () => ({ TautanKembali: () => null }));

const { default: Halaman } = await import("./page");
const { KlaimBaruClient } = await import("@/app/backoffice/pelunasan/baru/KlaimBaruClient");

function cari(node: ReactNode): ReactElement<Record<string, unknown>> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const ketemu = cari(n);
      if (ketemu) return ketemu;
    }
    return null;
  }
  if (!isValidElement(node)) return null;
  if (node.type === KlaimBaruClient) return node as ReactElement<Record<string, unknown>>;
  return cari((node.props as { children?: ReactNode }).children);
}

const buka = async (cari_: Record<string, string | string[] | undefined>) => {
  const el = await Halaman({ searchParams: Promise.resolve(cari_) as never });
  const klien = cari(el);
  if (!klien) throw new Error("KlaimBaruClient tidak dirender");
  return klien.props;
};

beforeEach(() => {
  state.sesi = { user: { id: "sales-1", permissions: ["pwa:access"] } };
  state.tokoTetap = null;
  state.penagih = [];
});

describe("formulir BKM HP — pra-isi toko dari ?toko=", () => {
  it("toko yang ada di pemilih → terpilih", async () => {
    const props = await buka({ toko: "toko-dua" });
    expect(props.tokoAwal).toBe("toko-dua");
    // Pemilihnya tetap dihitung untuk penagih ini — aturan yang sama.
    expect(state.penagih).toEqual(["sales-1"]);
  });

  it("toko yang tidak boleh dilaporkan orang ini → diabaikan diam-diam", async () => {
    expect((await buka({ toko: "toko-orang-lain" })).tokoAwal).toBeNull();
  });

  it("tanpa ?toko, atau ?toko ganda → tanpa pra-isi", async () => {
    expect((await buka({})).tokoAwal).toBeNull();
    expect((await buka({ toko: ["toko-tagih", "toko-dua"] })).tokoAwal).toBeNull();
  });

  it("SPG tetap dikembalikan ke beranda, ?toko tidak mengubahnya", async () => {
    state.tokoTetap = "toko-spg";
    await expect(buka({ toko: "toko-tagih" })).rejects.toThrow("__REDIRECT__:/pwa");
  });
});
