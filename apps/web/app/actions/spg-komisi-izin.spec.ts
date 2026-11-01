import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Menandai komisi SPG toko putus sudah dibayar: `spg_commission:pay`
 * (keputusan pemilik 2026-11-01), dulu `receivables:manage`. Menetapkan
 * komisinya tetap `receivables:manage` — yang menghitung tidak otomatis yang
 * mengeluarkan uang. Tanpa basis data: penulisnya ditiru.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  dipanggil: [] as string[],
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/spg/komisi-writer", () => ({
  tandaiKomisiDibayar: vi.fn(async () => {
    state.dipanggil.push("tandaiKomisiDibayar");
    return { ok: true };
  }),
  tetapkanKomisiToko: vi.fn(async () => {
    state.dipanggil.push("tetapkanKomisiToko");
    return { ok: true, ulang: false, ditulis: 1, dihapus: 0 };
  }),
}));
vi.mock("@/lib/finance/operasional/kait", () => ({
  kaitBayarKomisiSpg: vi.fn(async () => {}),
  kaitKomisiSpg: vi.fn(async () => {}),
}));

const aksi = await import("./spg-komisi");

const masuk = (permissions: string[]) => {
  state.sesi = { user: { id: "u1", permissions } };
};

beforeEach(() => {
  state.sesi = null;
  state.dipanggil = [];
});

const bayar = () => aksi.tandaiKomisiSpgDibayarAction({ commissionId: "k1" });

describe("menandai komisi SPG toko putus dibayar: spg_commission:pay", () => {
  it("pengelola piutang dan pengatur tarif komisi ditolak sebelum menyentuh penulis", async () => {
    for (const izin of [["receivables:manage"], ["spg_commission:manage"], ["consignment:manage"]]) {
      masuk(izin);
      expect(await bayar()).toEqual({ ok: false, code: "FORBIDDEN" });
    }
    expect(state.dipanggil).toEqual([]);
  });

  it("pemegang izin bayar menandai dibayar", async () => {
    masuk(["spg_commission:pay"]);
    expect(await bayar()).toEqual({ ok: true });
    expect(state.dipanggil).toEqual(["tandaiKomisiDibayar"]);
  });

  it("menetapkan komisi tetap milik pengelola piutang, bukan pemegang izin bayar", async () => {
    masuk(["spg_commission:pay"]);
    expect(await aksi.tetapkanKomisiSpgAction({ storeId: "s1", periode: "2026-10" })).toEqual({ ok: false, code: "FORBIDDEN" });
    masuk(["receivables:manage"]);
    expect((await aksi.tetapkanKomisiSpgAction({ storeId: "s1", periode: "2026-10" })).ok).toBe(true);
    expect(state.dipanggil).toEqual(["tetapkanKomisiToko"]);
  });
});
