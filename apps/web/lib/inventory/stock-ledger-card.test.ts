import { describe, expect, it } from "vitest";
import { STOCK_LEDGER_REF_TYPES, type StockLedgerRefType } from "@elorae/db";
import {
  buildLocationTypeCondition,
  buildRefTypeCondition,
  groupLedgerEntries,
  isQueryTruncated,
  isSectionTruncated,
  QUERY_ENTRY_LIMIT,
  SECTION_ENTRY_LIMIT,
  type RawLedgerRow,
} from "./stock-ledger-card";

const row = (over: Partial<RawLedgerRow>): RawLedgerRow => ({
  id: "e1",
  locationType: "MAIN",
  locationId: "",
  variantSku: "",
  refType: "GRN",
  refId: "g1",
  refDocNumber: "GRN/1",
  qty: 100,
  balanceQty: 100,
  unitCost: 10,
  createdById: null,
  createdAt: new Date("2026-09-18T00:00:00Z"),
  ...over,
});

describe("groupLedgerEntries", () => {
  it("splits one item's rows into a section per location and variant", () => {
    const sections = groupLedgerEntries(
      [
        row({ id: "a" }),
        row({ id: "b", locationType: "STORE", locationId: "s1", balanceQty: 40 }),
        row({ id: "c", variantSku: "RED", balanceQty: 7 }),
      ],
      { stores: new Map([["s1", "Toko Melati"]]), users: new Map() },
    );

    expect(sections).toHaveLength(3);
    expect(sections.map((s) => s.entries.length)).toEqual([1, 1, 1]);
  });

  it("orders MAIN before STORE before VAN", () => {
    const sections = groupLedgerEntries(
      [
        row({ id: "v", locationType: "VAN", locationId: "u1" }),
        row({ id: "s", locationType: "STORE", locationId: "s1" }),
        row({ id: "m" }),
      ],
      { stores: new Map([["s1", "Toko Melati"]]), users: new Map([["u1", "Budi"]]) },
    );

    expect(sections.map((s) => s.locationType)).toEqual(["MAIN", "STORE", "VAN"]);
  });

  it("takes the closing balance from the LAST entry's balanceQty, never a sum", () => {
    const sections = groupLedgerEntries(
      [
        row({ id: "a", qty: 100, balanceQty: 500, createdAt: new Date("2026-09-18T00:00:00Z") }),
        row({ id: "b", qty: -40, balanceQty: 460, createdAt: new Date("2026-09-19T00:00:00Z") }),
      ],
      { stores: new Map(), users: new Map() },
    );

    expect(sections[0].closingBalance).toBe(460);
  });

  it("orders entries within a section oldest first", () => {
    const sections = groupLedgerEntries(
      [
        row({ id: "late", createdAt: new Date("2026-09-20T00:00:00Z") }),
        row({ id: "early", createdAt: new Date("2026-09-18T00:00:00Z") }),
      ],
      { stores: new Map(), users: new Map() },
    );

    expect(sections[0].entries.map((e) => e.id)).toEqual(["early", "late"]);
  });

  it("renders an unresolved location id rather than dropping the section", () => {
    const sections = groupLedgerEntries(
      [row({ locationType: "STORE", locationId: "gone" })],
      { stores: new Map(), users: new Map() },
    );

    expect(sections[0].locationResolved).toBe(false);
    expect(sections[0].locationLabel).toBe("gone");
  });

  it("resolves entry order by id when createdAt is shared", () => {
    const sameTime = new Date("2026-09-18T00:00:00Z");
    const sections = groupLedgerEntries(
      [
        row({ id: "z", createdAt: sameTime }),
        row({ id: "a", createdAt: sameTime }),
        row({ id: "m", createdAt: sameTime }),
      ],
      { stores: new Map(), users: new Map() },
    );

    expect(sections[0].entries.map((e) => e.id)).toEqual(["a", "m", "z"]);
  });

  it("orders sections by location type, then label, then variant", () => {
    const sections = groupLedgerEntries(
      [
        row({ id: "s2", locationType: "STORE", locationId: "s2", variantSku: "RED" }),
        row({ id: "s1", locationType: "STORE", locationId: "s1", variantSku: "BLUE" }),
        row({ id: "v1", locationType: "VAN", locationId: "u1", variantSku: "RED" }),
        row({ id: "m2", variantSku: "RED" }),
        row({ id: "m1", variantSku: "BLUE" }),
      ],
      /* Labels are compared by COLLATION, not by what the words mean. An earlier version of
         this fixture used "Toko Awal"/"Toko Akhir" — beginning and end — and asserted them in
         that semantic order, which is the reverse of how they actually sort. Names whose
         alphabetical order is unmistakable keep the next reader from making the same trade. */
      { stores: new Map([["s1", "Toko Anggrek"], ["s2", "Toko Bakung"]]), users: new Map([["u1", "Budi"]]) },
    );

    expect(sections.map((s) => ({ type: s.locationType, label: s.locationLabel, variant: s.variantSku }))).toEqual([
      { type: "MAIN", label: "MAIN", variant: "BLUE" },
      { type: "MAIN", label: "MAIN", variant: "RED" },
      { type: "STORE", label: "Toko Anggrek", variant: "BLUE" },
      { type: "STORE", label: "Toko Bakung", variant: "RED" },
      { type: "VAN", label: "Budi", variant: "RED" },
    ]);
  });

  it("returns no sections for no rows", () => {
    expect(groupLedgerEntries([], { stores: new Map(), users: new Map() })).toEqual([]);
  });
});

