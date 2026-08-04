import type { BalanceRow } from "./balances";

export type TrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  debit: number;
  credit: number;
  signed: number;
};

export type TrialBalance = {
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
};

const cents = (value: number): number => Math.round(value * 100);

/**
 * Trial Balance over postable leaves only — a parent account carries no lines
 * of its own, so including it would double-count its children.
 */
export function buildTrialBalance(
  rows: BalanceRow[],
  opts?: { includeZero?: boolean },
): TrialBalance {
  const includeZero = opts?.includeZero ?? false;
  const leaves = rows.filter((r) => !r.hasChildren);
  const visible = includeZero ? leaves : leaves.filter((r) => r.debit !== 0 || r.credit !== 0);

  let totalDebit = 0;
  let totalCredit = 0;
  const out: TrialBalanceRow[] = visible.map((r) => {
    totalDebit += r.debit;
    totalCredit += r.credit;
    return {
      accountId: r.accountId,
      code: r.code,
      name: r.name,
      debit: r.debit,
      credit: r.credit,
      signed: r.signed,
    };
  });

  return {
    rows: out,
    totalDebit,
    totalCredit,
    isBalanced: cents(totalDebit) === cents(totalCredit),
  };
}
