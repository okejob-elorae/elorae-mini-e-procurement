import { describe, expect, it } from "vitest";
import { buildBalanceSheet } from "./balance-sheet";
import type { BalanceRow } from "./balances";
import { signedDelta } from "@/lib/finance/journals/normal-side";
import type { AccountType } from "@/lib/constants/enums";

function row(
  accountId: string,
  code: string,
  type: AccountType,
  debit: number,
  credit: number,
): BalanceRow {
  return {
    accountId,
    code,
    name: `Account ${code}`,
    type,
    parentId: null,
    depth: 0,
    isActive: true,
    hasChildren: false,
    debit,
    credit,
    signed: signedDelta(type, debit, credit),
  };
}

describe("buildBalanceSheet", () => {
  it("balances a period with profit via the unclosed-earnings line", () => {
    /* Sale of 10m on credit, COGS 6m out of inventory. */
    const rows: BalanceRow[] = [
      row("ar", "1103", "ASET", 10_000_000, 0),
      row("inv", "1104", "ASET", 0, 6_000_000),
      row("rev", "4100", "PENDAPATAN", 0, 10_000_000),
      row("cogs", "5100", "HPP", 6_000_000, 0),
    ];

    const bs = buildBalanceSheet(rows);

    expect(bs.totalAset).toBe(4_000_000);
    expect(bs.unclosedEarnings).toBe(4_000_000);
    expect(bs.totalLiabilitasEkuitas).toBe(4_000_000);
    expect(bs.isBalanced).toBe(true);
  });

  it("would not balance without the unclosed-earnings line", () => {
    const rows: BalanceRow[] = [
      row("ar", "1103", "ASET", 10_000_000, 0),
      row("rev", "4100", "PENDAPATAN", 0, 10_000_000),
    ];

    const bs = buildBalanceSheet(rows);

    expect(bs.totalEkuitas).toBe(0);
    expect(bs.unclosedEarnings).toBe(10_000_000);
    expect(bs.isBalanced).toBe(true);
  });

  it("includes liabilities and posted equity in the right-hand total", () => {
    const rows: BalanceRow[] = [
      row("inv", "1104", "ASET", 15_000_000, 0),
      row("ap", "2100", "LIABILITAS", 0, 5_000_000),
      row("cap", "3100", "EKUITAS", 0, 10_000_000),
    ];

    const bs = buildBalanceSheet(rows);

    expect(bs.totalLiabilitas).toBe(5_000_000);
    expect(bs.totalEkuitas).toBe(10_000_000);
    expect(bs.unclosedEarnings).toBe(0);
    expect(bs.totalLiabilitasEkuitas).toBe(15_000_000);
    expect(bs.isBalanced).toBe(true);
  });

  it("carries a loss as negative unclosed earnings", () => {
    const rows: BalanceRow[] = [
      row("cash", "1102", "ASET", 0, 2_000_000),
      row("exp", "6100", "BEBAN", 2_000_000, 0),
    ];

    const bs = buildBalanceSheet(rows);

    expect(bs.totalAset).toBe(-2_000_000);
    expect(bs.unclosedEarnings).toBe(-2_000_000);
    expect(bs.isBalanced).toBe(true);
  });

  it("flags an unbalanced set instead of hiding it", () => {
    const rows: BalanceRow[] = [row("cash", "1102", "ASET", 1_000_000, 0)];

    const bs = buildBalanceSheet(rows);

    expect(bs.totalAset).toBe(1_000_000);
    expect(bs.totalLiabilitasEkuitas).toBe(0);
    expect(bs.isBalanced).toBe(false);
  });

  it("compares sides at cent precision", () => {
    const rows: BalanceRow[] = [
      row("cash", "1102", "ASET", 0.1 + 0.2, 0),
      row("cap", "3100", "EKUITAS", 0, 0.3),
    ];

    expect(buildBalanceSheet(rows).isBalanced).toBe(true);
  });
});
