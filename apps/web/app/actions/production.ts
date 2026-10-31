'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { prisma, moveMainStock } from '@elorae/db';
import type { StockLedgerRefType } from '@elorae/db';
import { decimalKeAngka } from '@/lib/db/decimal-ke-angka';
import { antrekanPushStok } from "@/lib/jubelio/antre-push-stok";
import { generateDocNumber } from '@/lib/docNumber';
import { docNumberPeriod } from "@/lib/doc-numbers/period";
import { maxIssuedNumber, resyncedCounter } from "@/lib/doc-numbers/recover";
import { normalizePrefix } from "@/lib/doc-numbers/validate";
import { generateMaterialPlan, type MaterialPlanItem, type MaterialPlanOptions } from '@/lib/production/planning';
import { MaterialPlanBlockedError } from '@/lib/production/scoped-bom';
import { rollShortfalls, rollsForItem, withRollItemIds, type RollEntry } from '@/lib/production/roll-allocation';
import { reconcileWorkOrder } from '@/lib/production/reconciliation';
import { calculateMovingAverage } from '@/lib/inventory/costing';
import { notifyWOCreated, notifyWOStatusUpdated, notifyWOMaterialsIssued, notifyWOCompleted } from '@/lib/notifications/events';
import { getActorName } from "@/lib/notifications/actor-name";
import { auth } from '@/lib/auth';
import { assertActor } from "@/lib/auth/assert-actor";
import { logAudit } from '@/lib/audit';
import { requirePermission, hasPermission, PERMISSIONS } from '@/lib/rbac';
import { postFgReceiptJournalAman, type HasilPostingPenerimaanFG } from '@/lib/production/fg-receipt-journal-aman';
import {
  listWorkOrders as listWorkOrdersLib,
  type ListWorkOrdersFilters,
  type ListWorkOrdersOpts,
} from '@/lib/work-orders/queries';
import { resolveWoLeadTimeFields } from '@/lib/leadtime/wo-snapshot';
import { computeActualLeadDays } from '@/lib/leadtime/calculations';
import { formatDateOnlyJakarta } from '@/lib/date-only';
import { getWoShortages, formatShortages, type WoShortage } from '@/lib/item-requests/shortage';
import { cancelOpenLinesForWo, getUncoveredShortages, syncRequestForWo } from '@/lib/item-requests/mutations';
import { applyChainSignal } from '@/lib/leadtime/auto-confirm';
import { toReceiptRefusal, type ReceiptRefusal, type ReceiptRefusalCode } from "@/lib/inventory/receipt-refusal";
import { WorkOrderNotFoundError } from "@/lib/inventory/receipt-errors";
import { runSerializable } from "@/lib/db/tx-retry";
import { bentrokKunciKiriman } from "@/lib/receivables/idempoten";
import { bagiBiayaPerBaris, rincianBiayaPenerimaan, type DasarBiayaPenerimaan } from "@/lib/production/biaya-penerimaan";
import { bacaDasarBiayaPenerimaan } from "@/lib/production/biaya-penerimaan-queries";
import { ProduksiDitolakError, type KodeTolakProduksi } from "@/lib/production/galat-produksi";
import { bacaSisaBahanWo, kembalikanBahanWo, type HasilKembaliBahan } from "@/lib/production/kembali-bahan-writer";
import { BATAS_ALASAN_BATAL_WO, bahanMasihDiCmt, type KodeTolakKembaliBahan } from "@/lib/production/kembali-bahan";
import { ringkasanBahanWo, type RingkasanBahanWo } from "@/lib/production/kembali-bahan-queries";

// Prisma uses CUID, not UUID - accept non-empty string for IDs
const idStr = z.string().min(1);

/** Siapa pun yang membuat/mengelola perintah kerja juga boleh membacanya. */
const IZIN_BACA_WO = [
  PERMISSIONS.WORK_ORDERS_VIEW,
  PERMISSIONS.WORK_ORDERS_CREATE,
  PERMISSIONS.WORK_ORDERS_MANAGE,
];

/**
 * Pagar aksi BACA di berkas ini. Setiap ekspor `"use server"` adalah titik akhir
 * yang bisa dipanggil siapa pun yang sudah masuk — tanpa pagar ini akun
 * salesman/SPG bisa membaca perintah kerja, biaya bahan, dan nota CMT. Cukup
 * SALAH SATU izin; melempar seperti `requirePermission` supaya bentuk kembalian
 * untuk yang sah tidak berubah. Dipasang sebelum satu kueri pun berjalan.
 */
async function wajibBolehBaca(izin: readonly string[]): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const punya = session.user.permissions ?? [];
  if (!izin.some((kode) => hasPermission(punya, kode))) {
    throw Object.assign(new Error("Forbidden: Insufficient permissions"), { status: 403 });
  }
}

/** Parse consumptionPlan from DB (Json = string or object) to array for client. */
function parseConsumptionPlan(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Item row included on WO (e.g. finishedGood) — every Decimal field becomes a number (`decimalKeAngka`). */
function serializeIncludedItemForClient(item: unknown): unknown {
  if (item == null || typeof item !== 'object') return item;
  return decimalKeAngka(item as Record<string, unknown>);
}

/** VendorReturn row on WO — totalValue and optional linked GRN.totalAmount. */
function serializeVendorReturnForClient(ret: unknown): unknown {
  if (ret == null || typeof ret !== 'object') return ret;
  const r = ret as Record<string, unknown>;
  const grn = r.grn;
  let serializedGrn: unknown = grn;
  if (grn != null && typeof grn === 'object') {
    const g = grn as Record<string, unknown>;
    serializedGrn = {
      ...g,
      totalAmount: g.totalAmount != null ? Number(g.totalAmount) : null,
    };
  }
  return {
    ...r,
    totalValue: r.totalValue != null ? Number(r.totalValue) : 0,
    grn: serializedGrn,
  };
}

/** Serialize WO (and optional includes) to plain object for Client Components (no Prisma Decimal). */
function serializeWorkOrder(wo: {
  id: string;
  docNumber: string;
  poId?: string | null;
  vendorId: string;
  finishedGoodId: string;
  consumptionMaterialId?: string | null;
  outputMode: string;
  plannedQty: unknown;
  expectedConsumption?: unknown;
  actualQty?: unknown;
  targetDate: Date | null;
  status: string;
  issuedAt: Date | null;
  completedAt: Date | null;
  canceledAt: Date | null;
  canceledReason: string | null;
  consumptionPlan: unknown;
  skuBreakdown?: unknown;
  rollBreakdown?: unknown;
  notes: string | null;
  syncStatus?: string;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
  po?: { id: string; docNumber: string } | null;
  vendor?: unknown;
  finishedGood?: unknown;
  issues?: Array<{ id: string; docNumber: string; issueType: string; totalCost: unknown; issuedAt: Date; [k: string]: unknown }>;
  receipts?: Array<{ id: string; docNumber: string; qtyReceived: unknown; qtyRejected?: unknown; qtyAccepted: unknown; materialCost?: unknown; serviceCost?: unknown; additionalCost?: unknown; avgCostPerUnit?: unknown; totalCostValue?: unknown; receivedAt: Date; [k: string]: unknown }>;
  returns?: unknown[];
  steps?: Array<{
    id: string;
    sequence: number;
    supplierId: string;
    stepName: string | null;
    servicePrice: unknown;
    qty: unknown;
    totalCost: unknown;
    issueDocNumber: string | null;
    receiptDocNumber: string | null;
    issuedAt: Date | null;
    receivedAt: Date | null;
    notes: string | null;
    supplier?: { id: string; name: string; code: string } | null;
  }>;
}) {
  const plan = parseConsumptionPlan(wo.consumptionPlan);
  const out: Record<string, unknown> = {
    id: wo.id,
    docNumber: wo.docNumber,
    poId: wo.poId ?? null,
    po: wo.po ?? null,
    vendorId: wo.vendorId,
    finishedGoodId: wo.finishedGoodId,
    consumptionMaterialId: (wo as { consumptionMaterialId?: string | null }).consumptionMaterialId ?? null,
    outputMode: wo.outputMode,
    plannedQty: Number(wo.plannedQty),
    expectedConsumption: wo.expectedConsumption != null ? Number(wo.expectedConsumption) : null,
    actualQty: wo.actualQty != null ? Number(wo.actualQty) : null,
    targetDate: wo.targetDate,
    status: wo.status,
    issuedAt: wo.issuedAt,
    completedAt: wo.completedAt,
    canceledAt: wo.canceledAt,
    canceledReason: wo.canceledReason,
    consumptionPlan: plan,
    skuBreakdown: (() => {
      const raw = wo.skuBreakdown;
      if (raw == null) return null;
      const parsed = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
      return parsed && typeof parsed === 'object' ? parsed : null;
    })(),
    rollBreakdown: (() => {
      const raw = wo.rollBreakdown;
      if (raw == null) return null;
      const parsed = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
      return Array.isArray(parsed) ? parsed : null;
    })(),
    notes: wo.notes,
    chainSnapshot: (wo as { chainSnapshot?: unknown }).chainSnapshot ?? null,
    chainTotalDays: (wo as { chainTotalDays?: number | null }).chainTotalDays ?? null,
    chainConfirmedStepIndex:
      (wo as { chainConfirmedStepIndex?: number | null }).chainConfirmedStepIndex ?? null,
    chainConfirmedAt: (wo as { chainConfirmedAt?: Date | null }).chainConfirmedAt ?? null,
    chainConfirmedSource:
      (wo as { chainConfirmedSource?: string | null }).chainConfirmedSource ?? null,
    actualLeadDays: (wo as { actualLeadDays?: number | null }).actualLeadDays ?? null,
    syncStatus: wo.syncStatus,
    createdById: wo.createdById,
    createdAt: wo.createdAt,
    updatedAt: wo.updatedAt,
    vendor: wo.vendor ?? undefined,
    finishedGood: serializeIncludedItemForClient(wo.finishedGood) as typeof wo.finishedGood,
    issues: (wo.issues ?? []).map((iss) => {
      const row = iss as Record<string, unknown>;
      return {
        id: iss.id,
        docNumber: iss.docNumber,
        woId: typeof row.woId === "string" ? row.woId : "",
        issueType: iss.issueType,
        isPartial: Boolean(row.isPartial),
        items: row.items ?? null,
        totalCost: Number(iss.totalCost),
        issuedAt: iss.issuedAt,
        notes: typeof row.notes === "string" ? row.notes : null,
        acknowledged: Boolean(row.acknowledged),
      };
    }),
    receipts: (wo.receipts ?? []).map((r) => ({
      id: r.id,
      docNumber: r.docNumber,
      woId: r.woId,
      receiptType: r.receiptType,
      qtyReceived: Number(r.qtyReceived),
      qtyRejected: r.qtyRejected != null ? Number(r.qtyRejected) : 0,
      qtyAccepted: Number(r.qtyAccepted),
      skuBreakdown: r.skuBreakdown ?? null,
      qcPassed: r.qcPassed ?? null,
      qcNotes: r.qcNotes ?? null,
      qcPhotos: r.qcPhotos ?? null,
      materialCost: r.materialCost != null ? Number(r.materialCost) : null,
      // Ongkos jahit & biaya tambahan (null = penerimaan sebelum keduanya masuk HPP).
      serviceCost: r.serviceCost != null ? Number(r.serviceCost) : null,
      additionalCost: r.additionalCost != null ? Number(r.additionalCost) : null,
      avgCostPerUnit: r.avgCostPerUnit != null ? Number(r.avgCostPerUnit) : null,
      totalCostValue: r.totalCostValue != null ? Number(r.totalCostValue) : null,
      receivedById: r.receivedById,
      receivedAt: r.receivedAt,
      syncStatus: r.syncStatus ?? null,
    })),
    returns: (wo.returns ?? []).map((r) => serializeVendorReturnForClient(r)),
    steps: (wo.steps ?? []).map((s) => ({
      ...s,
      servicePrice: Number(s.servicePrice),
      qty: s.qty != null ? Number(s.qty) : null,
      totalCost: s.totalCost != null ? Number(s.totalCost) : null,
    })),
  };
  return out;
}

const rollBreakdownItemSchema = z.object({
  /** The roll's material (#437); absent on entries made before rolls were per material = consumptionMaterialId. */
  itemId: idStr.optional(),
  /** The finished-good colour the roll is cut for (#410); null = variants without a resolved colour. */
  colorId: z.string().nullable().optional(),
  rollRef: z.string(),
  qty: z.number().nonnegative(),
  notes: z.string().optional(),
});
const skuBreakdownSingleSchema = z.object({
  variantSku: z.string().min(1),
  attributes: z.record(z.string(), z.string()).optional(),
});
const skuBreakdownRatioArraySchema = z
  .array(z.object({ variantSku: z.string().min(1), ratioPercent: z.number().min(0).max(100) }))
  .min(1)
  .refine((arr) => Math.abs(arr.reduce((s, x) => s + x.ratioPercent, 0) - 100) < 0.01, { message: 'Variant ratios must sum to 100%' });
const skuBreakdownSchema = z.union([skuBreakdownSingleSchema, skuBreakdownRatioArraySchema]);
const woStepSchema = z.object({
  sequence: z.number().int().positive(),
  supplierId: idStr,
  stepName: z.string().optional(),
  servicePrice: z.number().min(0).default(0),
  servicePpnIncluded: z.boolean().default(false),
  qty: z.number().positive().optional(),
  notes: z.string().optional(),
});
const woSchema = z
  .object({
    vendorId: idStr,
    outputMode: z.enum(['GENERIC', 'SKU']),
    plannedQty: z.number().positive(),
    expectedConsumption: z.number().positive().optional(),
    consumptionMaterialId: idStr.optional(),
    targetDate: z.date().optional(),
    finishedGoodId: idStr,
    poId: idStr.optional(),
    notes: z.string().optional(),
    rollBreakdown: z.array(rollBreakdownItemSchema).optional(),
    skuBreakdown: skuBreakdownSchema.optional(),
    steps: z.array(woStepSchema).optional(),
    hppMarginPercent: z.number().min(0).max(100).optional(),
    hppAdditionalCost: z.number().min(0).optional(),
  })
  .refine(
    (data) => {
      if (data.outputMode !== 'SKU') return true;
      if (data.skuBreakdown == null) return false;
      if (Array.isArray(data.skuBreakdown)) return data.skuBreakdown.length > 0;
      return (data.skuBreakdown as { variantSku?: string }).variantSku != null && (data.skuBreakdown as { variantSku: string }).variantSku.length > 0;
    },
    { message: 'Variant (SKU) is required when Output Mode is SKU', path: ['skuBreakdown'] }
  );

export type WOFormData = z.infer<typeof woSchema>;

/** Rolls are per material (#437) and per finished-good colour (#410): each must match a section of this plan. */
function assertRollsInPlan(rolls: WOFormData['rollBreakdown'], materialPlan: MaterialPlanItem[]) {
  for (const r of rolls ?? []) {
    if (!r.itemId) continue;
    const line = materialPlan.find((m) => m.itemId === r.itemId);
    if (!line) throw new Error(`Roll ${r.rollRef} is for a material that is not in this work order's plan`);
    if (r.colorId !== undefined && line.byColor && !line.byColor.some((c) => c.colorId === r.colorId)) {
      throw new Error(`Roll ${r.rollRef} is for a colour that is not in this work order's variant mix`);
    }
  }
}

/** A WO's consumptionPlan line; `byColor` is what the issue and roll screens split by colour (#410). */
function planSnapshotLine(m: MaterialPlanItem) {
  return {
    itemId: m.itemId,
    itemName: m.itemName,
    itemType: m.itemType,
    uomId: m.uomId,
    uomCode: m.uomCode,
    qtyRequired: m.qtyRequired.toNumber(),
    wastePercent: m.wastePercent.toNumber(),
    plannedQty: m.plannedQty.toNumber(),
    byColor: m.byColor?.map((c) => ({ colorId: c.colorId, colorName: c.colorName, plannedQty: c.plannedQty.toNumber() })),
    issuedQty: 0,
    returnedQty: 0,
  };
}

export async function createWorkOrder(
  data: WOFormData,
  userId: string,
  options?: { skipStockCheck?: boolean }
) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.WORK_ORDERS_CREATE);
  assertActor(session.user.id, userId);

  woSchema.parse(data);

  const plannedOutput = new Decimal(data.plannedQty);
  const materialPlan = await generateMaterialPlan(data.finishedGoodId, plannedOutput, {
    skuBreakdown: data.outputMode === 'SKU' ? data.skuBreakdown : null,
  });
  assertRollsInPlan(data.rollBreakdown, materialPlan);
  // A short WO is saved as DRAFT; `issueWorkOrder` refuses it until stock covers the BOM.
  // `skipStockCheck` (planning callers) is kept for their signature and no longer changes anything.
  void options;
  const shortageCount = materialPlan.filter((m) => m.shortage.gt(0)).length;

  async function runCreateTx(docNumber: string) {
    return prisma.$transaction(async (tx) => {

      const createData: Record<string, unknown> = {
        docNumber,
        vendorId: data.vendorId,
        finishedGoodId: data.finishedGoodId,
        consumptionMaterialId: data.consumptionMaterialId ?? null,
        outputMode: data.outputMode,
        plannedQty: data.plannedQty,
        expectedConsumption: data.expectedConsumption ?? undefined,
        targetDate: data.targetDate,
        poId: data.poId ?? null,
        notes: data.notes,
        hppMarginPercent: data.hppMarginPercent ?? null,
        hppAdditionalCost: data.hppAdditionalCost ?? null,
        createdById: userId,
        consumptionPlan: JSON.stringify(
          materialPlan.map(planSnapshotLine)
        ),
      };
      if (data.rollBreakdown && data.rollBreakdown.length > 0) {
        createData.rollBreakdown = JSON.stringify(data.rollBreakdown);
      }
      if (data.outputMode === 'SKU' && data.skuBreakdown) {
        createData.skuBreakdown = JSON.stringify(data.skuBreakdown);
      }
      const wo = await tx.workOrder.create({
        data: createData as any,
      });

      if (data.steps?.length) {
        await tx.workOrderStep.createMany({
          data: data.steps.map((step) => ({
            woId: wo.id,
            sequence: step.sequence,
            supplierId: step.supplierId,
            stepName: step.stepName ?? null,
            servicePrice: step.servicePrice,
            servicePpnIncluded: step.servicePpnIncluded ?? false,
            qty: null,
            totalCost: null,
            notes: step.notes ?? null,
          })),
        });
      }

      return { id: wo.id, docNumber };
    });
  }

  // Generate doc number outside the transaction so atomic UPDATE runs on main connection (avoids adapter/tx raw-query issues)
  let docNumber: string;
  let result: { id: string; docNumber: string };
  try {
    docNumber = await generateDocNumber('WO');
    result = await runCreateTx(docNumber);
    logAudit({
      userId,
      action: 'CREATE',
      entityType: 'WorkOrder',
      entityId: result.id,
      changes: { after: { docNumber: result.docNumber } },
    }).catch(() => {});
  } catch (err: unknown) {
    const isWorkOrderUniqueViolation =
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code?: string }).code === 'P2002' &&
      ((err as { meta?: { modelName?: string; target?: string[] } }).meta?.modelName === 'WorkOrder' ||
        (err as { meta?: { target?: string[] } }).meta?.target?.includes('docNumber'));
    if (!isWorkOrderUniqueViolation) throw err;

    /**
     * Resync the counter from the config as stored, not from assumptions about it: Settings →
     * Document Numbering edits the prefix and the reset period, so the numbers to scan and the
     * period they carry both follow the row. The failed `generateDocNumber` already created it.
     * The write never lowers the counter — rewinding would re-issue a number — and is a
     * compare-and-set, so a caller that advanced it meanwhile is not overwritten.
     */
    const config = await prisma.docNumberConfig.findUniqueOrThrow({ where: { docType: "WO" } });
    const period = docNumberPeriod(new Date());
    const existing = await prisma.workOrder.findMany({
      where: { docNumber: { startsWith: normalizePrefix(config.prefix) } },
      select: { docNumber: true },
    });
    const next = resyncedCounter(
      config,
      maxIssuedNumber(
        existing.map((row) => row.docNumber),
        config,
        period,
      ),
      period,
    );
    await prisma.docNumberConfig.updateMany({
      where: { docType: "WO", lastNumber: config.lastNumber },
      data: next,
    });
    docNumber = await generateDocNumber('WO');
    result = await runCreateTx(docNumber);
  }

  getActorName(userId)
    .then((triggeredByName) => notifyWOCreated(result.id, result.docNumber, triggeredByName))
    .catch(() => {});
  return { ...result, shortageCount };
}

