import { describe, it, expect } from "vitest";
import { buildTree } from "./queries";
import {
  absoluteBalance,
  attachRolledUpBalances,
  balanceSide,
  pruneInactiveForDisplay,
} from "./roll-up-balances";

const rows = [
  { id: "a", code: "1", name: "Aset", type: "ASET" as const, depth: 1, isActive: true, parentId: null },
  { id: "b", code: "11", name: "Lancar", type: "ASET" as const, depth: 2, isActive: true, parentId: "a" },
  { id: "c", code: "1101", name: "Kas", type: "ASET" as const, depth: 3, isActive: true, parentId: "b" },
  { id: "d", code: "1102", name: "Bank", type: "ASET" as const, depth: 3, isActive: true, parentId: "b" },
  { id: "e", code: "2", name: "Liabilitas", type: "LIABILITAS" as const, depth: 1, isActive: true, parentId: null },
  { id: "f", code: "21", name: "Hutang", type: "LIABILITAS" as const, depth: 2, isActive: true, parentId: "e" },
];

const rowsWithInactive = [
  ...rows,
  { id: "g", code: "1103", name: "Old Kas", type: "ASET" as const, depth: 3, isActive: false, parentId: "b" },
];

describe("attachRolledUpBalances", () => {
  it("uses leaf signed amounts and rolls them to parents", () => {
    const tree = buildTree(rows);
    const withBal = attachRolledUpBalances(tree, {
      c: 100_000,
      d: 50_000,
      f: 80_000,
    });
    const aset = withBal[0];
    const lancar = aset.children[0];
    expect(lancar.children[0].balance).toBe(100_000);
    expect(lancar.children[1].balance).toBe(50_000);
    expect(lancar.balance).toBe(150_000);
    expect(aset.balance).toBe(150_000);
    expect(withBal[1].balance).toBe(80_000);
    expect(withBal[1].children[0].balance).toBe(80_000);
  });

  it("defaults missing leaf balances to 0", () => {
    const tree = buildTree(rows);
    const withBal = attachRolledUpBalances(tree, { c: 10 });
    expect(withBal[0].children[0].children[1].balance).toBe(0);
    expect(withBal[0].balance).toBe(10);
  });
});

describe("pruneInactiveForDisplay", () => {
  it("keeps parent rolled-up balance after hiding inactive leaves", () => {
    const tree = buildTree(rowsWithInactive);
    const withBal = attachRolledUpBalances(tree, {
      c: 100_000,
      d: 50_000,
      g: 25_000,
    });
    expect(withBal[0].children[0].balance).toBe(175_000);
    const pruned = pruneInactiveForDisplay(withBal);
    const lancar = pruned[0].children[0];
    expect(lancar.children.map((c) => c.id).sort()).toEqual(["c", "d"]);
    expect(lancar.balance).toBe(175_000);
  });
});

describe("balanceSide", () => {
  it("marks debit-normal positive as Dr and negative as Cr", () => {
    expect(balanceSide("ASET", 100)).toBe("Dr");
    expect(balanceSide("ASET", -50)).toBe("Cr");
    expect(balanceSide("ASET", 0)).toBe("Dr");
  });

  it("marks credit-normal positive as Cr and negative as Dr", () => {
    expect(balanceSide("LIABILITAS", 100)).toBe("Cr");
    expect(balanceSide("LIABILITAS", -50)).toBe("Dr");
    expect(balanceSide("PENDAPATAN", 0)).toBe("Cr");
  });
});

describe("absoluteBalance", () => {
  it("returns the absolute value", () => {
    expect(absoluteBalance(-42)).toBe(42);
    expect(absoluteBalance(7)).toBe(7);
  });
});
