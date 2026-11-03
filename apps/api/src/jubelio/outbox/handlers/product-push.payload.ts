import { hargaJubelioBerbeda, keputusanHargaBerlaku, type JubelioProductMapping } from "@elorae/db";

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
  /**
   * The price CONFIRMED for Jubelio (`Item.jubelioConfirmedPrice`), never the raw ERP selling
   * price (owner decision 2026-11-02). Non-nullable on purpose: `resolvePushPrice` refuses the
   * push before a payload is built, so 0 or null can no longer be sent.
   */
  jubelioPrice: number;
  /**
   * What Jubelio's `is_active` must say: the ERP active flag AND not "Toko offline saja"
   * (`jubelioAktifUntukKirim`). A product already in Jubelio that becomes offline-only is
   * DEACTIVATED there, never deleted (owner answer P72, 2026-11-02).
   */
  isActive: boolean;
};

/** `is_active` for Jubelio: active in the ERP and sold on the marketplace (P72). */
export function jubelioAktifUntukKirim(isActive: boolean, salesChannel: string): boolean {
  return isActive && salesChannel !== "OFFLINE";
}

/**
 * Hold the push (owner answer P75, 2026-11-02: "saya tidak setuju jika harga bisa tertimpa").
 *
 * While Jubelio shows a price other than the confirmed one and no admin decided it after that
 * reading changed, NO push may change the Jubelio price. Sending without the price is not a shape
 * `POST /inventory/catalog/` is known to accept — it is a full upsert that carries `sell_price` on
 * the group and on every SKU, and it cannot be probed without writing to Jubelio — so the whole
 * push is held instead: not the price, name, description, variants, images or active state. An
 * item never observed is not held (no warning exists for it). Same predicates as the web's
 * "Harga di Jubelio berbeda dengan ERP" (`@elorae/db` `hargaJubelioBerbeda`,
 * `keputusanHargaBerlaku`).
 */
export function tahanKarenaHargaBeda(i: {
  mapped: boolean;
  observedAt: Date | null;
  observedMax: number | null;
  observedMin: number | null;
  confirmed: number | null;
  decidedAt: Date | null;
  observedChangedAt: Date | null;
}): boolean {
  if (!i.mapped || i.observedAt == null) return false;
  if (!hargaJubelioBerbeda({ tertinggi: i.observedMax, terendah: i.observedMin, terkonfirmasi: i.confirmed })) return false;
  return !keputusanHargaBerlaku({ diputuskanPada: i.decidedAt, berubahPada: i.observedChangedAt });
}

export type PushPriceInput = {
  mapped: boolean;
  source: "ERP" | "JUBELIO_INGEST";
  jubelioConfirmedPrice: number | null;
  jubelioCreateRequestedAt: Date | null;
};

/**
 * Which price a product push may send, or why it must not run.
 *
 * - A product Jubelio already has is pushed only with a confirmed price above 0. One without (a
 *   mapped item that never had a price) is skipped instead of being sent sell_price 0 as before.
 * - A new ERP product is created only once its price is confirmed AND no create request is still
 *   waiting: confirming clears the request, so a request still set means the confirmation has not
 *   happened yet (or a newer request came after it).
 * - An unmapped ERP product with neither a confirmed price nor a request is a create push from
 *   before the confirmation step (or a retried one): `stampRequest` tells the handler to stamp the
 *   request, so the item lands on the confirmation list instead of disappearing.
 */
export function resolvePushPrice(
  input: PushPriceInput,
): { ok: true; price: number } | { ok: false; stampRequest: boolean } {
  const confirmed = input.jubelioConfirmedPrice;
  const price = confirmed != null && Number.isFinite(confirmed) && confirmed > 0 ? confirmed : null;
  if (input.mapped) return price != null ? { ok: true, price } : { ok: false, stampRequest: false };
  if (input.source !== "ERP") return { ok: false, stampRequest: false };
  if (input.jubelioCreateRequestedAt != null) return { ok: false, stampRequest: false };
  if (price == null) return { ok: false, stampRequest: true };
  return { ok: true, price };
}

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

function buildJubelioImages(
  images: ItemImageSlice[],
  mappings: MappingSlice[],
  desiredVariantSkus: ReadonlySet<string>,
): {
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

  /**
   * Only variants the item still has. A mapping for a variant being removed survives until the handler
   * deletes it, and naming its Jubelio item id here would make every retry of a half-finished removal
   * post a dead id before it could reach the DELETE.
   */
  const itemIdBySku = new Map<string, number>(
    mappings
      .filter((m) => desiredVariantSkus.has(m.erpVariantSku))
      .map((m) => [m.erpVariantSku, m.jubelioItemId]),
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
  /* The same confirmed price on the group and on every SKU: the ERP keeps one price per article. */
  const sellPrice = item.jubelioPrice;
  const mappingBySku = new Map(mappings.map((m) => [m.erpVariantSku, m]));

  const hasVariants = item.variants !== null && item.variants.length > 0;
  const desiredVariants: Array<{ sku: string; barcode?: string | null }> = hasVariants
    ? item.variants!.map((v) => ({ sku: v.sku, barcode: v.barcode }))
    : [{ sku: item.sku }];

  const currentVariantSkus = new Set(hasVariants ? desiredVariants.map((v) => v.sku) : []);
  const imageResult = buildJubelioImages(opts.images ?? [], mappings, currentVariantSkus);
  /* Only an image of a CURRENT variant counts: a dropped variant's leftover image would otherwise turn the single image set off with an empty variation_images. */
  const hasVariantImages = (opts.images ?? []).some(
    (i) => i.variantSku !== null && currentVariantSkus.has(i.variantSku),
  );

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