/*
 * Ubah WO (hanya DRAFT). Penolakan DIKEMBALIKAN sebagai `{ ok:false, code }`
 * (`productionErrors.<kode>` di i18n) — pesan lemparan aksi server disamarkan
 * di build produksi.
 *
 * Penjaga DRAFT dibaca DI DALAM `runSerializable` yang sama dengan tulisannya:
 * dulu dibaca di luar transaksi, jadi bahan yang dikeluarkan di antaranya
 * (keluarkan bahan boleh untuk WO draf dan menjadikannya IN_PRODUCTION) hilang
 * karena rencana ditulis ulang dengan issuedQty 0. Kini salah satunya konflik
 * dan diulang; yang diulang melihat IN_PRODUCTION dan ditolak. issuedQty /
 * returnedQty yang sudah tercatat di rencana juga dipertahankan per barang.
 */
export type KodeTolakUbahWo = 'TANPA_AKSES' | 'DATA_TIDAK_VALID' | 'WO_TIDAK_DITEMUKAN' | 'WO_BUKAN_DRAF' | 'GAGAL';
export type UbahWorkOrderResult =
  | { ok: true; id: string; docNumber: string }
  | { ok: false; code: KodeTolakUbahWo }
  /** Rencana bahan baru melebihi stok: per barang, kekurangannya (2 desimal) dan satuannya. */
  | { ok: false; code: 'STOK_RENCANA_KURANG'; kurang: Array<{ barang: string; qty: number; satuan: string }> };

class UbahWoDitolak extends Error {
  constructor(readonly code: 'WO_TIDAK_DITEMUKAN' | 'WO_BUKAN_DRAF') {
    super(code);
    this.name = 'UbahWoDitolak';
  }
}

export async function updateWorkOrder(woId: string, data: WOFormData, _userId?: string): Promise<UbahWorkOrderResult> {
  void _userId;
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.WORK_ORDERS_MANAGE)) {
    return { ok: false, code: 'TANPA_AKSES' };
  }
  if (!woSchema.safeParse(data).success) return { ok: false, code: 'DATA_TIDAK_VALID' };

  let docNumber: string;
  try {
    // Rencana bahan di luar transaksi: hanya membaca BOM & stok. WO yang kurang stok tetap
    // tersimpan sebagai DRAF; `issueWorkOrder` yang menolaknya sampai stok menutup BOM.
    const plannedOutput = new Decimal(data.plannedQty);
    const materialPlan = await generateMaterialPlan(data.finishedGoodId, plannedOutput, {
      skuBreakdown: data.outputMode === 'SKU' ? data.skuBreakdown : null,
    });
    assertRollsInPlan(data.rollBreakdown, materialPlan);

    docNumber = await runSerializable(async (tx) => {
      // The lock Request Item conversion takes, so it cannot claim lines sized for the old plan
      // between this edit and the request resize below.
      await tx.$queryRaw`SELECT \`id\` FROM \`WorkOrder\` WHERE \`id\` = ${woId} FOR UPDATE`;
      const existing = await tx.workOrder.findUnique({
        where: { id: woId },
        select: { status: true, docNumber: true, consumptionPlan: true },
      });
      if (!existing) throw new UbahWoDitolak('WO_TIDAK_DITEMUKAN');
      if (existing.status !== 'DRAFT') throw new UbahWoDitolak('WO_BUKAN_DRAF');

      // Qty keluar/kembali yang sudah tercatat per barang tidak ditimpa 0.
      const sudahTercatat = new Map<string, { issuedQty: number; returnedQty: number }>();
      for (const baris of parseConsumptionPlan(existing.consumptionPlan) as Array<Record<string, unknown> | null>) {
        if (!baris || typeof baris.itemId !== 'string') continue;
        const sebelum = sudahTercatat.get(baris.itemId) ?? { issuedQty: 0, returnedQty: 0 };
        sudahTercatat.set(baris.itemId, {
          issuedQty: sebelum.issuedQty + (Number(baris.issuedQty) || 0),
          returnedQty: sebelum.returnedQty + (Number(baris.returnedQty) || 0),
        });
      }

      const updateData: Record<string, unknown> = {
        vendorId: data.vendorId,
        finishedGoodId: data.finishedGoodId,
        consumptionMaterialId: data.consumptionMaterialId ?? null,
        outputMode: data.outputMode,
        plannedQty: data.plannedQty,
        expectedConsumption: data.expectedConsumption ?? undefined,
        targetDate: data.targetDate ?? null,
        poId: data.poId ?? null,
        notes: data.notes ?? null,
        consumptionPlan: JSON.stringify(
          materialPlan.map((m) => ({
            ...planSnapshotLine(m),
            issuedQty: sudahTercatat.get(m.itemId)?.issuedQty ?? 0,
            returnedQty: sudahTercatat.get(m.itemId)?.returnedQty ?? 0,
          }))
        ),
      };
      if (data.rollBreakdown && data.rollBreakdown.length > 0) {
        updateData.rollBreakdown = JSON.stringify(data.rollBreakdown);
      } else {
        updateData.rollBreakdown = null;
      }
      if (data.outputMode === 'SKU' && data.skuBreakdown) {
        updateData.skuBreakdown = JSON.stringify(data.skuBreakdown);
      } else {
        updateData.skuBreakdown = null;
      }

      await tx.workOrder.update({
        where: { id: woId },
        data: updateData as any,
      });

      await tx.workOrderStep.deleteMany({ where: { woId } });
      if (data.steps?.length) {
        await tx.workOrderStep.createMany({
          data: data.steps.map((step) => ({
            woId,
            sequence: step.sequence,
            supplierId: step.supplierId,
            stepName: step.stepName ?? null,
            servicePrice: step.servicePrice,
            servicePpnIncluded: step.servicePpnIncluded ?? false,
            qty: null,
            totalCost: null,
            notes: step.notes ?? null,
          })),
        });
      }

      // An OPEN Request Item was sized for the old plan; resize it so purchasing buys the new gap.
      await syncRequestForWo(tx, woId);

      return existing.docNumber;
    }, { timeout: 20_000 });
  } catch (error) {
    if (error instanceof UbahWoDitolak) return { ok: false, code: error.code };
    console.error('[updateWorkOrder]', error);
    return { ok: false, code: 'GAGAL' };
  }

  revalidatePath('/backoffice/work-orders');
  revalidatePath(`/backoffice/work-orders/${woId}`);
  return { ok: true, id: woId, docNumber };
}

