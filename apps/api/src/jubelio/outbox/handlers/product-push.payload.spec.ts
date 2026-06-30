import { buildCreateProductRequest } from "./product-push.payload";

const defaults = {
  sellTaxId: -1, buyTaxId: -1, salesAcctId: 28, cogsAcctId: 30, invtAcctId: 4,
  purchAcctId: null, uomId: -1, brandId: null, brandName: null,
  sellThis: true, buyThis: true, stockThis: true, dropshipThis: false, isActive: true,
  sellUnit: "Buah", buyUnit: "Buah", packageWeight: 1000,
  storePriorityQtyTreshold: 0, rop: 0,
  useSingleImageSet: false, useSerialNumber: false, buyPrice: 0,
};

function item(overrides: Partial<any> = {}) {
  return {
    id: "item_1",
    sku: "SKU-1",
    nameId: "Kemeja",
    nameEn: "Shirt",
    description: "long enough description that passes the 30-char minimum threshold",
    variants: null,
    sellingPrice: 100000,
    isActive: true,
    ...overrides,
  };
}

describe("buildCreateProductRequest", () => {
  it("creates body for variantless new product", () => {
    const body = buildCreateProductRequest({
      item: item(),
      defaults,
      categoryJubelioId: 454,
      mappings: [],
    });
    expect(body.item_group_id).toBe(0);
    expect(body.item_group_name).toBe("Shirt");
    expect(body.item_category_id).toBe(454);
    expect(body.sell_price).toBe(100000);
    expect(body.product_skus).toHaveLength(1);
    expect(body.product_skus[0]).toMatchObject({ item_id: 0, item_code: "SKU-1" });
    expect(body.sell_tax_id).toBe(-1);
    expect(body.sales_acct_id).toBe(28);
  });

  it("creates body for variants new product", () => {
    const body = buildCreateProductRequest({
      item: item({ variants: [{ sku: "SKU-1-RED" }, { sku: "SKU-1-BLU" }] }),
      defaults,
      categoryJubelioId: 454,
      mappings: [],
    });
    expect(body.product_skus).toHaveLength(2);
    expect(body.product_skus.map((s) => s.item_code)).toEqual(["SKU-1-RED", "SKU-1-BLU"]);
    expect(body.product_skus.every((s) => s.item_id === 0)).toBe(true);
  });

  it("passes variant barcodes to product_skus", () => {
    const body = buildCreateProductRequest({
      item: item({
        variants: [
          { sku: "SKU-1-RED", barcode: "0224000016T03" },
          { sku: "SKU-1-BLU", barcode: "0224000017T03" },
        ],
      }),
      defaults,
      categoryJubelioId: 454,
      mappings: [],
    });
    expect(body.product_skus[0].barcode).toBe("0224000016T03");
    expect(body.product_skus[1].barcode).toBe("0224000017T03");
  });

  it("edits an existing product (item_group_id reused, existing variants carry item_id from mappings)", () => {
    const body = buildCreateProductRequest({
      item: item({ variants: [{ sku: "SKU-1-RED" }, { sku: "SKU-1-BLU" }] }),
      defaults,
      categoryJubelioId: 454,
      mappings: [
        { id: "m1", erpVariantSku: "SKU-1-RED", jubelioItemId: 11, jubelioItemGroupId: 7, jubelioItemCode: "SKU-1-RED" },
        { id: "m2", erpVariantSku: "SKU-1-BLU", jubelioItemId: 12, jubelioItemGroupId: 7, jubelioItemCode: "SKU-1-BLU" },
      ],
    });
    expect(body.item_group_id).toBe(7);
    expect(body.product_skus.find((s) => s.item_code === "SKU-1-RED")?.item_id).toBe(11);
    expect(body.product_skus.find((s) => s.item_code === "SKU-1-BLU")?.item_id).toBe(12);
  });

  it("treats added variant as item_id=0 while keeping existing ones", () => {
    const body = buildCreateProductRequest({
      item: item({ variants: [{ sku: "SKU-1-RED" }, { sku: "SKU-1-BLU" }, { sku: "SKU-1-GRN" }] }),
      defaults,
      categoryJubelioId: 454,
      mappings: [
        { id: "m1", erpVariantSku: "SKU-1-RED", jubelioItemId: 11, jubelioItemGroupId: 7, jubelioItemCode: "SKU-1-RED" },
        { id: "m2", erpVariantSku: "SKU-1-BLU", jubelioItemId: 12, jubelioItemGroupId: 7, jubelioItemCode: "SKU-1-BLU" },
      ],
    });
    expect(body.product_skus.find((s) => s.item_code === "SKU-1-GRN")?.item_id).toBe(0);
    expect(body.product_skus.find((s) => s.item_code === "SKU-1-RED")?.item_id).toBe(11);
  });

  it("respects the variantless mapping (erpVariantSku='' carries jubelioItemId)", () => {
    const body = buildCreateProductRequest({
      item: item(),
      defaults,
      categoryJubelioId: 454,
      mappings: [
        { id: "m1", erpVariantSku: "", jubelioItemId: 99, jubelioItemGroupId: 7, jubelioItemCode: "SKU-1" },
      ],
    });
    expect(body.product_skus).toHaveLength(1);
    expect(body.product_skus[0]).toMatchObject({ item_id: 99, item_code: "SKU-1" });
  });

  it("uses brand_name from defaults when brand_id is null", () => {
    const body = buildCreateProductRequest({
      item: item(),
      defaults: { ...defaults, brandId: null, brandName: "Elorae" },
      categoryJubelioId: 454,
      mappings: [],
    });
    expect(body.brand_id).toBeNull();
    expect(body.brand_name).toBe("Elorae");
  });

  it("falls sell_price to 0 when sellingPrice null", () => {
    const body = buildCreateProductRequest({
      item: item({ sellingPrice: null }),
      defaults,
      categoryJubelioId: 454,
      mappings: [],
    });
    expect(body.sell_price).toBe(0);
  });
});
