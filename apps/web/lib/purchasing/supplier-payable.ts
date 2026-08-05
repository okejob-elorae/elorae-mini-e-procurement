export type ApLine = { sourceType: string; debit: number; credit: number };

const toCents = (value: number): number => Math.round(value * 100);

/**
 * Outstanding payable a purchase order's receipts actually booked to the GL.
 * GRN journals credit the payables account; reversals debit it back. A negative
 * result means reversals exceeded receipts — the caller treats that as nothing
 * to pay rather than posting a backwards journal.
 */
export function bookedPayable(lines: ApLine[]): number {
  return lines.reduce((cents, l) => cents + toCents(l.credit) - toCents(l.debit), 0) / 100;
}
