import { prisma, type Prisma } from '@elorae/db';
import { generateSKU } from '@/lib/sku-generator';

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
  sellingPrice?: number;
  targetMarginPercent?: number;
  additionalCost?: number;
};

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
  targetMarginPercent: number | null;
  additionalCost: number | null;
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
  if (
    p.targetMarginPercent != null &&
    (Number.isNaN(p.targetMarginPercent) || p.targetMarginPercent < 0)
  ) {
    throw new Error('targetMarginPercent: Must be 0 or greater');
  }
  if (p.additionalCost != null && (Number.isNaN(p.additionalCost) || p.additionalCost < 0)) {
    throw new Error('additionalCost: Must be 0 or greater');
  }
}

function slugVariantAttributeValue(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
}

function variantSuffixFromRecord(v: Record<string, string>): string {
  const segments = Object.entries(v)
    .filter(([key]) => key !== 'sku')
    .map(([, value]) => slugVariantAttributeValue(value))
    .filter((s) => s.length > 0);
  if (segments.length > 0) return segments.join('-');
  const legacy = v.color || v.Color || v.COLOR || v.name || v.nameId || '';
  return legacy.trim().replace(/\s+/g, '-').toUpperCase() || '';
}

function validateAndNormalizeVariants(
  parentSku: string,
  variants: Array<Record<string, string>> | undefined,
  opts?: { categoryCode?: string | null }
): Array<Record<string, string>> {
  if (!variants?.length) return [];
  const prefix = parentSku.trim();
  const cat = opts?.categoryCode?.trim() || '';
  const autoBase = cat || prefix;
  const validPrefixes: string[] = [];
  if (prefix) validPrefixes.push(prefix);
  if (cat && !validPrefixes.includes(cat)) validPrefixes.push(cat);

  const normalized = variants.map((v, idx) => {
    let sku = (v.sku ?? '').trim();
    if (sku) {
      const ok = validPrefixes.some((p) => sku.startsWith(p));
      if (!ok) {
        if (autoBase) {
          const bare = slugVariantAttributeValue(sku) || sku.replace(/\s+/g, '-').toUpperCase();
          sku = `${autoBase}-${bare}`;
        } else {
          const hint =
            cat && prefix
              ? `parent SKU "${prefix}" or category code "${cat}"`
              : prefix
                ? `parent SKU "${prefix}"`
                : cat
                  ? `category code "${cat}"`
                  : 'parent SKU';
          throw new Error(`Variant SKU "${sku}" must start with ${hint}`);
        }
      }
    }
    if (!sku) {
      const suffix = variantSuffixFromRecord(v) || `V${idx + 1}`;
      sku = autoBase ? `${autoBase}-${suffix}` : suffix;
    }
    return { ...v, sku };
  });

  const seen = new Set<string>();
  for (const row of normalized) {
    const key = row.sku.toLowerCase();
    if (seen.has(key)) {
      throw new Error(`Duplicate variant SKU "${row.sku}"`);
    }
    seen.add(key);
  }

  return normalized;
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
  const parseOptionalNonNegative = (val: unknown): number | undefined => {
    if (val === undefined || val === null || val === '') return undefined;
    const n = Number(val);
    return Number.isNaN(n) || n < 0 ? undefined : n;
  };
  const targetMarginPercentNum = parseOptionalNonNegative(raw.targetMarginPercent);
  const additionalCostNum = parseOptionalNonNegative(raw.additionalCost);
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
    targetMarginPercent: targetMarginPercentNum,
    additionalCost: additionalCostNum,
    sku: raw.sku != null ? String(raw.sku) : undefined,
  };
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
  targetMarginPercent?: unknown;
  additionalCost?: unknown;
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
    targetMarginPercent:
      item.targetMarginPercent != null ? Number(item.targetMarginPercent) : null,
    additionalCost: item.additionalCost != null ? Number(item.additionalCost) : null,
    createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
    updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : item.updatedAt,
    isActive: item.isActive,
  } as SerializedItem;
}