export async function updateWOHppAdjustments(
  woId: string,
  data: { hppMarginPercent?: number; hppAdditionalCost?: number }
) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  if (session.user.role !== 'ADMIN') {
    throw new Error('Only owner/admin can update HPP adjustments');
  }
  const existing = await prisma.workOrder.findUnique({
    where: { id: woId },
    select: { hppMarginPercent: true, hppAdditionalCost: true },
  });
  if (!existing) throw new Error('Work order not found');

  const updated = await prisma.workOrder.update({
    where: { id: woId },
    data: {
      hppMarginPercent: data.hppMarginPercent ?? null,
      hppAdditionalCost: data.hppAdditionalCost ?? null,
    },
  });

  const before = {
    hppMarginPercent: existing.hppMarginPercent != null ? Number(existing.hppMarginPercent) : null,
    hppAdditionalCost: existing.hppAdditionalCost != null ? Number(existing.hppAdditionalCost) : null,
  };
  const after = {
    hppMarginPercent: updated.hppMarginPercent != null ? Number(updated.hppMarginPercent) : null,
    hppAdditionalCost: updated.hppAdditionalCost != null ? Number(updated.hppAdditionalCost) : null,
  };
  await logAudit({
    userId: session.user.id,
    action: 'UPDATE_HPP',
    entityType: 'WorkOrder',
    entityId: woId,
    changes: { before, after },
  });

  revalidatePath(`/backoffice/work-orders/${woId}`);
  return serializeWorkOrder(updated as any);
}

/**
 * Kode penolakan dari galat yang dilempar — hanya bila kodenya ada di `pesan`
 * (galat Prisma juga membawa `code`, mis. P2002, dan itu bukan penolakan).
 */
function kodeTolakDari<K extends string>(error: unknown, pesan: Record<K, string>): K | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(pesan, code) ? (code as K) : null;
}

/** Penolakan berkode untuk menerbitkan WO (DRAFT → ISSUED). */
const PESAN_TOLAK_TERBIT_WO = {
  WO_TIDAK_DITEMUKAN: 'Perintah kerja tidak ditemukan.',
  WO_SUDAH_DIBATALKAN: 'Perintah kerja ini sudah dibatalkan, jadi tidak bisa diterbitkan.',
  WO_SUDAH_TERBIT: 'Perintah kerja ini sudah diterbitkan.',
  STOK_BELUM_CUKUP: 'Stok bahan belum cukup untuk menerbitkan perintah kerja ini.',
} as const;

function tolakTerbitWo(code: keyof typeof PESAN_TOLAK_TERBIT_WO) {
  return Object.assign(new Error(PESAN_TOLAK_TERBIT_WO[code]), { code });
}

export type KodeTolakTerbitWo = 'TANPA_AKSES' | keyof typeof PESAN_TOLAK_TERBIT_WO | 'GAGAL';
export type TerbitkanWorkOrderResult = { ok: true } | { ok: false; code: KodeTolakTerbitWo };

/**
 * DRAFT → ISSUED. Penjaga DRAFT dibaca DI DALAM `runSerializable` yang sama
 * dengan penulisannya: dulu dibaca di luar transaksi, jadi "terbitkan" yang
 * kalah cepat dari pembatalan menghidupkan WO batal menjadi ISSUED. Kini
 * salah satunya konflik dan diulang; yang diulang melihat CANCELLED/ISSUED.
 *
 * Penolakan DILEMPAR ber-`code` untuk pemanggil lama yang menangkap lemparan;
 * layar sebaiknya memakai `terbitkanWorkOrder`. Pelaku notifikasi dari sesi.
 */
export async function issueWorkOrder(id: string, claimedUserId?: string) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.WORK_ORDERS_MANAGE);
  if (claimedUserId) assertActor(session.user.id, claimedUserId);
  const userId = session.user.id;

  const docNumber = await runSerializable(async (tx) => {
    // Re-read under the WO row lock: serializes a double click and a concurrent WO edit or a
    // Request Item conversion. The stock re-check reads committed on-hand without locking it, so
    // it narrows but does not close the window for a stock move (no reservation on Issue).
    await tx.$queryRaw`SELECT \`id\` FROM \`WorkOrder\` WHERE \`id\` = ${id} FOR UPDATE`;
    const wo = await tx.workOrder.findUnique({
      where: { id },
      select: {
        status: true,
        docNumber: true,
        vendorId: true,
        plannedQty: true,
        finishedGoodId: true,
        outputMode: true,
        skuBreakdown: true,
      },
    });
    if (!wo) throw tolakTerbitWo('WO_TIDAK_DITEMUKAN');
    if (wo.status === 'CANCELLED') throw tolakTerbitWo('WO_SUDAH_DIBATALKAN');
    if (wo.status !== 'DRAFT') throw tolakTerbitWo('WO_SUDAH_TERBIT');
    // Live check, not a stored flag: the WO unlocks by itself once receipts cover the BOM.
    const shortages = await getWoShortages(wo);
    if (shortages.length > 0) {
      throw Object.assign(new Error(`Stok belum cukup untuk issue: ${formatShortages(shortages)}`), {
        code: 'STOK_BELUM_CUKUP' as const,
      });
    }

    // From the locked row, so a vendor or qty edit made meanwhile is what gets snapshotted.
    const lt = await resolveWoLeadTimeFields(tx, wo.vendorId, Number(wo.plannedQty));

    await tx.workOrder.update({
      where: { id },
      data: {
        status: 'ISSUED',
        issuedAt: new Date(),
        ...(lt.chainSnapshot
          ? {
              chainSnapshot: lt.chainSnapshot,
              chainTotalDays: lt.chainTotalDays,
            }
          : {}),
      }
    });
    // Stock covers the BOM now, so nothing left on its Request Item needs buying.
    await cancelOpenLinesForWo(tx, id);
    return wo.docNumber;
  });

  getActorName(userId)
    .then((triggeredByName) =>
      notifyWOStatusUpdated(id, docNumber, 'DRAFT', 'ISSUED', triggeredByName)
    )
    .catch(() => {});

  revalidatePath('/backoffice/work-orders');
  revalidatePath(`/backoffice/work-orders/${id}`);
}

/**
 * BOM shortages blocking a DRAFT WO from being issued, its Request Item (the OPEN one, else the
 * latest live one), and what purchasing can do: `create` a request for a gap nothing covers, or
 * `update` the OPEN request when its lines no longer match the gap (a stock move or PO change).
 */
