import { describe, it, expect } from "vitest";
import { buildTree } from "./queries";

const rows = [
  { id: "a", code: "1",    name: "Aset",        type: "ASET" as const, depth: 1, isActive: true,  parentId: null },
  { id: "b", code: "11",   name: "Lancar",      type: "ASET" as const, depth: 2, isActive: true,  parentId: "a" },
  { id: "c", code: "1101", name: "Kas",         type: "ASET" as const, depth: 3, isActive: true,  parentId: "b" },
  { id: "d", code: "1102", name: "Bank",        type: "ASET" as const, depth: 3, isActive: false, parentId: "b" },
  { id: "e", code: "2",    name: "Liabilitas",  type: "LIABILITAS" as const, depth: 1, isActive: true, parentId: null },
];

describe("buildTree", () => {
  it("assembles a tree from a flat list", () => {
    const tree = buildTree(rows);
    expect(tree).toHaveLength(2);
    expect(tree[0].code).toBe("1");
    expect(tree[0].children[0].code).toBe("11");
    expect(tree[0].children[0].children).toHaveLength(2);
  });
  it("marks leaf nodes as postable when active", () => {
    const tree = buildTree(rows);
    const kas = tree[0].children[0].children[0];
    expect(kas.isLeaf).toBe(true);
    expect(kas.isPostable).toBe(true);
  });
  it("marks leaf inactive nodes as non-postable", () => {
    const tree = buildTree(rows);
    const bank = tree[0].children[0].children[1];
    expect(bank.isLeaf).toBe(true);
    expect(bank.isPostable).toBe(false);
  });
  it("marks parent nodes as non-leaf and non-postable", () => {
    const tree = buildTree(rows);
    expect(tree[0].isLeaf).toBe(false);
    expect(tree[0].isPostable).toBe(false);
  });
  it("orders root nodes by code ASC", () => {
    const tree = buildTree([rows[4], rows[0]]); // reversed input
    expect(tree[0].code).toBe("1");
    expect(tree[1].code).toBe("2");
  });
});
