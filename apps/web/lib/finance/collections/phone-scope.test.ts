import { describe, expect, it } from "vitest";
import { isKonsiBill } from "./phone-scope";

/*
 * `isKonsiBill` is what `submitSettlement`, `submitCollection` and `assignCollector` refuse with
 * `KONSI_LEWAT_BKM`: a konsi bill is paid only through a BKM (owner decision 2026-10-29). It reads
 * the bill's OWN marks, never the store's terms today.
 */
describe("isKonsiBill", () => {
  it("is a konsi bill when the bill itself is marked consignment (cycle bill, paper konsi debt)", () => {
    expect(isKonsiBill({ isConsignment: true, sellThroughId: null })).toBe(true);
  });

  it("is a konsi bill when it belongs to a sell-through report, marked or not", () => {
    expect(isKonsiBill({ isConsignment: false, sellThroughId: "kst-1" })).toBe(true);
    expect(isKonsiBill({ isConsignment: true, sellThroughId: "kst-1" })).toBe(true);
  });

  it("is not a konsi bill without either mark — a putus invoice stays one even at a store now KONSI", () => {
    expect(isKonsiBill({ isConsignment: false, sellThroughId: null })).toBe(false);
  });
});
