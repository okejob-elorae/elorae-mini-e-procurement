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

export function toDisplayDate(date: Date): string {
  return date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function coerceToDate(value: Date | string | null | undefined): Date | undefined {
  if (value == null) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  return parseDateOnly(value);
}
