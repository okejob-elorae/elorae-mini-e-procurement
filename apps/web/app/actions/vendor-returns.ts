'use server';

import { revalidatePath } from 'next/cache';
import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { prisma } from '@elorae/db';
import { cariTeks } from "@/lib/db/cari-teks";
import { generateDocNumber } from '@/lib/docNumber';
import { reverseInventoryValue } from '@/lib/inventory/costing';
import { getActorName, notifyVendorReturnCreated, notifyVendorReturnStatusUpdated } from '@/app/actions/notifications';
import { getEffectiveHPPForItem } from '@/app/actions/hpp';
import { auth } from '@/lib/auth';
import { hasPermission, PERMISSIONS, requirePermission } from '@/lib/rbac';
import { runSerializable } from '@/lib/db/tx-retry';
import { catatKreditReturPo } from '@/lib/purchase-orders/kredit-retur-writer';
import { antrekanPushStok } from "@/lib/jubelio/antre-push-stok";
import { parseVendorReturnLines } from "@/lib/vendor-returns/baris-retur";

async function requireSession() {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  return session;
}

/** Penjaga baca: sesi + salah satu izin (melempar seperti `requirePermission`). */
async function wajibSalahSatuIzin(...codes: string[]) {
  const session = await requireSession();
  const perms = session.user.permissions ?? [];
  if (!codes.some((c) => hasPermission(perms, c))) {
    requirePermission(perms, codes[0]);
  }
  return session;
}

/** Kolom pemasok yang aman dikirim ke browser — tanpa `bankAccountEnc`. */
const PEMASOK_AMAN = {
  id: true,
  code: true,
  name: true,
  typeId: true,
  address: true,
  phone: true,
  email: true,
  isActive: true,
  status: true,
} as const;

function parseGrnStoredItems(raw: unknown): Array<{ itemId?: string; qty?: unknown }> {
  if (raw == null) return [];
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw) as unknown;
      return Array.isArray(p) ? (p as Array<{ itemId?: string; qty?: unknown }>) : [];
    } catch {
      return [];
    }
  }
  if (Array.isArray(raw)) return raw as Array<{ itemId?: string; qty?: unknown }>;
  return [];
}

/** When vendor return is linked to a GRN: max returnable qty per itemId. Before owner approval = PO ordered qty; after = received qty on GRN (JSON lines + fabric rolls on that GRN). */
async function getGrnReturnCaps(grnId: string): Promise<{
  byItem: Map<string, number>;
  usesPendingPoCaps: boolean;
} | null> {
  const grn = await prisma.gRN.findUnique({
    where: { id: grnId },
    select: { items: true, poId: true, requiresOwnerApproval: true, ownerApprovedAt: true },
  });
  if (!grn) return null;
  const items = parseGrnStoredItems(grn.items);
  const receivedByItem = new Map<string, number>();
  for (const row of items) {
    const id = row.itemId;
    if (!id || typeof id !== 'string') continue;
    const qty = typeof row.qty === 'number' ? row.qty : Number(row.qty);
    if (!Number.isFinite(qty)) continue;
    receivedByItem.set(id, (receivedByItem.get(id) ?? 0) + qty);
  }
  const pendingApproval = grn.requiresOwnerApproval && !grn.ownerApprovedAt;
  if (pendingApproval && grn.poId) {
    const poItems = await prisma.pOItem.findMany({
      where: { poId: grn.poId },
      select: { itemId: true, qty: true },
    });
    const maxByItem = new Map<string, number>();
    for (const po of poItems) {
      const ordered = Number(po.qty);
      maxByItem.set(po.itemId, ordered);
    }
    return { byItem: maxByItem, usesPendingPoCaps: true };
  }
  // Fabric: GRN `items` JSON can be empty/out of sync while FabricRoll rows exist (e.g. by-roll receipt UI).
  const rolls = await prisma.fabricRoll.findMany({
    where: { grnId },
    select: { itemId: true, initialLength: true },
  });
  const qtyByItemFromRolls = new Map<string, number>();
  for (const r of rolls) {
    const len = Number(r.initialLength);
    if (!Number.isFinite(len)) continue;
    qtyByItemFromRolls.set(r.itemId, (qtyByItemFromRolls.get(r.itemId) ?? 0) + len);
  }
  for (const [itemId, rollQty] of qtyByItemFromRolls) {
    const fromJson = receivedByItem.get(itemId) ?? 0;
    receivedByItem.set(itemId, Math.max(fromJson, rollQty));
  }
  return { byItem: receivedByItem, usesPendingPoCaps: false };
}

