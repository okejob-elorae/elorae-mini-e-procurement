import { describe, it, expect } from "vitest";
import { planCheckIn } from "./visit-transitions";

describe("planCheckIn", () => {
  it("returns open-fresh when there is no active visit", () => {
    expect(planCheckIn("store-1", null)).toEqual({
      kind: "open-fresh",
      newStoreId: "store-1",
    });
  });

  it("returns no-op-same-store when active visit is at target store", () => {
    const active = { id: "visit-A", storeId: "store-1" };
    expect(planCheckIn("store-1", active)).toEqual({
      kind: "no-op-same-store",
      existingVisitId: "visit-A",
    });
  });

  it("returns auto-close-and-open when active visit is at another store", () => {
    const active = { id: "visit-A", storeId: "store-1" };
    expect(planCheckIn("store-2", active)).toEqual({
      kind: "auto-close-and-open",
      autoCloseVisitId: "visit-A",
      newStoreId: "store-2",
    });
  });
});
