import { describe, expect, it } from "vitest";
import { isCeilingReached } from "./ledger-query";

/*
 * Pure logic only. Two different limits so a hardcoded constant inside the helper (e.g. a
 * copy-pasted `=== 2000`) would fail rather than accidentally pass for both callers.
 */
describe("isCeilingReached", () => {
  it("is false below the ceiling", () => {
    expect(isCeilingReached(1999, 2000)).toBe(false);
    expect(isCeilingReached(499, 500)).toBe(false);
  });

  it("is true exactly AT the ceiling — the take cap was hit, so rows beyond it were dropped", () => {
    expect(isCeilingReached(2000, 2000)).toBe(true);
    expect(isCeilingReached(500, 500)).toBe(true);
  });

  it("is false above the ceiling — a fetch capped by `take` can never actually report this, but the comparison must still be `===`, not `>=`", () => {
    expect(isCeilingReached(2001, 2000)).toBe(false);
    expect(isCeilingReached(501, 500)).toBe(false);
  });

  it("is false for zero rows", () => {
    expect(isCeilingReached(0, 2000)).toBe(false);
    expect(isCeilingReached(0, 500)).toBe(false);
  });
});