function grnQtyExceededMessage(
  max: number,
  usesPendingPoCaps: boolean,
  lineQty: number
): string {
  if (usesPendingPoCaps) {
    return `Return qty for item exceeds allowed amount (max ${max} while GRN is pending owner approval). Reduce qty or wait for GRN approval.`;
  }
  if (max <= 0) {
    return (
      'This item was not received on the selected GRN (returnable qty is 0). ' +
      'Choose a GRN that includes this item, or clear GRN if the return is not tied to a specific receipt.'
    );
  }
  return `Return qty (${lineQty}) exceeds amount received on this GRN for this item (max ${max}). Reduce qty or pick another GRN.`;
}

// Prisma uses CUID, not UUID
const idStr = z.string().min(1);

const returnLineSchema = z.object({
  type: z.enum(['FABRIC', 'ACCESSORIES', 'FG_REJECT']),
  itemId: idStr,
  variantSku: z.string().optional(),
  rollId: z.string().optional(),
  qty: z.number().positive(),
  reason: z.string().min(3),
  condition: z.enum(['GOOD', 'DAMAGED', 'DEFECTIVE']),
  referenceIssueId: idStr.optional()
});

const returnSchema = z.object({
  woId: idStr.optional(),
  grnId: idStr.optional(),
  vendorId: idStr,
  lines: z.array(returnLineSchema).min(1),
  evidenceUrls: z.array(z.string().url()).optional()
});

export type VendorReturnLineInput = z.infer<typeof returnLineSchema>;
export type CreateVendorReturnInput = z.infer<typeof returnSchema>;

// Returnable fabric rolls for a given item (open rolls with remaining length)
export async function getReturnableFabricRolls(itemId: string) {
  await wajibSalahSatuIzin(PERMISSIONS.VENDOR_RETURNS_VIEW, PERMISSIONS.INVENTORY_VIEW);
  const rolls = await prisma.fabricRoll.findMany({
    where: { itemId, isClosed: false, remainingLength: { gt: 0 } },
    select: { id: true, rollRef: true, remainingLength: true },
    orderBy: { remainingLength: 'desc' },
  });
  return rolls.map((r) => ({
    id: r.id,
    rollRef: r.rollRef,
    remainingLength: Number(r.remainingLength),
  }));
}

/** Sum of RejectedGoodsLedger rows for an item — internal, callers guard themselves. */
async function hitungRejectTersedia(itemId: string): Promise<number> {
  const rows = await prisma.rejectedGoodsLedger.findMany({
    where: { itemId },
    select: { qty: true },
  });
  return rows.reduce((s, r) => s + Number(r.qty), 0);
}

/** Available reject qty for an item (sum of RejectedGoodsLedger rows for that itemId). */
export async function getAvailableRejectQtyByItem(itemId: string): Promise<number> {
  await wajibSalahSatuIzin(PERMISSIONS.VENDOR_RETURNS_VIEW, PERMISSIONS.INVENTORY_VIEW);
  return hitungRejectTersedia(itemId);
}

