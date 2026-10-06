'use server';

import { prisma } from '@elorae/db';
import { ItemType } from '@elorae/db';
import { itemDecimalsToNumbers } from '@/lib/items/queries';
import { parseItemVariants } from '@/lib/items/variants';
import { auth } from "@/lib/auth";
import { requirePermission, PERMISSIONS } from "@/lib/rbac";
import { muatKartuStok, type KartuStokBarang } from "@/lib/inventory/kartu-stok-queries";
import type { BarisKartuStok } from "@/lib/inventory/kartu-stok";

/**
 * Penjaga aksi baca kartu stok: butuh sesi dan `inventory:view`. Melempar
 * (seperti `requirePermission`) supaya bentuk kembalian tidak berubah; semua
 * halaman pemakainya ada di bawah /backoffice/inventory yang sudah digerbangi
 * izin yang sama oleh proxy.
 */
async function wajibBolehLihatInventori() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  requirePermission(session.user.permissions ?? [], PERMISSIONS.INVENTORY_VIEW);
}


/** Serialized item shape returned to client (no Decimal) */
export type SerializedItemForStockCard = {
  sku: string;
  nameId: string;
  nameEn?: string | null;
  reorderPoint: number | null;
  overReceiveThreshold: number | null;
  sellingPrice: number | null;
  uom?: { code: string; nameId?: string; [k: string]: unknown } | null;
  [k: string]: unknown;
};

/** Serialize Item for client (no Decimal) - same pattern as app/actions/items.ts */
function serializeItemForClient(
  item: { reorderPoint?: unknown; overReceiveThreshold?: unknown; sellingPrice?: unknown; [k: string]: unknown } | null
): SerializedItemForStockCard | null {
  if (!item) return null;
  const serialized: Record<string, unknown> = { ...item, ...itemDecimalsToNumbers(item) };
  return serialized as SerializedItemForStockCard;
}

/**
 * Kartu stok satu barang. Membaca SEMUA gerakan yang menggerakkan stok gudang
 * (StockMovement + StockAdjustment semua sumber) dan menjangkar saldo ke
 * `InventoryValue`, jadi saldo akhir = stok yang tercatat sekarang. Label jenis
 * gerakan (`jenis`) diterjemahkan di layar.
 */
export async function getStockCard(
  itemId: string,
  dateRange: { from: Date; to: Date },
  variantSku?: string
): Promise<KartuStokBarang & { item: SerializedItemForStockCard | null }> {
  await wajibBolehLihatInventori();
  const [itemRow, kartu] = await Promise.all([
    prisma.item.findUnique({ where: { id: itemId }, include: { uom: true } }),
    muatKartuStok({
      itemIds: [itemId],
      dari: dateRange.from,
      sampai: dateRange.to,
      variantSku: variantSku || undefined,
      sejakAwal: true,
    }),
  ]);
  const hasil = kartu.get(itemId) ?? {
    openingBalance: 0,
    openingValue: 0,
    closingBalance: 0,
    closingValue: 0,
    tanpaDokumen: null,
    penyesuaianTanpaVarian: 0,
    movements: [],
  };
  return { item: serializeItemForClient(itemRow), ...hasil };
}

/**
 * Pilihan varian sebuah barang: dari master (`Item.variants`, termasuk bentuk
 * teks JSON / kunci huruf besar), dari baris stok, dan dari riwayat gerakan.
 */
export async function getItemVariantOptions(itemId: string): Promise<string[]> {
  await wajibBolehLihatInventori();
  const [item, movementVariants, stokVariants] = await Promise.all([
    prisma.item.findUnique({
      where: { id: itemId },
      select: { variants: true },
    }),
    prisma.stockMovement.groupBy({
      by: ['variantSku'],
      where: { itemId, variantSku: { not: null } },
      _count: { id: true },
    }),
    prisma.inventoryValue.findMany({
      where: { itemId, variantSku: { not: null } },
      select: { variantSku: true },
    }),
  ]);
  const fromItem = parseItemVariants(item?.variants)
    .map((v) => (v?.sku != null ? String(v.sku).trim() : ''))
    .filter(Boolean);
  const lain = [...movementVariants, ...stokVariants]
    .map((g) => g.variantSku)
    .filter((s): s is string => s != null && s.trim() !== '');
  const set = new Set<string>([...fromItem, ...lain]);
  return Array.from(set).sort();
}

