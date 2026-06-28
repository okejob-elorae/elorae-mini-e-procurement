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

function imageSlice(overrides: Partial<{
  id: string;
  variantSku: string | null;
  url: string;
  sortOrder: number;
  jubelioImageId: string | null;
}> = {}) {
  return {
    id: "img_1",
    variantSku: null,
    url: "https://cdn.example.com/img1.jpg",
    sortOrder: 0,
    jubelioImageId: null,
    ...overrides,
  };
}

describe("buildCreateProductRequest — images", () => {
  it("empty images → images and variation_images both empty", () => {
    const body = buildCreateProductRequest({
      item: item(),
      defaults,
      categoryJubelioId: 454,
      mappings: [],
      images: [],
    });
    expect(body.images).toEqual([]);
    expect(body.variation_images).toEqual([]);
  });

  it("product-level images only → populated images, empty variation_images", () => {
    const body = buildCreateProductRequest({
      item: item(),
      defaults,
      categoryJubelioId: 454,
      mappings: [],
      images: [
        imageSlice({ id: "img_1", url: "https://cdn.example.com/a.jpg", sortOrder: 0 }),
        imageSlice({ id: "img_2", url: "https://cdn.example.com/b.jpg", sortOrder: 1 }),
      ],
    });
    expect(body.images).toEqual([
      { url: "https://cdn.example.com/a.jpg", thumbnail: "https://cdn.example.com/a.jpg", file_name: "a", sequence_number: 0 },
      { url: "https://cdn.example.com/b.jpg", thumbnail: "https://cdn.example.com/b.jpg", file_name: "b", sequence_number: 1 },
    ]);
    expect(body.variation_images).toEqual([]);
  });

  it("variant-level images, no mappings → variation_images empty (item_ids unknown on create)", () => {
    const body = buildCreateProductRequest({
      item: item({ variants: [{ sku: "SKU-1-RED" }, { sku: "SKU-1-BLU" }] }),
      defaults,
      categoryJubelioId: 454,
      mappings: [],
      images: [
        imageSlice({ id: "img_1", variantSku: "SKU-1-RED", url: "https://cdn.example.com/red.jpg", sortOrder: 0 }),
        imageSlice({ id: "img_2", variantSku: "SKU-1-BLU", url: "https://cdn.example.com/blu.jpg", sortOrder: 0 }),
      ],
    });
    expect(body.images).toEqual([]);
    expect(body.variation_images).toEqual([]);
  });

  it("variant-level images with mappings → variation_images keyed by jubelio item_id", () => {
    const body = buildCreateProductRequest({
      item: item({ variants: [{ sku: "SKU-1-RED" }, { sku: "SKU-1-BLU" }] }),
      defaults,
      categoryJubelioId: 454,
      mappings: [
        { id: "m1", jubelioItemGroupId: 100, jubelioItemId: 1001, jubelioItemCode: "SKU-1-RED", erpVariantSku: "SKU-1-RED" },
        { id: "m2", jubelioItemGroupId: 100, jubelioItemId: 1002, jubelioItemCode: "SKU-1-BLU", erpVariantSku: "SKU-1-BLU" },
      ],
      images: [
        imageSlice({ id: "img_1", variantSku: "SKU-1-RED", url: "https://cdn.example.com/red.jpg", sortOrder: 0 }),
        imageSlice({ id: "img_2", variantSku: "SKU-1-BLU", url: "https://cdn.example.com/blu.jpg", sortOrder: 0 }),
      ],
    });
    expect(body.images).toEqual([]);
    expect(body.variation_images).toHaveLength(2);
    const red = body.variation_images.find((v: any) => v.item_id === 1001);
    expect(red).toMatchObject({
      item_id: 1001,
      images: [{ url: "https://cdn.example.com/red.jpg", thumbnail: "https://cdn.example.com/red.jpg", file_name: "red", sequence_number: 0 }],
    });
  });

  it("mixed images → product-level always populated; variant skipped until mapping exists", () => {
    const body = buildCreateProductRequest({
      item: item({ variants: [{ sku: "SKU-1-RED" }] }),
      defaults,
      categoryJubelioId: 454,
      mappings: [],
      images: [
        imageSlice({ id: "img_1", variantSku: null, url: "https://cdn.example.com/main.jpg", sortOrder: 0 }),
        imageSlice({ id: "img_2", variantSku: "SKU-1-RED", url: "https://cdn.example.com/red.jpg", sortOrder: 0 }),
      ],
    });
    expect(body.images).toHaveLength(1);
    expect(body.images[0]).toMatchObject({ url: "https://cdn.example.com/main.jpg", file_name: "main", sequence_number: 0 });
    expect(body.variation_images).toEqual([]);
  });

  it("sort order is preserved for product-level images", () => {
    const body = buildCreateProductRequest({
      item: item(),
      defaults,
      categoryJubelioId: 454,
      mappings: [],
      images: [
        imageSlice({ id: "img_b", url: "https://cdn.example.com/b.jpg", sortOrder: 2 }),
        imageSlice({ id: "img_a", url: "https://cdn.example.com/a.jpg", sortOrder: 0 }),
        imageSlice({ id: "img_c", url: "https://cdn.example.com/c.jpg", sortOrder: 1 }),
      ],
    });
    const urls = (body.images as Array<{ url: string }>).map((i) => i.url);
    expect(urls).toEqual([
      "https://cdn.example.com/a.jpg",
      "https://cdn.example.com/c.jpg",
      "https://cdn.example.com/b.jpg",
    ]);
  });

  it("use_single_image_set is false when variant images present, uses defaults value otherwise", () => {
    const withVariantImages = buildCreateProductRequest({
      item: item({ variants: [{ sku: "SKU-1-RED" }] }),
      defaults: { ...defaults, useSingleImageSet: true },
      categoryJubelioId: 454,
      mappings: [],
      images: [
        imageSlice({ id: "img_1", variantSku: "SKU-1-RED", url: "https://cdn.example.com/red.jpg", sortOrder: 0 }),
      ],
    });
    expect(withVariantImages.use_single_image_set).toBe(false);

    const withoutVariantImages = buildCreateProductRequest({
      item: item(),
      defaults: { ...defaults, useSingleImageSet: true },
      categoryJubelioId: 454,
      mappings: [],
      images: [
        imageSlice({ id: "img_1", variantSku: null, url: "https://cdn.example.com/main.jpg", sortOrder: 0 }),
      ],
    });
    expect(withoutVariantImages.use_single_image_set).toBe(true);
  });
});
