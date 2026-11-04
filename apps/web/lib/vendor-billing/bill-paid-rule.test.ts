import { describe, it, expect } from "vitest";
import {
  bagiLunasKeBaris,
  grnLineKey,
  grnLineSource,
  hutangPerKunciGrn,
  invoicedReturnedQty,
  lineRooms,
  readGrnLines,
  readGrnLinesDetail,
  splitCents,
  urutkanInvoice,
} from "./bill-paid-rule";

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

describe("readGrnLinesDetail", () => {
  it("reads the base price before PPN and the PPN mode of each line", () => {
    const lines = [
      { itemId: "a", variantSku: "", qty: 100, unitCost: 8000, totalCost: 800000, ppnIncluded: false },
      { itemId: "b", qty: 10, unitCost: 1110, totalCost: 11100, hargaPo: 1000, ppnDikapitalisasi: 1100, itemType: "FABRIC" },
      { itemId: "c", qty: 2, unitCost: 500 },
    ];
    const r = readGrnLinesDetail(lines);
    expect(r.map((l) => [l.key, l.hargaDasar, l.ppnMasukan, l.ppnModal, l.totalCost])).toEqual([
      [grnLineKey("a", null), 8000, true, false, 800000],
      [grnLineKey("b", null), 1000, false, true, 11100],
      [grnLineKey("c", null), 500, false, false, 1000],
    ]);
    expect(r[1].itemType).toBe("FABRIC");
    expect(grnLineSource("g1", r[0].key)).toBe(`GRN:g1|${grnLineKey("a", null)}`);
  });
});

