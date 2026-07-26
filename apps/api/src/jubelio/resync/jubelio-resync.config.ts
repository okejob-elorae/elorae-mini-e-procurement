export const JUBELIO_RESYNC_QUEUE = "jubelio-so-resync";

export const RESYNC_QUEUE_DEFAULTS = {
  JOB_ATTEMPTS: 5,
  BACKOFF_BASE_MS: 5_000,
  REMOVE_ON_COMPLETE_COUNT: 1_000,
  REMOVE_ON_FAIL_COUNT: 5_000,
  // Concurrency 1 by design (spec decision) — do NOT raise. Pacing protects
  // the Jubelio rate limit across a bulk (thousands-of-rows) resync run;
  // the inbound webhook worker's concurrency 4 is not appropriate here.
  WORKER_CONCURRENCY: 1,
  // Small inter-job delay on top of concurrency 1 + the existing 429 backoff
  // in JubelioHttpService, so a bulk run doesn't hammer the API back-to-back.
  INTER_JOB_DELAY_MS: 300,
} as const;

export const RESYNC_POLLER = {
  INTERVAL_MS: 5_000,
  STUCK_AFTER_MS: 5 * 60 * 1_000,
  BATCH: 100,
} as const;
