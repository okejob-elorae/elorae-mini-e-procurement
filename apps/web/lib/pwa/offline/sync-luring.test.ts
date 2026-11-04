import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Antrean HP dan check-in tanpa sinyal: urutan langkah sinkron (check-in →
 * pesanan … nota SPG → stok → check-out), dan pesanan yang terikat check-in
 * yang masih di HP (menunggu) atau ditolak (berhenti dengan alasannya).
 * Dexie dan semua aksi server ditirukan.
 */
const h = vi.hoisted(() => ({
  urutan: [] as string[],
  pesanan: [] as Array<Record<string, unknown>>,
  checkin: [] as Array<{ localId: string; syncState: string }>,
  submit: vi.fn(),
  update: vi.fn(),
  hapus: vi.fn(),
  melempar: "" as string,
}));

const langkah = (nama: string) => async () => {
  h.urutan.push(nama);
  if (h.melempar === nama) throw new Error("rusak");
};

vi.mock("@/app/pwa/stores/[id]/catalog/actions", () => ({ submitFieldSalesOrder: h.submit }));
vi.mock("./photo-sync", () => ({ flushPendingPhotos: langkah("foto") }));
vi.mock("./laporan-sync", () => ({ flushLaporanTertahan: langkah("laporan") }));
vi.mock("./bukti-terima-sync", () => ({ flushBuktiTerimaTertahan: langkah("buktiTerima") }));
vi.mock("./spg-jual-sinkron", () => ({ flushNotaSpgTertahan: langkah("notaSpg") }));
vi.mock("./luring-sinkron", () => ({
  flushCheckinTertahan: langkah("checkin"),
  flushStokTertahan: langkah("stok"),
  flushCheckoutTertahan: langkah("checkout"),
}));
vi.mock("./db", () => ({
  pwaDb: {
    pendingOrders: {
      where: () => ({ anyOf: () => ({ toArray: async () => h.pesanan }) }),
      update: h.update,
      delete: h.hapus,
    },
    pendingCheckins: { get: async (id: string) => h.checkin.find((c) => c.localId === id) },
  },
}));

const { flushPendingOrders, kirimSemuaAntrean } = await import("./sync");

const pesanan = (localId: string, lain: Record<string, unknown> = {}) => ({
  localId,
  storeId: "s1",
  storeName: "Toko",
  visitId: null,
  lines: [{ itemId: "i1", variantSku: "", productName: "Kaos", qty: 6, unitPrice: 1000 }],
  capturedAt: 1,
  syncState: "pending",
  attempts: 0,
  ...lain,
});

beforeEach(() => {
  h.urutan = [];
  h.pesanan = [];
  h.checkin = [];
  h.melempar = "";
  h.submit.mockReset().mockResolvedValue({ ok: true, orderNo: "PUTUS/1" });
  h.update.mockReset();
  h.hapus.mockReset();
});

describe("kirimSemuaAntrean", () => {
  it("runs check-in first and check-out last, with orders, reports, SPG receipts and stock work in between", async () => {
    await kirimSemuaAntrean();
    expect(h.urutan).toEqual(["checkin", "foto", "laporan", "buktiTerima", "notaSpg", "stok", "checkout"]);
  });

  it("keeps going when one step throws — SPG receipts and check-outs still go", async () => {
    h.melempar = "checkin";
    await kirimSemuaAntrean();
    expect(h.urutan).toEqual(["checkin", "foto", "laporan", "buktiTerima", "notaSpg", "stok", "checkout"]);
  });
});

describe("flushPendingOrders — check-in tanpa sinyal", () => {
  it("holds an order whose check-in is still on the phone", async () => {
    h.checkin = [{ localId: "hp-1", syncState: "pending" }];
    h.pesanan = [pesanan("a", { visitClientId: "hp-1" })];
    const r = await flushPendingOrders();
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenLastCalledWith("a", { syncState: "pending" });
    expect(r).toEqual({ synced: 0, failed: 0, retried: 0 });
  });

  it("stops an order whose check-in the server refused, without sending it", async () => {
    h.checkin = [{ localId: "hp-1", syncState: "failed" }];
    h.pesanan = [pesanan("a", { visitClientId: "hp-1" })];
    const r = await flushPendingOrders();
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenLastCalledWith("a", { syncState: "failed", error: "KUNJUNGAN_DITOLAK", attempts: 1 });
    expect(r.failed).toBe(1);
  });

  it("sends an order by its check-in's phone id once that check-in has gone", async () => {
    h.pesanan = [pesanan("a", { visitClientId: "hp-1" }), pesanan("b")];
    await flushPendingOrders();
    expect(h.submit).toHaveBeenNthCalledWith(1, expect.objectContaining({ idempotencyKey: "a", visitClientId: "hp-1" }));
    expect(h.submit.mock.calls[1][0]).not.toHaveProperty("visitClientId");
  });

  it("stops on KUNJUNGAN_TIDAK_SAH from the server", async () => {
    h.submit.mockResolvedValue({ ok: false, code: "KUNJUNGAN_TIDAK_SAH" });
    h.pesanan = [pesanan("a", { visitClientId: "hp-1" })];
    const r = await flushPendingOrders();
    expect(r.failed).toBe(1);
    expect(h.update).toHaveBeenLastCalledWith("a", expect.objectContaining({ syncState: "failed", error: "KUNJUNGAN_TIDAK_SAH" }));
  });
});
