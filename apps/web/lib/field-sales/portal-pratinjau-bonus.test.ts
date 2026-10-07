import { describe, it, expect, beforeEach, vi } from "vitest";

/*
 * Pratinjau portal: baris bonus tidak boleh membuka stok.
 *
 * Mesin bonus membatasi pcs gratis ke stok barang hadiah (`alokasikanBonus`):
 * kalau stoknya kurang, `qty` = sisa stok PERSIS. Untuk hadiah yang sama dengan
 * barang yang dipesan, sisa itu = stok − jumlah dipesan, jadi pemegang tautan
 * bisa memesan tepat di ambang portal lalu membaca angka stok lengkap dari
 * baris bonus — melewati pembulatan per 6 pcs. Pratinjau portal karena itu
 * menampilkan HAK bonus menurut promo (`diminta`), bukan yang dibatasi stok;
 * penulis pesanan tetap memberikan sebanyak yang ada dan mencatat kekurangannya.
 */
const h = vi.hoisted(() => ({
  storeFind: vi.fn(),
  itemFind: vi.fn(),
  invFind: vi.fn(),
  bonus: vi.fn(),
}));
vi.mock("@elorae/db", () => ({
  prisma: {
    store: { findUnique: h.storeFind },
    item: { findMany: h.itemFind },
    inventoryValue: { findMany: h.invFind },
  },
}));
vi.mock("@/lib/promos/queries", () => ({ fetchActivePromosForStore: vi.fn().mockResolvedValue([]) }));
vi.mock("./bonus", () => ({ susunBonusPesanan: h.bonus }));
vi.mock("./writer", () => ({ createFieldSalesOrder: vi.fn() }));
vi.mock("@/lib/notifications/kabar-pengguna", () => ({ JENIS_KABAR: { PESANAN_PORTAL: "PESANAN_PORTAL" }, kabariPengguna: vi.fn() }));

import { pratinjauPortal } from "./portal-writer";
import type { AksesPortal } from "./portal-toko";

const akses: AksesPortal = {
  linkId: "l1",
  toko: { id: "t1", name: "Toko", termsType: "PUTUS", salesmanId: "s1", namaSalesman: "S" },
  aturan: { aktif: true, masaBerlakuHari: 90, maksPesananPerHari: 5 },
};

beforeEach(() => {
  for (const f of Object.values(h)) f.mockReset();
  h.storeFind.mockResolvedValue({ termsType: "PUTUS", marginPercent: null });
  // Stok 40 → portal menawarkan 36.
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
      inventoryValues: [{ variantSku: "", qtyOnHand: 40, reservedQty: 0, totalValue: 0 }],
    },
  ]);
  h.invFind.mockResolvedValue([{ itemId: "i1", avgCost: 1000 }]);
});

describe("pratinjauPortal — bonus tanpa angka stok", () => {
  it("bonus yang dibatasi stok tampil sebesar haknya, bukan sisa stok", async () => {
    // Pesan 36 dari stok 40: promo menjanjikan 6 gratis, stok tinggal 4 → mesin memberi 4.
    h.bonus.mockResolvedValue([
      { promoId: "p1", itemId: "i1", variantSku: "", qty: 4, diminta: 6, kurang: 2, promoName: "Beli 6 gratis 1", productName: "Kaos", variantLabel: null },
      // Hadiah lain tanpa stok sama sekali: mesin memberi 0.
      { promoId: "p2", itemId: "i2", variantSku: "", qty: 0, diminta: 2, kurang: 2, promoName: "Topi gratis", productName: "Topi", variantLabel: null },
    ]);
    const r = await pratinjauPortal(akses, [{ itemId: "i1", variantSku: "", qty: 36 }]);
    expect(r).toMatchObject({ ok: true, jenis: "PUTUS", total: 360000 });
    if (!r.ok || r.jenis !== "PUTUS") return;
    expect(r.bonus).toEqual([
      { nama: "Kaos", qty: 6 },
      { nama: "Topi", qty: 2 },
    ]);
    // Sisa stok (4) tidak muncul di mana pun dalam bonus.
    expect(JSON.stringify(r.bonus)).not.toMatch(/4/);
  });

  it("bonus yang terpenuhi penuh tampil apa adanya; tanpa hak bonus tidak ada baris", async () => {
    h.bonus.mockResolvedValue([
      { promoId: "p1", itemId: "i1", variantSku: "", qty: 3, diminta: 3, kurang: 0, promoName: "x", productName: "Kaos", variantLabel: null },
      { promoId: "p3", itemId: "i3", variantSku: "", qty: 0, diminta: 0, kurang: 0, promoName: "y", productName: "Kosong", variantLabel: null },
    ]);
    const r = await pratinjauPortal(akses, [{ itemId: "i1", variantSku: "", qty: 12 }]);
    if (!r.ok || r.jenis !== "PUTUS") throw new Error("bukan PUTUS");
    expect(r.bonus).toEqual([{ nama: "Kaos", qty: 3 }]);
  });
});
