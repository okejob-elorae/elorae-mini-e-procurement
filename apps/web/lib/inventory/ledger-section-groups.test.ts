import { describe, expect, it } from "vitest";
import { groupSectionsByLocation } from "./ledger-section-groups";
import type { LedgerSection } from "./stock-ledger-card";

const s = (
  locationType: LedgerSection["locationType"],
  locationId: string,
  variantSku: string,
  closingBalance: number,
): LedgerSection => ({
  locationType,
  locationId,
  locationLabel: locationId,
  locationResolved: true,
  variantSku,
  closingBalance,
  entries: [],
  truncated: false,
});

describe("groupSectionsByLocation", () => {
  it("groups variant sections under their location and sums the closing balance", () => {
    const groups = groupSectionsByLocation([
      s("MAIN", "main", "A", 3),
      s("MAIN", "main", "B", 4),
      s("STORE", "st1", "A", 1),
    ]);
    expect(groups.map((g) => [g.key, g.sections.length, g.closingBalance])).toEqual([
      ["MAIN:main", 2, 7],
      ["STORE:st1", 1, 1],
    ]);
  });

  it("keeps non-contiguous sections of one location in one group", () => {
    const groups = groupSectionsByLocation([
      s("MAIN", "main", "A", 1),
      s("STORE", "st1", "A", 1),
      s("MAIN", "main", "B", 1),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].sections).toHaveLength(2);
  });

  it("returns no groups for no sections", () => {
    expect(groupSectionsByLocation([])).toEqual([]);
  });
});
