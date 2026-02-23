'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { ItemType, Prisma } from '@prisma/client';
import { generateSKU } from '@/lib/sku-generator';

export { generateSKU };
import { getConsumptionRules as getConsumptionRulesFromLib, saveConsumptionRules as saveConsumptionRulesFromLib } from '@/lib/production/consumption';

/** Item form payload (kept in sync with lib/validations itemSchema; not using schema here to avoid _zod in server action bundle) */
export type ItemFormData = {
  sku?: string;
  nameId: string;
  nameEn: string;
  type: 'FABRIC' | 'ACCESSORIES' | 'FINISHED_GOOD';
  uomId: string;
  description?: string;
  variants?: Array<Record<string, string>>;
  reorderPoint?: number;
};

const ITEM_TYPES = ['FABRIC', 'ACCESSORIES', 'FINISHED_GOOD'] as const;

/** Validate normalized item payload without using itemSchema (avoids _zod undefined in server action bundle) */
function validateItemPayload(p: ReturnType<typeof normalizeItemPayload>): asserts p is ItemFormData {
  if (!p.nameId?.trim()) throw new Error('nameId: Nama item wajib diisi');
  if (!p.nameEn?.trim()) throw new Error('nameEn: Item name is required');
  if (!ITEM_TYPES.includes(p.type)) throw new Error('type: Invalid item type');
  if (!p.uomId?.trim()) throw new Error('uomId: Pilih satuan');
  if (p.reorderPoint != null && (Number.isNaN(p.reorderPoint) || p.reorderPoint < 0)) {
    throw new Error('reorderPoint: Must be 0 or greater');
  }
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

  const item = await prisma.$transaction(async (tx) => {
    // Create item
    const newItem = await tx.item.create({
      data: {
        ...rest,
        sku: finalSku,
        variants: rest.variants || [],
        reorderPoint: rest.reorderPoint || null,
      }
    });
    
    // Initialize inventory value record
    await tx.inventoryValue.create({
      data: {
        itemId: newItem.id,
        qtyOnHand: 0,
        avgCost: 0,
        totalValue: 0
      }
    });
    
    return newItem;
  });
  
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
  reorderPoint: number | null;
  [k: string]: unknown;
};

/** Serialize a single item from create/update so return value has no Decimal (safe for client) */
function serializeSingleItem(item: { id: string; sku: string; nameId: string; nameEn: string; type: string; uomId: string; description?: string | null; variants?: unknown; reorderPoint?: unknown; createdAt?: Date; updatedAt?: Date; isActive?: boolean; [k: string]: unknown }): SerializedItem {
  return {
    id: item.id,
    sku: item.sku,
    nameId: item.nameId,
    nameEn: item.nameEn,
    type: item.type,
    uomId: item.uomId,
    description: item.description ?? undefined,
    variants: Array.isArray(item.variants) ? item.variants : undefined,
    reorderPoint: item.reorderPoint != null ? Number(item.reorderPoint) : null,
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
    description: raw.description != null ? String(raw.description) : undefined,
    variants: variants && variants.length > 0 ? variants : undefined,
    reorderPoint:
      reorderPointNum !== undefined && !Number.isNaN(reorderPointNum) && reorderPointNum >= 0
        ? reorderPointNum
        : undefined,
    sku: raw.sku != null ? String(raw.sku) : undefined,
  };
}

export async function updateItem(id: string, data: ItemFormData) {
  const normalized = normalizeItemPayload(data);
  validateItemPayload(normalized);
  const { sku, ...rest } = normalized;
  void sku; // omitted from update payload

  const item = await prisma.item.update({
    where: { id },
    data: {
      ...rest,
      variants: rest.variants || [],
      reorderPoint: rest.reorderPoint ?? null,
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
  
  if (filters?.search) {
    where.OR = [
      { sku: { contains: filters.search, mode: 'insensitive' } },
      { nameId: { contains: filters.search, mode: 'insensitive' } },
      { nameEn: { contains: filters.search, mode: 'insensitive' } }
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
          inventoryValue: {
            select: {
              qtyOnHand: true,
              avgCost: true,
              totalValue: true
            }
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
      inventoryValue: {
        select: {
          qtyOnHand: true,
          avgCost: true,
          totalValue: true
        }
      }
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

/** Serialize a single item from findMany (list shape) for Client Components */
function serializeListItemForClient(item: {
  reorderPoint?: unknown;
  inventoryValue?: { qtyOnHand: unknown; avgCost: unknown; totalValue: unknown } | null;
  [k: string]: unknown;
}) {
  return {
    ...item,
    reorderPoint: item.reorderPoint != null ? toNum(item.reorderPoint) : null,
    inventoryValue: item.inventoryValue
      ? {
          ...item.inventoryValue,
          qtyOnHand: toNum(item.inventoryValue.qtyOnHand),
          avgCost: toNum(item.inventoryValue.avgCost),
          totalValue: toNum(item.inventoryValue.totalValue),
        }
      : null,
  };
}

/** Serialize list item when including variants and BOM (fgConsumptions) */
function serializeListItemForClientWithDetails(item: {
  reorderPoint?: unknown;
  inventoryValue?: { qtyOnHand: unknown; avgCost: unknown; totalValue: unknown } | null;
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
    inventoryValue: true;
    fgConsumptions: { include: { material: { include: { uom: true } } } };
    materialUsages: { include: { finishedGood: { include: { uom: true } } } };
  };
}>;

/** Convert Prisma result to plain object so it can be passed to Client Components (no Decimal) */
function serializeItemForClient(item: ItemWithRelations | null) {
  if (!item) return null;
  const toNum = (v: unknown): number | null => (v == null ? null : Number(v));
  return {
    ...item,
    reorderPoint: item.reorderPoint != null ? toNum(item.reorderPoint) : null,
    inventoryValue: item.inventoryValue
      ? {
          ...item.inventoryValue,
          qtyOnHand: toNum(item.inventoryValue.qtyOnHand),
          avgCost: toNum(item.inventoryValue.avgCost),
          totalValue: toNum(item.inventoryValue.totalValue),
        }
      : null,
    fgConsumptions: item.fgConsumptions?.map((r) => ({
      ...r,
      qtyRequired: toNum(r.qtyRequired),
      wastePercent: toNum(r.wastePercent),
      material: r.material
        ? {
            ...r.material,
            reorderPoint: r.material.reorderPoint != null ? toNum(r.material.reorderPoint) : null,
            uom: r.material.uom,
          }
        : null,
    })),
    materialUsages: item.materialUsages?.map((u) => ({
      ...u,
      finishedGood: u.finishedGood
        ? {
            ...u.finishedGood,
            reorderPoint: u.finishedGood.reorderPoint != null ? toNum(u.finishedGood.reorderPoint) : null,
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
      inventoryValue: true,
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
      inventoryValue: {
        select: {
          qtyOnHand: true
        }
      }
    },
    orderBy: { nameId: 'asc' }
  });
  return rows.map((item) => ({
    id: item.id,
    sku: item.sku,
    nameId: item.nameId,
    nameEn: item.nameEn,
    uomId: item.uomId,
    uom: item.uom,
    inventoryValue: item.inventoryValue
      ? { qtyOnHand: Number(item.inventoryValue.qtyOnHand) }
      : null,
  }));
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
              inventoryValue: {
                select: {
                  qtyOnHand: true
                }
              }
            }
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
