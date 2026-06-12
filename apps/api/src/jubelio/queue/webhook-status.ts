export const WEBHOOK_STATUS = {
  RECEIVED: "RECEIVED",
  PROCESSING: "PROCESSING",
  PROCESSED: "PROCESSED",
  SKIPPED: "SKIPPED",
  DEAD: "DEAD",
} as const;

export type WebhookStatus = (typeof WEBHOOK_STATUS)[keyof typeof WEBHOOK_STATUS];

export const TERMINAL_STATUSES: ReadonlySet<WebhookStatus> = new Set([
  WEBHOOK_STATUS.PROCESSED,
  WEBHOOK_STATUS.SKIPPED,
  WEBHOOK_STATUS.DEAD,
]);

export const SKIP_REASONS = {
  UNHANDLED_EVENT_TYPE: "unhandled_event_type",
  UNKNOWN_EVENT: "unknown_event",
  ORPHAN_SKU: "orphan_sku",
  AWAITING_SAMPLES: "awaiting_samples",
  MISSING_ITEM_GROUP_ID: "missing_item_group_id",
  MISSING_SALESORDER_ID: "missing_salesorder_id",
} as const;
