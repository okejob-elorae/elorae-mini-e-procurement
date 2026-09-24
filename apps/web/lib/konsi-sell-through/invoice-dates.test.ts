import { describe, it, expect } from "vitest";
import { isInvoiceDateAllowed, dueDateFor } from "./invoice-dates";

const wib = (s: string) => new Date(`${s}+07:00`);

describe("isInvoiceDateAllowed", () => {
  const now = wib("2026-10-03T10:00:00.000");

  it("accepts the period-end day even when the period closed later that day than the picked instant", () => {
    expect(isInvoiceDateAllowed(wib("2026-09-30T00:00:00.000"), wib("2026-09-30T15:00:00.000"), now)).toBe(true);
  });

  it("accepts today and refuses tomorrow", () => {
    expect(isInvoiceDateAllowed(wib("2026-10-03T00:00:00.000"), wib("2026-09-30T15:00:00.000"), now)).toBe(true);
    expect(isInvoiceDateAllowed(wib("2026-10-04T00:00:00.000"), wib("2026-09-30T15:00:00.000"), now)).toBe(false);
  });

  it("refuses a day before the period end", () => {
    expect(isInvoiceDateAllowed(wib("2026-09-29T00:00:00.000"), wib("2026-09-30T15:00:00.000"), now)).toBe(false);
  });

  it("compares WIB calendar days, not UTC ones", () => {
    /* 06:30 WIB on 1 Oct is still 30 Sep in UTC. */
    expect(isInvoiceDateAllowed(wib("2026-10-01T06:30:00.000"), wib("2026-10-01T05:00:00.000"), now)).toBe(true);
  });
});

describe("dueDateFor", () => {
  it("adds the store's payment tempo in days, and tempo 0 is the invoice day itself", () => {
    const d = wib("2026-10-01T00:00:00.000");
    expect(dueDateFor(d, 30).toISOString()).toBe(wib("2026-10-31T00:00:00.000").toISOString());
    expect(dueDateFor(d, 0).toISOString()).toBe(d.toISOString());
  });
});
