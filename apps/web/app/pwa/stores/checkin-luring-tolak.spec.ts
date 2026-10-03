import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Check-in dari antrean HP dinilai dengan aturan yang SAMA dengan check-in
 * bersinyal — radius PERINGATAN/TOLAK dengan koordinat tangkapan, kunci toko
 * tetap SPG. Tanpa basis data — semua tiruan, seperti `kunjungan-aturan.spec.ts`.
 */

const dec = (n: number) => ({ toNumber: () => n });

const state = {
  tokoTetapSpg: null as string | null,
  toko: { lat: null as number | null, lng: null as number | null },
  setelan: {} as Record<string, string>,
  transaksi: 0,
};

const tx = {
  storeVisit: {
    findUnique: vi.fn(async () => null),
    findFirst: vi.fn(async () => null),
    update: vi.fn(),
    updateMany: vi.fn(async () => ({ count: 0 })),
    create: vi.fn<(a: unknown) => Promise<{ id: string }>>(async () => ({ id: "v-baru" })),
  },
};

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`__REDIRECT__:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/store-changes/writer", () => ({ submitStoreChangeRequest: vi.fn() }));
vi.mock("@/lib/salesman/queries", () => ({ tokoTerkunci: vi.fn(async () => false) }));
vi.mock("@/lib/salesman/absensi-writer", () => ({ absenMasukLewatCheckin: vi.fn(), absenPulangLewatCheckout: vi.fn() }));

vi.mock("@elorae/db", () => ({
  Prisma: {
    Decimal: class {
      constructor(public value: number) {}
    },
    TransactionIsolationLevel: { Serializable: "Serializable" },
    PrismaClientKnownRequestError: class extends Error {},
  },
  prisma: {
    user: { findUnique: vi.fn(async () => ({ assignedStoreId: state.tokoTetapSpg })) },
    store: {
      findUnique: vi.fn(async () => ({
        id: "s1",
        isActive: true,
        lat: state.toko.lat === null ? null : dec(state.toko.lat),
        lng: state.toko.lng === null ? null : dec(state.toko.lng),
        checkinRadiusMeters: null,
        salesmanId: null,
      })),
    },
    systemSetting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => (where.key in state.setelan ? { value: state.setelan[where.key] } : null)),
    },
    storeVisit: { findUnique: vi.fn(async () => null), findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (cb: (c: unknown) => Promise<unknown>) => {
      state.transaksi += 1;
      return cb(tx);
    }),
  },
}));

const { checkInLuringAction } = await import("./actions");

// ≈ 1,1 km di utara titik check-in.
const TOKO_JAUH = { lat: -7.77, lng: 110.37 };
const MASUK = { clientId: "hp-1", storeId: "s1", lat: -7.78, lng: 110.37, accuracy: 15, waktu: new Date(Date.now() - 3_600_000).toISOString() };

beforeEach(() => {
  vi.clearAllMocks();
  state.tokoTetapSpg = null;
  state.toko = { lat: null, lng: null };
  state.setelan = {};
  state.transaksi = 0;
});

describe("checkInLuringAction — aturan check-in yang sama", () => {
  it("refuses an offline check-in outside the radius in TOLAK mode, with the numbers, and records nothing", async () => {
    state.toko = TOKO_JAUH;
    state.setelan = { "salesman.checkin": JSON.stringify({ modeRadius: "TOLAK", akurasiMaksMeter: 100 }) };
    const r = await checkInLuringAction(MASUK);
    expect(r).toMatchObject({ ok: false, code: "DI_LUAR_RADIUS", radiusMeter: 100 });
    expect(r.ok === false && r.code === "DI_LUAR_RADIUS" && r.jarakMeter > 1000).toBe(true);
    expect(state.transaksi).toBe(0);
  });

  it("only flags it in the default warning mode, judged at the captured coordinates", async () => {
    state.toko = TOKO_JAUH;
    const r = await checkInLuringAction(MASUK);
    expect(r).toEqual({ ok: true, visitId: "v-baru", storeId: "s1" });
    const data = (tx.storeVisit.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ checkinOutOfRadius: true, clientId: "hp-1", capturedOffline: true, checkinAt: new Date(MASUK.waktu) });
    expect(data.checkinDistanceMeters).toBeGreaterThan(1000);
  });

  it("keeps an SPG to their fixed store", async () => {
    state.tokoTetapSpg = "s2";
    expect(await checkInLuringAction(MASUK)).toEqual({ ok: false, code: "STORE_NOT_ASSIGNED" });
    expect(state.transaksi).toBe(0);
  });

  it("refuses a payload it cannot read", async () => {
    expect(await checkInLuringAction({ ...MASUK, waktu: "kemarin" })).toEqual({ ok: false, code: "VALIDATION" });
    expect(await checkInLuringAction({ ...MASUK, clientId: "" })).toEqual({ ok: false, code: "VALIDATION" });
  });
});
