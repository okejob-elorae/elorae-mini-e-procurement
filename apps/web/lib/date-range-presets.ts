import {
  endOfMonth,
  endOfWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";

export const DATE_RANGE_PRESET_IDS = [
  "today",
  "yesterday",
  "last24Hours",
  "thisWeek",
  "lastWeek",
  "last7Days",
  "thisMonth",
  "lastMonth",
  "last28Days",
  "last30Days",
  "last60Days",
  "last90Days",
  "last180Days",
  "ytd",
] as const;

export type DateRangePresetId = (typeof DATE_RANGE_PRESET_IDS)[number];

export type DateRangePreset = {
  id: DateRangePresetId;
  label: string;
};

export const DATE_RANGE_PRESETS: DateRangePreset[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "last24Hours", label: "Last 24 hours" },
  { id: "thisWeek", label: "This week" },
  { id: "lastWeek", label: "Last week" },
  { id: "last7Days", label: "Last 7 days" },
  { id: "thisMonth", label: "This month" },
  { id: "lastMonth", label: "Last month" },
  { id: "last28Days", label: "Last 28 days" },
  { id: "last30Days", label: "Last 30 days" },
  { id: "last60Days", label: "Last 60 days" },
  { id: "last90Days", label: "Last 90 days" },
  { id: "last180Days", label: "Last 180 days" },
  { id: "ytd", label: "Year to date" },
];

export type ResolveDateRangePresetOpts = {
  now?: Date;
  weekStartsOn?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
};

export function resolveDateRangePreset(
  id: DateRangePresetId,
  opts: ResolveDateRangePresetOpts = {}
): { from: Date; to: Date } {
  const now = opts.now ?? new Date();
  const weekStartsOn = opts.weekStartsOn ?? 1;
  const today = startOfDay(now);

  const asDayRange = (from: Date, to: Date) => ({
    from: startOfDay(from),
    to: startOfDay(to),
  });

  switch (id) {
    case "today":
      return asDayRange(today, today);
    case "yesterday": {
      const day = subDays(today, 1);
      return asDayRange(day, day);
    }
    case "last24Hours":
      return asDayRange(subDays(today, 1), today);
    case "thisWeek":
      return asDayRange(startOfWeek(today, { weekStartsOn }), today);
    case "lastWeek": {
      const lastWeekAnchor = subWeeks(today, 1);
      return asDayRange(
        startOfWeek(lastWeekAnchor, { weekStartsOn }),
        endOfWeek(lastWeekAnchor, { weekStartsOn })
      );
    }
    case "last7Days":
      return asDayRange(subDays(today, 6), today);
    case "thisMonth":
      return asDayRange(startOfMonth(today), today);
    case "lastMonth": {
      const lastMonthAnchor = subMonths(today, 1);
      return asDayRange(startOfMonth(lastMonthAnchor), endOfMonth(lastMonthAnchor));
    }
    case "last28Days":
      return asDayRange(subDays(today, 27), today);
    case "last30Days":
      return asDayRange(subDays(today, 29), today);
    case "last60Days":
      return asDayRange(subDays(today, 59), today);
    case "last90Days":
      return asDayRange(subDays(today, 89), today);
    case "last180Days":
      return asDayRange(subDays(today, 179), today);
    case "ytd":
      return asDayRange(startOfYear(today), today);
    default: {
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}
