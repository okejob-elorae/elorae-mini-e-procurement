import { describe, expect, it } from "vitest";
import { splitMarketplaceFees } from "./fee-split";

const totals = (over?: Partial<Parameters<typeof splitMarketplaceFees>[0]>) => ({
  admin: 0,
  service: 0,
  commission: 0,
  processing: 0,
  ...over,
});

describe("splitMarketplaceFees", () => {
  it("emits one debit line per nonzero category plus the residual", () => {
    const lines = splitMarketplaceFees(
      totals({ admin: 1000, service: 500, commission: 300, processing: 200 }),
      2500,
    );

    expect(lines).toEqual([
      { role: "MARKETPLACE_FEE_ADMIN", debit: 1000, credit: 0 },
      { role: "MARKETPLACE_FEE_SERVICE", debit: 500, credit: 0 },
      { role: "MARKETPLACE_FEE_COMMISSION", debit: 300, credit: 0 },
      { role: "MARKETPLACE_FEE_PROCESSING", debit: 200, credit: 0 },
      { role: "MARKETPLACE_FEE_OTHER", debit: 500, credit: 0 },
    ]);
  });

  it("always sums to totalPengeluaran", () => {
    const lines = splitMarketplaceFees(totals({ admin: 1234.56, service: 78.9 }), 5000);
    const net = lines.reduce((sum, l) => sum + l.debit - l.credit, 0);

    expect(Math.round(net * 100)).toBe(Math.round(5000 * 100));
  });

  it("skips categories with a zero amount", () => {
    const lines = splitMarketplaceFees(totals({ admin: 400 }), 400);

    expect(lines).toEqual([{ role: "MARKETPLACE_FEE_ADMIN", debit: 400, credit: 0 }]);
  });

  it("puts everything into the residual when no category is itemized (TikTok)", () => {
    const lines = splitMarketplaceFees(totals(), 9000);

    expect(lines).toEqual([{ role: "MARKETPLACE_FEE_OTHER", debit: 9000, credit: 0 }]);
  });

  it("emits a credit line when the residual is negative", () => {
    const lines = splitMarketplaceFees(totals({ admin: 1000 }), 800);

    expect(lines).toEqual([
      { role: "MARKETPLACE_FEE_ADMIN", debit: 1000, credit: 0 },
      { role: "MARKETPLACE_FEE_OTHER", debit: 0, credit: 200 },
    ]);
  });

  it("emits a credit line for a negative category amount", () => {
    const lines = splitMarketplaceFees(totals({ admin: -150 }), -150);

    expect(lines).toEqual([{ role: "MARKETPLACE_FEE_ADMIN", debit: 0, credit: 150 }]);
  });

  it("returns no lines when there is nothing to post", () => {
    expect(splitMarketplaceFees(totals(), 0)).toEqual([]);
  });

  it("rounds each line to cents so the journal balances", () => {
    const lines = splitMarketplaceFees(totals({ admin: 0.005 }), 0.01);

    for (const line of lines) {
      expect(Math.round(line.debit * 100)).toBe(line.debit * 100);
      expect(Math.round(line.credit * 100)).toBe(line.credit * 100);
    }
  });
});
