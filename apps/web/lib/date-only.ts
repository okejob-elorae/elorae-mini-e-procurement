/** Local calendar-day helpers (avoid UTC shift from toISOString().slice). */

export function formatDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Business timezone (WIB, no DST). Date-only filter strings are anchored to it explicitly
// so boundaries are correct regardless of the server process timezone (prod runs UTC; a bare
// `new Date("YYYY-MM-DDT00:00:00")` would be parsed as UTC midnight there, shifting the window
// ~7h and pulling the next WIB day's rows into the filter).
const WIB_OFFSET = "+07:00";

/** Start (00:00:00.000 WIB) of the given calendar day, as an instant. */
export function parseDateOnly(value: string): Date | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const d = new Date(`${trimmed}T00:00:00.000${WIB_OFFSET}`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Inclusive end (23:59:59.999 WIB) of the given calendar day, as an instant. */
export function parseDateOnlyEnd(value: string): Date | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const d = new Date(`${trimmed}T23:59:59.999${WIB_OFFSET}`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Inclusive end (23:59:59.999 WIB) of the current WIB calendar day.
 *
 * Report filters that omit a cutoff must land on the same instant an explicit
 * "today" selection produces via `parseDateOnlyEnd` — a bare `new Date()` is
 * wall-clock, so it would exclude rows dated later in the same WIB day.
 */
export function endOfTodayJakarta(): Date {
  return parseDateOnlyEnd(formatDateOnlyJakarta(new Date())) ?? new Date();
}

/**
 * Formats in the BROWSER's own zone on purpose — never pin it to WIB. Every caller is a client
 * component (the date pickers, the ETA hint), and a day picked in the calendar arrives as a
 * browser-local midnight: pinned to Jakarta, a user in WITA or WIT (UTC+8/+9) would see the day
 * before the one they picked. Server-rendered dates go through `formatDateOnlyJakarta` instead.
 */
export function toDisplayDate(date: Date): string {
  return formatDisplayDate(date);
}

/**
 * The ONE on-screen date format: "26 Agu 2026" (English: "26 Aug 2026").
 *
 * Pinned to WIB like every other date helper here. The screens used to mix
 * three spellings of the same day — "27 Jul 2026", "8/26/2026, 12:00:00 AM"
 * and "2026-08-19" — and a bare `toLocaleDateString()` also formats in the
 * browser's zone, so a WIB-midnight date read one day early anywhere west of
 * WIB. English falls back to en-GB so the day still leads.
 */
export function formatDisplayDate(
  value: Date | string | number | null | undefined,
  locale: string = 'id-ID',
): string {
  const date = toValidDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(displayLocale(locale), {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** `formatDisplayDate` plus the WIB time: "26 Agu 2026, 14.30". */
export function formatDisplayDateTime(
  value: Date | string | number | null | undefined,
  locale: string = 'id-ID',
): string {
  const date = toValidDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat(displayLocale(locale), {
    timeZone: 'Asia/Jakarta',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function displayLocale(locale: string): string {
  return locale.toLowerCase().startsWith('en') ? 'en-GB' : 'id-ID';
}

function toValidDate(value: Date | string | number | null | undefined): Date | undefined {
  if (value == null || value === '') return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function coerceToDate(value: Date | string | null | undefined): Date | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  return parseDateOnly(value);
}

/**
 * Calendar day of the given instant in the business timezone (WIB), as
 * `YYYY-MM-DD`. Unlike `formatDateOnly`, this is independent of the server
 * process timezone — prod runs UTC, where a WIB-midnight instant formats as
 * the previous calendar day.
 */
export function formatDateOnlyJakarta(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * `formatDateOnlyJakarta` plus the WIB time of day (`YYYY-MM-DD HH:mm`, 24h), pinned to
 * `Asia/Jakarta` for the same reason: the process timezone is UTC on prod.
 */
export function formatDateTimeJakarta(date: Date): string {
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${formatDateOnlyJakarta(date)} ${time}`;
}
