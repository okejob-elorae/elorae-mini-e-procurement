import { wibYearMonth as wibYearMonthParts } from "@/lib/forecast/marketplace-demand";

/**
 * WIB calendar months as `"YYYY-MM"` keys, the unit SPG commission rates and recaps are dated by.
 *
 * Client-safe: the one import is the forecast module's WIB month split, a pure function in a file
 * whose own imports are type-only, so nothing here reaches `@elorae/db`. Reusing it keeps a single
 * implementation of the +7h shift; never derive a month from `getMonth()`, which reads the host
 * timezone and is wrong on the UTC production server.
 */

const YEAR_MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isYearMonth(value: unknown): value is string {
  return typeof value === "string" && YEAR_MONTH_PATTERN.test(value);
}

export function wibYearMonth(date: Date): string {
  const { year, month } = wibYearMonthParts(date);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** Chronological order of two `isYearMonth` keys; the fixed-width format makes it a string compare. */
export function compareYearMonth(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
