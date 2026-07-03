export type VariantJson = Record<string, string> & {
  sku: string;
};

export type JubelioVariationValue = {
  label: string;
  value: string;
};

export type JubelioVariantRow = {
  item_group_id: number;
  item_id: number;
  item_code: string;
  item_name?: string;
  is_bundle?: boolean;
  variation_values?: JubelioVariationValue[];
  barcode?: string | null;
  sell_price?: number;
  end_qty?: number | null;
  available_qty?: number | null;
};

export type JubelioRawImage = {
  id?: string | number;
  image_url?: string;
  sort_order?: number;
};

export type JubelioRawVariantImages = {
  item_code?: string;
  images?: JubelioRawImage[];
};

// Per `getProductResponse` from /inventory/items/group/{id} — the only Jubelio
// endpoint that exposes per-variant image arrays. Used by catalog-sync to pull
// images during ingest; the /inventory/items/ list endpoint only returns a
// single `thumbnail` per group/variant.
export type JubelioDetailImage = {
  item_id?: number;
  image_id?: number;
  cloud_key?: string;
  thumbnail?: string;
  file_name?: string;
  sequence_number?: number;
};

export type JubelioDetailProductSku = {
  item_id: number;
  item_code: string;
  images?: JubelioDetailImage[];
};

export type JubelioItemGroupDetail = {
  item_group_id: number;
  product_skus?: JubelioDetailProductSku[];
};

export type JubelioItemGroup = {
  item_group_id: number;
  item_name: string;
  item_category_id?: number;
  sell_price?: string | number;
  last_modified?: string;
  variations?: Array<{ label: string; values: string[] }>;
  variants: JubelioVariantRow[];
  images?: JubelioRawImage[];
  variation_images?: JubelioRawVariantImages[];
};

export type JubelioItemsPayload = {
  data: JubelioItemGroup[];
  totalCount?: number;
};

export type CatalogItemDraft = {
  parentSku: string;
  itemSku: string;
  nameId: string;
  nameEn: string;
  description?: string;
  sellingPrice: string | null;
  categoryId: string | null;
  jubelioItemGroupId: number;
  jubelioLastModified: Date | null;
  variants: VariantJson[];
  variantless: boolean;
  sourceVariants: Array<{
    jubelioItemId: number;
    jubelioItemCode: string;
    jubelioItemGroupId: number;
    erpVariantSku: string;
  }>;
  rawImages: JubelioRawImage[];
  rawVariantImages: JubelioRawVariantImages[];
};

export type CatalogSyncItemResult = {
  parentSku: string;
  itemSku: string;
  action: "create" | "update" | "skip";
  variantCount: number;
  variantless?: boolean;
};

export type CatalogSyncError = {
  parentSku?: string;
  jubelioItemGroupId?: number;
  message: string;
};

export type CatalogSyncSummary = {
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  warnings: string[];
};

export type CatalogSyncResult = {
  dryRun: boolean;
  summary: CatalogSyncSummary;
  items: CatalogSyncItemResult[];
  errors: CatalogSyncError[];
};

export const SYNC_FIELDS = ["nameId", "nameEn", "description", "variants", "sellingPrice"] as const;
