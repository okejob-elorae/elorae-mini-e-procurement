'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { ItemType, Prisma } from '@prisma/client';
import { generateSKU } from '@/lib/sku-generator';
import { auth } from '@/lib/auth';
import { getActorName, notifyItemCreated } from '@/app/actions/notifications';

export { generateSKU };
import { getConsumptionRules as getConsumptionRulesFromLib, saveConsumptionRules as saveConsumptionRulesFromLib } from '@/lib/production/consumption';

/** Item form payload (kept in sync with lib/validations itemSchema; not using schema here to avoid _zod in server action bundle) */
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
};

const ITEM_TYPES = ['FABRIC', 'ACCESSORIES', 'FINISHED_GOOD'] as const;

/** Validate normalized item payload without using itemSchema (avoids _zod undefined in server action bundle) */
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
}

/** Ensure each variant has sku prefixed with parent SKU; auto-generate if missing. */
function validateAndNormalizeVariants(
  parentSku: string,
  variants: Array<Record<string, string>> | undefined
): Array<Record<string, string>> {
  if (!variants?.length) return [];
  const prefix = parentSku.trim();
  return variants.map((v, idx) => {
    let sku = (v.sku ?? '').trim();
    if (sku && !sku.startsWith(prefix)) {
      throw new Error(`Variant SKU "${sku}" must start with parent SKU "${prefix}"`);
    }
    if (!sku) {
      const suffix = (v.color || v.name || v.nameId || `V${idx + 1}`).trim().replace(/\s+/g, '-') || `V${idx + 1}`;
      sku = `${prefix}-${suffix}`;
    }
    return { ...v, sku };
  });
}

export async function createItem(data: ItemFormData) {
  const normalized = normalizeItemPayload(data);
  validateItemPayload(normalized);
  const { sku: inputSku, ...rest } = normalized;

  const finalSku = inputSku?.trim() || await generateSKU(rest.type);

  const existing = await prisma.item.findUnique({ where: { sku: finalSku } });
  if (existing) {
    throw new Error('SKU already exists');
  }

  const normalizedVariants = validateAndNormalizeVariants(finalSku, rest.variants);

  const item = await prisma.$transaction(async (tx) => {
    // Create item
    const newItem = await tx.item.create({
      data: {
        ...rest,
        sku: finalSku,
        categoryId: rest.categoryId ?? null,
        variants: normalizedVariants.length ? normalizedVariants : [],
        reorderPoint: rest.reorderPoint || null,
        overReceiveThreshold: rest.overReceiveThreshold ?? null,
        sellingPrice: rest.sellingPrice ?? null,
      }
    });
    
    // Initialize inventory value record (one row per item with variantSku null)
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

  const session = await auth();
  if (session?.user?.id) {
    const itemName = item.nameEn || item.nameId || item.sku;
    getActorName(session.user.id)
      .then((triggeredByName) => notifyItemCreated(item.id, itemName, triggeredByName))
      .catch(() => {});
  }
  
  revalidatePath('/backoffice/items');
  return serializeSingleItem(item);
}

/** Serialized item returned from createItem/updateItem (no Decimal) */
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

/** Serialize a single item from create/update so return value has no Decimal (safe for client) */
function serializeSingleItem(item: { id: string; sku: string; nameId: string; nameEn: string; type: string; uomId: string; categoryId?: string | null; description?: string | null; variants?: unknown; reorderPoint?: unknown; overReceiveThreshold?: unknown; sellingPrice?: unknown; createdAt?: Date; updatedAt?: Date; isActive?: boolean; [k: string]: unknown }): SerializedItem {
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
    overReceiveThreshold: item.overReceiveThreshold != null ? Number(item.overReceiveThreshold) : null,
    sellingPrice: item.sellingPrice != null ? Number(item.sellingPrice) : null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    isActive: item.isActive,
  } as SerializedItem;
}

/** Normalize payload from client so Zod and Prisma get plain values (avoids _zod / Decimal issues) */
function normalizeItemPayload(data: unknown): ItemFormData {
  if (!data || typeof data !== 'object') {
    throw new Error('Invalid item data');
  }
  const raw = data as Record<string, unknown>;
  const reorderPoint = raw.reorderPoint;
  const reorderPointNum =
    reorderPoint === undefined || reorderPoint === null || reorderPoint === ''
      ? undefined
      : Number(reorderPoint);
  const sellingPrice = raw.sellingPrice;
  const overReceiveThreshold = raw.overReceiveThreshold;
  const overReceiveThresholdNum =
    overReceiveThreshold === undefined || overReceiveThreshold === null || overReceiveThreshold === ''
      ? undefined
      : Number(overReceiveThreshold);
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
    reorderPoint:
      reorderPointNum !== undefined && !Number.isNaN(reorderPointNum) && reorderPointNum >= 0
        ? reorderPointNum
        : undefined,
    overReceiveThreshold:
      overReceiveThresholdNum !== undefined &&
      !Number.isNaN(overReceiveThresholdNum) &&
      overReceiveThresholdNum >= 0
        ? overReceiveThresholdNum
        : undefined,
    sellingPrice:
      sellingPriceNum !== undefined && !Number.isNaN(sellingPriceNum) && sellingPriceNum >= 0
        ? sellingPriceNum
        : undefined,
    sku: raw.sku != null ? String(raw.sku) : undefined,
  };
}

