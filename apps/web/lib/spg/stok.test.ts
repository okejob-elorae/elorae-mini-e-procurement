import { describe, expect, it } from "vitest";
import { cocokkanKode, hampirHabis, kunciBaris, perkiraanKomisi, rencanaOpname, saldoDariGerakan } from "./stok";

describe("saldoDariGerakan", () => {
  it("sums signed movements per item + variant", () => {
    const saldo = saldoDariGerakan([
      { itemId: "a", variantSku: "a-M", qty: 10 },
      { itemId: "a", variantSku: "a-M", qty: -3 },
      { itemId: "a", variantSku: "a-L", qty: 4 },
    ]);
    expect(saldo.get(kunciBaris("a", "a-M"))).toBe(7);
    expect(saldo.get(kunciBaris("a", "a-L"))).toBe(4);
  });

  it("treats a missing variant as the same key as an empty one", () => {
    // Barang tanpa varian tercatat "" di satu tempat dan null di tempat lain;
    // keduanya harus jatuh ke saldo yang sama.
    const saldo = saldoDariGerakan([
      { itemId: "b", variantSku: "", qty: 5 },
      { itemId: "b", variantSku: null, qty: -2 },
    ]);
    expect(saldo.get(kunciBaris("b", null))).toBe(3);
  });

  it("keeps a negative balance instead of clamping it — the sale really happened", () => {
    expect(saldoDariGerakan([{ itemId: "c", variantSku: "", qty: -2 }]).get(kunciBaris("c", ""))).toBe(-2);
  });
});

describe("rencanaOpname", () => {
  it("records the system figure beside the count and moves only the difference", () => {
    const saldo = new Map([[kunciBaris("a", "a-M"), 7]]);
    const r = rencanaOpname([{ itemId: "a", variantSku: "a-M", qtyCounted: 5 }], saldo);
    expect(r).toEqual([{ itemId: "a", variantSku: "a-M", qtySystem: 7, qtyCounted: 5, selisih: -2 }]);
  });

  it("treats an item with no history as zero on the books — the first count is the opening stock", () => {
    const r = rencanaOpname([{ itemId: "z", variantSku: "", qtyCounted: 12 }], new Map());
    expect(r[0]).toMatchObject({ qtySystem: 0, selisih: 12 });
  });

  it("merges the same item counted twice instead of recording two lines", () => {
    const r = rencanaOpname(
      [
        { itemId: "a", variantSku: "a-M", qtyCounted: 2 },
        { itemId: "a", variantSku: "a-M", qtyCounted: 3 },
      ],
      new Map(),
    );
    expect(r).toHaveLength(1);
    expect(r[0].qtyCounted).toBe(5);
  });
});

describe("cocokkanKode", () => {
  const katalog = [
    { itemId: "i1", sku: "KMJ-01", variantSku: "KMJ-01-M", barcode: "8991234567001" },
    { itemId: "i1", sku: "KMJ-01", variantSku: "KMJ-01-L", barcode: null },
    { itemId: "i2", sku: "TOPI-9", variantSku: null, barcode: null },
  ];

  it("matches a variant barcode first", () => {
    expect(cocokkanKode("8991234567001", katalog)).toEqual({ jenis: "varian", itemId: "i1", variantSku: "KMJ-01-M" });
  });

  it("matches a variant SKU, ignoring case and stray spaces from the scanner", () => {
    expect(cocokkanKode("  kmj-01-l ", katalog)).toEqual({ jenis: "varian", itemId: "i1", variantSku: "KMJ-01-L" });
  });

  it("matches a simple item by its SKU", () => {
    expect(cocokkanKode("TOPI-9", katalog)).toEqual({ jenis: "varian", itemId: "i2", variantSku: null });
  });

  it("asks for the size when only the parent SKU of a variant item was scanned", () => {
    expect(cocokkanKode("KMJ-01", katalog)).toEqual({ jenis: "barang", itemId: "i1" });
  });

  it("returns nothing for an unknown or empty code", () => {
    expect(cocokkanKode("???", katalog)).toBeNull();
    expect(cocokkanKode("   ", katalog)).toBeNull();
  });
});

describe("hampirHabis", () => {
  it("lists items at or below the threshold, lowest first, including negatives", () => {
    const baris = [
      { key: "a", qty: 5 },
      { key: "b", qty: 1 },
      { key: "c", qty: -1 },
      { key: "d", qty: 2 },
    ];
    expect(hampirHabis(baris, 2).map((b) => b.key)).toEqual(["c", "b", "d"]);
  });
});

describe("perkiraanKomisi", () => {
  it("multiplies units sold by each item's commission and splits it between the store's SPGs", () => {
    expect(
      perkiraanKomisi(
        [
          { qty: 3, commissionPerPcs: 5_000 },
          { qty: 2, commissionPerPcs: 2_500 },
        ],
        2,
      ),
    ).toEqual({ totalToko: 20_000, bagianSaya: 10_000 });
  });

  it("gives the whole amount to a lone SPG and nothing when nobody is counted", () => {
    expect(perkiraanKomisi([{ qty: 1, commissionPerPcs: 7_000 }], 1).bagianSaya).toBe(7_000);
    expect(perkiraanKomisi([{ qty: 1, commissionPerPcs: 7_000 }], 0).bagianSaya).toBe(0);
  });
});
