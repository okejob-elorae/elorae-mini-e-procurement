import { describe, expect, it } from "vitest";
import {
  computeCommissionEvents,
  confirmedPieces,
  splitByLargestRemainder,
  summariseRecap,
  takeUnitsBySalesman,
  type CommissionRate,
  type CommissionReport,
  type CommissionReportLine,
} from "./compute";

const OCT = new Date("2026-10-10T03:00:00.000Z");
const NOV = new Date("2026-11-12T03:00:00.000Z");

const rates: CommissionRate[] = [
  { itemCategoryId: "cat-a", effectiveFrom: "2026-01", amountPerPiece: 1000 },
  { itemCategoryId: "cat-a", effectiveFrom: "2026-11", amountPerPiece: 1500 },
  { itemCategoryId: "cat-b", effectiveFrom: "2026-01", amountPerPiece: 700 },
];

function line(overrides: Partial<CommissionReportLine> = {}): CommissionReportLine {
  return {
    itemId: "item-1",
    variantSku: "",
    categoryId: "cat-a",
    posQty: 4,
    billedQty: 4,
    perSpgPosQty: [
      { salesmanId: "spg-a", qty: 3 },
      { salesmanId: "spg-b", qty: 1 },
    ],
    ...overrides,
  };
}

function report(overrides: Partial<CommissionReport> = {}): CommissionReport {
  return {
    id: "st-1",
    storeId: "store-1",
    baseline: false,
    approvedAt: OCT,
    voidedAt: null,
    lines: [line()],
    ...overrides,
  };
}

describe("splitByLargestRemainder", () => {
  it("splits in proportion and hands the remainder to the largest fractions", () => {
    /* 5 over 3:1:1 → quotas 3, 1, 1 exactly. */
    expect(
      splitByLargestRemainder(5, [
        { salesmanId: "a", qty: 3 },
        { salesmanId: "b", qty: 1 },
        { salesmanId: "c", qty: 1 },
      ]),
    ).toEqual([
      { salesmanId: "a", pieces: 3 },
      { salesmanId: "b", pieces: 1 },
      { salesmanId: "c", pieces: 1 },
    ]);
    /* 3 over 3:1 → quotas 2.25, 0.75 → floors 2, 0; the one left goes to b's .75. */
    expect(
      splitByLargestRemainder(3, [
        { salesmanId: "a", qty: 3 },
        { salesmanId: "b", qty: 1 },
      ]),
    ).toEqual([
      { salesmanId: "a", pieces: 2 },
      { salesmanId: "b", pieces: 1 },
    ]);
  });

  it("breaks a tie in the remainder by salesman id ascending, whatever the input order", () => {
    /* 1 over 1:1 → quotas .5, .5; the lower id wins. */
    expect(
      splitByLargestRemainder(1, [
        { salesmanId: "z", qty: 1 },
        { salesmanId: "m", qty: 1 },
      ]),
    ).toEqual([{ salesmanId: "m", pieces: 1 }]);
    /* 2 over 1:1:1 → quotas .67 each; the two lowest ids win. */
    expect(
      splitByLargestRemainder(2, [
        { salesmanId: "c", qty: 1 },
        { salesmanId: "a", qty: 1 },
        { salesmanId: "b", qty: 1 },
      ]),
    ).toEqual([
      { salesmanId: "a", pieces: 1 },
      { salesmanId: "b", pieces: 1 },
    ]);
  });

  it("merges repeated salesmen and ignores non-positive weights", () => {
    expect(
      splitByLargestRemainder(4, [
        { salesmanId: "a", qty: 1 },
        { salesmanId: "b", qty: 0 },
        { salesmanId: "a", qty: 1 },
        { salesmanId: "c", qty: -2 },
      ]),
    ).toEqual([{ salesmanId: "a", pieces: 4 }]);
  });

  it("assigns exactly the total, never more, even when the weights sum to more or less than it", () => {
    const over = splitByLargestRemainder(3, [
      { salesmanId: "a", qty: 5 },
      { salesmanId: "b", qty: 4 },
    ]);
    expect(over.reduce((s, r) => s + r.pieces, 0)).toBe(3);
    const under = splitByLargestRemainder(7, [{ salesmanId: "a", qty: 2 }]);
    expect(under).toEqual([{ salesmanId: "a", pieces: 7 }]);
  });

  it("returns nothing for a zero total or no weights", () => {
    expect(splitByLargestRemainder(0, [{ salesmanId: "a", qty: 3 }])).toEqual([]);
    expect(splitByLargestRemainder(5, [])).toEqual([]);
  });
});

