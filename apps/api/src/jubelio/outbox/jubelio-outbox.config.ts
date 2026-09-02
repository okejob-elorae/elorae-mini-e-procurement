export const JUBELIO_OUTBOX_QUEUE = "jubelio-outbox";

export const OUTBOX_QUEUE_DEFAULTS = {
  JOB_ATTEMPTS: 5,
  BACKOFF_BASE_MS: 5_000,
  REMOVE_ON_COMPLETE_COUNT: 1_000,
  REMOVE_ON_FAIL_COUNT: 5_000,
  WORKER_CONCURRENCY: 1,
} as const;

export const OUTBOX_POLLER = {
  INTERVAL_MS: 5_000,
  STUCK_AFTER_MS: 5 * 60 * 1_000,
  BATCH: 100,
} as const;

/**
 * Jubelio warehouse location the WMS pick/pack/ship pushes act on. Single
 * warehouse today; widen to a per-order lookup before onboarding a second one.
 */
export const JUBELIO_WMS_LOCATION_ID = 1;
