import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Nota SPG dari antrean HP di kunjungan tanpa sinyal: kunjungannya dicari lewat
 * id buatan HP (`visitClientId`), milik SPG ini di toko tetapnya; tidak ada →
 * KUNJUNGAN_TIDAK_SAH. Penulis nota ditirukan. Tanpa basis data.
 *
 * SPG yang sudah ditandai berhenti (P66): `assignedStoreId` kosong. Nota antreannya
 * yang ditangkap paling lambat akhir hari terakhirnya (WIB) tetap dicatat ke toko
 * yang dilepasnya — `tokoSpgUntukAntrean` asli dipakai, hanya baris penggunanya
 * yang ditirukan; sesudah itu, atau dari konter, NO_ASSIGNED_STORE.
 */
const h = vi.hoisted(() => ({
  record: vi.fn(),
  cari: vi.fn(),
  aktif: vi.fn(),
  user: { assignedStoreId: "t1" as string | null, spgEndedOn: null as string | null, spgEndedStoreId: null as string | null },
}));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "spg1", permissions: ["spg_sales:record"] } })) }));
vi.mock("@elorae/db", () => ({ prisma: { user: { findUnique: vi.fn(async () => ({ ...h.user })) } } }));
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
  h.user = { assignedStoreId: "t1", spgEndedOn: null, spgEndedStoreId: null };
});

/* Ditandai berhenti dengan hari terakhir 31 Okt 2026 (WIB), melepas toko "toko-1". */
const berhenti = () => {
  h.user = { assignedStoreId: null, spgEndedOn: "2026-10-31", spgEndedStoreId: "toko-1" };
};

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

describe("recordSpgSaleAction — SPG yang sudah berhenti (P66)", () => {
  it("a queued note captured on her last day (22:00 WIB) is recorded at the store she left", async () => {
    berhenti();
    h.cari.mockResolvedValue("v-hp");
    const nota = { ...NOTA, waktuJual: "2026-10-31T15:00:00.000Z", visitClientId: "hp-1" };
    expect(await recordSpgSaleAction(nota)).toMatchObject({ ok: true });
    expect(h.cari).toHaveBeenCalledWith({ userId: "spg1", storeId: "toko-1", visitId: null, visitClientId: "hp-1" });
    expect(h.record).toHaveBeenCalledWith(expect.objectContaining({ storeId: "toko-1", visitId: "v-hp", luring: true }));
  });

  it("a queued note captured after her last day (00:30 WIB the next day) is refused with NO_ASSIGNED_STORE", async () => {
    berhenti();
    h.cari.mockResolvedValue("v-hp");
    const nota = { ...NOTA, waktuJual: "2026-10-31T17:30:00.000Z", visitClientId: "hp-1" };
    expect(await recordSpgSaleAction(nota)).toEqual({ ok: false, code: "NO_ASSIGNED_STORE" });
    expect(h.cari).not.toHaveBeenCalled();
    expect(h.record).not.toHaveBeenCalled();
  });

  it("a counter sale (not from the queue) from an ended SPG is refused with NO_ASSIGNED_STORE, even with a visit open", async () => {
    berhenti();
    h.aktif.mockResolvedValue({ id: "v-buka", storeId: "toko-1" });
    expect(await recordSpgSaleAction({ ...NOTA, luring: false })).toEqual({ ok: false, code: "NO_ASSIGNED_STORE" });
    expect(h.record).not.toHaveBeenCalled();
  });

  it("judges a phone clock running ahead at now, the time the note itself will carry", async () => {
    h.user = { assignedStoreId: null, spgEndedOn: "2099-12-31", spgEndedStoreId: "toko-1" };
    h.cari.mockResolvedValue("v-hp");
    const nota = { ...NOTA, waktuJual: "2100-01-01T05:00:00.000Z", visitClientId: "hp-1" };
    expect(await recordSpgSaleAction(nota)).toMatchObject({ ok: true });
    expect(h.record).toHaveBeenCalledWith(expect.objectContaining({ storeId: "toko-1" }));
  });

  it("an SPG still at her store keeps her fixed store for a queued note, whatever its time", async () => {
    h.cari.mockResolvedValue("v-hp");
    expect(await recordSpgSaleAction({ ...NOTA, waktuJual: "2026-10-31T17:30:00.000Z", visitClientId: "hp-1" })).toMatchObject({ ok: true });
    expect(h.record).toHaveBeenCalledWith(expect.objectContaining({ storeId: "t1" }));
  });
});
