import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuth, mockItemFindUnique, mockInventoryFindMany } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockItemFindUnique: vi.fn(),
  mockInventoryFindMany: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ auth: mockAuth }));
vi.mock("@elorae/db", () => ({
  prisma: {
    item: { findUnique: mockItemFindUnique },
    inventoryValue: { findMany: mockInventoryFindMany },
  },
  ItemType: {},
  Prisma: {},
}));

import { getFinishedGoodVariantStock } from "./work-order-variant-stock";

describe("getFinishedGoodVariantStock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockItemFindUnique.mockResolvedValue({
      id: "item-1",
      sku: "FG-1",
      nameId: "Kaos",
      nameEn: "Tee",
      type: "FINISHED_GOOD",
      variants: [
        { sku: "S-RED", size: "S" },
        { sku: "M-RED", size: "M" },
      ],
      sellingPrice: null,
      uom: { code: "PCS" },
    });
    mockInventoryFindMany.mockResolvedValue([
      { itemId: "item-1", variantSku: "s-RED", qtyOnHand: "20", reservedQty: "8", totalValue: "0" },
    ]);
  });

  it("refuses without a session", async () => {
    mockAuth.mockResolvedValue(null);
    await expect(getFinishedGoodVariantStock("item-1")).rejects.toThrow("Unauthorized");
    expect(mockItemFindUnique).not.toHaveBeenCalled();
  });

  it("refuses a session without work order create or manage", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["work_orders:view"] } });
    await expect(getFinishedGoodVariantStock("item-1")).rejects.toThrow("Forbidden");
    expect(mockItemFindUnique).not.toHaveBeenCalled();
  });

  it("returns the record keyed by catalog spelling for a work_orders:create holder", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["work_orders:create"] } });
    const out = await getFinishedGoodVariantStock("item-1");
    expect(out).toEqual({
      "S-RED": { onHand: 20, available: 12 },
      "M-RED": { onHand: 0, available: 0 },
    });
  });

  it("returns an empty record for an unknown item", async () => {
    mockAuth.mockResolvedValue({ user: { id: "u1", permissions: ["*"] } });
    mockItemFindUnique.mockResolvedValue(null);
    expect(await getFinishedGoodVariantStock("nope")).toEqual({});
  });
});
