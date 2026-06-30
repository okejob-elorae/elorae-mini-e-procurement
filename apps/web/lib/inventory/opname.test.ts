import { describe, expect, it } from "vitest";
import {
  computeVariance,
  hasQtyDrift,
  isSelfApprovalBlocked,
  shouldApplyAdjustment,
} from "./opname";

describe("computeVariance", () => {
  it("returns counted minus snapshot", () => {
    expect(computeVariance(105, 100)).toBe(5);
    expect(computeVariance(95, 100)).toBe(-5);
  });
});

describe("hasQtyDrift", () => {
  it("flags when current differs from snapshot", () => {
    expect(hasQtyDrift(97, 100)).toBe(true);
    expect(hasQtyDrift(100, 100)).toBe(false);
  });
});

describe("shouldApplyAdjustment", () => {
  it("skips when counted equals current", () => {
    expect(shouldApplyAdjustment(100, 100)).toBe(false);
  });

  it("applies when counted differs from current", () => {
    expect(shouldApplyAdjustment(100, 97)).toBe(true);
  });
});

describe("isSelfApprovalBlocked", () => {
  it("blocks when submitter approves without override permission", () => {
    expect(isSelfApprovalBlocked("user-1", "user-1", false)).toBe(true);
  });

  it("allows different approver", () => {
    expect(isSelfApprovalBlocked("user-1", "user-2", false)).toBe(false);
  });

  it("allows self-approval with approve_own permission", () => {
    expect(isSelfApprovalBlocked("user-1", "user-1", true)).toBe(false);
  });
});
