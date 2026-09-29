import { describe, expect, it } from "vitest";
import { countTotal, logoutBlockReason } from "./clear-on-logout";

describe("logoutBlockReason", () => {
  it("allows logout when every queue is empty", () => {
    expect(logoutBlockReason({ orders: 0, photos: 0, completions: 0 })).toBeNull();
  });

  it("blocks when any single queue holds a row", () => {
    expect(logoutBlockReason({ orders: 1, photos: 0, completions: 0 })).toBe("unsynced");
    expect(logoutBlockReason({ orders: 0, photos: 2, completions: 0 })).toBe("unsynced");
    expect(logoutBlockReason({ orders: 0, photos: 0, completions: 3 })).toBe("unsynced");
  });
});

describe("countTotal", () => {
  it("sums the three queues", () => {
    expect(countTotal({ orders: 1, photos: 2, completions: 3 })).toBe(6);
  });
});
