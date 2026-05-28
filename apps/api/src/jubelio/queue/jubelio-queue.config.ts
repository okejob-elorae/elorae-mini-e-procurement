import { CronExpression } from "@nestjs/schedule";

export const JUBELIO_WEBHOOK_QUEUE = "jubelio-webhook";

export const QUEUE_DEFAULTS = {
  JOB_ATTEMPTS: 5,
  BACKOFF_BASE_MS: 5_000,
  REMOVE_ON_COMPLETE_COUNT: 1_000,
  REMOVE_ON_FAIL_COUNT: 5_000,
  WORKER_CONCURRENCY: 1,
} as const;

export const SWEEP = {
  STUCK_AFTER_MS: 5 * 60 * 1_000,
  BATCH: 100,
  CRON: CronExpression.EVERY_10_MINUTES,
} as const;
