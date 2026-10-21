import { describe, expect, it } from "vitest";
import { perSpgPosQtyForLines, spgSaleIdsOf, type SplitLedgerRow, type SplitLine } from "./split-weights";

const sale = (refId: string, qty: number, overrides: Partial<SplitLedgerRow> = {}): SplitLedgerRow => ({
  itemId: "item-1",
  variantSku: "",
  qty: -qty,
  refType: "SpgSale",
  refId,
  ...overrides,
});

const line = (posSoldQty: number, latePosSoldQty = 0, overrides: Partial<SplitLine> = {}): SplitLine => ({
  itemId: "item-1",
  variantSku: "",
  posSoldQty,
  latePosSoldQty,
  ...overrides,
});

const salesmen = new Map([
  ["sale-a1", "spg-a"],
  ["sale-a2", "spg-a"],
  ["sale-b1", "spg-b"],
  ["sale-b2", "spg-b"],
]);

describe("spgSaleIdsOf", () => {
  it("lists each SpgSale ref once across every row set, ignoring other movements and non-negative sale rows", () => {
    const own = [sale("sale-a1", 2), { ...sale("x", 0), refType: "KonsiTransfer", qty: 6 }, sale("sale-b1", 1)];
    const previous = [sale("sale-a1", 2), { ...sale("sale-b2", 0), qty: 1 }];
    expect(spgSaleIdsOf(own, previous)).toEqual(["sale-a1", "sale-b1"]);
  });
});

