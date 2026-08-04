import { describe, expect, it } from "vitest";
import { buildTrialBalance } from "./trial-balance";
import type { BalanceRow } from "./balances";

function row(over: Partial<BalanceRow> & { accountId: string; code: string }): BalanceRow {
  return {
    accountId: over.accountId,
    code: over.code,
    name: over.name ?? `Account ${over.code}`,
    type: over.type ?? "ASET",
    parentId: over.parentId ?? null,
    depth: over.depth ?? 0,
    isActive: over.isActive ?? true,
    hasChildren: over.hasChildren ?? false,
    debit: over.debit ?? 0,
    credit: over.credit ?? 0,
    signed: over.signed ?? 0,
  };
}

describe("buildTrialBalance", () => {
  it("hides parent accounts that carry no movement of their own", () => {
    const rows: BalanceRow[] = [
      row({ accountId: "p", code: "1100", hasChildren: true, debit: 0, credit: 0 }),
      row({ accountId: "c", code: "1101", parentId: "p", debit: 500, credit: 0, signed: 500 }),
      row({ accountId: "k", code: "2100", type: "LIABILITAS", debit: 0, credit: 500, signed: 500 }),
    ];

    const tb = buildTrialBalance(rows);

    expect(tb.rows.map((r) => r.code)).toEqual(["1101", "2100"]);
    expect(tb.totalDebit).toBe(500);
    expect(tb.totalCredit).toBe(500);
    expect(tb.isBalanced).toBe(true);
  });

  it("keeps a parent that has both its own movement and a child", () => {
    /*
     * An account posted to before it gained a child. Each row carries only its
     * own lines (per-account groupBy), so the parent's 300 is not a rollup of
     * the child's 200 — dropping it would leave debit 200 against credit 500.
     */
    const rows: BalanceRow[] = [
      row({ accountId: "p", code: "1100", hasChildren: true, debit: 300, credit: 0, signed: 300 }),
      row({ accountId: "c", code: "1101", parentId: "p", debit: 200, credit: 0, signed: 200 }),
      row({ accountId: "k", code: "2100", type: "LIABILITAS", debit: 0, credit: 500, signed: 500 }),
    ];

    const tb = buildTrialBalance(rows);

    expect(tb.rows.map((r) => r.code)).toEqual(["1100", "1101", "2100"]);
    const parent = tb.rows.find((r) => r.code === "1100");
    expect(parent).toMatchObject({ debit: 300, credit: 0, signed: 300 });
    expect(tb.totalDebit).toBe(500);
    expect(tb.totalCredit).toBe(500);
    expect(tb.isBalanced).toBe(true);
  });

  it("hides zero-movement rows by default and shows them on request", () => {
    const rows: BalanceRow[] = [
      row({ accountId: "a", code: "1101", debit: 100, credit: 0, signed: 100 }),
      row({ accountId: "b", code: "1102", debit: 0, credit: 0 }),
    ];

    expect(buildTrialBalance(rows).rows.map((r) => r.code)).toEqual(["1101"]);
    expect(buildTrialBalance(rows, { includeZero: true }).rows.map((r) => r.code)).toEqual([
      "1101",
      "1102",
    ]);
  });

  it("reports unbalanced totals instead of hiding them", () => {
    const rows: BalanceRow[] = [
      row({ accountId: "a", code: "1101", debit: 100, credit: 0, signed: 100 }),
      row({ accountId: "b", code: "2100", type: "LIABILITAS", debit: 0, credit: 90, signed: 90 }),
    ];

    const tb = buildTrialBalance(rows);

    expect(tb.totalDebit).toBe(100);
    expect(tb.totalCredit).toBe(90);
    expect(tb.isBalanced).toBe(false);
  });

  it("compares totals at cent precision, tolerating float drift", () => {
    const rows: BalanceRow[] = [
      row({ accountId: "a", code: "1101", debit: 0.1 + 0.2, credit: 0, signed: 0.3 }),
      row({ accountId: "b", code: "2100", type: "LIABILITAS", debit: 0, credit: 0.3, signed: 0.3 }),
    ];

    expect(buildTrialBalance(rows).isBalanced).toBe(true);
  });
});