export async function createVendorReturn(
  data: CreateVendorReturnInput,
  _userId?: string
) {
  void _userId;
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.VENDOR_RETURNS_CREATE);
  // Pembuat selalu pengguna sesi, bukan id kiriman klien.
  const userId = session.user.id;

  returnSchema.parse(data);

  for (const line of data.lines) {
    if (line.type === 'FG_REJECT') {
      const available = await hitungRejectTersedia(line.itemId);
      if (line.qty > available) {
        throw new Error(
          `Reject qty for item exceeds available rejects (max ${available}). Reduce qty or check reject ledger.`
        );
      }
    }
  }

  if (data.grnId) {
    const caps = await getGrnReturnCaps(data.grnId);
    if (caps) {
      for (const line of data.lines) {
        if (line.type === 'FABRIC' || line.type === 'ACCESSORIES') {
          const max = caps.byItem.get(line.itemId) ?? 0;
          if (line.qty > max) {
            throw new Error(grnQtyExceededMessage(max, caps.usesPendingPoCaps, line.qty));
          }
        }
      }
    }
  }

  const ret = await prisma.$transaction(async (tx) => {
    const docNumber = await generateDocNumber('RET', tx);

    const linesWithValue = await Promise.all(
      data.lines.map(async (line) => {
        let costValue: number;
        if (line.type === 'FG_REJECT') {
          const hpp = await getEffectiveHPPForItem(line.itemId);
          const avgCost = hpp?.avgCostPerUnit ?? 0;
          costValue = avgCost * line.qty;
        } else {
          const variantKey = (line.variantSku ?? '') as string;
          const inventory = await tx.inventoryValue.findUnique({
            where: { itemId_variantSku: { itemId: line.itemId, variantSku: variantKey } }
          });
          const avgCost = inventory
            ? new Decimal(inventory.avgCost.toString())
            : new Decimal(0);
          costValue = avgCost.mul(line.qty).toNumber();
        }
        const itemName = (await tx.item.findUnique({
          where: { id: line.itemId },
          select: { nameId: true }
        }))?.nameId;
        let rollRef: string | undefined;
        if (line.type === 'FABRIC' && line.rollId) {
          const roll = await tx.fabricRoll.findUnique({
            where: { id: line.rollId },
            select: { rollRef: true }
          });
          rollRef = roll?.rollRef ?? undefined;
        }
        return {
          ...line,
          itemName: itemName ?? undefined,
          costValue,
          rollRef
        };
      })
    );

    const totalValue = linesWithValue.reduce(
      (sum, line) => sum.plus(line.costValue),
      new Decimal(0)
    );

    const ret = await tx.vendorReturn.create({
      data: {
        docNumber,
        woId: data.woId ?? null,
        grnId: data.grnId ?? null,
        vendorId: data.vendorId,
        lines: JSON.stringify(linesWithValue),
        totalItems: data.lines.length,
        totalValue: totalValue.toNumber(),
        evidenceUrls: data.evidenceUrls
          ? JSON.stringify(data.evidenceUrls)
          : null,
        createdById: userId
      }
    });

    return ret;
  });

  getActorName(userId)
    .then((triggeredByName) =>
      notifyVendorReturnCreated(ret.id, ret.docNumber, triggeredByName)
    )
    .catch(() => {});
  return ret;
}

export async function updateVendorReturn(
  id: string,
  data: CreateVendorReturnInput,
  _userId: string
) {
  void _userId;
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.VENDOR_RETURNS_MANAGE);

  returnSchema.parse(data);

  for (const line of data.lines) {
    if (line.type === 'FG_REJECT') {
      const available = await hitungRejectTersedia(line.itemId);
      if (line.qty > available) {
        throw new Error(
          `Reject qty for item exceeds available rejects (max ${available}). Reduce qty or check reject ledger.`
        );
      }
    }
  }

  if (data.grnId) {
    const caps = await getGrnReturnCaps(data.grnId);
    if (caps) {
      for (const line of data.lines) {
        if (line.type === 'FABRIC' || line.type === 'ACCESSORIES') {
          const max = caps.byItem.get(line.itemId) ?? 0;
          if (line.qty > max) {
            throw new Error(grnQtyExceededMessage(max, caps.usesPendingPoCaps, line.qty));
          }
        }
      }
    }
  }

  // Penjaga DRAFT di dalam transaksi serializable yang sama dengan pembaruannya:
  // dulu dibaca di luar, jadi baris bisa diubah sesudah `processReturn`
  // mengeluarkan stok sesuai baris lama.
  const updated = await runSerializable(async (tx) => {
    const existing = await tx.vendorReturn.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!existing || existing.status !== 'DRAFT') {
      throw new Error('Can only edit draft returns');
    }

    const linesWithValue = await Promise.all(
      data.lines.map(async (line) => {
        let costValue: number;
        if (line.type === 'FG_REJECT') {
          const hpp = await getEffectiveHPPForItem(line.itemId);
          const avgCost = hpp?.avgCostPerUnit ?? 0;
          costValue = avgCost * line.qty;
        } else {
          const variantKey = (line.variantSku ?? '') as string;
          const inventory = await tx.inventoryValue.findUnique({
            where: { itemId_variantSku: { itemId: line.itemId, variantSku: variantKey } }
          });
          const avgCost = inventory
            ? new Decimal(inventory.avgCost.toString())
            : new Decimal(0);
          costValue = avgCost.mul(line.qty).toNumber();
        }
        const itemName = (await tx.item.findUnique({
          where: { id: line.itemId },
          select: { nameId: true }
        }))?.nameId;
        let rollRef: string | undefined;
        if (line.type === 'FABRIC' && line.rollId) {
          const roll = await tx.fabricRoll.findUnique({
            where: { id: line.rollId },
            select: { rollRef: true }
          });
          rollRef = roll?.rollRef ?? undefined;
        }
        return {
          ...line,
          itemName: itemName ?? undefined,
          costValue,
          rollRef
        };
      })
    );

    const totalValue = linesWithValue.reduce(
      (sum, line) => sum.plus(line.costValue),
      new Decimal(0)
    );

    return tx.vendorReturn.update({
      where: { id },
      data: {
        woId: data.woId ?? null,
        grnId: data.grnId ?? null,
        vendorId: data.vendorId,
        lines: JSON.stringify(linesWithValue),
        totalItems: data.lines.length,
        totalValue: totalValue.toNumber(),
        evidenceUrls: data.evidenceUrls
          ? JSON.stringify(data.evidenceUrls)
          : null
      }
    });
  });

  revalidatePath('/backoffice/vendor-returns');
  revalidatePath(`/backoffice/vendor-returns/${id}`);
  return updated;
}

