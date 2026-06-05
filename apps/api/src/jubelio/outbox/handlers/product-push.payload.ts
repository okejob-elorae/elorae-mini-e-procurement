import type { JubelioProductMapping } from "@elorae/db";

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
  variants: Array<{ sku: string }> | null;
  sellingPrice: number | null;
  isActive: boolean;
};

export type MappingSlice = Pick<
  JubelioProductMapping,
  "id" | "erpVariantSku" | "jubelioItemId" | "jubelioItemGroupId"
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
}): CreateProductRequestBody {
  const { item, defaults: d, categoryJubelioId, mappings } = opts;

  const groupId = mappings[0]?.jubelioItemGroupId ?? 0;
  const sellPrice = item.sellingPrice ?? 0;
  const mappingBySku = new Map(mappings.map((m) => [m.erpVariantSku, m]));

  const hasVariants = item.variants !== null && item.variants.length > 0;
  const desiredVariants: Array<{ sku: string }> =
    hasVariants ? item.variants!.map((v) => ({ sku: v.sku })) : [{ sku: item.sku }];

  const product_skus: ProductSkuEntry[] = desiredVariants.map((v) => {
    const mappingKey = hasVariants ? v.sku : "";
    const mapping = mappingBySku.get(mappingKey);
    return {
      item_id: mapping?.jubelioItemId ?? 0,
      item_code: v.sku,
      variation_values: [],
      sell_price: sellPrice,
      buy_price: d.buyPrice,
      barcode: null,
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
    images: [],
    variation_images: [],
    variations: [],
    unlimited_stock_store_ids: null,
    sell_price: sellPrice,
    buy_price: d.buyPrice,
    brand_id: d.brandId,
    brand_name: d.brandName,
    rop: d.rop,
    use_single_image_set: d.useSingleImageSet,
    use_serial_number: d.useSerialNumber,
    product_skus,
  };
}
