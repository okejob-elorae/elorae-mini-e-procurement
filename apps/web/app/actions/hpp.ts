'use server';

import { prisma } from '@elorae/db';
import { ItemType } from '@elorae/db';
import { getPpnRatePercent } from '@/app/actions/settings/ppn';
import { auth } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/rbac";
import { STATUS_KOREKSI_UTANG } from "@/lib/vendor-billing/koreksi-utang-aturan";

/**
 * Pagar setiap ekspor berkas ini — semuanya titik akhir yang bisa dipanggil
 * siapa pun yang sudah masuk, dan isinya biaya produksi per barang. Cukup SALAH
 * SATU izin; melempar seperti `requirePermission` supaya bentuk kembalian untuk
 * yang sah tidak berubah. Dipasang sebelum satu kueri pun berjalan.
 */
async function wajibBolehBacaHpp(izin: readonly string[]): Promise<void> {
  const session = await auth();
  if (!session?.user?.id) throw new Error("Unauthorized");
  const punya = session.user.permissions ?? [];
  if (!izin.some((kode) => hasPermission(punya, kode))) {
    throw Object.assign(new Error("Forbidden: Insufficient permissions"), { status: 403 });
  }
}

export type HPPCostLine = {
  category: 'FABRIC' | 'ACCESSORIES' | 'SERVICE';
  itemId?: string;
  itemName: string;
  unitCost: number;
  qtyPerPcs: number;
  costPerPcs: number;
  ppnIncluded: boolean;
  nettCostPerPcs?: number;
  /**
   * Hanya baris jasa yang ikut selisih harga invoice yang DITERIMA pemilik (P49, "HPP harus
   * real"): `dari` = harga jasa WO sebelum koreksi, `invoiceNo` = nomor invoice pemasok yang
   * mengoreksinya. `costPerPcs` baris itu sudah memuat koreksinya.
   */
  koreksi?: { dari: number; invoiceNo: string[] };
};

export type HPPBreakdown = {
  woId: string;
  woDocNumber: string;
  finishedGoodId: string;
  finishedGoodName: string;
  finishedGoodSku: string;
  plannedQty: number;
  actualQty: number;
  lines: HPPCostLine[];
  fabricCostPerPcs: number;
  accessoriesCostPerPcs: number;
  serviceCostPerPcs: number;
  subtotal: number;
  hasMixedPPN: boolean;
  nettSubtotal?: number;
  /**
   * Biaya tambahan per pcs perintah kerja — biaya produksi, ikut HPP penerimaan. Isian markup di
   * perintah kerja dihapus (jawaban pemilik P4a, 2026-11-02): harga rekomendasi hanya satu, dari
   * pengaturan barang (`lib/items/rekomendasi-harga-queries.ts`), dan Laporan HPP menampilkan itu.
   */
  additionalCost: number | null;
};

export type HPPRow = {
  itemId: string;
  sku: string;
  nameId: string;
  nameEn: string | null;
  receiptCount: number;
  lastAvgCostPerUnit: number | null;
  lastMaterialCost: number | null;
  lastReceiptAt: Date | null;
};

type MaterialIssueItem = {
  itemId: string;
  qty: number;
  uomId: string;
  avgCostAtIssue: number;
  ppnIncluded?: boolean;
  totalCost?: number;
};

/** Calculate HPP for a single work order: 3 cost layers (fabric, accessories, service) + PPN tracking. */
export async function calculateHPP(woId: string): Promise<HPPBreakdown> {
  await wajibBolehBacaHpp([PERMISSIONS.REPORTS_HPP_VIEW]);
  return hitungHPP(woId);
}

