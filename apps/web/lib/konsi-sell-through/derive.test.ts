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

describe("deriveSellThroughLines — late movements", () => {
  it("adds a late delta into its key's figures before closing and billing, and flags the line", () => {
    const [l] = deriveSellThroughLines({
      method: "SHELF_COUNT",
      openings: [{ itemId: "i1", variantSku: "", qty: 2 }],
      rows: [],
      counted: [{ itemId: "i1", variantSku: "", countedQty: 1, cause: null }],
      lateMovements: [{ itemId: "i1", variantSku: "", inQty: 0, outQty: 0, posSold: 1, gap: 0 }],
    });
    expect(l).toMatchObject({
      openingQty: 2,
      posSoldQty: 1,
      closingQty: 1,
      billedQty: 1,
      lateInQty: 0,
      lateOutQty: 0,
      latePosSoldQty: 1,
      lateGapQty: 0,
      hasLateMovements: true,
    });
  });

  it("carries every figure of a late delta — in, out and gap as well as POS", () => {
    const [l] = deriveSellThroughLines({
      method: "SPG_POS",
      openings: [{ itemId: "i1", variantSku: "", qty: 10 }],
      rows: [],
      counted: [{ itemId: "i1", variantSku: "", countedQty: 10, cause: null }],
      lateMovements: [{ itemId: "i1", variantSku: "", inQty: 4, outQty: 1, posSold: 2, gap: 1 }],
    });
    expect(l).toMatchObject({ inQty: 4, outQty: 1, posSoldQty: 2, gapQty: 1, closingQty: 10, lateInQty: 4, lateOutQty: 1, latePosSoldQty: 2, lateGapQty: 1 });
  });

  it("a key present only in the late movements becomes its own line", () => {
    const lines = deriveSellThroughLines({
      method: "SHELF_COUNT",
      openings: [],
      rows: [row("KonsiTransfer", 3)],
      counted: [{ itemId: "i1", variantSku: "", countedQty: 3, cause: null }],
      lateMovements: [{ itemId: "i1", variantSku: "LATE", inQty: 0, outQty: 0, posSold: 1, gap: 0 }],
    });
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.variantSku === "LATE")).toMatchObject({ openingQty: 0, posSoldQty: 1, closingQty: -1, countedQty: null, billedQty: 1, hasLateMovements: true });
    expect(lines.find((l) => l.variantSku === "")).toMatchObject({ hasLateMovements: false, latePosSoldQty: 0 });
  });

  it("an all-zero late entry flags nothing and creates no line", () => {
    const lines = deriveSellThroughLines({
      method: "SHELF_COUNT",
      openings: [{ itemId: "i1", variantSku: "", qty: 2 }],
      rows: [],
      counted: [{ itemId: "i1", variantSku: "", countedQty: 2, cause: null }],
      lateMovements: [{ itemId: "ghost", variantSku: "", inQty: 0, outQty: 0, posSold: 0, gap: 0 }],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ hasLateMovements: false, lateInQty: 0, lateOutQty: 0, latePosSoldQty: 0, lateGapQty: 0 });
  });

  it("keeps a line whose totals net to zero while it carries late figures", () => {
    /* A surplus row in this window (gap −1) against a late shortfall carried from the previous one (gap +1). */
    const lines = deriveSellThroughLines({
      method: "SPG_POS",
      openings: [],
      rows: [row("StoreStocktake", 1, "i1", "NET")],
      counted: [],
      lateMovements: [{ itemId: "i1", variantSku: "NET", inQty: 0, outQty: 0, posSold: 0, gap: 1 }],
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ variantSku: "NET", gapQty: 0, closingQty: 0, lateGapQty: 1, hasLateMovements: true });
  });
});
