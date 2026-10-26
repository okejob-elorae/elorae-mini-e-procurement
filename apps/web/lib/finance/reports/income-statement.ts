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
  isEmpty: boolean;
};

const sumRoots = (nodes: RollupNode[]): number =>
  nodes.reduce((sum, node) => sum + node.subtotal, 0);

/**
 * Drops accounts that carry no movement and have no surviving descendant, so a
 * parent that only groups visible children stays. Applied AFTER the rollup:
 * subtotals and section totals were already computed from the full tree, so
 * hiding a zero row can never move a total.
 */
function pruneZero(nodes: RollupNode[]): RollupNode[] {
  return nodes.flatMap((node) => {
    const children = pruneZero(node.children);
    const hasMovement = node.debit !== 0 || node.credit !== 0 || node.subtotal !== 0;
    return hasMovement || children.length > 0 ? [{ ...node, children }] : [];
  });
}

/**
 * Section membership is decided by `AccountType`, never by account code —
 * codes are user-editable in the CoA, types are not. Totals come from root
 * subtotals so a parent's children are counted exactly once.
 */
export function buildIncomeStatement(
  rows: BalanceRow[],
  opts?: { includeZero?: boolean },
): IncomeStatement {
  const includeZero = opts?.includeZero ?? false;
  const fullPendapatan = buildRollup(rows, ["PENDAPATAN"]);
  const fullHpp = buildRollup(rows, ["HPP"]);
  const fullBeban = buildRollup(rows, ["BEBAN"]);

  const totalPendapatan = sumRoots(fullPendapatan);
  const totalHpp = sumRoots(fullHpp);
  const totalBeban = sumRoots(fullBeban);
  const labaKotor = totalPendapatan - totalHpp;

  const pendapatan = includeZero ? fullPendapatan : pruneZero(fullPendapatan);
  const hpp = includeZero ? fullHpp : pruneZero(fullHpp);
  const beban = includeZero ? fullBeban : pruneZero(fullBeban);

  return {
    pendapatan,
    totalPendapatan,
    hpp,
    totalHpp,
    labaKotor,
    beban,
    totalBeban,
    labaBersih: labaKotor - totalBeban,
    isEmpty: pendapatan.length === 0 && hpp.length === 0 && beban.length === 0,
  };
}
