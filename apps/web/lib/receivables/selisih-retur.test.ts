import { describe, expect, it } from "vitest";
import { keluarBukuSusulan, kunciBarangRetur, kurangPerBarang, sisaSelisih } from "./selisih-retur";

describe("kunciBarangRetur", () => {
  it("barang + ukuran, atau nama untuk baris tanpa barang", () => {
    expect(kunciBarangRetur({ itemId: "i1", variantSku: " M ", itemName: "Kaos" })).toBe("i1::M");
    expect(kunciBarangRetur({ itemId: "i1", variantSku: null, itemName: "Kaos" })).toBe("i1::");
    expect(kunciBarangRetur({ itemId: null, variantSku: null, itemName: " Kaos merah " })).toBe("nama::Kaos merah");
  });
});

describe("kurangPerBarang", () => {
  const klaim = [
    { itemId: "i1", variantSku: "M", itemName: "Kaos", qty: 5 },
    { itemId: "i1", variantSku: "L", itemName: "Kaos", qty: 3 },
    { itemId: null, variantSku: null, itemName: "Topi", qty: 2 },
  ];

  it("per ukuran dan baris nama; barang rusak tetap terhitung diterima", () => {
    const r = kurangPerBarang(klaim, [
      { itemId: "i1", variantSku: "M", itemName: "Kaos", qty: 2 },
      { itemId: "i1", variantSku: "M", itemName: "Kaos", qty: 1 },
      { itemId: null, variantSku: null, itemName: "Topi", qty: 2 },
    ]);
    expect(r.map((x) => [x.kunci, x.qtyKurang])).toEqual([
      ["i1::M", 2],
      ["i1::L", 3],
      ["nama::Topi", 0],
    ]);
  });

  it("hitungan susulan dijumlah; kelebihan tidak pernah negatif", () => {
    const r = kurangPerBarang(klaim.slice(0, 1), [
      { itemId: "i1", variantSku: "M", itemName: "Kaos", qty: 4 },
      { itemId: "i1", variantSku: "M", itemName: "Kaos", qty: 3 },
    ]);
    expect(r[0]).toMatchObject({ qtyKlaim: 5, qtyDiterima: 7, qtyKurang: 0 });
  });
});

describe("sisaSelisih", () => {
  it("klaim − fisik dalam sen; belum dihitung = seluruh klaim; tidak negatif", () => {
    expect(sisaSelisih(300_000, 100_000)).toBe(200_000);
    expect(sisaSelisih(300_000, null)).toBe(300_000);
    expect(sisaSelisih(300_000, 350_000)).toBe(0);
    expect(sisaSelisih(100.3, 0.1)).toBe(100.2);
  });
});

describe("keluarBukuSusulan", () => {
  const nrt = new Date("2026-10-01T03:00:00Z");
  const sesudah = new Date("2026-10-10T03:00:00Z");
  const sebelum = new Date("2026-09-20T03:00:00Z");
  const keluarNrt = [{ itemId: "i1", variantSku: "M", pertama: nrt }];

  it("tanpa opname sesudah nota keluar: tidak ada yang dikeluarkan", () => {
    expect(
      keluarBukuSusulan({ susulan: [{ itemId: "i1", variantSku: "M", qty: 3 }], keluarNrt, opnamePlus: [], sudahSusulan: [] }),
    ).toEqual([]);
  });

  it("opname menemukan 2, susulan 3 → 2", () => {
    expect(
      keluarBukuSusulan({
        susulan: [{ itemId: "i1", variantSku: "M", qty: 3 }],
        keluarNrt,
        opnamePlus: [{ itemId: "i1", variantSku: "M", qty: 2, pada: sesudah }],
        sudahSusulan: [],
      }),
    ).toEqual([{ itemId: "i1", variantSku: "M", qty: 2 }]);
  });

  it("susulan kedua hanya mendapat sisanya", () => {
    expect(
      keluarBukuSusulan({
        susulan: [{ itemId: "i1", variantSku: "M", qty: 3 }],
        keluarNrt,
        opnamePlus: [{ itemId: "i1", variantSku: "M", qty: 2, pada: sesudah }],
        sudahSusulan: [{ itemId: "i1", variantSku: "M", qty: 2 }],
      }),
    ).toEqual([]);
  });

  it("kelebihan opname SEBELUM nota retur keluar diabaikan", () => {
    expect(
      keluarBukuSusulan({
        susulan: [{ itemId: "i1", variantSku: "M", qty: 3 }],
        keluarNrt,
        opnamePlus: [{ itemId: "i1", variantSku: "M", qty: 5, pada: sebelum }],
        sudahSusulan: [],
      }),
    ).toEqual([]);
  });
});