describe("confirmedPieces", () => {
  it("is the smaller of billed and POS-sold, floored at zero and to whole pieces", () => {
    expect(confirmedPieces({ posQty: 4, billedQty: 4 })).toBe(4);
    expect(confirmedPieces({ posQty: 4, billedQty: 3 })).toBe(3);
    expect(confirmedPieces({ posQty: 4, billedQty: 6 })).toBe(4);
    expect(confirmedPieces({ posQty: -1, billedQty: 2 })).toBe(0);
    expect(confirmedPieces({ posQty: 2.5, billedQty: 3 })).toBe(2);
  });
});

describe("takeUnitsBySalesman", () => {
  const rows = [
    { salesmanId: "a", units: 2 },
    { salesmanId: "b", units: 3 },
    { salesmanId: null, units: 1 },
    { salesmanId: "a", units: 1 },
  ];

  it("takes units in row order, splitting a row across the skip and take edges", () => {
    expect(takeUnitsBySalesman(rows, 0, 3)).toEqual([
      { salesmanId: "a", qty: 2 },
      { salesmanId: "b", qty: 1 },
    ]);
    expect(takeUnitsBySalesman(rows, 3, 4)).toEqual([
      { salesmanId: "a", qty: 1 },
      { salesmanId: "b", qty: 2 },
    ]);
  });

  it("consumes an unattributed row's units without crediting anyone", () => {
    expect(takeUnitsBySalesman(rows, 5, 1)).toEqual([]);
  });

  it("stops at the rows it has", () => {
    expect(takeUnitsBySalesman(rows, 6, 10)).toEqual([{ salesmanId: "a", qty: 1 }]);
    expect(takeUnitsBySalesman(rows, 0, 0)).toEqual([]);
  });
});

