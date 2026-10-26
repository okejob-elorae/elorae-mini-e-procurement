import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    item: { findMany: vi.fn() },
    inventoryValue: { findMany: vi.fn() },
  },
}));

import { prisma } from "@elorae/db";
import {
  buildVariantGroups,
  buildVariantRows,
  listItemVariantGroups,
  type VariantRowInventory,
  type VariantRowItem,
} from "./variant-rows";

function item(overrides: Partial<VariantRowItem> & { id: string; sku: string }): VariantRowItem {
  return {
    nameId: `Nama ${overrides.sku}`,
    nameEn: `Name ${overrides.sku}`,
    type: "FINISHED_GOOD",
    uomCode: "PCS",
    sellingPrice: null,
    variants: null,
    ...overrides,
  };
}

function inv(itemId: string, variantSku: string | null, qtyOnHand: number, totalValue = qtyOnHand * 10, reservedQty = 0): VariantRowInventory {
  return { itemId, variantSku, qtyOnHand, reservedQty, totalValue };
}

const shirt = item({
  id: "shirt",
  sku: "KMJ-01",
  variants: [
    { sku: "KMJ-01-M", Warna: "Merah", Ukuran: "M", barcode: "899001" },
    { sku: "KMJ-01-L", Warna: "Merah", Ukuran: "L" },
  ],
});
const scarf = item({ id: "scarf", sku: "SYL-02", type: "ACCESSORIES" });

describe("buildVariantRows", () => {
  it("gives every catalog variant its own row with its own stock, zero when it holds none", () => {
    const rows = buildVariantRows([shirt], [inv("shirt", "KMJ-01-M", 4, 40, 1)], "");
    expect(rows.map((r) => [r.code, r.qtyOnHand, r.reservedQty, r.available, r.avgCost, r.inCatalog])).toEqual([
      ["KMJ-01-M", 4, 1, 3, 10, true],
      ["KMJ-01-L", 0, 0, 0, 0, true],
    ]);
    expect(rows[0].attributes).toEqual([
      { key: "Warna", value: "Merah" },
      { key: "Ukuran", value: "M" },
    ]);
    expect(rows[0].barcode).toBe("899001");
    expect(rows[1].barcode).toBeNull();
  });

  it("folds a variantless item's null and \"\" rows into one row at the item SKU", () => {
    const rows = buildVariantRows([scarf], [inv("scarf", null, 3, 30), inv("scarf", "", 2, 40)], "");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: "SYL-02", variantSku: "", qtyOnHand: 5, totalValue: 70, avgCost: 14, inCatalog: true });
  });

  it("still lists a variantless item that has no inventory row at all", () => {
    expect(buildVariantRows([scarf], [], "")).toMatchObject([{ code: "SYL-02", qtyOnHand: 0, inCatalog: true }]);
  });

  it("surfaces stock held under a key the catalog no longer lists, so it never disappears from view", () => {
    const rows = buildVariantRows(
      [shirt],
      [inv("shirt", "KMJ-01-XL", 2), inv("shirt", null, 1), inv("shirt", "KMJ-01-S", 0)],
      "",
    );
    expect(rows.map((r) => [r.code, r.variantSku, r.qtyOnHand, r.inCatalog])).toEqual([
      ["KMJ-01-M", "KMJ-01-M", 0, true],
      ["KMJ-01-L", "KMJ-01-L", 0, true],
      ["KMJ-01", "", 1, false],
      ["KMJ-01-XL", "KMJ-01-XL", 2, false],
    ]);
  });

  it("keeps an off-catalog key that holds only value, so the variant view never loses money the product view shows", () => {
    const rows = buildVariantRows([shirt], [inv("shirt", "KMJ-01-XL", 0, 15000)], "");
    expect(rows.map((r) => [r.code, r.qtyOnHand, r.totalValue, r.inCatalog])).toContainEqual(["KMJ-01-XL", 0, 15000, false]);
  });

  it("matches inventory to its catalog variant case-insensitively, as the database's collation does", () => {
    const rows = buildVariantRows([shirt], [inv("shirt", "kmj-01-m", 4)], "");
    expect(rows.map((r) => [r.code, r.qtyOnHand, r.inCatalog])).toEqual([
      ["KMJ-01-M", 4, true],
      ["KMJ-01-L", 0, true],
    ]);
  });

  it("keeps an off-catalog key that holds only a reservation", () => {
    const rows = buildVariantRows([scarf], [inv("scarf", "SYL-02-X", 0, 0, 2)], "");
    expect(rows.map((r) => [r.code, r.reservedQty, r.inCatalog])).toEqual([
      ["SYL-02", 0, true],
      ["SYL-02-X", 2, false],
    ]);
  });

  it("sums to the product-level stock for the same item", () => {
    const rows = buildVariantRows(
      [shirt],
      [inv("shirt", "KMJ-01-M", 4), inv("shirt", "KMJ-01-L", 6), inv("shirt", "KMJ-01-XL", 1)],
      "",
    );
    expect(rows.reduce((s, r) => s + r.qtyOnHand, 0)).toBe(11);
  });

  it("de-duplicates a variant SKU listed twice in the catalog and trims it", () => {
    const dup = item({ id: "dup", sku: "D", variants: [{ sku: " D-1 " }, { sku: "D-1" }, { sku: "" }] });
    expect(buildVariantRows([dup], [inv("dup", "D-1", 3)], "").map((r) => [r.code, r.qtyOnHand])).toEqual([["D-1", 3]]);
  });

  it("matches search case-insensitively on variant SKU and barcode, returning only that variant", () => {
    expect(buildVariantRows([shirt, scarf], [], "kmj-01-l").map((r) => r.code)).toEqual(["KMJ-01-L"]);
    expect(buildVariantRows([shirt, scarf], [], "899001").map((r) => r.code)).toEqual(["KMJ-01-M"]);
  });

  it("matches search on the parent SKU or name, returning every variant of that item", () => {
    expect(buildVariantRows([shirt, scarf], [], "kmj-01").map((r) => r.code)).toEqual(["KMJ-01-M", "KMJ-01-L"]);
    expect(buildVariantRows([shirt, scarf], [], "name syl").map((r) => r.code)).toEqual(["SYL-02"]);
  });

  it("ignores inventory rows of items outside the list", () => {
    expect(buildVariantRows([scarf], [inv("shirt", "KMJ-01-M", 9)], "")).toHaveLength(1);
  });
});

