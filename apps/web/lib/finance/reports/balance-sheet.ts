import type { BalanceRow } from "./balances";
import { buildRollup, type RollupNode } from "./rollup";

export type BalanceSheet = {
  aset: RollupNode[];
  totalAset: number;
  liabilitas: RollupNode[];
  totalLiabilitas: number;
  ekuitas: RollupNode[];
  totalEkuitas: number;
  unclosedEarnings: number;
  totalLiabilitasEkuitas: number;
  isBalanced: boolean;
};

const sumRoots = (nodes: RollupNode[]): number =>
  nodes.reduce((sum, node) => sum + node.subtotal, 0);

const cents = (value: number): number => Math.round(value * 100);

/**
 * Balance sheet as of a date, cumulative since inception.
 *
 * No fiscal close exists yet, so profit-and-loss balances are never rolled
 * into an equity account. `unclosedEarnings` (Pendapatan − HPP − Beban)
 * stands in for that roll-forward; without it the two sides cannot agree for
 * any period with P&L activity. Because every journal is balanced when
 * posted, including it makes the identity hold by construction.
 */
export function buildBalanceSheet(rows: BalanceRow[]): BalanceSheet {
  const aset = buildRollup(rows, ["ASET"]);
  const liabilitas = buildRollup(rows, ["LIABILITAS"]);
  const ekuitas = buildRollup(rows, ["EKUITAS"]);

  const totalAset = sumRoots(aset);
  const totalLiabilitas = sumRoots(liabilitas);
  const totalEkuitas = sumRoots(ekuitas);

  const totalPendapatan = sumRoots(buildRollup(rows, ["PENDAPATAN"]));
  const totalHpp = sumRoots(buildRollup(rows, ["HPP"]));
  const totalBeban = sumRoots(buildRollup(rows, ["BEBAN"]));
  const unclosedEarnings = totalPendapatan - totalHpp - totalBeban;

  const totalLiabilitasEkuitas = totalLiabilitas + totalEkuitas + unclosedEarnings;

  return {
    aset,
    totalAset,
    liabilitas,
    totalLiabilitas,
    ekuitas,
    totalEkuitas,
    unclosedEarnings,
    totalLiabilitasEkuitas,
    isBalanced: cents(totalAset) === cents(totalLiabilitasEkuitas),
  };
}
