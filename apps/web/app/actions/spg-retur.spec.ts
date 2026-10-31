import { beforeEach, describe, expect, it, vi } from "vitest";

/** Toko retur pembeli selalu toko tetap SPG, apa pun yang dikirim HP. Tanpa basis data. */

const state = {
  sesi: { user: { id: "spg1", permissions: ["spg_sales:record"] } } as { user: { id: string; permissions: string[] } } | null,
  tokoTetap: "s1" as string | null,
  dicatat: [] as Record<string, unknown>[],
};

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => state.tokoTetap) }));
vi.mock("@/lib/spg/retur-pembeli", () => ({
  catatReturPembeli: vi.fn(async (input: Record<string, unknown>) => {
    state.dicatat.push(input);
    return { ok: true, returnId: "r1" };
  }),
}));

const { catatReturPembeliAction } = await import("./spg-retur");

const ISI = {
  spgSaleId: "sale1",
  alasan: "ukuran",
  idempotencyKey: "hp-1",
  baris: [{ saleLineId: "l1", qty: 1, condition: "LAYAK" }],
};

beforeEach(() => {
  state.sesi = { user: { id: "spg1", permissions: ["spg_sales:record"] } };
  state.tokoTetap = "s1";
  state.dicatat = [];
});

describe("catatReturPembeliAction", () => {
  it("uses the SPG's fixed store, ignoring any store the phone sends", async () => {
    expect(await catatReturPembeliAction({ ...ISI, storeId: "s9" })).toEqual({ ok: true, returnId: "r1" });
    expect(state.dicatat[0]).toMatchObject({ storeId: "s1", userId: "spg1", spgSaleId: "sale1" });
  });

  it("refuses without spg_sales:record", async () => {
    state.sesi = { user: { id: "u1", permissions: ["pwa:access"] } };
    expect(await catatReturPembeliAction(ISI)).toEqual({ ok: false, kode: "TANPA_AKSES" });
    expect(state.dicatat).toHaveLength(0);
  });

  it("refuses a user with no fixed store", async () => {
    state.tokoTetap = null;
    expect(await catatReturPembeliAction(ISI)).toEqual({ ok: false, kode: "TANPA_TOKO" });
  });

  it("refuses a malformed payload", async () => {
    expect(await catatReturPembeliAction({ ...ISI, baris: [{ saleLineId: "l1", qty: 1.5 }] })).toEqual({
      ok: false,
      kode: "ISIAN_TIDAK_VALID",
    });
  });
});
