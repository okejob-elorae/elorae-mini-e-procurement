import { describe, expect, it } from "vitest";
import { deltaForSet } from "@elorae/db";

describe("opname ledger typing", () => {
  it("computes a shortfall as a negative adjustment", () => {
    expect(deltaForSet(50, 44)).toBe(-6);
  });

  it("computes a surplus as a positive adjustment", () => {
    expect(deltaForSet(44, 50)).toBe(6);
  });

  it("computes no movement when the count matches", () => {
    expect(deltaForSet(44, 44)).toBe(0);
  });
});
