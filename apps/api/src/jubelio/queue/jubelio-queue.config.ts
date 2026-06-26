import { CronExpression } from "@nestjs/schedule";

export const JUBELIO_WEBHOOK_QUEUE = "jubelio-webhook";

function resolveWorkerConcurrency(): number {
  const raw = process.env.JUBELIO_WORKER_CONCURRENCY;
  if (!raw) return 4;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 4;
}

export const QUEUE_DEFAULTS = {
  JOB_ATTEMPTS: 5,
  BACKOFF_BASE_MS: 5_000,
  REMOVE_ON_COMPLETE_COUNT: 1_000,
  REMOVE_ON_FAIL_COUNT: 5_000,
  WORKER_CONCURRENCY: resolveWorkerConcurrency(),
} as const;

export const SWEEP = {
  STUCK_AFTER_MS: 5 * 60 * 1_000,
  BATCH: 100,
  CRON: CronExpression.EVERY_10_MINUTES,
} as const;
