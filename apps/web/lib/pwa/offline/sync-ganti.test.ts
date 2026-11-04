import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Antrean HP membawa "ubah pesanan" sampai ke server. Dexie dan aksi server
 * ditirukan — yang dipasak: `gantiOrderId` di baris antrean diteruskan ke
 * `submitFieldSalesOrder` (baris lama tanpa kolom itu = pesanan biasa), dan
 * penolakan PESANAN_LAMA_TIDAK_BISA_DIGANTI berhenti di antrean (terminal),
 * bukan diulang selamanya.
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
import { classifyResult } from "./classify";

const dasar = {
  storeId: "s1",
  storeName: "Toko",
  visitId: "v1",
  lines: [{ itemId: "i1", variantSku: "", productName: "Kaos", qty: 6, unitPrice: 1000 }],
  syncState: "pending",
  attempts: 0,
};

describe("flushPendingOrders — ubah pesanan", () => {
  beforeEach(() => {
    rows.length = 0;
    mockSubmit.mockReset().mockResolvedValue({ ok: true, orderNo: "PUTUS/2" });
    mockUpdate.mockReset();
    mockDelete.mockReset();
  });

  it("meneruskan pesanan yang diganti; baris lama tanpa kolom itu dikirim sebagai pesanan biasa", async () => {
    rows.push({ ...dasar, localId: "a", capturedAt: 1, gantiOrderId: "o1", gantiOrderNo: "PUTUS/1" }, { ...dasar, localId: "b", capturedAt: 2 });
    const r = await flushPendingOrders();
    expect(r.synced).toBe(2);
    expect(mockSubmit).toHaveBeenNthCalledWith(1, expect.objectContaining({ idempotencyKey: "a", gantiOrderId: "o1" }));
    expect(mockSubmit).toHaveBeenNthCalledWith(2, expect.objectContaining({ idempotencyKey: "b", gantiOrderId: null }));
  });

  it("pesanan lama yang sudah diputuskan kantor membuat antrean berhenti dengan alasannya", async () => {
    mockSubmit.mockResolvedValue({ ok: false, code: "PESANAN_LAMA_TIDAK_BISA_DIGANTI" });
    rows.push({ ...dasar, localId: "a", capturedAt: 1, gantiOrderId: "o1" });
    const r = await flushPendingOrders();
    expect(r.failed).toBe(1);
    expect(mockUpdate).toHaveBeenLastCalledWith("a", expect.objectContaining({ syncState: "failed", error: "PESANAN_LAMA_TIDAK_BISA_DIGANTI" }));
    expect(mockDelete).not.toHaveBeenCalled();
  });
});

describe("classifyResult — ubah pesanan", () => {
  it("PESANAN_LAMA_TIDAK_BISA_DIGANTI terminal", () => {
    expect(classifyResult({ ok: false, code: "PESANAN_LAMA_TIDAK_BISA_DIGANTI" })).toBe("terminal");
  });
});
