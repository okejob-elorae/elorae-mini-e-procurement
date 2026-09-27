import { describe, it, expect } from "vitest";
import { suggestedGapQty } from "./suggested-qty";

describe("suggestedGapQty", () => {
  it("starts a row with no target at 1", () => {
    expect(suggestedGapQty({ target: null, onHand: 0, inTransit: 0, available: 10 })).toBe(1);
  });

  it("caps the shortfall at what main can spare", () => {
    expect(suggestedGapQty({ target: 20, onHand: 0, inTransit: 0, available: 5 })).toBe(5);
  });

  it("rounds a fractional shortfall up", () => {
    expect(suggestedGapQty({ target: 10, onHand: 3.5, inTransit: 0, available: 50 })).toBe(7);
  });

  it("does not let float noise round a whole shortfall up", () => {
    expect(suggestedGapQty({ target: 1.1, onHand: 0.1, inTransit: 0, available: 50 })).toBe(1);
  });

  it("returns null when main cannot spare a whole unit", () => {
    expect(suggestedGapQty({ target: 5, onHand: 0, inTransit: 0, available: 0.5 })).toBeNull();
  });

  it("nets out what is already on order", () => {
    expect(suggestedGapQty({ target: 3, onHand: 1, inTransit: 1, available: 50 })).toBe(1);
  });
});