export async function getWorkOrderShortages(woId: string): Promise<{
  shortages: WoShortage[];
  request: { id: string; docNumber: string; status: string } | null;
  requestAction: 'create' | 'update' | null;
}> {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.WORK_ORDERS_VIEW);

  const wo = await prisma.workOrder.findUnique({
    where: { id: woId },
    select: { status: true, finishedGoodId: true, plannedQty: true, outputMode: true, skuBreakdown: true },
  });
  if (!wo || wo.status !== 'DRAFT') return { shortages: [], request: null, requestAction: null };

  const [shortages, requests] = await Promise.all([
    getWoShortages(wo),
    prisma.itemRequest.findMany({
      where: { sourceWoId: woId, status: { not: 'CANCELLED' } },
      select: {
        id: true,
        docNumber: true,
        status: true,
        lines: { where: { status: { in: ['OPEN', 'CANCELLED'] } }, select: { itemId: true, qty: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const uncovered = await getUncoveredShortages(prisma, woId, shortages);
  const open = requests.find((r) => r.status === 'OPEN');
  const shown = open ?? requests[0] ?? null;
  const request = shown ? { id: shown.id, docNumber: shown.docNumber, status: shown.status } : null;
  if (!open) return { shortages, request, requestAction: uncovered.length > 0 ? 'create' : null };

  // Same rule as the sync: a material purchasing cancelled on this request is not wanted back.
  const cancelled = new Set(open.lines.filter((l) => l.status === 'CANCELLED').map((l) => l.itemId));
  const openLines = open.lines.filter((l) => l.status === 'OPEN');
  const want = new Map(uncovered.filter((u) => !cancelled.has(u.itemId)).map((u) => [u.itemId, u.shortage]));
  const inSync =
    openLines.length === want.size && openLines.every((l) => want.get(l.itemId) === Number(l.qty));
  return { shortages, request, requestAction: inSync ? null : 'update' };
}

/**
 * `issueWorkOrder` untuk layar: penolakan DIKEMBALIKAN sebagai
 * `{ ok:false, code }` — di build produksi Next menyamarkan pesan lemparan
 * aksi server, jadi layar hanya bisa menjelaskan alasannya lewat kode.
 */
export async function terbitkanWorkOrder(id: string): Promise<TerbitkanWorkOrderResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.WORK_ORDERS_MANAGE)) {
    return { ok: false, code: 'TANPA_AKSES' };
  }
  try {
    await issueWorkOrder(id);
    return { ok: true };
  } catch (error) {
    const code = kodeTolakDari(error, PESAN_TOLAK_TERBIT_WO);
    if (code) return { ok: false, code };
    console.error('[terbitkanWorkOrder]', error);
    return { ok: false, code: 'GAGAL' };
  }
}

const issueSchema = z.object({
  woId: idStr,
  items: z
    .array(
      z.object({
        itemId: idStr,
        variantSku: z.string().optional(),
        qty: z.number().positive(),
        uomId: idStr,
        unitPrice: z.number().positive().optional()
      })
    )
    .min(1),
  issueType: z.enum(['FABRIC', 'ACCESSORIES']),
  isPartial: z.boolean().default(false),
  parentIssueId: idStr.optional(),
  notes: z.string().optional(),
  rollBreakdown: z.array(rollBreakdownItemSchema).optional(),
  /** Kunci idempotensi per isian formulir (dibuat sekali di layar, dipakai ulang saat simpan diulang). */
  idempotencyKey: z.string().trim().min(8).max(100).optional(),
});

export type IssueFormData = z.infer<typeof issueSchema>;

/*
 * Kunci idempotensi pengeluaran bahan: kolom unik `MaterialIssue.idempotencyKey`
 * berisi `<woId>:<kunci>` — kunci formulir berlaku per WO, jadi kunci yang sama
 * di WO lain tetap isian baru. Dua kiriman kembar yang lolos pembacaan kunci
 * bersamaan bentrok di indeks unik, dan yang kalah membaca pemenangnya.
 *
 * Sebelum kolom itu ada (2026-10-06), kuncinya hanya di `AuditLog`
 * (`MATERIAL_ISSUED`, entitas = WO, metadata membawa kunci + hasilnya). Baris itu
 * tetap ditulis sebagai jejak, dan tetap dibaca sebagai cadangan supaya kunci
 * pengeluaran lama yang dikirim ulang dikenali.
 */
const AKSI_KELUAR_BAHAN = 'MATERIAL_ISSUED';
type HasilKeluarBahan = { id: string; docNumber: string; totalCost: number };

/** Nilai kolom `MaterialIssue.idempotencyKey` untuk kunci formulir di satu WO. */
function kunciKolomPengeluaran(woId: string, kunci: string): string {
  return `${woId}:${kunci}`;
}

async function pengeluaranDenganKunci(
  client: Pick<typeof prisma, 'auditLog' | 'materialIssue'>,
  woId: string,
  kunci: string
): Promise<HasilKeluarBahan | null> {
  const baris = await client.materialIssue.findUnique({
    where: { idempotencyKey: kunciKolomPengeluaran(woId, kunci) },
    select: { id: true, docNumber: true, totalCost: true },
  });
  if (baris) return { id: baris.id, docNumber: baris.docNumber, totalCost: Number(baris.totalCost) };

  // Cadangan untuk pengeluaran lama (sebelum kolom kunci): dicocokkan di JS —
  // penyaringan jalur JSON tidak andal di semua adaptor; barisnya sedikit per WO.
  const jejak = await client.auditLog.findMany({
    where: { entityType: 'WorkOrder', entityId: woId, action: AKSI_KELUAR_BAHAN },
    select: { metadata: true },
  });
  for (const j of jejak) {
    let meta: unknown = j.metadata;
    if (typeof meta === 'string') {
      try {
        meta = JSON.parse(meta);
      } catch {
        continue;
      }
    }
    const m = meta as { kunciIdempotensi?: unknown; issueId?: unknown; docNumber?: unknown; totalCost?: unknown } | null;
    if (m?.kunciIdempotensi === kunci && typeof m.issueId === 'string') {
      return { id: m.issueId, docNumber: String(m.docNumber ?? ''), totalCost: Number(m.totalCost ?? 0) };
    }
  }
  return null;
}

/**
 * Penolakan berkode untuk mengeluarkan bahan. `issueMaterials` MELEMPARnya
 * (pemanggil lain, mis. `issueAdditionalMaterials`, menangkap lemparan);
 * layar keluarkan bahan memakai `keluarkanBahan`, yang mengembalikannya sebagai
 * `{ ok:false, code, ...rincian }`.
 */
const PESAN_TOLAK_KELUAR_BAHAN = {
  WO_TIDAK_DITEMUKAN: 'Perintah kerja tidak ditemukan.',
  BAHAN_WO_DIBATALKAN: 'Perintah kerja ini sudah dibatalkan, jadi bahan tidak bisa dikeluarkan.',
  BAHAN_WO_SELESAI: 'Perintah kerja ini sudah menerima barang jadi atau selesai, jadi bahan tidak bisa dikeluarkan lagi.',
  STOK_BAHAN_KURANG: 'Stok bahan tidak mencukupi.',
  ROLL_KURANG_DARI_KAIN: 'Total roll kurang dari qty kain yang dikeluarkan.',
  ROLL_TIDAK_CUKUP: 'Roll yang dipilih tidak cukup untuk qty kain yang dikeluarkan.',
} as const;

/** Rincian penolakan yang ikut ke layar (nama barang, qty roll vs kain). */
type RincianTolakKeluarBahan = { barang?: string; roll?: number; kain?: number; kurang?: number };

function tolakKeluarBahan(
  code: keyof typeof PESAN_TOLAK_KELUAR_BAHAN,
  rincian?: RincianTolakKeluarBahan,
  pesan: string = PESAN_TOLAK_KELUAR_BAHAN[code],
) {
  return Object.assign(new Error(pesan), { code, rincian });
}

export type KodeTolakKeluarBahan = 'TANPA_AKSES' | keyof typeof PESAN_TOLAK_KELUAR_BAHAN | 'GAGAL';
export type KeluarkanBahanResult =
  | { ok: true; id: string; docNumber: string; totalCost: number }
  | ({ ok: false; code: KodeTolakKeluarBahan } & RincianTolakKeluarBahan);

/**
 * Penjaga status WO, pengurangan stok bahan, dan penulisan IN_PRODUCTION satu
 * `runSerializable`: dulu read-committed, jadi pembatalan WO yang commit di
 * tengahnya tertimpa IN_PRODUCTION. Kini salah satunya konflik dan diulang;
 * yang diulang melihat CANCELLED dan ditolak sebelum stok disentuh.
 */
export async function issueMaterials(data: IssueFormData, claimedUserId?: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.WORK_ORDERS_MANAGE);
  if (claimedUserId) assertActor(session.user.id, claimedUserId);
  // Pelaku dari sesi, bukan dari argumen kiriman pemanggil.
  const userId = session.user.id;

  const validated = issueSchema.parse(data);
  const kunci = validated.idempotencyKey ?? null;

  const keluarkan = () => runSerializable(async (tx) => {
    // Kunci PALING DULU: pengeluaran yang sudah tercatat dikembalikan apa adanya,
    // sebelum penjaga status/stok (WO bisa sudah berubah sejak simpan pertama).
    if (kunci) {
      const lama = await pengeluaranDenganKunci(tx, validated.woId, kunci);
      if (lama) return { hasil: lama, ulangan: true };
    }

    const wo = await tx.workOrder.findUnique({
      where: { id: data.woId },
      select: { status: true, consumptionPlan: true, docNumber: true, poId: true, consumptionMaterialId: true, rollBreakdown: true }
    });

    if (!wo) throw tolakKeluarBahan('WO_TIDAK_DITEMUKAN');
    if (wo.status === 'CANCELLED') throw tolakKeluarBahan('BAHAN_WO_DIBATALKAN');
    if (!['DRAFT', 'ISSUED', 'IN_PRODUCTION'].includes(wo.status)) {
      throw tolakKeluarBahan('BAHAN_WO_SELESAI');
    }

    const docNumber = await generateDocNumber('ISSUE', tx);
    let totalCost = new Decimal(0);
    const issueItemsForJson: Array<{
      itemId: string;
      qty: number;
      uomId: string;
      avgCostAtIssue: number;
      ppnIncluded?: boolean;
      totalCost: number;
      sellingPrice?: number;
      totalSellingPrice?: number;
    }> = [];

    // Created ahead of the deduction loop so its id is a real ledger ref for the moveMainStock
    // calls below — the same read-then-write ordering per row as before this row existed, so a
    // duplicate item/variant in one payload still re-reads post-deduction stock on its second
    // occurrence. items/totalCost are placeholders patched in below once the loop has computed
    // them (mirrors the tx.gRN.update patch in grn.ts for the same reason).
    const issue = await tx.materialIssue.create({
      data: {
        docNumber,
        woId: data.woId,
        issueType: data.issueType,
        isPartial: data.isPartial,
        parentIssueId: data.parentIssueId ?? undefined,
        notes: data.notes ?? undefined,
        items: JSON.stringify([]),
        totalCost: 0,
        issuedById: userId,
        idempotencyKey: kunci ? kunciKolomPengeluaran(data.woId, kunci) : null,
      }
    });

    for (const item of validated.items) {
      const variantKey = item.variantSku != null && item.variantSku !== '' ? item.variantSku : '';
      const itemRow = await tx.item.findUnique({
        where: { id: item.itemId },
        select: { nameId: true, defaultPpnIncluded: true }
      });

      // Multi-variant / aggregate fallback: use total stock across all variant rows when no single row or single row has insufficient qty (matches material plan)
      const allRows = await tx.inventoryValue.findMany({
        where: { itemId: item.itemId },
      });
      const normalized = allRows.map((r) => ({
        id: r.id,
        itemId: r.itemId,
        variantSku: r.variantSku,
        qtyOnHand: Number(r.qtyOnHand),
        avgCost: Number(r.avgCost),
      }));
      const totalStock = normalized.reduce((s, r) => s + r.qtyOnHand, 0);
      if (totalStock < item.qty) {
        const barang = itemRow?.nameId || item.itemId;
        throw tolakKeluarBahan('STOK_BAHAN_KURANG', { barang }, `Stok tidak mencukupi untuk ${barang}`);
      }
      // Prefer exact match (variantKey or null) then ''/null first, then by qty desc
      const preferOrder = (r: { variantSku: string | null }) => {
        if (variantKey === '' && (r.variantSku == null || r.variantSku === '')) return 0;
        if (r.variantSku == null || r.variantSku === '') return 1;
        if (r.variantSku === variantKey) return 0;
        return 2;
      };
      const rowsToUse = normalized.sort((a, b) => {
        const pa = preferOrder(a);
        const pb = preferOrder(b);
        if (pa !== pb) return pa - pb;
        return b.qtyOnHand - a.qtyOnHand;
      });

      // Nilai yang dicatat = nilai yang BENAR-BENAR keluar dari stok (qty × biaya
      // rata-rata baris gudangnya, dalam sen) — sama dengan kartu stok bahan, jadi
      // biaya bahan yang dipikul barang jadi (dan dikredit dari persediaan bahan
      // di jurnal penerimaan) sama dengan yang keluar dari gudang. Dulu dicatat
      // dengan harga ketik / harga PO (+PPN), yang menyimpang dari kartu stok.
      let remainingToDeduct = item.qty;
      let nilaiKeluarBaris = new Decimal(0);
      for (const row of rowsToUse) {
        if (remainingToDeduct <= 0) break;
        const take = Math.min(row.qtyOnHand, remainingToDeduct);
        if (take <= 0) continue;
        const newQty = row.qtyOnHand - take;
        const newValue = newQty * row.avgCost;
        const nilaiGerak = new Decimal(take).mul(row.avgCost).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        const effectiveSku = row.variantSku ?? '';
        await moveMainStock(tx, {
          itemId: item.itemId,
          variantSku: effectiveSku,
          qtyDelta: -take,
          totalValue: newValue,
          totalCost: nilaiGerak.toNumber(),
          balanceValue: newValue,
          // Pins the write to the exact row this iteration just read — two rows in the same
          // null/"" bucket would otherwise let moveMainStock's own re-resolution collapse both
          // iterations onto one row, double-decrementing it.
          inventoryValueId: row.id,
          refType: 'MaterialIssue' satisfies StockLedgerRefType,
          refId: issue.id,
          refDocNumber: docNumber,
          createdById: userId,
        });
        nilaiKeluarBaris = nilaiKeluarBaris.plus(nilaiGerak);
        remainingToDeduct -= take;
      }

      const avgCostNum = item.qty > 0 ? nilaiKeluarBaris.div(item.qty).toNumber() : (rowsToUse[0]?.avgCost ?? 0);
      // Penanda PPN baris (dari PO WO ini, atau bawaan barang) hanya untuk
      // tampilan laporan HPP; tidak lagi mengubah nilai yang dicatat.
      let ppnIncluded = itemRow?.defaultPpnIncluded ?? true;
      if (wo.poId) {
        const poItem = await tx.pOItem.findFirst({
          where: { poId: wo.poId, itemId: item.itemId },
          select: { ppnIncluded: true },
        });
        if (poItem) ppnIncluded = poItem.ppnIncluded;
      }
      totalCost = totalCost.plus(nilaiKeluarBaris);

      // Harga ketik di layar (bila ada) tetap tersimpan untuk nota CMT, tetapi bukan nilai bahan.
      const sellingPrice = item.unitPrice != null && item.unitPrice > 0 ? item.unitPrice : undefined;
      const totalSellingPrice = sellingPrice != null ? sellingPrice * item.qty : undefined;
      issueItemsForJson.push({
        itemId: item.itemId,
        qty: item.qty,
        uomId: item.uomId,
        avgCostAtIssue: avgCostNum,
        ppnIncluded,
        totalCost: nilaiKeluarBaris.toNumber(),
        ...(sellingPrice != null && { sellingPrice, totalSellingPrice }),
      });
    }

    // Deduct from this issue's rolls, or the WO plan if the picker was left empty.
    // Do not overwrite WorkOrder.rollBreakdown — that field is the planned allocation.
    // Rolls are per material (#437): each issued item draws only the rolls named for it.
    const consumptionMaterialId = (wo as { consumptionMaterialId?: string | null }).consumptionMaterialId ?? null;
    const parseRolls = (raw: unknown): RollEntry[] | null => {
      if (raw == null) return null;
      const arr = typeof raw === "string" ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
      return Array.isArray(arr) ? arr as RollEntry[] : null;
    };
    const explicitRolls = validated.rollBreakdown;
    const payloadRolls = explicitRolls != null && explicitRolls.length > 0 ? explicitRolls : null;
    const rollsToDeduct = explicitRolls !== undefined
      ? payloadRolls
      : parseRolls((wo as { rollBreakdown?: unknown }).rollBreakdown);

    if (payloadRolls) {
      const issuedByItem = new Map<string, number>();
      for (const item of validated.items) issuedByItem.set(item.itemId, (issuedByItem.get(item.itemId) ?? 0) + item.qty);
      const short = rollShortfalls(
        [...issuedByItem].map(([itemId, qty]) => ({ itemId, qty })),
        withRollItemIds(payloadRolls, consumptionMaterialId)
      )[0];
      if (short) {
        throw tolakKeluarBahan(
          'ROLL_KURANG_DARI_KAIN',
          { roll: short.allocated, kain: short.required },
          `Total roll (${short.allocated}) is less than issued qty (${short.required})`
        );
      }
    }

    for (const item of validated.items) {
      const itemRolls = rollsToDeduct != null ? rollsForItem(rollsToDeduct, item.itemId, consumptionMaterialId) : [];
      if (itemRolls.length > 0) {
        let remainingToAllocate = item.qty;
        for (const entry of itemRolls) {
          if (remainingToAllocate <= 0) break;
          const roll = await tx.fabricRoll.findFirst({
            where: {
              itemId: item.itemId,
              remainingLength: { gt: 0 },
              isClosed: false,
              OR: [
                { rollCode: entry.rollRef },
                { rollRef: entry.rollRef }
              ]
            },
            select: { id: true, remainingLength: true }
          });
          if (!roll) continue;
          const currentRemaining = new Decimal(roll.remainingLength.toString());
          const deduct = Decimal.min(new Decimal(remainingToAllocate), currentRemaining).toNumber();
          if (deduct <= 0) continue;
          const newRemaining = currentRemaining.minus(deduct).toNumber();
          await tx.fabricRoll.update({
            where: { id: roll.id },
            data: { remainingLength: newRemaining }
          });
          remainingToAllocate -= deduct;
        }
        if (payloadRolls != null && remainingToAllocate > 1e-6) {
          throw tolakKeluarBahan(
            'ROLL_TIDAK_CUKUP',
            { kurang: remainingToAllocate },
            `Selected rolls cannot cover issued qty (short ${remainingToAllocate})`
          );
        }
      }
    }

    // Patches in the real snapshot now that the loop above has computed it — the row itself
    // (and every moveMainStock ledger entry's refId) was already created before that loop.
    const patchedIssue = await tx.materialIssue.update({
      where: { id: issue.id },
      data: {
        items: JSON.stringify(issueItemsForJson),
        totalCost: totalCost.toNumber(),
      },
      select: { totalCost: true },
    });

    const plan = parseConsumptionPlan(wo.consumptionPlan) as Array<{ itemId: string; issuedQty?: number }>;
    for (const issued of validated.items) {
      const planItem = plan.find((p) => p.itemId === issued.itemId);
      if (planItem) {
        planItem.issuedQty = (planItem.issuedQty || 0) + issued.qty;
      }
    }

    await tx.workOrder.update({
      where: { id: data.woId },
      data: {
        consumptionPlan: JSON.stringify(plan),
        status: 'IN_PRODUCTION'
      }
    });

    const hasil: HasilKeluarBahan = {
      id: issue.id,
      docNumber: issue.docNumber,
      // Reads the value as persisted (Decimal(15,2), rounded by the DB) from the patch update's
      // own return, not the unrounded totalCost accumulator — the two can differ past 2dp.
      totalCost: Number(patchedIssue.totalCost),
    };
    if (kunci) {
      await tx.auditLog.create({
        data: {
          userId,
          action: AKSI_KELUAR_BAHAN,
          entityType: 'WorkOrder',
          entityId: data.woId,
          metadata: { kunciIdempotensi: kunci, issueId: hasil.id, docNumber: hasil.docNumber, totalCost: hasil.totalCost },
        },
      });
    }
    return { hasil, ulangan: false };
  });
  let hasilTx: Awaited<ReturnType<typeof keluarkan>>;
  try {
    hasilTx = await keluarkan();
  } catch (err) {
    // Kembarannya commit lebih dulu dan bentrok di kolom kunci (tidak diulang
    // runSerializable): percobaan ini membaca kunci yang kini tercatat.
    if (!kunci || !bentrokKunciKiriman(err)) throw err;
    hasilTx = await keluarkan();
  }
  const { hasil: issueResult, ulangan } = hasilTx;
  revalidatePath(`/backoffice/work-orders/${data.woId}`);
  // Ulangan: bahan tidak keluar lagi, jadi notifikasi & sinyal tidak dikirim lagi.
  if (ulangan) return issueResult;

  const wo = await prisma.workOrder.findUnique({
    where: { id: data.woId },
    select: { docNumber: true },
  });
  if (wo) {
    getActorName(userId)
      .then((triggeredByName) =>
        notifyWOMaterialsIssued(data.woId, wo.docNumber, triggeredByName)
      )
      .catch(() => {});
  }
  void applyChainSignal(
    { type: "WO", id: data.woId },
    { kind: "MATERIAL_ISSUE" },
    userId
  ).catch((err) => {
    console.warn("[leadtime] auto-confirm after material issue failed", err);
  });
  return issueResult;
}

/**
 * The WO's accessories with their quantity per piece, from the WO's own material plan rather
 * than the current BOM: a colour/size-scoped rule (#437) only covers some of the WO's variants,
 * and the plan already averaged it over the WO's variant mix.
 */
async function accessoryPlanLines(consumptionPlan: unknown) {
  const plan = parseConsumptionPlan(consumptionPlan) as Array<{ itemId?: string; qtyRequired?: number }>;
  const ids = plan.map((line) => line.itemId).filter((id): id is string => !!id);
  const items = await prisma.item.findMany({
    where: { id: { in: ids }, type: 'ACCESSORIES' },
    select: { id: true, uomId: true, nameId: true },
  });
  const byId = new Map(items.map((item) => [item.id, item]));
  return plan
    .filter((line) => line.itemId != null && byId.has(line.itemId))
    .map((line) => ({
      materialId: line.itemId!,
      qtyRequired: Number(line.qtyRequired ?? 0),
      material: byId.get(line.itemId!)!,
    }));
}

/**
 * `issueMaterials` untuk layar keluarkan bahan: penolakan berkode (WO batal,
 * stok kurang, roll kurang, …) DIKEMBALIKAN sebagai `{ ok:false, code }` beserta
 * rinciannya — di build produksi Next menyamarkan pesan lemparan aksi server.
 * Pelaku dari sesi. Galat lain dicatat dan menjadi `GAGAL`.
 */
export async function keluarkanBahan(data: IssueFormData): Promise<KeluarkanBahanResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.WORK_ORDERS_MANAGE)) {
    return { ok: false, code: 'TANPA_AKSES' };
  }
  try {
    const hasil = await issueMaterials(data, session.user.id);
    return { ok: true, ...hasil };
  } catch (error) {
    const code = kodeTolakDari(error, PESAN_TOLAK_KELUAR_BAHAN);
    if (code) {
      const rincian = (error as { rincian?: RincianTolakKeluarBahan }).rincian;
      return { ok: false, code, ...rincian };
    }
    console.error('[keluarkanBahan]', error);
    return { ok: false, code: 'GAGAL' };
  }
}

