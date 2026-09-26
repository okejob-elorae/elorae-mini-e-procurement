import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  countMomentOf,
  countStatusFor,
  countWindowFor,
  formatCountDueDate,
  formatCountMonth,
  parseCountSchedule,
  DEFAULT_COUNT_SCHEDULE,
  type CountSchedule,
} from "./schedule";

const DUE_15: CountSchedule = { dueDay: 15, leadDays: 3 };
const ELIGIBLE = new Date("2026-01-01T00:00:00.000+07:00");
const at = (iso: string) => new Date(iso);

describe("parseCountSchedule", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("returns the defaults when nothing is configured, without warning", () => {
    expect(parseCountSchedule({})).toEqual(DEFAULT_COUNT_SCHEDULE);
    expect(parseCountSchedule({ dueDay: null, leadDays: null })).toEqual({ dueDay: "last", leadDays: 3 });
    expect(parseCountSchedule({ dueDay: " ", leadDays: "" })).toEqual({ dueDay: "last", leadDays: 3 });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("parses a numeric due day and lead days", () => {
    expect(parseCountSchedule({ dueDay: "15", leadDays: "5" })).toEqual({ dueDay: 15, leadDays: 5 });
    expect(parseCountSchedule({ dueDay: "1", leadDays: "0" })).toEqual({ dueDay: 1, leadDays: 0 });
    expect(parseCountSchedule({ dueDay: "28", leadDays: "27" })).toEqual({ dueDay: 28, leadDays: 27 });
  });

  it("accepts \"last\" in any case and with surrounding spaces", () => {
    expect(parseCountSchedule({ dueDay: " LAST " }).dueDay).toBe("last");
  });

  it("fails open to \"last\" for a malformed due day, and warns", () => {
    for (const bad of ["0", "29", "31", "-1", "abc", "15.5", "9".repeat(400)]) {
      expect(parseCountSchedule({ dueDay: bad }).dueDay).toBe("last");
    }
    expect(warnSpy).toHaveBeenCalled();
  });

  it("fails open to 3 lead days for a malformed value, and warns", () => {
    for (const bad of ["28", "-1", "x", "2.5"]) {
      expect(parseCountSchedule({ leadDays: bad }).leadDays).toBe(3);
    }
    expect(warnSpy).toHaveBeenCalled();
  });

  it("fails open per field, keeping the other field's valid value", () => {
    expect(parseCountSchedule({ dueDay: "abc", leadDays: "5" })).toEqual({ dueDay: "last", leadDays: 5 });
    expect(parseCountSchedule({ dueDay: "10", leadDays: "x" })).toEqual({ dueDay: 10, leadDays: 3 });
  });
});

describe("countWindowFor", () => {
  it("frames September 2026 in WIB with the last-day default", () => {
    const w = countWindowFor(at("2026-09-28T03:00:00.000Z"), DEFAULT_COUNT_SCHEDULE);
    expect(w.monthKey).toBe("2026-09");
    expect(w.monthStart.toISOString()).toBe("2026-08-31T17:00:00.000Z");
    expect(w.monthEnd.toISOString()).toBe("2026-09-30T16:59:59.999Z");
    expect(w.dueAt.toISOString()).toBe("2026-09-30T16:59:59.999Z");
    expect(w.openFrom.toISOString()).toBe("2026-09-26T17:00:00.000Z");
  });

  it("puts the last day of a 31-day month on the 31st", () => {
    const w = countWindowFor(at("2026-10-10T03:00:00.000Z"), DEFAULT_COUNT_SCHEDULE);
    expect(w.dueAt.toISOString()).toBe("2026-10-31T16:59:59.999Z");
    expect(w.openFrom.toISOString()).toBe("2026-10-27T17:00:00.000Z");
  });

  it("puts the last day of a 28-day and a 29-day February on the 28th and the 29th", () => {
    const feb2026 = countWindowFor(at("2026-02-10T03:00:00.000Z"), DEFAULT_COUNT_SCHEDULE);
    expect(feb2026.dueAt.toISOString()).toBe("2026-02-28T16:59:59.999Z");
    expect(feb2026.openFrom.toISOString()).toBe("2026-02-24T17:00:00.000Z");
    const feb2028 = countWindowFor(at("2028-02-10T03:00:00.000Z"), DEFAULT_COUNT_SCHEDULE);
    expect(feb2028.dueAt.toISOString()).toBe("2028-02-29T16:59:59.999Z");
    expect(feb2028.openFrom.toISOString()).toBe("2028-02-25T17:00:00.000Z");
  });

  it("puts a numeric due day on that day whatever the month length", () => {
    const sep = countWindowFor(at("2026-09-02T03:00:00.000Z"), DUE_15);
    expect(sep.dueAt.toISOString()).toBe("2026-09-15T16:59:59.999Z");
    expect(sep.openFrom.toISOString()).toBe("2026-09-11T17:00:00.000Z");
    const feb = countWindowFor(at("2026-02-02T03:00:00.000Z"), DUE_15);
    expect(feb.dueAt.toISOString()).toBe("2026-02-15T16:59:59.999Z");
  });

  it("floors the open day at the month start when the lead days reach past it", () => {
    const w = countWindowFor(at("2026-09-01T03:00:00.000Z"), { dueDay: 2, leadDays: 5 });
    expect(w.openFrom.toISOString()).toBe(w.monthStart.toISOString());
    expect(w.openFrom.toISOString()).toBe("2026-08-31T17:00:00.000Z");
  });

  it("opens on the due day itself with zero lead days", () => {
    const w = countWindowFor(at("2026-09-02T03:00:00.000Z"), { dueDay: 15, leadDays: 0 });
    expect(w.openFrom.toISOString()).toBe("2026-09-14T17:00:00.000Z");
  });

  it("files 00:30 WIB on 1 October under October, and 23:59:59.999 WIB on 30 September under September", () => {
    expect(countWindowFor(at("2026-09-30T17:30:00.000Z"), DEFAULT_COUNT_SCHEDULE).monthKey).toBe("2026-10");
    expect(countWindowFor(at("2026-09-30T16:59:59.999Z"), DEFAULT_COUNT_SCHEDULE).monthKey).toBe("2026-09");
  });

  it("closes December on 31 December WIB", () => {
    const w = countWindowFor(at("2026-12-15T03:00:00.000Z"), DEFAULT_COUNT_SCHEDULE);
    expect(w.monthKey).toBe("2026-12");
    expect(w.monthEnd.toISOString()).toBe("2026-12-31T16:59:59.999Z");
  });
});

describe("countMomentOf", () => {
  it("is countFinishedAt when the count was finished", () => {
    expect(countMomentOf({ countFinishedAt: at("2026-09-20T03:00:00.000Z"), approvedAt: at("2026-09-22T03:00:00.000Z") })).toEqual(
      at("2026-09-20T03:00:00.000Z"),
    );
  });

  it("falls back to approvedAt when countFinishedAt is null", () => {
    expect(countMomentOf({ countFinishedAt: null, approvedAt: at("2026-09-22T03:00:00.000Z") })).toEqual(at("2026-09-22T03:00:00.000Z"));
  });
});

describe("formatCountMonth", () => {
  it("names the month in the given locale", () => {
    expect(formatCountMonth("2026-09", "en")).toBe("September 2026");
    expect(formatCountMonth("2026-10", "id")).toBe("Oktober 2026");
  });

  it("keeps January and December in their own year", () => {
    expect(formatCountMonth("2027-01", "en")).toBe("January 2027");
    expect(formatCountMonth("2026-12", "en")).toBe("December 2026");
  });
});

describe("formatCountDueDate", () => {
  it("names the WIB calendar day of the due instant, not its UTC day", () => {
    expect(formatCountDueDate(at("2026-09-30T16:59:59.999Z"), "id")).toBe("30 September 2026");
    expect(formatCountDueDate(at("2026-10-31T16:59:59.999Z"), "id")).toBe("31 Oktober 2026");
    expect(formatCountDueDate(at("2026-09-30T17:30:00.000Z"), "id")).toBe("1 Oktober 2026");
  });
});

describe("countStatusFor", () => {
  const status = (now: string, last: string | null, schedule: CountSchedule = DEFAULT_COUNT_SCHEDULE, eligibleSince: Date = ELIGIBLE) =>
    countStatusFor({ now: at(now), schedule, lastFullCountMoment: last === null ? null : at(last), eligibleSince });

  it("is DONE when the count moment falls inside the current month's open window", () => {
    const r = status("2026-09-28T03:00:00.000Z", "2026-09-27T03:00:00.000Z");
    expect(r).toEqual({ status: "DONE", monthKey: "2026-09", dueAt: at("2026-09-30T16:59:59.999Z") });
  });

  it("credits a count finished at 00:30 WIB on the day September's window opens to September", () => {
    expect(status("2026-09-28T03:00:00.000Z", "2026-09-26T17:30:00.000Z").status).toBe("DONE");
  });

  it("credits a count finished at 23:30 WIB the day before September's window opens to August", () => {
    const r = status("2026-09-28T03:00:00.000Z", "2026-09-26T16:30:00.000Z");
    expect(r.status).toBe("DUE");
    expect(r.monthKey).toBe("2026-09");
  });

  it("is NOT_YET for the current month before its window opens, when the previous month was counted", () => {
    const r = status("2026-09-10T03:00:00.000Z", "2026-08-29T03:00:00.000Z");
    expect(r).toEqual({ status: "NOT_YET", monthKey: "2026-09", dueAt: at("2026-09-30T16:59:59.999Z") });
  });

  it("turns DUE at the exact instant the window opens", () => {
    expect(status("2026-09-26T16:59:59.999Z", "2026-08-29T03:00:00.000Z").status).toBe("NOT_YET");
    expect(status("2026-09-26T17:00:00.000Z", "2026-08-29T03:00:00.000Z").status).toBe("DUE");
  });

  it("stays DUE through the end of the due day and turns OVERDUE the instant after", () => {
    expect(status("2026-09-15T16:59:59.999Z", "2026-08-20T03:00:00.000Z", DUE_15).status).toBe("DUE");
    const r = status("2026-09-15T17:00:00.000Z", "2026-08-20T03:00:00.000Z", DUE_15);
    expect(r).toEqual({ status: "OVERDUE", monthKey: "2026-09", dueAt: at("2026-09-15T16:59:59.999Z") });
  });

  it("keeps a missed month OVERDUE into the next one: with the last-day default, 07:00 WIB on 1 October is OVERDUE for September", () => {
    const r = status("2026-10-01T00:00:00.000Z", "2026-08-20T03:00:00.000Z");
    expect(r).toEqual({ status: "OVERDUE", monthKey: "2026-09", dueAt: at("2026-09-30T16:59:59.999Z") });
  });

  it("keeps a missed month OVERDUE for a store that has never been counted", () => {
    const r = status("2026-10-01T00:00:00.000Z", null);
    expect(r.status).toBe("OVERDUE");
    expect(r.monthKey).toBe("2026-09");
  });

  it("does not owe a month the store did not exist for when its window opened", () => {
    const r = status("2026-10-01T00:00:00.000Z", null, DEFAULT_COUNT_SCHEDULE, new Date("2026-09-28T00:00:00.000+07:00"));
    expect(r).toEqual({ status: "NOT_YET", monthKey: "2026-10", dueAt: at("2026-10-31T16:59:59.999Z") });
  });

  it("keeps a missed month OVERDUE across the year boundary", () => {
    const r = status("2027-01-02T03:00:00.000Z", "2026-11-20T03:00:00.000Z");
    expect(r).toEqual({ status: "OVERDUE", monthKey: "2026-12", dueAt: at("2026-12-31T16:59:59.999Z") });
  });

  it("drops a missed month once the next window opens: the current month is the one owed", () => {
    const r = status("2026-10-16T03:00:00.000Z", "2026-08-20T03:00:00.000Z", DUE_15);
    expect(r).toEqual({ status: "OVERDUE", monthKey: "2026-10", dueAt: at("2026-10-15T16:59:59.999Z") });
  });

  it("credits the September count taken on 2 October to September, and still opens October on time", () => {
    const oct5 = status("2026-10-05T03:00:00.000Z", "2026-10-02T03:00:00.000Z");
    expect(oct5).toEqual({ status: "NOT_YET", monthKey: "2026-10", dueAt: at("2026-10-31T16:59:59.999Z") });
    const octOpen = status("2026-10-27T17:00:00.000Z", "2026-10-02T03:00:00.000Z");
    expect(octOpen).toEqual({ status: "DUE", monthKey: "2026-10", dueAt: at("2026-10-31T16:59:59.999Z") });
  });

  it("is NOT_YET for the current month when the target is the previous month and it is counted", () => {
    const r = status("2026-10-01T00:00:00.000Z", "2026-09-28T03:00:00.000Z");
    expect(r).toEqual({ status: "NOT_YET", monthKey: "2026-10", dueAt: at("2026-10-31T16:59:59.999Z") });
  });

  describe("numeric due day 15 with 3 lead days", () => {
    /* No count since the September window opened (00:00 WIB on 12 September). */
    const beforeSepWindow = "2026-09-11T03:00:00.000Z";

    it("is OVERDUE for September on 5 October", () => {
      expect(status("2026-10-05T03:00:00.000Z", beforeSepWindow, DUE_15)).toEqual({
        status: "OVERDUE",
        monthKey: "2026-09",
        dueAt: at("2026-09-15T16:59:59.999Z"),
      });
    });

    it("is DUE for October on 13 October, and OVERDUE for October on 16 October", () => {
      expect(status("2026-10-13T03:00:00.000Z", beforeSepWindow, DUE_15)).toEqual({
        status: "DUE",
        monthKey: "2026-10",
        dueAt: at("2026-10-15T16:59:59.999Z"),
      });
      expect(status("2026-10-16T03:00:00.000Z", beforeSepWindow, DUE_15)).toEqual({
        status: "OVERDUE",
        monthKey: "2026-10",
        dueAt: at("2026-10-15T16:59:59.999Z"),
      });
    });

    it("credits a count finished on 20 September to September", () => {
      expect(status("2026-09-25T03:00:00.000Z", "2026-09-20T03:00:00.000Z", DUE_15).status).toBe("DONE");
      expect(status("2026-10-05T03:00:00.000Z", "2026-09-20T03:00:00.000Z", DUE_15)).toEqual({
        status: "NOT_YET",
        monthKey: "2026-10",
        dueAt: at("2026-10-15T16:59:59.999Z"),
      });
    });

    it("credits an early count, finished before the window opened, to the previous slot", () => {
      const early = "2026-09-10T03:00:00.000Z";
      expect(status("2026-09-11T03:00:00.000Z", early, DUE_15)).toEqual({
        status: "NOT_YET",
        monthKey: "2026-09",
        dueAt: at("2026-09-15T16:59:59.999Z"),
      });
      expect(status("2026-09-13T03:00:00.000Z", early, DUE_15).status).toBe("DUE");
    });

    it("is NOT_YET for next month, not OVERDUE, at a store created on the 20th", () => {
      const created = new Date("2026-09-20T10:00:00.000+07:00");
      expect(status("2026-09-25T03:00:00.000Z", null, DUE_15, created)).toEqual({
        status: "NOT_YET",
        monthKey: "2026-10",
        dueAt: at("2026-10-15T16:59:59.999Z"),
      });
      expect(status("2026-10-05T03:00:00.000Z", null, DUE_15, created).status).toBe("NOT_YET");
    });

    it("does not owe the month at a store created exactly as its window opened, and does one instant earlier", () => {
      const sepOpen = at("2026-09-11T17:00:00.000Z");
      expect(status("2026-09-14T03:00:00.000Z", null, DUE_15, sepOpen)).toEqual({
        status: "NOT_YET",
        monthKey: "2026-10",
        dueAt: at("2026-10-15T16:59:59.999Z"),
      });
      expect(status("2026-09-14T03:00:00.000Z", null, DUE_15, new Date(sepOpen.getTime() - 1)).status).toBe("DUE");
    });
  });
});
