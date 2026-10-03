import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Nota SPG dari antrean HP di kunjungan tanpa sinyal: kunjungannya dicari lewat
 * id buatan HP (`visitClientId`), milik SPG ini di toko tetapnya; tidak ada →
 * KUNJUNGAN_TIDAK_SAH. Penulis nota ditirukan. Tanpa basis data.
 */
const h = vi.hoisted(() => ({ record: vi.fn(), cari: vi.fn(), aktif: vi.fn() }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "spg1", permissions: ["spg_sales:record"] } })) }));
vi.mock("@elorae/db", () => ({ prisma: { user: { findUnique: vi.fn(async () => ({ assignedStoreId: "t1" })) } } }));
vi.mock("@/lib/spg/sale-writer", () => ({ recordSpgSale: h.record }));
vi.mock("@/lib/stores/queries", () => ({ getActiveVisit: h.aktif }));
vi.mock("@/lib/pwa/kunjungan-antrean", () => ({ cariKunjunganAntrean: h.cari }));

const { recordSpgSaleAction } = await import("./spg-sale");

const NOTA = {
  idempotencyKey: "n1",
  lines: [{ itemId: "i1", variantSku: null, qty: 1 }],
  luring: true,
  waktuJual: "2026-10-03T03:00:00.000Z",
};

beforeEach(() => {
  h.record.mockReset().mockResolvedValue({ ok: true, spgSaleId: "s", docNo: "SPG/1", changeGiven: 0, total: 1 });
  h.cari.mockReset();
  h.aktif.mockReset().mockResolvedValue(null);
});

describe("recordSpgSaleAction — kunjungan tanpa sinyal", () => {
  it("binds the receipt to the visit found by the phone's id", async () => {
    h.cari.mockResolvedValue("v-hp");
    expect(await recordSpgSaleAction({ ...NOTA, visitClientId: "hp-1" })).toMatchObject({ ok: true });
    expect(h.cari).toHaveBeenCalledWith({ userId: "spg1", storeId: "t1", visitId: null, visitClientId: "hp-1" });
    expect(h.record).toHaveBeenCalledWith(expect.objectContaining({ visitId: "v-hp", luring: true }));
  });

  it("refuses with KUNJUNGAN_TIDAK_SAH when the visit is not found", async () => {
    h.cari.mockResolvedValue(null);
    expect(await recordSpgSaleAction({ ...NOTA, visitClientId: "hp-1" })).toEqual({ ok: false, code: "KUNJUNGAN_TIDAK_SAH" });
    expect(h.record).not.toHaveBeenCalled();
  });

  it("a counter sale (not from the queue) still needs a check-in open now, whatever ids it carries", async () => {
    expect(await recordSpgSaleAction({ ...NOTA, luring: false, visitClientId: "hp-1" })).toEqual({ ok: false, code: "NO_ACTIVE_VISIT" });
    expect(h.cari).not.toHaveBeenCalled();
  });
});