/*
 * Pure logic only — no DB fixtures. Exercising the real query-level truncation would need
 * QUERY_ENTRY_LIMIT (2000) rows seeded on the shared :3308 test bed, which is not worth
 * littering the bed for one boolean; the constant is also not injectable into
 * getItemMovementCard. Pinning the comparison directly against isQueryTruncated is the
 * cheap route: it is the exact function the query layer calls with `rows.length`.
 */
describe("isQueryTruncated", () => {
  it("is false below the ceiling", () => {
    expect(isQueryTruncated(QUERY_ENTRY_LIMIT - 1)).toBe(false);
  });

  it("is true exactly AT the ceiling — the take cap was hit, so rows beyond it were dropped", () => {
    expect(isQueryTruncated(QUERY_ENTRY_LIMIT)).toBe(true);
  });

  it("is false above the ceiling too — unreachable in practice since `take` bounds the fetch, but pins the equality (not >=) choice", () => {
    expect(isQueryTruncated(QUERY_ENTRY_LIMIT + 1)).toBe(false);
  });

  it("is false for zero rows", () => {
    expect(isQueryTruncated(0)).toBe(false);
  });
});

/*
 * Deliberately the OPPOSITE comparison from isQueryTruncated (`>` here, `===` there) — see
 * the comment on isSectionTruncated itself. The section's real entry count is fully known
 * (nothing caps it before this point), so at exactly SECTION_ENTRY_LIMIT entries the display
 * cap hides nothing and truncated must be false. That "exactly at the limit" case is the one
 * this fix round exists for, so it is pinned explicitly below.
 */
describe("isSectionTruncated", () => {
  it("is false below the limit", () => {
    expect(isSectionTruncated(SECTION_ENTRY_LIMIT - 1)).toBe(false);
  });

  it("is false exactly AT the limit — every entry is shown, so nothing is hidden", () => {
    expect(isSectionTruncated(SECTION_ENTRY_LIMIT)).toBe(false);
  });

  it("is true above the limit — the display cap now hides real entries", () => {
    expect(isSectionTruncated(SECTION_ENTRY_LIMIT + 1)).toBe(true);
  });
});

/*
 * Pure predicate shapes, no DB — the integration-level proof that `where` and
 * `historyWhere` actually SHARE this value (rather than each building their own copy)
 * lives in stock-ledger-card.query.test.ts, seeded against a real unregistered-refType
 * row. This block pins the four reachable selection states plus the one unreachable one.
 */