export async function updateItem(id: string, data: ItemFormData) {
  const normalized = normalizeItemPayload(data);
  validateItemPayload(normalized);
  const { sku, ...rest } = normalized;
  void sku; // omitted from update payload

  const existing = await prisma.item.findUnique({ where: { id }, select: { sku: true } });
  if (!existing) throw new Error('Item not found');
  const normalizedVariants = validateAndNormalizeVariants(existing.sku, rest.variants);

  const item = await prisma.item.update({
    where: { id },
    data: {
      ...rest,
      categoryId: rest.categoryId ?? null,
      variants: normalizedVariants.length ? normalizedVariants : [],
      reorderPoint: rest.reorderPoint ?? null,
      overReceiveThreshold: rest.overReceiveThreshold ?? null,
      sellingPrice: rest.sellingPrice ?? null,
    }
  });

  revalidatePath('/backoffice/items');
  revalidatePath(`/backoffice/items/${id}`);
  return serializeSingleItem(item);
}

export async function deleteItem(id: string) {
  // Check if item has any stock movements or PO items
  const [movements, poItems] = await Promise.all([
    prisma.stockMovement.count({ where: { itemId: id } }),
    prisma.pOItem.count({ where: { itemId: id } })
  ]);
  
  if (movements > 0 || poItems > 0) {
    throw new Error('Cannot delete item with existing transactions');
  }
  
  await prisma.$transaction(async (tx) => {
    // Delete consumption rules
    await tx.consumptionRule.deleteMany({
      where: {
        OR: [
          { finishedGoodId: id },
          { materialId: id }
        ]
      }
    });
    
    // Delete inventory value
    await tx.inventoryValue.deleteMany({
      where: { itemId: id }
    });
    
    // Delete item
    await tx.item.delete({
      where: { id }
    });
  });
  
  revalidatePath('/backoffice/items');
}

