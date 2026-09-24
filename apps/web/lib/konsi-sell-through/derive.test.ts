import { describe, it, expect } from "vitest";
import { deriveSellThroughLines, applyResolution, isLineHeld, UnknownLedgerRefTypeError, InvalidResolutionError } from "./derive";

const row = (refType: string, qty: number, itemId = "i1", variantSku = "") => ({ itemId, variantSku, qty, refType, refId: `${refType}-x` });

describe("deriveSellThroughLines", () => {
  it("classifies each refType into its bucket and derives the closing balance", () => {
    const [l] = deriveSellThroughLines({
      method: "SPG_POS",
      openings: [{ itemId: "i1", variantSku: "", qty: 10 }],
      rows: [row("KonsiTransfer", 6), row("StoreTransfer", 2), row("StoreTransfer", -1), row("FieldReturn", -3), row("SpgSale", -4), row("StoreStocktake", -2)],
      counted: [{ itemId: "i1", variantSku: "", countedQty: 8, cause: "SHRINKAGE" }],
    });
    expect(l).toMatchObject({ openingQty: 10, inQty: 8, outQty: 4, posSoldQty: 4, gapQty: 2, closingQty: 8, countedQty: 8 });
  });

  it("SHELF_COUNT bills opening + in − out − closing and never holds", () => {
    const [l] = deriveSellThroughLines({
      method: "SHELF_COUNT",
      openings: [{ itemId: "i1", variantSku: "", qty: 10 }],
      rows: [row("KonsiTransfer", 5), row("StoreStocktake", -9)],
      counted: [{ itemId: "i1", variantSku: "", countedQty: 6, cause: null }],
    });
    expect(l.billedQty).toBe(9);
    expect(l.suggestedResolution).toBeNull();
    expect(isLineHeld({ gapQty: l.gapQty, resolution: null }, "SHELF_COUNT")).toBe(false);
  });

  it("SHELF_COUNT clamps a negative sold figure to 0 and flags it", () => {
    const [l] = deriveSellThroughLines({
      method: "SHELF_COUNT",
      openings: [{ itemId: "i1", variantSku: "", qty: 2 }],
      rows: [row("StoreStocktake", 3)],
      counted: [{ itemId: "i1", variantSku: "", countedQty: 5, cause: null }],
    });
    expect(l.billedQty).toBe(0);
    expect(l.negativeSold).toBe(true);
  });

  it("SPG_POS bills POS by default, holds a gap, and prefills from the stocktake cause", () => {
    const [l] = deriveSellThroughLines({
      method: "SPG_POS",
      openings: [{ itemId: "i1", variantSku: "", qty: 10 }],
      rows: [row("SpgSale", -4), row("StoreStocktake", -2)],
      counted: [{ itemId: "i1", variantSku: "", countedQty: 4, cause: "UNRECORDED_SALE" }],
    });
    expect(l.billedQty).toBe(4);
    expect(l.gapQty).toBe(2);
    expect(l.suggestedResolution).toBe("BILL");
    expect(isLineHeld({ gapQty: l.gapQty, resolution: null }, "SPG_POS")).toBe(true);
    expect(isLineHeld({ gapQty: l.gapQty, resolution: "BILL" }, "SPG_POS")).toBe(false);
  });

  it("gives an item with no stocktake line a line with its ledger-derived closing", () => {
    const lines = deriveSellThroughLines({ method: "SPG_POS", openings: [], rows: [row("KonsiTransfer", 3, "late")], counted: [] });
    expect(lines).toEqual([expect.objectContaining({ itemId: "late", closingQty: 3, countedQty: null, gapQty: 0 })]);
  });

  it("treats OpeningBalance rows as opening, not movement", () => {
    const [l] = deriveSellThroughLines({ method: "SPG_POS", openings: [], rows: [row("OpeningBalance", 7), row("SpgSale", -1)], counted: [] });
    expect(l).toMatchObject({ openingQty: 7, inQty: 0, posSoldQty: 1, closingQty: 6 });
  });

  it("refuses an unknown refType", () => {
    expect(() => deriveSellThroughLines({ method: "SPG_POS", openings: [], rows: [row("Mystery", 1)], counted: [] })).toThrow(UnknownLedgerRefTypeError);
  });

  it("drops a key with nothing at all (zero opening, no rows, no count)", () => {
    expect(deriveSellThroughLines({ method: "SPG_POS", openings: [{ itemId: "z", variantSku: "", qty: 0 }], rows: [], counted: [] })).toEqual([]);
  });
});

describe("applyResolution", () => {
  it("BILL adds a shortfall to billed; SHRINKAGE writes it off and needs a reason", () => {
    expect(applyResolution({ posSoldQty: 4, gapQty: 2 }, "SPG_POS", "BILL", null)).toEqual({ billedQty: 6, shrinkageQty: 0, resolutionReason: null });
    expect(applyResolution({ posSoldQty: 4, gapQty: 2 }, "SPG_POS", "SHRINKAGE", "Hilang di toko")).toEqual({ billedQty: 4, shrinkageQty: 2, resolutionReason: "Hilang di toko" });
    expect(() => applyResolution({ posSoldQty: 4, gapQty: 2 }, "SPG_POS", "SHRINKAGE", "  ")).toThrow(InvalidResolutionError);
  });

  it("a surplus resolves BILL_POS or REDUCE (floored at 0, reason required)", () => {
    expect(applyResolution({ posSoldQty: 4, gapQty: -1 }, "SPG_POS", "BILL_POS", null)).toEqual({ billedQty: 4, shrinkageQty: 0, resolutionReason: null });
    expect(applyResolution({ posSoldQty: 4, gapQty: -1 }, "SPG_POS", "REDUCE", "Salah input POS")).toEqual({ billedQty: 3, shrinkageQty: 0, resolutionReason: "Salah input POS" });
    expect(applyResolution({ posSoldQty: 1, gapQty: -5 }, "SPG_POS", "REDUCE", "x").billedQty).toBe(0);
  });

  it("refuses the wrong arm for the gap sign, and any resolution on SHELF_COUNT or a zero gap", () => {
    expect(() => applyResolution({ posSoldQty: 4, gapQty: 2 }, "SPG_POS", "REDUCE", "x")).toThrow(InvalidResolutionError);
    expect(() => applyResolution({ posSoldQty: 4, gapQty: -1 }, "SPG_POS", "BILL", null)).toThrow(InvalidResolutionError);
    expect(() => applyResolution({ posSoldQty: 4, gapQty: 2 }, "SHELF_COUNT", "BILL", null)).toThrow(InvalidResolutionError);
    expect(() => applyResolution({ posSoldQty: 4, gapQty: 0 }, "SPG_POS", "BILL", null)).toThrow(InvalidResolutionError);
  });
});
