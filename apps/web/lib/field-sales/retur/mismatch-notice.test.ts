import { describe, it, expect } from "vitest";
import { buildSalesmanMismatchNotice } from "./mismatch-notice";

describe("buildSalesmanMismatchNotice", () => {
  const input = { returnId: "r1", docNo: "FRET/2026/10/0007", storeId: "s1", mismatchedLineCount: 2 };

  it("names the docNo in the title", () => {
    expect(buildSalesmanMismatchNotice(input).title).toBe("Retur FRET/2026/10/0007: hitungan gudang berbeda");
  });

  it("carries the mismatched line count in the body", () => {
    expect(buildSalesmanMismatchNotice(input).body).toBe(
      "2 baris retur tidak sesuai dengan hitungan gudang. Admin sedang menindaklanjuti.",
    );
    expect(buildSalesmanMismatchNotice({ ...input, mismatchedLineCount: 1 }).body).toMatch(/^1 baris /);
  });

  it("puts only flat string ids in data", () => {
    const { data } = buildSalesmanMismatchNotice(input);
    expect(data).toEqual({ returnId: "r1", docNo: "FRET/2026/10/0007", storeId: "s1" });
    expect(Object.values(data).every((v) => typeof v === "string")).toBe(true);
  });
});