describe("computeCommissionEvents", () => {
  it("earns at the approval month's rate, split by each SPG's POS qty", () => {
    expect(computeCommissionEvents([report()], rates)).toEqual([
      {
        yearMonth: "2026-10",
        kind: "EARNED",
        sellThroughId: "st-1",
        storeId: "store-1",
        salesmanId: "spg-a",
        categoryId: "cat-a",
        pieces: 3,
        ratePerPiece: 1000,
        amount: 3000,
      },
      {
        yearMonth: "2026-10",
        kind: "EARNED",
        sellThroughId: "st-1",
        storeId: "store-1",
        salesmanId: "spg-b",
        categoryId: "cat-a",
        pieces: 1,
        ratePerPiece: 1000,
        amount: 1000,
      },
    ]);
  });

  it("a REDUCE line earns only its billed pieces, split largest-remainder", () => {
    const events = computeCommissionEvents([report({ lines: [line({ billedQty: 3 })] })], rates);
    expect(events.map((e) => [e.salesmanId, e.pieces, e.amount])).toEqual([
      ["spg-a", 2, 2000],
      ["spg-b", 1, 1000],
    ]);
  });

  it("a BILL shortage line earns only the POS pieces, never the billed shortage", () => {
    const events = computeCommissionEvents([report({ lines: [line({ billedQty: 6 })] })], rates);
    expect(events.map((e) => [e.salesmanId, e.pieces])).toEqual([
      ["spg-a", 3],
      ["spg-b", 1],
    ]);
  });

  it("a baseline report earns nothing, voided or not", () => {
    expect(computeCommissionEvents([report({ baseline: true })], rates)).toEqual([]);
    expect(computeCommissionEvents([report({ baseline: true, voidedAt: NOV })], rates)).toEqual([]);
  });

  it("a line with no per-SPG POS rows (PUTUS-like, or shelf-only billing) earns nothing", () => {
    expect(computeCommissionEvents([report({ lines: [line({ perSpgPosQty: [] })] })], rates)).toEqual([]);
    expect(computeCommissionEvents([report({ lines: [line({ posQty: 0, billedQty: 5, perSpgPosQty: [] })] })], rates)).toEqual([]);
  });

  it("splits the confirmed pieces over the per-SPG figures' own sum when they drift from the line's POS figure", () => {
    /* POS says 4 but the SPG rows sum to 2 (1:1): all 4 confirmed pieces are still split, 2 each. */
    const under = computeCommissionEvents(
      [report({ lines: [line({ perSpgPosQty: [{ salesmanId: "spg-a", qty: 1 }, { salesmanId: "spg-b", qty: 1 }] })] })],
      rates,
    );
    expect(under.map((e) => [e.salesmanId, e.pieces])).toEqual([
      ["spg-a", 2],
      ["spg-b", 2],
    ]);
    /* The SPG rows sum to 9 against a confirmed 4: never more than 4 in total. */
    const over = computeCommissionEvents(
      [report({ lines: [line({ perSpgPosQty: [{ salesmanId: "spg-a", qty: 6 }, { salesmanId: "spg-b", qty: 3 }] })] })],
      rates,
    );
    expect(over.reduce((s, e) => s + e.pieces, 0)).toBe(4);
  });

  it("sums an SPG's pieces across the lines of one category into one event per report", () => {
    const events = computeCommissionEvents(
      [
        report({
          lines: [
            line({ itemId: "item-1", posQty: 2, billedQty: 2, perSpgPosQty: [{ salesmanId: "spg-a", qty: 2 }] }),
            line({ itemId: "item-2", posQty: 3, billedQty: 3, perSpgPosQty: [{ salesmanId: "spg-a", qty: 3 }] }),
            line({ itemId: "item-3", categoryId: "cat-b", posQty: 1, billedQty: 1, perSpgPosQty: [{ salesmanId: "spg-a", qty: 1 }] }),
          ],
        }),
      ],
      rates,
    );
    expect(events.map((e) => [e.categoryId, e.pieces, e.amount])).toEqual([
      ["cat-a", 5, 5000],
      ["cat-b", 1, 700],
    ]);
  });

  it("a void reverses the exact pieces and amount in the void's month", () => {
    const events = computeCommissionEvents([report({ voidedAt: NOV })], rates);
    expect(events.filter((e) => e.kind === "REVERSED")).toEqual([
      {
        yearMonth: "2026-11",
        kind: "REVERSED",
        sellThroughId: "st-1",
        storeId: "store-1",
        salesmanId: "spg-a",
        categoryId: "cat-a",
        pieces: -3,
        ratePerPiece: 1000,
        amount: -3000,
      },
      {
        yearMonth: "2026-11",
        kind: "REVERSED",
        sellThroughId: "st-1",
        storeId: "store-1",
        salesmanId: "spg-b",
        categoryId: "cat-a",
        pieces: -1,
        ratePerPiece: 1000,
        amount: -1000,
      },
    ]);
  });

  it("a reversal keeps the approval month's rate although a new rate applies in the void's month", () => {
    /* Approved in October at 1000; cat-a moves to 1500 from November, when the void lands. */
    const events = computeCommissionEvents([report({ voidedAt: NOV })], rates);
    const reversed = events.filter((e) => e.kind === "REVERSED");
    expect(reversed.every((e) => e.ratePerPiece === 1000)).toBe(true);
    /* A report approved in November earns at the new rate. */
    const novEvents = computeCommissionEvents([report({ approvedAt: NOV })], rates);
    expect(novEvents.map((e) => e.ratePerPiece)).toEqual([1500, 1500]);
  });

  it("an uncategorised item, or a category with no rate yet, emits its pieces with no rate and 0 amount", () => {
    const events = computeCommissionEvents(
      [
        report({
          lines: [
            line({ itemId: "item-1", categoryId: null, posQty: 2, billedQty: 2, perSpgPosQty: [{ salesmanId: "spg-a", qty: 2 }] }),
            line({ itemId: "item-2", categoryId: "cat-none", posQty: 1, billedQty: 1, perSpgPosQty: [{ salesmanId: "spg-a", qty: 1 }] }),
          ],
          voidedAt: NOV,
        }),
      ],
      rates,
    );
    expect(events.map((e) => [e.kind, e.categoryId, e.pieces, e.ratePerPiece, e.amount])).toEqual([
      ["EARNED", null, 2, null, 0],
      ["REVERSED", null, -2, null, 0],
      ["EARNED", "cat-none", 1, null, 0],
      ["REVERSED", "cat-none", -1, null, 0],
    ]);
    /* Never a negative zero: it would read as a different value to a strict comparison. */
    expect(events.every((e) => !Object.is(e.amount, -0))).toBe(true);
  });

  it("dates the event by the WIB month: 2026-10-31T17:30Z earns in November", () => {
    const events = computeCommissionEvents([report({ approvedAt: new Date("2026-10-31T17:30:00.000Z") })], rates);
    expect(events.map((e) => [e.yearMonth, e.ratePerPiece])).toEqual([
      ["2026-11", 1500],
      ["2026-11", 1500],
    ]);
    const lastOctober = computeCommissionEvents([report({ approvedAt: new Date("2026-10-31T16:59:59.999Z") })], rates);
    expect(lastOctober.map((e) => e.yearMonth)).toEqual(["2026-10", "2026-10"]);
  });
});

