import { prisma } from '@elorae/db';
import { cariTeks } from "@/lib/db/cari-teks";
import { ItemType, Prisma } from '@elorae/db';
import { itemHasSkuVariants } from '@/lib/items/variants';

export type ListItemsFilters = {
  type?: ItemType | 'raw';
  categoryId?: string;
  search?: string;
  isActive?: boolean;
};

export type ListItemsOpts = {
  page: number;
  pageSize: number;
};

const toNum = (v: unknown): number | null => {
  if (v == null) return null;
  if (
    typeof v === 'object' &&
    'toNumber' in v &&
    typeof (v as { toNumber: unknown }).toNumber === 'function'
  ) {
    return (v as { toNumber: () => number }).toNumber();
  }
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

/** Aggregate variant-level inventory rows to one item-level { qtyOnHand, reservedQty, available, avgCost, totalValue }. */
export function aggregateInventoryValues(
  rows: Array<{ qtyOnHand: unknown; totalValue: unknown; reservedQty?: unknown }> | null | undefined
): { qtyOnHand: number; reservedQty: number; available: number; avgCost: number; totalValue: number } | null {
  if (!rows?.length) return null;
  let qty = 0;
  let reserved = 0;
  let totalValue = 0;
  for (const r of rows) {
    qty += toNum(r.qtyOnHand) ?? 0;
    reserved += toNum(r.reservedQty) ?? 0;
    totalValue += toNum(r.totalValue) ?? 0;
  }
  return {
    qtyOnHand: qty,
    reservedQty: reserved,
    available: qty - reserved,
    avgCost: qty > 0 ? totalValue / qty : 0,
    totalValue,
  };
}

export function buildItemsWhere(filters?: ListItemsFilters): Prisma.ItemWhereInput {
  const where: Prisma.ItemWhereInput = {};

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
    where.OR = [
      { sku: cariTeks(filters.search) },
      { nameId: cariTeks(filters.search) },
      { nameEn: cariTeks(filters.search) },
    ];
  }

  return where;
}

/**
 * Kolom `Decimal` milik Item, dalam SATU daftar.
 *
 * Serializer di bawah menyebar sisanya dengan `...rest`, jadi kolom Decimal
 * yang tidak disebut di sini LOLOS MENTAH ke komponen klien dan React menolak
 * seluruh halamannya — "Decimal objects are not supported". Itu persis yang
 * terjadi saat `commissionPerPcs` ditambahkan untuk komisi konsinyasi:
 * type-check lolos, lint lolos, dan halamannya baru pecah saat dibuka.
 *
 * Ada tesnya (`serialize.test.ts`) yang membaca daftar kolom Decimal langsung
 * dari skema Prisma dan gagal kalau ada yang tidak ada di sini — jadi kolom
 * Decimal berikutnya tidak bisa lolos diam-diam lagi.
 */
export const KOLOM_DECIMAL_ITEM = [
  'reorderPoint',
  'overReceiveThreshold',
  'sellingPrice',
  'targetMarginPercent',
  'additionalCost',
  'commissionPerPcs',
  'kgPerRoll',
] as const;

/**
 * Every Decimal column of an Item as a plain number (null stays null).
 *
 * Every serializer that spreads an Item into a client payload uses this, so a
 * new Decimal column only needs adding to `KOLOM_DECIMAL_ITEM`. The inventory
 * page's two local serializers each converted only three of them and let
 * `commissionPerPcs` through raw.
 */
export function itemDecimalsToNumbers(
  item: Record<string, unknown>,
): Record<(typeof KOLOM_DECIMAL_ITEM)[number], number | null> {
  const angka = {} as Record<(typeof KOLOM_DECIMAL_ITEM)[number], number | null>;
  for (const k of KOLOM_DECIMAL_ITEM) {
    const v = item[k];
    angka[k] = v != null ? toNum(v) : null;
  }
  return angka;
}

function serializeListItemForClient(item: {
  reorderPoint?: unknown;
  overReceiveThreshold?: unknown;
  sellingPrice?: unknown;
  targetMarginPercent?: unknown;
  additionalCost?: unknown;
  inventoryValues?: Array<{ qtyOnHand: unknown; reservedQty?: unknown; totalValue: unknown; avgCost?: unknown }>;
  [k: string]: unknown;
}) {
  const inv = aggregateInventoryValues(
    item.inventoryValues as Array<{ qtyOnHand: unknown; reservedQty?: unknown; totalValue: unknown }> | undefined
  );
  const { inventoryValues: _omit, fgConsumptions: _omitFg, ...rest } = item;
  void _omit;
  void _omitFg;
  return {
    ...rest,
    ...itemDecimalsToNumbers(item),
    inventoryValue: inv,
  };
}

