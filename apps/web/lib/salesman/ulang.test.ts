import { describe, expect, it } from "vitest";
import { ringkasNama, susunIsiUlang } from "./ulang";

const kaos = {
  itemId: "kaos",
  sku: "KAOS",
  nameId: "Kaos Polo",
  price: 100_000,
  available: 50,
  variants: [
    { variantSku: "KAOS-M", variantLabel: "M", available: 3 },
    { variantSku: "KAOS-L", variantLabel: "L", available: 0 },
  ],
};
const topi = { itemId: "topi", sku: "TOPI", nameId: "Topi", price: 40_000, available: 10, variants: [] };

describe("susunIsiUlang", () => {
  it("puts the old lines back, capped at what is available now", () => {
    const r = susunIsiUlang(
      [kaos, topi],
      [
        { itemId: "kaos", variantSku: "KAOS-M", qty: 6 },
        { itemId: "topi", variantSku: "", qty: 4 },
      ],
      false,
    );
    expect(r.dilewati).toBe(0);
    expect(r.baris).toEqual([
      expect.objectContaining({ itemId: "kaos", variantSku: "KAOS-M", variantLabel: "M", qty: 3, available: 3, unitPrice: 100_000 }),
      expect.objectContaining({ itemId: "topi", variantSku: "", variantLabel: null, qty: 4, available: 10, unitPrice: 40_000 }),
    ]);
  });

  it("skips and counts lines that are sold out or no longer in the catalog", () => {
    const r = susunIsiUlang(
      [kaos],
      [
        { itemId: "kaos", variantSku: "KAOS-L", qty: 2 }, // habis
        { itemId: "hilang", variantSku: "", qty: 1 }, // tidak dijual lagi
        { itemId: "kaos", variantSku: "KAOS-XL", qty: 1 }, // varian tidak ada
      ],
      false,
    );
    expect(r).toEqual({ baris: [], dilewati: 3, tanpaHarga: [] });
  });

  it("never carries a price into a consignment cart", () => {
    const r = susunIsiUlang([topi], [{ itemId: "topi", variantSku: "", qty: 1 }], true);
    expect(r.baris[0].unitPrice).toBe(0);
  });

  // Barang PUTUS tanpa harga dulu masuk keranjang sebagai Rp 0.
  const celana = { itemId: "celana", sku: "CLN", nameId: "Celana Chino", price: null, available: 20, variants: [
    { variantSku: "CLN-30", variantLabel: "30", available: 5 },
    { variantSku: "CLN-32", variantLabel: "32", available: 5 },
  ] };
  const kaus = { itemId: "kaus", sku: "KAUS", nameId: "Kaus Oblong", price: 0, available: 8, variants: [] };
  const syal = { itemId: "syal", sku: "SYAL", nameId: "Syal", price: null, available: 0, variants: [] };

  it("PUTUS: leaves out goods with no price (null or 0) and names each once, keeps the priced lines", () => {
    const r = susunIsiUlang(
      [kaos, celana, kaus],
      [
        { itemId: "celana", variantSku: "CLN-30", qty: 2 },
        { itemId: "kaos", variantSku: "KAOS-M", qty: 2 },
        { itemId: "celana", variantSku: "CLN-32", qty: 2 },
        { itemId: "kaus", variantSku: "", qty: 4 },
      ],
      false,
    );
    expect(r.baris).toEqual([expect.objectContaining({ itemId: "kaos", variantSku: "KAOS-M", qty: 2, unitPrice: 100_000 })]);
    expect(r.baris.every((l) => l.unitPrice > 0)).toBe(true);
    expect(r.tanpaHarga).toEqual(["Celana Chino", "Kaus Oblong"]);
    // Alasan stok tidak tercampur dengan alasan harga.
    expect(r.dilewati).toBe(0);
  });

  it("PUTUS: an unpriced item that is also sold out is reported for its price, not counted as stock", () => {
    const r = susunIsiUlang([syal], [{ itemId: "syal", variantSku: "", qty: 1 }], false);
    expect(r).toEqual({ baris: [], dilewati: 0, tanpaHarga: ["Syal"] });
  });

  it("KONSI: no price is needed (the salesman never sees one) — goods go in at 0 and nothing is reported", () => {
    const r = susunIsiUlang([celana, kaus], [
      { itemId: "celana", variantSku: "CLN-30", qty: 2 },
      { itemId: "kaus", variantSku: "", qty: 1 },
    ], true);
    expect(r.tanpaHarga).toEqual([]);
    expect(r.baris.map((l) => [l.itemId, l.qty, l.unitPrice])).toEqual([["celana", 2, 0], ["kaus", 1, 0]]);
  });
});

describe("ringkasNama", () => {
  it("lists up to three names and counts the rest", () => {
    expect(ringkasNama(["A"])).toEqual({ nama: "A", sisa: 0 });
    expect(ringkasNama(["A", "B", "C"])).toEqual({ nama: "A, B, C", sisa: 0 });
    expect(ringkasNama(["A", "B", "C", "D", "E"])).toEqual({ nama: "A, B, C", sisa: 2 });
    expect(ringkasNama(["A", "B"], 1)).toEqual({ nama: "A", sisa: 1 });
  });
});