export async function deleteVendorReturn(id: string, _userId: string) {
  void _userId;
  const session = await requireSession();
  requirePermission(session.user.permissions, PERMISSIONS.VENDOR_RETURNS_MANAGE);

  // Penjaga DRAFT + hapus dalam satu transaksi serializable, supaya retur yang
  // sedang diproses (stoknya sudah keluar) tidak ikut terhapus.
  await runSerializable(async (tx) => {
    const existing = await tx.vendorReturn.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!existing || existing.status !== 'DRAFT') {
      throw new Error('Can only delete draft returns');
    }
    await tx.vendorReturn.delete({ where: { id } });
  });
  revalidatePath('/backoffice/vendor-returns');
}

export type HapusReturPemasokResult =
  | { ok: true }
  | { ok: false; code: 'TANPA_AKSES' | 'TIDAK_DITEMUKAN' | 'BUKAN_DRAF' | 'GAGAL' };

/**
 * Hapus retur draf untuk layar, dengan penolakan sebagai KODE
 * (`vendorReturnsList.err.<kode>`) — `deleteVendorReturn` melempar, dan di
 * build produksi pesan lemparan disamarkan. Penjaga DRAFT + hapus tetap dalam
 * satu transaksi serializable.
 */
export async function hapusReturPemasok(id: string): Promise<HapusReturPemasokResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.VENDOR_RETURNS_MANAGE)) {
    return { ok: false, code: 'TANPA_AKSES' };
  }
  try {
    const hasil = await runSerializable(async (tx): Promise<HapusReturPemasokResult> => {
      const ada = await tx.vendorReturn.findUnique({ where: { id }, select: { status: true } });
      if (!ada) return { ok: false, code: 'TIDAK_DITEMUKAN' };
      if (ada.status !== 'DRAFT') return { ok: false, code: 'BUKAN_DRAF' };
      await tx.vendorReturn.delete({ where: { id } });
      return { ok: true };
    });
    if (hasil.ok) revalidatePath('/backoffice/vendor-returns');
    return hasil;
  } catch (e) {
    console.error('[hapusReturPemasok]', e);
    return { ok: false, code: 'GAGAL' };
  }
}

/**
 * Nomor PO untuk retur yang mengkredit PO (`VendorReturn.poId` tanpa relasi
 * Prisma), dan `poCreditAmount` sebagai angka — Decimal tidak bisa dikirim ke
 * browser lewat aksi server.
 */
async function denganPo<T extends { poId: string | null; poCreditAmount: unknown }>(
  rows: T[]
): Promise<Array<Omit<T, 'poCreditAmount'> & { poCreditAmount: number | null; po: { id: string; docNumber: string } | null }>> {
  const ids = [...new Set(rows.map((r) => r.poId).filter((v): v is string => typeof v === 'string' && v !== ''))];
  const pos = ids.length
    ? await prisma.purchaseOrder.findMany({ where: { id: { in: ids } }, select: { id: true, docNumber: true } })
    : [];
  const per = new Map(pos.map((p) => [p.id, p]));
  return rows.map((r) => ({
    ...r,
    poCreditAmount: r.poCreditAmount == null ? null : Number(r.poCreditAmount),
    po: r.poId ? per.get(r.poId) ?? null : null,
  }));
}

