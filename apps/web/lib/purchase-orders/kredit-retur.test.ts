import { describe, expect, it } from "vitest";
import { hitungKreditRetur } from "./kredit-retur";

/*
 * Retur ke pemasok mengurangi utang PO sebesar harga BELI barang yang diretur
 * (harga baris PO, ditambah PPN bila baris itu "Exclude PPN"), bukan harga
 * rata-rata stok: yang kita utangi ke pemasok adalah harga di PO.
 */

const BARIS_PO = [
  { itemId: "kaos", variantSku: null, price: 85_000, ppnIncluded: false },
  { itemId: "celana", variantSku: "CLN-M", price: 50_000, ppnIncluded: true },
  { itemId: "celana", variantSku: "CLN-L", price: 55_000, ppnIncluded: true },
];

describe("hitungKreditRetur", () => {
  it("harga PO + PPN baris 'Exclude PPN'; baris 'Include PPN' apa adanya", () => {
    const hasil = hitungKreditRetur(BARIS_PO, 11, [
      { itemId: "kaos", variantSku: null, qty: 2 },
      { itemId: "celana", variantSku: "CLN-M", qty: 3 },
    ]);
    // 2 × 85.000 = 170.000 (+11% = 18.700) ; 3 × 50.000 = 150.000 (sudah termasuk PPN).
    expect(hasil.dasar).toBe(320_000);
    expect(hasil.ppn).toBe(18_700);
    expect(hasil.kredit).toBe(338_700);
    expect(hasil.tanpaPadanan).toEqual([]);
    expect(hasil.rincian).toEqual([
      { itemId: "kaos", variantSku: null, qty: 2, harga: 85_000, ppnIncluded: false, nilai: 170_000 },
      { itemId: "celana", variantSku: "CLN-M", qty: 3, harga: 50_000, ppnIncluded: true, nilai: 150_000 },
    ]);
  });

  it("varian kosong dan null dianggap sama", () => {
    const hasil = hitungKreditRetur(BARIS_PO, 11, [{ itemId: "kaos", variantSku: "", qty: 1 }]);
    expect(hasil.kredit).toBe(94_350);
  });

  it("baris PO tanpa varian dipakai untuk retur bervarian barang yang sama", () => {
    const hasil = hitungKreditRetur(BARIS_PO, 11, [{ itemId: "kaos", variantSku: "KAOS-XL", qty: 1 }]);
    expect(hasil.kredit).toBe(94_350);
  });

  it("barang yang tidak ada di PO tidak mengurangi utang PO ini", () => {
    const hasil = hitungKreditRetur(BARIS_PO, 11, [
      { itemId: "topi", variantSku: null, qty: 5 },
      { itemId: "kaos", variantSku: null, qty: 1 },
    ]);
    expect(hasil.kredit).toBe(94_350);
    expect(hasil.tanpaPadanan).toEqual([{ itemId: "topi", variantSku: null, qty: 5, sebab: "TIDAK_ADA_DI_PO" }]);
  });

  it("varian tak disebut dan harga antarvarian berbeda: tidak ditebak", () => {
    const hasil = hitungKreditRetur(BARIS_PO, 11, [{ itemId: "celana", variantSku: null, qty: 2 }]);
    expect(hasil.kredit).toBe(0);
    expect(hasil.tanpaPadanan).toEqual([
      { itemId: "celana", variantSku: null, qty: 2, sebab: "HARGA_VARIAN_BERBEDA" },
    ]);
  });

  it("varian tak disebut tetapi semua varian berharga sama: dipakai", () => {
    const po = [
      { itemId: "kain", variantSku: "KN-HITAM", price: 40_000, ppnIncluded: false },
      { itemId: "kain", variantSku: "KN-PUTIH", price: 40_000, ppnIncluded: false },
    ];
    // 2,5 m × 40.000 = 100.000; 11% = 11.000.
    const hasil = hitungKreditRetur(po, 11, [{ itemId: "kain", variantSku: null, qty: "2.5" }]);
    expect(hasil.kredit).toBe(111_000);
  });

  it("PO lama (tarif PPN tidak tercatat): tanpa PPN, sama seperti total PO-nya", () => {
    const hasil = hitungKreditRetur(BARIS_PO, null, [{ itemId: "kaos", variantSku: null, qty: 2 }]);
    expect(hasil.kredit).toBe(170_000);
    expect(hasil.ppn).toBe(0);
  });

  it("qty nol atau tidak sah tidak dihitung", () => {
    const hasil = hitungKreditRetur(BARIS_PO, 11, [
      { itemId: "kaos", variantSku: null, qty: 0 },
      { itemId: "kaos", variantSku: null, qty: "abc" },
    ]);
    expect(hasil.kredit).toBe(0);
    expect(hasil.rincian).toEqual([]);
  });
});