/** Inti `calculateHPP` tanpa pagar — `getHPPList` sudah memagari sekali untuk seluruh daftar. */
async function hitungHPP(woId: string): Promise<HPPBreakdown> {
  const ppnRate = await getPpnRatePercent();

  const wo = await prisma.workOrder.findUnique({
    where: { id: woId },
    select: {
      id: true,
      docNumber: true,
      finishedGoodId: true,
      consumptionPlan: true,
      plannedQty: true,
      actualQty: true,
      hppAdditionalCost: true,
      finishedGood: { select: { id: true, sku: true, nameId: true } },
      issues: { select: { issueType: true, items: true } },
      steps: {
        orderBy: { sequence: 'asc' },
        select: { id: true, stepName: true, supplierId: true, servicePrice: true, servicePpnIncluded: true },
      },
    },
  });

  if (!wo) throw new Error('Work order not found');

  const plannedQty = Number(wo.plannedQty) || 0;
  const actualQty = Number(wo.actualQty ?? 0) || 0;
  const additionalCost = wo.hppAdditionalCost != null ? Number(wo.hppAdditionalCost) : null;

  // Per-piece quantities come from the WO's own plan, not the current BOM: a colour/size-scoped
  // rule (#437) covers only some of the WO's variants, and the plan averaged it over its mix.
  const planRaw = wo.consumptionPlan;
  const plan = typeof planRaw === 'string' ? (() => { try { return JSON.parse(planRaw); } catch { return []; } })() : planRaw;
  const qtyRequiredByMaterial: Record<string, number> = {};
  for (const line of Array.isArray(plan) ? (plan as Array<{ itemId?: string; qtyRequired?: number }>) : []) {
    if (line?.itemId) qtyRequiredByMaterial[line.itemId] = Number(line.qtyRequired) || 0;
  }

  const itemIds = new Set<string>();
  for (const issue of wo.issues) {
    const raw = issue.items;
    const arr = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : Array.isArray(raw) ? raw : [];
    for (const line of arr as MaterialIssueItem[]) {
      if (line?.itemId) itemIds.add(line.itemId);
    }
  }
  const items = await prisma.item.findMany({
    where: { id: { in: Array.from(itemIds) } },
    select: { id: true, nameId: true },
  });
  const itemNameById: Record<string, string> = {};
  for (const i of items) itemNameById[i.id] = i.nameId;

  const lines: HPPCostLine[] = [];
  let fabricCostPerPcs = 0;
  let accessoriesCostPerPcs = 0;

  for (const issue of wo.issues) {
    const raw = issue.items;
    const arr = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : Array.isArray(raw) ? raw : [];
    const category = issue.issueType === 'FABRIC' ? 'FABRIC' : 'ACCESSORIES';

    for (const line of arr as MaterialIssueItem[]) {
      if (!line?.itemId || line.qty == null) continue;
      const avgCost = Number(line.avgCostAtIssue) || 0;
      const ppnIncluded = line.ppnIncluded !== false;
      const qtyRequired = qtyRequiredByMaterial[line.itemId] ?? 0;
      const costPerPcs = avgCost * qtyRequired;
      const nettCostPerPcs = ppnIncluded ? costPerPcs : costPerPcs * (1 + ppnRate / 100);

      lines.push({
        category,
        itemId: line.itemId,
        itemName: itemNameById[line.itemId] ?? line.itemId,
        unitCost: avgCost,
        qtyPerPcs: qtyRequired,
        costPerPcs,
        ppnIncluded,
        nettCostPerPcs,
      });

      if (category === 'FABRIC') fabricCostPerPcs += costPerPcs;
      else accessoriesCostPerPcs += costPerPcs;
    }
  }

  let serviceCostPerPcs = 0;
  const suppliers = await prisma.supplier.findMany({
    where: { id: { in: wo.steps.map((s) => s.supplierId) } },
    select: { id: true, name: true },
  });
  const supplierNameById: Record<string, string> = {};
  for (const s of suppliers) supplierNameById[s.id] = s.name;

  const koreksiPerLangkah = await koreksiJasaDiterima(wo.steps.map((s) => s.id));

  for (const step of wo.steps) {
    const price = Number(step.servicePrice) || 0;
    const ppnIncluded = step.servicePpnIncluded ?? false;
    const stepName = step.stepName?.trim() || supplierNameById[step.supplierId] || step.supplierId;
    /*
     * Selisih harga invoice jasa yang DITERIMA pemilik (P49, 2026-11-01 no. 5: "jika 55.000 maka
     * tampak 55.000") menjadi HPP sebenarnya: Σ qty tertagih × (harga invoice − harga tercatat),
     * dibagi pcs WO ini. Dibatalkan / dikoreksi turun ke harga WO = tidak ikut.
     */
    const k = koreksiPerLangkah.get(step.id);
    const pcs = actualQty || plannedQty || (k?.qty ?? 0);
    const koreksiPerPcs = k && k.selisih !== 0 && pcs > 0 ? k.selisih / pcs : null;
    const costPerPcs = koreksiPerPcs != null ? Math.round((price + koreksiPerPcs) * 100) / 100 : price;
    const nettCostPerPcs = ppnIncluded ? costPerPcs : costPerPcs * (1 + ppnRate / 100);

    lines.push({
      category: 'SERVICE',
      itemName: stepName,
      unitCost: costPerPcs,
      qtyPerPcs: 1,
      costPerPcs,
      ppnIncluded,
      nettCostPerPcs,
      ...(k && koreksiPerPcs != null ? { koreksi: { dari: price, invoiceNo: k.invoiceNo } } : {}),
    });
    serviceCostPerPcs += costPerPcs;
  }

  const subtotal = fabricCostPerPcs + accessoriesCostPerPcs + serviceCostPerPcs;
  const ppnFlags = lines.map((l) => l.ppnIncluded);
  const hasMixedPPN = ppnFlags.length > 0 && (new Set(ppnFlags).size > 1);
  const nettSubtotal = lines.reduce((sum, l) => sum + (l.nettCostPerPcs ?? l.costPerPcs), 0);

  return {
    woId: wo.id,
    woDocNumber: wo.docNumber,
    finishedGoodId: wo.finishedGoodId,
    finishedGoodName: wo.finishedGood?.nameId ?? '',
    finishedGoodSku: wo.finishedGood?.sku ?? '',
    plannedQty,
    actualQty,
    lines,
    fabricCostPerPcs,
    accessoriesCostPerPcs,
    serviceCostPerPcs,
    subtotal,
    hasMixedPPN,
    nettSubtotal,
    additionalCost,
  };
}

