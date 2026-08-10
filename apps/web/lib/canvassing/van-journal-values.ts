export type CostLine = { qty: number; unitCost: number };
export type VarianceLine = { countedQty: number; varianceQty: number; unitCost: number };

const toCents = (value: number): number => Math.round(value * 100);

/**
 * Total cost value of a set of van document lines, exact to the cent.
 */
export function lineCostTotal(lines: CostLine[]): number {
  return lines.reduce((cents, l) => cents + toCents(l.qty * l.unitCost), 0) / 100;
}

/**
 * Reconcile value split: what physically came back to main stock versus what is
 * missing. A negative variance means more was counted than expected, and stays
 * negative so the caller can decide how to post it.
 */
export function reconcileSplit(lines: VarianceLine[]): { returned: number; variance: number } {
  let returnedCents = 0;
  let varianceCents = 0;
  for (const l of lines) {
    returnedCents += toCents(l.countedQty * l.unitCost);
    varianceCents += toCents(l.varianceQty * l.unitCost);
  }
  return { returned: returnedCents / 100, variance: varianceCents / 100 };
}
