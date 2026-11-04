import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Pesanan dari permintaan SPG / rekomendasi (`?isi=…`) yang masuk antrean HP
 * membawa sumbernya sampai ke server, supaya server menautkannya saat sinkron
 * (aturan yang sama dengan jalur daring: hanya pemegang toko, hanya sekali).
 * Dexie dan aksi server ditirukan. Baris lama tanpa kolom itu = pesanan biasa.
 */
const { mockSubmit, rows, mockUpdate, mockDelete } = vi.hoisted(() => ({
  mockSubmit: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock("@/app/pwa/stores/[id]/catalog/actions", () => ({ submitFieldSalesOrder: mockSubmit }));
vi.mock("./photo-sync", () => ({ flushPendingPhotos: vi.fn() }));
vi.mock("./laporan-sync", () => ({ flushLaporanTertahan: vi.fn() }));
vi.mock("./bukti-terima-sync", () => ({ flushBuktiTerimaTertahan: vi.fn() }));
vi.mock("./db", () => ({
  pwaDb: {
    pendingOrders: {
      where: () => ({ anyOf: () => ({ toArray: async () => rows }) }),
      update: mockUpdate,
      delete: mockDelete,
    },
  },
}));

import { flushPendingOrders } from "./sync";

const dasar = {
  storeId: "s1",
  storeName: "Toko",
  visitId: "v1",
  lines: [{ itemId: "i1", variantSku: "M", productName: "Kaos M", qty: 6, unitPrice: 1000 }],
  syncState: "pending",
  attempts: 0,
};

describe("flushPendingOrders — sumber keranjang", () => {
  beforeEach(() => {
    rows.length = 0;
    mockSubmit.mockReset().mockResolvedValue({ ok: true, orderNo: "PUTUS/9" });
    mockUpdate.mockReset();
    mockDelete.mockReset();
  });

  it("forwards the request / recommendation the cart came from; an old row without it is a plain order", async () => {
    rows.push(
      { ...dasar, localId: "a", capturedAt: 1, sumber: "permintaan:req1" },
      { ...dasar, localId: "b", capturedAt: 2, sumber: "rekomendasi:rk1" },
      { ...dasar, localId: "c", capturedAt: 3 },
    );
    const r = await flushPendingOrders();
    expect(r.synced).toBe(3);
    expect(mockSubmit).toHaveBeenNthCalledWith(1, expect.objectContaining({ idempotencyKey: "a", sumber: "permintaan:req1" }));
    expect(mockSubmit).toHaveBeenNthCalledWith(2, expect.objectContaining({ idempotencyKey: "b", sumber: "rekomendasi:rk1" }));
    expect(mockSubmit).toHaveBeenNthCalledWith(3, expect.objectContaining({ idempotencyKey: "c", sumber: null }));
  });

  it("a retried row sends its source again (the server links only once)", async () => {
    mockSubmit.mockRejectedValueOnce(new Error("jaringan")).mockResolvedValueOnce({ ok: true, orderNo: "PUTUS/9" });
    rows.push({ ...dasar, localId: "a", capturedAt: 1, sumber: "permintaan:req1" });
    expect((await flushPendingOrders()).retried).toBe(1);
    expect((await flushPendingOrders()).synced).toBe(1);
    expect(mockSubmit).toHaveBeenCalledTimes(2);
    for (const c of mockSubmit.mock.calls) expect(c[0]).toMatchObject({ idempotencyKey: "a", sumber: "permintaan:req1" });
  });
});
