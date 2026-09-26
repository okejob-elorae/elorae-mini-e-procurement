/**
 * The monthly count schedule for consignment stores.
 *
 * Deliberately import-free: the backoffice store detail view renders its status and dates, and one
 * import from `@elorae/db` would drag Prisma and the mariadb driver into the browser bundle.
 *
 * Every month boundary here is a WIB (Asia/Jakarta, UTC+7, no DST) calendar month computed with a
 * hardcoded offset, never `getMonth()`/`getDate()`: those read the host timezone, so they would be
 * right on a WIB laptop and wrong on the UTC production server (the same reasoning as `daysOverdue`
 * in `lib/finance/ar/aging.ts`).
 */
export const COUNT_DUE_DAY_SETTING_KEY = "konsi.countDueDay";
export const COUNT_LEAD_DAYS_SETTING_KEY = "konsi.countLeadDays";

/** `StoreStocktake.createdById` for a count the daily sweep opened at a store without exactly one assigned SPG. It is not a User id. */
export const KONSI_COUNT_SYSTEM_ACTOR = "system:konsi-count";

export type CountSchedule = { dueDay: number | "last"; leadDays: number };

export const DEFAULT_COUNT_SCHEDULE: CountSchedule = { dueDay: "last", leadDays: 3 };

export type CountStatus = "DONE" | "NOT_YET" | "DUE" | "OVERDUE";

export type CountWindow = { monthKey: string; monthStart: Date; monthEnd: Date; openFrom: Date; dueAt: Date };

/** `monthKey` and `dueAt` name the month the status is about, which is the previous month for a carried OVERDUE. */
export type CountStatusResult = { status: CountStatus; monthKey: string; dueAt: Date };

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

/* WIB midnight at the start of `day` (1-based; overflow rolls into the next month) of a WIB year and 0-based month, as an instant. */
function wibDayStart(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day) - WIB_OFFSET_MS);
}

function parseDueDay(raw: string | null | undefined): number | "last" {
  if (raw === null || raw === undefined || raw.trim() === "") return DEFAULT_COUNT_SCHEDULE.dueDay;
  const value = raw.trim().toLowerCase();
  if (value === "last") return "last";
  if (/^\d+$/.test(value)) {
    const day = Number.parseInt(value, 10);
    if (day >= 1 && day <= 28) return day;
  }
  console.warn(`[konsi-count-schedule] malformed ${COUNT_DUE_DAY_SETTING_KEY}="${raw}" — falling back to the default`);
  return DEFAULT_COUNT_SCHEDULE.dueDay;
}

function parseLeadDays(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw.trim() === "") return DEFAULT_COUNT_SCHEDULE.leadDays;
  const value = raw.trim();
  if (/^\d+$/.test(value)) {
    const days = Number.parseInt(value, 10);
    if (days <= 27) return days;
  }
  console.warn(`[konsi-count-schedule] malformed ${COUNT_LEAD_DAYS_SETTING_KEY}="${raw}" — falling back to the default`);
  return DEFAULT_COUNT_SCHEDULE.leadDays;
}

/**
 * Parses the two `SystemSetting` values. Each field fails OPEN to its default on anything
 * malformed, independently of the other, like `parseOverdueThresholds`: a schedule that failed
 * closed would stop every count from opening, invisibly, which is the failure this feature
 * removes. The due day is capped at 28 so that it exists in every month.
 */
export function parseCountSchedule(raw: { dueDay?: string | null; leadDays?: string | null }): CountSchedule {
  return { dueDay: parseDueDay(raw.dueDay), leadDays: parseLeadDays(raw.leadDays) };
}

/**
 * The WIB calendar month containing `now`. `dueAt` is the last instant of the due day, and
 * `openFrom` is the first instant of (due day − lead days), floored at the month start.
 * `monthEnd` is the month's last instant.
 */
export function countWindowFor(now: Date, schedule: CountSchedule): CountWindow {
  const wib = new Date(now.getTime() + WIB_OFFSET_MS);
  const year = wib.getUTCFullYear();
  const month = wib.getUTCMonth();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const dueDayNumber = schedule.dueDay === "last" ? daysInMonth : schedule.dueDay;
  const monthStart = wibDayStart(year, month, 1);
  const nextMonthStart = wibDayStart(year, month + 1, 1);
  return {
    monthKey: `${year}-${String(month + 1).padStart(2, "0")}`,
    monthStart,
    monthEnd: new Date(nextMonthStart.getTime() - 1),
    openFrom: wibDayStart(year, month, Math.max(1, dueDayNumber - schedule.leadDays)),
    dueAt: new Date(wibDayStart(year, month, dueDayNumber + 1).getTime() - 1),
  };
}

/**
 * The one rule for where a store stands on its monthly count. The store screen, the SPG home
 * and the daily sweep all go through it, so they cannot disagree.
 *
 * A month is counted when an APPROVED FULL count's `countedAt` falls inside it. `countedAt` is
 * the instant the count was opened, so a late count is credited to the month it is taken in. In
 * order:
 * - DONE when the current month is counted.
 * - OVERDUE for the current month once its due day has ended.
 * - OVERDUE for the PREVIOUS month when that month was not counted and the store already existed
 *   when that month's window opened. This carry is what makes the alert reachable at all under
 *   the last-day default: that due day ends on the month's last instant, and the next instant
 *   belongs to the next month.
 * - NOT_YET before the current window opens, DUE inside it.
 */
export function countStatusFor(input: {
  now: Date;
  schedule: CountSchedule;
  lastApprovedFullCountedAt: Date | null;
  eligibleSince: Date;
}): CountStatusResult {
  const now = input.now.getTime();
  const last = input.lastApprovedFullCountedAt?.getTime() ?? null;
  const current = countWindowFor(input.now, input.schedule);

  if (last !== null && last >= current.monthStart.getTime() && last <= current.monthEnd.getTime()) {
    return { status: "DONE", monthKey: current.monthKey, dueAt: current.dueAt };
  }
  if (now > current.dueAt.getTime()) {
    return { status: "OVERDUE", monthKey: current.monthKey, dueAt: current.dueAt };
  }

  const previous = countWindowFor(new Date(current.monthStart.getTime() - 1), input.schedule);
  const previousMissed =
    input.eligibleSince.getTime() < previous.openFrom.getTime() && (last === null || last < previous.monthStart.getTime());
  if (previousMissed) {
    return { status: "OVERDUE", monthKey: previous.monthKey, dueAt: previous.dueAt };
  }

  if (now < current.openFrom.getTime()) {
    return { status: "NOT_YET", monthKey: current.monthKey, dueAt: current.dueAt };
  }
  return { status: "DUE", monthKey: current.monthKey, dueAt: current.dueAt };
}
