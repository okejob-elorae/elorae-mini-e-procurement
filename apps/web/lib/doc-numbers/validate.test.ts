import { describe, expect, it } from "vitest";
import { validateDocNumberConfigInput } from "./validate";

const valid = { docType: "PUTUS", prefix: "PUTUS/", resetPeriod: "YEARLY", padding: 4 };

describe("validateDocNumberConfigInput", () => {
  it("accepts a valid config and trims the prefix", () => {
    expect(validateDocNumberConfigInput({ ...valid, prefix: "  DLV/ " })).toEqual({
      ok: true,
      value: { docType: "PUTUS", prefix: "DLV/", resetPeriod: "YEARLY", padding: 4 },
    });
  });

  it.each([
    [{ ...valid, docType: "NOPE" }, "UNKNOWN_DOC_TYPE"],
    [{ ...valid, prefix: "   " }, "PREFIX_REQUIRED"],
    [{ ...valid, prefix: "X".repeat(21) }, "PREFIX_TOO_LONG"],
    [{ ...valid, resetPeriod: "WEEKLY" }, "INVALID_RESET_PERIOD"],
    [{ ...valid, padding: 0 }, "INVALID_PADDING"],
    [{ ...valid, padding: 9 }, "INVALID_PADDING"],
    [{ ...valid, padding: 2.5 }, "INVALID_PADDING"],
    [{ ...valid, padding: Number.NaN }, "INVALID_PADDING"],
  ])("refuses %o with %s", (input, code) => {
    expect(validateDocNumberConfigInput(input)).toEqual({ ok: false, code });
  });

  it("accepts a prefix of exactly the maximum length and every reset period", () => {
    expect(validateDocNumberConfigInput({ ...valid, prefix: "X".repeat(20) }).ok).toBe(true);
    for (const resetPeriod of ["YEARLY", "MONTHLY", "NEVER"]) {
      expect(validateDocNumberConfigInput({ ...valid, resetPeriod }).ok).toBe(true);
    }
  });
});
