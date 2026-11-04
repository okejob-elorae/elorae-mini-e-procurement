import { describe, expect, it } from "vitest";
import { labelVarian, susunVarianKirim } from "./varian-kirim";

/**
 * Pemilih varian "Kirim titipan": kunci stoknya harus sama dengan penulis, supaya
 * layar meminta varian tepat ketika penulis akan menolak `VARIAN_WAJIB`.
 */

const katalog = [
  { sku: "BLS-S", size: "S" },
  { sku: "BLS-M", size: "M" },
  { sku: "BLS-L", size: "L" },
];

describe("susunVarianKirim", () => {
  it("barang bervarian: wajib pilih, urut katalog, tersedia = stok − cadangan", () => {
    const p = susunVarianKirim(
      [
        { variantSku: "BLS-M", qtyOnHand: 20, reservedQty: 5 },
        { variantSku: "BLS-L", qtyOnHand: 0, reservedQty: 0 },
        { variantSku: "BLS-S", qtyOnHand: 12, reservedQty: 0 },
      ],
      katalog,
    );
    expect(p.perluVarian).toBe(true);
    expect(p.varian).toEqual([
      { sku: "BLS-S", label: "S (BLS-S)", tersedia: 12 },
      { sku: "BLS-M", label: "M (BLS-M)", tersedia: 15 },
      { sku: "BLS-L", label: "L (BLS-L)", tersedia: 0 },
    ]);
    expect(p.tersediaTanpaVarian).toBeNull();
  });

  it("baris gabungan null di samping varian ikut membuat varian wajib, tapi tidak ditawarkan sebagai varian", () => {
    const p = susunVarianKirim(
      [
        { variantSku: null, qtyOnHand: 7, reservedQty: 0 },
        { variantSku: "BLS-M", qtyOnHand: 3, reservedQty: 0 },
      ],
      katalog,
    );
    expect(p.perluVarian).toBe(true);
    expect(p.varian.map((v) => v.sku)).toEqual(["BLS-M"]);
    expect(p.tersediaTanpaVarian).toBe(7);
  });

  it("barang tanpa varian (null dan \"\" kembar): tidak wajib pilih, stok = yang terkecil", () => {
    const p = susunVarianKirim(
      [
        { variantSku: null, qtyOnHand: 9, reservedQty: 0 },
        { variantSku: "", qtyOnHand: 4, reservedQty: 1 },
      ],
      null,
    );
    expect(p).toEqual({ perluVarian: false, varian: [], tersediaTanpaVarian: 3 });
  });

  it("satu baris varian saja: tidak wajib pilih (penulis memakai baris itu), variannya tetap terlihat", () => {
    const p = susunVarianKirim([{ variantSku: "BLS-M", qtyOnHand: 8, reservedQty: 0 }], katalog);
    expect(p.perluVarian).toBe(false);
    expect(p.varian).toEqual([{ sku: "BLS-M", label: "M (BLS-M)", tersedia: 8 }]);
  });

  it("varian tersimpan sebagai teks JSON berkunci besar tetap terbaca labelnya; sku asing jatuh ke belakang", () => {
    const p = susunVarianKirim(
      [
        { variantSku: "ZZZ", qtyOnHand: 1, reservedQty: 0 },
        { variantSku: "BLS-M", qtyOnHand: 2, reservedQty: 0 },
      ],
      JSON.stringify([{ SKU: "BLS-M", size: "M" }]),
    );
    expect(p.varian).toEqual([
      { sku: "BLS-M", label: "M (BLS-M)", tersedia: 2 },
      { sku: "ZZZ", label: "ZZZ", tersedia: 1 },
    ]);
  });

  it("tanpa baris stok sama sekali: tidak ada yang bisa dikirim", () => {
    expect(susunVarianKirim([], katalog)).toEqual({ perluVarian: false, varian: [], tersediaTanpaVarian: null });
  });
});

describe("labelVarian", () => {
  it("label katalog, sku bila tidak dikenal, null untuk tanpa varian", () => {
    expect(labelVarian(katalog, "BLS-L")).toBe("L (BLS-L)");
    expect(labelVarian(katalog, "X-1")).toBe("X-1");
    expect(labelVarian(katalog, "")).toBeNull();
  });
});
