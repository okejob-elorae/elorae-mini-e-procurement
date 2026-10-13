import { describe, expect, it } from "vitest";
import {
  buildMarketplaceDemand,
  isMonthSettled,
  marketplaceFamilyFor,
  wibYearMonth,
  type MarketplaceDemandInput,
  type MarketplaceOrderInput,
} from "./marketplace-demand";

// WIB midnight of a calendar day, as a UTC instant.
function wib(y: number, m: number, d: number, h = 0): Date {
  return new Date(Date.UTC(y, m - 1, d, h - 7));
}

// A settlement period as stored: periodFrom/periodTo are the WIB start of the first/last day.
function period(from: [number, number, number], to: [number, number, number]) {
  return { periodFrom: wib(...from), periodTo: wib(...to) };
}

function order(overrides: Partial<MarketplaceOrderInput> = {}): MarketplaceOrderInput {
  return {
    id: "so-1",
    channel: "SHOPEE",
    status: "COMPLETED",
    transactionDate: wib(2026, 6, 10, 12),
    matchKeyUnique: true,
    orderNumbers: ["2606100001"],
    lines: [
      {
        itemId: "item-1",
        itemSku: "240000-G82",
        productName: "Daisy Polo Crop Shirt",
        qty: 2,
        returnedQty: 0,
        isCanceledItem: false,
        lineTotal: 200_000,
      },
    ],
    ...overrides,
  };
}

// June 2026 is settled for SHOPEE with a 14-day delay when settlements cover 1 Jun – 14 Jul.
function input(overrides: Partial<MarketplaceDemandInput> = {}): MarketplaceDemandInput {
  return {
    orders: [order()],
    settlementNetByOrderId: new Map([["so-1", 180_000]]),
    settlementPeriods: {
      SHOPEE: [period([2026, 6, 1], [2026, 6, 30]), period([2026, 7, 1], [2026, 7, 14])],
      TIKTOK: [],
    },
    payoutDelayDays: { SHOPEE: 14, TIKTOK: 14 },
    importedOrderNumbers: { SHOPEE: new Set(), TIKTOK: new Set() },
    ...overrides,
  };
}

function diag(result: ReturnType<typeof buildMarketplaceDemand>, family: "SHOPEE" | "TIKTOK", year: number, month: number) {
  return result.diagnostics.find((d) => d.family === family && d.year === year && d.month === month);
}

describe("wibYearMonth", () => {
  it("buckets by the Jakarta calendar, not UTC", () => {
    // 31 May 18:00 UTC is 1 June 01:00 WIB.
    expect(wibYearMonth(new Date(Date.UTC(2026, 4, 31, 18)))).toEqual({ year: 2026, month: 6 });
    expect(wibYearMonth(new Date(Date.UTC(2026, 4, 31, 16)))).toEqual({ year: 2026, month: 5 });
  });
});

describe("marketplaceFamilyFor", () => {
  it("folds TOKOPEDIA into the TIKTOK settlement family", () => {
    expect(marketplaceFamilyFor("SHOPEE")).toBe("SHOPEE");
    expect(marketplaceFamilyFor("TIKTOK")).toBe("TIKTOK");
    expect(marketplaceFamilyFor("TOKOPEDIA")).toBe("TIKTOK");
    expect(marketplaceFamilyFor("OTHER")).toBeNull();
    expect(marketplaceFamilyFor("OFFLINE")).toBeNull();
  });
});

describe("isMonthSettled", () => {
  const juneToMidJuly = [period([2026, 6, 1], [2026, 6, 30]), period([2026, 7, 1], [2026, 7, 14])];

  it("is true when contiguous settlements cover the month plus the payout delay", () => {
    expect(isMonthSettled(2026, 6, juneToMidJuly, 14)).toBe(true);
  });

  it("is false when the delay reaches past the last settlement", () => {
    expect(isMonthSettled(2026, 6, juneToMidJuly, 15)).toBe(false);
  });

  it("is false when a gap splits the covered range", () => {
    const gapped = [period([2026, 6, 1], [2026, 6, 20]), period([2026, 6, 22], [2026, 7, 14])];
    expect(isMonthSettled(2026, 6, gapped, 14)).toBe(false);
  });

  it("is false when coverage starts after the month starts", () => {
    expect(isMonthSettled(2026, 6, [period([2026, 6, 2], [2026, 7, 31])], 14)).toBe(false);
  });

  it("ignores a gap between older periods that end before the month", () => {
    const olderGap = [period([2026, 3, 1], [2026, 3, 31]), period([2026, 5, 1], [2026, 5, 31]), ...juneToMidJuly];
    expect(isMonthSettled(2026, 6, olderGap, 14)).toBe(true);
  });

  it("accepts overlapping and unsorted periods", () => {
    const messy = [period([2026, 6, 25], [2026, 7, 20]), period([2026, 5, 20], [2026, 6, 26])];
    expect(isMonthSettled(2026, 6, messy, 14)).toBe(true);
  });
});

