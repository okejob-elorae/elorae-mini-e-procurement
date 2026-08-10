import { describe, expect, it } from "vitest";
import { buildRollup } from "./rollup";
import type { BalanceRow } from "./balances";

function row(over: Partial<BalanceRow> & { accountId: string; code: string }): BalanceRow {
  return {
    accountId: over.accountId,
    code: over.code,
    name: over.name ?? `Account ${over.code}`,
    type: over.type ?? "ASET",
    parentId: over.parentId ?? null,
    depth: over.depth ?? 0,
    isActive: over.isActive ?? true,
    hasChildren: over.hasChildren ?? false,
    debit: over.debit ?? 0,
    credit: over.credit ?? 0,
    signed: over.signed ?? 0,
  };
}

describe("buildRollup", () => {
  it("nests children under their parent and sums subtotals upward", () => {
    const rows: BalanceRow[] = [
      row({ accountId: "p", code: "1100", hasChildren: true, signed: 0 }),
      row({ accountId: "c1", code: "1101", parentId: "p", depth: 1, signed: 300 }),
      row({ accountId: "c2", code: "1102", parentId: "p", depth: 1, signed: 200 }),
    ];

    const tree = buildRollup(rows, ["ASET"]);

    expect(tree).toHaveLength(1);
    expect(tree[0].code).toBe("1100");
    expect(tree[0].subtotal).toBe(500);
    expect(tree[0].children.map((c) => c.code)).toEqual(["1101", "1102"]);
    expect(tree[0].children[0].subtotal).toBe(300);
  });

  it("rolls up through more than one level", () => {
    const rows: BalanceRow[] = [
      row({ accountId: "a", code: "1000", hasChildren: true }),
      row({ accountId: "b", code: "1100", parentId: "a", depth: 1, hasChildren: true }),
      row({ accountId: "c", code: "1101", parentId: "b", depth: 2, signed: 750 }),
    ];

    const tree = buildRollup(rows, ["ASET"]);

    expect(tree[0].subtotal).toBe(750);
    expect(tree[0].children[0].subtotal).toBe(750);
  });

  it("adds the account's own balance to its children's subtotals", () => {
    const rows: BalanceRow[] = [
      row({ accountId: "p", code: "1100", hasChildren: true, signed: 100 }),
      row({ accountId: "c", code: "1101", parentId: "p", depth: 1, signed: 50 }),
    ];

    expect(buildRollup(rows, ["ASET"])[0].subtotal).toBe(150);
  });

  it("treats a row whose parent is absent from the set as a root", () => {
    const rows: BalanceRow[] = [
      row({ accountId: "orphan", code: "1999", parentId: "missing", depth: 1, signed: 42 }),
    ];

    const tree = buildRollup(rows, ["ASET"]);

    expect(tree).toHaveLength(1);
    expect(tree[0].code).toBe("1999");
    expect(tree[0].subtotal).toBe(42);
  });

  it("keeps only the requested account types", () => {
    const rows: BalanceRow[] = [
      row({ accountId: "a", code: "1100", type: "ASET", signed: 10 }),
      row({ accountId: "b", code: "4100", type: "PENDAPATAN", signed: 20 }),
    ];

    expect(buildRollup(rows, ["PENDAPATAN"]).map((n) => n.code)).toEqual(["4100"]);
  });

  it("orders siblings by account code", () => {
    const rows: BalanceRow[] = [
      row({ accountId: "b", code: "1200" }),
      row({ accountId: "a", code: "1100" }),
    ];

    expect(buildRollup(rows, ["ASET"]).map((n) => n.code)).toEqual(["1100", "1200"]);
  });

  it("keeps subtotals cent-exact when child balances are fractional", () => {
    const rows: BalanceRow[] = [
      row({ accountId: "p", code: "6100", hasChildren: true, signed: 0.1 }),
      row({ accountId: "c1", code: "6101", parentId: "p", depth: 1, signed: 0.2 }),
      row({ accountId: "c2", code: "6102", parentId: "p", depth: 1, signed: 300.1 }),
    ];

    expect(buildRollup(rows, ["ASET"])[0].subtotal).toBe(300.4);
  });
});