function serializeListItemForClientWithDetails(item: {
  reorderPoint?: unknown;
  inventoryValues?: Array<{ qtyOnHand: unknown; reservedQty?: unknown; totalValue: unknown; avgCost?: unknown }>;
  variants?: unknown;
  fgConsumptions?: Array<{
    qtyRequired: unknown;
    wastePercent: unknown;
    size?: string | null;
    color?: { name: string } | null;
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
          qtyRequired: toNum(r.qtyRequired) ?? 0,
          wastePercent: toNum(r.wastePercent) ?? 0,
          scope: [r.color?.name, r.size].filter(Boolean).join(' · ') || null,
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

type ItemWithRelations = Prisma.ItemGetPayload<{
  include: {
    uom: true;
    category: true;
    inventoryValues: true;
    fgConsumptions: { include: { material: { include: { uom: true } } } };
    materialUsages: { include: { finishedGood: { include: { uom: true } } } };
    pantone: { select: { tcx: true; name: true; hex: true } };
  };
}>;

export function serializeItemForClient(item: ItemWithRelations | null) {
  if (!item) return null;
  const inv = aggregateInventoryValues(item.inventoryValues);
  const { inventoryValues: _omitInv, ...itemRest } = item;
  void _omitInv;
  /* Dari daftar yang sama dengan serializer di atas — dua salinan akan
     menyimpang, dan yang menyimpang adalah yang lupa kolom baru. */
  const angka: Record<string, number | null> = {};
  for (const k of KOLOM_DECIMAL_ITEM) {
    const v = (item as unknown as Record<string, unknown>)[k];
    angka[k] = v != null ? toNum(v) : null;
  }
  return {
    ...itemRest,
    ...angka,
    inventoryValue: inv,
    createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
    updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : item.updatedAt,
    fgConsumptions: item.fgConsumptions?.map((r) => ({
      id: r.id,
      finishedGoodId: r.finishedGoodId,
      materialId: r.materialId,
      qtyRequired: toNum(r.qtyRequired) ?? 0,
      wastePercent: toNum(r.wastePercent) ?? 0,
      isActive: r.isActive,
      notes: r.notes ?? null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
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
      createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : u.createdAt,
      finishedGood: u.finishedGood
        ? {
            id: u.finishedGood.id,
            sku: u.finishedGood.sku,
            nameId: u.finishedGood.nameId,
            nameEn: u.finishedGood.nameEn,
            reorderPoint:
              u.finishedGood.reorderPoint != null ? toNum(u.finishedGood.reorderPoint) : null,
            sellingPrice:
              u.finishedGood.sellingPrice != null ? toNum(u.finishedGood.sellingPrice) : null,
            uom: u.finishedGood.uom,
          }
        : null,
    })),
  };
}

export async function listItems(
  filters?: ListItemsFilters,
  opts?: ListItemsOpts
) {
  const where = buildItemsWhere(filters);

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
              nameEn: true,
            },
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
              reservedQty: true,
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
                },
              },
              color: { select: { name: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.item.count({ where }),
    ]);

    return {
      items: items.map(serializeListItemForClientWithDetails),
      totalCount,
    };
  }

  const items = await prisma.item.findMany({
    where,
    include: {
      uom: {
        select: {
          code: true,
          nameId: true,
          nameEn: true,
        },
      },
      inventoryValues: {
        select: {
          qtyOnHand: true,
          reservedQty: true,
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
    orderBy: { createdAt: 'desc' },
  });
  return items.map(serializeListItemForClient);
}

/** Offline / API sync shape */
export async function listItemsForSync(filters?: {
  type?: string;
  isActive?: boolean;
  search?: string;
}) {
  const where: Prisma.ItemWhereInput = {};
  if (filters?.type) where.type = filters.type as ItemType;
  if (filters?.isActive !== undefined) where.isActive = filters.isActive;
  if (filters?.search) {
    where.OR = [
      { sku: cariTeks(filters.search) },
      { nameId: cariTeks(filters.search) },
      { nameEn: cariTeks(filters.search) },
    ];
  }

  const items = await prisma.item.findMany({
    where,
    include: {
      uom: { select: { id: true, code: true, nameId: true, nameEn: true } },
      inventoryValues: {
        select: { qtyOnHand: true, totalValue: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return items;
}

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
              uom: true,
            },
          },
        },
      },
      materialUsages: {
        include: {
          finishedGood: {
            include: {
              uom: true,
            },
          },
        },
      },
      pantone: { select: { tcx: true, name: true, hex: true } },
    },
  });
  return serializeItemForClient(item);
}

export async function getItemsByType(type: ItemType) {
  const rows = await prisma.item.findMany({
    where: { type, isActive: true },
    select: {
      id: true,
      sku: true,
      nameId: true,
      nameEn: true,
      uomId: true,
      variants: true,
      uom: {
        select: {
          id: true,
          code: true,
        },
      },
      inventoryValues: {
        select: {
          qtyOnHand: true,
        },
      },
    },
    orderBy: { nameId: 'asc' },
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
      hasSkuVariants: itemHasSkuVariants(item.variants),
    };
  });
}

export async function getFinishedGoodsWithBOM() {
  return prisma.item.findMany({
    where: { type: 'FINISHED_GOOD', isActive: true },
    include: {
      uom: {
        select: {
          code: true,
          nameId: true,
        },
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
          },
        },
      },
    },
    orderBy: { nameId: 'asc' },
  });
}
