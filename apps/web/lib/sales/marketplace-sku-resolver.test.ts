import { describe, expect, it } from "vitest";
import {
  buildErpVariantIndex,
  type ErpVariantRef,
} from "@/lib/reconciliation/umkm-sku-bridge";
import {
  resolutionStatusFromResolve,
  resolveMarketplaceSku,
} from "./marketplace-sku-resolver";

function ref(partial: Partial<ErpVariantRef> & Pick<ErpVariantRef, "erpVariantSku">): ErpVariantRef {
  const { parent, sizeSuffix } = {
    parent: partial.erpVariantSku.split("-")[0] ?? partial.erpVariantSku,
    sizeSuffix: partial.sizeSuffix ?? null,
  };
  return {
    jubelioItemCode: partial.jubelioItemCode ?? partial.erpVariantSku,
    jubelioItemId: partial.jubelioItemId ?? 1,
    itemId: partial.itemId ?? "item-1",
    parentItemSku: partial.parentItemSku ?? parent,
    itemName: partial.itemName ?? "Product",
    sizeSuffix: partial.sizeSuffix ?? sizeSuffix,
    erpVariantSku: partial.erpVariantSku,
  };
}

const index = buildErpVariantIndex([
  ref({
    erpVariantSku: "27000020P-S",
    jubelioItemId: 1,
    itemId: "item-dress",
    parentItemSku: "27000020",
  }),
  ref({
    erpVariantSku: "23820153M-M",
    jubelioItemId: 2,
    itemId: "item-top",
    parentItemSku: "23820153",
  }),
  ref({
    erpVariantSku: "2000005",
    jubelioItemId: 3,
    itemId: "item-acc",
    parentItemSku: "2000005",
    sizeSuffix: null,
  }),
]);

describe("resolveMarketplaceSku", () => {
  it("returns EXACT when erpVariantSku matches index", () => {
    const result = resolveMarketplaceSku({ variantSku: "27000020P-S" }, index);
    expect(result.confidence).toBe("EXACT");
    expect(result.itemId).toBe("item-dress");
    expect(result.erpVariantSku).toBe("27000020P-S");
    expect(result.jubelioItemId).toBe(1);
    expect(resolutionStatusFromResolve(result)).toBe("MAPPED");
  });

  it("returns EXACT when jubelioItemCode matches index", () => {
    const result = resolveMarketplaceSku({ variantSku: "23820153M-M" }, index);
    expect(result.confidence).toBe("EXACT");
    expect(result.itemId).toBe("item-top");
  });

  it("returns HEURISTIC via normalizeOtherSourceSku (artikel + size)", () => {
    const result = resolveMarketplaceSku(
      { variantSku: "27000020P", size: "S" },
      index
    );
    expect(result.confidence).toBe("HEURISTIC");
    expect(result.itemId).toBe("item-dress");
    expect(result.erpVariantSku).toBe("27000020P-S");
    expect(result.parentItemSku).toBe("27000020");
  });

  it("parses embedded size suffix heuristically", () => {
    const result = resolveMarketplaceSku({ variantSku: "23820153M" }, index);
    expect(result.confidence).toBe("HEURISTIC");
    expect(result.itemId).toBe("item-top");
    expect(result.erpVariantSku).toBe("23820153M-M");
  });

  it("resolves FS single-variant parent via direct sku match", () => {
    const result = resolveMarketplaceSku(
      { variantSku: "2000005", size: "FS" },
      index
    );
    expect(result.confidence).toBe("EXACT");
    expect(result.itemId).toBe("item-acc");
  });

  it("returns UNMAPPED with derived parentSku when no match", () => {
    const result = resolveMarketplaceSku(
      { variantSku: "UNKNOWN-SKU-XYZ" },
      index
    );
    expect(result.confidence).toBe("UNMAPPED");
    expect(result.itemId).toBeNull();
    expect(result.parentItemSku).toBe("UNKNOWN");
    expect(resolutionStatusFromResolve(result)).toBe("UNMAPPED");
  });
});
