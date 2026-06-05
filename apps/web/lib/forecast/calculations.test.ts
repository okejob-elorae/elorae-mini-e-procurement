import { describe, expect, it } from "vitest";
import {
  aggregateMonthlyDemand,
  classifyABC,
  classifyXYZ,
  computeBaseRate,
  computeSeasonalIndices,
  generateForecast,
} from "./calculations";
import type { DemandRow, MonthlyDemand } from "./types";

function monthlyDemand(
  parentSku: string,
  entries: Array<{ year: number; month: number; qty: number; revenue?: number }>
): MonthlyDemand[] {
  return entries.map((e) => ({
    parentSku,
    productName: parentSku,
    year: e.year,
    month: e.month,
    totalQty: e.qty,
    totalRevenue: e.revenue ?? e.qty * 100,
  }));
}

describe("computeBaseRate", () => {
  it("returns flat demand average", () => {
    const data = monthlyDemand("A", [
      { year: 2025, month: 7, qty: 400 },
      { year: 2025, month: 6, qty: 400 },
      { year: 2025, month: 5, qty: 400 },
      { year: 2025, month: 4, qty: 400 },
      { year: 2025, month: 3, qty: 400 },
      { year: 2025, month: 2, qty: 400 },
    ]);
    expect(computeBaseRate(data, 6, 0.9)).toBe(400);
  });

  it("weights recent months higher when trending up", () => {
    const data = monthlyDemand("A", [
      { year: 2025, month: 6, qty: 600 },
      { year: 2025, month: 5, qty: 500 },
      { year: 2025, month: 4, qty: 400 },
      { year: 2025, month: 3, qty: 300 },
      { year: 2025, month: 2, qty: 200 },
      { year: 2025, month: 1, qty: 100 },
    ]);
    const rate = computeBaseRate(data, 6, 0.9);
    expect(rate).toBeGreaterThan(350);
    expect(rate).toBeLessThan(500);
  });

  it("returns single month value", () => {
    const data = monthlyDemand("A", [{ year: 2025, month: 1, qty: 250 }]);
    expect(computeBaseRate(data, 12, 0.9)).toBe(250);
  });

  it("returns 0 for no data", () => {
    expect(computeBaseRate([], 12, 0.9)).toBe(0);
  });

  it("includes zero months in weighted average", () => {
    const data = monthlyDemand("A", [
      { year: 2025, month: 6, qty: 400 },
      { year: 2025, month: 5, qty: 0 },
      { year: 2025, month: 4, qty: 400 },
      { year: 2025, month: 3, qty: 0 },
      { year: 2025, month: 2, qty: 400 },
      { year: 2025, month: 1, qty: 0 },
    ]);
    const rate = computeBaseRate(data, 6, 0.9);
    expect(rate).toBeLessThan(400);
    expect(rate).toBeGreaterThan(150);
  });
});

describe("computeSeasonalIndices", () => {
  it("returns all 1.0 for identical months", () => {
    const data = monthlyDemand(
      "A",
      Array.from({ length: 12 }, (_, i) => ({
        year: 2024,
        month: i + 1,
        qty: 400,
      }))
    );
    const indices = computeSeasonalIndices(data);
    expect(indices).toHaveLength(12);
    indices.forEach((idx) => expect(idx).toBeCloseTo(1, 1));
  });

  it("returns all 1.0 when fewer than 12 months", () => {
    const data = monthlyDemand("A", [
      { year: 2025, month: 1, qty: 100 },
      { year: 2025, month: 2, qty: 200 },
    ]);
    expect(computeSeasonalIndices(data).every((i) => i === 1)).toBe(true);
  });
});

describe("classifyABC", () => {
  it("assigns A/B/C by cumulative revenue", () => {
    const map = classifyABC([
      { parentSku: "a", totalRevenue: 800 },
      { parentSku: "b", totalRevenue: 100 },
      { parentSku: "c", totalRevenue: 50 },
      { parentSku: "d", totalRevenue: 30 },
      { parentSku: "e", totalRevenue: 20 },
    ]);
    expect(map.get("a")).toBe("A");
    expect(map.get("b")).toBe("B");
    expect(map.get("e")).toBe("C");
  });

  it("assigns A to single article", () => {
    const map = classifyABC([{ parentSku: "only", totalRevenue: 1000 }]);
    expect(map.get("only")).toBe("A");
  });
});

describe("classifyXYZ", () => {
  it("classifies stable demand as X", () => {
    const map = classifyXYZ(
      new Map([["a", [100, 100, 100, 100, 100, 100]]])
    );
    expect(map.get("a")?.class).toBe("X");
  });

  it("classifies erratic demand as Z", () => {
    const map = classifyXYZ(
      new Map([["a", [500, 10, 400, 0, 300, 5]]])
    );
    expect(map.get("a")?.class).toBe("Z");
  });

  it("classifies insufficient data as Z", () => {
    const map = classifyXYZ(new Map([["a", [100, 200]]]));
    expect(map.get("a")?.class).toBe("Z");
  });
});

describe("generateForecast", () => {
  it("applies no growth with flat season", () => {
    const { monthly, annual } = generateForecast(400, Array(12).fill(1), 0);
    expect(monthly.every((m) => m === 400)).toBe(true);
    expect(annual).toBe(4800);
  });

  it("applies growth factor", () => {
    const { monthly, annual } = generateForecast(400, Array(12).fill(1), 15);
    expect(monthly.every((m) => m === 460)).toBe(true);
    expect(annual).toBe(5520);
  });

  it("applies seasonal index for June", () => {
    const indices = Array(12).fill(1);
    indices[5] = 1.4;
    const { monthly } = generateForecast(400, indices, 0);
    expect(monthly[5]).toBe(560);
    expect(monthly[0]).toBe(400);
  });
});

describe("aggregateMonthlyDemand", () => {
  it("groups by parentSku year month", () => {
    const rows: DemandRow[] = [
      {
        parentSku: "27000053",
        productName: "Test",
        netQuantity: 2,
        lineTotal: 200,
        orderDate: new Date("2025-07-01"),
        month: 7,
        year: 2025,
      },
      {
        parentSku: "27000053",
        productName: "Test",
        netQuantity: 3,
        lineTotal: 300,
        orderDate: new Date("2025-07-15"),
        month: 7,
        year: 2025,
      },
    ];
    const agg = aggregateMonthlyDemand(rows);
    expect(agg).toHaveLength(1);
    expect(agg[0].totalQty).toBe(5);
    expect(agg[0].totalRevenue).toBe(500);
  });
});