/*
 * Penolakan proses/selesai retur DIKEMBALIKAN sebagai `{ ok:false, code }`:
 * di build produksi Next menyamarkan pesan galat yang dilempar aksi server,
 * jadi layar hanya bisa menjelaskan alasannya lewat kode
 * (`vendorReturnsList.err.<kode>` di i18n). Di dalam transaksi penolakan tetap
 * DILEMPAR (supaya semua tulisan dibatalkan), lalu diterjemahkan di luar.
 */
export type KodeTolakProsesRetur =
  | 'TANPA_AKSES'
  | 'TIDAK_DITEMUKAN'
  | 'SUDAH_DIPROSES'
  | 'TANPA_BARIS'
  | 'BARIS_TIDAK_VALID'
  | 'STOK_KURANG'
  | 'GAGAL';
type RincianTolakRetur = { barang?: string; perlu?: number; ada?: number };
export type ProsesReturResult =
  | { ok: true; id: string; docNumber: string }
  | ({ ok: false; code: KodeTolakProsesRetur } & RincianTolakRetur);

export type KodeTolakSelesaiRetur =
  | 'TANPA_AKSES'
  | 'BUKTI_TIDAK_LENGKAP'
  | 'TIDAK_DITEMUKAN'
  | 'BELUM_DIPROSES'
  | 'SUDAH_SELESAI'
  | 'GAGAL';
export type SelesaikanReturResult = { ok: true } | { ok: false; code: KodeTolakSelesaiRetur };

class ReturDitolak extends Error {
  constructor(
    readonly code: Exclude<KodeTolakProsesRetur | KodeTolakSelesaiRetur, 'TANPA_AKSES' | 'GAGAL'>,
    readonly rincian: RincianTolakRetur = {}
  ) {
    super(code);
    this.name = 'ReturDitolak';
  }
}

/** Pesan pasti `reverseInventoryValue` (lib/inventory/costing.ts) untuk stok kurang / tanpa catatan stok. */
const PESAN_STOK_KURANG = new Set(['Insufficient stock', 'No inventory record found']);

/** Nama barang untuk pesan penolakan (SKU bila nama kosong, id bila barangnya hilang). */
async function namaBarang(tx: Pick<typeof prisma, 'item'>, itemId: string): Promise<string> {
  const item = await tx.item.findUnique({ where: { id: itemId }, select: { nameId: true, sku: true } });
  return item?.nameId || item?.sku || itemId;
}

/**
 * DRAFT → PROCESSED: stok keluar. Butuh `vendor_returns:manage`; pelaku dari
 * sesi (`_userId` diabaikan). Penjaga DRAFT di `runSerializable` — proses ganda
 * serentak dulu sama-sama lolos dan mengeluarkan stok dua kali.
 */
export async function processReturn(id: string, _userId?: string): Promise<ProsesReturResult> {
  void _userId;
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.VENDOR_RETURNS_MANAGE)) {
    return { ok: false, code: 'TANPA_AKSES' };
  }
  const userId = session.user.id;

  let result: Awaited<ReturnType<typeof prosesReturDalamTransaksi>>;
  try {
    result = await prosesReturDalamTransaksi(id, userId);
  } catch (error) {
    if (error instanceof ReturDitolak) {
      return { ok: false, code: error.code as KodeTolakProsesRetur, ...error.rincian };
    }
    console.error('[processReturn]', error);
    return { ok: false, code: 'GAGAL' };
  }

  // Sesudah commit: langkah sampingan tidak boleh mengubah hasil — stok sudah keluar.
  try {
    // Baris kain/aksesori mengurangi stok gudang. Barang tanpa pemetaan
    // Jubelio dilewati penolong; FG_REJECT tidak menyentuh stok jual.
    await antrekanPushStok(
      parseVendorReturnLines(result.ret.lines)
        .filter((l) => l.type === "FABRIC" || l.type === "ACCESSORIES")
        .map((l) => l.itemId),
      { sumber: "ADJUSTMENT", ref: `retur pemasok ${result.ret.docNumber}`, userId },
    );
  } catch (error) {
    console.error('[processReturn] antre push stok', error);
  }

  getActorName(userId)
    .then((triggeredByName) =>
      notifyVendorReturnStatusUpdated(
        id,
        result.ret.docNumber,
        'DRAFT',
        'PROCESSED',
        triggeredByName
      )
    )
    .catch(() => {});

  revalidatePath('/backoffice/vendor-returns');
  revalidatePath(`/backoffice/vendor-returns/${result.ret.id}`);
  if (result.poIdToRevalidate) {
    revalidatePath(`/backoffice/purchase-orders/${result.poIdToRevalidate}`);
  }
  return { ok: true, id: result.ret.id, docNumber: result.ret.docNumber };
}

