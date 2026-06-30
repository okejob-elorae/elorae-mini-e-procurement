import type { DateRange } from "react-day-picker";

export function toTimeInputValue(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function applyTimeToDate(date: Date, timeHHmm: string): Date {
  const [hours, minutes] = timeHHmm.split(":").map((part) => Number(part));
  const next = new Date(date);
  next.setHours(Number.isFinite(hours) ? hours : 0, Number.isFinite(minutes) ? minutes : 0, 0, 0);
  return next;
}

export function startOfLocalDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

export function rangeHasExplicitTime(range: DateRange | undefined): boolean {
  if (!range?.from && !range?.to) return false;
  const dates = [range.from, range.to].filter((d): d is Date => d != null);
  return dates.some(
    (d) => d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0 || d.getMilliseconds() !== 0
  );
}

export function buildAppliedRange(
  range: DateRange | undefined,
  includeTime: boolean,
  startTime: string,
  endTime: string
): DateRange | undefined {
  if (!range?.from || !range?.to) return undefined;

  if (!includeTime) {
    return {
      from: startOfLocalDay(range.from),
      to: startOfLocalDay(range.to),
    };
  }

  return {
    from: applyTimeToDate(range.from, startTime),
    to: applyTimeToDate(range.to, endTime),
  };
}

export function formatTimeDisplay(date: Date): string {
  return date.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
