import { describe, it, expect } from "vitest";
import { weightedAvgCost } from "./cost";

describe("weightedAvgCost", () => {
  it("returns the add cost when there is no prior stock", () => {
    expect(weightedAvgCost(0, 0, 10, 1500)).toBe(1500);
  });
  it("weights across prior + added stock", () => {
    // 10@1000 + 10@2000 => 15000/20 = 1500
    expect(weightedAvgCost(10, 1000, 10, 2000)).toBe(1500);
  });
  it("keeps the prior average when adding zero", () => {
    expect(weightedAvgCost(10, 1000, 0, 0)).toBe(1000);
  });
  it("handles uneven quantities", () => {
    // 5@1200 + 15@800 => (6000+12000)/20 = 900
    expect(weightedAvgCost(5, 1200, 15, 800)).toBe(900);
  });
});
