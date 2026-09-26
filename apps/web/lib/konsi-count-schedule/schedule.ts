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

/**
 * `monthKey` and `dueAt` always name the month the status is about: the target month for DUE and
 * OVERDUE (the previous month while its slot is still running), the current month for DONE, and
 * the next window to open for NOT_YET.
 */
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
 * The count moment of an approved count: `countFinishedAt ?? approvedAt`, the same moment the
 * stocktake and sell-through writers read. Never `countedAt`, which is the instant the count was
 * opened and which a caller supplies.
 */
export function countMomentOf(count: { countFinishedAt: Date | null; approvedAt: Date | null }): Date | null {
  return count.countFinishedAt ?? count.approvedAt;
}

/* `2026-09` as a month name in `locale`, e.g. "September 2026". UTC on both sides, so the host timezone cannot shift it into a neighbouring month. */
export function formatCountMonth(monthKey: string, locale: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

/* A due instant as its WIB calendar day in `locale`, e.g. "30 September 2026". */
export function formatCountDueDate(dueAt: Date, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(dueAt);
}

/**
 * The one rule for where a store stands on its monthly count. The store screen, the SPG home
 * and the daily sweep all go through it, so they cannot disagree.
 *
 * Each month owns a SLOT that runs from its window's `openFrom` to the next month's `openFrom`.
 * The TARGET month is the one whose slot contains `now`: the current month once its window has
 * opened, the previous month before that. A month is counted when the last approved FULL count's
 * count moment (`countMomentOf`) falls at or after its `openFrom`, so a late count taken on 2
 * October for a missed September credits September, and October's window still opens on time.
 * A count finished BEFORE the target's window opened credits the previous slot instead. That is
 * intended: an early count sits inside the previous month's slot, and it is that month it closes.
 * It is also why the daily sweep never announces an open count already finished before the
 * target's `openFrom` as the target's count.
 *
 * A store owes the target month only if it already existed when that month's window opened
 * (`eligibleSince < openFrom`). In order:
 * - NOT_YET, naming the next window to open, when the store does not owe the target month.
 * - DONE when the target is the current month and it is counted.
 * - NOT_YET for the current month when the target is the previous month and it is counted.
 * - DUE for the target month while its due day has not ended, OVERDUE once it has.
 *
 * The carry is single-hop by construction: a missed month is dropped the instant the next
 * month's window opens, and from then on the current month is the one owed.
 */
export function countStatusFor(input: {
  now: Date;
  schedule: CountSchedule;
  lastFullCountMoment: Date | null;
  eligibleSince: Date;
}): CountStatusResult {
  const now = input.now.getTime();
  const last = input.lastFullCountMoment?.getTime() ?? null;
  const current = countWindowFor(input.now, input.schedule);
  const previous = countWindowFor(new Date(current.monthStart.getTime() - 1), input.schedule);
  const currentOpen = now >= current.openFrom.getTime();
  const target = currentOpen ? current : previous;

  if (input.eligibleSince.getTime() >= target.openFrom.getTime()) {
    const upcoming = currentOpen ? countWindowFor(new Date(current.monthEnd.getTime() + 1), input.schedule) : current;
    return { status: "NOT_YET", monthKey: upcoming.monthKey, dueAt: upcoming.dueAt };
  }

  if (last !== null && last >= target.openFrom.getTime()) {
    return { status: currentOpen ? "DONE" : "NOT_YET", monthKey: current.monthKey, dueAt: current.dueAt };
  }
  if (now <= target.dueAt.getTime()) {
    return { status: "DUE", monthKey: target.monthKey, dueAt: target.dueAt };
  }
  return { status: "OVERDUE", monthKey: target.monthKey, dueAt: target.dueAt };
}