/** Preview: accessory items and qty needed for additional pcs + stock availability. Used by Issue Additional Materials UI. */
export async function getAdditionalMaterialsPreview(woId: string, additionalQty: number) {
  await wajibBolehBaca(IZIN_BACA_WO);
  const wo = await prisma.workOrder.findUnique({
    where: { id: woId },
    select: { status: true, consumptionPlan: true },
  });
  if (!wo) throw new Error('Work Order not found');
  if (wo.status !== 'IN_PRODUCTION') {
    throw new Error('Issue Additional Materials is only available for work orders in production');
  }
  if (!Number.isInteger(additionalQty) || additionalQty <= 0) {
    throw new Error('Additional qty must be a positive integer');
  }

  const accessoryRules = await accessoryPlanLines(wo.consumptionPlan);
  if (accessoryRules.length === 0) {
    return { lines: [], totalAdditionalQty: additionalQty };
  }

  const lines: Array<{
    itemId: string;
    itemName: string;
    uomId: string;
    qtyNeeded: number;
    qtyOnHand: number;
    sufficient: boolean;
  }> = [];

  for (const rule of accessoryRules) {
    const qtyRequired = Number(rule.qtyRequired);
    const qtyNeeded = Math.ceil(qtyRequired * additionalQty);
    const stock = await prisma.inventoryValue.aggregate({
      where: { itemId: rule.materialId },
      _sum: { qtyOnHand: true },
    });
    const qtyOnHand = Number(stock._sum.qtyOnHand ?? 0);
    lines.push({
      itemId: rule.materialId,
      itemName: rule.material.nameId,
      uomId: rule.material.uomId,
      qtyNeeded,
      qtyOnHand,
      sufficient: qtyOnHand >= qtyNeeded,
    });
  }

  return { lines, totalAdditionalQty: additionalQty };
}

/*
 * Keluarkan aksesori tambahan untuk kelebihan produksi (plannedQty tetap).
 * Penolakan DIKEMBALIKAN sebagai kode (`productionErrors.<kode>`); stok dicek
 * oleh `issueMaterials` di dalam transaksinya (STOK_BAHAN_KURANG), bukan di
 * sini dari baca yang bisa basi. Pelaku dari sesi (`claimedUserId`, kalau dikirim, harus sama).
 */
export type KodeTolakBahanTambahan = 'WO_BUKAN_PRODUKSI' | 'QTY_TAMBAHAN_TIDAK_VALID' | 'TANPA_AKSESORI_BOM';
export type BahanTambahanResult = KeluarkanBahanResult | { ok: false; code: KodeTolakBahanTambahan };

export async function issueAdditionalMaterials(
  woId: string,
  additionalQty: number,
  claimedUserId?: string,
  idempotencyKey?: string
): Promise<BahanTambahanResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.WORK_ORDERS_MANAGE)) {
    return { ok: false, code: 'TANPA_AKSES' };
  }
  if (claimedUserId) assertActor(session.user.id, claimedUserId);
  const kunci = idempotencyKey?.trim() || null;

  let items: Array<{ itemId: string; qty: number; uomId: string }>;
  try {
    // Simpan ulang dengan kunci yang sama: hasil pertama, apa pun keadaan WO sekarang.
    if (kunci) {
      const lama = await pengeluaranDenganKunci(prisma, woId, kunci);
      if (lama) return { ok: true, ...lama };
    }
    if (!Number.isInteger(additionalQty) || additionalQty <= 0) {
      return { ok: false, code: 'QTY_TAMBAHAN_TIDAK_VALID' };
    }

    const wo = await prisma.workOrder.findUnique({
      where: { id: woId },
      select: { status: true, consumptionPlan: true },
    });
    if (!wo) return { ok: false, code: 'WO_TIDAK_DITEMUKAN' };
    if (wo.status !== 'IN_PRODUCTION') return { ok: false, code: 'WO_BUKAN_PRODUKSI' };

    // Accessories per piece come from the WO's own plan (#437), not the current BOM.
    const accessoryRules = await accessoryPlanLines(wo.consumptionPlan);
    if (accessoryRules.length === 0) return { ok: false, code: 'TANPA_AKSESORI_BOM' };

    items = accessoryRules.map((rule) => ({
      itemId: rule.materialId,
      qty: Math.ceil(Number(rule.qtyRequired) * additionalQty),
      uomId: rule.material.uomId,
    }));
  } catch (error) {
    console.error('[issueAdditionalMaterials]', error);
    return { ok: false, code: 'GAGAL' };
  }

  return keluarkanBahan({
    woId,
    items,
    issueType: 'ACCESSORIES',
    isPartial: true,
    notes: `Additional accessories for +${additionalQty} pcs over-production`,
    ...(kunci ? { idempotencyKey: kunci } : {}),
  });
}

/** Split allocation (PD6): create child issues linked to parent. Minimal stub. */
/* eslint-disable @typescript-eslint/no-unused-vars -- stub; params reserved for future impl */
export async function splitMaterialIssue(
  _originalIssueId: string,
  _splits: Array<{
    vendorId?: string;
    items: Array<{ itemId: string; qty: number }>;
  }>,
  _userId: string
): Promise<void> {
  throw new Error('Split material issue not yet implemented');
}
/* eslint-enable @typescript-eslint/no-unused-vars */

const receiptSkuBreakdownItemSchema = z.object({
  variantSku: z.string().min(1),
  qty: z.number().min(0),
});
const receiptSchema = z
  .object({
    woId: idStr,
    qtyReceived: z.number().positive(),
    qtyRejected: z.number().default(0),
    qcNotes: z.string().optional(),
    qcPhotos: z.array(z.string()).optional(),
    skuBreakdown: z.array(receiptSkuBreakdownItemSchema).optional(),
    rejectedSkuBreakdown: z.array(receiptSkuBreakdownItemSchema).optional(),
  })
  .refine(
    (data) => {
      if (data.skuBreakdown == null || data.skuBreakdown.length === 0) return true;
      const qtyAccepted = data.qtyReceived - (data.qtyRejected || 0);
      const sum = data.skuBreakdown.reduce((s, x) => s + x.qty, 0);
      return Math.abs(sum - qtyAccepted) < 0.01;
    },
    { message: 'Sum of variant qtys must equal total qty received', path: ['skuBreakdown'] }
  )
  .refine(
    (data) => {
      if (data.rejectedSkuBreakdown == null || data.rejectedSkuBreakdown.length === 0) return true;
      const qtyRejected = data.qtyRejected || 0;
      const sum = data.rejectedSkuBreakdown.reduce((s, x) => s + x.qty, 0);
      return Math.abs(sum - qtyRejected) < 0.01;
    },
    { message: 'Sum of rejected variant qtys must equal total qty rejected', path: ['rejectedSkuBreakdown'] }
  );

export type ReceiptFormData = z.infer<typeof receiptSchema>;

export type ReceiveFGResult =
  | { success: true; id: string; docNumber: string }
  | ReceiptRefusal;

export async function receiveFG(data: ReceiptFormData, claimedUserId?: string): Promise<ReceiveFGResult> {
  try {
    return { success: true, ...(await receiveFGInner(data, claimedUserId)) };
  } catch (error) {
    const refusal = toReceiptRefusal(error);
    if (refusal) return refusal;
    throw error;
  }
}

/**
 * Penerima selalu pengguna sesi; `claimedUserId`, kalau dikirim, harus sama
 * dengannya (`assertActor`).
 *
 * Penjaga status WO dan pembebanan biaya berjalan di `runSerializable`: batal
 * yang serentak membuat salah satunya konflik dan diulang dengan keadaan baru.
 */
