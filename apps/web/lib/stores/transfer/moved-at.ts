/**
 * The moment a store-to-store transfer's goods physically moved, entered as a WIB date and time.
 * This file imports nothing, because the create form imports it for its own validation — keep
 * `@elorae/db` out of it.
 */

const DATE_TIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/* WIB to the minute, 00-23 hours, independent of the process timezone — prod runs UTC. */
const WIB_MINUTE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jakarta",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/* An instant as a `datetime-local` value in WIB (`YYYY-MM-DDTHH:mm`). */
export function formatMovedAtInput(date: Date): string {
  const parts = WIB_MINUTE.formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

/* A `datetime-local` value read as WIB, or null for anything else. */
export function parseMovedAtInput(value: unknown): Date | null {
  if (typeof value !== "string" || !DATE_TIME_LOCAL.test(value)) return null;
  const parsed = new Date(`${value}:00.000+07:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  /* The round-trip refuses what the parser rolls over: `2026-02-30T10:00` lands on 2 March, `24:00` on the next day. */
  return formatMovedAtInput(parsed) === value ? parsed : null;
}

/* True when the move is later than `now`. */
export function isMovedAtInFuture(movedAt: Date, now: Date): boolean {
  return movedAt.getTime() > now.getTime();
}
