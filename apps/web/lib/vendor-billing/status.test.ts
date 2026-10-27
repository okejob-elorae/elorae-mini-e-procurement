import { describe, it, expect } from "vitest";
import { deriveBillStatus } from "./status";

describe("deriveBillStatus", () => {
  it.each([
    [100, 0, false, "UNPAID"],
    [100, 40, false, "PARTIAL"],
    [100, 100, false, "PAID"],
    [100, 40, true, "VOID"],
    [0, 0, false, "PAID"],
  ] as const)("total %d, paid %d, voided %s -> %s", (total, paid, voided, expected) => {
    expect(deriveBillStatus(total, paid, voided)).toBe(expected);
  });
});
