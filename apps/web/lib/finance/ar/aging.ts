/**
 * Aging maths for the piutang ledger.
 *
 * Deliberately import-free: a `"use client"` component imports this, and a single import from
 * `@elorae/db` would drag Prisma and the mariadb driver into the browser bundle.
 *
 * Six buckets, where the epic's text names five. It lists "current, 30d, 60d, 90d, 120d+" — for
 * "120d+" to mean anything, 91-120 has to exist as a bucket of its own.
 */
export const AGING_BUCKETS = ["CURRENT", "D1_30", "D31_60", "D61_90", "D91_120", "D120_PLUS"] as const;

export type AgingBucket = (typeof AGING_BUCKETS)[number];

export const AGING_BUCKET_LABELS: Record<AgingBucket, string> = {
  CURRENT: "Belum jatuh tempo",
  D1_30: "1-30 hari",
  D31_60: "31-60 hari",
  D61_90: "61-90 hari",
  D91_120: "91-120 hari",
  D120_PLUS: "> 120 hari",
};

const MS_PER_DAY = 86_400_000;

/** WIB (UTC+7). The business runs on Jakarta time and every date in this domain is a WIB calendar day. */
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Whole days past `dueDate`, negative when not yet due.
 *
 * Both sides are floored to a WIB calendar-day boundary, so the result depends on the calendar day
 * rather than the time of day the query happened to run — otherwise a receivable would change bucket
 * partway through its own due date.
 *
 * The `+ WIB_OFFSET_MS` shift is the whole point and must not be dropped. Flooring raw epoch
 * milliseconds floors to a UTC day, and WIB midnight is 17:00Z on the PREVIOUS day — so a due date of
 * `2026-03-01T00:00:00+07:00` (= `2026-02-28T17:00:00Z`) files under Feb 28 and every comparison comes
 * out exactly one day too high. Measured: the due date itself reported 1 day overdue, day 30 reported
 * 31 and jumped a bucket, day 120 reported 121 and jumped a bucket.
 *
 * Deriving the day from `d.getFullYear()/getMonth()/getDate()` instead is NOT a fix — those read the
 * host's local timezone, so the same code would be correct on a WIB laptop and wrong on a UTC server.
 * The offset is hardcoded because it is a property of the business, not of the machine.
 */
export function daysOverdue(dueDate: Date, asOf: Date): number {
  const dayOf = (d: Date) => Math.floor((d.getTime() + WIB_OFFSET_MS) / MS_PER_DAY);
  return dayOf(asOf) - dayOf(dueDate);
}

export function agingBucket(dueDate: Date, asOf: Date): AgingBucket {
  const days = daysOverdue(dueDate, asOf);
  if (days <= 0) return "CURRENT";
  if (days <= 30) return "D1_30";
  if (days <= 60) return "D31_60";
  if (days <= 90) return "D61_90";
  if (days <= 120) return "D91_120";
  return "D120_PLUS";
}

/** True when the row should render in the overdue colour (red) rather than the not-yet-due one (blue). */
export function isOverdue(dueDate: Date, asOf: Date): boolean {
  return daysOverdue(dueDate, asOf) > 0;
}
