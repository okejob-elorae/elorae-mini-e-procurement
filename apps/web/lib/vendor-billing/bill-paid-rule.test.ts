import { describe, it, expect } from "vitest";
import { allocateSupplierPaid, grnLineKey, lineRooms, paidFraction, paidPiecesByPoItem, readGrnLines, splitCents } from "./bill-paid-rule";

describe("splitCents", () => {
  it("splits by weight and adds back up to the total exactly", () => {
    expect(splitCents(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(splitCents(1_000, [300, 700])).toEqual([300, 700]);
    expect(splitCents(0, [1, 2])).toEqual([0, 0]);
    expect(splitCents(50, [0, 0])).toEqual([0, 0]);
  });
});

describe("lineRooms", () => {
  it("leaves each line its amount less its share of the bill's vendor payments", () => {
    // A 1.000.000 bill (600k + 400k) with 500k paid through Vendor Billing: half of each line is left.
    expect(lineRooms(50_000_000, [60_000_000, 40_000_000])).toEqual([30_000_000, 20_000_000]);
    expect(lineRooms(0, [60_000_000, 40_000_000])).toEqual([60_000_000, 40_000_000]);
    expect(lineRooms(100_000_000, [60_000_000, 40_000_000])).toEqual([0, 0]);
  });
});

describe("paidFraction", () => {
  it("is the settled share of the booked payable, capped at whole", () => {
    expect(paidFraction(450_000_000, 450_000_000)).toBe(1);
    expect(paidFraction(900_000_000, 450_000_000)).toBe(1);
    expect(paidFraction(0, 450_000_000)).toBe(0);
    expect(paidFraction(100, 0)).toBe(0);
    // A GRN booked with PPN (4.500.000 + 495.000) paid its DPP only: not settled.
    expect(paidFraction(450_000_000, 499_500_000)).toBeCloseTo(0.9009, 4);
  });
});

describe("readGrnLines", () => {
  it("reads the array, or the array stored as a JSON string, and skips what is not a line", () => {
    const lines = [{ itemId: "kain", variantSku: " M ", qty: 10 }, { itemId: "kaos", qty: "4" }, { qty: 3 }, { itemId: "nol", qty: 0 }];
    const want = [
      { key: grnLineKey("kain", "M"), qty: 10 },
      { key: grnLineKey("kaos", null), qty: 4 },
    ];
    expect(readGrnLines(lines)).toEqual(want);
    expect(readGrnLines(JSON.stringify(lines))).toEqual(want);
    expect(readGrnLines("bukan json")).toEqual([]);
    expect(readGrnLines(null)).toEqual([]);
  });
});

describe("paidPiecesByPoItem", () => {
  const A = grnLineKey("kain-a");
  const B = grnLineKey("kain-b");
  const items = [
    { id: "po-a", key: A, receivedQty: 100 },
    { id: "po-b", key: B, receivedQty: 50 },
  ];

  it("pays an item only from the GRNs that brought it in", () => {
    // GRN-1 brought kain A, GRN-2 kain B; only GRN-2 is paid.
    const grns = [
      { fraction: 0, lines: [{ key: A, qty: 100 }] },
      { fraction: 1, lines: [{ key: B, qty: 50 }] },
    ];
    expect(paidPiecesByPoItem(grns, items)).toEqual(
      new Map([
        ["po-a", 0],
        ["po-b", 50],
      ])
    );
  });

  it("takes each GRN's settled share of its own pieces", () => {
    // 60 pcs of A on a fully paid GRN, 40 on a half paid one.
    const grns = [
      { fraction: 1, lines: [{ key: A, qty: 60 }] },
      { fraction: 0.5, lines: [{ key: A, qty: 40 }, { key: B, qty: 50 }] },
    ];
    expect(paidPiecesByPoItem(grns, items)).toEqual(
      new Map([
        ["po-a", 80],
        ["po-b", 25],
      ])
    );
  });

  it("fills items sharing a key in order, each up to what it received", () => {
    const twin = [
      { id: "first", key: A, receivedQty: 30 },
      { id: "second", key: A, receivedQty: 70 },
    ];
    expect(paidPiecesByPoItem([{ fraction: 1, lines: [{ key: A, qty: 50 }] }], twin)).toEqual(
      new Map([
        ["first", 30],
        ["second", 20],
      ])
    );
  });
});

describe("allocateSupplierPaid", () => {
  const step = "WO_STEP:s1";
  const po = "PO_ITEM:p1";

  it("pays the oldest saved bill first and stops at each line's room", () => {
    // 20 settled pieces at 12.000: the old bill's 13,33 pcs left after its vendor payment, then the new one.
    const lines = [
      { billId: "old", source: step, qty: 30, amountCents: 36_000_000, roomCents: 16_000_000 },
      { billId: "new", source: step, qty: 20, amountCents: 24_000_000, roomCents: 24_000_000 },
    ];
    expect(allocateSupplierPaid(lines, new Map([[step, 20]]))).toEqual(
      new Map([
        ["old", 16_000_000],
        ["new", 8_000_000],
      ])
    );
  });

  it("pays a line at its own invoice price, whatever the receipt was booked at", () => {
    // Half the receipt's pieces settled; the invoice line reads half paid, at its own price.
    const lines = [{ billId: "a", source: po, qty: 100, amountCents: 450_000_000, roomCents: 450_000_000 }];
    expect(allocateSupplierPaid(lines, new Map([[po, 50]]))).toEqual(new Map([["a", 225_000_000]]));
    expect(allocateSupplierPaid(lines, new Map([[po, 100]]))).toEqual(new Map([["a", 450_000_000]]));
  });

  it("keeps sources apart and leaves a bill no pool reached out", () => {
    const lines = [
      { billId: "a", source: po, qty: 10, amountCents: 10_000, roomCents: 10_000 },
      { billId: "a", source: step, qty: 5, amountCents: 5_000, roomCents: 5_000 },
      { billId: "b", source: step, qty: 5, amountCents: 5_000, roomCents: 5_000 },
    ];
    expect(allocateSupplierPaid(lines, new Map([[po, 4], [step, 0]]))).toEqual(new Map([["a", 4_000]]));
  });

  it("never counts a rupiah a vendor payment already paid on the bill", () => {
    // Bill fully paid through Vendor Billing has no room; the settled pieces go to the next bill.
    const lines = [
      { billId: "paid", source: step, qty: 8, amountCents: 80_000, roomCents: lineRooms(80_000, [80_000])[0] },
      { billId: "open", source: step, qty: 3, amountCents: 30_000, roomCents: 30_000 },
    ];
    expect(allocateSupplierPaid(lines, new Map([[step, 10]]))).toEqual(new Map([["open", 30_000]]));
  });
});
