import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Antrean HP membawa jendela pre-order sampai ke server. Dexie dan aksi server
 * ditirukan — yang dipasak hanya: kolom `preorderWindowId` yang tersimpan di
 * baris antrean diteruskan ke `submitFieldSalesOrder`, dan baris lama tanpa
 * kolom itu dikirim sebagai pesanan biasa (null).
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
  lines: [{ itemId: "i1", variantSku: "", productName: "Kaos", qty: 6, unitPrice: 1000 }],
  syncState: "pending",
  attempts: 0,
};

describe("flushPendingOrders — pre-order", () => {
  beforeEach(() => {
    rows.length = 0;
    mockSubmit.mockReset().mockResolvedValue({ ok: true, orderNo: "PUTUS/1" });
    mockUpdate.mockReset();
    mockDelete.mockReset();
  });

  it("meneruskan jendela pre-order dari antrean; baris lama tanpa kolom itu dikirim sebagai pesanan biasa", async () => {
    rows.push({ ...dasar, localId: "a", capturedAt: 1, preorderWindowId: "clw1" }, { ...dasar, localId: "b", capturedAt: 2 });
    const r = await flushPendingOrders();
    expect(r.synced).toBe(2);
    expect(mockSubmit).toHaveBeenNthCalledWith(1, expect.objectContaining({ idempotencyKey: "a", preorderWindowId: "clw1" }));
    expect(mockSubmit).toHaveBeenNthCalledWith(2, expect.objectContaining({ idempotencyKey: "b", preorderWindowId: null }));
  });
});
