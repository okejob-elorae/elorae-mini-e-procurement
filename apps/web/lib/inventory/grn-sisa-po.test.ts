import { describe, expect, it } from "vitest";
import { adaYangBisaDiisi, bisaDiisiSisa, isiKosongDenganSisa, lebihDariSisa, sisaPo } from "./grn-sisa-po";

describe("sisa PO per baris GRN", () => {
  it("dipesan − sudah diterima, tidak pernah negatif", () => {
    expect(sisaPo({ poOrderedQty: 100, poAlreadyReceivedQty: 50 })).toBe(50);
    expect(sisaPo({ poOrderedQty: 100, poAlreadyReceivedQty: null })).toBe(100);
    expect(sisaPo({ poOrderedQty: 100, poAlreadyReceivedQty: 120 })).toBe(0);
    expect(sisaPo({ poOrderedQty: 10.5, poAlreadyReceivedQty: 0.2 })).toBe(10.3);
  });

  it("baris tanpa PO tidak punya sisa", () => {
    expect(sisaPo({ poOrderedQty: null, poAlreadyReceivedQty: null })).toBeNull();
    expect(sisaPo({})).toBeNull();
    expect(lebihDariSisa({ qty: 999 })).toBe(false);
  });

  it("melebihi sisa = penerimaan lebih", () => {
    expect(lebihDariSisa({ qty: 51, poOrderedQty: 100, poAlreadyReceivedQty: 50 })).toBe(true);
    expect(lebihDariSisa({ qty: 50, poOrderedQty: 100, poAlreadyReceivedQty: 50 })).toBe(false);
  });

  it("kain tidak bisa diisi dengan sisa (qty-nya dari panjang roll)", () => {
    expect(bisaDiisiSisa({ itemType: "FABRIC", qty: 0, poOrderedQty: 100, poAlreadyReceivedQty: 0 })).toBe(false);
    expect(bisaDiisiSisa({ itemType: "ACCESSORIES", qty: 0, poOrderedQty: 100, poAlreadyReceivedQty: 100 })).toBe(false);
    expect(bisaDiisiSisa({ itemType: "ACCESSORIES", qty: 0, poOrderedQty: 100, poAlreadyReceivedQty: 40 })).toBe(true);
  });

  it("isi semua hanya mengisi qty yang masih kosong, tidak menimpa ketikan gudang", () => {
    const baris = [
      { itemType: "ACCESSORIES", qty: 0, poOrderedQty: 100, poAlreadyReceivedQty: 40 },
      { itemType: "ACCESSORIES", qty: 7, poOrderedQty: 20, poAlreadyReceivedQty: 0 },
      { itemType: "FABRIC", qty: 0, poOrderedQty: 50, poAlreadyReceivedQty: 0 },
      { itemType: "ACCESSORIES", qty: 0 },
    ];
    expect(isiKosongDenganSisa(baris).map((b) => b.qty)).toEqual([60, 7, 0, 0]);
    expect(adaYangBisaDiisi(baris)).toBe(true);
    expect(adaYangBisaDiisi(isiKosongDenganSisa(baris))).toBe(false);
  });
});