export async function getItems(
  filters?: {
    type?: ItemType | 'raw';
    categoryId?: string;
    search?: string;
    isActive?: boolean;
  },
  opts?: { page: number; pageSize: number }
) {
  const where: any = {};
  
  if (filters?.type) {
    if (filters.type === 'raw') {
      where.type = { in: ['FABRIC', 'ACCESSORIES'] };
    } else {
      where.type = filters.type;
    }
  }
  
  if (filters?.isActive !== undefined) {
    where.isActive = filters.isActive;
  }
  if (filters?.categoryId) {
    where.categoryId = filters.categoryId;
  }
  
  if (filters?.search) {
    // MySQL/MariaDB do not support mode: 'insensitive'; collation handles case.
    where.OR = [
      { sku: { contains: filters.search } },
      { nameId: { contains: filters.search } },
      { nameEn: { contains: filters.search } }
    ];
  }
  // Paginated mode: return { items, totalCount } with variants + BOM details
  if (opts?.page && opts?.pageSize) {
    const [items, totalCount] = await Promise.all([
      prisma.item.findMany({
        where,
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include: {
          uom: {
            select: {
              code: true,
              nameId: true,
              nameEn: true
            }
          },
          category: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
          inventoryValues: {
            select: {
              qtyOnHand: true,
              totalValue: true,
            },
          },
          fgConsumptions: {
            where: { isActive: true },
            include: {
              material: {
                select: {
                  sku: true,
                  nameId: true,
                  nameEn: true,
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.item.count({ where })
    ]);

    return {
      items: items.map(serializeListItemForClientWithDetails),
      totalCount,
    };
  }

  // Non-paginated mode: legacy shape for dropdowns (POForm, etc.)
  const items = await prisma.item.findMany({
    where,
    include: {
      uom: {
        select: {
          code: true,
          nameId: true,
          nameEn: true
        }
      },
      inventoryValues: {
        select: {
          qtyOnHand: true,
          totalValue: true,
        },
      },
      category: {
        select: {
          id: true,
          name: true,
          code: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' }
  });
  return items.map(serializeListItemForClient);
}

/** Counts for items mini dashboard: total, by type, active. */
export async function getItemCounts() {
  const [total, byTypeRows, activeCount] = await Promise.all([
    prisma.item.count(),
    prisma.item.groupBy({
      by: ['type'],
      _count: { id: true },
    }),
    prisma.item.count({ where: { isActive: true } }),
  ]);
  const byType: Record<ItemType, number> = {
    FABRIC: 0,
    ACCESSORIES: 0,
    FINISHED_GOOD: 0,
  };
  byTypeRows.forEach((row) => {
    if (row.type in byType) {
      byType[row.type as ItemType] = row._count.id;
    }
  });
  return { total, byType, active: activeCount };
}

const toNum = (v: unknown): number | null => (v == null ? null : Number(v));

/** Aggregate variant-level inventory rows to one item-level { qtyOnHand, avgCost, totalValue }. */
function aggregateInventoryValues(
  rows: Array<{ qtyOnHand: unknown; totalValue: unknown }> | null | undefined
): { qtyOnHand: number; avgCost: number; totalValue: number } | null {
  if (!rows?.length) return null;
  let qty = 0;
  let totalValue = 0;
  for (const r of rows) {
    qty += toNum(r.qtyOnHand) ?? 0;
    totalValue += toNum(r.totalValue) ?? 0;
  }
  return {
    qtyOnHand: qty,
    avgCost: qty > 0 ? totalValue / qty : 0,
    totalValue,
  };
}

/** Serialize a single item from findMany (list shape) for Client Components (no Decimal) */
function serializeListItemForClient(item: {
  reorderPoint?: unknown;
  overReceiveThreshold?: unknown;
  sellingPrice?: unknown;
  inventoryValues?: Array<{ qtyOnHand: unknown; totalValue: unknown; avgCost?: unknown }>;
  [k: string]: unknown;
}) {
  const inv = aggregateInventoryValues(
    item.inventoryValues as Array<{ qtyOnHand: unknown; totalValue: unknown }> | undefined
  );
  const { inventoryValues: _omit, ...rest } = item;
  void _omit;
  return {
    ...rest,
    reorderPoint: item.reorderPoint != null ? toNum(item.reorderPoint) : null,
    overReceiveThreshold:
      item.overReceiveThreshold != null ? toNum(item.overReceiveThreshold) : null,
    sellingPrice: item.sellingPrice != null ? toNum(item.sellingPrice) : null,
    inventoryValue: inv,
  };
}

/** Serialize list item when including variants and BOM (fgConsumptions) */
function serializeListItemForClientWithDetails(item: {
  reorderPoint?: unknown;
  inventoryValues?: Array<{ qtyOnHand: unknown; totalValue: unknown; avgCost?: unknown }>;
  variants?: unknown;
  fgConsumptions?: Array<{
    qtyRequired: unknown;
    wastePercent: unknown;
    material?: { sku?: string; nameId?: string; nameEn?: string } | null;
  }>;
  [k: string]: unknown;
}) {
  return {
    ...serializeListItemForClient(item),
    variants: Array.isArray(item.variants)
      ? (item.variants as Array<Record<string, string>>)
      : undefined,
    fgConsumptions: Array.isArray(item.fgConsumptions)
      ? item.fgConsumptions.map((r) => ({
          ...r,
          qtyRequired: toNum(r.qtyRequired) ?? 0,
          wastePercent: toNum(r.wastePercent) ?? 0,
          material: r.material
            ? {
                sku: r.material.sku,
                nameId: r.material.nameId,
                nameEn: r.material.nameEn,
              }
            : null,
        }))
      : undefined,
  };
}

/** Shape returned by getItemById (with include) — used so serializeItemForClient has correct types */
type ItemWithRelations = Prisma.ItemGetPayload<{
  include: {
    uom: true;
    category: true;
    inventoryValues: true;
    fgConsumptions: { include: { material: { include: { uom: true } } } };
    materialUsages: { include: { finishedGood: { include: { uom: true } } } };
  };
}>;

/** Convert Prisma result to plain object so it can be passed to Client Components (no Decimal) */
function serializeItemForClient(item: ItemWithRelations | null) {
  if (!item) return null;
  const toNum = (v: unknown): number | null => (v == null ? null : Number(v));
  const inv = aggregateInventoryValues(item.inventoryValues);
  return {
    ...item,
    reorderPoint: item.reorderPoint != null ? toNum(item.reorderPoint) : null,
    overReceiveThreshold:
      item.overReceiveThreshold != null ? toNum(item.overReceiveThreshold) : null,
    sellingPrice: item.sellingPrice != null ? toNum(item.sellingPrice) : null,
    inventoryValue: inv,
    fgConsumptions: item.fgConsumptions?.map((r) => ({
      id: r.id,
      finishedGoodId: r.finishedGoodId,
      materialId: r.materialId,
      qtyRequired: toNum(r.qtyRequired) ?? 0,
      wastePercent: toNum(r.wastePercent) ?? 0,
      isActive: r.isActive,
      notes: r.notes ?? null,
      createdAt: r.createdAt,
      material: r.material
        ? {
            id: r.material.id,
            sku: r.material.sku,
            nameId: r.material.nameId,
            nameEn: r.material.nameEn,
            reorderPoint: r.material.reorderPoint != null ? toNum(r.material.reorderPoint) : null,
            sellingPrice: r.material.sellingPrice != null ? toNum(r.material.sellingPrice) : null,
            uom: r.material.uom,
          }
        : null,
    })),
    materialUsages: item.materialUsages?.map((u) => ({
      id: u.id,
      finishedGoodId: u.finishedGoodId,
      materialId: u.materialId,
      qtyRequired: toNum(u.qtyRequired) ?? 0,
      wastePercent: toNum(u.wastePercent) ?? 0,
      isActive: u.isActive,
      notes: u.notes ?? null,
      createdAt: u.createdAt,
      finishedGood: u.finishedGood
        ? {
            id: u.finishedGood.id,
            sku: u.finishedGood.sku,
            nameId: u.finishedGood.nameId,
            nameEn: u.finishedGood.nameEn,
            reorderPoint: u.finishedGood.reorderPoint != null ? toNum(u.finishedGood.reorderPoint) : null,
            sellingPrice: u.finishedGood.sellingPrice != null ? toNum(u.finishedGood.sellingPrice) : null,
            uom: u.finishedGood.uom,
          }
        : null,
    })),
  };
}

export async function getItemById(id: string) {
  const item = await prisma.item.findUnique({
    where: { id },
    include: {
      uom: true,
      category: true,
      inventoryValues: true,
      fgConsumptions: {
        include: {
          material: {
            include: {
              uom: true
            }
          }
        }
      },
      materialUsages: {
        include: {
          finishedGood: {
            include: {
              uom: true
            }
          }
        }
      }
    }
  });
  return serializeItemForClient(item);
}

// Get items by type for dropdowns (serialized for client — no Prisma Decimal)
export async function getItemsByType(type: ItemType) {
  const rows = await prisma.item.findMany({
    where: { type, isActive: true },
    select: {
      id: true,
      sku: true,
      nameId: true,
      nameEn: true,
      uomId: true,
      uom: {
        select: {
          id: true,
          code: true
        }
      },
      inventoryValues: {
        select: {
          qtyOnHand: true,
        },
      },
    },
    orderBy: { nameId: 'asc' }
  });
  return rows.map((item) => {
    const qty = (item.inventoryValues ?? []).reduce(
      (sum, r) => sum + Number(r.qtyOnHand),
      0
    );
    return {
      id: item.id,
      sku: item.sku,
      nameId: item.nameId,
      nameEn: item.nameEn,
      uomId: item.uomId,
      uom: item.uom,
      inventoryValue: { qtyOnHand: qty },
    };
  });
}

// Get finished goods with their consumption rules
export async function getFinishedGoodsWithBOM() {
  return await prisma.item.findMany({
    where: { type: 'FINISHED_GOOD', isActive: true },
    include: {
      uom: {
        select: {
          code: true,
          nameId: true
        }
      },
      fgConsumptions: {
        where: { isActive: true },
        include: {
          material: {
            include: {
              uom: true,
              inventoryValues: {
                select: {
                  qtyOnHand: true,
                },
              },
            },
          }
        }
      }
    },
    orderBy: { nameId: 'asc' }
  });
}

// Consumption Rules (BOM) - delegate to lib/production/consumption.ts
export async function getConsumptionRules(finishedGoodId: string) {
  return getConsumptionRulesFromLib(finishedGoodId);
}

export async function saveConsumptionRules(
  finishedGoodId: string,
  rules: Array<{
    materialId: string;
    qtyRequired: number;
    wastePercent: number;
    notes?: string;
  }>
) {
  const result = await saveConsumptionRulesFromLib(finishedGoodId, rules);
  revalidatePath(`/backoffice/items/${finishedGoodId}`);
  return result;
}
