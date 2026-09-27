import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@elorae/db", () => ({
  prisma: {
    jubelioProductMapping: { findMany: vi.fn() },
    item: { findMany: vi.fn() },
  },
}));

import { prisma } from "@elorae/db";
import {
  getPickListLineIdentities,
  resolvePickListLineIdentity,
  type PickListItemRow,
} from "./pick-list-identity";

const shirt = {
  id: "item-shirt",
  sku: "ELR-KMJ-01",
  nameId: "Kemeja Batik",
  nameEn: "Batik Shirt",
  variants: [
    { sku: "ELR-KMJ-01-M", size: "M", color: "Merah" },
    { sku: "ELR-KMJ-01-L", size: "L", color: "Merah" },
  ],
};
const scarf = { id: "item-scarf", sku: "ELR-SYL-02", nameId: "Syal", nameEn: "Scarf", variants: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolvePickListLineIdentity", () => {
  const items = new Map<string, PickListItemRow>([
    [shirt.id, shirt],
    [scarf.id, scarf],
  ]);

  it("prints the mapped variant SKU and its attributes", () => {
    expect(
      resolvePickListLineIdentity(
        { id: "l1", jubelioItemId: 11, itemId: shirt.id },
        { jubelioItemId: 11, itemId: shirt.id, erpVariantSku: "ELR-KMJ-01-M" },
        items,
      ),
    ).toEqual({
      itemId: shirt.id,
      variantSku: "ELR-KMJ-01-M",
      code: "ELR-KMJ-01-M",
      nameId: "Kemeja Batik",
      nameEn: "Batik Shirt",
      variantDetail: "size: M · color: Merah",
    });
  });

  it("prints the item SKU for a variantless mapping", () => {
    expect(
      resolvePickListLineIdentity(
        { id: "l2", jubelioItemId: 12, itemId: scarf.id },
        { jubelioItemId: 12, itemId: scarf.id, erpVariantSku: "" },
        items,
      ),
    ).toMatchObject({ itemId: scarf.id, variantSku: null, code: "ELR-SYL-02", variantDetail: null });
  });

  it("trusts the mapping over a stale line itemId, since reservations resolve through the mapping", () => {
    expect(
      resolvePickListLineIdentity(
        { id: "l3", jubelioItemId: 11, itemId: scarf.id },
        { jubelioItemId: 11, itemId: shirt.id, erpVariantSku: "ELR-KMJ-01-L" },
        items,
      ),
    ).toMatchObject({ itemId: shirt.id, code: "ELR-KMJ-01-L" });
  });

  it("falls back to the line itemId at item level when no mapping exists", () => {
    expect(
      resolvePickListLineIdentity({ id: "l4", jubelioItemId: 99, itemId: shirt.id }, undefined, items),
    ).toMatchObject({ itemId: shirt.id, variantSku: null, code: "ELR-KMJ-01", variantDetail: null });
  });

  it("returns null for an unmapped line with no item, so the print keeps the Jubelio fields", () => {
    expect(resolvePickListLineIdentity({ id: "l5", jubelioItemId: 99, itemId: null }, undefined, items)).toBeNull();
  });

  it("returns null when the mapped item no longer exists", () => {
    expect(
      resolvePickListLineIdentity(
        { id: "l6", jubelioItemId: 13, itemId: null },
        { jubelioItemId: 13, itemId: "deleted", erpVariantSku: "X" },
        items,
      ),
    ).toBeNull();
  });
});

describe("getPickListLineIdentities", () => {
  it("skips both queries for an order with no lines", async () => {
    expect(await getPickListLineIdentities([])).toEqual({});
    expect(prisma.jubelioProductMapping.findMany).not.toHaveBeenCalled();
    expect(prisma.item.findMany).not.toHaveBeenCalled();
  });

  it("keys identities by line id and loads every item the lines or mappings name", async () => {
    vi.mocked(prisma.jubelioProductMapping.findMany).mockResolvedValue([
      { jubelioItemId: 11, itemId: shirt.id, erpVariantSku: "ELR-KMJ-01-M" },
    ] as never);
    vi.mocked(prisma.item.findMany).mockResolvedValue([shirt, scarf] as never);

    const result = await getPickListLineIdentities([
      { id: "l1", jubelioItemId: 11, itemId: null },
      { id: "l2", jubelioItemId: 12, itemId: scarf.id },
      { id: "l3", jubelioItemId: 13, itemId: null },
    ]);

    expect(prisma.jubelioProductMapping.findMany).toHaveBeenCalledWith({
      where: { jubelioItemId: { in: [11, 12, 13] } },
      select: { jubelioItemId: true, itemId: true, erpVariantSku: true },
    });
    const itemQuery = vi.mocked(prisma.item.findMany).mock.calls[0][0] as { where: { id: { in: string[] } } };
    expect([...itemQuery.where.id.in].sort()).toEqual([scarf.id, shirt.id].sort());
    expect(Object.keys(result).sort()).toEqual(["l1", "l2"]);
    expect(result.l1.code).toBe("ELR-KMJ-01-M");
    expect(result.l2.code).toBe("ELR-SYL-02");
  });
});