describe("buildVariantGroups", () => {
  const stock = [inv("shirt", "KMJ-01-M", 4, 40, 1), inv("shirt", "KMJ-01-L", 2, 60), inv("shirt", "KMJ-01-XL", 0, 15000)];

  it("follows the input item order", () => {
    expect(buildVariantGroups([scarf, shirt], [], "").map((g) => g.itemId)).toEqual(["scarf", "shirt"]);
  });

  it("totals every row, including an off-catalog row that holds only value", () => {
    const [group] = buildVariantGroups([shirt], stock, "");
    expect(group.totals).toEqual({ qtyOnHand: 6, reservedQty: 1, available: 5, avgCost: 15100 / 6, totalValue: 15100 });
    expect(group.variantCount).toBe(3);
  });

  it("gives a zero avgCost when nothing is on hand", () => {
    const [group] = buildVariantGroups([shirt], [inv("shirt", "KMJ-01-XL", 0, 15000)], "");
    expect(group.totals).toMatchObject({ qtyOnHand: 0, avgCost: 0, totalValue: 15000 });
  });

  it("narrows rows on a variant search while the count and totals still read every row", () => {
    const unfiltered = buildVariantGroups([shirt], stock, "")[0];
    const [group] = buildVariantGroups([shirt], stock, "kmj-01-l");
    expect(group.rows.map((r) => r.code)).toEqual(["KMJ-01-L"]);
    expect(group.variantCount).toBe(3);
    expect(group.totals).toEqual(unfiltered.totals);
  });

  it("keeps every row on a parent name search", () => {
    const [group] = buildVariantGroups([shirt], stock, "name kmj");
    expect(group.rows).toHaveLength(3);
  });

  it("leaves out a product nothing in it matches", () => {
    expect(buildVariantGroups([shirt, scarf], [], "kmj-01-l").map((g) => g.itemId)).toEqual(["shirt"]);
  });

  it("flags only a single-row variantless product as variantless", () => {
    const groups = buildVariantGroups([shirt, scarf], [], "");
    expect(groups.map((g) => [g.itemId, g.variantless])).toEqual([
      ["shirt", false],
      ["scarf", true],
    ]);
  });
});

describe("listItemVariantGroups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const dbItem = (id: string, sku: string, variants: unknown) => ({
    id,
    sku,
    nameId: sku,
    nameEn: sku,
    type: "FINISHED_GOOD",
    variants,
    sellingPrice: null,
    uom: { code: "PCS" },
  });

  it("filters items by type in the database, then pages whole products", async () => {
    vi.mocked(prisma.item.findMany).mockResolvedValue([
      dbItem("A", "A", [{ sku: "A-1" }, { sku: "A-2" }, { sku: "A-3" }]),
      dbItem("B", "B", [{ sku: "B-1" }, { sku: "B-2" }]),
      dbItem("C", "C", null),
    ] as never);
    vi.mocked(prisma.inventoryValue.findMany).mockResolvedValue([]);

    const result = await listItemVariantGroups({ type: "FINISHED_GOOD" }, { page: 2, pageSize: 1 });

    const itemArgs = vi.mocked(prisma.item.findMany).mock.calls[0][0] as { where: unknown };
    expect(itemArgs.where).toEqual({ type: "FINISHED_GOOD" });
    expect(prisma.inventoryValue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { itemId: { in: ["A", "B", "C"] } } }),
    );
    expect(result.groups.map((g) => g.itemId)).toEqual(["B"]);
    expect(result.groups[0].rows).toHaveLength(2);
    expect(result.totalCount).toBe(3);
  });

  it("skips the inventory query when no item matches", async () => {
    vi.mocked(prisma.item.findMany).mockResolvedValue([]);
    expect(await listItemVariantGroups({}, { page: 1, pageSize: 25 })).toEqual({ groups: [], totalCount: 0 });
    expect(prisma.inventoryValue.findMany).not.toHaveBeenCalled();
  });

  it("does not push the search into the database, since variant SKUs live inside the variants JSON", async () => {
    vi.mocked(prisma.item.findMany).mockResolvedValue([]);
    await listItemVariantGroups({ search: "KMJ-01-L" }, { page: 1, pageSize: 25 });
    const itemArgs = vi.mocked(prisma.item.findMany).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(itemArgs.where.OR).toBeUndefined();
  });
});
