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
 * Trial Balance over every account that carries movement, plus — when
 * `includeZero` is set — the empty postable leaves, so a reader can see the
 * whole postable chart.
 *
 * A `BalanceRow`'s debit/credit come from a per-account `groupBy` in
 * `getAccountBalances`, so each row holds ONLY its own journal lines and never
 * a rollup of its children. Including a parent therefore cannot double-count.
 * Dropping one, on the other hand, would: `postJournal` rejects non-leaf
 * accounts only at post time, and nothing stops an account that already has
 * lines from later gaining a child, so a parent with movement exists in real
 * data. Omitting it would break the `totalDebit === totalCredit` identity, fire
 * the corruption warning falsely, and disagree with Laba Rugi / Neraca, which
 * count every node's own `signed`. Empty parents are still hidden — they are
 * structure, not balances, and the rollup statements render the tree anyway.
 */
export function buildTrialBalance(
  rows: BalanceRow[],
  opts?: { includeZero?: boolean },
): TrialBalance {
  const includeZero = opts?.includeZero ?? false;
  const visible = rows.filter((r) => {
    const hasMovement = r.debit !== 0 || r.credit !== 0;
    return hasMovement || (includeZero && !r.hasChildren);
  });

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
