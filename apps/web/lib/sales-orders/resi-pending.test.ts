import { describe, expect, it } from "vitest";
import { hasStoredResi, isAwaitingResi, type ResiPendingOrder } from "./resi-pending";

function order(overrides: Partial<ResiPendingOrder> = {}): ResiPendingOrder {
  return {
    channel: "SHOPEE",
    status: "NEW",
    isCanceled: false,
    trackingNumber: null,
    ...overrides,
  };
}

describe("isAwaitingResi", () => {
  it("is true for a SHOPEE order that is NEW with no resi", () => {
    expect(isAwaitingResi(order({ channel: "SHOPEE", status: "NEW" }))).toBe(true);
  });

  it("is true for a TIKTOK order that is PROCESSING with no resi", () => {
    expect(isAwaitingResi(order({ channel: "TIKTOK", status: "PROCESSING" }))).toBe(true);
  });

  it("is true for a TOKOPEDIA order that is NEW with no resi", () => {
    expect(isAwaitingResi(order({ channel: "TOKOPEDIA", status: "NEW" }))).toBe(true);
  });

  it("is false for an OTHER-channel order", () => {
    expect(isAwaitingResi(order({ channel: "OTHER" }))).toBe(false);
  });

  it("is false for a SHIPPED order", () => {
    expect(isAwaitingResi(order({ status: "SHIPPED" }))).toBe(false);
  });

  it("is false for a COMPLETED order", () => {
    expect(isAwaitingResi(order({ status: "COMPLETED" }))).toBe(false);
  });

  it("is false for a CANCELLED-status order", () => {
    expect(isAwaitingResi(order({ status: "CANCELLED" }))).toBe(false);
  });

  it("is false for a RETURNED order", () => {
    expect(isAwaitingResi(order({ status: "RETURNED" }))).toBe(false);
  });

  it("is false when isCanceled is true, regardless of status", () => {
    expect(isAwaitingResi(order({ status: "NEW", isCanceled: true }))).toBe(false);
  });

  it("is false when trackingNumber is a non-blank resi", () => {
    expect(isAwaitingResi(order({ trackingNumber: "JNE123456" }))).toBe(false);
  });

  it("is true when trackingNumber is blank-after-trim", () => {
    expect(isAwaitingResi(order({ trackingNumber: "   " }))).toBe(true);
  });

  it("is true when trackingNumber is an empty string", () => {
    expect(isAwaitingResi(order({ trackingNumber: "" }))).toBe(true);
  });
});

describe("hasStoredResi", () => {
  it("is false for null, undefined, empty and blank tracking numbers", () => {
    expect(hasStoredResi(null)).toBe(false);
    expect(hasStoredResi(undefined)).toBe(false);
    expect(hasStoredResi("")).toBe(false);
    expect(hasStoredResi("   ")).toBe(false);
  });

  it("is true for a non-blank tracking number", () => {
    expect(hasStoredResi("SPXID0123456789")).toBe(true);
  });
});
