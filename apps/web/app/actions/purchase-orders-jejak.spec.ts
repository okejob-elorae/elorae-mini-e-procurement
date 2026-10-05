import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Jejak PO dicatat atas nama pengguna SESI, bukan `userId` kiriman klien.
 *
 * Dulu `createPO`/`updatePO`/`changePOStatus`/`submitPO`/`cancelPO` menulis
 * `createdById`/`changedById` dari argumen, jadi siapa pun yang memegang izin
 * PO bisa memanggil aksinya dengan id orang lain dan riwayat status PO —
 * satu-satunya catatan siapa menyetujui atau membatalkan — menyebut orang itu.
 * Tanpa basis data: prisma ditiru, yang diperiksa adalah id yang ditulis.
 */

const state = vi.hoisted(() => ({
  sesi: null as { user: { id: string; permissions: string[] } } | null,
  riwayat: [] as Array<{ changedById?: string; status?: string }>,
  pembuat: [] as string[],
  aktor: [] as string[],
  pin: [] as string[],
  statusPo: "SUBMITTED" as string,
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => state.sesi) }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/app/actions/notifications", () => ({
  getActorName: vi.fn(async (id: string) => {
    state.aktor.push(id);
    return "Uji";
  }),
  notifyPOCreated: vi.fn(async () => {}),
  notifyPOStatusUpdated: vi.fn(async () => {}),
  notifyPOPaymentToggled: vi.fn(async () => {}),
}));
vi.mock("@/app/actions/security/pin-auth", () => ({
  verifyPinForAction: vi.fn(async (userId: string) => {
    state.pin.push(userId);
    return { success: true };
  }),
}));
vi.mock("@/lib/items/validate-variant-lines", () => ({
  assertLinesVariantSkusMatchItemDefinitions: vi.fn(async () => {}),
}));
vi.mock("@/lib/leadtime/po-snapshot", () => ({
  resolvePoLeadTimeFields: vi.fn(async () => ({ chainSnapshot: null, chainTotalDays: null, etaDate: null })),
}));
vi.mock("@/lib/purchase-orders/mutations", () => ({
  createPurchaseOrder: vi.fn(async (_data: unknown, userId: string) => {
    state.pembuat.push(userId);
    return { id: "po-baru", docNumber: "PO/2026/00099" };
  }),
}));
vi.mock("@elorae/db", async (importOriginal) => {
  const asli = await importOriginal<typeof import("@elorae/db")>();
  const klien = {
    purchaseOrder: {
      findUnique: vi.fn(async () => ({
        id: "po-1",
        status: state.statusPo,
        docNumber: "PO/2026/00001",
        grns: [],
        items: [],
      })),
      update: vi.fn(async (a: { data: { status?: string } }) => ({ id: "po-1", status: a.data.status ?? state.statusPo })),
    },
    pOStatusHistory: {
      create: vi.fn(async (a: { data: { changedById?: string; status?: string } }) => {
        state.riwayat.push(a.data);
        return a.data;
      }),
    },
    pOItem: {
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    item: { findMany: vi.fn(async () => []) },
  };
  return {
    ...asli,
    prisma: { ...klien, $transaction: vi.fn(async (fn: (tx: typeof klien) => unknown) => fn(klien)) },
  };
});

const po = await import("./purchase-orders");

const SESI = "pengguna-sesi";
const PALSU = "admin-dipalsukan";

const DATA_PO = {
  supplierId: "sup-1",
  etaDate: new Date("2026-10-20T00:00:00Z"),
  items: [{ itemId: "item-1", qty: 12, price: 85_000, ppnIncluded: false, uomId: "uom-1" }],
} as unknown as Parameters<typeof po.createPO>[0];

/** Biarkan janji notifikasi (`getActorName(...).then`) berjalan. */
const tunggu = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  state.sesi = { user: { id: SESI, permissions: ["*"] } };
  state.riwayat = [];
  state.pembuat = [];
  state.aktor = [];
  state.pin = [];
  state.statusPo = "SUBMITTED";
});

describe("aksi PO mencatat pelaku dari sesi", () => {
  it("createPO: pembuat = pengguna sesi, bukan argumen", async () => {
    await po.createPO(DATA_PO, PALSU);
    await tunggu();
    expect(state.pembuat).toEqual([SESI]);
    expect(state.aktor).toEqual([SESI]);
  });

  it("updatePO (PO terkirim, PIN): riwayat 'diedit' atas nama sesi", async () => {
    await po.updatePO("po-1", DATA_PO, PALSU, "123456");
    expect(state.riwayat).toHaveLength(1);
    expect(state.riwayat[0].changedById).toBe(SESI);
    // PIN yang diperiksa adalah PIN pengguna sesi, bukan PIN pemilik id kiriman.
    expect(state.pin).toEqual([SESI]);
  });

  it("changePOStatus CLOSED: riwayat status atas nama sesi", async () => {
    await po.changePOStatus("po-1", "CLOSED", PALSU, "selesai");
    await tunggu();
    expect(state.riwayat.map((r) => r.changedById)).toEqual([SESI]);
    expect(state.aktor).toEqual([SESI]);
  });

  it("changePOStatus CANCELLED (PIN): riwayat atas nama sesi", async () => {
    await po.changePOStatus("po-1", "CANCELLED", PALSU, "batal", "123456");
    expect(state.riwayat.map((r) => r.changedById)).toEqual([SESI]);
    expect(state.pin).toEqual([SESI]);
  });

  it("submitPO: yang menyetujui-kirim tercatat dari sesi", async () => {
    state.statusPo = "DRAFT";
    await po.submitPO("po-1", PALSU);
    await tunggu();
    expect(state.riwayat.map((r) => [r.status, r.changedById])).toEqual([["SUBMITTED", SESI]]);
    expect(state.aktor).toEqual([SESI]);
  });

  it("cancelPO: pembatal tercatat dari sesi", async () => {
    await po.cancelPO("po-1", PALSU, "salah pemasok", "123456");
    expect(state.riwayat.map((r) => [r.status, r.changedById])).toEqual([["CANCELLED", SESI]]);
    expect(state.pin).toEqual([SESI]);
  });

  it("izin tetap diperiksa: tanpa purchase_orders:approve, submit ditolak dan tak ada jejak", async () => {
    state.sesi = { user: { id: SESI, permissions: ["purchase_orders:edit"] } };
    await expect(po.submitPO("po-1", PALSU)).rejects.toThrow(/Forbidden/);
    expect(state.riwayat).toEqual([]);
  });
});
