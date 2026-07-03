import type { JubelioProductMapping } from "@elorae/db";

export type ItemImageSlice = {
  id: string;
  variantSku: string | null;
  url: string;
  sortOrder: number;
  jubelioImageId: string | null;
  jubelioImageKey: string | null;
  jubelioImageThumbnail: string | null;
};

export type PushDefaultsSlice = {
  sellTaxId: number;
  buyTaxId: number;
  salesAcctId: number;
  cogsAcctId: number;
  invtAcctId: number;
  purchAcctId: number | null;
  uomId: number;
  brandId: string | null;
  brandName: string | null;
  sellThis: boolean;
  buyThis: boolean;
  stockThis: boolean;
  dropshipThis: boolean;
  isActive: boolean;
  sellUnit: string;
  buyUnit: string;
  packageWeight: number;
  storePriorityQtyTreshold: number;
  rop: number;
  useSingleImageSet: boolean;
  useSerialNumber: boolean;
  buyPrice: number;
};

export type ItemSlice = {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  description: string | null;
  variants: Array<{ sku: string; barcode?: string | null }> | null;
  sellingPrice: number | null;
  isActive: boolean;
};

export type MappingSlice = Pick<
  JubelioProductMapping,
  "id" | "erpVariantSku" | "jubelioItemId" | "jubelioItemGroupId" | "jubelioItemCode"
>;

export type ProductSkuEntry = {
  item_id: number;
  item_code: string;
  variation_values: Array<unknown>;
  sell_price: number;
  buy_price: number;
  barcode: string | null;
  is_consignment: boolean;
};

export type CreateProductRequestBody = {
  item_group_id: number;
  item_group_name: string;
  uom_id: number;
  description: string;
  sell_this: boolean;
  sell_tax_id: number;
  buy_tax_id: number;
  sales_acct_id: number;
  cogs_acct_id: number;
  invt_acct_id: number;
  buy_this: boolean;
  stock_this: boolean;
  dropship_this: boolean;
  sell_unit: string;
  buy_unit: string;
  is_active: boolean;
  purch_acct_id: number | null;
  item_category_id: number;
  store_priority_qty_treshold: number;
  package_weight: number;
  package_content: string | null;
  package_height: number | null;
  package_width: number | null;
  package_length: number | null;
  lead_time: string;
  min: number;
  max: number;
  use_batch_number: boolean;
  images: Array<unknown>;
  variation_images: Array<unknown>;
  variations: Array<unknown>;
  unlimited_stock_store_ids: Array<number> | null;
  sell_price: number;
  buy_price: number;
  brand_id: string | null;
  brand_name: string | null;
  rop: number;
  use_single_image_set: boolean;
  use_serial_number: boolean;
  product_skus: ProductSkuEntry[];
};

/**
 * Derives the `file_name` value for Jubelio's catalog image payload — strips
 * the file extension (Jubelio expects a bare name in this field).
 * Kept separate from `multipartFileName` in image-upload.service.ts, which
 * preserves the extension for the multipart upload form.
 */
function fileNameFromUrl(url: string, fallback: string): string {
  try {
    const path = new URL(url).pathname;
    const base = path.split("/").pop() ?? "";
    return base.split(".").shift() || fallback;
  } catch {
    return fallback;
  }
}

type JubelioImage = { url: string; thumbnail: string; file_name: string; sequence_number: number };

