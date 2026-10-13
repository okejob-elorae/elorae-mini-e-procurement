import { describe, expect, it } from "vitest";
import { groupColorLabels } from "./variant-color-seed";

describe("groupColorLabels", () => {
  it("merges known typos and case variants under the most used spelling", () => {
    const groups = groupColorLabels(
      new Map([
        ["Cappuccino", 48],
        ["Cappucino", 8],
        ["Cppuccino", 8],
        ["Khaky", 16],
        ["Khaki", 40],
        ["black", 2],
        ["Black", 225],
        ["Mist", 6],
      ]),
    );
    expect(groups).toEqual([
      { name: "Black", aliases: [] },
      { name: "Cappuccino", aliases: ["Cappucino", "Cppuccino"] },
      { name: "Khaki", aliases: ["Khaky"] },
      { name: "Mist", aliases: [] },
    ]);
  });

  it("names a group after the typo target even when only the typo is used", () => {
    expect(groupColorLabels(new Map([["Khaky", 3]]))).toEqual([{ name: "Khaki", aliases: ["Khaky"] }]);
  });
});
