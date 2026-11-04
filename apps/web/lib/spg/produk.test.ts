import { describe, expect, it } from "vitest";
import { bacaTambahan } from "./saran-minta";
import {
  alamatMintaProduk,
  alamatTitipProduk,
  barisVarianProduk,
  labelGudang,
  promoMenyasarBarang,
  tersediaGudang,
  tokoLainTeratas,
} from "./produk";

describe("labelGudang", () => {
  it("10 or more is in stock, 1–9 is running low, 0 or less is out", () => {
    expect(labelGudang(10)).toBe("ADA");
    expect(labelGudang(250)).toBe("ADA");
    expect(labelGudang(9)).toBe("SEDIKIT");
    expect(labelGudang(1)).toBe("SEDIKIT");
    expect(labelGudang(0.5)).toBe("SEDIKIT");
    expect(labelGudang(0)).toBe("KOSONG");
    expect(labelGudang(-3)).toBe("KOSONG");
    expect(labelGudang(Number.NaN)).toBe("KOSONG");
  });
});

describe("tersediaGudang", () => {
  const baris = [
    { variantSku: "K-M", qtyOnHand: "8", reservedQty: "2" },
    { variantSku: "K-L", qtyOnHand: 3, reservedQty: 3 },
    { variantSku: null, qtyOnHand: 5, reservedQty: 1 },
  ];
  it("a variant counts its own rows plus the pooled row (on hand − reserved)", () => {
    expect(tersediaGudang(baris, "K-M", true)).toBe(6 + 4);
    expect(tersediaGudang(baris, "K-L", true)).toBe(0 + 4);
    expect(tersediaGudang(baris, "K-XL", true)).toBe(4);
  });
  it("a negative pooled row never lowers a variant", () => {
    expect(tersediaGudang([{ variantSku: "A", qtyOnHand: 3, reservedQty: 0 }, { variantSku: "", qtyOnHand: 0, reservedQty: 2 }], "A", true)).toBe(3);
  });
  it("a simple item sums every row", () => {
    expect(tersediaGudang([{ variantSku: null, qtyOnHand: 4, reservedQty: 1 }, { variantSku: "", qtyOnHand: 1, reservedQty: 0 }], "", false)).toBe(4);
  });
});

describe("tokoLainTeratas", () => {
  it("keeps positive stock only, most first, at most five", () => {
    const b = [
      { nama: "B", qty: 2 },
      { nama: "A", qty: 2 },
      { nama: "C", qty: 0 },
      { nama: "D", qty: -1 },
      { nama: "E", qty: 9 },
      { nama: "F", qty: 1 },
      { nama: "G", qty: 3 },
      { nama: "H", qty: 4 },
    ];
    expect(tokoLainTeratas(b)).toEqual([
      { nama: "E", qty: 9 },
      { nama: "H", qty: 4 },
      { nama: "G", qty: 3 },
      { nama: "A", qty: 2 },
      { nama: "B", qty: 2 },
    ]);
  });
});

describe("promoMenyasarBarang", () => {
  it("all goods, the item itself, or its category", () => {
    expect(promoMenyasarBarang({ allItems: true, itemIds: [], categoryIds: [] }, "i1", null)).toBe(true);
    expect(promoMenyasarBarang({ allItems: false, itemIds: ["i1"], categoryIds: [] }, "i1", null)).toBe(true);
    expect(promoMenyasarBarang({ allItems: false, itemIds: [], categoryIds: ["c1"] }, "i1", "c1")).toBe(true);
    expect(promoMenyasarBarang({ allItems: false, itemIds: ["i2"], categoryIds: ["c2"] }, "i1", "c1")).toBe(false);
    expect(promoMenyasarBarang({ allItems: false, itemIds: [], categoryIds: ["c1"] }, "i1", null)).toBe(false);
  });
});

describe("barisVarianProduk", () => {
  it("reads arrays and JSON text, any key case, skips rows without a SKU and duplicates", () => {
    expect(
      barisVarianProduk([{ sku: "A-M", size: "M", barcode: "899" }, { size: "L" }, { SKU: "A-L", Barcode: " " }, { sku: "a-m" }]),
    ).toEqual([
      { sku: "A-M", barcode: "899" },
      { sku: "A-L", barcode: null },
    ]);
    expect(barisVarianProduk('[{"Sku":"B-S"}]')).toEqual([{ sku: "B-S", barcode: null }]);
    expect(barisVarianProduk("rusak")).toEqual([]);
    expect(barisVarianProduk(null)).toEqual([]);
  });
});

describe("alamat tombol", () => {
  it("hold request carries the item and, when chosen, the variant", () => {
    expect(alamatTitipProduk("itm1", "A-M")).toBe("/pwa/spg/titip/baru?itemId=itm1&variantSku=A-M");
    expect(alamatTitipProduk("itm1", "")).toBe("/pwa/spg/titip/baru?itemId=itm1");
  });
  it("stock request pre-fills one piece that the request form reads back", () => {
    const alamat = alamatMintaProduk("itm1", "A~M/1");
    expect(alamat.startsWith("/pwa/spg/stok/minta?tambah=")).toBe(true);
    const tambah = new URL(alamat, "https://x").searchParams.get("tambah");
    expect(bacaTambahan(tambah)).toEqual([{ itemId: "itm1", variantSku: "A~M/1", qty: 1, alasan: "MANUAL" }]);
  });
});
