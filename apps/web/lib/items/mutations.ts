import { prisma, type Prisma } from '@elorae/db';
import { generateSKU } from '@/lib/sku-generator';
import { unknownVariantColors, validateAndNormalizeVariants } from '@/lib/items/normalize-variants';
import { loadColorIndex } from '@/lib/items/variant-colors';
import { parseItemVariants } from "@/lib/items/variants";
import { ColorsNotInMasterError, ItemSkuExistsError } from "@/lib/items/save-refusals";
import {
  findVariantSkuCollisions,
  loadOtherItemsForCollisions,
  skusIntroducedByEdit,
  findVariantBarcodeCollisions,
  VariantBarcodeTakenError,
  VariantSkuTakenError,
} from "@/lib/items/variant-sku-collisions";
import { bacaInfoProduk, periksaInfoProduk, type InfoProdukBarang } from "./info-produk";
import { bacaKgPerRoll, periksaKgPerRoll } from "./kg-per-roll";
import { bacaKomisiPerPcs, periksaKomisiPerPcs } from "./komisi-spg";

export type ItemFormData = {
  sku?: string;
  nameId: string;
  nameEn: string;
  type: 'FABRIC' | 'ACCESSORIES' | 'FINISHED_GOOD';
  uomId: string;
  categoryId?: string;
  description?: string;
  variants?: Array<Record<string, string>>;
  reorderPoint?: number;
  overReceiveThreshold?: number;
  /** Harga jual — selalu diisi manual pemilik; sistem tidak pernah menghitungnya. */
  sellingPrice?: number;
  targetMarginPercent?: number;
  additionalCost?: number;
  /** Optional Pantone of a colour-specific material; finished goods carry colour per variant instead. */
  pantoneTcx?: string | null;
  /** Bahan bersatuan kg: kg per roll (kolom Roll di PO). `undefined` = tidak disentuh. */
  kgPerRoll?: number | null;
  /** Komisi SPG per pcs (barang jadi). `undefined` = tidak disentuh; `null`/kosong = 0. */
  commissionPerPcs?: number | null;
} & InfoProdukBarang;

export type SerializedItem = {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  type: string;
  uomId: string;
  categoryId: string | null;
  reorderPoint: number | null;
  overReceiveThreshold: number | null;
  sellingPrice: number | null;
  [k: string]: unknown;
};

const ITEM_TYPES = ['FABRIC', 'ACCESSORIES', 'FINISHED_GOOD'] as const;

function validateItemPayload(p: ReturnType<typeof normalizeItemPayload>): asserts p is ItemFormData {
  if (!p.nameId?.trim()) throw new Error('nameId: Nama item wajib diisi');
  if (!p.nameEn?.trim()) throw new Error('nameEn: Item name is required');
  if (!ITEM_TYPES.includes(p.type)) throw new Error('type: Invalid item type');
  if (!p.uomId?.trim()) throw new Error('uomId: Pilih satuan');
  if (p.categoryId != null && p.categoryId.trim() === '') throw new Error('categoryId: Invalid category');
  if (p.reorderPoint != null && (Number.isNaN(p.reorderPoint) || p.reorderPoint < 0)) {
    throw new Error('reorderPoint: Must be 0 or greater');
  }
  if (p.overReceiveThreshold != null && (Number.isNaN(p.overReceiveThreshold) || p.overReceiveThreshold < 0)) {
    throw new Error('overReceiveThreshold: Must be 0 or greater');
  }
  if (p.sellingPrice != null && (Number.isNaN(p.sellingPrice) || p.sellingPrice < 0)) {
    throw new Error('sellingPrice: Must be 0 or greater');
  }
  const infoProduk = periksaInfoProduk(p);
  if (infoProduk) throw new Error(infoProduk);
  const kgPerRoll = periksaKgPerRoll(p.kgPerRoll);
  if (kgPerRoll) throw new Error(kgPerRoll);
  const komisi = periksaKomisiPerPcs(p.commissionPerPcs ?? undefined, p.type);
  if (komisi) throw new Error(komisi);
}

