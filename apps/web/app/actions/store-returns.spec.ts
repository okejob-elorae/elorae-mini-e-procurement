import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `catatReturTokoAction` menetapkan TOKO di server, bukan menurut isian HP.
 *
 * Sebelum ini HP boleh mengirim `storeId` apa saja: SPG bisa mencatat retur atas
 * nama toko lain, dan salesman yang terkunci ke tokonya sendiri bisa melapor
 * untuk toko yang dipegang orang lain — termasuk lewat kiriman ulang antrean
 * luring, yang memanggil aksi yang sama. Tanpa basis data — semua tiruan.
 */

const state = {
  sesi: { user: { id: "u1", permissions: ["pwa:access"] } } as { user: { id: string; permissions: string[] } } | null,
  tokoTetap: null as string | null,
  terkunci: false,
  pemegang: null as string | null,
  adaToko: true,
  dicatat: [] as Record<string, unknown>[],
};

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => state.tokoTetap) }));
vi.mock("@/lib/salesman/queries", () => ({ tokoTerkunci: vi.fn(async () => state.terkunci) }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({ JENIS_KABAR: {}, kabariPengguna: vi.fn() }));
vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
vi.mock("@/lib/receivables/koreksi", () => ({}));
vi.mock("@/lib/receivables/return-writer", () => ({
  catatReturToko: vi.fn(async (input: Record<string, unknown>) => {
    state.dicatat.push(input);
    return { ok: true, id: "nrt1", noNrt: String(input.noNrt) };
  }),
}));
vi.mock("@elorae/db", () => ({
  prisma: {
    store: {
      findUnique: vi.fn(async () => (state.adaToko ? { id: "s1", salesmanId: state.pemegang } : null)),
    },
  },
}));

const { catatReturTokoAction } = await import("./store-returns");

const DASAR = {
  noNrt: "NRT-1",
  storeId: "s1",
  claimDate: "2026-10-01",
  deliveryMethod: "SALES" as const,
  claimedAmount: 100_000,
};

beforeEach(() => {
  state.sesi = { user: { id: "u1", permissions: ["pwa:access"] } };
  state.tokoTetap = null;
  state.terkunci = false;
  state.pemegang = null;
  state.adaToko = true;
  state.dicatat = [];
});

describe("catatReturTokoAction — toko ditetapkan server", () => {
  it("refuses an SPG reporting a return for a store other than their fixed store", async () => {
    state.tokoTetap = "s9";
    expect(await catatReturTokoAction(DASAR)).toEqual({ ok: false, kode: "TOKO_TIDAK_DIIZINKAN" });
    expect(state.dicatat).toHaveLength(0);
  });

  it("refuses an offline replay for another store the same way (same action, same check)", async () => {
    state.tokoTetap = "s9";
    expect(await catatReturTokoAction({ ...DASAR, idempotencyKey: "hp-1" })).toEqual({
      ok: false,
      kode: "TOKO_TIDAK_DIIZINKAN",
    });
    expect(state.dicatat).toHaveLength(0);
  });

  it("refuses a store held by another salesperson while the own-stores lock is on", async () => {
    state.terkunci = true;
    state.pemegang = "u2";
    expect(await catatReturTokoAction(DASAR)).toEqual({ ok: false, kode: "TOKO_TIDAK_DIIZINKAN" });
    expect(state.dicatat).toHaveLength(0);
  });

  it("refuses a store nobody holds while the lock is on", async () => {
    state.terkunci = true;
    expect(await catatReturTokoAction(DASAR)).toEqual({ ok: false, kode: "TOKO_TIDAK_DIIZINKAN" });
  });

  it("refuses an unknown store while the lock is on", async () => {
    state.terkunci = true;
    state.adaToko = false;
    expect(await catatReturTokoAction(DASAR)).toEqual({ ok: false, kode: "TOKO_TIDAK_DIIZINKAN" });
  });

  it("accepts the salesperson's own store while locked", async () => {
    state.terkunci = true;
    state.pemegang = "u1";
    expect(await catatReturTokoAction(DASAR)).toEqual({ ok: true });
    expect(state.dicatat[0]).toMatchObject({ storeId: "s1", salesmanId: "u1" });
  });

  it("accepts any store while the lock is off (salesman flow unchanged)", async () => {
    expect(await catatReturTokoAction(DASAR)).toEqual({ ok: true });
    expect(state.dicatat[0]).toMatchObject({ storeId: "s1", reportedBySpg: false });
  });

  it("lets the office (receivables:manage) record for any store, lock or fixed store notwithstanding", async () => {
    state.sesi = { user: { id: "u1", permissions: ["receivables:manage"] } };
    state.tokoTetap = "s9";
    state.terkunci = true;
    state.pemegang = "u2";
    expect(await catatReturTokoAction(DASAR)).toEqual({ ok: true });
    expect(state.dicatat).toHaveLength(1);
  });

  it("marks an SPG note as reported by the SPG and passes only the server-trusted lines", async () => {
    state.tokoTetap = "s1";
    const barisSpg = [{ itemId: "i1", variantSku: "V-M", qty: 2, condition: "LAYAK" as const }];
    expect(
      await catatReturTokoAction({
        ...DASAR,
        barisSpg,
        items: [{ itemId: "i1", itemName: "x", qty: 2, price: 9_999_999 }],
      }),
    ).toEqual({ ok: true });
    expect(state.dicatat[0]).toMatchObject({ storeId: "s1", reportedBySpg: true, barisSpg, items: undefined });
  });

  it("never marks a salesman note as SPG, and drops any SPG lines it sends", async () => {
    expect(await catatReturTokoAction({ ...DASAR, barisSpg: [{ itemId: "i1", qty: 1 }] })).toEqual({ ok: true });
    expect(state.dicatat[0]).toMatchObject({ reportedBySpg: false, barisSpg: undefined });
  });

  it("refuses without a session", async () => {
    state.sesi = null;
    expect(await catatReturTokoAction(DASAR)).toEqual({ ok: false, kode: "TANPA_AKSES" });
  });
});