describe("buildRefTypeCondition", () => {
  const subset = STOCK_LEDGER_REF_TYPES.slice(0, 3) as StockLedgerRefType[];
  const fullRegistry = [...STOCK_LEDGER_REF_TYPES] as StockLedgerRefType[];

  it("both undefined => no filter at all", () => {
    expect(buildRefTypeCondition(undefined, undefined)).toBeUndefined();
  });

  it("registered subset, unregistered excluded => refType IN (subset)", () => {
    expect(buildRefTypeCondition(subset, false)).toEqual({ refType: { in: subset } });
  });

  it("registered subset, unregistered included => IN (subset) OR NOT IN (registry)", () => {
    expect(buildRefTypeCondition(subset, true)).toEqual({
      OR: [{ refType: { in: subset } }, { refType: { notIn: fullRegistry } }],
    });
  });

  it("unregistered only, nothing from the registry => refType NOT IN (registry)", () => {
    expect(buildRefTypeCondition([], true)).toEqual({ refType: { notIn: fullRegistry } });
  });

  it("every registered member ticked AND unregistered included => collapses to no filter", () => {
    expect(buildRefTypeCondition(fullRegistry, true)).toBeUndefined();
  });

  it("every registered member ticked but unregistered EXCLUDED is a real filter, not \"all\"", () => {
    /* This is the state the previous round's collapse got wrong: registry-all-ticked
       does not mean "no filter" unless the unregistered class is ticked too. */
    expect(buildRefTypeCondition(fullRegistry, false)).toEqual({ refType: { in: fullRegistry } });
  });

  it("nothing selected at all (unreachable via the control's own guard) => matches nothing, not everything", () => {
    expect(buildRefTypeCondition([], false)).toEqual({ refType: { in: [] } });
  });

  it("refTypes undefined but includeUnregisteredRefTypes explicitly false => also matches nothing, not \"no filter\"", () => {
    /* Only BOTH undefined means "no filter" — this is reachable directly through the
       action (which validates membership/shape, not that the two fields travel
       together), even though the control itself never sends this exact combination. */
    expect(buildRefTypeCondition(undefined, false)).toEqual({ refType: { in: [] } });
  });

  it("a duplicate-bearing array of registry length does NOT collapse to no filter", () => {
    /* Twenty copies of one member: `.length` equals the registry's length but the SET of
       real members has size 1. The action validates membership, never uniqueness, so this
       is a legal input to this function even though today's control never produces one —
       the fix this test pins is comparing SET size, not array length, against the registry. */
    const duplicates = Array(STOCK_LEDGER_REF_TYPES.length).fill(subset[0]) as StockLedgerRefType[];
    expect(buildRefTypeCondition(duplicates, true)).toEqual({
      OR: [{ refType: { in: duplicates } }, { refType: { notIn: fullRegistry } }],
    });
  });
});

/*
 * The sibling of buildRefTypeCondition, and these cases exist because the two used to
 * DISAGREE about an empty array: refTypes matched nothing while locationTypes silently
 * matched everything. A caller narrowing to nothing and being shown the whole unfiltered set
 * is the exact inversion this pair now refuses.
 */
describe("buildLocationTypeCondition", () => {
  it("undefined => no filter at all", () => {
    expect(buildLocationTypeCondition(undefined)).toBeUndefined();
  });

  it("an empty selection matches NOTHING, it does not mean unfiltered", () => {
    expect(buildLocationTypeCondition([])).toEqual({ locationType: { in: [] } });
  });

  it("a subset filters to that subset", () => {
    expect(buildLocationTypeCondition(["MAIN", "VAN"])).toEqual({
      locationType: { in: ["MAIN", "VAN"] },
    });
  });

  it("every member is still a real filter, not collapsed to undefined", () => {
    expect(buildLocationTypeCondition(["MAIN", "STORE", "VAN"])).toEqual({
      locationType: { in: ["MAIN", "STORE", "VAN"] },
    });
  });
});
