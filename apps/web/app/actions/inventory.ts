'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { prisma } from '@elorae/db';
import type { Prisma } from '@elorae/db';
import { variantDetailForSku } from '@/lib/items/variants';
import { cariTeks } from '@/lib/db/cari-teks';
import { whereSaringanSumber } from '@/lib/inventory/jenis-gerakan-stok';
import { itemDecimalsToNumbers } from '@/lib/items/queries';
import { verifyPinForAction } from '@/app/actions/security/pin-auth';
import { requirePermission, hasPermission, PERMISSIONS } from '@/lib/rbac';
import { auth } from '@/lib/auth';
import { getActorName, notifyStockAdjustmentCreated } from '@/app/actions/notifications';
import { generateDocNumber } from "@/lib/docNumber";
import { runSerializable } from "@/lib/db/tx-retry";
import { antrekanPushStok } from "@/lib/jubelio/antre-push-stok";

/**
 * Penjaga aksi baca inventori: butuh sesi dan `inventory:view` — atau salah
 * satu izin lain yang disebut pemanggil. Melempar seperti `requirePermission`
 * (pola file ini), jadi bentuk kembalian aksi baca tidak berubah; halamannya
 * sudah digerbangi proxy, sehingga pengguna sah tidak pernah tertolak di sini.
 */
async function wajibBolehLihatInventori(...izinLain: string[]) {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const izin = session.user.permissions ?? [];
  if (izinLain.some((kode) => hasPermission(izin, kode))) return;
  requirePermission(izin, PERMISSIONS.INVENTORY_VIEW);
}

// Id pengguna mentah tidak dikirim ke klien; nama ada di relasi approvedBy/createdBy.
const tanpaIdPengguna = { approvedById: true, createdById: true } as const;

const adjustmentSchema = z.object({
  itemId: z.string().min(1, 'Item is required'),
  variantSku: z.string().optional(),
  type: z.enum(['POSITIVE', 'NEGATIVE']),
  qty: z.number().positive(),
  uomId: z.string().min(1).optional(),
  reason: z.string().min(5, 'Alasan minimal 5 karakter'),
  evidenceUrl: z.string().url().optional(),
});

export type AdjustmentFormData = z.infer<typeof adjustmentSchema>;