async function prosesReturDalamTransaksi(id: string, userId: string) {
  return runSerializable(async (tx) => {
    const ret = await tx.vendorReturn.findUnique({
      where: { id }
    });

    if (!ret) throw new ReturDitolak('TIDAK_DITEMUKAN');
    if (ret.status !== 'DRAFT') throw new ReturDitolak('SUDAH_DIPROSES');

    const lines = parseVendorReturnLines(ret.lines);
    if (lines.length === 0) throw new ReturDitolak('TANPA_BARIS');

    for (const line of lines) {
      if (line.type === 'FABRIC' || line.type === 'ACCESSORIES') {
        const parsedQty = Number(line.qty);
        const parsedCostValue = Number(line.costValue);
        if (
          !Number.isFinite(parsedQty) || parsedQty <= 0 ||
          !Number.isFinite(parsedCostValue) || parsedCostValue < 0
        ) {
          throw new ReturDitolak('BARIS_TIDAK_VALID', { barang: await namaBarang(tx, line.itemId) });
        }
        const variantKey = line.variantSku ?? null;
        const qty = new Decimal(parsedQty);
        const unitCost = parsedQty === 0 ? new Decimal(0) : new Decimal(parsedCostValue).div(parsedQty);
        let costResult: Awaited<ReturnType<typeof reverseInventoryValue>>;
        try {
          costResult = await reverseInventoryValue(line.itemId, qty, unitCost, tx, variantKey);
        } catch (error) {
          // Hanya penolakan stok yang diterjemahkan; galat basis data (mis. konflik
          // serializable) dilempar apa adanya supaya transaksinya diulang.
          if (!(error instanceof Error) || !PESAN_STOK_KURANG.has(error.message)) throw error;
          const stok = await tx.inventoryValue.findUnique({
            where: { itemId_variantSku: { itemId: line.itemId, variantSku: variantKey ?? '' } },
            select: { qtyOnHand: true },
          });
          throw new ReturDitolak('STOK_KURANG', {
            barang: await namaBarang(tx, line.itemId),
            perlu: parsedQty,
            ada: stok ? Number(stok.qtyOnHand) : 0,
          });
        }
        const outgoingValue = qty.mul(unitCost);
        await tx.stockMovement.create({
          data: {
            itemId: line.itemId,
            variantSku: variantKey,
            type: 'OUT',
            refType: 'VENDOR_RETURN',
            refId: ret.id,
            refDocNumber: ret.docNumber,
            qty: -parsedQty,
            unitCost: unitCost.toNumber(),
            totalCost: outgoingValue.toNumber(),
            balanceQty: costResult.newQty.toNumber(),
            balanceValue: costResult.newTotalValue.toNumber(),
            notes: ret.woId ? `Vendor return ${ret.docNumber} (WO)` : `Vendor return ${ret.docNumber}`,
          },
        });
        if (line.type === 'FABRIC' && line.rollId) {
          await tx.fabricRoll.update({
            where: { id: line.rollId },
            data: { remainingLength: 0, isClosed: true },
          });
        }
      } else if (line.type === 'FG_REJECT') {
        const parsedQty = Number(line.qty);
        if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
          throw new ReturDitolak('BARIS_TIDAK_VALID', { barang: await namaBarang(tx, line.itemId) });
        }
        await tx.rejectedGoodsLedger.create({
          data: {
            itemId: line.itemId,
            variantSku: line.variantSku ?? null,
            qty: -parsedQty,
            refType: 'VENDOR_RETURN',
            refId: ret.id,
            refDocNumber: ret.docNumber,
            woId: ret.woId ?? null,
            receivedAt: new Date(),
            notes: `Vendor return ${ret.docNumber}`,
          },
        });
      }
    }

    let poIdToRevalidate: string | null = null;
    if (ret.woId) {
      const wo = await tx.workOrder.findUnique({
        where: { id: ret.woId },
        select: { poId: true, docNumber: true },
      });
      if (wo?.poId) {
        const po = await tx.purchaseOrder.findUnique({
          where: { id: wo.poId },
          select: { status: true },
        });
        if (po) {
          await tx.pOStatusHistory.create({
            data: {
              poId: wo.poId,
              status: po.status,
              changedById: userId,
              notes: `Vendor return ${ret.docNumber} processed (WO ${wo.docNumber})`,
            },
          });
          poIdToRevalidate = wo.poId;
        }
      }
    }

    await tx.vendorReturn.update({
      where: { id },
      data: {
        status: 'PROCESSED',
        processedAt: new Date(),
        processedBy: userId,
        stockImpacted: true,
      },
    });

    return { ret, poIdToRevalidate };
  });
}

