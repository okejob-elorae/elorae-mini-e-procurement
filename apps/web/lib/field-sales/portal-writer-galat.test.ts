import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Unit: galat penulis pesanan → kode yang aman untuk toko. Prisma dan penulis
 * ditirukan; yang dipasak adalah bahwa alasan internal (angka tagihan, alasan
 * kredit) TIDAK PERNAH sampai ke jawaban portal.
 */
const h = vi.hoisted(() => ({
  create: vi.fn(),
  storeFind: vi.fn(),
  itemFind: vi.fn(),
  orderFind: vi.fn(),
  orderCount: vi.fn(),
  linkUpdate: vi.fn(),
  kabar: vi.fn(),
}));
vi.mock("@elorae/db", () => ({
  prisma: {
    store: { findUnique: h.storeFind },
    item: { findMany: h.itemFind },
    fieldSalesOrder: { findUnique: h.orderFind, count: h.orderCount },
    storePortalLink: { updateMany: h.linkUpdate },
  },
}));
vi.mock("./writer", () => ({ createFieldSalesOrder: h.create }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({
  JENIS_KABAR: { PESANAN_PORTAL: "PESANAN_PORTAL" },
  kabariPengguna: h.kabar,
}));

import { KreditDiblokirError } from "./kredit-pesanan";
import { kirimPesananPortal } from "./portal-writer";
import type { AksesPortal } from "./portal-toko";

const akses: AksesPortal = {
  linkId: "l1",
  toko: { id: "t1", name: "Toko", termsType: "PUTUS", salesmanId: "s1", namaSalesman: "S" },
  aturan: { aktif: true, masaBerlakuHari: 90, maksPesananPerHari: 5 },
};
const input = { lines: [{ itemId: "i1", variantSku: "", qty: 2 }], idempotencyKey: "kunci-uji-1" };

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.storeFind.mockResolvedValue({ termsType: "PUTUS", markupPercent: null, priceDiscountPercent: null });
  h.itemFind.mockResolvedValue([
    {
      id: "i1",
      sku: "K1",
      nameId: "Kaos",
      categoryId: null,
      category: null,
      sellingPrice: 10000,
      minOrderQty: null,
      variants: null,
      inventoryValues: [{ variantSku: "", qtyOnHand: 50, reservedQty: 0, totalValue: 0 }],
    },
  ]);
  h.orderFind.mockResolvedValue(null);
  h.orderCount.mockResolvedValue(0);
});

describe("kirimPesananPortal — galat penulis", () => {
  it("a credit block becomes 'contact your salesperson' with no reason or figure", async () => {
    h.create.mockRejectedValue(new KreditDiblokirError([{ kode: "MELEBIHI_BATAS_NILAI", sisaSesudah: 4_200_000, batas: 1_000_000 }]));
    const r = await kirimPesananPortal(akses, input);
    expect(r).toEqual({ ok: false, code: "HUBUNGI_SALESMAN" });
    expect(JSON.stringify(r)).not.toMatch(/\d{4,}|BATAS|alasan|sisa/i);
    expect(h.kabar).not.toHaveBeenCalled();
  });

  it("an unexpected error is a plain GAGAL; the log names the link, never a token", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.create.mockRejectedValue(new Error("connection reset"));
    expect(await kirimPesananPortal(akses, input)).toEqual({ ok: false, code: "GAGAL" });
    expect(log).toHaveBeenCalledWith("[portal-toko] kirim pesanan gagal", { linkId: "l1", storeId: "t1" }, expect.any(Error));
    log.mockRestore();
  });

  it("the writer gets the holder, the PORTAL channel, a link-scoped key, and server-built lines only", async () => {
    h.create.mockResolvedValue({ orderId: "o1", orderNo: "PUTUS/9", oversell: [], kreditDitahan: true });
    h.orderFind.mockResolvedValueOnce(null).mockResolvedValueOnce({ total: 20000 });
    const r = await kirimPesananPortal(akses, { ...input, lines: [{ ...input.lines[0], unitPrice: 1, requestedUnitPrice: 1 }] });
    // Kredit "ditahan" tidak diberitahukan ke toko: pesanannya cukup menunggu persetujuan.
    expect(r).toEqual({ ok: true, jenis: "PUTUS", orderNo: "PUTUS/9", total: 20000, ulang: false });
    expect(h.create).toHaveBeenCalledWith({
      storeId: "t1",
      salesmanId: "s1",
      lines: [{ itemId: "i1", variantSku: "", productName: "Kaos", qty: 2, unitPrice: 10000 }],
      note: undefined,
      idempotencyKey: "portal:l1:kunci-uji-1",
      remoteChannel: "PORTAL",
      // Batas harian dihitung ulang DI DALAM transaksi penulis, sejak awal hari WIB.
      batasHarianPortal: { maks: 5, sejak: expect.any(Date) },
    });
  });

  it("the writer's in-transaction daily cap comes back as BATAS_HARIAN, with nothing told to the holder", async () => {
    const { BatasHarianPortalError } = await import("./portal-toko-batas");
    h.create.mockRejectedValue(new BatasHarianPortalError(5));
    expect(await kirimPesananPortal(akses, input)).toEqual({ ok: false, code: "BATAS_HARIAN", batas: 5 });
  });

  it("a replayed key that somehow belongs to another store is refused, not returned", async () => {
    h.orderFind.mockResolvedValue({ orderNo: "PUTUS/1", orderType: "PUTUS", total: 1, storeId: "toko-lain" });
    expect(await kirimPesananPortal(akses, input)).toEqual({ ok: false, code: "GAGAL" });
    expect(h.create).not.toHaveBeenCalled();
  });
});
