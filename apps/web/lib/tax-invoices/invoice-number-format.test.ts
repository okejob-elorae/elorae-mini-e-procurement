import { describe, it, expect } from "vitest";
import { looksLikeDjpInvoiceNumber } from "./invoice-number-format";

describe("looksLikeDjpInvoiceNumber", () => {
  it("accepts the real DJP pattern", () => {
    expect(looksLikeDjpInvoiceNumber("010.000-26.00000001")).toBe(true);
  });

  it("rejects a bare free-text string", () => {
    expect(looksLikeDjpInvoiceNumber("not a faktur number")).toBe(false);
  });

  it("rejects a value missing the trailing digit group", () => {
    expect(looksLikeDjpInvoiceNumber("010.000-26")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(looksLikeDjpInvoiceNumber("")).toBe(false);
  });
});