/** Tabel ukuran yang dipilih harus ada (kosong = ikut bawaan kategori). */
async function pastikanTabelUkuran(client: Prisma.TransactionClient | typeof prisma, sizeChartId: string | null | undefined) {
  if (!sizeChartId) return;
  const ada = await client.sizeChart.findUnique({ where: { id: sizeChartId }, select: { id: true } });
  if (!ada) throw new Error("sizeChartId: Tabel ukuran tidak ditemukan");
}

async function resolveCategoryCode(categoryId: string | null | undefined): Promise<string | null> {
  if (!categoryId?.trim()) return null;
  const row = await prisma.itemCategory.findUnique({
    where: { id: categoryId },
    select: { code: true },
  });
  const c = row?.code?.trim();
  return c || null;
}

export function normalizeItemPayload(data: unknown): ItemFormData {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid item data');
  }
  const raw = data as Record<string, unknown>;
  const parseThresholdDefaultZero = (val: unknown): number => {
    if (val === undefined || val === null || val === '') return 0;
    const n = Number(val);
    return Number.isNaN(n) || n < 0 ? 0 : n;
  };
  const reorderPointNum = parseThresholdDefaultZero(raw.reorderPoint);
  const sellingPrice = raw.sellingPrice;
  const overReceiveThresholdNum = parseThresholdDefaultZero(raw.overReceiveThreshold);
  const categoryIdRaw = raw.categoryId;

  const sellingPriceNum =
    sellingPrice === undefined || sellingPrice === null || sellingPrice === ''
      ? undefined
      : Number(sellingPrice);
  const variants = Array.isArray(raw.variants)
    ? (raw.variants as Array<Record<string, unknown>>).map((record) => {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(record)) {
          if (typeof v === 'string') out[k] = v;
        }
        return out;
      })
    : undefined;
  return {
    nameId: String(raw.nameId ?? ''),
    nameEn: String(raw.nameEn ?? ''),
    type: raw.type as 'FABRIC' | 'ACCESSORIES' | 'FINISHED_GOOD',
    uomId: String(raw.uomId ?? ''),
    categoryId:
      categoryIdRaw === undefined || categoryIdRaw === null || String(categoryIdRaw).trim() === ''
        ? undefined
        : String(categoryIdRaw),
    description: raw.description != null ? String(raw.description) : undefined,
    variants: variants && variants.length > 0 ? variants : undefined,
    reorderPoint: reorderPointNum,
    overReceiveThreshold: overReceiveThresholdNum,
    sellingPrice:
      sellingPriceNum !== undefined && !Number.isNaN(sellingPriceNum) && sellingPriceNum >= 0
        ? sellingPriceNum
        : undefined,
    // Margin target & biaya tambahan barang tidak lagi dibaca (harga jual manual):
    // kiriman klien lama yang masih membawanya diabaikan, kolomnya tidak disentuh.
    sku: raw.sku != null ? String(raw.sku) : undefined,
    pantoneTcx:
      raw.type !== 'FINISHED_GOOD' && typeof raw.pantoneTcx === 'string' && raw.pantoneTcx.trim()
        ? raw.pantoneTcx.trim()
        : null,
    ...bacaInfoProduk(raw),
    kgPerRoll: bacaKgPerRoll(raw.kgPerRoll),
    commissionPerPcs: bacaKomisiPerPcs(raw.commissionPerPcs),
  };
}

/* relationMode = "prisma" has no FK, so an unknown TCX would be stored silently. */
async function assertPantoneExists(tcx: string | null | undefined) {
  if (!tcx) return;
  const found = await prisma.pantoneColor.findUnique({ where: { tcx }, select: { tcx: true } });
  if (!found) throw new Error(`pantoneTcx: Kode Pantone ${tcx} tidak ditemukan`);
}

