import { describe, expect, it } from "vitest";
import { groupLedgerEntries, type RawLedgerRow } from "./stock-ledger-card";

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

  it("returns no sections for no rows", () => {
    expect(groupLedgerEntries([], { stores: new Map(), users: new Map() })).toEqual([]);
  });
});
