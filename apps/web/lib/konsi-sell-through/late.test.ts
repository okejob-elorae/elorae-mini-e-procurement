import { describe, it, expect } from "vitest";
import type { DerivedLine } from "./derive";
import { diffLateMovements, type StoredLineFigures } from "./late";

const fresh = (over: Partial<DerivedLine> & { itemId: string }): DerivedLine => ({
  variantSku: "",
  openingQty: 0,
  inQty: 0,
  outQty: 0,
  posSoldQty: 0,
  gapQty: 0,
  closingQty: 0,
  countedQty: null,
  billedQty: 0,
  shrinkageQty: 0,
  negativeSold: false,
  suggestedResolution: null,
  lateInQty: 0,
  lateOutQty: 0,
  latePosSoldQty: 0,
  lateGapQty: 0,
  hasLateMovements: false,
  ...over,
});

const stored = (over: Partial<StoredLineFigures> & { itemId: string }): StoredLineFigures => ({
  variantSku: "",
  inQty: 0,
  outQty: 0,
  posSoldQty: 0,
  gapQty: 0,
  lateInQty: 0,
  lateOutQty: 0,
  latePosSoldQty: 0,
  lateGapQty: 0,
  ...over,
});

describe("diffLateMovements", () => {
  it("returns nothing when the fresh window matches what the report stored", () => {
    expect(diffLateMovements([fresh({ itemId: "i1", inQty: 6, gapQty: 4 })], [stored({ itemId: "i1", inQty: 6, gapQty: 4 })])).toEqual([]);
  });

  it("returns the per-key difference a late row added", () => {
    expect(diffLateMovements([fresh({ itemId: "i1", posSoldQty: 3 })], [stored({ itemId: "i1", posSoldQty: 2 })])).toEqual([
      { itemId: "i1", variantSku: "", inQty: 0, outQty: 0, posSold: 1, gap: 0 },
    ]);
  });

  it("subtracts the late part the previous report itself carried before comparing", () => {
    /* Stored POS 3 is window 2 + 1 carried from ITS predecessor; the fresh window is 2 — nothing is late. */
    expect(diffLateMovements([fresh({ itemId: "i1", posSoldQty: 2 })], [stored({ itemId: "i1", posSoldQty: 3, latePosSoldQty: 1 })])).toEqual([]);
  });

  it("a key the report never stored contributes its full fresh figures", () => {
    expect(diffLateMovements([fresh({ itemId: "i2", variantSku: "RED", inQty: 2, posSoldQty: 1 })], [])).toEqual([
      { itemId: "i2", variantSku: "RED", inQty: 2, outQty: 0, posSold: 1, gap: 0 },
    ]);
  });

  it("a stored line that only ever existed for its late part contributes nothing when the fresh window lacks it", () => {
    expect(diffLateMovements([], [stored({ itemId: "i3", posSoldQty: 1, latePosSoldQty: 1 })])).toEqual([]);
  });

  it("compares at 2dp so float noise is never reported", () => {
    expect(diffLateMovements([fresh({ itemId: "i1", inQty: 0.1 + 0.2 })], [stored({ itemId: "i1", inQty: 0.3 })])).toEqual([]);
    expect(diffLateMovements([fresh({ itemId: "i1", outQty: 1.25 })], [stored({ itemId: "i1", outQty: 0.5 })])).toEqual([
      { itemId: "i1", variantSku: "", inQty: 0, outQty: 0.75, posSold: 0, gap: 0 },
    ]);
  });
});
