import { describe, expect, it } from "vitest";
import { matchKey } from "./match-key";
import { toVariantStockRecord } from "./variant-stock";

const row = (variantSku: string, qtyOnHand: unknown, reservedQty: unknown) => ({
  variantSku,
  qtyOnHand,
  reservedQty,
});

describe("toVariantStockRecord", () => {
  it("keys each row by its folded variantSku", () => {
    const out = toVariantStockRecord([row("S-RED", 20, 8), row("M-RED", 5, 0)]);
    expect(out).toEqual({
      "s-red": { onHand: 20, available: 12 },
      "m-red": { onHand: 5, available: 5 },
    });
  });

  it("lands differently spelled keys on the same entry", () => {
    const out = toVariantStockRecord([row(" S-RED ", 20, 8)]);
    expect(out[matchKey("s-red")]).toEqual({ onHand: 20, available: 12 });
    expect(out[matchKey("S-RED")]).toBe(out[matchKey(" s-red")]);
  });

  it("keeps a negative available when more is reserved than on hand", () => {
    const out = toVariantStockRecord([row("S-RED", 3, 7)]);
    expect(out["s-red"]).toEqual({ onHand: 3, available: -4 });
  });

  it("sums the null and empty-string spellings of a variantless item into the empty key", () => {
    const out = toVariantStockRecord([row("", 4, 1), row("", 6, 2)]);
    expect(out).toEqual({ "": { onHand: 10, available: 7 } });
  });

  it("converts Decimal-like and string inputs to plain numbers", () => {
    const decimal = (n: number) => ({ toNumber: () => n });
    const out = toVariantStockRecord([row("S-RED", decimal(12.5), decimal(2.5)), row("M-RED", "7", null)]);
    expect(out["s-red"]).toEqual({ onHand: 12.5, available: 10 });
    expect(out["m-red"]).toEqual({ onHand: 7, available: 7 });
  });

  it("returns an empty record for no rows", () => {
    expect(toVariantStockRecord([])).toEqual({});
  });
});
