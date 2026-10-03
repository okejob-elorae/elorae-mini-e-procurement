import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Unit saja: auth, penulis, dan helper bonus ditirukan — tidak menyentuh basis
 * data. Yang dipasak: saluran jarak jauh diteruskan ke penulis, penolakan aturan
 * pemilik menjadi kode (bukan lemparan), dan pratinjau bonus tidak pernah
 * menjatuhkan pratinjau potongan.
 */
const { mockAuth, mockCreate, mockSusunBonus, mockFetchPromos, mockStore, mockInv, mockTokoTetap, mockTautkan } = vi.hoisted(() => ({
  mockTokoTetap: vi.fn(async (): Promise<string | null> => null),
  mockTautkan: vi.fn(async () => {}),
  mockAuth: vi.fn(),
  mockCreate: vi.fn(),
  mockSusunBonus: vi.fn(),
  mockFetchPromos: vi.fn(),
  mockStore: vi.fn(),
  mockInv: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/pwa/peran", () => ({ ambilTokoTetap: mockTokoTetap }));
vi.mock("@/lib/field-sales/isi-keranjang", () => ({ tautkanSumberPesanan: mockTautkan }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/field-sales/writer", () => ({ createFieldSalesOrder: mockCreate }));
vi.mock("@/lib/field-sales/bonus", () => ({ susunBonusPesanan: mockSusunBonus }));
vi.mock("@/lib/promos/queries", () => ({ fetchActivePromosForStore: mockFetchPromos }));
vi.mock("@elorae/db", () => ({
  prisma: { store: { findUnique: mockStore }, inventoryValue: { findMany: mockInv } },
}));

import { JarakJauhDitolakError } from "@/lib/field-sales/jarak-jauh";
import { IndenDitolakError } from "@/lib/field-sales/inden";
import { PesananLamaTidakBisaDigantiError } from "@/lib/field-sales/ganti-pesanan";
import { previewFieldSalesPromos, submitFieldSalesOrder } from "./actions";

const baris = [{ itemId: "i1", variantSku: "", productName: "Kaos", qty: 6, unitPrice: 1000 }];

describe("submitFieldSalesOrder — pesanan jarak jauh (unit)", () => {
  beforeEach(() => {
    mockAuth.mockReset().mockResolvedValue({ user: { id: "u1" } });
    mockCreate.mockReset().mockResolvedValue({ orderId: "o1", orderNo: "PUTUS/1", oversell: [], kreditDitahan: false });
  });

  it("refuses an SPG (user with a fixed store) before the writer runs", async () => {
    mockTokoTetap.mockResolvedValueOnce("toko-spg");
    const r = await submitFieldSalesOrder({ storeId: "s1", visitId: "v1", lines: baris });
    expect(r).toEqual({ ok: false, code: "UNAUTHORIZED" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("links the order back to the request it was filled from, and ignores a malformed source", async () => {
    mockTautkan.mockClear();
    await submitFieldSalesOrder({ storeId: "s1", visitId: "v1", lines: baris, sumber: "permintaan:req1" });
    expect(mockTautkan).toHaveBeenCalledWith(
      { jenis: "permintaan", id: "req1" },
      { orderId: "o1", orderNo: "PUTUS/1", userId: "u1", storeId: "s1" },
    );
    mockTautkan.mockClear();
    await submitFieldSalesOrder({ storeId: "s1", visitId: "v1", lines: baris, sumber: "pesanan:../x" });
    expect(mockTautkan).not.toHaveBeenCalled();
  });

  it("passes the remote channel to the writer and no visit", async () => {
    const r = await submitFieldSalesOrder({ storeId: "s1", lines: baris, remoteChannel: "WA" });
    expect(r).toEqual({ ok: true, orderId: "o1", orderNo: "PUTUS/1", kreditDitahan: false });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ storeId: "s1", salesmanId: "u1", remoteChannel: "WA", visitId: undefined }));
  });

  it("a visit order sends remoteChannel null", async () => {
    await submitFieldSalesOrder({ storeId: "s1", visitId: "v1", lines: baris });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ visitId: "v1", remoteChannel: null }));
  });

  it("an unknown channel is refused before the writer runs", async () => {
    const r = await submitFieldSalesOrder({ storeId: "s1", lines: baris, remoteChannel: "SMS" as never });
    expect(r).toEqual({ ok: false, code: "EMPTY" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("refuses PORTAL from the salesman app, so the WA/phone owner rule cannot be skipped", async () => {
    const r = await submitFieldSalesOrder({ storeId: "s1", lines: baris, remoteChannel: "PORTAL" as never });
    expect(r).toEqual({ ok: false, code: "EMPTY" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each(["JARAK_JAUH_NONAKTIF", "BUKAN_TOKO_SENDIRI"] as const)("maps the owner-rule refusal %s to a code", async (code) => {
    mockCreate.mockRejectedValue(new JarakJauhDitolakError(code));
    const r = await submitFieldSalesOrder({ storeId: "s1", lines: baris, remoteChannel: "TELEPON" });
    expect(r).toEqual({ ok: false, code });
  });
});

describe("submitFieldSalesOrder — pre-order (unit)", () => {
  beforeEach(() => {
    mockAuth.mockReset().mockResolvedValue({ user: { id: "u1" } });
    mockCreate.mockReset().mockResolvedValue({ orderId: "o1", orderNo: "PUTUS/1", oversell: [], kreditDitahan: false });
  });

  it("passes the pre-order window to the writer; an ordinary order sends null", async () => {
    await submitFieldSalesOrder({ storeId: "s1", visitId: "v1", lines: baris, preorderWindowId: "clw1" });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ preorderWindowId: "clw1" }));
    await submitFieldSalesOrder({ storeId: "s1", visitId: "v1", lines: baris });
    expect(mockCreate).toHaveBeenLastCalledWith(expect.objectContaining({ preorderWindowId: null }));
  });

  it("a malformed window id is refused before the writer runs", async () => {
    const r = await submitFieldSalesOrder({ storeId: "s1", visitId: "v1", lines: baris, preorderWindowId: "a b" });
    expect(r).toEqual({ ok: false, code: "EMPTY" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it.each(["TUTUP", "BARANG_LUAR", "KONSI"] as const)("maps the writer refusal %s to INDEN_DITOLAK with its reason", async (alasan) => {
    mockCreate.mockRejectedValue(new IndenDitolakError(alasan));
    const r = await submitFieldSalesOrder({ storeId: "s1", visitId: "v1", lines: baris, preorderWindowId: "clw1" });
    expect(r).toEqual({ ok: false, code: "INDEN_DITOLAK", alasan });
  });
});

describe("submitFieldSalesOrder — ubah pesanan (unit)", () => {
  beforeEach(() => {
    mockAuth.mockReset().mockResolvedValue({ user: { id: "u1" } });
    mockCreate.mockReset().mockResolvedValue({ orderId: "o2", orderNo: "PUTUS/2", oversell: [], kreditDitahan: false });
  });

  it("passes the replaced order to the writer; an ordinary order sends null", async () => {
    const r = await submitFieldSalesOrder({ storeId: "s1", visitId: "v1", lines: baris, gantiOrderId: "o1" });
    expect(r).toEqual({ ok: true, orderId: "o2", orderNo: "PUTUS/2", kreditDitahan: false });
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ replacesOrderId: "o1", salesmanId: "u1" }));
    await submitFieldSalesOrder({ storeId: "s1", visitId: "v1", lines: baris });
    expect(mockCreate).toHaveBeenLastCalledWith(expect.objectContaining({ replacesOrderId: null }));
  });

  it("a malformed order id is refused before the writer runs", async () => {
    const r = await submitFieldSalesOrder({ storeId: "s1", visitId: "v1", lines: baris, gantiOrderId: "../o1" });
    expect(r).toEqual({ ok: false, code: "EMPTY" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("maps the writer's refusal to PESANAN_LAMA_TIDAK_BISA_DIGANTI", async () => {
    mockCreate.mockRejectedValue(new PesananLamaTidakBisaDigantiError());
    const r = await submitFieldSalesOrder({ storeId: "s1", visitId: "v1", lines: baris, gantiOrderId: "o1" });
    expect(r).toEqual({ ok: false, code: "PESANAN_LAMA_TIDAK_BISA_DIGANTI" });
  });
});

describe("previewFieldSalesPromos — bonus (unit)", () => {
  beforeEach(() => {
    mockAuth.mockReset().mockResolvedValue({ user: { id: "u1" } });
    mockStore.mockReset().mockResolvedValue({ termsType: "PUTUS" });
    mockInv.mockReset().mockResolvedValue([]);
    mockFetchPromos.mockReset().mockResolvedValue([]);
    mockSusunBonus.mockReset();
  });

  it("returns the bonus lines computed with the cart not yet reserved", async () => {
    mockSusunBonus.mockResolvedValue([
      { promoId: "p", itemId: "i1", variantSku: "", qty: 1, diminta: 1, kurang: 0, promoName: "Beli 6", productName: "Kaos", variantLabel: null },
    ]);
    const r = await previewFieldSalesPromos({ storeId: "s1", lines: baris });
    expect(r.bonus).toEqual([{ promoName: "Beli 6", productName: "Kaos", qty: 1, kurang: 0 }]);
    expect(r.netTotal).toBe(6000);
    expect(mockSusunBonus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ storeId: "s1", pesananBelumDicadangkan: true, lines: [{ itemId: "i1", variantSku: "", qty: 6, productName: "Kaos" }] }),
    );
  });

  it("a pre-order cart does not take ready stock, so the bonus is computed as the writer does (cart not subtracted)", async () => {
    mockSusunBonus.mockResolvedValue([]);
    await previewFieldSalesPromos({ storeId: "s1", lines: baris, inden: true });
    expect(mockSusunBonus).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ pesananBelumDicadangkan: false }));
  });

  it("a failing bonus lookup drops only the bonus rows", async () => {
    mockSusunBonus.mockRejectedValue(new Error("boom"));
    const r = await previewFieldSalesPromos({ storeId: "s1", lines: baris });
    expect(r).toEqual({ lineDiscounts: [0], orderDiscount: 0, netTotal: 6000, bonus: [] });
  });

  it("konsi stores get no bonus preview", async () => {
    mockStore.mockResolvedValue({ termsType: "KONSI" });
    const r = await previewFieldSalesPromos({ storeId: "s1", lines: baris });
    expect(r.bonus).toEqual([]);
    expect(mockSusunBonus).not.toHaveBeenCalled();
  });
});