function buildJubelioImages(images: ItemImageSlice[], mappings: MappingSlice[]): {
  images: JubelioImage[];
  variation_images: Array<{ item_id: number; images: JubelioImage[] }>;
} {
  const toJubelio = (i: ItemImageSlice): JubelioImage | null => {
    if (!i.jubelioImageKey || !i.jubelioImageThumbnail) return null;
    return {
      url: i.jubelioImageKey,
      thumbnail: i.jubelioImageThumbnail,
      file_name: fileNameFromUrl(i.url, i.id),
      sequence_number: i.sortOrder,
    };
  };

  const productLevel = images
    .filter((i) => i.variantSku === null)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(toJubelio)
    .filter((x): x is JubelioImage => x !== null);

  const itemIdBySku = new Map<string, number>(
    mappings.map((m) => [m.erpVariantSku, m.jubelioItemId]),
  );
  const byItemId = new Map<number, ItemImageSlice[]>();
  for (const i of images) {
    if (!i.variantSku) continue;
    const jubelioItemId = itemIdBySku.get(i.variantSku);
    if (!jubelioItemId) continue;
    const arr = byItemId.get(jubelioItemId) ?? [];
    arr.push(i);
    byItemId.set(jubelioItemId, arr);
  }

  const variation_images = Array.from(byItemId.entries()).map(([item_id, rows]) => ({
    item_id,
    images: rows
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(toJubelio)
      .filter((x): x is JubelioImage => x !== null),
  }));

  return { images: productLevel, variation_images };
}

const MIN_DESCRIPTION_LEN = 30;

function padDescription(input: string | null): string {
  const base = (input ?? "").trim();
  if (base.length >= MIN_DESCRIPTION_LEN) return base;
  return base.padEnd(MIN_DESCRIPTION_LEN, ".");
}

export function buildCreateProductRequest(opts: {
  item: ItemSlice;
  defaults: PushDefaultsSlice;
  categoryJubelioId: number;
  mappings: MappingSlice[];
  images?: ItemImageSlice[];
}): CreateProductRequestBody {
  const { item, defaults: d, categoryJubelioId, mappings } = opts;

  const groupId = mappings[0]?.jubelioItemGroupId ?? 0;
  const sellPrice = item.sellingPrice ?? 0;
  const mappingBySku = new Map(mappings.map((m) => [m.erpVariantSku, m]));

  const imageResult = buildJubelioImages(opts.images ?? [], mappings);
  const hasVariantImages = (opts.images ?? []).some((i) => i.variantSku !== null);

  const hasVariants = item.variants !== null && item.variants.length > 0;
  const desiredVariants: Array<{ sku: string; barcode?: string | null }> = hasVariants
    ? item.variants!.map((v) => ({ sku: v.sku, barcode: v.barcode }))
    : [{ sku: item.sku }];

  const product_skus: ProductSkuEntry[] = desiredVariants.map((v) => {
    const mappingKey = hasVariants ? v.sku : "";
    const mapping = mappingBySku.get(mappingKey);
    const barcode = v.barcode?.trim() || null;
    return {
      item_id: mapping?.jubelioItemId ?? 0,
      item_code: v.sku,
      variation_values: [],
      sell_price: sellPrice,
      buy_price: d.buyPrice,
      barcode,
      is_consignment: false,
    };
  });

  return {
    item_group_id: groupId,
    item_group_name: item.nameEn || item.nameId || item.sku,
    uom_id: d.uomId,
    description: padDescription(item.description),
    sell_this: d.sellThis,
    sell_tax_id: d.sellTaxId,
    buy_tax_id: d.buyTaxId,
    sales_acct_id: d.salesAcctId,
    cogs_acct_id: d.cogsAcctId,
    invt_acct_id: d.invtAcctId,
    buy_this: d.buyThis,
    stock_this: d.stockThis,
    dropship_this: d.dropshipThis,
    sell_unit: d.sellUnit,
    buy_unit: d.buyUnit,
    is_active: item.isActive,
    purch_acct_id: d.purchAcctId,
    item_category_id: categoryJubelioId,
    store_priority_qty_treshold: d.storePriorityQtyTreshold,
    package_weight: d.packageWeight,
    package_content: null,
    package_height: null,
    package_width: null,
    package_length: null,
    lead_time: "0",
    min: 0,
    max: 0,
    use_batch_number: false,
    images: imageResult.images,
    variation_images: imageResult.variation_images,
    variations: [],
    unlimited_stock_store_ids: null,
    sell_price: sellPrice,
    buy_price: d.buyPrice,
    brand_id: d.brandId,
    brand_name: d.brandName,
    rop: d.rop,
    use_single_image_set: hasVariantImages ? false : d.useSingleImageSet,
    use_serial_number: d.useSerialNumber,
    product_skus,
  };
}
