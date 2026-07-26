export const RESYNC_STATUS = {
  PENDING: "PENDING",
  RESOLVING: "RESOLVING",
  FETCHING: "FETCHING",
  DONE: "DONE",
  NOT_FOUND: "NOT_FOUND",
  SKIPPED: "SKIPPED",
  DEAD: "DEAD",
} as const;

export type ResyncStatus = (typeof RESYNC_STATUS)[keyof typeof RESYNC_STATUS];

export const TERMINAL_RESYNC_STATUSES: ReadonlySet<ResyncStatus> = new Set([
  RESYNC_STATUS.DONE,
  RESYNC_STATUS.NOT_FOUND,
  RESYNC_STATUS.SKIPPED,
  RESYNC_STATUS.DEAD,
]);

// Non-terminal statuses a stuck row can be found in mid-flight — used by the
// poller's stuck-sweep (mirrors JubelioOutbox's PROCESSING equivalent).
export const IN_FLIGHT_RESYNC_STATUSES: ReadonlySet<ResyncStatus> = new Set([
  RESYNC_STATUS.RESOLVING,
  RESYNC_STATUS.FETCHING,
]);
