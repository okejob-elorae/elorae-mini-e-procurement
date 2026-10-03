import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Kotak masuk salesman: siapa yang boleh menolak / menandai selesai permintaan
 * SPG. Tanpa basis data — penulis status (`ubahStatusPermintaan`) dites
 * terpisah; di sini hanya penjaga pintunya.
 */

const state = {
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  tokoTetap: null as string | null,
  permintaan: null as null | { storeId: string; store: { salesmanId: string | null } },
  hasilPenulis: { ok: true } as { ok: true } | { ok: false; alasan: string },
  dipanggil: [] as Record<string, unknown>[],
};

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => state.tokoTetap) }));
vi.mock("@elorae/db", () => ({
  prisma: { stockRequest: { findUnique: vi.fn(async () => state.permintaan) } },
}));
vi.mock("@/lib/spg/stok-writer", () => ({
  ubahStatusPermintaan: vi.fn(async (input: Record<string, unknown>) => {
    state.dipanggil.push(input);
    return state.hasilPenulis;
  }),
}));

const { ubahPermintaanSpgAction } = await import("./permintaan-spg");

const sesi = (id: string, permissions: string[]) => ({ user: { id, permissions } });

beforeEach(() => {
  state.sesi = sesi("sales1", ["pwa:access"]);
  state.tokoTetap = null;
  state.permintaan = { storeId: "t1", store: { salesmanId: "sales1" } };
  state.hasilPenulis = { ok: true };
  state.dipanggil = [];
});

describe("ubahPermintaanSpgAction", () => {
  it("lets the store holder reject, and tells the writer it was the salesperson", async () => {
    expect(await ubahPermintaanSpgAction({ requestId: "r1", status: "DITOLAK", note: "gudang kosong" })).toEqual({ ok: true });
    expect(state.dipanggil).toEqual([{ requestId: "r1", status: "DITOLAK", userId: "sales1", note: "gudang kosong", oleh: "SALESMAN" }]);
  });

  it("refuses a salesperson who does not hold the store", async () => {
    state.sesi = sesi("sales2", ["pwa:access"]);
    expect(await ubahPermintaanSpgAction({ requestId: "r1", status: "SELESAI" })).toEqual({ ok: false, code: "BUKAN_PEMEGANG" });
    expect(state.dipanggil).toHaveLength(0);
  });

  it("refuses when the store has no holder at all", async () => {
    state.permintaan = { storeId: "t1", store: { salesmanId: null } };
    expect(await ubahPermintaanSpgAction({ requestId: "r1", status: "SELESAI" })).toEqual({ ok: false, code: "BUKAN_PEMEGANG" });
  });

  it("lets the office (stores:manage) decide any store's request", async () => {
    state.sesi = sesi("kantor1", ["stores:manage"]);
    expect(await ubahPermintaanSpgAction({ requestId: "r1", status: "SELESAI" })).toEqual({ ok: true });
    expect(state.dipanggil[0]).toMatchObject({ userId: "kantor1", oleh: "KANTOR" });
  });

  it("refuses an SPG — even one holding stores:manage — because they made the request", async () => {
    state.tokoTetap = "t1";
    state.sesi = sesi("spg1", ["pwa:access", "spg_sales:record", "stores:manage"]);
    expect(await ubahPermintaanSpgAction({ requestId: "r1", status: "DITOLAK", note: "x" })).toEqual({ ok: false, code: "TANPA_AKSES" });
    expect(state.dipanggil).toHaveLength(0);
  });

  it("refuses a user with neither pwa:access nor stores:manage", async () => {
    state.sesi = sesi("sales1", ["stores:view"]);
    expect(await ubahPermintaanSpgAction({ requestId: "r1", status: "SELESAI" })).toEqual({ ok: false, code: "TANPA_AKSES" });
  });

  it("refuses without a session, an unknown request, or a malformed payload", async () => {
    expect(await ubahPermintaanSpgAction({ requestId: "r1", status: "DIPROSES" })).toEqual({ ok: false, code: "VALIDATION" });
    state.permintaan = null;
    expect(await ubahPermintaanSpgAction({ requestId: "r9", status: "SELESAI" })).toEqual({ ok: false, code: "TIDAK_DITEMUKAN" });
    state.sesi = null;
    expect(await ubahPermintaanSpgAction({ requestId: "r1", status: "SELESAI" })).toEqual({ ok: false, code: "UNAUTHORIZED" });
  });

  it("passes the writer's refusal through as a code", async () => {
    state.hasilPenulis = { ok: false, alasan: "STATUS_TIDAK_BOLEH" };
    expect(await ubahPermintaanSpgAction({ requestId: "r1", status: "SELESAI" })).toEqual({ ok: false, code: "STATUS_TIDAK_BOLEH" });
  });
});
