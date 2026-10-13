import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DEFAULT_PAYMENT_REMINDER_DAYS,
  PAYMENT_REMINDER_SETTING_KEY,
  parsePaymentReminderDays,
  validatePaymentReminderDays,
} from "./payment-reminder-thresholds";

describe("validatePaymentReminderDays", () => {
  it("normalises spaces, duplicates, a trailing comma and order", () => {
    expect(validatePaymentReminderDays(" 7, -1 ,0,-1, ")).toEqual({ ok: true, days: [-1, 0, 7] });
  });

  it("treats -0 as 0", () => {
    const result = validatePaymentReminderDays("-0,0");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.days).toHaveLength(1);
      expect(Object.is(result.days[0], 0)).toBe(true);
    }
  });

  it("refuses an empty or comma-only value", () => {
    expect(validatePaymentReminderDays("")).toEqual({ ok: false, code: "EMPTY" });
    expect(validatePaymentReminderDays(" , ,")).toEqual({ ok: false, code: "EMPTY" });
  });

  it("refuses anything that is not a whole number", () => {
    for (const raw of ["a", "1.5", "--1", "+7", "7 days", "1e3"]) {
      expect(validatePaymentReminderDays(raw)).toEqual({ ok: false, code: "INVALID" });
    }
  });

  it("refuses values outside -365..365, huge ones included", () => {
    expect(validatePaymentReminderDays("366")).toEqual({ ok: false, code: "OUT_OF_RANGE" });
    expect(validatePaymentReminderDays("-366")).toEqual({ ok: false, code: "OUT_OF_RANGE" });
    expect(validatePaymentReminderDays("1234567890123456789012345")).toEqual({ ok: false, code: "OUT_OF_RANGE" });
    expect(validatePaymentReminderDays("-365,365")).toEqual({ ok: true, days: [-365, 365] });
  });
});

describe("parsePaymentReminderDays", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("falls back to the default when the setting is absent or blank, without warning", () => {
    expect(parsePaymentReminderDays(null)).toEqual([-7, -1, 0, 7]);
    expect(parsePaymentReminderDays(undefined)).toEqual([-7, -1, 0, 7]);
    expect(parsePaymentReminderDays("   ")).toEqual([-7, -1, 0, 7]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("fails open to the default on a malformed or out-of-range value, and says so", () => {
    expect(parsePaymentReminderDays("7,x")).toEqual([-7, -1, 0, 7]);
    expect(parsePaymentReminderDays("400")).toEqual([-7, -1, 0, 7]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(PAYMENT_REMINDER_SETTING_KEY));
  });

  it("returns the configured days sorted", () => {
    expect(parsePaymentReminderDays("3,-3")).toEqual([-3, 3]);
  });

  it("never hands out the shared default array", () => {
    const days = parsePaymentReminderDays(null);
    days.push(99);
    expect(DEFAULT_PAYMENT_REMINDER_DAYS).toEqual([-7, -1, 0, 7]);
  });
});
