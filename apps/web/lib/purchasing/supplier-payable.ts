export type ApLine = { debit: number; credit: number };

const toCents = (value: number): number => Math.round(value * 100);

/**
 * Outstanding payable a purchase order's receipts actually booked to the GL.
 *
 * Netting is purely directional — credit minus debit, whatever document a line
 * came from — because a GRN journal credits the payables account and its
 * reversal debits the same account back. The line's source type is therefore
 * not an input: it never changes a line's sign, so it is deliberately not part
 * of `ApLine`. A negative result means reversals exceeded receipts, and the
 * caller treats that as nothing to pay rather than posting a backwards journal.
 */
export function bookedPayable(lines: ApLine[]): number {
  return lines.reduce((cents, l) => cents + toCents(l.credit) - toCents(l.debit), 0) / 100;
}
