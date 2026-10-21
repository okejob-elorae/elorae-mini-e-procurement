import { describe, expect, it } from "vitest";
import { fabricRollCode } from "./roll-code";

const DOC = "GRN/2026/10/0001";

describe("fabricRollCode", () => {
  it("pads to two digits for small totals", () => {
    expect(fabricRollCode(DOC, 1, 1)).toBe(`${DOC}-R01`);
    expect(fabricRollCode(DOC, 99, 99)).toBe(`${DOC}-R99`);
  });

  it("widens the padding to the digit count of the total", () => {
    expect(fabricRollCode(DOC, 7, 100)).toBe(`${DOC}-R007`);
    expect(fabricRollCode(DOC, 100, 100)).toBe(`${DOC}-R100`);
    expect(fabricRollCode(DOC, 12, 1000)).toBe(`${DOC}-R0012`);
  });
});
