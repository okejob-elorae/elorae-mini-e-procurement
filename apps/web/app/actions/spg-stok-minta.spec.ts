import { beforeEach, describe, expect, it, vi } from "vitest";

/** Minta kiriman SPG: alasan per baris diteruskan, alasan asing ditolak, toko dari server. Tanpa basis data. */

const state = {
  sesi: { user: { id: "spg1", permissions: ["spg_sales:record"] } } as { user: { id: string; permissions: string[] } } | null,
  assignedStoreId: "t1" as string | null,
  dipanggil: [] as Record<string, unknown>[],
};

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@elorae/db", () => ({
  prisma: { user: { findUnique: vi.fn(async () => ({ assignedStoreId: state.assignedStoreId })) } },
}));
vi.mock("@/lib/stores/queries", () => ({ getActiveVisit: vi.fn(async () => null) }));
vi.mock("@/lib/spg/stok-writer", () => ({
  mintaKiriman: vi.fn(async (input: Record<string, unknown>) => {
    state.dipanggil.push(input);
    return { ok: true, requestId: "req1" };
  }),
  catatBarangDicari: vi.fn(),
  catatOpname: vi.fn(),
  terimaKiriman: vi.fn(),
  ubahStatusPermintaan: vi.fn(),
}));

const { mintaKirimanAction } = await import("./spg-stok");

const ISI = {
  baris: [
    { itemId: "i1", variantSku: "i1-M", qty: 3, alasan: "LAKU_DI_TOKO_LAIN" },
    { itemId: "i2", variantSku: null, qty: 1 },
  ],
  idempotencyKey: "hp-1",
  storeId: "t9",
};

beforeEach(() => {
  state.sesi = { user: { id: "spg1", permissions: ["spg_sales:record"] } };
  state.assignedStoreId = "t1";
  state.dipanggil = [];
});

describe("mintaKirimanAction", () => {
  it("passes each line's reason to the writer, and uses the SPG's own store, not the payload's", async () => {
    expect(await mintaKirimanAction(ISI)).toEqual({ ok: true, requestId: "req1" });
    expect(state.dipanggil[0]).toMatchObject({
      storeId: "t1",
      userId: "spg1",
      baris: [
        { itemId: "i1", variantSku: "i1-M", qty: 3, alasan: "LAKU_DI_TOKO_LAIN" },
        { itemId: "i2", variantSku: null, qty: 1 },
      ],
    });
  });

  it("refuses an unknown reason before reaching the writer", async () => {
    const r = await mintaKirimanAction({ ...ISI, baris: [{ itemId: "i1", variantSku: null, qty: 1, alasan: "DICARI_PEMBELI" }] });
    expect(r).toEqual({ ok: false, code: "VALIDATION" });
    expect(state.dipanggil).toHaveLength(0);
  });

  it("refuses a user without a fixed store", async () => {
    state.assignedStoreId = null;
    expect(await mintaKirimanAction(ISI)).toEqual({ ok: false, code: "NO_ASSIGNED_STORE" });
  });
});
