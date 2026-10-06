/**
 * The SPG count sheet submits once, at the end, so the server never sees the moment a shelf was
 * actually counted — only the device's own record of when each row's figure was last edited. That
 * device clock may be wrong, but it is wrong by a constant over one session, so the gap between the
 * device's send time and the server's receive time cancels it. Import-free: the writer runs it,
 * and nothing about it needs the database.
 */

/* The oldest a corrected count moment may be, measured back from the server's receive instant. */
export const MAX_COUNT_SESSION_MS = 24 * 60 * 60 * 1000;

/**
 * Resolves one line's count moment from device times, or `null` when either device time is not a
 * finite number — the caller then uses the server instant, which is what every line got before
 * device times were sent at all.
 *
 * The device time is moved onto the server clock as `countedAtMs + (receivedAtMs − clientSentAtMs)`
 * and then clamped: never after `receivedAtMs` (a count cannot postdate its own submission), never
 * before `lowerBound`, and never more than `MAX_COUNT_SESSION_MS` before `receivedAtMs`. The
 * clamps bound what a device clock that JUMPS mid-session (a manual change, an NTP step) can do,
 * since the skew correction assumes a constant offset.
 */
export function resolveLineCountMoment(input: {
  countedAtMs: unknown;
  clientSentAtMs: unknown;
  receivedAtMs: number;
  lowerBound: Date | null;
}): Date | null {
  const { countedAtMs, clientSentAtMs, receivedAtMs, lowerBound } = input;
  if (typeof countedAtMs !== "number" || !Number.isFinite(countedAtMs)) return null;
  if (typeof clientSentAtMs !== "number" || !Number.isFinite(clientSentAtMs)) return null;
  if (!Number.isFinite(receivedAtMs)) return null;

  const corrected = countedAtMs + (receivedAtMs - clientSentAtMs);
  const lowerBoundMs = lowerBound ? lowerBound.getTime() : Number.NaN;
  const floor = Math.max(Number.isFinite(lowerBoundMs) ? lowerBoundMs : -Infinity, receivedAtMs - MAX_COUNT_SESSION_MS);
  return new Date(Math.min(Math.max(corrected, floor), receivedAtMs));
}
