/**
 * The calendar year and month a document number is issued in, on the WIB calendar.
 *
 * Deliberately import-free. The offset is hardcoded because it is a property of the business, not
 * of the machine: never derive this from `getFullYear()`/`getMonth()`, which read the host zone
 * (prod runs UTC), so a document issued after 17:00 UTC on the last day of a month would be
 * numbered into the old month.
 */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

export function docNumberPeriod(now: Date): { year: number; month: number } {
  const wib = new Date(now.getTime() + WIB_OFFSET_MS);
  return { year: wib.getUTCFullYear(), month: wib.getUTCMonth() + 1 };
}