describe("summariseRecap", () => {
  it("a report approved and voided in the same month nets to zero in that month", () => {
    const events = computeCommissionEvents([report({ voidedAt: new Date("2026-10-20T03:00:00.000Z") })], rates);
    const recap = summariseRecap(events, "2026-10");
    expect(recap.rows).toEqual([
      { salesmanId: "spg-a", storeIds: ["store-1"], pieces: 0, earned: 3000, reversed: -3000, net: 0, noRatePieces: 0 },
      { salesmanId: "spg-b", storeIds: ["store-1"], pieces: 0, earned: 1000, reversed: -1000, net: 0, noRatePieces: 0 },
    ]);
  });

  it("a later void lands as a negative adjustment in the void's month and leaves the approval month alone", () => {
    const events = computeCommissionEvents([report({ voidedAt: NOV })], rates);
    expect(summariseRecap(events, "2026-10").rows.map((r) => [r.salesmanId, r.pieces, r.net])).toEqual([
      ["spg-a", 3, 3000],
      ["spg-b", 1, 1000],
    ]);
    expect(summariseRecap(events, "2026-11").rows.map((r) => [r.salesmanId, r.pieces, r.earned, r.reversed, r.net])).toEqual([
      ["spg-a", -3, 0, -3000, -3000],
      ["spg-b", -1, 0, -1000, -1000],
    ]);
  });

  it("nets a reversal against new earnings, collects every store and breaks the month down per category", () => {
    const events = computeCommissionEvents(
      [
        report({ id: "st-1", storeId: "store-1", voidedAt: NOV }),
        report({
          id: "st-2",
          storeId: "store-2",
          approvedAt: NOV,
          lines: [
            line({ categoryId: "cat-a", posQty: 2, billedQty: 2, perSpgPosQty: [{ salesmanId: "spg-a", qty: 2 }] }),
            line({ itemId: "item-2", categoryId: "cat-b", posQty: 4, billedQty: 4, perSpgPosQty: [{ salesmanId: "spg-a", qty: 4 }] }),
            line({ itemId: "item-3", categoryId: null, posQty: 1, billedQty: 1, perSpgPosQty: [{ salesmanId: "spg-a", qty: 1 }] }),
          ],
        }),
      ],
      rates,
    );
    const recap = summariseRecap(events, "2026-11");

    /* spg-a: +2 × 1500 (cat-a, Nov rate) + 4 × 700 (cat-b) + 1 no rate, − 3 × 1000 (the October reversal). */
    expect(recap.rows.find((r) => r.salesmanId === "spg-a")).toEqual({
      salesmanId: "spg-a",
      storeIds: ["store-1", "store-2"],
      pieces: 4,
      earned: 5800,
      reversed: -3000,
      net: 2800,
      noRatePieces: 1,
    });
    expect(recap.detail.filter((d) => d.salesmanId === "spg-a")).toEqual([
      { salesmanId: "spg-a", categoryId: "cat-a", pieces: -1, earned: 3000, reversed: -3000, net: 0, noRatePieces: 0 },
      { salesmanId: "spg-a", categoryId: "cat-b", pieces: 4, earned: 2800, reversed: 0, net: 2800, noRatePieces: 0 },
      { salesmanId: "spg-a", categoryId: null, pieces: 1, earned: 0, reversed: 0, net: 0, noRatePieces: 1 },
    ]);
    expect(recap.noRate).toEqual([{ categoryId: null, pieces: 1 }]);
    expect(recap.events.every((e) => e.yearMonth === "2026-11")).toBe(true);
  });

  it("counts only earned pieces as missing a rate, so a reversal of an unrated earning is not flagged again", () => {
    const events = computeCommissionEvents([report({ lines: [line({ categoryId: null })], voidedAt: NOV })], rates);
    expect(summariseRecap(events, "2026-10").noRate).toEqual([{ categoryId: null, pieces: 4 }]);
    expect(summariseRecap(events, "2026-11").noRate).toEqual([]);
    expect(summariseRecap(events, "2026-11").rows.map((r) => r.noRatePieces)).toEqual([0, 0]);
  });

  it("an empty month has no rows", () => {
    expect(summariseRecap(computeCommissionEvents([report()], rates), "2026-12")).toEqual({ rows: [], detail: [], noRate: [], events: [] });
  });
});
