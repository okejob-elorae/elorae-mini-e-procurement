import { describe, expect, it } from "vitest";
import { buildIncomeStatement } from "./income-statement";
import type { BalanceRow } from "./balances";
import { signedDelta } from "@/lib/finance/journals/normal-side";
import type { AccountType } from "@/lib/constants/enums";

function row(
  accountId: string,
  code: string,
  type: AccountType,
  debit: number,
  credit: number,
  over?: Partial<BalanceRow>,
): BalanceRow {
  return {
    accountId,
    code,
    name: `Account ${code}`,
    type,
    parentId: over?.parentId ?? null,
    depth: over?.depth ?? 0,
    isActive: true,
    hasChildren: over?.hasChildren ?? false,
    debit,
    credit,
    signed: signedDelta(type, debit, credit),
  };
}

describe("buildIncomeStatement", () => {
  it("computes gross and net profit from typed accounts", () => {
    const rows: BalanceRow[] = [
      row("rev", "4100", "PENDAPATAN", 0, 10_000_000),
      row("cogs", "5100", "HPP", 6_000_000, 0),
      row("fee", "6100", "BEBAN", 1_500_000, 0),
    ];

    const is = buildIncomeStatement(rows);

    expect(is.totalPendapatan).toBe(10_000_000);
    expect(is.totalHpp).toBe(6_000_000);
    expect(is.labaKotor).toBe(4_000_000);
    expect(is.totalBeban).toBe(1_500_000);
    expect(is.labaBersih).toBe(2_500_000);
  });

  it("nets a sales-return debit against revenue", () => {
    const rows: BalanceRow[] = [row("rev", "4100", "PENDAPATAN", 1_000_000, 10_000_000)];

    expect(buildIncomeStatement(rows).totalPendapatan).toBe(9_000_000);
  });

  it("nets a contra-expense credit against expenses", () => {
    const rows: BalanceRow[] = [
      row("rev", "4100", "PENDAPATAN", 0, 5_000_000),
      row("fee", "6100", "BEBAN", 0, 200_000),
    ];

    const is = buildIncomeStatement(rows);

    expect(is.totalBeban).toBe(-200_000);
    expect(is.labaBersih).toBe(5_200_000);
  });

  it("reports a loss as a negative net profit", () => {
    const rows: BalanceRow[] = [
      row("rev", "4100", "PENDAPATAN", 0, 1_000_000),
      row("cogs", "5100", "HPP", 900_000, 0),
      row("fee", "6100", "BEBAN", 400_000, 0),
    ];

    expect(buildIncomeStatement(rows).labaBersih).toBe(-300_000);
  });

  it("ignores balance-sheet accounts entirely", () => {
    const rows: BalanceRow[] = [
      row("cash", "1102", "ASET", 5_000_000, 0),
      row("ap", "2100", "LIABILITAS", 0, 5_000_000),
    ];

    const is = buildIncomeStatement(rows);

    expect(is.pendapatan).toEqual([]);
    expect(is.labaBersih).toBe(0);
  });

  it("counts a parent's children once via the rollup subtotal", () => {
    const rows: BalanceRow[] = [
      row("p", "6100", "BEBAN", 0, 0, { hasChildren: true }),
      row("c1", "6101", "BEBAN", 100_000, 0, { parentId: "p", depth: 1 }),
      row("c2", "6102", "BEBAN", 250_000, 0, { parentId: "p", depth: 1 }),
    ];

    const is = buildIncomeStatement(rows);

    expect(is.beban).toHaveLength(1);
    expect(is.beban[0].subtotal).toBe(350_000);
    expect(is.totalBeban).toBe(350_000);
  });
});