function serializeSingleItem(item: {
  id: string;
  sku: string;
  nameId: string;
  nameEn: string;
  type: string;
  uomId: string;
  categoryId?: string | null;
  description?: string | null;
  variants?: unknown;
  reorderPoint?: unknown;
  overReceiveThreshold?: unknown;
  sellingPrice?: unknown;
  createdAt?: Date;
  updatedAt?: Date;
  isActive?: boolean;
  [k: string]: unknown;
}): SerializedItem {
  return {
    id: item.id,
    sku: item.sku,
    nameId: item.nameId,
    nameEn: item.nameEn,
    type: item.type,
    uomId: item.uomId,
    categoryId: item.categoryId ?? null,
    description: item.description ?? undefined,
    variants: Array.isArray(item.variants) ? item.variants : undefined,
    reorderPoint: item.reorderPoint != null ? Number(item.reorderPoint) : null,
    overReceiveThreshold:
      item.overReceiveThreshold != null ? Number(item.overReceiveThreshold) : null,
    sellingPrice: item.sellingPrice != null ? Number(item.sellingPrice) : null,
    createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
    updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : item.updatedAt,
    isActive: item.isActive,
  } as SerializedItem;
}

/** Finished-good Warna comes from the colour master; a colour already on the item is grandfathered. */
async function assertColorsInMaster(
  variants: Array<Record<string, string>>,
  existing: Array<Record<string, string>> = [],
) {
  if (variants.length === 0) return;
  const unknown = unknownVariantColors(variants, await loadColorIndex(), existing);
  if (unknown.length > 0) {
    throw new ColorsNotInMasterError(unknown);
  }
}

export async function createItem(data: ItemFormData) {
  const normalized = normalizeItemPayload(data);
  validateItemPayload(normalized);
  const { sku: inputSku, ...rest } = normalized;

  await assertPantoneExists(rest.pantoneTcx);
  const finalSku = inputSku?.trim() || (await generateSKU(rest.type));

  const existing = await prisma.item.findUnique({ where: { sku: finalSku } });
  if (existing) {
    throw new ItemSkuExistsError(finalSku);
  }

  const categoryCode = await resolveCategoryCode(rest.categoryId ?? null);
  const normalizedVariants = validateAndNormalizeVariants(finalSku, rest.variants, {
    categoryCode,
    generateFrom: "parent",
    fixedAxes: rest.type === 'FINISHED_GOOD',
  });
  if (rest.type === 'FINISHED_GOOD') await assertColorsInMaster(normalizedVariants);
  await pastikanTabelUkuran(prisma, rest.sizeChartId);

  const item = await prisma.$transaction(async (tx) => {
    const others = await loadOtherItemsForCollisions(tx);
    /* The parent SKU joins the check: one equal to another item's variant SKU shares its namespace. */
    const createCollisions = findVariantSkuCollisions(others, {
      skus: [finalSku, ...normalizedVariants.map((v) => v.sku)],
    });
    if (createCollisions.length > 0) throw new VariantSkuTakenError(createCollisions);
    const createBarcodeCollisions = findVariantBarcodeCollisions(others, {
      barcodes: normalizedVariants.map((v) => v.barcode ?? ""),
    });
    if (createBarcodeCollisions.length > 0) throw new VariantBarcodeTakenError(createBarcodeCollisions);

    const newItem = await tx.item.create({
      data: {
        ...rest,
        sku: finalSku,
        categoryId: rest.categoryId ?? null,
        variants: normalizedVariants.length ? normalizedVariants : [],
        reorderPoint: rest.reorderPoint ?? null,
        overReceiveThreshold: rest.overReceiveThreshold ?? null,
        sellingPrice: rest.sellingPrice ?? null,
        // Kolom wajib: `null` dari isian sudah menjadi 0 di `normalizeItemPayload`.
        commissionPerPcs: rest.commissionPerPcs ?? undefined,
      },
    });

    await tx.inventoryValue.create({
      data: {
        itemId: newItem.id,
        variantSku: null,
        qtyOnHand: 0,
        avgCost: 0,
        totalValue: 0,
      },
    });

    return newItem;
  });

  return { item, serialized: serializeSingleItem(item) };
}

