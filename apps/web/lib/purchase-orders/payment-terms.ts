import { z } from "zod";

export const PAYMENT_TERMS_DAYS_MAX = 365;

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Payment terms in days: a whole number from 0 to PAYMENT_TERMS_DAYS_MAX, or
 * null for "not set". A cleared number input arrives as "" or NaN and means
 * "not set", never 0.
 */
export const paymentTermsDaysField = z.preprocess(
  (v) => (v === "" || v === null || (typeof v === "number" && Number.isNaN(v)) ? null : v),
  z.number().int().min(0).max(PAYMENT_TERMS_DAYS_MAX).nullable()
);

export function parsePaymentTermsDays(
  value: unknown
): { ok: true; value: number | null } | { ok: false } {
  if (value === undefined) return { ok: false };
  const parsed = paymentTermsDaysField.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

/**
 * Due date = WIB calendar day of the first receipt + terms, returned as WIB
 * midnight of that date: the repo's date-only shape (`parseDateOnly`), the
 * same instant a hand-picked due date is stored as.
 */
export function computePaymentDueDate(
  firstReceiptAt: Date | null,
  termsDays: number | null
): Date | null {
  if (firstReceiptAt == null || termsDays == null) return null;
  const wib = new Date(firstReceiptAt.getTime() + WIB_OFFSET_MS);
  return new Date(
    Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate() + termsDays) - WIB_OFFSET_MS
  );
}

/** A PO created without terms in its payload inherits the supplier's. */
export function resolveCreatePaymentTerms(
  payloadTerms: number | null | undefined,
  supplierTerms: number | null
): number | null {
  return payloadTerms === undefined ? supplierTerms : payloadTerms;
}

/**
 * The hand-entered due date to write on an edit. With terms the date is derived, so nothing is
 * written here. Without terms, `null` (a cleared field) clears the column and `undefined` (a
 * payload that omits the field) leaves it alone.
 */
export function resolveManualPaymentDueDate<T>(
  effectiveTerms: number | null,
  input: T | null | undefined
): T | null | undefined {
  if (effectiveTerms != null) return undefined;
  return input;
}
