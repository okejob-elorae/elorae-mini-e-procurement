/**
 * Deliberately import-free — no `@elorae/db`, not even for the `PaymentMethod` enum type.
 * `PaymentsPageClient.tsx`, `PaymentDetailClient.tsx` and `ReceivableDetailClient.tsx` are all
 * "use client" components; one import of the barrel, even a type-only one re-exported through a
 * value module, would drag Prisma and the mariadb driver into the browser bundle. Same policy as
 * `lib/tax-invoices/status-display.ts` and `lib/field-sales/retur/variance.ts` — this module
 * declares its own union rather than importing the Prisma-backed one, and the two must be kept in
 * sync by hand.
 *
 * This replaced three identical hand-written `if` chains that fell through to `methodReturOffset`
 * for anything they did not recognise. Widening `PaymentMethod` with `PROGRAM_DEDUCTION` and
 * `ADMIN_FEE` for the store-settlement approval path therefore made every settlement deduction
 * payment render to finance as "Retur Offset" — silently, because the chains took `string`.
 * `PAYMENT_METHOD_LABEL_KEY` is an exhaustive `Record`, so the next member added to the union
 * below is a compile error here instead of a wrong label in the payments list.
 */
export type PaymentMethodValue =
  | "CASH"
  | "TRANSFER"
  | "RETUR_OFFSET"
  | "PROGRAM_DEDUCTION"
  | "ADMIN_FEE";

export const PAYMENT_METHOD_VALUES = [
  "CASH",
  "TRANSFER",
  "RETUR_OFFSET",
  "PROGRAM_DEDUCTION",
  "ADMIN_FEE",
] as const satisfies readonly PaymentMethodValue[];

export type PaymentMethodLabelKey =
  | "methodCash"
  | "methodTransfer"
  | "methodReturOffset"
  | "methodProgramDeduction"
  | "methodAdminFee"
  | "methodUnknown";

export const PAYMENT_METHOD_LABEL_KEY: Record<PaymentMethodValue, PaymentMethodLabelKey> = {
  CASH: "methodCash",
  TRANSFER: "methodTransfer",
  RETUR_OFFSET: "methodReturOffset",
  PROGRAM_DEDUCTION: "methodProgramDeduction",
  ADMIN_FEE: "methodAdminFee",
};

/**
 * Maps a raw `Payment.method` string onto its locale key. A member that reached the database
 * before it reached the union above renders as an explicit "Unknown" rather than borrowing
 * another method's label — a wrong-but-plausible label is worse than an obviously missing one on
 * a screen finance reconciles cash against. Both `payments` and `piutang` carry `methodUnknown`.
 */
export function paymentMethodLabelKey(method: string): PaymentMethodLabelKey {
  return PAYMENT_METHOD_LABEL_KEY[method as PaymentMethodValue] ?? "methodUnknown";
}