export async function updateItem(
  tx: Prisma.TransactionClient,
  id: string,
  data: ItemFormData,
  opsi: { olehUserId?: string | null } = {},
) {
  const client = tx;
  const normalized = normalizeItemPayload(data);
  validateItemPayload(normalized);
  const { sku, ...rest } = normalized;
  void sku;
  await assertPantoneExists(rest.pantoneTcx);

  const existing = await client.item.findUnique({
    where: { id },
    select: {
      sku: true,
      categoryId: true,
      nameId: true,
      nameEn: true,
      description: true,
      sellingPrice: true,
      variants: true,
      isActive: true,
      commissionPerPcs: true,
    },
  });
  if (!existing) throw new Error('Item not found');
  const effectiveCategoryId =
    rest.categoryId !== undefined ? rest.categoryId || null : existing.categoryId;
  const categoryCode = await resolveCategoryCode(effectiveCategoryId);
  const normalizedVariants = validateAndNormalizeVariants(existing.sku, rest.variants, {
    categoryCode,
    generateFrom: "parent",
    fixedAxes: rest.type === 'FINISHED_GOOD',
  });
  if (rest.type === 'FINISHED_GOOD') {
    await assertColorsInMaster(normalizedVariants, parseItemVariants(existing.variants));
  }
  const wantedSkus = skusIntroducedByEdit(
    parseItemVariants(existing.variants).map((v) => v.sku ?? ""),
    normalizedVariants.map((v) => v.sku),
  );
  const wantedBarcodes = skusIntroducedByEdit(
    parseItemVariants(existing.variants).map((v) => v.barcode ?? ""),
    normalizedVariants.map((v) => v.barcode ?? ""),
  );
  if (wantedSkus.length > 0 || wantedBarcodes.length > 0) {
    const others = await loadOtherItemsForCollisions(client, id);
    const updateCollisions = findVariantSkuCollisions(others, { skus: wantedSkus });
    if (updateCollisions.length > 0) throw new VariantSkuTakenError(updateCollisions);
    const updateBarcodeCollisions = findVariantBarcodeCollisions(others, { barcodes: wantedBarcodes });
    if (updateBarcodeCollisions.length > 0) throw new VariantBarcodeTakenError(updateBarcodeCollisions);
  }
  await pastikanTabelUkuran(client, rest.sizeChartId);

  const item = await client.item.update({
    where: { id },
    data: {
      ...rest,
      categoryId: rest.categoryId ?? null,
      variants: normalizedVariants.length ? normalizedVariants : [],
      reorderPoint: rest.reorderPoint ?? null,
      overReceiveThreshold: rest.overReceiveThreshold ?? null,
      sellingPrice: rest.sellingPrice ?? null,
      commissionPerPcs: rest.commissionPerPcs ?? undefined,
    },
  });

  // Komisi SPG per pcs menentukan gaji orang: perubahannya tercatat di transaksi yang sama.
  const komisiLama = Number(existing.commissionPerPcs ?? 0);
  if (opsi.olehUserId && rest.commissionPerPcs != null && rest.commissionPerPcs !== komisiLama) {
    await client.auditLog.create({
      data: {
        userId: opsi.olehUserId,
        action: 'ITEM_SPG_COMMISSION_CHANGED',
        entityType: 'Item',
        entityId: id,
        changes: { before: { commissionPerPcs: komisiLama }, after: { commissionPerPcs: rest.commissionPerPcs } },
      },
    });
  }

  return {
    item,
    serialized: serializeSingleItem(item),
    before: {
      nameId: existing.nameId,
      nameEn: existing.nameEn,
      description: existing.description,
      sellingPrice: existing.sellingPrice == null ? null : Number(existing.sellingPrice),
      variants: (existing.variants as Array<Record<string, string>> | null) ?? null,
      isActive: existing.isActive,
    },
    after: {
      nameId: item.nameId,
      nameEn: item.nameEn,
      description: item.description,
      sellingPrice: item.sellingPrice == null ? null : Number(item.sellingPrice),
      variants: (item.variants as Array<Record<string, string>> | null) ?? null,
      isActive: item.isActive,
    },
  };
}