async function receiveFGInner(data: ReceiptFormData, claimedUserId?: string) {
  const session = await auth();
  if (!session?.user?.id) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.WORK_ORDERS_MANAGE);
  if (claimedUserId) assertActor(session.user.id, claimedUserId);
  const userId = session.user.id;

  // Cacat adalah bagian dari setoran: tidak boleh negatif atau melebihi
  // setoran (dulu hanya dicegah layar; lewat aksi langsung qtyAccepted negatif).
  const cacatSetoran = Number(data?.qtyRejected ?? 0);
  if (!Number.isFinite(cacatSetoran) || cacatSetoran < 0 || cacatSetoran > Number(data?.qtyReceived)) {
    throw new ProduksiDitolakError('CACAT_MELEBIHI_SETORAN');
  }
  receiptSchema.parse(data);

  const receiveResult = await runSerializable(async (tx) => {
    // First statement, before any plain read fixes the snapshot: serializes with
    // completeWorkOrder so a close-short committing mid-receipt is seen, not overwritten.
    await tx.$queryRaw`SELECT \`id\` FROM \`WorkOrder\` WHERE \`id\` = ${data.woId} FOR UPDATE`;
    const qtyAccepted = data.qtyReceived - (data.qtyRejected || 0);

    const wo = await tx.workOrder.findUnique({
      where: { id: data.woId },
    });

    if (!wo) throw new WorkOrderNotFoundError();
    if (wo.status === 'CANCELLED') throw new ProduksiDitolakError('WO_DIBATALKAN');
    if (wo.status === 'DRAFT') throw new ProduksiDitolakError('WO_BELUM_TERBIT');

    const docNumber = await generateDocNumber('RECEIPT', tx);

    // Biaya lengkap penerimaan ini (keputusan sementara pemilik 34 — ongkos
    // jahit masuk HPP): bahan sebanding setoran (penerimaan penutup memikul
    // sisanya; bahan yang sudah kembali ke gudang tidak ikut), jasa langkah WO
    // dan biaya tambahan per pcs lolos. Dasarnya dibaca di transaksi ini juga.
    const dasarBiaya = await bacaDasarBiayaPenerimaan(tx, data.woId);
    if (!dasarBiaya) throw new ProduksiDitolakError('WO_TIDAK_DITEMUKAN');
    const tanggalTerima = new Date();
    const rincian = rincianBiayaPenerimaan(dasarBiaya, {
      qtyDiterima: data.qtyReceived,
      qtyLolos: Math.max(qtyAccepted, 0),
      tanggal: tanggalTerima,
    });
    const receiptCost = rincian.total;
    const avgCostPerUnit = rincian.perUnit;

    const receipt = await tx.fGReceipt.create({
      data: {
        docNumber,
        woId: data.woId,
        receiptType: wo.outputMode,
        qtyReceived: data.qtyReceived,
        qtyRejected: data.qtyRejected || 0,
        qtyAccepted,
        qcPassed: true,
        qcNotes: data.qcNotes,
        qcPhotos: data.qcPhotos ? JSON.stringify(data.qcPhotos) : null,
        skuBreakdown:
          data.skuBreakdown && data.skuBreakdown.length > 0
            ? data.skuBreakdown
            : undefined,
        // `serviceCost` = TAGIHAN jasa pemasok (hutang, termasuk PPN yang dipungutnya);
        // PPN Masukan = bahan + jasa + tambahan − totalCostValue (`komponenJurnalPenerimaan`).
        materialCost: rincian.bahan.toNumber(),
        serviceCost: rincian.jasa.tagihan.toNumber(),
        additionalCost: rincian.tambahan.toNumber(),
        avgCostPerUnit: avgCostPerUnit.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber(),
        totalCostValue: receiptCost.toNumber(),
        receivedById: userId,
        receivedAt: tanggalTerima,
      }
    });

    const newActualQty =
      (wo.actualQty?.toString() ? Number(wo.actualQty) : 0) + qtyAccepted;
    const plannedQty = Number(wo.plannedQty);
    const meetsTarget = newActualQty >= plannedQty;
    // A WO closed short by `completeWorkOrder` stays COMPLETED when a late receipt still
    // leaves it under plan, instead of dropping back to PARTIAL with a null completedAt.
    const completedNow = meetsTarget || wo.status === 'COMPLETED';
    const completedAt = completedNow ? (wo.completedAt ?? new Date()) : null;
    let actualLeadDays: number | undefined;
    if (
      completedNow &&
      wo.actualLeadDays == null &&
      wo.issuedAt != null
    ) {
      actualLeadDays = computeActualLeadDays(
        wo.issuedAt,
        completedAt ?? new Date()
      );
    }
    await tx.workOrder.update({
      where: { id: data.woId },
      data: {
        actualQty: newActualQty,
        status: completedNow ? 'COMPLETED' : 'PARTIAL',
        // Set once when WO first reaches Completed; keep on later over-production receipts
        completedAt,
        ...(actualLeadDays !== undefined ? { actualLeadDays } : {}),
      }
    });

    // Ringkasan per langkah di halaman WO: pcs lolos × harga per pcs (nilai jasa
    // sebelum PPN yang ditambahkan pemasok). Hutang jasa yang sebenarnya dijurnal
    // per penerimaan (`FGReceipt.serviceCost`, `lib/production/hutang-jasa-queries.ts`).
    const steps = await tx.workOrderStep.findMany({
      where: { woId: data.woId },
      select: { id: true, servicePrice: true },
    });
    for (const step of steps) {
      await tx.workOrderStep.update({
        where: { id: step.id },
        data: {
          qty: newActualQty,
          totalCost: new Decimal(step.servicePrice.toString())
            .mul(newActualQty)
            .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
            .toNumber(),
        },
      });
    }

    if (qtyAccepted > 0 && wo.finishedGoodId) {
      const hasPerVariantBreakdown = data.skuBreakdown && data.skuBreakdown.length > 0;
      if (hasPerVariantBreakdown) {
        // Biaya penerimaan dibagi per varian dalam sen (sisa terbesar): Σ kartu stok = biaya penerimaan.
        const rows = data.skuBreakdown!;
        const biayaBaris = bagiBiayaPerBaris(
          receiptCost,
          rows.map((row) => Math.max(row.qty, 0))
        );
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          if (row.qty <= 0) continue;
          const rowCost = biayaBaris[i];
          const rowUnitCost = rowCost.div(row.qty);
          await calculateMovingAverage(
            wo.finishedGoodId,
            new Decimal(row.qty),
            rowUnitCost,
            tx,
            row.variantSku,
            { refType: 'FGReceipt' satisfies StockLedgerRefType, refId: receipt.id, refDocNumber: docNumber, createdById: userId }
          );
        }
      } else {
        const fgVariantSku =
          wo.outputMode === 'SKU'
            ? (() => {
                const raw = typeof wo.skuBreakdown === 'string' ? JSON.parse(wo.skuBreakdown) : wo.skuBreakdown;
                if (Array.isArray(raw) && raw.length > 0) return (raw[0] as { variantSku?: string }).variantSku ?? null;
                return (raw as { variantSku?: string } | null)?.variantSku ?? null;
              })()
            : null;
        await calculateMovingAverage(
          wo.finishedGoodId,
          new Decimal(qtyAccepted),
          avgCostPerUnit,
          tx,
          fgVariantSku,
          { refType: 'FGReceipt' satisfies StockLedgerRefType, refId: receipt.id, refDocNumber: docNumber, createdById: userId }
        );
      }
    }

    if (data.qtyRejected > 0 && wo.finishedGoodId) {
      const hasRejectedBreakdown = data.rejectedSkuBreakdown && data.rejectedSkuBreakdown.length > 0;
      if (hasRejectedBreakdown) {
        for (const row of data.rejectedSkuBreakdown!) {
          if (row.qty <= 0) continue;
          await tx.rejectedGoodsLedger.create({
            data: {
              itemId: wo.finishedGoodId,
              variantSku: row.variantSku,
              qty: row.qty,
              refType: 'FG_RECEIPT',
              refId: receipt.id,
              refDocNumber: docNumber,
              woId: data.woId,
              receivedAt: receipt.receivedAt,
              notes: data.qcNotes ?? null,
            },
          });
        }
      } else {
        await tx.rejectedGoodsLedger.create({
          data: {
            itemId: wo.finishedGoodId,
            qty: data.qtyRejected,
            refType: 'FG_RECEIPT',
            refId: receipt.id,
            refDocNumber: docNumber,
            woId: data.woId,
            receivedAt: receipt.receivedAt,
            notes: data.qcNotes ?? null,
          },
        });
      }
    }

    const woCompleted = newActualQty >= Number(wo.plannedQty);

    // Harga jual TIDAK disentuh: pemilik mengisinya sendiri dari HPP (keputusan
    // pemilik 2026-10-08). HPP per pcs tampil di formulir barang.

    // Barang jadi yang stoknya bertambah — untuk push stok ke Jubelio sesudah commit.
    const fgStokBerubah = qtyAccepted > 0 ? wo.finishedGoodId : null;
    return { receipt, woCompleted, fgStokBerubah };
  });

  // Sesudah commit: kirim stok barang jadi ke Jubelio (best-effort, tidak pernah melempar).
  await antrekanPushStok([receiveResult.fgStokBerubah], {
    sumber: "FG_RECEIPT",
    ref: receiveResult.receipt.docNumber,
    userId,
  });

  if (receiveResult.woCompleted) {
    notifyWOCompleted(data.woId, userId).catch(() => {});
  } else {
    void applyChainSignal(
      { type: "WO", id: data.woId },
      { kind: "FG_PARTIAL" },
      userId
    ).catch((err) => {
      console.warn("[leadtime] auto-confirm after FG partial failed", err);
    });
  }
  // Jurnal sesudah commit, best-effort: tidak pernah menggagalkan penerimaan.
  // Gagal → JOURNAL_PENDING (posting ulang dari halaman WO, atau oleh sapuan).
  await postFgReceiptJournalAman(receiveResult.receipt.id, userId);

  return {
    id: receiveResult.receipt.id,
    docNumber: receiveResult.receipt.docNumber,
  };
}

export type TerimaBarangJadiResult =
  | { ok: true; id: string; docNumber: string }
  | { ok: false; code: KodeTolakProduksi | ReceiptRefusalCode };

/**
 * `receiveFG` untuk layar terima barang jadi: penolakan berkode (WO batal, WO
 * draf, …) DIKEMBALIKAN, bukan dilempar — di build produksi Next menyamarkan
 * pesan lemparan aksi server. Galat lain (izin, validasi) tetap dilempar.
 */
export async function terimaBarangJadi(data: ReceiptFormData): Promise<TerimaBarangJadiResult> {
  try {
    const r = await receiveFG(data);
    if (!r.success) {
      return { ok: false, code: r.code === 'WORK_ORDER_NOT_FOUND' ? 'WO_TIDAK_DITEMUKAN' : r.code };
    }
    return { ok: true, id: r.id, docNumber: r.docNumber };
  } catch (error) {
    if (error instanceof ProduksiDitolakError) return { ok: false, code: error.code };
    throw error;
  }
}

export async function postFgReceiptJournalAction(
  receiptId: string,
): Promise<HasilPostingPenerimaanFG | { ok: false; code: "FORBIDDEN" | "BAD_STATE" }> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.JOURNALS_MANAGE)) {
    return { ok: false, code: "FORBIDDEN" };
  }

  const receipt = await prisma.fGReceipt.findUnique({ where: { id: receiptId }, select: { woId: true } });
  if (!receipt) return { ok: false, code: "BAD_STATE" };

  // Berhasil → tanda "Jurnal gagal" penerimaan ini selesai (Beranda); gagal →
  // JOURNAL_PENDING (tanpa dobel). Tidak pernah melempar.
  const r = await postFgReceiptJournalAman(receiptId, session.user.id);
  revalidatePath(`/backoffice/work-orders/${receipt.woId}`);
  return r;
}

/**
 * Dasar pratinjau biaya di layar Terima barang jadi — angka yang sama dengan
 * yang akan dicatat `receiveFG` (`rincianBiayaPenerimaan`), termasuk ongkos
 * jahit dan pengaturan PPN. Izin sama dengan menerima barang jadi.
 */
export async function getDasarBiayaPenerimaan(woId: string): Promise<DasarBiayaPenerimaan | null> {
  await wajibBolehBaca([PERMISSIONS.WORK_ORDERS_MANAGE]);
  return bacaDasarBiayaPenerimaan(prisma, woId);
}

export type KodeTolakBatalWo =
  | 'TANPA_AKSES'
  | 'ALASAN_WAJIB'
  | 'ALASAN_TERLALU_PANJANG'
  | 'WO_TIDAK_DITEMUKAN'
  | 'WO_SUDAH_DIBATALKAN'
  | 'WO_SUDAH_ADA_PENERIMAAN'
  /** Masih ada bahan di CMT — kembalikan dulu lewat "Kembalikan bahan". */
  | 'WO_SUDAH_KELUAR_BAHAN'
  | 'GAGAL';

/** Bahan yang masih di CMT, disebut di penolakan pembatalan. */
export type BahanBelumKembali = { nama: string; qty: number; satuan: string };

export type CancelWorkOrderResult =
  | { ok: true }
  | { ok: false; code: Exclude<KodeTolakBatalWo, 'WO_SUDAH_KELUAR_BAHAN'> }
  | { ok: false; code: 'WO_SUDAH_KELUAR_BAHAN'; sisa: BahanBelumKembali[] };


/**
 * Penolakan DIKEMBALIKAN sebagai `{ ok:false, code }` — di build produksi Next
 * menyamarkan pesan lemparan aksi server, jadi tombol batal hanya bisa
 * menjelaskan alasannya lewat kode.
 *
 * Penjaga "belum ada penerimaan" dan "tidak ada bahan di CMT" dibaca DI DALAM
 * transaksi serializable yang sama dengan pembaruannya: penerimaan,
 * pengeluaran, atau pengembalian bahan yang commit di antara baca dan tulis
 * membuat salah satunya konflik dan diulang dengan keadaan baru.
 *
 * Bahan yang sudah keluar tidak lagi menghalangi selamanya: bila SEMUANYA
 * sudah kembali ke gudang ("Kembalikan bahan"), WO boleh dibatalkan. Selama
 * masih ada sisa di CMT, penolakannya menyebut bahan dan qty-nya. Alasan wajib.
 */
export async function cancelWorkOrder(
  id: string,
  claimedUserId: string,
  reason?: string
): Promise<CancelWorkOrderResult> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, code: 'TANPA_AKSES' };
  if (!hasPermission(session.user.permissions ?? [], PERMISSIONS.WORK_ORDERS_MANAGE)) {
    return { ok: false, code: 'TANPA_AKSES' };
  }
  if (claimedUserId) assertActor(session.user.id, claimedUserId);
  const userId = session.user.id;
  const alasan = (reason ?? '').trim();
  if (!alasan) return { ok: false, code: 'ALASAN_WAJIB' };
  if (alasan.length > BATAS_ALASAN_BATAL_WO) return { ok: false, code: 'ALASAN_TERLALU_PANJANG' };

  type HasilTx = { ok: true; docNumber: string; status: string } | Exclude<CancelWorkOrderResult, { ok: true }>;
  let hasil: HasilTx;
  try {
    hasil = await runSerializable(async (tx): Promise<HasilTx> => {
      // The lock Request Item conversion takes: a conversion in flight finishes before the cancel.
      await tx.$queryRaw`SELECT \`id\` FROM \`WorkOrder\` WHERE \`id\` = ${id} FOR UPDATE`;
      const found = await tx.workOrder.findUnique({
        where: { id },
        select: {
          docNumber: true,
          status: true,
          receipts: { select: { id: true }, take: 1 },
          issues: { select: { items: true } },
        },
      });
      if (!found) return { ok: false, code: 'WO_TIDAK_DITEMUKAN' };
      if (found.status === 'CANCELLED') return { ok: false, code: 'WO_SUDAH_DIBATALKAN' };
      if (found.receipts.length > 0) return { ok: false, code: 'WO_SUDAH_ADA_PENERIMAAN' };
      if (found.issues.length > 0) {
        const diCmt = bahanMasihDiCmt(await bacaSisaBahanWo(tx, id, found.issues));
        if (diCmt.length > 0) {
          const barang = await tx.item.findMany({
            where: { id: { in: diCmt.map((d) => d.itemId) } },
            select: { id: true, nameId: true, uom: { select: { code: true } } },
          });
          const per = new Map(barang.map((b) => [b.id, b]));
          return {
            ok: false,
            code: 'WO_SUDAH_KELUAR_BAHAN',
            sisa: diCmt.map((d) => ({
              nama: per.get(d.itemId)?.nameId ?? d.itemId,
              qty: d.sisa.toNumber(),
              satuan: per.get(d.itemId)?.uom?.code ?? '',
            })),
          };
        }
      }

      await tx.workOrder.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          canceledAt: new Date(),
          canceledReason: alasan
        }
      });
      await cancelOpenLinesForWo(tx, id);
      await tx.auditLog.create({
        data: {
          userId,
          action: 'WO_CANCELLED',
          entityType: 'WorkOrder',
          entityId: id,
          reason: alasan,
          changes: { status: { sebelum: found.status, sesudah: 'CANCELLED' } },
        },
      });
      return { ok: true, docNumber: found.docNumber, status: found.status };
    });
  } catch (error) {
    console.error('[cancelWorkOrder]', error);
    return { ok: false, code: 'GAGAL' };
  }
  if (!hasil.ok) return hasil;

  const { docNumber, status: statusSebelum } = hasil;
  getActorName(userId)
    .then((triggeredByName) =>
      notifyWOStatusUpdated(id, docNumber, statusSebelum, 'CANCELLED', triggeredByName)
    )
    .catch(() => {});

  revalidatePath('/backoffice/work-orders');
  revalidatePath(`/backoffice/work-orders/${id}`);
  return { ok: true };
}

export type KembalikanBahanInput = {
  woId: string;
  baris: Array<{ itemId: string; qty: number | string }>;
  catatan?: string;
  /** Kunci idempotensi per isian formulir (dibuat sekali di layar, dipakai ulang saat simpan diulang). */
  kunci: string;
};

