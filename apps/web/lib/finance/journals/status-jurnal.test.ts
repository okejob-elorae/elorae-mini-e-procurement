import { describe, expect, it } from "vitest";
import { SARING_JURNAL_BERLAKU, STATUS_JURNAL, jurnalBerlaku } from "./status-jurnal";

describe("status jurnal", () => {
  it("hanya POSTED yang dihitung; tanpa status dibaca seperti DEFAULT kolom (POSTED)", () => {
    expect(jurnalBerlaku("POSTED")).toBe(true);
    expect(jurnalBerlaku(undefined)).toBe(true);
    expect(jurnalBerlaku(null)).toBe(true);
    expect(jurnalBerlaku("DRAFT")).toBe(false);
    expect(jurnalBerlaku("REJECTED")).toBe(false);
    expect(SARING_JURNAL_BERLAKU).toEqual({ status: "POSTED" });
    expect(Object.values(STATUS_JURNAL)).toEqual(["POSTED", "DRAFT", "REJECTED"]);
  });
});
