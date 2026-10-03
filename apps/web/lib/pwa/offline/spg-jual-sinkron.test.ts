import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Penyinkron nota SPG. Dexie dan aksi server ditirukan — yang dipasak: muatan
 * kiriman (luring + waktu jual + kunjungan + kunci yang sama), nasib setiap
 * jawaban (hapus / ditolak / coba lagi), dan catatan selisih total.
 */
const { mockRecord, rows, mockUpdate, mockDelete, mockCatat } = vi.hoisted(() => ({
  mockRecord: vi.fn(),
  rows: [] as Array<Record<string, unknown>>,
  mockUpdate: vi.fn(),
  mockDelete: vi.fn(),
  mockCatat: vi.fn(),
}));

vi.mock("@/app/actions/spg-sale", () => ({ recordSpgSaleAction: mockRecord }));
vi.mock("./spg-jual-selisih", async (asli) => ({
  ...(await asli<typeof import("./spg-jual-selisih")>()),
  catatSelisihTotalDiHp: mockCatat,
}));
vi.mock("./db", () => ({
  pwaDb: {
    pendingSpgSales: {
      where: () => ({ anyOf: () => ({ toArray: async () => rows }) }),
      update: mockUpdate,
      delete: mockDelete,
    },
  },
}));

import { flushNotaSpgTertahan } from "./spg-jual-sinkron";

const nota = (localId: string, capturedAt: number, lain: Record<string, unknown> = {}) => ({
  localId,
  storeId: "toko-1",
  storeName: "Toko Satu",
  visitId: "kunjungan-1",
  waktuJual: "2026-10-03T13:05:00.000Z",
  lines: [{ itemId: "i1", variantSku: "KAOS-M", qty: 2, productName: "Kaos — M", unitPrice: 100_000 }],
  pembeli: null,
  diskonManual: null,
  totalPratinjau: 200_000,
  potonganPratinjau: 0,
  capturedAt,
  syncState: "pending",
  attempts: 0,
  ...lain,
});

describe("flushNotaSpgTertahan", () => {
  beforeEach(() => {
    rows.length = 0;
    mockRecord.mockReset();
    mockUpdate.mockReset();
    mockDelete.mockReset();
    mockCatat.mockReset();
  });

  it("sends the oldest first, as an offline sale with its own sale time, visit and key — then removes it", async () => {
    rows.push(nota("b", 2), nota("a", 1));
    mockRecord.mockResolvedValue({ ok: true, spgSaleId: "s", docNo: "SPG/1", changeGiven: 0, total: 200_000 });
    const h = await flushNotaSpgTertahan();
    expect(mockRecord.mock.calls.map((c) => c[0].idempotencyKey)).toEqual(["a", "b"]);
    expect(mockRecord.mock.calls[0][0]).toMatchObject({
      idempotencyKey: "a",
      luring: true,
      waktuJual: "2026-10-03T13:05:00.000Z",
      visitId: "kunjungan-1",
      lines: [{ itemId: "i1", variantSku: "KAOS-M", qty: 2 }],
    });
    expect(mockDelete.mock.calls.map((c) => c[0])).toEqual(["a", "b"]);
    expect(h).toEqual({ terkirim: 2, gagal: 0, sibuk: false, berbeda: [] });
    expect(mockCatat).not.toHaveBeenCalled();
  });

  it("notes a recorded total that differs from the screen, so the receipt can say so", async () => {
    rows.push(nota("a", 1));
    mockRecord.mockResolvedValue({ ok: true, spgSaleId: "s-9", docNo: "SPG/9", changeGiven: 0, total: 180_000 });
    const h = await flushNotaSpgTertahan();
    expect(mockCatat).toHaveBeenCalledWith("s-9", 200_000, 180_000);
    expect(h.berbeda).toEqual([{ docNo: "SPG/9", pratinjau: 200_000, tercatat: 180_000 }]);
  });

  it("marks a rejected receipt failed with the server's code and keeps it on the phone", async () => {
    rows.push(nota("a", 1, { attempts: 2 }));
    mockRecord.mockResolvedValue({ ok: false, code: "NO_PRICE" });
    const h = await flushNotaSpgTertahan();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenLastCalledWith("a", { syncState: "failed", error: "NO_PRICE", attempts: 3 });
    expect(h.gagal).toBe(1);
  });

  it("puts a receipt whose send threw back in line for the next signal", async () => {
    rows.push(nota("a", 1));
    mockRecord.mockRejectedValue(new TypeError("Failed to fetch"));
    const h = await flushNotaSpgTertahan();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenLastCalledWith("a", { syncState: "pending", error: undefined, attempts: 1 });
    expect(h).toEqual({ terkirim: 0, gagal: 0, sibuk: false, berbeda: [] });
  });

  it("does not run twice at once", async () => {
    rows.push(nota("a", 1));
    let lepas: (v: unknown) => void = () => undefined;
    mockRecord.mockReturnValue(new Promise((r) => (lepas = r)));
    const pertama = flushNotaSpgTertahan();
    await vi.waitFor(() => expect(mockRecord).toHaveBeenCalled());
    expect(await flushNotaSpgTertahan()).toEqual({ terkirim: 0, gagal: 0, sibuk: true, berbeda: [] });
    lepas({ ok: true, spgSaleId: "s", docNo: "SPG/1", changeGiven: 0, total: 200_000 });
    expect((await pertama).terkirim).toBe(1);
    expect(mockRecord).toHaveBeenCalledTimes(1);
  });
});
