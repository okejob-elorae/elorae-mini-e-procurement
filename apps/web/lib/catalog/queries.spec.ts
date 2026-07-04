import { describe, it, expect } from "vitest";
import { serializeCatalogItem } from "./queries";

const store = { id: "s1", termsType: "KONSI" as const, marginPercent: 20 };

describe("serializeCatalogItem", () => {
  it("maps fields, computes available and konsi gross-up price", () => {
    const row = {
      sku: "FG-RED-M",
      nameId: "Kaos Merah M",
      categoryId: "c1",
      category: { name: "Kaos" },
      sellingPrice: 10000,
      inventoryValues: [
        { qtyOnHand: 8, reservedQty: 3, totalValue: 0 },
        { qtyOnHand: 2, reservedQty: 0, totalValue: 0 },
      ],
    };
    expect(serializeCatalogItem(row, store, "https://cdn/x.jpg")).toEqual({
      sku: "FG-RED-M",
      nameId: "Kaos Merah M",
      categoryId: "c1",
      categoryName: "Kaos",
      primaryImageUrl: "https://cdn/x.jpg",
      available: 7, // (8-3) + (2-0)
      price: 12500, // 10000 / (1 - 0.20)
      priceLabel: "Retail (info)",
    });
  });

  it("null category, no image, no inventory, null price all serialize safely", () => {
    const row = {
      sku: "FG-X",
      nameId: "X",
      categoryId: null,
      category: null,
      sellingPrice: null,
      inventoryValues: [],
    };
    expect(serializeCatalogItem(row, { termsType: "PUTUS", marginPercent: null }, null)).toEqual({
      sku: "FG-X",
      nameId: "X",
      categoryId: null,
      categoryName: null,
      primaryImageUrl: null,
      available: 0,
      price: null,
      priceLabel: null,
    });
  });
});
