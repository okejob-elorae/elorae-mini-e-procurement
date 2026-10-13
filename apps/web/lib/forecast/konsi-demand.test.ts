import { describe, expect, it } from "vitest";
import { buildKonsiDemand, type KonsiReportInput } from "./konsi-demand";

function report(overrides: Partial<KonsiReportInput> = {}): KonsiReportInput {
  return {
    periodEnd: new Date(Date.UTC(2026, 7, 31, 17)), // 1 Sep 2026 00:00 WIB
    lines: [
      { itemId: "item-1", itemSku: "250000-G76", productName: "Kylie Vest", billedQty: 5, posSoldQty: 0, unitPrice: 250_000 },
    ],
    ...overrides,
  };
}

describe("buildKonsiDemand", () => {
  it("turns billed units into demand on the WIB month of the period end", () => {
    const result = buildKonsiDemand([report()]);
    expect(result.rows).toEqual([
      {
        parentSku: "250000-G76",
        productName: "Kylie Vest",
        netQuantity: 5,
        lineTotal: 1_250_000,
        orderDate: new Date(Date.UTC(2026, 7, 31, 17)),
        year: 2026,
        month: 9,
        itemId: "item-1",
      },
    ]);
    expect(result.monthly).toEqual([{ year: 2026, month: 9, qty: 5 }]);
  });

  it("leaves out units SPG POS already recorded, since POS sales feed the forecast on their own", () => {
    const result = buildKonsiDemand([
      report({
        lines: [
          { itemId: "item-1", itemSku: "A", productName: "A", billedQty: 7, posSoldQty: 4, unitPrice: 10_000 },
          { itemId: "item-2", itemSku: "B", productName: "B", billedQty: 3, posSoldQty: 3, unitPrice: 10_000 },
          { itemId: "item-3", itemSku: "C", productName: "C", billedQty: 1, posSoldQty: 2, unitPrice: 10_000 },
        ],
      }),
    ]);
    expect(result.rows.map((r) => [r.parentSku, r.netQuantity, r.lineTotal])).toEqual([["A", 3, 30_000]]);
  });

  it("values a line with no unit price at zero revenue but still counts its units", () => {
    const result = buildKonsiDemand([
      report({
        lines: [{ itemId: "item-1", itemSku: "A", productName: "A", billedQty: 2, posSoldQty: 0, unitPrice: null }],
      }),
    ]);
    expect(result.rows[0]).toMatchObject({ netQuantity: 2, lineTotal: 0 });
  });
});