describe("buildMarketplaceDemand", () => {
  it("counts a settled order's lines as demand on its transaction month", () => {
    const result = buildMarketplaceDemand(input());
    expect(result.rows).toEqual([
      {
        parentSku: "240000-G82",
        productName: "Daisy Polo Crop Shirt",
        netQuantity: 2,
        lineTotal: 200_000,
        orderDate: wib(2026, 6, 10, 12),
        year: 2026,
        month: 6,
        itemId: "item-1",
      },
    ]);
    expect(diag(result, "SHOPEE", 2026, 6)).toMatchObject({ settled: true, countedOrders: 1, countedQty: 2 });
  });

  it("lets the settlement win over a later RETURNED status", () => {
    const result = buildMarketplaceDemand(input({ orders: [order({ status: "RETURNED" })] }));
    expect(result.rows).toHaveLength(1);
  });

  it("excludes an order in an unsettled month and reports it as provisional", () => {
    const result = buildMarketplaceDemand(
      input({ orders: [order({ transactionDate: wib(2026, 7, 5) })] })
    );
    expect(result.rows).toEqual([]);
    expect(diag(result, "SHOPEE", 2026, 7)).toMatchObject({
      settled: false,
      provisionalOrders: 1,
      provisionalQty: 2,
    });
  });

  it("does not count a cancelled order as provisional demand", () => {
    const result = buildMarketplaceDemand(
      input({ orders: [order({ status: "CANCELLED", transactionDate: wib(2026, 7, 5) })] })
    );
    expect(diag(result, "SHOPEE", 2026, 7)).toMatchObject({ provisionalOrders: 0 });
  });

  it("refuses an ambiguous match as settlement proof", () => {
    const result = buildMarketplaceDemand(input({ orders: [order({ matchKeyUnique: false })] }));
    expect(result.rows).toEqual([]);
    expect(diag(result, "SHOPEE", 2026, 6)).toMatchObject({ ambiguousOrders: 1, countedOrders: 0 });
  });

  it("reports a finished order with no settlement line in a settled month as missing payout", () => {
    const result = buildMarketplaceDemand(input({ settlementNetByOrderId: new Map() }));
    expect(result.rows).toEqual([]);
    expect(diag(result, "SHOPEE", 2026, 6)).toMatchObject({ missingPayoutOrders: 1 });
  });

  it("does not report an unsettled cancelled order as missing payout", () => {
    const result = buildMarketplaceDemand(
      input({ orders: [order({ status: "CANCELLED" })], settlementNetByOrderId: new Map() })
    );
    expect(diag(result, "SHOPEE", 2026, 6)).toMatchObject({ missingPayoutOrders: 0 });
  });

  it("drops a fully refunded order whose settled net is zero or below", () => {
    const result = buildMarketplaceDemand(input({ settlementNetByOrderId: new Map([["so-1", 0]]) }));
    expect(result.rows).toEqual([]);
    expect(diag(result, "SHOPEE", 2026, 6)).toMatchObject({ refundedOrders: 1 });
  });

  it("counts an order settled twice once (repeated settlement lines sum into one net)", () => {
    const result = buildMarketplaceDemand(
      input({ settlementNetByOrderId: new Map([["so-1", 360_000]]) })
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].netQuantity).toBe(2);
  });

  it("nets out returned quantity and scales revenue to it", () => {
    const result = buildMarketplaceDemand(
      input({
        orders: [
          order({
            lines: [
              { itemId: "item-1", itemSku: "A", productName: "A", qty: 4, returnedQty: 1, isCanceledItem: false, lineTotal: 400_000 },
              { itemId: "item-2", itemSku: "B", productName: "B", qty: 2, returnedQty: 2, isCanceledItem: false, lineTotal: 100_000 },
              { itemId: "item-3", itemSku: "C", productName: "C", qty: 1, returnedQty: 0, isCanceledItem: true, lineTotal: 50_000 },
            ],
          }),
        ],
      })
    );
    expect(result.rows.map((r) => [r.parentSku, r.netQuantity, r.lineTotal])).toEqual([["A", 3, 300_000]]);
  });

  it("reports a line with no catalog item as unmapped instead of counting it", () => {
    const result = buildMarketplaceDemand(
      input({
        orders: [
          order({
            lines: [
              { itemId: null, itemSku: null, productName: "Unknown", qty: 3, returnedQty: 0, isCanceledItem: false, lineTotal: 90_000 },
            ],
          }),
        ],
      })
    );
    expect(result.rows).toEqual([]);
    expect(diag(result, "SHOPEE", 2026, 6)).toMatchObject({ unmappedLines: 1, unmappedQty: 3, countedOrders: 1 });
  });

  it("skips an order already imported from the marketplace Excel export", () => {
    const result = buildMarketplaceDemand(
      input({ importedOrderNumbers: { SHOPEE: new Set(["2606100001"]), TIKTOK: new Set() } })
    );
    expect(result.rows).toEqual([]);
    expect(diag(result, "SHOPEE", 2026, 6)).toMatchObject({ dedupedOrders: 1, countedOrders: 0 });
  });

  it("dedupes only within the same marketplace family", () => {
    const result = buildMarketplaceDemand(
      input({ importedOrderNumbers: { SHOPEE: new Set(), TIKTOK: new Set(["2606100001"]) } })
    );
    expect(result.rows).toHaveLength(1);
  });

  it("settles a TOKOPEDIA order against TIKTOK settlements and delay", () => {
    const result = buildMarketplaceDemand(
      input({
        orders: [order({ channel: "TOKOPEDIA" })],
        settlementPeriods: { SHOPEE: [], TIKTOK: [period([2026, 6, 1], [2026, 7, 14])] },
      })
    );
    expect(result.rows).toHaveLength(1);
    expect(diag(result, "TIKTOK", 2026, 6)).toMatchObject({ settled: true, countedOrders: 1 });
  });

  it("ignores orders from channels with no settlement family", () => {
    const result = buildMarketplaceDemand(input({ orders: [order({ channel: "OTHER" })] }));
    expect(result.rows).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