describe("urutkanInvoice (P29: tanggal di kertas invoice)", () => {
  it("puts an invoice dated earlier first even when it was recorded later", () => {
    const rows = [
      { id: "b", billDate: new Date("2026-11-05T00:00:00+07:00"), createdAt: new Date("2026-11-05T09:00:00Z") },
      { id: "a", billDate: new Date("2026-11-03T00:00:00+07:00"), createdAt: new Date("2026-11-06T09:00:00Z") },
    ];
    expect(urutkanInvoice(rows).map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("compares the WIB calendar date, then createdAt, then id", () => {
    // 2026-11-03 23:30 WIB and 2026-11-03 01:00 WIB are the same paper date.
    const late = { id: "z", billDate: "2026-11-03T16:30:00.000Z", createdAt: "2026-11-04T00:00:00.000Z" };
    const early = { id: "y", billDate: "2026-11-02T18:00:00.000Z", createdAt: "2026-11-05T00:00:00.000Z" };
    expect(urutkanInvoice([early, late]).map((r) => r.id)).toEqual(["z", "y"]);
    const tieA = { id: "a", billDate: "2026-11-03T00:00:00.000Z", createdAt: "2026-11-04T00:00:00.000Z" };
    const tieB = { id: "b", billDate: "2026-11-03T00:00:00.000Z", createdAt: "2026-11-04T00:00:00.000Z" };
    expect(urutkanInvoice([tieB, tieA]).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("hutangPerKunciGrn", () => {
  it("splits the payable over the keys with the input VAT going to the PPN-masukan keys", () => {
    const A = grnLineKey("a", null);
    const B = grnLineKey("b", null);
    // A 800.000 (PPN masukan 88.000), B 200.000 without PPN: payable 1.088.000.
    const r = hutangPerKunciGrn({
      baris: [
        { key: A, nilaiSen: 80_000_000, ppnMasukan: true },
        { key: B, nilaiSen: 20_000_000, ppnMasukan: false },
      ],
      ppnSen: 8_800_000,
      hutangSen: 108_800_000,
    });
    expect(r.get(A)).toBe(88_800_000);
    expect(r.get(B)).toBe(20_000_000);
    expect([...r.values()].reduce((s, n) => s + n, 0)).toBe(108_800_000);
  });

  it("keeps the sign of a reversed payable", () => {
    const A = grnLineKey("a", null);
    expect(hutangPerKunciGrn({ baris: [{ key: A, nilaiSen: 100, ppnMasukan: false }], ppnSen: 0, hutangSen: -100 }).get(A)).toBe(-100);
  });
});

describe("bagiLunasKeBaris (value-based, oldest invoice first)", () => {
  // R8's example: GRN-1 holds A 100 × 8.000 and B 100 × 2.000. INV-11 bills A at 8.500 and the
  // difference was accepted (+50.000); INV-12 bills B at 2.000. 1.000.000 was paid on GRN-1.
  const inv11 = { billId: "inv11", lineId: "l11", tercatatSen: 85_000_000, ruangSen: 85_000_000 };
  const inv12 = { billId: "inv12", lineId: "l12", tercatatSen: 20_000_000, ruangSen: 20_000_000 };

  it("INV-11 older: INV-11 reads paid and INV-12 partly (150.000 of 200.000)", () => {
    const r = bagiLunasKeBaris(100_000_000, [inv11, inv12]);
    expect(r.get("l11")).toEqual({ diambilSen: 85_000_000, dibayarInvoiceSen: 85_000_000 });
    expect(r.get("l12")).toEqual({ diambilSen: 15_000_000, dibayarInvoiceSen: 15_000_000 });
  });

  it("INV-12 older: INV-12 reads paid and INV-11 partly (800.000 of 850.000)", () => {
    const r = bagiLunasKeBaris(100_000_000, [inv12, inv11]);
    expect(r.get("l12")?.dibayarInvoiceSen).toBe(20_000_000);
    expect(r.get("l11")?.dibayarInvoiceSen).toBe(80_000_000);
  });

  it("reads the paid share back in invoice terms and leaves the rest to un-invoiced pieces", () => {
    // A line whose recorded payable (PPN included) is 888.000 for an invoice of 800.000 before PPN.
    const r = bagiLunasKeBaris(44_400_000, [{ billId: "x", lineId: "lx", tercatatSen: 88_800_000, ruangSen: 80_000_000 }]);
    expect(r.get("lx")).toEqual({ diambilSen: 44_400_000, dibayarInvoiceSen: 40_000_000 });
    // More paid than any line can take: the line is full, the rest is left.
    expect(bagiLunasKeBaris(200_000_000, [inv12]).get("l12")).toEqual({ diambilSen: 20_000_000, dibayarInvoiceSen: 20_000_000 });
    // Nothing recorded takes nothing.
    expect(bagiLunasKeBaris(10_000, [{ billId: "n", lineId: "ln", tercatatSen: 0, ruangSen: 5_000 }]).get("ln")).toEqual({
      diambilSen: 0,
      dibayarInvoiceSen: 0,
    });
  });
});

describe("invoicedReturnedQty", () => {
  it("returns leave the un-invoiced pieces first: nothing invoiced is counted returned while they cover the return", () => {
    expect(invoicedReturnedQty({ received: 100, returned: 20, billed: 0 })).toBe(0);
    expect(invoicedReturnedQty({ received: 100, returned: 20, billed: 80 })).toBe(0);
    expect(invoicedReturnedQty({ received: 100, returned: 20, billed: 50 })).toBe(0);
  });

  it("counts the invoiced pieces a later return took back", () => {
    expect(invoicedReturnedQty({ received: 100, returned: 20, billed: 100 })).toBe(20);
    expect(invoicedReturnedQty({ received: 100, returned: 30, billed: 80 })).toBe(10);
  });

  it("ignores rounding noise below half a cent of a piece", () => {
    expect(invoicedReturnedQty({ received: 0.3, returned: 0.1, billed: 0.2000001 })).toBe(0);
    expect(invoicedReturnedQty({ received: 10, returned: 0.25, billed: 9.75 })).toBe(0);
    expect(invoicedReturnedQty({ received: 10, returned: 0.26, billed: 9.75 })).toBe(0.01);
  });
});