export async function createStockAdjustment(
  data: AdjustmentFormData,
  userPin: string,
  userId: string,
  ipAddress?: string
) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.INVENTORY_MANAGE);
  
  adjustmentSchema.parse(data);

  // Use server session for PIN verification; fallback to lookup by email if session id not in DB (e.g. stale JWT)
  const pinResult = await verifyPinForAction(
    session.user.id,
    userPin,
    'STOCK_ADJUSTMENT',
    undefined,
    ipAddress,
    session.user.email ?? undefined
  );
  if (!pinResult.success) {
    throw new Error(pinResult.messageKey ?? pinResult.message);
  }
  const effectiveUserId = pinResult.userId ?? session.user.id;

  // Serializable + ulang: qty dibaca lalu ditulis sebagai angka mutlak, jadi dua
  // penyesuaian paralel (atau penulis stok lain) tanpa ini saling menimpa. Dulu
  // tabrakan nomor ADJ kebetulan menggagalkan yang kedua; kini nomornya berbeda.
  const adjustmentResult = await runSerializable(async (tx) => {

    // Kunci gerakan stok memakai '' untuk barang tanpa varian.
    const variantKey = data.variantSku ?? '';

    // Get item (for base UOM) and current inventory for (itemId, variantSku).
    // Baris tanpa varian bisa tersimpan null (barang buatan ERP) atau '' — terima
    // keduanya, '' didahulukan bila kembar; tidak pernah membuat baris baru.
    const [item, current] = await Promise.all([
      tx.item.findUnique({
        where: { id: data.itemId },
        select: { uomId: true },
      }),
      variantKey === ''
        ? tx.inventoryValue
            .findMany({ where: { itemId: data.itemId, OR: [{ variantSku: null }, { variantSku: '' }] } })
            .then((rows) => rows.find((r) => r.variantSku === '') ?? rows[0] ?? null)
        : tx.inventoryValue.findUnique({
            where: { itemId_variantSku: { itemId: data.itemId, variantSku: variantKey } },
          }),
    ]);

    if (!item) throw new Error('Item not found');
    if (!current) {
      throw new Error('Item tidak memiliki record inventory');
    }

    let qtyInBaseUom = new Decimal(data.qty);
    if (data.uomId && data.uomId !== item.uomId) {
      const conv = await tx.uOMConversion.findUnique({
        where: {
          fromUomId_toUomId: {
            fromUomId: data.uomId,
            toUomId: item.uomId,
          },
        },
      });
      if (conv) {
        qtyInBaseUom = new Decimal(data.qty).mul(conv.factor.toString());
      } else {
        const convReverse = await tx.uOMConversion.findUnique({
          where: {
            fromUomId_toUomId: {
              fromUomId: item.uomId,
              toUomId: data.uomId,
            },
          },
        });
        if (convReverse) {
          qtyInBaseUom = new Decimal(data.qty).div(convReverse.factor.toString());
        } else {
          throw new Error(`No UOM conversion defined between selected UOM and item base UOM`);
        }
      }
    }

    const prevQty = new Decimal(current.qtyOnHand.toString());
    const prevAvgCost = new Decimal(current.avgCost.toString());
    const qtyChange = qtyInBaseUom;
    const newQty = data.type === 'POSITIVE' 
      ? prevQty.plus(qtyChange)
      : prevQty.minus(qtyChange);
    
    if (newQty.lt(0)) {
      throw new Error('Adjustment would result in negative stock');
    }

    // Penghitung bersama ADJ (sama dengan muat van, opname, NRI, tukar…). Dulu
    // "nomor terbesar + 1" sendiri: penghitung lalu membagikan nomor yang sudah
    // dipakai di sini dan penulis lain gagal unik sampai bulan berganti.
    const docNumber = await generateDocNumber("ADJ", tx);
    
    // Create adjustment document
    const adjustment = await tx.stockAdjustment.create({
      data: {
        docNumber,
        itemId: data.itemId,
        type: data.type,
        qtyChange: qtyChange.toNumber(),
        reason: data.reason,
        evidenceUrl: data.evidenceUrl,
        prevQty: prevQty.toNumber(),
        newQty: newQty.toNumber(),
        prevAvgCost: prevAvgCost.toNumber(),
        newAvgCost: prevAvgCost.toNumber(),
        approvedById: effectiveUserId,
        createdById: effectiveUserId
      }
    });
    
    const newTotalValue = newQty.mul(prevAvgCost);

    // Update inventory (avg cost unchanged)
    await tx.inventoryValue.update({
      where: { id: current.id },
      data: {
        qtyOnHand: newQty.toNumber(),
        totalValue: newTotalValue.toNumber(),
        lastUpdated: new Date(),
      },
    });

    // Create stock movement (in base UOM)
    const adjQtyNum = qtyChange.toNumber();
    const adjQty = data.type === 'POSITIVE' ? adjQtyNum : -adjQtyNum;
    const totalCostAdj =
      data.type === 'POSITIVE'
        ? qtyChange.mul(prevAvgCost).toNumber()
        : qtyChange.mul(prevAvgCost).neg().toNumber();

    await tx.stockMovement.create({
      data: {
        itemId: data.itemId,
        variantSku: variantKey,
        type: 'ADJUSTMENT',
        refType: 'ADJUSTMENT',
        refId: adjustment.id,
        refDocNumber: docNumber,
        qty: adjQty,
        unitCost: prevAvgCost.toNumber(),
        totalCost: totalCostAdj,
        balanceQty: newQty.toNumber(),
        balanceValue: newTotalValue.toNumber(),
        notes: `Adjustment: ${data.reason}`,
      },
    });

    // Audit log (before = state at start of tx)
    const prevValue = prevQty.mul(prevAvgCost);
    await tx.auditLog.create({
      data: {
        userId: effectiveUserId,
        action: 'STOCK_ADJUSTMENT',
        entityType: 'StockAdjustment',
        entityId: adjustment.id,
        changes: {
          before: { qty: prevQty.toString(), value: prevValue.toString() },
          after: { qty: newQty.toString(), value: newTotalValue.toString() },
          reason: data.reason,
          type: data.type,
        },
        ipAddress,
      },
    });

    return adjustment;
  });
  revalidatePath("/backoffice/inventory");

  // Sesudah commit: kirim stok baru ke Jubelio (best-effort, tidak pernah melempar).
  await antrekanPushStok([data.itemId], {
    sumber: 'ADJUSTMENT',
    ref: adjustmentResult.docNumber,
    userId: effectiveUserId,
  });

  getActorName(effectiveUserId)
    .then((triggeredByName) =>
      notifyStockAdjustmentCreated(adjustmentResult.id, adjustmentResult.docNumber, triggeredByName)
    )
    .catch(() => {});
  return adjustmentResult;
}


export async function getGRNs(filters?: {
  supplierId?: string;
  fromDate?: Date;
  toDate?: Date;
}) {
  await wajibBolehLihatInventori();
  const where: any = {};
  
  if (filters?.supplierId) {
    where.supplierId = filters.supplierId;
  }
  
  if (filters?.fromDate || filters?.toDate) {
    where.grnDate = {};
    if (filters.fromDate) {
      where.grnDate.gte = filters.fromDate;
    }
    if (filters.toDate) {
      where.grnDate.lte = filters.toDate;
    }
  }
  
  return await prisma.gRN.findMany({
    where,
    include: {
      supplier: {
        select: {
          name: true,
          code: true
        }
      },
      po: {
        select: {
          docNumber: true
        }
      }
    },
    orderBy: { grnDate: 'desc' }
  });
}