export const ITEM_DELETE_BLOCKED = "ITEM_DELETE_BLOCKED";

/**
 * Sum of every row that blocks an item delete. `ItemImage` and `ItemPriceChangeLog` cascade on
 * purpose and are reported by `getItemDeleteImpact`, not counted here; `SalesHistory` is un-mapped
 * by `deleteItem`, never a blocker.
 */
export async function countItemDeleteBlockers(id: string): Promise<number> {
  const [
    movements,
    ledgerEntryCount,
    poItems,
    workOrderFinishedGoodCount,
    workOrderConsumptionMaterialCount,
    fabricRollCount,
    stockAdjustmentCount,
    rejectedGoodsCount,
    planAccessoryCount,
    salesReturnItemCount,
    fieldReturnLineCount,
    fieldSalesOrderLineCount,
    fieldSalesDeliveryLineCount,
    promoItemCount,
    storeStockCount,
    konsiTransferLineCount,
    storeTransferLineCount,
    storeStocktakeLineCount,
    storeAssortmentLineCount,
    vanStockCount,
    vanLoadLineCount,
    vanSaleLineCount,
    vanReconcileLineCount,
    spgSaleLineCount,
    konsiSellThroughLineCount,
    itemRequestLineCount,
  ] = await Promise.all([
    /*
     * Two counts guard two different failures, not the same one twice. `StockMovement` writes
     * stopped (history now lands in `StockLedgerEntry`), but its existing rows are a frozen
     * archive, not a retired table — `StockMovement.item` is still a REQUIRED Prisma relation, so
     * an old row left pointing at a deleted item throws "Inconsistent query result" on every read
     * that joins it, forever. Stopping the writes did not make that risk go away; it only stopped
     * new rows from adding to it. `StockLedgerEntry.itemId` carries no relation at all, so an
     * orphaned ledger row cannot crash a read — but it would still silently strand real stock
     * history, which is what this second count refuses. Do not drop the `StockMovement` count
     * because the table stopped being written, and do not fold the two into one.
     */
    prisma.stockMovement.count({ where: { itemId: id } }),
    prisma.stockLedgerEntry.count({ where: { itemId: id } }),
    prisma.pOItem.count({ where: { itemId: id } }),
    prisma.workOrder.count({ where: { finishedGoodId: id } }),
    prisma.workOrder.count({ where: { consumptionMaterialId: id } }),
    prisma.fabricRoll.count({ where: { itemId: id } }),
    prisma.stockAdjustment.count({ where: { itemId: id } }),
    prisma.rejectedGoodsLedger.count({ where: { itemId: id } }),
    prisma.planAccessory.count({ where: { itemId: id } }),
    prisma.salesReturnItem.count({ where: { itemId: id } }),
    prisma.fieldReturnLine.count({ where: { itemId: id } }),
    /**
     * Every one below has a REQUIRED Prisma relation to Item. Under relationMode = "prisma" most of
     * them have no database FK, so nothing stops `tx.item.delete()` below from succeeding while one
     * of these rows still points at it, and the first read that joins it (`select: { item: ... }`,
     * as every one of these documents' detail pages does) throws "Inconsistent query result"
     * forever, with no UI repair path. The two field-sales line tables do carry a real FK
     * (`ON DELETE RESTRICT`); for them this count turns a raw FK error into ITEM_DELETE_BLOCKED.
     */
    prisma.fieldSalesOrderLine.count({ where: { itemId: id } }),
    prisma.fieldSalesDeliveryLine.count({ where: { itemId: id } }),
    prisma.promoItem.count({ where: { itemId: id } }),
    prisma.storeStock.count({ where: { itemId: id } }),
    prisma.konsiTransferLine.count({ where: { itemId: id } }),
    prisma.storeTransferLine.count({ where: { itemId: id } }),
    prisma.storeStocktakeLine.count({ where: { itemId: id } }),
    prisma.storeAssortmentLine.count({ where: { itemId: id } }),
    prisma.vanStock.count({ where: { itemId: id } }),
    prisma.vanLoadLine.count({ where: { itemId: id } }),
    prisma.vanSaleLine.count({ where: { itemId: id } }),
    prisma.vanReconcileLine.count({ where: { itemId: id } }),
    prisma.spgSaleLine.count({ where: { itemId: id } }),
    prisma.konsiSellThroughLine.count({ where: { itemId: id } }),
    // Real FK (`ON DELETE RESTRICT`), as for the field-sales lines above.
    prisma.itemRequestLine.count({ where: { itemId: id } }),
  ]);

  return (
    movements +
    ledgerEntryCount +
    poItems +
    workOrderFinishedGoodCount +
    workOrderConsumptionMaterialCount +
    fabricRollCount +
    stockAdjustmentCount +
    rejectedGoodsCount +
    planAccessoryCount +
    salesReturnItemCount +
    fieldReturnLineCount +
    fieldSalesOrderLineCount +
    fieldSalesDeliveryLineCount +
    promoItemCount +
    storeStockCount +
    konsiTransferLineCount +
    storeTransferLineCount +
    storeStocktakeLineCount +
    storeAssortmentLineCount +
    vanStockCount +
    vanLoadLineCount +
    vanSaleLineCount +
    vanReconcileLineCount +
    spgSaleLineCount +
    konsiSellThroughLineCount +
    itemRequestLineCount
  );
}