export type KembalikanBahanResult =
  | Extract<HasilKembaliBahan, { ok: true }>
  | { ok: false; code: KodeTolakKembaliBahan; itemId?: string; sisa?: number };

/**
 * Bahan kembali dari CMT ke gudang (sisa potong, WO yang akan dibatalkan).
 * Penulisnya `kembalikanBahanWo` (lib/production/kembali-bahan-writer.ts);
 * penolakan DIKEMBALIKAN sebagai `{ ok:false, code }`. Pelaku dari sesi.
 */
export async function kembalikanBahan(data: KembalikanBahanInput): Promise<KembalikanBahanResult> {
  const session = await auth();
  if (!session?.user?.id || !hasPermission(session.user.permissions ?? [], PERMISSIONS.WORK_ORDERS_MANAGE)) {
    return { ok: false, code: 'TANPA_AKSES' };
  }
  const kunci = typeof data?.kunci === 'string' ? data.kunci.trim() : '';
  const woId = typeof data?.woId === 'string' ? data.woId : '';
  // Kunci tanpa ":" — kunci baris disusun "woret:<wo>:<kunci>:<barang>" dan dicari per awalan.
  if (!woId || !/^[A-Za-z0-9_-]{8,100}$/.test(kunci) || !Array.isArray(data.baris)) {
    return { ok: false, code: 'QTY_TIDAK_VALID' };
  }
  const baris = data.baris
    .filter((b) => b && typeof b.itemId === 'string' && b.itemId)
    .map((b) => ({ itemId: b.itemId, qty: b.qty }));
  try {
    const hasil = await kembalikanBahanWo({
      woId,
      baris,
      catatan: typeof data.catatan === 'string' ? data.catatan : null,
      kunci,
      userId: session.user.id,
    });
    if (hasil.ok && !hasil.ulangan) {
      revalidatePath(`/backoffice/work-orders/${woId}`);
      revalidatePath('/backoffice/work-orders');
    }
    return hasil;
  } catch (error) {
    console.error('[kembalikanBahan]', error);
    return { ok: false, code: 'GAGAL' };
  }
}

/** Tabel bahan WO (rencana, keluar, kembali, di CMT) + riwayat bahan kembali. */
export async function getBahanWo(woId: string): Promise<RingkasanBahanWo | null> {
  await wajibBolehBaca(IZIN_BACA_WO);
  return ringkasanBahanWo(woId);
}

const completeReasonSchema = z.string().trim().min(1).max(500);

/**
 * Closes a PARTIAL work order short: the CMT will not deliver the rest of the plan. No stock or
 * journal effect — `actualQty` stays at what was received, and leftover material goes through the
 * vendor return / reconciliation flows. The reason is appended to `notes` and the audit log.
 */
export async function completeWorkOrder(id: string, userId: string, reason: string) {
  const session = await auth();
  if (!session) throw new Error('Unauthorized');
  requirePermission(session.user.permissions, PERMISSIONS.WORK_ORDERS_MANAGE);
  assertActor(session.user.id, userId);
  const trimmedReason = completeReasonSchema.parse(reason);

  const now = new Date();
  const wo = await prisma.$transaction(async (tx) => {
    // Same row lock receiveFG takes first, so the two never decide status from stale reads.
    await tx.$queryRaw`SELECT \`id\` FROM \`WorkOrder\` WHERE \`id\` = ${id} FOR UPDATE`;
    const current = await tx.workOrder.findUnique({
      where: { id },
      select: {
        docNumber: true,
        status: true,
        notes: true,
        issuedAt: true,
        actualLeadDays: true,
        receipts: { select: { id: true } },
      },
    });
    if (!current) throw new Error('Work Order not found');
    if (current.status !== 'PARTIAL' || current.receipts.length === 0) {
      throw new Error('Only a PARTIAL work order can be completed manually');
    }

    const actualLeadDays =
      current.actualLeadDays == null && current.issuedAt != null
        ? computeActualLeadDays(current.issuedAt, now)
        : undefined;
    const note = `[Closed short ${formatDateOnlyJakarta(now)}] ${trimmedReason}`;

    // Compare-and-swap on status so a receipt or cancel committing in between is not overwritten.
    const updated = await tx.workOrder.updateMany({
      where: { id, status: 'PARTIAL' },
      data: {
        status: 'COMPLETED',
        completedAt: now,
        notes: current.notes ? `${current.notes}\n${note}` : note,
        ...(actualLeadDays !== undefined ? { actualLeadDays } : {}),
      },
    });
    if (updated.count === 0) throw new Error('Work Order status changed, refresh and try again');
    return current;
  });

  await logAudit({
    userId: session.user.id,
    action: 'COMPLETE_SHORT',
    entityType: 'WorkOrder',
    entityId: id,
    changes: { before: { status: 'PARTIAL' }, after: { status: 'COMPLETED', reason: trimmedReason } },
  });

  getActorName(userId)
    .then((triggeredByName) =>
      notifyWOStatusUpdated(id, wo.docNumber, 'PARTIAL', 'COMPLETED', triggeredByName)
    )
    .catch(() => {});

  revalidatePath('/backoffice/work-orders');
  revalidatePath(`/backoffice/work-orders/${id}`);
}

export async function getWorkOrders(
  filters?: ListWorkOrdersFilters,
  opts?: ListWorkOrdersOpts
) {
  // Halaman retur pemasok memuat daftar WO untuk pilihannya.
  await wajibBolehBaca([...IZIN_BACA_WO, PERMISSIONS.VENDOR_RETURNS_VIEW]);
  return listWorkOrdersLib(filters, opts);
}

export async function getWorkOrderById(id: string) {
  await wajibBolehBaca(IZIN_BACA_WO);
  const raw = await prisma.workOrder.findUnique({
    where: { id },
    include: {
      po: { select: { id: true, docNumber: true } },
      vendor: true,
      finishedGood: {
        include: { uom: true }
      },
      issues: {
        orderBy: { issuedAt: 'desc' }
      },
      receipts: {
        orderBy: { receivedAt: 'desc' }
      },
      returns: true,
      steps: {
        include: {
          supplier: { select: { id: true, name: true, code: true } },
        },
        orderBy: { sequence: 'asc' },
      },
    }
  });
  if (!raw) return null;
  const serialized = serializeWorkOrder(raw as Parameters<typeof serializeWorkOrder>[0]) as Record<string, unknown>;

  const receiptRows = (serialized.receipts ?? []) as Array<{ id: string; qtyAccepted: number; totalCostValue: number | null }>;
  const receiptIds = receiptRows.map((r) => r.id);
  const receiptJournals = receiptIds.length
    ? await prisma.journal.findMany({
        where: { sourceType: "FG_RECEIPT", sourceId: { in: receiptIds } },
        select: { id: true, sourceId: true },
      })
    : [];
  const journalBySource = new Map(receiptJournals.map((j) => [j.sourceId, j.id]));
  serialized.receipts = receiptRows.map((r) => {
    const journalId = journalBySource.get(r.id) ?? null;
    const value = r.totalCostValue == null ? 0 : Number(r.totalCostValue);
    return {
      ...r,
      journalId,
      hasPostableJournal: Number(r.qtyAccepted) > 0 && Math.abs(value) >= 0.01 && journalId == null,
    };
  });

  return serialized;
}

/** Roll allocation status for WO detail: per-roll initial/remaining (so user sees what’s already issued). */
export async function getWorkOrderRollAllocationStatus(woId: string): Promise<Array<{
  itemId: string;
  itemName: string | null;
  colorName: string | null;
  rollRef: string;
  allocatedQty: number;
  initialLength: number | null;
  remainingLength: number | null;
  used: number | null;
}>> {
  await wajibBolehBaca(IZIN_BACA_WO);
  const wo = await prisma.workOrder.findUnique({
    where: { id: woId },
    select: { consumptionMaterialId: true, rollBreakdown: true },
  });
  if (!wo?.rollBreakdown) return [];
  const raw = wo.rollBreakdown;
  const arr = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : raw;
  // Rolls are per material (#437); a legacy entry belongs to the consumption material.
  const breakdown = withRollItemIds(Array.isArray(arr) ? (arr as RollEntry[]) : [], wo.consumptionMaterialId);
  if (breakdown.length === 0) return [];
  const names = new Map(
    (await prisma.item.findMany({
      where: { id: { in: [...new Set(breakdown.map((e) => e.itemId))] } },
      select: { id: true, nameId: true },
    })).map((i) => [i.id, i.nameId])
  );
  const colorIds = [...new Set(breakdown.map((e) => e.colorId).filter((id): id is string => !!id))];
  const colorNames = new Map(
    colorIds.length === 0
      ? []
      : (await prisma.variantColor.findMany({ where: { id: { in: colorIds } }, select: { id: true, name: true } }))
          .map((c) => [c.id, c.name] as const)
  );

  const out: Awaited<ReturnType<typeof getWorkOrderRollAllocationStatus>> = [];
  for (const entry of breakdown) {
    const rollRef = entry.rollRef ?? '';
    const allocatedQty = Number(entry.qty ?? 0);
    const roll = await prisma.fabricRoll.findFirst({
      where: {
        itemId: entry.itemId,
        OR: [{ rollCode: rollRef }, { rollRef }],
      },
      select: { initialLength: true, remainingLength: true },
    });
    const base = {
      itemId: entry.itemId,
      itemName: names.get(entry.itemId) ?? null,
      colorName: entry.colorId ? colorNames.get(entry.colorId) ?? null : null,
      rollRef,
      allocatedQty,
    };
    if (roll) {
      const initial = Number(roll.initialLength);
      const remaining = Number(roll.remainingLength);
      out.push({ ...base, initialLength: initial, remainingLength: remaining, used: initial - remaining });
    } else {
      out.push({ ...base, initialLength: null, remainingLength: null, used: null });
    }
  }
  return out;
}

type PlanSkuBreakdown = MaterialPlanOptions['skuBreakdown'];

/**
 * Compute planned qty (pieces) from consumption of one material.
 * plannedQty = floor(consumptionAmount / consumptionPerPiece), with remainder.
 * Per piece = the material's plan for one piece of the given variant ratio, so a colour/size-scoped
 * rule (#437) counts only for the variants it covers; with no ratio it is split evenly (estimate).
 */
export async function computePlannedQtyFromConsumption(
  finishedGoodId: string,
  materialId: string,
  consumptionAmount: number,
  skuBreakdown?: PlanSkuBreakdown
): Promise<{
  plannedQty: number;
  remainder: number;
  actualConsumption: number;
  consumptionPerPiece: number;
  uomCode: string;
}> {
  await wajibBolehBaca(IZIN_BACA_WO);
  const plan = await generateMaterialPlan(finishedGoodId, new Decimal(1), {
    skuBreakdown,
    fallbackToEqualSplit: true,
  });
  const line = plan.find((m) => m.itemId === materialId);
  if (!line || line.plannedQty.isZero()) {
    throw new Error('Consumption rule not found for this finished good and material');
  }
  const consumptionPerPiece = line.plannedQty;
  const amount = new Decimal(consumptionAmount);
  const plannedQtyDecimal = amount.div(consumptionPerPiece).floor();
  const plannedQty = plannedQtyDecimal.toNumber();
  const actualConsumption = plannedQtyDecimal.mul(consumptionPerPiece).toNumber();
  const remainder = amount.minus(actualConsumption).toNumber();
  return {
    plannedQty,
    remainder,
    actualConsumption,
    consumptionPerPiece: consumptionPerPiece.toNumber(),
    uomCode: line.uomCode,
  };
}

/**
 * Get material plan for a finished good and planned qty (for WO create form). `blocked` carries
 * why a colour/size-scoped BOM cannot be planned (#437) — returned, not thrown, because a thrown
 * server-action message does not reach the browser in production.
 */
export async function getMaterialPlan(
  finishedGoodId: string,
  plannedQty: number,
  skuBreakdown?: PlanSkuBreakdown
) {
  await wajibBolehBaca(IZIN_BACA_WO);
  let plan;
  try {
    plan = await generateMaterialPlan(finishedGoodId, new Decimal(plannedQty), { skuBreakdown });
  } catch (err) {
    if (err instanceof MaterialPlanBlockedError) return { lines: [], blocked: err.message };
    throw err;
  }
  const lines = plan.map((m) => ({
    itemId: m.itemId,
    itemName: m.itemName,
    itemType: m.itemType,
    byColor: m.byColor?.map((c) => ({ colorId: c.colorId, colorName: c.colorName, plannedQty: c.plannedQty.toNumber() })),
    uomId: m.uomId,
    uomCode: m.uomCode,
    qtyRequired: m.qtyRequired.toNumber(),
    wastePercent: m.wastePercent.toNumber(),
    plannedQty: m.plannedQty.toNumber(),
    availableStock: m.availableStock.toNumber(),
    shortage: m.shortage.toNumber()
  }));
  return { lines, blocked: null };
}

/** List available fabric rolls for an item (for dropdown). */
export async function getAvailableFabricRolls(itemId: string) {
  await wajibBolehBaca(IZIN_BACA_WO);
  const rolls = await prisma.fabricRoll.findMany({
    where: {
      itemId,
      isClosed: false,
      remainingLength: { gt: 0 },
    },
    orderBy: { remainingLength: 'desc' },
    select: {
      id: true,
      rollCode: true,
      rollRef: true,
      remainingLength: true,
    },
  });
  return rolls.map((r) => ({
    rollId: r.id,
    rollCode: r.rollCode,
    rollRef: r.rollRef,
    remainingLength: Number(r.remainingLength),
  }));
}

// --- Roll allocation best-fit (two-phase) ---

type RollCandidate = {
  id: string;
  rollCode: string;
  rollRef: string;
  remainingLength: number;
};

type RollAllocationResult = {
  selected: Array<{ rollId: string; rollCode: string; rollRef: string; qty: number }>;
  totalAllocated: number;
  waste: number;
  unallocated: number;
};

/**
 * Phase 1: Filter roll candidates in the database. Returns a small pool (typically ≤ 50 rolls) for branch-and-bound.
 */