/**
 * Koreksi utang pemasok yang DITERIMA untuk langkah jasa WO (`sourceType` WO_STEP), per langkah:
 * Σ qty × (harga invoice − harga tercatat), Σ qty tertagih, dan nomor invoice pemasoknya.
 */
async function koreksiJasaDiterima(
  stepIds: string[],
): Promise<Map<string, { selisih: number; qty: number; invoiceNo: string[] }>> {
  const hasil = new Map<string, { selisih: number; qty: number; invoiceNo: string[] }>();
  if (stepIds.length === 0) return hasil;
  const koreksi = await prisma.supplierPayableCorrection.findMany({
    where: { status: STATUS_KOREKSI_UTANG.DITERIMA, sourceType: "WO_STEP", sourceId: { in: stepIds } },
    select: { sourceId: true, billId: true, qty: true, recordedPrice: true, invoicePrice: true },
  });
  if (koreksi.length === 0) return hasil;
  const billIds = [...new Set(koreksi.map((k) => k.billId))];
  const tagihan = await prisma.vendorBill.findMany({
    where: { id: { in: billIds } },
    select: { id: true, vendorInvoiceNo: true },
  });
  const nomorInvoice = new Map(tagihan.map((b) => [b.id, b.vendorInvoiceNo]));
  for (const k of koreksi) {
    const qty = Number(k.qty) || 0;
    const baris = hasil.get(k.sourceId) ?? { selisih: 0, qty: 0, invoiceNo: [] };
    baris.selisih += qty * ((Number(k.invoicePrice) || 0) - (Number(k.recordedPrice) || 0));
    baris.qty += qty;
    const nomor = nomorInvoice.get(k.billId);
    if (nomor && !baris.invoiceNo.includes(nomor)) baris.invoiceNo.push(nomor);
    hasil.set(k.sourceId, baris);
  }
  return hasil;
}

export type HPPListFilters = {
  finishedGoodId?: string;
  dateFrom?: Date;
  dateTo?: Date;
  vendorId?: string;
};

/** List WO-centric HPP breakdowns with optional filters. */
export async function getHPPList(filters?: HPPListFilters): Promise<HPPBreakdown[]> {
  await wajibBolehBacaHpp([PERMISSIONS.REPORTS_HPP_VIEW]);
  const where: Record<string, unknown> = {};
  if (filters?.finishedGoodId) where.finishedGoodId = filters.finishedGoodId;
  if (filters?.vendorId) where.vendorId = filters.vendorId;
  if (filters?.dateFrom || filters?.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) (where.createdAt as Record<string, Date>).gte = filters.dateFrom;
    if (filters.dateTo) (where.createdAt as Record<string, Date>).lte = filters.dateTo;
  }

  const wos = await prisma.workOrder.findMany({
    where,
    select: { id: true },
    orderBy: { createdAt: 'desc' },
  });

  const results: HPPBreakdown[] = [];
  for (const wo of wos) {
    try {
      results.push(await hitungHPP(wo.id));
    } catch {
      // skip WOs that fail (e.g. no data)
    }
  }
  return results;
}

