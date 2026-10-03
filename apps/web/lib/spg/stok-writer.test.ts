import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Penulis stok toko tanpa basis data. Yang dijaga: jumlah DIKIRIM dibaca dari
 * dokumen sumber (bukan dari layar), satu kiriman hanya bisa diterima sekali,
 * baris tanpa barang katalog tidak menggerakkan stok, dan opname hanya menulis
 * selisihnya.
 */

const state = {
  kiriman: null as null | {
    sourceType: string;
    sourceId: string;
    docNo: string;
    tanggal: Date;
    lines: { lineId: string; itemId: string | null; variantSku: string; productName: string; qty: number }[];
  },
  sudahDiterima: false,
  saldo: [] as { itemId: string; variantSku: string; _sum: { qty: number } }[],
  itemAda: 1,
  receipt: [] as Record<string, unknown>[],
  opname: [] as Record<string, unknown>[],
  gerak: [] as Record<string, unknown>[],
};

vi.mock("./kiriman", () => ({
  JENIS_KIRIMAN: ["PUTUS_DELIVERY", "KONSI_ORDER", "KONSI_SHIPMENT", "MUTASI", "MUTASI_KEMBALI"],
  dariMutasi: (j: string) => j === "MUTASI" || j === "MUTASI_KEMBALI",
  muatKiriman: vi.fn(async () => state.kiriman),
}));

vi.mock("@/lib/notifications/admin-fanout", () => ({ fanOutAdminNotification: vi.fn() }));
const kabar = vi.hoisted(() => ({ kirim: [] as { userId: string; jenis: string; judul: string }[] }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({
  JENIS_KABAR: { PERMINTAAN_STOK_DIPROSES: "PERMINTAAN_STOK_DIPROSES", MUTASI_DITERIMA: "MUTASI_DITERIMA" },
  kabariPengguna: vi.fn(async (userId: string, k: { jenis: string; judul: string }) => {
    kabar.kirim.push({ userId, jenis: k.jenis, judul: k.judul });
  }),
}));

const tx = {
  storeReceipt: {
    findUnique: vi.fn(async () => (state.sudahDiterima ? { id: "r0" } : null)),
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.receipt.push(a.data);
      return { id: "r1" };
    }),
  },
  storeOpname: {
    create: vi.fn(async (a: { data: Record<string, unknown> }) => {
      state.opname.push(a.data);
      return { id: "o1" };
    }),
  },
  storeStockMovement: {
    groupBy: vi.fn(async () => state.saldo),
    createMany: vi.fn(async (a: { data: Record<string, unknown>[] }) => {
      state.gerak.push(...a.data);
      return { count: a.data.length };
    }),
  },
  stockRequest: {
    findUnique: vi.fn(async () => ({ status: "BARU", requestedById: "spg9" })),
    updateMany: vi.fn(async () => ({ count: 1 })),
  },
  auditLog: { create: vi.fn(async () => ({})) },
  item: {
    findMany: vi.fn(async (a: { where: { id: { in: string[] } } }) =>
      a.where.id.in.slice(0, state.itemAda === 1 ? undefined : 0).map((id) => ({ id, nameId: `Barang ${id}`, variants: null })),
    ),
  },
};

vi.mock("@/lib/db/tx-retry", () => ({
  runSerializable: (cb: (c: unknown) => Promise<unknown>) => cb(tx),
}));

vi.mock("@elorae/db", () => ({
  prisma: {},
  Prisma: {
    PrismaClientKnownRequestError: class extends Error {
      code = "P2002";
    },
  },
}));

const { terimaKiriman, catatOpname, ubahStatusPermintaan } = await import("./stok-writer");

beforeEach(() => {
  state.kiriman = {
    sourceType: "PUTUS_DELIVERY",
    sourceId: "d1",
    docNo: "DLV/2026/0001",
    tanggal: new Date("2026-09-20T03:00:00Z"),
    lines: [
      { lineId: "L1", itemId: "i1", variantSku: "i1-M", productName: "Kemeja M", qty: 6 },
      { lineId: "L2", itemId: null, variantSku: "", productName: "Hanger (diketik)", qty: 10 },
    ],
  };
  state.sudahDiterima = false;
  state.saldo = [];
  state.itemAda = 1;
  state.receipt = [];
  state.opname = [];
  state.gerak = [];
  kabar.kirim = [];
});

const TERIMA = {
  storeId: "t1",
  userId: "spg1",
  sourceType: "PUTUS_DELIVERY" as const,
  sourceId: "d1",
  diterima: [
    { lineId: "L1", qtyReceived: 5 },
    { lineId: "L2", qtyReceived: 10 },
  ],
};