export type ItemDeleteImpact = {
  blocked: boolean;
  images: number;
  priceChanges: number;
  salesHistory: number;
};

export async function getItemDeleteImpact(id: string): Promise<ItemDeleteImpact> {
  const [blockers, images, priceChanges, salesHistory] = await Promise.all([
    countItemDeleteBlockers(id),
    prisma.itemImage.count({ where: { itemId: id } }),
    prisma.itemPriceChangeLog.count({ where: { itemId: id } }),
    prisma.salesHistory.count({ where: { itemId: id } }),
  ]);
  return { blocked: blockers > 0, images, priceChanges, salesHistory };
}

export async function deleteItem(id: string) {
  if ((await countItemDeleteBlockers(id)) > 0) {
    throw new Error(ITEM_DELETE_BLOCKED);
  }

  await prisma.$transaction(async (tx) => {
    await tx.consumptionRule.deleteMany({
      where: {
        OR: [{ finishedGoodId: id }, { materialId: id }],
      },
    });

    await tx.inventoryValue.deleteMany({
      where: { itemId: id },
    });

    /**
     * The foreign key alone would null `itemId` and leave the row claiming `MAPPED` with a stale
     * `erpVariantSku` and `jubelioItemId`; un-mapping it puts it back in the import page's
     * unmapped count. `ItemImage` and `ItemPriceChangeLog` cascade on purpose and are reported by
     * `getItemDeleteImpact`, not counted as blockers.
     */
    await tx.salesHistory.updateMany({
      where: { itemId: id },
      data: {
        itemId: null,
        erpVariantSku: null,
        jubelioItemId: null,
        resolutionStatus: "UNMAPPED",
      },
    });

    await tx.item.delete({
      where: { id },
    });
  });
}