async function filterRollCandidates(
  itemId: string,
  requiredQty: number,
  excludeRollCodes: string[] = []
): Promise<{ candidates: RollCandidate[]; bestSingle: RollCandidate | null }> {
  const baseWhere = {
    itemId,
    isClosed: false,
    remainingLength: { gt: 0 },
    ...(excludeRollCodes.length > 0 ? { rollCode: { notIn: excludeRollCodes } } : {}),
  };
  const selectFields = { id: true, rollCode: true, rollRef: true, remainingLength: true };

  // Pass 1: Single-roll shortcut — smallest roll that can cover the requirement alone
  const bestSingleRow = await prisma.fabricRoll.findFirst({
    where: { ...baseWhere, remainingLength: { gte: requiredQty } },
    orderBy: { remainingLength: 'asc' },
    select: selectFields,
  });
  const bestSingle = bestSingleRow
    ? { ...bestSingleRow, remainingLength: Number(bestSingleRow.remainingLength) }
    : null;
  const wasteCeiling = bestSingle ? bestSingle.remainingLength - requiredQty : Infinity;

  // Pass 2: Greedy K — largest rolls below target to estimate how many rolls are needed
  const topRolls = await prisma.fabricRoll.findMany({
    where: { ...baseWhere, remainingLength: { lt: requiredQty } },
    orderBy: { remainingLength: 'desc' },
    take: 100,
    select: selectFields,
  });

  let sum = 0;
  let K = 0;
  for (const r of topRolls) {
    sum += Number(r.remainingLength);
    K++;
    if (sum >= requiredQty) break;
  }

  const bulkCount = Math.min(K * 3, 40);
  const bulk = topRolls.slice(0, bulkCount);
  const bulkIds = new Set(bulk.map((r) => r.id));

  let gapFillers: typeof topRolls = [];
  if (wasteCeiling < Infinity && wasteCeiling > 0) {
    gapFillers = await prisma.fabricRoll.findMany({
      where: {
        ...baseWhere,
        remainingLength: { lte: wasteCeiling },
        id: { notIn: Array.from(bulkIds) },
      },
      orderBy: { remainingLength: 'desc' },
      take: 10,
      select: selectFields,
    });
  }

  const seen = new Set<string>();
  const candidates: RollCandidate[] = [];

  const addRoll = (r: { id: string; rollCode: string; rollRef: string; remainingLength: unknown }) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    candidates.push({
      id: r.id,
      rollCode: r.rollCode,
      rollRef: r.rollRef,
      remainingLength: Number(r.remainingLength),
    });
  };

  if (bestSingle) addRoll(bestSingle);
  for (const r of bulk) addRoll(r);
  for (const r of gapFillers) addRoll(r);

  return { candidates, bestSingle };
}

/**
 * Phase 2: Branch-and-bound solver. Finds subset of whole rolls with minimum total ≥ requiredQty (minimum waste).
 * Not exported so it can stay sync (Server Actions must be async); used only by suggestFabricRollAllocation.
 */
function bestFitRollAllocation(
  rolls: RollCandidate[],
  requiredQty: number
): RollAllocationResult {
  const available = rolls
    .filter((r) => r.remainingLength > 0)
    .sort((a, b) => b.remainingLength - a.remainingLength);

  const totalAvailable = available.reduce((s, r) => s + r.remainingLength, 0);
  const n = available.length;

  if (totalAvailable < requiredQty) {
    return {
      selected: available.map((r) => ({
        rollId: r.id,
        rollCode: r.rollCode,
        rollRef: r.rollRef,
        qty: r.remainingLength,
      })),
      totalAllocated: totalAvailable,
      waste: 0,
      unallocated: requiredQty - totalAvailable,
    };
  }

  if (totalAvailable === requiredQty) {
    return {
      selected: available.map((r) => ({
        rollId: r.id,
        rollCode: r.rollCode,
        rollRef: r.rollRef,
        qty: r.remainingLength,
      })),
      totalAllocated: totalAvailable,
      waste: 0,
      unallocated: 0,
    };
  }

  const suffixSum = new Array<number>(n + 1);
  suffixSum[n] = 0;
  for (let i = n - 1; i >= 0; i--) {
    suffixSum[i] = suffixSum[i + 1] + available[i].remainingLength;
  }

  let bestSum = Infinity;
  const bestMask = new Array<boolean>(n).fill(false);
  const currentMask = new Array<boolean>(n).fill(false);

  function search(index: number, currentSum: number): void {
    if (currentSum >= requiredQty) {
      if (currentSum < bestSum) {
        bestSum = currentSum;
        for (let i = 0; i < n; i++) bestMask[i] = currentMask[i];
      }
      return;
    }
    if (index >= n) return;
    if (currentSum + suffixSum[index] < requiredQty) return;
    if (currentSum >= bestSum) return;

    currentMask[index] = true;
    search(index + 1, currentSum + available[index].remainingLength);
    currentMask[index] = false;
    search(index + 1, currentSum);
  }

  search(0, 0);

  if (bestSum === Infinity) {
    return {
      selected: available.map((r) => ({
        rollId: r.id,
        rollCode: r.rollCode,
        rollRef: r.rollRef,
        qty: r.remainingLength,
      })),
      totalAllocated: totalAvailable,
      waste: 0,
      unallocated: requiredQty - totalAvailable,
    };
  }

  const selected = available
    .filter((_, i) => bestMask[i])
    .map((r) => ({
      rollId: r.id,
      rollCode: r.rollCode,
      rollRef: r.rollRef,
      qty: r.remainingLength,
    }));

  return {
    selected,
    totalAllocated: bestSum,
    waste: bestSum - requiredQty,
    unallocated: 0,
  };
}

/**
 * Suggest allocation using whole rolls only. Two-phase: DB filter to ~50 candidates, then branch-and-bound for minimum waste.
 * `excludeRollCodes`: rolls another colour section of the same WO already took (#410).
 */
export async function suggestFabricRollAllocation(
  itemId: string,
  requiredQty: number,
  excludeRollCodes: string[] = []
): Promise<RollAllocationResult> {
  await wajibBolehBaca(IZIN_BACA_WO);
  const { candidates, bestSingle } = await filterRollCandidates(itemId, requiredQty, excludeRollCodes);

  if (candidates.length === 0) {
    return {
      selected: [],
      totalAllocated: 0,
      waste: 0,
      unallocated: requiredQty,
    };
  }

  if (bestSingle && bestSingle.remainingLength === requiredQty) {
    return {
      selected: [
        {
          rollId: bestSingle.id,
          rollCode: bestSingle.rollCode,
          rollRef: bestSingle.rollRef,
          qty: bestSingle.remainingLength,
        },
      ],
      totalAllocated: requiredQty,
      waste: 0,
      unallocated: 0,
    };
  }

  return bestFitRollAllocation(candidates, requiredQty);
}

/** Get reconciliation data for a WO (serialized for client). */
export async function getReconciliation(woId: string) {
  await wajibBolehBaca(IZIN_BACA_WO);
  const { lines, summary } = await reconcileWorkOrder(woId);
  return {
    lines: lines.map((l) => ({
      itemId: l.itemId,
      itemName: l.itemName,
      itemSku: l.itemSku,
      uomCode: l.uomCode,
      plannedQty: l.plannedQty.toNumber(),
      issuedQty: l.issuedQty.toNumber(),
      returnedQty: l.returnedQty.toNumber(),
      actualUsed: l.actualUsed.toNumber(),
      theoreticalUsage: l.theoreticalUsage.toNumber(),
      variance: l.variance.toNumber(),
      variancePercent: l.variancePercent.toNumber(),
      varianceValue: l.varianceValue.toNumber(),
      issuedValue: l.issuedValue.toNumber(),
      usedValue: l.usedValue.toNumber(),
      status: l.status
    })),
    summary: {
      totalIssuedValue: summary.totalIssuedValue.toNumber(),
      totalUsedValue: summary.totalUsedValue.toNumber(),
      netVarianceValue: summary.netVarianceValue.toNumber()
    }
  };
}

/** Get material issues for CMT register (filter by vendor and/or date). */
export async function getMaterialIssuesForCMTRegister(
  filters?: {
    vendorId?: string;
    dateFrom?: Date;
    dateTo?: Date;
    issueType?: 'FABRIC' | 'ACCESSORIES';
  },
  opts?: { page: number; pageSize: number }
) {
  // Register nota CMT punya izinnya sendiri.
  await wajibBolehBaca([...IZIN_BACA_WO, PERMISSIONS.NOTA_REGISTER_VIEW]);
  const where: any = {};
  if (filters?.vendorId) {
    where.wo = { vendorId: filters.vendorId };
  }
  if (filters?.dateFrom || filters?.dateTo) {
    where.issuedAt = {};
    if (filters.dateFrom) where.issuedAt.gte = filters.dateFrom;
    if (filters.dateTo) where.issuedAt.lte = filters.dateTo;
  }
  if (filters?.issueType) {
    where.issueType = filters.issueType as 'FABRIC' | 'ACCESSORIES';
  }

  // Surat Jalan CMT: a delivery note to the CMT, so no material cost leaves the server.
  const mapIssue = (i: { id: string; docNumber: string; issueType: string; issuedAt: Date; wo?: { docNumber?: string; vendor?: { name?: string; code?: string } } }) => {
    const wo = i.wo;
    return {
      id: i.id,
      docNumber: i.docNumber,
      issueType: i.issueType,
      issuedAt: i.issuedAt,
      woId: (i as { woId?: string }).woId ?? '',
      woDocNumber: wo?.docNumber ?? '',
      vendorName: wo?.vendor?.name ?? wo?.vendor?.code ?? '',
    };
  };

  if (opts?.page != null && opts?.pageSize != null && opts.pageSize > 0) {
    const [issues, totalCount] = await Promise.all([
      prisma.materialIssue.findMany({
        where,
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
        include: {
          wo: {
            select: {
              docNumber: true,
              vendorId: true,
              vendor: { select: { name: true, code: true } },
            },
          },
        },
        orderBy: { issuedAt: 'desc' },
      }),
      prisma.materialIssue.count({ where }),
    ]);
    return { items: issues.map((i) => mapIssue(i as any)), totalCount };
  }

  const issues = await prisma.materialIssue.findMany({
    where,
    include: {
      wo: {
        select: {
          docNumber: true,
          vendorId: true,
          vendor: { select: { name: true, code: true } },
        },
      },
    },
    orderBy: { issuedAt: 'desc' },
    take: 500,
  });
  return issues.map((i) => mapIssue(i as any));
}

/** Get a single material issue for print (Surat Jalan CMT): quantities only, no cost. */
export async function getMaterialIssueForPrint(issueId: string) {
  await wajibBolehBaca([...IZIN_BACA_WO, PERMISSIONS.NOTA_REGISTER_VIEW]);
  const issue = await prisma.materialIssue.findUnique({
    where: { id: issueId },
    include: {
      wo: {
        select: {
          docNumber: true,
          vendor: { select: { name: true, code: true } },
        },
      },
    },
  });
  if (!issue) return null;
  let rawItems: unknown = issue.items;
  if (typeof rawItems === 'string') {
    try {
      rawItems = JSON.parse(rawItems);
    } catch {
      rawItems = null;
    }
  }
  type ItemLine = { itemId: string; qty: number; uomId: string };
  const items: ItemLine[] = Array.isArray(rawItems)
    ? rawItems.filter((i): i is ItemLine => i != null && typeof i === 'object' && typeof (i as { itemId?: unknown }).itemId === 'string')
    : rawItems && typeof rawItems === 'object'
      ? (Object.values(rawItems) as unknown[]).filter((i): i is ItemLine => i != null && typeof i === 'object' && typeof (i as { itemId?: unknown }).itemId === 'string')
      : [];
  const itemIds = [...new Set(items.map((i) => i.itemId).filter(Boolean))];
  const uomIds = [...new Set(items.map((i) => i?.uomId).filter(Boolean))];
  const [itemRows, uomRows] = await Promise.all([
    itemIds.length ? prisma.item.findMany({ where: { id: { in: itemIds } }, select: { id: true, nameId: true, sku: true } }) : [],
    uomIds.length ? prisma.uOM.findMany({ where: { id: { in: uomIds } }, select: { id: true, code: true } }) : [],
  ]);
  const itemMap = new Map(itemRows.map((i) => [i.id, i]));
  const uomMap = new Map(uomRows.map((u) => [u.id, u]));
  const lines = items.map((line) => ({
    itemName: itemMap.get(line.itemId)?.nameId ?? itemMap.get(line.itemId)?.sku ?? line.itemId,
    itemSku: itemMap.get(line.itemId)?.sku ?? '',
    qty: Number(line.qty ?? 0),
    uomCode: line.uomId ? uomMap.get(line.uomId)?.code ?? '' : '',
  }));
  return {
    docNumber: issue.docNumber,
    issueType: issue.issueType,
    issuedAt: issue.issuedAt,
    woDocNumber: issue.wo.docNumber,
    vendorName: issue.wo.vendor?.name ?? issue.wo.vendor?.code ?? '',
    lines,
  };
}

// Get production statistics
export async function getProductionStats() {
  await wajibBolehBaca(IZIN_BACA_WO);
  const [
    totalWOs,
    draftWOs,
    inProductionWOs,
    completedWOs,
    totalIssues,
    totalReceipts
  ] = await Promise.all([
    prisma.workOrder.count(),
    prisma.workOrder.count({ where: { status: 'DRAFT' } }),
    prisma.workOrder.count({ where: { status: 'IN_PRODUCTION' } }),
    prisma.workOrder.count({ where: { status: 'COMPLETED' } }),
    prisma.materialIssue.count(),
    prisma.fGReceipt.count()
  ]);
  
  return {
    totalWOs,
    draftWOs,
    inProductionWOs,
    completedWOs,
    totalIssues,
    totalReceipts
  };
}