const completeReturnSchema = z.object({
  trackingNumber: z.string().min(1, 'Tracking number is required'),
  receiptFileUrl: z.string().url('Receipt file URL is required')
});

export type CompleteReturnInput = z.infer<typeof completeReturnSchema>;

/**
 * PROCESSED → COMPLETED. Butuh `vendor_returns:manage`; penutup dari sesi
 * (`_userId` diabaikan). Penjaga PROCESSED di `runSerializable` supaya
 * `returnedQty` rencana WO tidak bertambah dua kali.
 */
export async function completeReturn(
  id: string,
  _userId: string | undefined,
  data: CompleteReturnInput
): Promise<SelesaikanReturResult> {
  void _userId;
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.VENDOR_RETURNS_MANAGE)) {
    return { ok: false, code: 'TANPA_AKSES' };
  }
  const userId = session.user.id;
  if (!completeReturnSchema.safeParse(data).success) return { ok: false, code: 'BUKTI_TIDAK_LENGKAP' };

  let completeResult: Awaited<ReturnType<typeof selesaikanReturDalamTransaksi>>;
  try {
    completeResult = await selesaikanReturDalamTransaksi(id, userId, data);
  } catch (error) {
    if (error instanceof ReturDitolak) return { ok: false, code: error.code as KodeTolakSelesaiRetur };
    console.error('[completeReturn]', error);
    return { ok: false, code: 'GAGAL' };
  }

  revalidatePath('/backoffice/vendor-returns');
  revalidatePath(`/backoffice/vendor-returns/${id}`);
  if (completeResult.woId) {
    revalidatePath(`/backoffice/work-orders/${completeResult.woId}`);
  }
  if (completeResult.kreditPo.poId) {
    revalidatePath(`/backoffice/purchase-orders/${completeResult.kreditPo.poId}`);
    revalidatePath('/backoffice/supplier-payments');
  }

  getActorName(userId)
    .then((triggeredByName) =>
      notifyVendorReturnStatusUpdated(
        id,
        completeResult.docNumber,
        'PROCESSED',
        'COMPLETED',
        triggeredByName
      )
    )
    .catch(() => {});
  return { ok: true };
}

