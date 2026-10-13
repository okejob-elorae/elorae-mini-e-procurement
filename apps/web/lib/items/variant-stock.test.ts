import { describe, expect, it } from "vitest";
import { toVariantStockRecord } from "./variant-stock";

const row = (variantSku: string, qtyOnHand: unknown, reservedQty: unknown) => ({
  variantSku,
  qtyOnHand,
  reservedQty,
});

describe("toVariantStockRecord", () => {
  it("keys each row by its variantSku spelling", () => {
    const out = toVariantStockRecord([row("S-RED", 20, 8), row("M-RED", 5, 0)]);
    expect(out).toEqual({
      "S-RED": { onHand: 20, available: 12 },
      "M-RED": { onHand: 5, available: 5 },
    });
  });

  it("keeps a negative available when more is reserved than on hand", () => {
    const out = toVariantStockRecord([row("S-RED", 3, 7)]);
    expect(out["S-RED"]).toEqual({ onHand: 3, available: -4 });
  });

  it("sums the null and empty-string spellings of a variantless item into the empty key", () => {
    const out = toVariantStockRecord([row("", 4, 1), row("", 6, 2)]);
    expect(out).toEqual({ "": { onHand: 10, available: 7 } });
  });

  it("converts Decimal-like and string inputs to plain numbers", () => {
    const decimal = (n: number) => ({ toNumber: () => n });
    const out = toVariantStockRecord([row("S-RED", decimal(12.5), decimal(2.5)), row("M-RED", "7", null)]);
    expect(out["S-RED"]).toEqual({ onHand: 12.5, available: 10 });
    expect(out["M-RED"]).toEqual({ onHand: 7, available: 7 });
  });

  it("returns an empty record for no rows", () => {
    expect(toVariantStockRecord([])).toEqual({});
  });
});
