import { describe, expect, it } from "vitest";
import { compareCashFlow, previousPeriod } from "./cash-flow-compare";
import type { CashFlowStatement } from "./cash-flow";

function statement(over: Partial<CashFlowStatement>): CashFlowStatement {
  return {
    labaBersih: 0,
    operasional: [],
    totalOperasional: 0,
    investasi: [],
    totalInvestasi: 0,
    pendanaan: [],
    totalPendanaan: 0,
    unclassified: [],
    totalUnclassified: 0,
    netChange: 0,
    kasAwal: 0,
    kasAkhir: 0,
    kasAkhirActual: 0,
    isReconciled: true,
    hasCashAccount: true,
    hasMovement: true,
    ...over,
  };
}

describe("previousPeriod", () => {
  it("returns the immediately preceding window of equal length", () => {
    const from = new Date("2026-08-01T00:00:00.000+07:00");
    const to = new Date("2026-08-31T23:59:59.999+07:00");

    const prev = previousPeriod(from, to);

    expect(prev.to.toISOString()).toBe(
      new Date("2026-07-31T23:59:59.999+07:00").toISOString(),
    );
    expect(prev.from.toISOString()).toBe(
      new Date("2026-07-01T00:00:00.000+07:00").toISOString(),
    );
  });

  it("leaves no gap and no overlap between the two windows", () => {
    const from = new Date("2026-08-10T00:00:00.000+07:00");
    const to = new Date("2026-08-12T23:59:59.999+07:00");

    const prev = previousPeriod(from, to);

    expect(prev.to.getTime()).toBe(from.getTime() - 1);
    expect(to.getTime() - from.getTime()).toBe(prev.to.getTime() - prev.from.getTime());
  });
});

describe("compareCashFlow", () => {
  it("pairs lines by account and computes the delta", () => {
    const current = statement({
      operasional: [{ accountId: "ar", code: "1201", name: "Piutang", amount: -500 }],
      totalOperasional: -500,
    });
    const previous = statement({
      operasional: [{ accountId: "ar", code: "1201", name: "Piutang", amount: -200 }],
      totalOperasional: -200,
    });

    const cmp = compareCashFlow(current, previous);

    expect(cmp.operasional).toEqual([
      {
        accountId: "ar",
        code: "1201",
        name: "Piutang",
        current: -500,
        previous: -200,
        delta: -300,
      },
    ]);
    expect(cmp.totalOperasional).toEqual({ current: -500, previous: -200, delta: -300 });
  });

  it("keeps an account that moved only in the previous period", () => {
    const current = statement({});
    const previous = statement({
      investasi: [{ accountId: "veh", code: "1501", name: "Kendaraan", amount: -9_000 }],
      totalInvestasi: -9_000,
    });

    const cmp = compareCashFlow(current, previous);

    expect(cmp.investasi).toEqual([
      {
        accountId: "veh",
        code: "1501",
        name: "Kendaraan",
        current: 0,
        previous: -9_000,
        delta: 9_000,
      },
    ]);
  });

  it("keeps an account that moved only in the current period", () => {
    const current = statement({
      pendanaan: [{ accountId: "cap", code: "3100", name: "Modal", amount: 1_000 }],
      totalPendanaan: 1_000,
    });

    const cmp = compareCashFlow(current, statement({}));

    expect(cmp.pendanaan[0]).toEqual({
      accountId: "cap",
      code: "3100",
      name: "Modal",
      current: 1_000,
      previous: 0,
      delta: 1_000,
    });
  });

  it("sorts the union of both periods by account code", () => {
    const current = statement({
      operasional: [{ accountId: "c", code: "1300", name: "C", amount: 1 }],
    });
    const previous = statement({
      operasional: [{ accountId: "a", code: "1210", name: "A", amount: 2 }],
    });

    expect(compareCashFlow(current, previous).operasional.map((l) => l.code)).toEqual([
      "1210",
      "1300",
    ]);
  });

  it("compares every headline total", () => {
    const current = statement({ labaBersih: 10, netChange: 4, kasAwal: 1, kasAkhir: 5 });
    const previous = statement({ labaBersih: 6, netChange: 3, kasAwal: 0, kasAkhir: 3 });

    const cmp = compareCashFlow(current, previous);

    expect(cmp.labaBersih).toEqual({ current: 10, previous: 6, delta: 4 });
    expect(cmp.netChange).toEqual({ current: 4, previous: 3, delta: 1 });
    expect(cmp.kasAwal).toEqual({ current: 1, previous: 0, delta: 1 });
    expect(cmp.kasAkhir).toEqual({ current: 5, previous: 3, delta: 2 });
  });
});