export async function createItem(data: ItemFormData) {
  const normalized = normalizeItemPayload(data);
  validateItemPayload(normalized);
  const { sku: inputSku, ...rest } = normalized;

  const finalSku = inputSku?.trim() || (await generateSKU(rest.type));

  const existing = await prisma.item.findUnique({ where: { sku: finalSku } });
  if (existing) {
    throw new Error('SKU already exists');
  }

  const categoryCode = await resolveCategoryCode(rest.categoryId ?? null);
  const normalizedVariants = validateAndNormalizeVariants(finalSku, rest.variants, { categoryCode });

  const item = await prisma.$transaction(async (tx) => {
    const newItem = await tx.item.create({
      data: {
        ...rest,
        sku: finalSku,
        categoryId: rest.categoryId ?? null,
        variants: normalizedVariants.length ? normalizedVariants : [],
        reorderPoint: rest.reorderPoint ?? null,
        overReceiveThreshold: rest.overReceiveThreshold ?? null,
        sellingPrice: rest.sellingPrice ?? null,
        targetMarginPercent: rest.targetMarginPercent ?? null,
        additionalCost: rest.additionalCost ?? null,
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
) {
  const client = tx;
  const normalized = normalizeItemPayload(data);
  validateItemPayload(normalized);
  const { sku, ...rest } = normalized;
  void sku;

  const existing = await client.item.findUnique({
    where: { id },
    select: {
      sku: true,
      categoryId: true,
      nameId: true,
      nameEn: true,
      description: true,
      sellingPrice: true,
      targetMarginPercent: true,
      additionalCost: true,
      variants: true,
      isActive: true,
    },
  });
  if (!existing) throw new Error('Item not found');
  const effectiveCategoryId =
    rest.categoryId !== undefined ? rest.categoryId || null : existing.categoryId;
  const categoryCode = await resolveCategoryCode(effectiveCategoryId);
  const normalizedVariants = validateAndNormalizeVariants(existing.sku, rest.variants, {
    categoryCode,
  });

  const item = await client.item.update({
    where: { id },
    data: {
      ...rest,
      categoryId: rest.categoryId ?? null,
      variants: normalizedVariants.length ? normalizedVariants : [],
      reorderPoint: rest.reorderPoint ?? null,
      overReceiveThreshold: rest.overReceiveThreshold ?? null,
      sellingPrice: rest.sellingPrice ?? null,
      targetMarginPercent: rest.targetMarginPercent ?? null,
      additionalCost: rest.additionalCost ?? null,
    },
  });

  return {
    item,
    serialized: serializeSingleItem(item),
    before: {
      nameId: existing.nameId,
      nameEn: existing.nameEn,
      description: existing.description,
      sellingPrice: existing.sellingPrice == null ? null : Number(existing.sellingPrice),
      targetMarginPercent:
        existing.targetMarginPercent == null ? null : Number(existing.targetMarginPercent),
      additionalCost: existing.additionalCost == null ? null : Number(existing.additionalCost),
      variants: (existing.variants as Array<Record<string, string>> | null) ?? null,
      isActive: existing.isActive,
    },
    after: {
      nameId: item.nameId,
      nameEn: item.nameEn,
      description: item.description,
      sellingPrice: item.sellingPrice == null ? null : Number(item.sellingPrice),
      targetMarginPercent:
        item.targetMarginPercent == null ? null : Number(item.targetMarginPercent),
      additionalCost: item.additionalCost == null ? null : Number(item.additionalCost),
      variants: (item.variants as Array<Record<string, string>> | null) ?? null,
      isActive: item.isActive,
    },
  };
}

export async function deleteItem(id: string) {
  const [movements, poItems] = await Promise.all([
    prisma.stockMovement.count({ where: { itemId: id } }),
    prisma.pOItem.count({ where: { itemId: id } }),
  ]);

  if (movements > 0 || poItems > 0) {
    throw new Error('Cannot delete item with existing transactions');
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

    await tx.item.delete({
      where: { id },
    });
  });
}
