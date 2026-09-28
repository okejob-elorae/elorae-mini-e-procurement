import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    item: { findMany: vi.fn() },
    inventoryValue: { findMany: vi.fn() },
  },
}));

import { prisma } from "@elorae/db";
import {
  buildVariantRows,
  listItemVariantRows,
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

describe("listItemVariantRows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("filters items by type in the database, then pages the flattened rows", async () => {
    vi.mocked(prisma.item.findMany).mockResolvedValue([
      {
        id: "shirt",
        sku: "KMJ-01",
        nameId: "Kemeja",
        nameEn: "Shirt",
        type: "FINISHED_GOOD",
        variants: shirt.variants,
        sellingPrice: { toNumber: () => 150000 },
        uom: { code: "PCS" },
      },
      {
        id: "scarf",
        sku: "SYL-02",
        nameId: "Syal",
        nameEn: "Scarf",
        type: "FINISHED_GOOD",
        variants: null,
        sellingPrice: null,
        uom: { code: "PCS" },
      },
    ] as never);
    vi.mocked(prisma.inventoryValue.findMany).mockResolvedValue([
      { itemId: "shirt", variantSku: "KMJ-01-L", qtyOnHand: { toNumber: () => 5 }, reservedQty: 0, totalValue: 50 },
    ] as never);

    const result = await listItemVariantRows({ type: "FINISHED_GOOD" }, { page: 2, pageSize: 2 });

    const itemArgs = vi.mocked(prisma.item.findMany).mock.calls[0][0] as { where: unknown };
    expect(itemArgs.where).toEqual({ type: "FINISHED_GOOD" });
    expect(prisma.inventoryValue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { itemId: { in: ["shirt", "scarf"] } } }),
    );
    expect(result.totalCount).toBe(3);
    expect(result.rows.map((r) => r.code)).toEqual(["SYL-02"]);
  });

  it("skips the inventory query when no item matches", async () => {
    vi.mocked(prisma.item.findMany).mockResolvedValue([]);
    expect(await listItemVariantRows({}, { page: 1, pageSize: 25 })).toEqual({ rows: [], totalCount: 0 });
    expect(prisma.inventoryValue.findMany).not.toHaveBeenCalled();
  });

  it("does not push the search into the database, since variant SKUs live inside the variants JSON", async () => {
    vi.mocked(prisma.item.findMany).mockResolvedValue([]);
    await listItemVariantRows({ search: "KMJ-01-L" }, { page: 1, pageSize: 25 });
    const itemArgs = vi.mocked(prisma.item.findMany).mock.calls[0][0] as { where: Record<string, unknown> };
    expect(itemArgs.where.OR).toBeUndefined();
  });
});
