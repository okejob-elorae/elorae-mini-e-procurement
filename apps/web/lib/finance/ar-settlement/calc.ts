/**
 * Deliberately import-free apart from `roundCents` from `@elorae/db/pricing`. The PWA settlement
 * entry screen is a "use client" component and imports this module directly for its live
 * preview — any import here that reaches the `@elorae/db` barrel (Prisma types, a
 * `./queries`-style module, the generated schema enums) would drag Prisma and the mariadb driver
 * into the browser bundle. `@elorae/db/pricing` is a safe subpath: it is a pure helper, not the
 * barrel. Same policy as `lib/field-sales/retur/variance.ts` and
 * `lib/tax-invoices/status-display.ts` — this module declares its own deduction-type union
 * rather than importing a Prisma-backed one.
 */
import { roundCents } from "@elorae/db/pricing";

/**
 * The float-comparison slack every settlement guard uses. It is exported FROM HERE, not from
 * `approve-writer.ts` — all four consumers (`submit-writer.ts`, `approve-writer.ts`, `queries.ts`,
 * `checks.ts`) import it from this module — because they must agree on it exactly: the writer
 * refuses on a margin the approval preview has to reproduce, and two epsilons that drift apart
 * would let the screen offer an approval the writer then refuses, or the reverse.
 *
 * The way that drift actually happens is a tidy-up HERE. This file is the import-free one, so a
 * later change that moves `EPSILON` "closer to its user" or inlines `1e-6` at one call site forks
 * the number silently — nothing type-checks two constants against each other, and the symptom is a
 * screen and a writer disagreeing about a sub-cent margin on a document worth millions of rupiah.
 * `submit-writer.ts` held its own private copy at the same value until this branch; that is the
 * exact shape to keep out.
 */
export const EPSILON = 1e-6;

export type SettlementDeductionInput = {
  type: "RETUR_OFFSET" | "PROGRAM" | "ADMIN_FEE";
  amount?: number;
  percent?: number;
};

export type SettlementTotals = {
  invoiceTotal: number;
  returTotal: number;
  programTotal: number;
  adminFeeBase: number;
  adminFee: number;
  expected: number;
};

/**
 * The admin fee is charged on the NETTED base (invoice total minus retur offsets and program
 * deductions), never on the gross invoice total — the store's fee applies to what it actually
 * hands over. A missing `amount`/`percent` on any deduction is treated as `0`, never `NaN`.
 * Every returned figure is rounded with `roundCents`.
 */
export function computeSettlementTotals(
  invoiceAmounts: number[],
  deductions: SettlementDeductionInput[],
): SettlementTotals {
  const invoiceTotal = roundCents(
    invoiceAmounts.reduce((sum, amount) => sum + (amount ?? 0), 0),
  );

  const returTotal = roundCents(
    deductions
      .filter((d) => d.type === "RETUR_OFFSET")
      .reduce((sum, d) => sum + (d.amount ?? 0), 0),
  );

  const programTotal = roundCents(
    deductions
      .filter((d) => d.type === "PROGRAM")
      .reduce((sum, d) => sum + (d.amount ?? 0), 0),
  );

  const adminFeePercent = deductions
    .filter((d) => d.type === "ADMIN_FEE")
    .reduce((sum, d) => sum + (d.percent ?? 0), 0);

  const adminFeeBase = roundCents(invoiceTotal - returTotal - programTotal);
  const adminFee = roundCents(adminFeeBase * (adminFeePercent / 100));
  const expected = roundCents(adminFeeBase - adminFee);

  return {
    invoiceTotal,
    returTotal,
    programTotal,
    adminFeeBase,
    adminFee,
    expected,
  };
}

/**
 * Positive when the store hands over more than expected, negative when it hands over less.
 */
export function computeVariance(expected: number, actual: number): number {
  return roundCents(actual - expected);
}
