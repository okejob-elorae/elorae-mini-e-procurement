import { formatDateOnlyJakarta } from "@/lib/date-only";

const DAY_MS = 86_400_000;

/**
 * The invoice date must fall on or after the report's period-end day and on or before today, both
 * as WIB calendar days — an instant comparison would refuse the period-end day itself whenever the
 * closing count finished later that day than the midnight the picker sends.
 */
export function isInvoiceDateAllowed(invoiceDate: Date, periodEnd: Date, now: Date): boolean {
  const day = formatDateOnlyJakarta(invoiceDate);
  return day >= formatDateOnlyJakarta(periodEnd) && day <= formatDateOnlyJakarta(now);
}

/* WIB has no daylight saving, so whole days of milliseconds land on the same wall-clock time. */
export function dueDateFor(invoiceDate: Date, paymentTempoDays: number): Date {
  return new Date(invoiceDate.getTime() + paymentTempoDays * DAY_MS);
}
