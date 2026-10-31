import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Pesanan dari antrean HP yang dibuat di kunjungan tanpa sinyal: kunjungannya
 * dicari lewat id buatan HP (`visitClientId`) — milik salesman ini di toko itu —
 * dan diteruskan ke penulis sebagai `visitId`. Tanpa basis data.
 */
const h = vi.hoisted(() => ({
  create: vi.fn(),
  cari: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "u1" } })) }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: vi.fn(async () => null) }));
vi.mock("@/lib/field-sales/isi-keranjang", () => ({ tautkanSumberPesanan: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/field-sales/writer", () => ({ createFieldSalesOrder: h.create }));
vi.mock("@/lib/field-sales/bonus", () => ({ susunBonusPesanan: vi.fn() }));
vi.mock("@/lib/promos/queries", () => ({ fetchActivePromosForStore: vi.fn() }));
vi.mock("@elorae/db", () => ({ prisma: {} }));
vi.mock("@/lib/pwa/kunjungan-antrean", () => ({ cariKunjunganAntrean: h.cari }));

const { submitFieldSalesOrder } = await import("./actions");
const baris = [{ itemId: "i1", variantSku: "", productName: "Kaos", qty: 6, unitPrice: 1000 }];

beforeEach(() => {
  h.create.mockReset().mockResolvedValue({ orderId: "o1", orderNo: "PUTUS/1", kreditDitahan: false });
  h.cari.mockReset();
});

describe("submitFieldSalesOrder — kunjungan tanpa sinyal", () => {
  it("finds the visit by the phone's id for this salesman and store, and hands its server id to the writer", async () => {
    h.cari.mockResolvedValue("v-dari-hp");
    const r = await submitFieldSalesOrder({ storeId: "s1", visitClientId: "hp-1", lines: baris, idempotencyKey: "k1" });
    expect(r).toEqual({ ok: true, orderId: "o1", orderNo: "PUTUS/1", kreditDitahan: false });
    expect(h.cari).toHaveBeenCalledWith({ userId: "u1", storeId: "s1", visitClientId: "hp-1" });
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ visitId: "v-dari-hp", idempotencyKey: "k1" }));
  });

  it("refuses with KUNJUNGAN_TIDAK_SAH when that check-in never made it, without reaching the writer", async () => {
    h.cari.mockResolvedValue(null);
    expect(await submitFieldSalesOrder({ storeId: "s1", visitClientId: "hp-1", lines: baris })).toEqual({ ok: false, code: "KUNJUNGAN_TIDAK_SAH" });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("leaves an order without the phone's id exactly as before", async () => {
    await submitFieldSalesOrder({ storeId: "s1", visitId: "v1", lines: baris });
    expect(h.cari).not.toHaveBeenCalled();
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ visitId: "v1" }));
  });
});
