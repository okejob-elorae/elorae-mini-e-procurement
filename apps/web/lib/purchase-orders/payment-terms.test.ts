import { describe, expect, it } from "vitest";
import {
  PAYMENT_TERMS_DAYS_MAX,
  computePaymentDueDate,
  parsePaymentTermsDays,
  paymentTermsDaysField,
  resolveCreatePaymentTerms,
} from "./payment-terms";

describe("paymentTermsDaysField", () => {
  it.each([0, 1, 30, PAYMENT_TERMS_DAYS_MAX])("accepts %s", (n) => {
    expect(paymentTermsDaysField.parse(n)).toBe(n);
  });

  it.each(["", null, Number.NaN])("normalises %s to null", (v) => {
    expect(paymentTermsDaysField.parse(v)).toBeNull();
  });

  it.each([-1, 1.5, PAYMENT_TERMS_DAYS_MAX + 1, "30"])("rejects %s", (v) => {
    expect(paymentTermsDaysField.safeParse(v).success).toBe(false);
  });

  it("keeps undefined when made optional", () => {
    expect(paymentTermsDaysField.optional().parse(undefined)).toBeUndefined();
  });
});

describe("parsePaymentTermsDays", () => {
  it("returns the value for valid input", () => {
    expect(parsePaymentTermsDays(45)).toEqual({ ok: true, value: 45 });
    expect(parsePaymentTermsDays(null)).toEqual({ ok: true, value: null });
  });

  it("refuses invalid input", () => {
    expect(parsePaymentTermsDays(-3)).toEqual({ ok: false });
    expect(parsePaymentTermsDays(undefined)).toEqual({ ok: false });
  });
});

describe("computePaymentDueDate", () => {
  it("adds the terms to the WIB calendar day of the receipt", () => {
    /* 2026-10-12 10:00 WIB */
    const at = new Date("2026-10-12T03:00:00.000Z");
    expect(computePaymentDueDate(at, 30)?.toISOString()).toBe("2026-11-11T00:00:00.000Z");
  });

  it("uses the WIB day for a late-evening receipt", () => {
    /* 2026-10-12 23:30 WIB = 16:30Z the same UTC day */
    const at = new Date("2026-10-12T16:30:00.000Z");
    expect(computePaymentDueDate(at, 0)?.toISOString()).toBe("2026-10-12T00:00:00.000Z");
  });

  it("uses the WIB day, not the UTC day, just after WIB midnight", () => {
    /* 2026-10-13 00:30 WIB = 2026-10-12 17:30Z */
    const at = new Date("2026-10-12T17:30:00.000Z");
    expect(computePaymentDueDate(at, 0)?.toISOString()).toBe("2026-10-13T00:00:00.000Z");
  });

  it("rolls over month and year", () => {
    const at = new Date("2026-12-20T03:00:00.000Z");
    expect(computePaymentDueDate(at, 30)?.toISOString()).toBe("2027-01-19T00:00:00.000Z");
  });

  it("returns null without terms or without a receipt", () => {
    expect(computePaymentDueDate(new Date(), null)).toBeNull();
    expect(computePaymentDueDate(null, 30)).toBeNull();
  });
});

describe("resolveCreatePaymentTerms", () => {
  it("defaults an absent payload value from the supplier", () => {
    expect(resolveCreatePaymentTerms(undefined, 30)).toBe(30);
    expect(resolveCreatePaymentTerms(undefined, null)).toBeNull();
  });

  it("keeps an explicit payload value, null included", () => {
    expect(resolveCreatePaymentTerms(14, 30)).toBe(14);
    expect(resolveCreatePaymentTerms(null, 30)).toBeNull();
  });
});
