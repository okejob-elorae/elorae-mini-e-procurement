import type { BalanceRow } from "./balances";
import { buildRollup, type RollupNode } from "./rollup";

export type IncomeStatement = {
  pendapatan: RollupNode[];
  totalPendapatan: number;
  hpp: RollupNode[];
  totalHpp: number;
  labaKotor: number;
  beban: RollupNode[];
  totalBeban: number;
  labaBersih: number;
};

const sumRoots = (nodes: RollupNode[]): number =>
  nodes.reduce((sum, node) => sum + node.subtotal, 0);

/**
 * Section membership is decided by `AccountType`, never by account code —
 * codes are user-editable in the CoA, types are not. Totals come from root
 * subtotals so a parent's children are counted exactly once.
 */
export function buildIncomeStatement(rows: BalanceRow[]): IncomeStatement {
  const pendapatan = buildRollup(rows, ["PENDAPATAN"]);
  const hpp = buildRollup(rows, ["HPP"]);
  const beban = buildRollup(rows, ["BEBAN"]);

  const totalPendapatan = sumRoots(pendapatan);
  const totalHpp = sumRoots(hpp);
  const totalBeban = sumRoots(beban);
  const labaKotor = totalPendapatan - totalHpp;

  return {
    pendapatan,
    totalPendapatan,
    hpp,
    totalHpp,
    labaKotor,
    beban,
    totalBeban,
    labaBersih: labaKotor - totalBeban,
  };
}