describe("perSpgPosQtyForLines", () => {
  it("weighs a line's own share by the SPGs of its window's sale rows, and gives it no late share when nothing was carried", () => {
    const result = perSpgPosQtyForLines({
      lines: [line(4)],
      ownRows: [sale("sale-a1", 3), sale("sale-b1", 1)],
      previousRows: [],
      previousLines: [],
      salesmanBySale: salesmen,
    });
    expect(result).toEqual([
      {
        itemId: "item-1",
        variantSku: "",
        own: [
          { salesmanId: "spg-a", qty: 3 },
          { salesmanId: "spg-b", qty: 1 },
        ],
        late: [],
      },
    ]);
  });

  it("takes only the first posSoldQty − latePosSoldQty units of the window as the own share, in row order", () => {
    /* Own 2 of a window holding 4: A's 2 come first, so B's later rows fall outside. */
    const [weights] = perSpgPosQtyForLines({
      lines: [line(3, 1)],
      ownRows: [sale("sale-a1", 2), sale("sale-b1", 2)],
      previousRows: [],
      previousLines: [],
      salesmanBySale: salesmen,
    });
    expect(weights.own).toEqual([{ salesmanId: "spg-a", qty: 2 }]);
  });

  it("takes the late share after the previous report's own units in the previous window", () => {
    /* The previous report counted 3 (posSold 3, late 0); the 4th unit of its window, B's, is the 1 carried here. */
    const [weights] = perSpgPosQtyForLines({
      lines: [line(2, 1)],
      ownRows: [sale("sale-a2", 1)],
      previousRows: [sale("sale-a1", 3), sale("sale-b2", 1)],
      previousLines: [line(3)],
      salesmanBySale: salesmen,
    });
    expect(weights.own).toEqual([{ salesmanId: "spg-a", qty: 1 }]);
    expect(weights.late).toEqual([{ salesmanId: "spg-b", qty: 1 }]);
  });

  it("skips the previous report's OWN units only — its own carried-in late units are not part of its window", () => {
    /* Previous posSold 4 with late 1: its window contributed 3, so the late share starts at position 3. */
    const [weights] = perSpgPosQtyForLines({
      lines: [line(1, 1)],
      ownRows: [],
      previousRows: [sale("sale-a1", 3), sale("sale-b2", 1)],
      previousLines: [line(4, 1)],
      salesmanBySale: salesmen,
    });
    expect(weights.own).toEqual([]);
    expect(weights.late).toEqual([{ salesmanId: "spg-b", qty: 1 }]);
  });

  it("against a SNAPSHOTTED previous report, the late share is each SPG's units beyond its snapshotted OWN units, wherever the late row sorts", () => {
    /* A's late unit sorts FIRST in the previous window; the positional cut would skip it and hand B's counted unit over as late. */
    const input = {
      lines: [line(1, 1)],
      ownRows: [],
      previousRows: [sale("sale-a2", 1), sale("sale-a1", 3), sale("sale-b1", 1)],
      previousLines: [line(4)],
      salesmanBySale: salesmen,
    };
    const [snapshotted] = perSpgPosQtyForLines({
      ...input,
      previousOwnShares: [
        { itemId: "item-1", variantSku: "", salesmanId: "spg-a", units: 3 },
        { itemId: "item-1", variantSku: "", salesmanId: "spg-b", units: 1 },
      ],
    });
    expect(snapshotted.late).toEqual([{ salesmanId: "spg-a", qty: 1 }]);
    const [positional] = perSpgPosQtyForLines({ ...input, previousOwnShares: null });
    expect(positional.late).toEqual([{ salesmanId: "spg-b", qty: 1 }]);
  });

  it("a previous report snapshotted with no rows for the key leaves every unit of its window to the late share", () => {
    const [weights] = perSpgPosQtyForLines({
      lines: [line(2, 2)],
      ownRows: [],
      previousRows: [sale("sale-a1", 1), sale("sale-b1", 1)],
      previousLines: [line(0)],
      previousOwnShares: [{ itemId: "item-1", variantSku: "RED", salesmanId: "spg-a", units: 5 }],
      salesmanBySale: salesmen,
    });
    expect(weights.late).toEqual([
      { salesmanId: "spg-a", qty: 1 },
      { salesmanId: "spg-b", qty: 1 },
    ]);
  });

  it("skips nothing when the previous report has no line for the key", () => {
    const [weights] = perSpgPosQtyForLines({
      lines: [line(1, 1)],
      ownRows: [],
      previousRows: [sale("sale-b2", 1)],
      previousLines: [line(5, 0, { itemId: "item-2" })],
      salesmanBySale: salesmen,
    });
    expect(weights.late).toEqual([{ salesmanId: "spg-b", qty: 1 }]);
  });

  it("keeps keys apart: a variant's rows never weigh for another variant's line", () => {
    const result = perSpgPosQtyForLines({
      lines: [line(1, 0, { variantSku: "RED" }), line(1, 0, { variantSku: "BLUE" })],
      ownRows: [sale("sale-a1", 1, { variantSku: "BLUE" }), sale("sale-b1", 1, { variantSku: "RED" })],
      previousRows: [],
      previousLines: [],
      salesmanBySale: salesmen,
    });
    expect(result.map((w) => [w.variantSku, w.own])).toEqual([
      ["RED", [{ salesmanId: "spg-b", qty: 1 }]],
      ["BLUE", [{ salesmanId: "spg-a", qty: 1 }]],
    ]);
  });

  it("a sale row whose SPG is unknown takes its position but weighs for no one", () => {
    const [weights] = perSpgPosQtyForLines({
      lines: [line(2)],
      ownRows: [sale("sale-gone", 1), sale("sale-b1", 1)],
      previousRows: [],
      previousLines: [],
      salesmanBySale: salesmen,
    });
    expect(weights.own).toEqual([{ salesmanId: "spg-b", qty: 1 }]);
  });

  it("ignores non-sale movements and non-negative sale rows, rounds the own units, and never takes a negative count", () => {
    const rows = [{ ...sale("x", 0), refType: "StoreStocktake", qty: -5 }, { ...sale("sale-a1", 0), qty: 2 }, sale("sale-b1", 2)];
    const [rounded] = perSpgPosQtyForLines({ lines: [line(1.6)], ownRows: rows, previousRows: [], previousLines: [], salesmanBySale: salesmen });
    expect(rounded.own).toEqual([{ salesmanId: "spg-b", qty: 2 }]);
    const [negative] = perSpgPosQtyForLines({ lines: [line(1, 2)], ownRows: rows, previousRows: [], previousLines: [], salesmanBySale: salesmen });
    expect(negative.own).toEqual([]);
  });
});