async function selesaikanReturDalamTransaksi(id: string, userId: string, data: CompleteReturnInput) {
  return runSerializable(async (tx) => {
    const ret = await tx.vendorReturn.findUnique({
      where: { id }
    });

    if (!ret) throw new ReturDitolak('TIDAK_DITEMUKAN');
    if (ret.status === 'COMPLETED') throw new ReturDitolak('SUDAH_SELESAI');
    if (ret.status !== 'PROCESSED') throw new ReturDitolak('BELUM_DIPROSES');

    // Baris retur dan rencana WO tersimpan sebagai STRING JSON. Dulu diulang
    // sebagai `any[]` (per huruf), jadi `returnedQty` WO tidak pernah bertambah.
    // Qty dijumlah per barang dengan Decimal (bisa teks, kain bisa pecahan),
    // lalu rencana dibaca dan ditulis SEKALI. Penjaga PROCESSED di atas, di
    // transaksi serializable yang sama, membuat penambahan ini sekali per retur.
    if (ret.woId) {
      const kembaliPerBarang = new Map<string, Decimal>();
      for (const line of parseVendorReturnLines(ret.lines)) {
        if (line.type !== 'FABRIC' && line.type !== 'ACCESSORIES') continue;
        const qty = Number(line.qty);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        kembaliPerBarang.set(line.itemId, (kembaliPerBarang.get(line.itemId) ?? new Decimal(0)).plus(qty));
      }

      if (kembaliPerBarang.size > 0) {
        const wo = await tx.workOrder.findUnique({
          where: { id: ret.woId },
          select: { consumptionPlan: true }
        });
        let plan: unknown = wo?.consumptionPlan ?? null;
        if (typeof plan === 'string') {
          try {
            plan = JSON.parse(plan);
          } catch {
            plan = null;
          }
        }
        // Rencana yang tak terbaca dibiarkan apa adanya — jangan ditimpa "[]".
        if (Array.isArray(plan)) {
          const baris = plan as Array<{ itemId?: unknown; returnedQty?: unknown }>;
          let berubah = false;
          for (const [itemId, qty] of kembaliPerBarang) {
            const planItem = baris.find((p) => p?.itemId === itemId);
            if (!planItem) continue;
            planItem.returnedQty = new Decimal(Number(planItem.returnedQty) || 0).plus(qty).toNumber();
            berubah = true;
          }
          if (berubah) {
            await tx.workOrder.update({
              where: { id: ret.woId },
              data: { consumptionPlan: JSON.stringify(baris) }
            });
          }
        }
      }
    }

    await tx.vendorReturn.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        completedById: userId,
        trackingNumber: data.trackingNumber,
        receiptFileUrl: data.receiptFileUrl,
        stockImpacted: ret.stockImpacted
      }
    });

    // Retur yang terkait GRN sebuah PO mengurangi utang PO itu (harga beli PO),
    // di transaksi yang sama. Tanpa jurnal — GL belum dipersenjatai.
    const kreditPo = await catatKreditReturPo(tx, { returnId: id, userId });

    return { ...ret, kreditPo };
  });
}

export async function getVendorReturns(
  filters?: {
    status?: string;
    vendorId?: string;
    woId?: string;
    search?: string;
  },
  opts?: { page: number; pageSize: number }
) {
  await wajibSalahSatuIzin(PERMISSIONS.VENDOR_RETURNS_VIEW);
  const andParts: Array<Record<string, unknown>> = [];
  if (filters?.status) andParts.push({ status: filters.status });
  if (filters?.vendorId) andParts.push({ vendorId: filters.vendorId });
  if (filters?.woId) andParts.push({ woId: filters.woId });
  const searchTrim = filters?.search?.trim();
  if (searchTrim) {
    andParts.push({
      OR: [
        { docNumber: cariTeks(searchTrim) },
        { vendor: { name: cariTeks(searchTrim) } },
        { vendor: { code: cariTeks(searchTrim) } }
      ]
    });
  }
  const where = andParts.length > 0 ? { AND: andParts } : {};

  const include = {
    vendor: {
      select: { id: true, name: true, code: true }
    },
    wo: {
      select: { id: true, docNumber: true }
    },
    grn: {
      select: { id: true, docNumber: true }
    }
  };

  if (opts?.page != null && opts?.pageSize != null && opts.pageSize > 0) {
    const [rows, totalCount] = await Promise.all([
      prisma.vendorReturn.findMany({
        where,
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include,
        orderBy: { createdAt: 'desc' }
      }),
      prisma.vendorReturn.count({ where }),
    ]);
    const items = await denganPo(
      rows.map((r) => ({
        ...r,
        totalValue: Number(r.totalValue)
      }))
    );
    return { items, totalCount };
  }

  const rows = await prisma.vendorReturn.findMany({
    where,
    include,
    orderBy: { createdAt: 'desc' }
  });

  return denganPo(
    rows.map((r) => ({
      ...r,
      totalValue: Number(r.totalValue)
    }))
  );
}

export async function getVendorReturnById(id: string) {
  await wajibSalahSatuIzin(PERMISSIONS.VENDOR_RETURNS_VIEW);
  const ret = await prisma.vendorReturn.findUnique({
    where: { id },
    include: {
      vendor: { select: PEMASOK_AMAN },
      wo: { select: { id: true, docNumber: true } },
      grn: { select: { id: true, docNumber: true } }
    }
  });
  if (!ret) return null;
  const [denganNomorPo] = await denganPo([{ ...ret, totalValue: Number(ret.totalValue) }]);
  return denganNomorPo;
}
