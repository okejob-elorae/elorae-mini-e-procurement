import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  countStatusFor,
  countWindowFor,
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

describe("countStatusFor", () => {
  const status = (now: string, last: string | null, schedule: CountSchedule = DEFAULT_COUNT_SCHEDULE, eligibleSince: Date = ELIGIBLE) =>
    countStatusFor({ now: at(now), schedule, lastApprovedFullCountedAt: last === null ? null : at(last), eligibleSince });

  it("is DONE when an approved full count falls in the current WIB month", () => {
    const r = status("2026-09-28T03:00:00.000Z", "2026-09-05T03:00:00.000Z");
    expect(r.status).toBe("DONE");
    expect(r.monthKey).toBe("2026-09");
    expect(r.dueAt.toISOString()).toBe("2026-09-30T16:59:59.999Z");
  });

  it("counts 00:30 WIB on 1 September for September", () => {
    expect(status("2026-09-28T03:00:00.000Z", "2026-08-31T17:30:00.000Z").status).toBe("DONE");
  });

  it("counts 23:30 WIB on 31 August for August", () => {
    const r = status("2026-09-28T03:00:00.000Z", "2026-08-31T16:30:00.000Z");
    expect(r.status).toBe("DUE");
    expect(r.monthKey).toBe("2026-09");
  });

  it("is NOT_YET before the count window opens", () => {
    const r = status("2026-09-10T03:00:00.000Z", "2026-08-20T03:00:00.000Z");
    expect(r).toEqual({ status: "NOT_YET", monthKey: "2026-09", dueAt: at("2026-09-30T16:59:59.999Z") });
  });

  it("turns DUE at the exact instant the window opens", () => {
    expect(status("2026-09-26T16:59:59.999Z", "2026-08-20T03:00:00.000Z").status).toBe("NOT_YET");
    expect(status("2026-09-26T17:00:00.000Z", "2026-08-20T03:00:00.000Z").status).toBe("DUE");
  });

  it("stays DUE through the end of the due day and turns OVERDUE the instant after", () => {
    expect(status("2026-09-15T16:59:59.999Z", "2026-08-20T03:00:00.000Z", DUE_15).status).toBe("DUE");
    const r = status("2026-09-15T17:00:00.000Z", "2026-08-20T03:00:00.000Z", DUE_15);
    expect(r).toEqual({ status: "OVERDUE", monthKey: "2026-09", dueAt: at("2026-09-15T16:59:59.999Z") });
  });

  it("carries a missed month: with the last-day default, 07:00 WIB on 1 October is OVERDUE for September", () => {
    const r = status("2026-10-01T00:00:00.000Z", "2026-08-20T03:00:00.000Z");
    expect(r).toEqual({ status: "OVERDUE", monthKey: "2026-09", dueAt: at("2026-09-30T16:59:59.999Z") });
  });

  it("carries a missed month for a store that has never been counted", () => {
    const r = status("2026-10-01T00:00:00.000Z", null);
    expect(r.status).toBe("OVERDUE");
    expect(r.monthKey).toBe("2026-09");
  });

  it("does not carry a month the store did not exist for when its window opened", () => {
    const r = status("2026-10-01T00:00:00.000Z", null, DEFAULT_COUNT_SCHEDULE, new Date("2026-09-28T00:00:00.000+07:00"));
    expect(r).toEqual({ status: "NOT_YET", monthKey: "2026-10", dueAt: at("2026-10-31T16:59:59.999Z") });
  });

  it("does not carry a month that was counted", () => {
    expect(status("2026-10-01T00:00:00.000Z", "2026-09-12T03:00:00.000Z").status).toBe("NOT_YET");
  });

  it("carries across the year boundary", () => {
    const r = status("2027-01-02T03:00:00.000Z", "2026-11-20T03:00:00.000Z");
    expect(r).toEqual({ status: "OVERDUE", monthKey: "2026-12", dueAt: at("2026-12-31T16:59:59.999Z") });
  });

  it("reports the current month's overdue ahead of a carried one", () => {
    const r = status("2026-10-16T03:00:00.000Z", "2026-08-20T03:00:00.000Z", DUE_15);
    expect(r).toEqual({ status: "OVERDUE", monthKey: "2026-10", dueAt: at("2026-10-15T16:59:59.999Z") });
  });

  it("credits a late count to the month it is counted in", () => {
    expect(status("2026-10-05T03:00:00.000Z", "2026-10-02T03:00:00.000Z").status).toBe("DONE");
  });
});
