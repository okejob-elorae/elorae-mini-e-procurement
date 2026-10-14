/**
 * The instant before which no sales return is ever announced in the bell. Written once, by the
 * first sweep run, so returns that existed when the feature went live are never pinged.
 * Import-free on purpose.
 */
export const BELL_FLOOR_SETTING_KEY = "salesReturns.bellFloor";

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

/* Strict: anything but a UTC ISO timestamp is null, so a hand-edited value can never shift the floor silently. */
export function parseBellFloor(raw: string | null | undefined): Date | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!ISO_UTC.test(trimmed)) return null;
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  /* A well-shaped but impossible instant (31 February, hour 24) rolls over in `Date`; refuse it instead. */
  if (date.toISOString().slice(0, 19) !== trimmed.slice(0, 19)) return null;
  return date;
}