/** One row per item (aggregated from variant-level InventoryValue rows). */
export async function getCurrentStockSummary() {
  await wajibBolehLihatInventori();
  const rows = await prisma.inventoryValue.findMany({
    include: {
      item: {
        include: { uom: true },
      },
    },
    orderBy: { item: { nameId: 'asc' } },
  });
  const byItem = new Map<
    string,
    { qtyOnHand: number; totalValue: number; item: (typeof rows)[0]['item'] }
  >();
  for (const r of rows) {
    const qty = Number(r.qtyOnHand);
    const val = Number(r.totalValue);
    const existing = byItem.get(r.itemId);
    if (existing) {
      existing.qtyOnHand += qty;
      existing.totalValue += val;
    } else {
      byItem.set(r.itemId, {
        qtyOnHand: qty,
        totalValue: val,
        item: r.item,
      });
    }
  }
  return Array.from(byItem.entries()).map(([itemId, agg]) => ({
    itemId,
    qtyOnHand: agg.qtyOnHand,
    avgCost: agg.qtyOnHand > 0 ? agg.totalValue / agg.qtyOnHand : 0,
    totalValue: agg.totalValue,
    item: serializeItemForClient(agg.item as { reorderPoint?: unknown; [k: string]: unknown }),
  }));
}

export type StockCardByTypeItem = {
  item: SerializedItemForStockCard | null;
  openingBalance: number;
  openingValue: number;
  closingBalance: number;
  closingValue: number;
  movements: BarisKartuStok[];
};

/** Kartu stok untuk sekumpulan barang (per jenis / per kategori), sumber gerakan sama dengan kartu per barang. */
async function kartuStokBanyak(
  items: Array<{ id: string; [k: string]: unknown }>,
  dateRange: { from: Date; to: Date }
): Promise<StockCardByTypeItem[]> {
  const kartu = await muatKartuStok({
    itemIds: items.map((i) => i.id),
    dari: dateRange.from,
    sampai: dateRange.to,
  });
  return items.map((item) => {
    const k = kartu.get(item.id);
    return {
      item: serializeItemForClient(item as { reorderPoint?: unknown; [k: string]: unknown }),
      openingBalance: k?.openingBalance ?? 0,
      openingValue: k?.openingValue ?? 0,
      closingBalance: k?.closingBalance ?? 0,
      closingValue: k?.closingValue ?? 0,
      movements: k?.movements ?? [],
    };
  });
}

/** Stock card aggregated by item type: raw (FABRIC + ACCESSORIES) or finished (FINISHED_GOOD). */
export async function getStockCardByType(
  type: 'raw' | 'finished',
  dateRange: { from: Date; to: Date }
): Promise<{ items: StockCardByTypeItem[]; type: 'raw' | 'finished' }> {
  await wajibBolehLihatInventori();
  const itemTypes: ItemType[] =
    type === 'raw' ? [ItemType.FABRIC, ItemType.ACCESSORIES] : [ItemType.FINISHED_GOOD];
  const items = await prisma.item.findMany({
    where: { type: { in: itemTypes } },
    include: { uom: true },
    orderBy: { nameId: 'asc' },
  });
  if (items.length === 0) {
    return { items: [], type };
  }
  return { items: await kartuStokBanyak(items, dateRange), type };
}

/** Stock card aggregated by item category. */
export async function getStockCardByCategory(
  categoryId: string,
  dateRange: { from: Date; to: Date }
): Promise<{ items: StockCardByTypeItem[]; category: { id: string; name: string; code: string | null } }> {
  await wajibBolehLihatInventori();
  const category = await prisma.itemCategory.findUnique({
    where: { id: categoryId },
    select: { id: true, name: true, code: true },
  });
  if (!category) {
    return { items: [], category: { id: categoryId, name: '', code: null } };
  }
  const items = await prisma.item.findMany({
    where: { categoryId },
    include: { uom: true },
    orderBy: { nameId: 'asc' },
  });
  const kategori = { id: category.id, name: category.name, code: category.code };
  if (items.length === 0) {
    return { items: [], category: kategori };
  }
  return { items: await kartuStokBanyak(items, dateRange), category: kategori };
}
