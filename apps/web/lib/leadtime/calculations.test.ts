import { describe, expect, it } from "vitest";
import {
  buildChainSnapshot,
  computeActualLeadDays,
  computeStepDays,
  getExpectedPosition,
  getPositionDrift,
  resolveChain,
  sumPcsQty,
  suggestEta,
  type ResolvedStep,
  type SnapshotStep,
} from "./calculations";

function fixed(seq: number, name: string, days: number): ResolvedStep {
  return { seq, name, type: "FIXED", days, rateQty: null };
}

function perQty(seq: number, name: string, days: number, rateQty: number): ResolvedStep {
  return { seq, name, type: "PER_QTY", days, rateQty };
}

describe("computeStepDays (BATCH_CEIL)", () => {
  it("FIXED ignores qty", () => {
    expect(computeStepDays(fixed(1, "X", 10), 99999)).toBe(10);
  });

  it("PER_QTY exact 1 batch", () => {
    expect(computeStepDays(perQty(1, "X", 30, 10000), 10000)).toBe(30);
  });

  it("PER_QTY ceil 1.5 → 2 batches", () => {
    expect(computeStepDays(perQty(1, "X", 30, 10000), 15000)).toBe(60);
  });

  it("PER_QTY under 1 batch → 1", () => {
    expect(computeStepDays(perQty(1, "X", 30, 10000), 9999)).toBe(30);
  });

  it("PER_QTY ceil 2.0001 → 3", () => {
    expect(computeStepDays(perQty(1, "X", 30, 10000), 20001)).toBe(90);
  });

  it("PER_QTY null qty → 1 batch", () => {
    expect(computeStepDays(perQty(1, "X", 30, 10000), null)).toBe(30);
  });

  it("PER_QTY zero qty → 1 batch", () => {
    expect(computeStepDays(perQty(1, "X", 30, 10000), 0)).toBe(30);
  });

  it("PER_QTY sablon 3 batches", () => {
    expect(computeStepDays(perQty(1, "X", 7, 4000), 12000)).toBe(21);
  });

  it("PER_QTY override-rate example", () => {
    expect(computeStepDays(perQty(1, "X", 50, 18000), 18000)).toBe(50);
  });

  it("PER_QTY null rateQty fallback", () => {
    expect(
      computeStepDays({ seq: 1, name: "X", type: "PER_QTY", days: 30, rateQty: null }, 15000)
    ).toBe(30);
  });
});

describe("buildChainSnapshot / totals", () => {
  it("ALEX ZIPPER style", () => {
    const { totalDays } = buildChainSnapshot(
      [fixed(1, "A", 40), fixed(2, "B", 3)],
      999
    );
    expect(totalDays).toBe(43);
  });

  it("ASTX style", () => {
    const { totalDays } = buildChainSnapshot(
      [fixed(1, "A", 10), fixed(2, "B", 3), fixed(3, "C", 2), fixed(4, "D", 45), fixed(5, "E", 5)],
      null
    );
    expect(totalDays).toBe(65);
  });

  it("mixed with PER_QTY at 15000", () => {
    const { totalDays, snapshot } = buildChainSnapshot(
      [fixed(1, "A", 10), perQty(2, "B", 30, 10000), fixed(3, "C", 5)],
      15000
    );
    expect(totalDays).toBe(75);
    expect(snapshot[1].computedDays).toBe(60);
    expect(snapshot[1].qty).toBe(15000);
  });

  it("empty chain", () => {
    const { totalDays, snapshot } = buildChainSnapshot([], 100);
    expect(totalDays).toBe(0);
    expect(snapshot).toEqual([]);
  });
});

describe("resolveChain", () => {
  it("applies overrides and skips inactive", () => {
    const resolved = resolveChain([
      {
        sequence: 2,
        overrideDays: 3,
        overrideRateQty: null,
        processTemplate: {
          name: "REVISI",
          leadTimeType: "FIXED",
          days: 7,
          rateQty: null,
          isActive: true,
        },
      },
      {
        sequence: 1,
        overrideDays: null,
        overrideRateQty: 5000,
        processTemplate: {
          name: "PRODUKSI",
          leadTimeType: "PER_QTY",
          days: 30,
          rateQty: 10000,
          isActive: true,
        },
      },
      {
        sequence: 3,
        overrideDays: null,
        overrideRateQty: null,
        processTemplate: {
          name: "ARCHIVED",
          leadTimeType: "FIXED",
          days: 1,
          rateQty: null,
          isActive: false,
        },
      },
    ]);
    expect(resolved).toEqual([
      { seq: 1, name: "PRODUKSI", type: "PER_QTY", days: 30, rateQty: 5000 },
      { seq: 2, name: "REVISI", type: "FIXED", days: 3, rateQty: null },
    ]);
  });
});

