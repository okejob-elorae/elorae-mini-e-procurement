import { describe, expect, it } from "vitest";
import { isAwaitingApproval } from "./awaiting-acc";
import type { SnapshotStep } from "./calculations";

function step(name: string, seq: number): SnapshotStep {
  return {
    seq,
    name,
    type: "FIXED",
    days: 1,
    rateQty: null,
    qty: null,
    computedDays: 1,
  };
}

describe("isAwaitingApproval", () => {
  const chain = [
    step("SAMPLE PRODUKSI", 1),
    step("ACC SAMPLE PRODUKSI", 2),
    step("PROSES PRODUKSI", 3),
  ];

  it("true when parked on ACC step", () => {
    expect(isAwaitingApproval(chain, 1)).toBe(true);
  });

  it("false when parked on non-ACC", () => {
    expect(isAwaitingApproval(chain, 0)).toBe(false);
  });

  it("false when no confirmation", () => {
    expect(isAwaitingApproval(chain, null)).toBe(false);
  });

  it("honors live map over prefix", () => {
    expect(
      isAwaitingApproval(chain, 0, { "SAMPLE PRODUKSI": true })
    ).toBe(true);
  });
});
