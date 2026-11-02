import { buildCreateProductRequest, resolvePushPrice } from "./product-push.payload";

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
    jubelioPrice: 100000,
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

  it("sends the confirmed Jubelio price on the group and every product_sku (variantless)", () => {
    const body = buildCreateProductRequest({
      item: item({ jubelioPrice: 150000 }),
      defaults,
      categoryJubelioId: 454,
      mappings: [],
    });
    expect(body.sell_price).toBe(150000);
    expect(body.product_skus.map((s) => s.sell_price)).toEqual([150000]);
  });

  it("sends the confirmed Jubelio price on the group and every product_sku (variants)", () => {
    const body = buildCreateProductRequest({
      item: item({ jubelioPrice: 150000, variants: [{ sku: "SKU-1-RED" }, { sku: "SKU-1-BLU" }, { sku: "SKU-1-GRN" }] }),
      defaults,
      categoryJubelioId: 454,
      mappings: [{ id: "m1", erpVariantSku: "SKU-1-RED", jubelioItemId: 11, jubelioItemGroupId: 7, jubelioItemCode: "SKU-1-RED" }],
    });
    expect(body.sell_price).toBe(150000);
    expect(body.product_skus.map((s) => s.sell_price)).toEqual([150000, 150000, 150000]);
  });
});

/*
 * Owner decision 2026-11-02: a product push sends only the price confirmed in the ERP, and a new
 * ERP product is created only after its price is confirmed.
 */
describe("resolvePushPrice", () => {
  const base = { mapped: true, source: "ERP" as const, jubelioConfirmedPrice: 150000, jubelioCreateRequestedAt: null };

  it("a mapped item with a confirmed price pushes that price", () => {
    expect(resolvePushPrice(base)).toEqual({ ok: true, price: 150000 });
  });

  it.each([
    ["no", null],
    ["a zero", 0],
    ["a negative", -1],
  ])("a mapped item with %s confirmed price is not pushed, and no request is stamped", (_label, confirmed) => {
    expect(resolvePushPrice({ ...base, jubelioConfirmedPrice: confirmed })).toEqual({ ok: false, stampRequest: false });
  });

  it("an unmapped ERP item whose request still waits is not created", () => {
    const requested = new Date("2026-11-02T03:00:00.000Z");
    expect(resolvePushPrice({ ...base, mapped: false, jubelioCreateRequestedAt: requested })).toEqual({ ok: false, stampRequest: false });
    expect(resolvePushPrice({ ...base, mapped: false, jubelioConfirmedPrice: null, jubelioCreateRequestedAt: requested })).toEqual({
      ok: false,
      stampRequest: false,
    });
  });

  it("an unmapped ERP item confirmed and no longer requested is created at its confirmed price", () => {
    expect(resolvePushPrice({ ...base, mapped: false })).toEqual({ ok: true, price: 150000 });
  });

  it("an unmapped ERP item with neither a confirmed price nor a request is turned into a request", () => {
    expect(resolvePushPrice({ ...base, mapped: false, jubelioConfirmedPrice: null })).toEqual({ ok: false, stampRequest: true });
  });

  it("an unmapped ingest item is never created and never stamped", () => {
    expect(resolvePushPrice({ ...base, mapped: false, source: "JUBELIO_INGEST", jubelioConfirmedPrice: null })).toEqual({
      ok: false,
      stampRequest: false,
    });
  });
});

function imageSlice(overrides: Partial<{
  id: string;
  variantSku: string | null;
  url: string;
  sortOrder: number;
  jubelioImageId: string | null;
  jubelioImageKey: string | null;
  jubelioImageThumbnail: string | null;
}> = {}) {
  const id = overrides.id ?? "img_1";
  return {
    id,
    variantSku: null,
    url: "https://cdn.example.com/img1.jpg",
    sortOrder: 0,
    jubelioImageId: null,
    jubelioImageKey: `https://j.blob/${id}.jpeg`,
    jubelioImageThumbnail: `https://j.blob/${id}_thumb.jpeg`,
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

  it("image with jubelioImageKey null is skipped (defensive filter)", () => {
    const body = buildCreateProductRequest({
      item: item(),
      defaults,
      categoryJubelioId: 454,
      mappings: [],
      images: [
        imageSlice({ id: "img_1", sortOrder: 0 }),
        imageSlice({ id: "img_2", sortOrder: 1, jubelioImageKey: null, jubelioImageThumbnail: null }),
      ],
    });
    expect(body.images).toHaveLength(1);
    expect((body.images[0] as any).url).toBe("https://j.blob/img_1.jpeg");
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
      { url: "https://j.blob/img_1.jpeg", thumbnail: "https://j.blob/img_1_thumb.jpeg", file_name: "a", sequence_number: 0 },
      { url: "https://j.blob/img_2.jpeg", thumbnail: "https://j.blob/img_2_thumb.jpeg", file_name: "b", sequence_number: 1 },
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
      images: [{ url: "https://j.blob/img_1.jpeg", thumbnail: "https://j.blob/img_1_thumb.jpeg", file_name: "red", sequence_number: 0 }],
    });
  });

  it("a mapping for a variant the item no longer has is left out of variation_images", () => {
    const body = buildCreateProductRequest({
      item: item({ variants: [{ sku: "SKU-1-RED" }] }),
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
    expect(body.item_group_id).toBe(100);
    expect(body.variation_images.map((v: any) => v.item_id)).toEqual([1001]);
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
    expect(body.images[0]).toMatchObject({ url: "https://j.blob/img_1.jpeg", file_name: "main", sequence_number: 0 });
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
      "https://j.blob/img_a.jpeg",
      "https://j.blob/img_c.jpeg",
      "https://j.blob/img_b.jpeg",
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

  it("use_single_image_set stays on when the only variant images belong to a variant the item no longer has", () => {
    const body = buildCreateProductRequest({
      item: item({ variants: [{ sku: "SKU-1-RED" }] }),
      defaults: { ...defaults, useSingleImageSet: true },
      categoryJubelioId: 454,
      mappings: [
        { id: "m1", jubelioItemGroupId: 100, jubelioItemId: 1001, jubelioItemCode: "SKU-1-RED", erpVariantSku: "SKU-1-RED" },
        { id: "m2", jubelioItemGroupId: 100, jubelioItemId: 1002, jubelioItemCode: "SKU-1-BLU", erpVariantSku: "SKU-1-BLU" },
      ],
      images: [
        imageSlice({ id: "img_1", variantSku: null, url: "https://cdn.example.com/main.jpg", sortOrder: 0 }),
        imageSlice({ id: "img_2", variantSku: "SKU-1-BLU", url: "https://cdn.example.com/blu.jpg", sortOrder: 0 }),
      ],
    });
    expect(body.variation_images).toEqual([]);
    expect(body.use_single_image_set).toBe(true);
  });
});
