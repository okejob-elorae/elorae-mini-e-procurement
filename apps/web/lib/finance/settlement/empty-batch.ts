/* How long a stamped batch may stay empty before the sweep and the detail page stop waiting for rows to appear. */
export const EMPTY_BATCH_CUTOFF_MS = 10 * 60 * 1000;

/* A batch with no seed time is never stale. */
export function isEmptyBatchStale(total: number, seededAtMs: number | null, nowMs: number): boolean {
  return total === 0 && seededAtMs !== null && nowMs - seededAtMs >= EMPTY_BATCH_CUTOFF_MS;
}
