import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Nota SPG yang dijual di kunjungan yang check-in-nya juga tanpa sinyal: nota
 * menunggu check-in-nya sampai, berhenti dengan alasannya bila check-in itu
 * ditolak, dan dikirim dengan id buatan HP (`visitClientId`).
 */
const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  checkin: [] as Array<{ localId: string; syncState: string }>,
  record: vi.fn(),
  update: vi.fn(),
  hapus: vi.fn(),
}));

vi.mock("@/app/actions/spg-sale", () => ({ recordSpgSaleAction: h.record }));
vi.mock("./spg-jual-selisih", async (asli) => ({
  ...(await asli<typeof import("./spg-jual-selisih")>()),
  catatSelisihTotalDiHp: vi.fn(),
}));
vi.mock("./db", () => ({
  pwaDb: {
    pendingSpgSales: {
      where: () => ({ anyOf: () => ({ toArray: async () => h.rows }) }),
      update: h.update,
      delete: h.hapus,
    },
    pendingCheckins: { get: async (id: string) => h.checkin.find((c) => c.localId === id) },
  },
}));

const { flushNotaSpgTertahan } = await import("./spg-jual-sinkron");
const { muatanKirimNotaSpg, susunNotaTertahan } = await import("./spg-jual-muatan");

const nota = (lain: Record<string, unknown> = {}) => ({
  localId: "n1",
  storeId: "t1",
  storeName: "Toko",
  visitId: null,
  visitClientId: "hp-1",
  waktuJual: "2026-10-03T03:00:00.000Z",
  lines: [{ itemId: "i1", variantSku: "KAOS-M", qty: 1, productName: "Kaos", unitPrice: 100_000 }],
  pembeli: null,
  diskonManual: null,
  totalPratinjau: 100_000,
  potonganPratinjau: 0,
  capturedAt: 1,
  syncState: "pending",
  attempts: 0,
  ...lain,
});

beforeEach(() => {
  h.rows = [];
  h.checkin = [];
  h.record.mockReset().mockResolvedValue({ ok: true, spgSaleId: "s", docNo: "SPG/1", changeGiven: 0, total: 100_000 });
  h.update.mockReset();
  h.hapus.mockReset();
});

describe("nota SPG di kunjungan tanpa sinyal", () => {
  it("waits for the check-in still on the phone", async () => {
    h.checkin = [{ localId: "hp-1", syncState: "syncing" }];
    h.rows = [nota()];
    await flushNotaSpgTertahan();
    expect(h.record).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenLastCalledWith("n1", { syncState: "pending" });
  });

  it("stops with KUNJUNGAN_DITOLAK when the check-in was refused", async () => {
    h.checkin = [{ localId: "hp-1", syncState: "failed" }];
    h.rows = [nota()];
    const r = await flushNotaSpgTertahan();
    expect(h.record).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenLastCalledWith("n1", { syncState: "failed", error: "KUNJUNGAN_DITOLAK", attempts: 1 });
    expect(r.gagal).toBe(1);
  });

  it("sends the phone's check-in id once the check-in has gone", async () => {
    h.rows = [nota()];
    await flushNotaSpgTertahan();
    expect(h.record.mock.calls[0][0]).toMatchObject({ luring: true, visitId: null, visitClientId: "hp-1", idempotencyKey: "n1" });
    expect(h.hapus).toHaveBeenCalledWith("n1");
  });

  it("builds and sends a receipt without visitClientId exactly as before", () => {
    const n = susunNotaTertahan({
      idempotencyKey: "k",
      storeId: "t1",
      storeName: "Toko",
      visitId: "v1",
      waktuJual: new Date("2026-10-03T03:00:00.000Z"),
      baris: [{ itemId: "i1", variantSku: null, qty: 1, productName: "Kaos", unitPrice: 1 }],
      pembeli: null,
      diskonManual: null,
      totalPratinjau: 1,
      potonganPratinjau: 0,
    });
    expect(n).not.toHaveProperty("visitClientId");
    expect(muatanKirimNotaSpg(n!)).not.toHaveProperty("visitClientId");
    const lokal = susunNotaTertahan({ ...{ idempotencyKey: "k", storeId: "t1", storeName: "T", visitId: null, visitClientId: "hp-9" }, waktuJual: new Date(), baris: [{ itemId: "i1", variantSku: null, qty: 1, productName: "K", unitPrice: 1 }], pembeli: null, diskonManual: null, totalPratinjau: 1, potonganPratinjau: 0 });
    expect(muatanKirimNotaSpg(lokal!)).toMatchObject({ visitClientId: "hp-9", visitId: null });
  });
});
