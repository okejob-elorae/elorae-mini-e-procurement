export const OUTBOX_STATUS = {
  PENDING: "PENDING",
  PROCESSING: "PROCESSING",
  DONE: "DONE",
  SKIPPED: "SKIPPED",
  DEAD: "DEAD",
} as const;

export type OutboxStatus = (typeof OUTBOX_STATUS)[keyof typeof OUTBOX_STATUS];

export const TERMINAL_OUTBOX_STATUSES: ReadonlySet<OutboxStatus> = new Set([
  OUTBOX_STATUS.DONE,
  OUTBOX_STATUS.SKIPPED,
  OUTBOX_STATUS.DEAD,
]);

export const OUTBOX_SKIP_REASONS = {
  MISSING_MAPPING: "missing_mapping",
  NO_INVENTORY: "no_inventory",
  UNKNOWN_ENTITY_TYPE: "unknown_entity_type",
  ORPHAN_ITEM: "orphan_item",
  WRONG_TYPE: "wrong_type",
  DEFAULTS_MISSING: "defaults_missing",
  CATEGORY_UNMAPPED: "category_unmapped",
  CANNOT_CREATE_FROM_INGESTED: "cannot_create_from_ingested",
  JUBELIO_ALREADY_IN_STATE: "jubelio_already_in_state",
} as const;
