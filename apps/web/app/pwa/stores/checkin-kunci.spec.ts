import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Kunci "hanya toko sendiri" dijaga di SERVER saat check-in, bukan hanya
 * dengan menyembunyikan toko dari daftar: tautan lama dan alamat yang diketik
 * tetap sampai ke tombol check-in. Tanpa basis data — semua tiruan.
 */

const state = {
  terkunci: false,
  pemegang: null as string | null,
  tokoTetapSpg: null as string | null,
  transaksi: 0,
};

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/store-changes/writer", () => ({ submitStoreChangeRequest: vi.fn() }));
vi.mock("@/lib/salesman/queries", () => ({ tokoTerkunci: vi.fn(async () => state.terkunci) }));

const tx = {
  storeVisit: { findFirst: vi.fn(async () => null), updateMany: vi.fn(), create: vi.fn(async () => ({})) },
  // Check-in SPG di toko tetapnya = absen masuk (`absensi-writer`), di transaksi yang sama.
  attendance: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})), upsert: vi.fn(async () => ({})), update: vi.fn(async () => ({})) },
};

vi.mock("@elorae/db", () => ({
  Prisma: {
    Decimal: class {
      constructor(public value: number) {}
    },
    TransactionIsolationLevel: { Serializable: "Serializable" },
    PrismaClientKnownRequestError: class extends Error {
      code = "";
    },
  },
  prisma: {
    user: { findUnique: vi.fn(async () => ({ assignedStoreId: state.tokoTetapSpg })) },
    store: {
      findUnique: vi.fn(async () => ({
        id: "s1",
        isActive: true,
        lat: null,
        lng: null,
        checkinRadiusMeters: null,
        salesmanId: state.pemegang,
      })),
    },
    systemSetting: { findUnique: vi.fn(async () => null) },
    // Bacaan tanda check-in janggal: tanpa kunjungan sebelumnya.
    storeVisit: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (cb: (c: unknown) => Promise<unknown>) => {
      state.transaksi += 1;
      return cb(tx);
    }),
  },
}));

const { checkIn } = await import("./actions");
const MASUK = { storeId: "s1", lat: -7.78, lng: 110.37 };

beforeEach(() => {
  state.terkunci = false;
  state.pemegang = null;
  state.tokoTetapSpg = null;
  state.transaksi = 0;
});

describe("checkIn — kunci hanya toko sendiri", () => {
  it("refuses a store held by another salesperson while locked, before opening a visit", async () => {
    state.terkunci = true;
    state.pemegang = "u2";
    expect(await checkIn(MASUK)).toEqual({ ok: false, code: "STORE_NOT_ASSIGNED" });
    expect(state.transaksi).toBe(0);
  });

  it("refuses a store nobody holds while locked", async () => {
    state.terkunci = true;
    expect(await checkIn(MASUK)).toEqual({ ok: false, code: "STORE_NOT_ASSIGNED" });
    expect(state.transaksi).toBe(0);
  });

  it("lets the holder check in while locked", async () => {
    state.terkunci = true;
    state.pemegang = "u1";
    await expect(checkIn(MASUK)).rejects.toThrow("__REDIRECT__:/pwa/stores/s1");
    expect(state.transaksi).toBe(1);
  });

  it("lets anyone check in while the lock is off", async () => {
    state.pemegang = "u2";
    await expect(checkIn(MASUK)).rejects.toThrow("__REDIRECT__:/pwa/stores/s1");
    expect(state.transaksi).toBe(1);
  });

  it("leaves an SPG at their fixed store under the SPG rule, not the salesman lock", async () => {
    state.terkunci = true;
    state.pemegang = "u2";
    state.tokoTetapSpg = "s1";
    await expect(checkIn(MASUK)).rejects.toThrow("__REDIRECT__:/pwa/stores/s1");
  });
});