/** Legacy: list finished goods with HPP-related data from FG receipts (kept for backward compatibility). */
export async function getHPPListLegacy(): Promise<HPPRow[]> {
  await wajibBolehBacaHpp([PERMISSIONS.REPORTS_HPP_VIEW]);
  const [items, receipts] = await Promise.all([
    prisma.item.findMany({
      where: { type: ItemType.FINISHED_GOOD, isActive: true },
      select: { id: true, sku: true, nameId: true, nameEn: true },
      orderBy: { sku: 'asc' },
    }),
    prisma.fGReceipt.findMany({
      include: { wo: { select: { finishedGoodId: true } } },
      orderBy: { receivedAt: 'desc' },
    }),
  ]);

  const byFg: Record<
    string,
    { count: number; last: { avgCostPerUnit: number | null; materialCost: number | null; receivedAt: Date } }
  > = {};
  for (const r of receipts) {
    const fgId = r.wo.finishedGoodId;
    if (!byFg[fgId]) {
      byFg[fgId] = {
        count: 0,
        last: {
          avgCostPerUnit: r.avgCostPerUnit != null ? Number(r.avgCostPerUnit) : null,
          materialCost: r.materialCost != null ? Number(r.materialCost) : null,
          receivedAt: r.receivedAt,
        },
      };
    }
    byFg[fgId].count += 1;
  }

  return items.map((item) => {
    const agg = byFg[item.id];
    return {
      itemId: item.id,
      sku: item.sku,
      nameId: item.nameId,
      nameEn: item.nameEn,
      receiptCount: agg?.count ?? 0,
      lastAvgCostPerUnit: agg?.last.avgCostPerUnit ?? null,
      lastMaterialCost: agg?.last.materialCost ?? null,
      lastReceiptAt: agg?.last.receivedAt ?? null,
    };
  });
}

/**
 * Automatic HPP: material cost and avg cost per unit are stored on each FG receipt in receiveFG.
 * This getter returns the effective HPP for one FG item from its latest receipt (for use in pricing/reports).
 *
 * `avgCostPerUnit` adalah HPP LENGKAP per pcs (bahan + ongkos jahit + biaya
 * tambahan, sejak ongkos jahit masuk HPP). `materialCostPerUnit` hanya bahan
 * per pcs lolos — dipakai menilai barang jadi cacat yang diretur ke pemasok
 * (jasa tidak dibayar untuk barang cacat). Penerimaan lama: keduanya sama.
 */
export async function getEffectiveHPPForItem(finishedGoodId: string): Promise<{
  avgCostPerUnit: number | null;
  materialCost: number | null;
  materialCostPerUnit: number | null;
  lastReceiptAt: Date | null;
} | null> {
  // Penulis retur pemasok menilai barang jadi reject dengan HPP ini.
  await wajibBolehBacaHpp([
    PERMISSIONS.REPORTS_HPP_VIEW,
    PERMISSIONS.VENDOR_RETURNS_CREATE,
    PERMISSIONS.VENDOR_RETURNS_MANAGE,
  ]);
  const last = await prisma.fGReceipt.findFirst({
    where: { wo: { finishedGoodId } },
    orderBy: { receivedAt: 'desc' },
    select: { avgCostPerUnit: true, materialCost: true, qtyAccepted: true, receivedAt: true },
  });
  if (!last) return null;
  const lolos = Number(last.qtyAccepted);
  const bahan = last.materialCost != null ? Number(last.materialCost) : null;
  return {
    avgCostPerUnit: last.avgCostPerUnit != null ? Number(last.avgCostPerUnit) : null,
    materialCost: bahan,
    materialCostPerUnit: bahan != null && lolos > 0 ? Math.round((bahan / lolos) * 100) / 100 : null,
    lastReceiptAt: last.receivedAt,
  };
}
