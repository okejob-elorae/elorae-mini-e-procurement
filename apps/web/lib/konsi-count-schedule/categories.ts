/**
 * The `AdminNotification` categories the konsi count schedule and its auto-created sell-through
 * report write. Import-free, so the fan-out map, the writers and their specs share one spelling.
 * Every one of them must also be in `CATEGORY_PERMISSION` (`lib/notifications/admin-fanout.ts`),
 * or it reaches nobody.
 */
export const KONSI_COUNT_DUE = "KONSI_COUNT_DUE";
export const KONSI_COUNT_OVERDUE = "KONSI_COUNT_OVERDUE";
export const KONSI_REPORT_READY = "KONSI_REPORT_READY";
export const KONSI_REPORT_HELD = "KONSI_REPORT_HELD";
export const KONSI_REPORT_BLOCKED = "KONSI_REPORT_BLOCKED";

export const KONSI_NOTIFICATION_CATEGORIES = [
  KONSI_COUNT_DUE,
  KONSI_COUNT_OVERDUE,
  KONSI_REPORT_READY,
  KONSI_REPORT_HELD,
  KONSI_REPORT_BLOCKED,
] as const;