describe("terimaKiriman", () => {
  it("records sent from the source document and received from the SPG's count", async () => {
    expect(await terimaKiriman(TERIMA)).toEqual({ ok: true, receiptId: "r1" });
    const baris = (state.receipt[0].lines as { create: Record<string, unknown>[] }).create;
    expect(baris[0]).toMatchObject({ itemId: "i1", qtySent: 6, qtyReceived: 5 });
    expect(state.receipt[0]).toMatchObject({ sourceDocNo: "DLV/2026/0001", receivedById: "spg1" });
  });

  it("moves stock by the RECEIVED quantity, and only for catalogue items", async () => {
    await terimaKiriman(TERIMA);
    expect(state.gerak).toEqual([
      expect.objectContaining({ itemId: "i1", variantSku: "i1-M", qty: 5, kind: "TERIMA", refType: "StoreReceipt", refId: "r1" }),
    ]);
  });

  it("refuses a shipment that is not for this store", async () => {
    state.kiriman = null;
    expect(await terimaKiriman(TERIMA)).toEqual({ ok: false, alasan: "KIRIMAN_TIDAK_DITEMUKAN" });
    expect(state.gerak).toHaveLength(0);
  });

  it("refuses a shipment already received — stock must never arrive twice", async () => {
    state.sudahDiterima = true;
    expect(await terimaKiriman(TERIMA)).toEqual({ ok: false, alasan: "SUDAH_DITERIMA" });
    expect(state.gerak).toHaveLength(0);
  });

  it("refuses a received quantity that is negative or missing for a line", async () => {
    expect(await terimaKiriman({ ...TERIMA, diterima: [{ lineId: "L1", qtyReceived: -1 }, { lineId: "L2", qtyReceived: 0 }] })).toEqual({
      ok: false,
      alasan: "JUMLAH_TIDAK_VALID",
    });
    expect(await terimaKiriman({ ...TERIMA, diterima: [{ lineId: "L1", qtyReceived: 5 }] })).toEqual({
      ok: false,
      alasan: "JUMLAH_TIDAK_VALID",
    });
  });
});

describe("terimaKiriman — kantor", () => {
  it("lets the office receive only store transfers, never a delivery meant for the SPG", async () => {
    expect(await terimaKiriman({ ...TERIMA, kantor: {} })).toEqual({ ok: false, alasan: "KIRIMAN_TIDAK_DITEMUKAN" });
    expect(state.receipt).toHaveLength(0);
  });
});

describe("ubahStatusPermintaan", () => {
  it("tells the SPG who asked, after the status changes", async () => {
    expect(await ubahStatusPermintaan({ requestId: "q1", status: "DIPROSES", userId: "kantor1" })).toEqual({ ok: true });
    expect(kabar.kirim).toEqual([expect.objectContaining({ userId: "spg9", jenis: "PERMINTAAN_STOK_DIPROSES" })]);
  });

  it("requires a reason to refuse, and says nothing when refused", async () => {
    expect(await ubahStatusPermintaan({ requestId: "q1", status: "DITOLAK", userId: "kantor1" })).toEqual({ ok: false, alasan: "ALASAN_WAJIB" });
    expect(kabar.kirim).toHaveLength(0);
  });
});

describe("catatOpname", () => {
  const OPNAME = { storeId: "t1", userId: "spg1", baris: [{ itemId: "i1", variantSku: "i1-M", qtyCounted: 4 }] };

  it("stores the book figure beside the count and moves only the difference", async () => {
    state.saldo = [{ itemId: "i1", variantSku: "i1-M", _sum: { qty: 7 } }];
    expect(await catatOpname(OPNAME)).toEqual({ ok: true, opnameId: "o1", selisih: 1 });
    const baris = (state.opname[0].lines as { create: Record<string, unknown>[] }).create;
    expect(baris[0]).toMatchObject({ qtySystem: 7, qtyCounted: 4 });
    expect(state.gerak).toEqual([expect.objectContaining({ qty: -3, kind: "OPNAME", refType: "StoreOpname", refId: "o1" })]);
  });

  it("writes no movement for a line that matches the books", async () => {
    state.saldo = [{ itemId: "i1", variantSku: "i1-M", _sum: { qty: 4 } }];
    expect(await catatOpname(OPNAME)).toEqual({ ok: true, opnameId: "o1", selisih: 0 });
    expect(state.gerak).toHaveLength(0);
  });

  it("refuses an empty count and unknown items", async () => {
    expect(await catatOpname({ ...OPNAME, baris: [] })).toEqual({ ok: false, alasan: "TANPA_BARIS" });
    state.itemAda = 0;
    expect(await catatOpname(OPNAME)).toEqual({ ok: false, alasan: "BARANG_TIDAK_DITEMUKAN" });
  });
});