describe("getExpectedPosition", () => {
  const snapshot: SnapshotStep[] = [
    { ...fixed(1, "MATCHING WARNA", 10), qty: null, computedDays: 10 },
    { ...fixed(2, "PENGIRIMAN", 3), qty: null, computedDays: 3 },
    { ...fixed(3, "ACC WARNA", 2), qty: null, computedDays: 2 },
    { ...fixed(4, "PRODUKSI", 45), qty: null, computedDays: 45 },
    { ...fixed(5, "KIRIM", 5), qty: null, computedDays: 5 },
  ];
  const created = new Date(2026, 0, 1);

  function atElapsed(elapsed: number) {
    const now = new Date(2026, 0, 1);
    now.setDate(now.getDate() + elapsed);
    return getExpectedPosition(snapshot, created, now);
  }

  it.each([
    [0, 0, 1],
    [9, 0, 10],
    [10, 1, 1],
    [12, 1, 3],
    [13, 2, 1],
    [15, 3, 1],
    [59, 3, 45],
    [60, 4, 1],
    [64, 4, 5],
  ] as const)("elapsed %i → step %i day %i", (elapsed, step, day) => {
    const pos = atElapsed(elapsed);
    expect(pos.status).toBe("IN_PROGRESS");
    expect(pos.stepIndex).toBe(step);
    expect(pos.dayInStep).toBe(day);
  });

  it("elapsed 65 → PAST_DUE overdue 1", () => {
    const pos = atElapsed(65);
    expect(pos.status).toBe("PAST_DUE");
    expect(pos.overdueDays).toBe(1);
  });

  it("elapsed 80 → PAST_DUE overdue 16", () => {
    const pos = atElapsed(80);
    expect(pos.status).toBe("PAST_DUE");
    expect(pos.overdueDays).toBe(16);
  });

  it("elapsed -1 → NOT_STARTED", () => {
    const now = new Date(2025, 11, 31);
    const pos = getExpectedPosition(snapshot, created, now);
    expect(pos.status).toBe("NOT_STARTED");
  });

  it("2026-03-06 still IN_PROGRESS; 2026-03-07 PAST_DUE", () => {
    expect(getExpectedPosition(snapshot, created, new Date(2026, 2, 6)).status).toBe(
      "IN_PROGRESS"
    );
    expect(getExpectedPosition(snapshot, created, new Date(2026, 2, 7)).status).toBe("PAST_DUE");
  });
});

describe("getPositionDrift", () => {
  const base = {
    status: "IN_PROGRESS" as const,
    stepName: "X",
    dayInStep: 1,
    elapsedDays: 10,
    totalDays: 65,
    overdueDays: 0,
  };

  it("same step → lag 0", () => {
    expect(getPositionDrift({ ...base, stepIndex: 3 }, 3)).toEqual({
      lagSteps: 0,
      isBehind: false,
    });
  });

  it("behind → positive lag", () => {
    expect(getPositionDrift({ ...base, stepIndex: 3 }, 1)).toEqual({
      lagSteps: 2,
      isBehind: true,
    });
  });

  it("null confirmed → no signal", () => {
    expect(getPositionDrift({ ...base, stepIndex: 3 }, null)).toEqual({
      lagSteps: null,
      isBehind: false,
    });
  });

  it("ahead → negative lag, not behind", () => {
    expect(getPositionDrift({ ...base, stepIndex: 1 }, 3)).toEqual({
      lagSteps: -2,
      isBehind: false,
    });
  });
});

describe("suggestEta (inclusive)", () => {
  const poDate = new Date(2026, 0, 1);

  it("65 days → 2026-03-06", () => {
    const eta = suggestEta(poDate, 65);
    expect(eta.getFullYear()).toBe(2026);
    expect(eta.getMonth()).toBe(2);
    expect(eta.getDate()).toBe(6);
  });

  it("1 day → same day", () => {
    const eta = suggestEta(poDate, 1);
    expect(eta.getDate()).toBe(1);
    expect(eta.getMonth()).toBe(0);
  });

  it("0 days → unchanged", () => {
    const eta = suggestEta(poDate, 0);
    expect(eta.getTime()).toBe(poDate.getTime());
  });

  it("43 days → 2026-02-12", () => {
    const eta = suggestEta(poDate, 43);
    expect(eta.getFullYear()).toBe(2026);
    expect(eta.getMonth()).toBe(1);
    expect(eta.getDate()).toBe(12);
  });
});

describe("computeActualLeadDays", () => {
  it("64 days", () => {
    expect(
      computeActualLeadDays(new Date(2026, 0, 1), new Date(2026, 2, 6))
    ).toBe(64);
  });

  it("same day → 0", () => {
    expect(
      computeActualLeadDays(new Date(2026, 0, 1), new Date(2026, 0, 1))
    ).toBe(0);
  });

  it("grn before po → clamp 0", () => {
    expect(
      computeActualLeadDays(new Date(2026, 0, 10), new Date(2026, 0, 8))
    ).toBe(0);
  });
});

describe("sumPcsQty", () => {
  it("sums PCS and FG/ACCESSORIES; skips fabric meters", () => {
    expect(
      sumPcsQty([
        { qty: 100, uomCode: "M", itemType: "FABRIC" },
        { qty: 500, uomCode: "PCS", itemType: "ACCESSORIES" },
        { qty: 1000, uomCode: "PCS", itemType: "FINISHED_GOOD" },
        { qty: 50, uomCode: "BOX", itemType: "FINISHED_GOOD" },
      ])
    ).toBe(1550);
  });

  it("pure fabric → 0", () => {
    expect(sumPcsQty([{ qty: 200, uomCode: "M", itemType: "FABRIC" }])).toBe(0);
  });
});