const toNum = (v: unknown): number | null => (v == null ? null : Number(v));

function serializeItemForClient(item: {
  reorderPoint?: unknown;
  overReceiveThreshold?: unknown;
  sellingPrice?: unknown;
  [k: string]: unknown;
} | null) {
  if (!item) return null;
  return {
    ...item,
    ...itemDecimalsToNumbers(item),
  };
}

/** Panjang maksimal teks cari daftar penyesuaian (lebih dari ini dipotong). */
const CARI_PENYESUAIAN_MAKS = 100;

/**
 * Daftar penyesuaian stok. Saringan sumber dan pencarian dijalankan di SERVER,
 * jadi `totalCount` dan halaman mengikuti saringan:
 *  - `sumber`: "manual" (bawaan — menyembunyikan sumber otomatis seperti webhook
 *    Jubelio dan penjualan marketplace), "semua", "otomatis", atau satu kode sumber;
 *  - `cari`: nomor dokumen, alasan, SKU/nama barang, atau rujukan luar (abai huruf).
 */
export async function getStockAdjustments(
  itemId?: string,
  opts?: { page: number; pageSize: number; sumber?: string; cari?: string }
) {
  await wajibBolehLihatInventori();
  const cari = (opts?.cari ?? '').trim().slice(0, CARI_PENYESUAIAN_MAKS);
  const where: Prisma.StockAdjustmentWhereInput = {
    ...(itemId ? { itemId } : {}),
    ...whereSaringanSumber(opts?.sumber),
    ...(cari
      ? {
          OR: [
            { docNumber: cariTeks(cari) },
            { reason: cariTeks(cari) },
            { externalRef: cariTeks(cari) },
            { item: { sku: cariTeks(cari) } },
            { item: { nameId: cariTeks(cari) } },
          ],
        }
      : {}),
  };

  const include = {
    item: true,
    approvedBy: { select: { name: true } },
    createdBy: { select: { name: true, email: true } },
  };

  if (opts?.page != null && opts?.pageSize != null && opts.pageSize > 0) {
    const [rows, totalCount] = await Promise.all([
      prisma.stockAdjustment.findMany({
        where,
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include,
        omit: tanpaIdPengguna,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.stockAdjustment.count({ where }),
    ]);
    const items = rows.map((r) => ({
      ...r,
      qtyChange: toNum(r.qtyChange),
      prevQty: toNum(r.prevQty),
      newQty: toNum(r.newQty),
      prevAvgCost: toNum(r.prevAvgCost),
      newAvgCost: toNum(r.newAvgCost),
      item: serializeItemForClient(r.item as { reorderPoint?: unknown; [k: string]: unknown }),
    }));
    return { items, totalCount };
  }

  const rows = await prisma.stockAdjustment.findMany({
    where,
    include,
    omit: tanpaIdPengguna,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => ({
    ...r,
    qtyChange: toNum(r.qtyChange),
    prevQty: toNum(r.prevQty),
    newQty: toNum(r.newQty),
    prevAvgCost: toNum(r.prevAvgCost),
    newAvgCost: toNum(r.newAvgCost),
    item: serializeItemForClient(r.item as { reorderPoint?: unknown; [k: string]: unknown }),
  }));
}

export async function getStockAdjustmentById(id: string) {
  await wajibBolehLihatInventori();
  const row = await prisma.stockAdjustment.findUnique({
    where: { id },
    include: {
      item: true,
      approvedBy: { select: { name: true } },
      createdBy: { select: { name: true, email: true } },
    },
    omit: tanpaIdPengguna,
  });
  if (!row) return null;
  return {
    ...row,
    qtyChange: toNum(row.qtyChange),
    prevQty: toNum(row.prevQty),
    newQty: toNum(row.newQty),
    prevAvgCost: toNum(row.prevAvgCost),
    newAvgCost: toNum(row.newAvgCost),
    item: serializeItemForClient(row.item as { reorderPoint?: unknown; [k: string]: unknown }),
  };
}

/** Get average cost per item for given item IDs (weighted by qty across variants). */
export async function getItemAvgCosts(
  itemIds: string[]
): Promise<Record<string, number>> {
  // Halaman keluarkan bahan WO (`work_orders:view`) juga memakai rata-rata HPP ini.
  await wajibBolehLihatInventori(PERMISSIONS.WORK_ORDERS_VIEW);
  if (itemIds.length === 0) return {};
  const rows = await prisma.inventoryValue.findMany({
    where: { itemId: { in: itemIds } },
    select: { itemId: true, qtyOnHand: true, totalValue: true },
  });
  const byItem = new Map<string, { qty: number; totalValue: number }>();
  for (const r of rows) {
    const qty = Number(r.qtyOnHand);
    const val = Number(r.totalValue);
    const existing = byItem.get(r.itemId);
    if (existing) {
      existing.qty += qty;
      existing.totalValue += val;
    } else {
      byItem.set(r.itemId, { qty, totalValue: val });
    }
  }
  const out: Record<string, number> = {};
  for (const [id, agg] of byItem.entries()) {
    out[id] = agg.qty > 0 ? agg.totalValue / agg.qty : 0;
  }
  return out;
}

export type RejectedGoodsRecapRow = {
  id: string;
  itemId: string;
  /** Set when rejection was recorded per variant (FG receipt breakdown or vendor return line). */
  variantSku: string | null;
  /** Attribute summary from Item.variants when resolvable (e.g. Size: M · Color: Black). */
  variantDetail: string | null;
  qty: number;
  refType: string;
  refDocNumber: string;
  woId: string | null;
  receivedAt: Date;
  notes: string | null;
  createdAt: Date;
  item: { sku: string; nameId: string; nameEn: string | null };
};

/** Get rejected goods recap (for report page). */
export async function getRejectedGoodsRecap(filters?: {
  itemId?: string;
  woId?: string;
  fromDate?: Date;
  toDate?: Date;
  page?: number;
  pageSize?: number;
}): Promise<{ items: RejectedGoodsRecapRow[]; totalCount: number }> {
  await wajibBolehLihatInventori();
  const where: Record<string, unknown> = {};
  if (filters?.itemId) where.itemId = filters.itemId;
  if (filters?.woId) where.woId = filters.woId;
  if (filters?.fromDate || filters?.toDate) {
    where.receivedAt = {};
    if (filters.fromDate) (where.receivedAt as Record<string, Date>).gte = filters.fromDate;
    if (filters.toDate) (where.receivedAt as Record<string, Date>).lte = filters.toDate;
  }

  const [rows, totalCount] = await Promise.all([
    prisma.rejectedGoodsLedger.findMany({
      where,
      include: {
        item: { select: { sku: true, nameId: true, nameEn: true, variants: true } },
      },
      orderBy: { receivedAt: 'desc' },
      ...(filters?.page != null && filters?.pageSize != null && filters.pageSize > 0
        ? { skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize }
        : {}),
    }),
    prisma.rejectedGoodsLedger.count({ where }),
  ]);

  const items = rows.map((r) => {
    const variantSku = r.variantSku ?? null;
    return {
      id: r.id,
      itemId: r.itemId,
      variantSku,
      variantDetail: variantDetailForSku(r.item.variants, variantSku),
      qty: Number(r.qty),
      refType: r.refType,
      refDocNumber: r.refDocNumber,
      woId: r.woId,
      receivedAt: r.receivedAt,
      notes: r.notes,
      createdAt: r.createdAt,
      item: {
        sku: r.item.sku,
        nameId: r.item.nameId,
        nameEn: r.item.nameEn,
      },
    };
  });

  return { items, totalCount };
}

// Get inventory statistics
export async function getInventoryStats() {
  await wajibBolehLihatInventori();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [
    totalItems,
    inventoryWithReorder,
    totalValue,
    totalGRNs,
    todayMovements
  ] = await Promise.all([
    prisma.item.count({ where: { isActive: true } }),
    prisma.inventoryValue.findMany({
      where: { item: { reorderPoint: { not: null } } },
      include: { item: { select: { reorderPoint: true } } },
    }),
    prisma.inventoryValue.aggregate({
      _sum: { totalValue: true }
    }),
    prisma.gRN.count(),
    prisma.stockMovement.count({
      where: {
        createdAt: { gte: todayStart }
      }
    })
  ]);

  const inventoryByItem = new Map<string, { qtyOnHand: number; reorderPoint: number | null }>();
  for (const r of inventoryWithReorder) {
    const rp = r.item.reorderPoint != null ? Number(r.item.reorderPoint) : null;
    const existing = inventoryByItem.get(r.itemId);
    if (existing) {
      existing.qtyOnHand += Number(r.qtyOnHand);
    } else {
      inventoryByItem.set(r.itemId, { qtyOnHand: Number(r.qtyOnHand), reorderPoint: rp });
    }
  }
  const lowStockItems = Array.from(inventoryByItem.values()).filter(
    (a) => a.reorderPoint != null && a.qtyOnHand <= a.reorderPoint
  ).length;
  
  return {
    totalItems,
    lowStockItems,
    totalValue: Number(totalValue._sum.totalValue ?? 0),
    totalGRNs,
    todayMovements,
  };
}
