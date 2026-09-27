import { describe, expect, it } from "vitest";
import { findPrefixConflict, normalizePrefix, validateDocNumberConfigInput } from "./validate";

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

describe("normalizePrefix", () => {
  it("trims and appends the slash the generator appends", () => {
    expect(normalizePrefix("  PUTUS ")).toBe("PUTUS/");
    expect(normalizePrefix("PUTUS/")).toBe("PUTUS/");
  });
});

describe("findPrefixConflict", () => {
  const rows = [
    { docType: "PUTUS", prefix: "PUTUS/" },
    { docType: "KONSI", prefix: "KONSI/" },
  ];

  it("matches another doc type's prefix case-insensitively", () => {
    expect(findPrefixConflict("KONSI", "putus/", rows)).toBe("PUTUS");
  });

  it("matches a prefix that differs only by the missing trailing slash", () => {
    expect(findPrefixConflict("KONSI", " PUTUS ", rows)).toBe("PUTUS");
  });

  it("does not treat the doc type's own prefix as a conflict", () => {
    expect(findPrefixConflict("PUTUS", "PUTUS", rows)).toBeNull();
  });

  it("returns null when no other doc type renders the prefix", () => {
    expect(findPrefixConflict("KONSI", "KNS/", rows)).toBeNull();
  });
});
