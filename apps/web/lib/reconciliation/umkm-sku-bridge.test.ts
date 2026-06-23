import { describe, expect, it } from "vitest";
import {
  allocateParentSalesToSizes,
  buildErpVariantIndex,
  excelSizeToErpVariantSku,
  extractParentFromVariantSku,
  listErpVariantsForParent,
  normalizeOtherSourceSku,
  resolveErpVariant,
} from "./umkm-sku-bridge";

describe("extractParentFromVariantSku", () => {
  it("strips size suffixes from ERP variant SKUs", () => {
    expect(extractParentFromVariantSku("27000015P-M")).toEqual({
      parent: "27000015P",
      sizeSuffix: "M",
    });
    expect(extractParentFromVariantSku("28000011B-XL")).toEqual({
      parent: "28000011B",
      sizeSuffix: "XL",
    });
    expect(extractParentFromVariantSku("24000003T")).toEqual({
      parent: "24000003T",
      sizeSuffix: null,
    });
  });
});

describe("excelSizeToErpVariantSku", () => {
  it("builds expected ERP codes from excel parent + size", () => {
    expect(excelSizeToErpVariantSku("24000003T", "S")).toBe("24000003T-S");
    expect(excelSizeToErpVariantSku("27000127P", "L")).toBe("27000127P-L");
  });
});

describe("buildErpVariantIndex", () => {
  const index = buildErpVariantIndex([
    {
      erpVariantSku: "24000001T-S",
      jubelioItemCode: "24000001T-S",
      jubelioItemId: 1,
      itemId: "item1",
      parentItemSku: "24000001",
      itemName: "Tank",
      sizeSuffix: "S",
    },
    {
      erpVariantSku: "24000001T-M",
      jubelioItemCode: "24000001T-M",
      jubelioItemId: 2,
      itemId: "item1",
      parentItemSku: "24000001",
      itemName: "Tank",
      sizeSuffix: "M",
    },
  ]);

  it("indexes by parent kode", () => {
    const hits = listErpVariantsForParent(index, "24000001T");
    expect(hits).toHaveLength(2);
    expect(resolveErpVariant(index, "24000001T", "M")?.erpVariantSku).toBe("24000001T-M");
  });
});

describe("normalizeOtherSourceSku", () => {
  const index = buildErpVariantIndex([
    {
      erpVariantSku: "27000020P-S",
      jubelioItemCode: "27000020P-S",
      jubelioItemId: 1,
      itemId: "item1",
      parentItemSku: "27000020",
      itemName: "Dress",
      sizeSuffix: "S",
    },
    {
      erpVariantSku: "23820153M-M",
      jubelioItemCode: "23820153M-M",
      jubelioItemId: 2,
      itemId: "item2",
      parentItemSku: "23820153",
      itemName: "Top",
      sizeSuffix: "M",
    },
    {
      erpVariantSku: "2000005",
      jubelioItemCode: "2000005",
      jubelioItemId: 3,
      itemId: "item3",
      parentItemSku: "2000005",
      itemName: "Accessory",
      sizeSuffix: null,
    },
  ]);

  it("maps artikel + size to ERP variant", () => {
    expect(normalizeOtherSourceSku("27000020P", "S", index)).toEqual({
      parentKode: "27000020P",
      size: "S",
      erpVariantSku: "27000020P-S",
    });
  });

  it("parses embedded size from fake-buy SKU", () => {
    expect(normalizeOtherSourceSku("23820153M", "", index)).toEqual({
      parentKode: "23820153M",
      size: "M",
      erpVariantSku: "23820153M-M",
    });
  });

  it("resolves FS for single-variant parent", () => {
    expect(normalizeOtherSourceSku("2000005", "FS", index)).toEqual({
      parentKode: "2000005",
      size: "FS",
      erpVariantSku: "2000005",
    });
  });
});

describe("allocateParentSalesToSizes", () => {
  it("splits parent sales by excel size mix", () => {
    const alloc = allocateParentSalesToSizes(100, { S: 25, M: 25, L: 25, XL: 25 });
    expect(alloc.S + alloc.M + alloc.L + alloc.XL).toBe(100);
  });

  it("returns zeros when no excel qty", () => {
    expect(allocateParentSalesToSizes(50, { S: 0, M: 0, L: 0, XL: 0 })).toEqual({
      S: 0,
      M: 0,
      L: 0,
      XL: 0,
    });
  });
});
