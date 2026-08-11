import type { CashFlowLine, CashFlowStatement } from "./cash-flow";

export type CashFlowComparisonLine = {
  accountId: string;
  code: string;
  name: string;
  current: number;
  previous: number;
  delta: number;
};

export type CashFlowTotalTriple = {
  current: number;
  previous: number;
  delta: number;
};

export type CashFlowComparison = {
  labaBersih: CashFlowTotalTriple;
  operasional: CashFlowComparisonLine[];
  totalOperasional: CashFlowTotalTriple;
  investasi: CashFlowComparisonLine[];
  totalInvestasi: CashFlowTotalTriple;
  pendanaan: CashFlowComparisonLine[];
  totalPendanaan: CashFlowTotalTriple;
  unclassified: CashFlowComparisonLine[];
  totalUnclassified: CashFlowTotalTriple;
  netChange: CashFlowTotalTriple;
  kasAwal: CashFlowTotalTriple;
  kasAkhir: CashFlowTotalTriple;
};

/**
 * The window of equal length immediately preceding `[from, to]`, adjacent with
 * neither gap nor overlap. WIB has no daylight saving, so plain instant
 * arithmetic is safe here.
 */
export function previousPeriod(from: Date, to: Date): { from: Date; to: Date } {
  const duration = to.getTime() - from.getTime();
  const prevTo = new Date(from.getTime() - 1);
  return { from: new Date(prevTo.getTime() - duration), to: prevTo };
}

const cents = (value: number): number => Math.round(value * 100);

function triple(current: number, previous: number): CashFlowTotalTriple {
  return { current, previous, delta: (cents(current) - cents(previous)) / 100 };
}

/**
 * Pairs the two periods' lines by account. The row set is the UNION of both
 * sides — an account that moved only in the previous period would otherwise
 * disappear from a comparison whose whole purpose is to show that it changed.
 */
function pair(
  current: CashFlowLine[],
  previous: CashFlowLine[],
): CashFlowComparisonLine[] {
  const currentById = new Map(current.map((line) => [line.accountId, line]));
  const previousById = new Map(previous.map((line) => [line.accountId, line]));

  const merged = new Map<string, CashFlowLine>();
  for (const line of [...previous, ...current]) merged.set(line.accountId, line);

  return [...merged.values()]
    .map((line) => {
      const currentAmount = currentById.get(line.accountId)?.amount ?? 0;
      const previousAmount = previousById.get(line.accountId)?.amount ?? 0;
      return {
        accountId: line.accountId,
        code: line.code,
        name: line.name,
        current: currentAmount,
        previous: previousAmount,
        delta: (cents(currentAmount) - cents(previousAmount)) / 100,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
}

export function compareCashFlow(
  current: CashFlowStatement,
  previous: CashFlowStatement,
): CashFlowComparison {
  return {
    labaBersih: triple(current.labaBersih, previous.labaBersih),
    operasional: pair(current.operasional, previous.operasional),
    totalOperasional: triple(current.totalOperasional, previous.totalOperasional),
    investasi: pair(current.investasi, previous.investasi),
    totalInvestasi: triple(current.totalInvestasi, previous.totalInvestasi),
    pendanaan: pair(current.pendanaan, previous.pendanaan),
    totalPendanaan: triple(current.totalPendanaan, previous.totalPendanaan),
    unclassified: pair(current.unclassified, previous.unclassified),
    totalUnclassified: triple(current.totalUnclassified, previous.totalUnclassified),
    netChange: triple(current.netChange, previous.netChange),
    kasAwal: triple(current.kasAwal, previous.kasAwal),
    kasAkhir: triple(current.kasAkhir, previous.kasAkhir),
  };
}
