import { Decimal } from "decimal.js";
import { Role, SalesHistoryStatus, type PrismaClient } from "@elorae/db";
import {
  aggregateUmkmExcelByParent,
  parseUmkmExcelFile,
  type UmkmExcelRow,
} from "./umkm-excel-parse";
import {
  allocateParentSalesToSizes,
  EXCEL_SIZE_KEYS,
  excelSizeToErpVariantSku,
  loadJubelioVariantIndex,
  resolveErpVariant,
} from "./umkm-sku-bridge";
import {
  aggregateOtherSourceQtyByVariant,
  buildUmkmParentSet,
  parseOtherSourcesDir,
  type OtherSourceLine,
} from "./umkm-other-sources-parse";

export type { UmkmExcelRow, UmkmParentAggregate } from "./umkm-excel-parse";
export {
  aggregateUmkmExcelByParent,
  aggregateUmkmExcelRows,
  excelSerialToDate,
  parseUmkmExcelDate,
  parseUmkmExcelFile,
} from "./umkm-excel-parse";
export {
  allocateParentSalesToSizes,
  buildErpVariantIndex,
  excelSizeToErpVariantSku,
  extractParentFromVariantSku,
  loadJubelioVariantIndex,
} from "./umkm-sku-bridge";

export type ManifestRow = {
  parentKode: string;
  erpVariantSku: string;
  size: string;
  namaBarang: string;
  excelSizeQty: number;
  excelParentQty: number;
  excelLatestTgl: string;
  excelLineCount: number;
  itemId: string | null;
  parentItemSku: string | null;
  itemName: string | null;
  jubelioItemId: number | null;
  jubelioItemCode: string | null;
  mappedVia: string | null;
  salesAllocatedQty: number;
  fakeBuyCreditQty: number;
  otherDeductionQty: number;
  netSalesDeductionQty: number;
  salesParentTotal: number;
  salesShopeeQty: number;
  salesTiktokQty: number;
  shopeeOrderCount: number;
  tiktokOrderCount: number;
  salesEarliestDate: string;
  salesLatestDate: string;
  currentQty: number;
  impliedOnHand: number;
  delta: number;
  status: string;
};

export type SalesOrderDetailRow = {
  parentKode: string;
  channel: string;
  orderId: string;
  orderDate: string;
  netQuantity: number;
  productName: string;
};

export type VariantMapRow = {
  parentKode: string;
  erpVariantSku: string;
  size: string;
  jubelioItemCode: string | null;
  jubelioItemId: number | null;
  parentItemSku: string | null;
  itemName: string | null;
};

export type FakeBuyCreditRow = {
  sourceFile: string;
  sourceSheet: string;
  deductionType: string;
  parentKode: string;
  erpVariantSku: string;
  size: string;
  qty: number;
  orderId: string | null;
  referenceId: string;
  channel: string | null;
  tanggal: string | null;
  matchedInSalesHistory: boolean;
};

export type OtherDeductionRow = {
  sourceFile: string;
  sourceSheet: string;
  deductionType: string;
  parentKode: string;
  erpVariantSku: string;
  size: string;
  qty: number;
  referenceId: string;
  tanggal: string | null;
};

export type OtherSourceSkippedRow = {
  sourceFile: string;
  sourceSheet: string;
  deductionType: string;
  lineKind: string;
  parentKode: string;
  erpVariantSku: string;
  size: string;
  qty: number;
  referenceId: string;
  parseStatus: string;
};

export type ManifestResult = {
  cutoff: Date;
  excelMaxTgl: Date | null;
  salesMaxDate: Date | null;
  rows: ManifestRow[];
  salesOrders: SalesOrderDetailRow[];
  variantMap: VariantMapRow[];
  fakeBuyCredits: FakeBuyCreditRow[];
  otherDeductions: OtherDeductionRow[];
  otherSourcesSkipped: OtherSourceSkippedRow[];
  otherSourcesSummary: {
    fakeBuyLineCount: number;
    deductionLineCount: number;
    skippedLineCount: number;
    duplicateCount: number;
    byDeductionType: Record<string, number>;
    bySourceFile: Record<string, number>;
  };
  summary: {
    totalVariantRows: number;
    totalParentSkus: number;
    mapped: number;
    unmapped: number;
    withSales: number;
    negativeImplied: number;
    applyable: number;
  };
};

type SalesBucket = {
  shopeeQty: number;
  tiktokQty: number;
  shopeeOrderIds: Set<string>;
  tiktokOrderIds: Set<string>;
  earliest: Date | null;
  latest: Date | null;
};

function emptySalesBucket(): SalesBucket {
  return {
    shopeeQty: 0,
    tiktokQty: 0,
    shopeeOrderIds: new Set(),
    tiktokOrderIds: new Set(),
    earliest: null,
    latest: null,
  };
}

function bumpDate(bucket: SalesBucket, d: Date) {
  if (!bucket.earliest || d < bucket.earliest) bucket.earliest = d;
  if (!bucket.latest || d > bucket.latest) bucket.latest = d;
}

export async function computeCutoffDate(
  prisma: PrismaClient,
  excelRows: UmkmExcelRow[],
): Promise<{ cutoff: Date; excelMaxTgl: Date | null; salesMaxDate: Date | null }> {
  let excelMaxTgl: Date | null = null;
  for (const row of excelRows) {
    if (!excelMaxTgl || row.tgl > excelMaxTgl) excelMaxTgl = row.tgl;
  }

  const salesMax = await prisma.salesHistory.aggregate({
    where: { orderStatus: SalesHistoryStatus.COMPLETED },
    _max: { orderDate: true },
  });
  const salesMaxDate = salesMax._max.orderDate ?? null;

  const candidates = [excelMaxTgl, salesMaxDate].filter((d): d is Date => d != null);
  const cutoff =
    candidates.length > 0
      ? new Date(Math.max(...candidates.map((d) => d.getTime())))
      : new Date();

  return { cutoff, excelMaxTgl, salesMaxDate };
}

export async function buildUmkmManifest(
  prisma: PrismaClient,
  excelFilePath: string,
  options?: { otherSourcesDir?: string },
): Promise<ManifestResult> {
  const excelRows = parseUmkmExcelFile(excelFilePath);
  const { cutoff, excelMaxTgl, salesMaxDate } = await computeCutoffDate(prisma, excelRows);
  const parentAggregates = aggregateUmkmExcelByParent(excelRows, cutoff);
  const parentKodes = parentAggregates.map((p) => p.parentKode);
  const umkmParentSet = buildUmkmParentSet(parentKodes);

  const erpIndex = await loadJubelioVariantIndex(prisma);

  const otherSources = options?.otherSourcesDir
    ? parseOtherSourcesDir(options.otherSourcesDir, umkmParentSet, erpIndex)
    : {
        fakeBuyLines: [] as OtherSourceLine[],
        deductionLines: [] as OtherSourceLine[],
        skipped: [] as OtherSourceLine[],
        summary: {
          fakeBuyLineCount: 0,
          deductionLineCount: 0,
          skippedLineCount: 0,
          duplicateCount: 0,
          byDeductionType: {} as Record<string, number>,
          bySourceFile: {} as Record<string, number>,
        },
      };

  const fakeBuyByVariant = aggregateOtherSourceQtyByVariant(otherSources.fakeBuyLines);
  const deductionByVariant = aggregateOtherSourceQtyByVariant(otherSources.deductionLines);

  const salesRows = await prisma.salesHistory.findMany({
    where: {
      variantSku: { in: parentKodes },
      orderStatus: SalesHistoryStatus.COMPLETED,
      orderDate: { lte: cutoff },
    },
    select: {
      variantSku: true,
      channel: true,
      orderId: true,
      orderDate: true,
      netQuantity: true,
      productName: true,
    },
    orderBy: [{ variantSku: "asc" }, { channel: "asc" }, { orderDate: "asc" }, { orderId: "asc" }],
  });

  const salesHistoryKeys = new Set(
    salesRows.map((row) => `${row.channel}::${row.orderId}::${row.variantSku}`),
  );

  const salesByParent = new Map<string, SalesBucket>();
  for (const row of salesRows) {
    let bucket = salesByParent.get(row.variantSku);
    if (!bucket) {
      bucket = emptySalesBucket();
      salesByParent.set(row.variantSku, bucket);
    }

    const qty = row.netQuantity;
    if (row.channel === "SHOPEE") {
      bucket.shopeeQty += qty;
      bucket.shopeeOrderIds.add(row.orderId);
    } else {
      bucket.tiktokQty += qty;
      bucket.tiktokOrderIds.add(row.orderId);
    }
    bumpDate(bucket, row.orderDate);
  }

  const itemIds = new Set<string>();
  for (const parent of parentKodes) {
    for (const ref of erpIndex.byParentKode.get(parent) ?? []) {
      itemIds.add(ref.itemId);
    }
  }

  const inventoryRows =
    itemIds.size > 0
      ? await prisma.inventoryValue.findMany({
          where: { itemId: { in: [...itemIds] } },
          select: { itemId: true, variantSku: true, qtyOnHand: true },
        })
      : [];

  const inventoryMap = new Map<string, number>();
  for (const inv of inventoryRows) {
    const key = `${inv.itemId}::${inv.variantSku ?? ""}`;
    inventoryMap.set(key, Number(inv.qtyOnHand));
  }

  const manifestRows: ManifestRow[] = [];

  for (const parent of parentAggregates) {
    const sales = salesByParent.get(parent.parentKode) ?? emptySalesBucket();
    const salesParentTotal = sales.shopeeQty + sales.tiktokQty;
    const salesAllocated = allocateParentSalesToSizes(salesParentTotal, parent.sizes);
    const parentHasErp = (erpIndex.byParentKode.get(parent.parentKode) ?? []).length > 0;

    for (const size of EXCEL_SIZE_KEYS) {
      const excelSizeQty = parent.sizes[size];
      if (excelSizeQty <= 0) continue;

      const erpVariantSku = excelSizeToErpVariantSku(parent.parentKode, size);
      const erpRef = resolveErpVariant(erpIndex, parent.parentKode, size);
      const salesAllocatedQty = salesAllocated[size];
      const fakeBuyCreditQty = fakeBuyByVariant.get(erpVariantSku) ?? 0;
      const otherDeductionQty = deductionByVariant.get(erpVariantSku) ?? 0;
      const netSalesDeductionQty = salesAllocatedQty - fakeBuyCreditQty;
      const impliedOnHand =
        excelSizeQty - salesAllocatedQty + fakeBuyCreditQty - otherDeductionQty;

      let currentQty = 0;
      if (erpRef) {
        const invKey = `${erpRef.itemId}::${erpVariantSku}`;
        currentQty = inventoryMap.get(invKey) ?? 0;
      }

      const delta = impliedOnHand - currentQty;

      let status: string;
      if (!erpRef) {
        status = parentHasErp ? "ERP_SIZE_MISSING" : "UNMAPPED";
      } else if (impliedOnHand < 0) {
        status = "NEGATIVE_IMPLIED";
      } else if (Math.abs(delta) < 0.01) {
        status = "NO_DELTA";
      } else if (salesParentTotal === 0) {
        status = "EXCEL_ONLY";
      } else {
        status = "OK";
      }

      manifestRows.push({
        parentKode: parent.parentKode,
        erpVariantSku,
        size,
        namaBarang: parent.namaBarang,
        excelSizeQty,
        excelParentQty: parent.excelQty,
        excelLatestTgl: parent.latestTgl.toISOString().slice(0, 10),
        excelLineCount: parent.lineCount,
        itemId: erpRef?.itemId ?? null,
        parentItemSku: erpRef?.parentItemSku ?? null,
        itemName: erpRef?.itemName ?? null,
        jubelioItemId: erpRef?.jubelioItemId ?? null,
        jubelioItemCode: erpRef?.jubelioItemCode ?? null,
        mappedVia: erpRef ? "jubelio_size_variant" : null,
        salesAllocatedQty,
        fakeBuyCreditQty,
        otherDeductionQty,
        netSalesDeductionQty,
        salesParentTotal,
        salesShopeeQty: sales.shopeeQty,
        salesTiktokQty: sales.tiktokQty,
        shopeeOrderCount: sales.shopeeOrderIds.size,
        tiktokOrderCount: sales.tiktokOrderIds.size,
        salesEarliestDate: sales.earliest?.toISOString().slice(0, 10) ?? "",
        salesLatestDate: sales.latest?.toISOString().slice(0, 10) ?? "",
        currentQty,
        impliedOnHand,
        delta,
        status,
      });
    }
  }

  const parentSet = new Set(manifestRows.map((r) => r.parentKode));

  const salesOrders: SalesOrderDetailRow[] = salesRows.map((row) => ({
    parentKode: row.variantSku,
    channel: row.channel,
    orderId: row.orderId,
    orderDate: row.orderDate.toISOString().slice(0, 10),
    netQuantity: row.netQuantity,
    productName: row.productName,
  }));

  const variantMap: VariantMapRow[] = [];
  const seenVariants = new Set<string>();
  for (const row of manifestRows) {
    if (seenVariants.has(row.erpVariantSku)) continue;
    seenVariants.add(row.erpVariantSku);
    variantMap.push({
      parentKode: row.parentKode,
      erpVariantSku: row.erpVariantSku,
      size: row.size,
      jubelioItemCode: row.jubelioItemCode,
      jubelioItemId: row.jubelioItemId,
      parentItemSku: row.parentItemSku,
      itemName: row.itemName,
    });
  }

  const fakeBuyCredits: FakeBuyCreditRow[] = otherSources.fakeBuyLines.map((line) => ({
    sourceFile: line.sourceFile,
    sourceSheet: line.sourceSheet,
    deductionType: line.deductionType,
    parentKode: line.parentKode,
    erpVariantSku: line.erpVariantSku,
    size: line.size,
    qty: line.qty,
    orderId: line.orderId,
    referenceId: line.referenceId,
    channel: line.channel,
    tanggal: line.tanggal,
    matchedInSalesHistory:
      line.orderId != null &&
      line.channel != null &&
      salesHistoryKeys.has(`${line.channel}::${line.orderId}::${line.parentKode}`),
  }));

  const otherDeductions: OtherDeductionRow[] = otherSources.deductionLines.map((line) => ({
    sourceFile: line.sourceFile,
    sourceSheet: line.sourceSheet,
    deductionType: line.deductionType,
    parentKode: line.parentKode,
    erpVariantSku: line.erpVariantSku,
    size: line.size,
    qty: line.qty,
    referenceId: line.referenceId,
    tanggal: line.tanggal,
  }));

  const otherSourcesSkipped: OtherSourceSkippedRow[] = otherSources.skipped.map((line) => ({
    sourceFile: line.sourceFile,
    sourceSheet: line.sourceSheet,
    deductionType: line.deductionType,
    lineKind: line.lineKind,
    parentKode: line.parentKode,
    erpVariantSku: line.erpVariantSku,
    size: line.size,
    qty: line.qty,
    referenceId: line.referenceId,
    parseStatus: line.parseStatus,
  }));

  const summary = {
    totalVariantRows: manifestRows.length,
    totalParentSkus: parentSet.size,
    mapped: manifestRows.filter((r) => r.itemId != null).length,
    unmapped: manifestRows.filter(
      (r) => r.status === "UNMAPPED" || r.status === "ERP_SIZE_MISSING",
    ).length,
    withSales: manifestRows.filter((r) => r.salesParentTotal > 0).length,
    negativeImplied: manifestRows.filter((r) => r.status === "NEGATIVE_IMPLIED").length,
    applyable: manifestRows.filter(
      (r) =>
        r.itemId != null &&
        r.status !== "NEGATIVE_IMPLIED" &&
        r.status !== "NO_DELTA" &&
        Math.abs(r.delta) >= 0.01,
    ).length,
  };

  return {
    cutoff,
    excelMaxTgl,
    salesMaxDate,
    rows: manifestRows,
    salesOrders,
    variantMap,
    fakeBuyCredits,
    otherDeductions,
    otherSourcesSkipped,
    otherSourcesSummary: otherSources.summary,
    summary,
  };
}

export type ApplyResult = {
  applied: number;
  skipped: number;
  errors: { kodeBarang: string; message: string }[];
};

const APPLY_REASON_PREFIX = "UMKM opening balance reconciliation (one-time)";

export async function applyUmkmManifest(
  prisma: PrismaClient,
  manifest: ManifestResult,
  userId: string,
): Promise<ApplyResult> {
  const toApply = manifest.rows.filter(
    (r) =>
      r.itemId != null &&
      r.status !== "NEGATIVE_IMPLIED" &&
      r.status !== "UNMAPPED" &&
      r.status !== "ERP_SIZE_MISSING" &&
      Math.abs(r.delta) >= 0.01,
  );

  let applied = 0;
  let skipped = 0;
  const errors: { kodeBarang: string; message: string }[] = [];

  for (const row of toApply) {
    const itemId = row.itemId!;
    const variantSku = row.erpVariantSku;
    const variantKey = variantSku;
    const type = row.delta > 0 ? "POSITIVE" : "NEGATIVE";
    const qtyChange = Math.abs(row.delta);
    const idempotencyDoc = `ADJ/UMKM-OPEN/${variantSku}`;

    try {
      const existingAdj = await prisma.stockAdjustment.findUnique({
        where: { docNumber: idempotencyDoc },
      });
      if (existingAdj) {
        skipped += 1;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        await tx.inventoryValue.createMany({
          data: [
            {
              itemId,
              variantSku: variantKey,
              qtyOnHand: 0,
              avgCost: 0,
              totalValue: 0,
            },
          ],
          skipDuplicates: true,
        });

        const compositeWhere = {
          itemId_variantSku: { itemId, variantSku: variantKey },
        };

        const current = await tx.inventoryValue.findUnique({ where: compositeWhere });
        if (!current) {
          throw new Error("Inventory row missing after bootstrap");
        }

        const prevQty = new Decimal(current.qtyOnHand.toString());
        const prevAvgCost = new Decimal(current.avgCost.toString());
        const qtyDecimal = new Decimal(qtyChange);
        const newQty =
          type === "POSITIVE" ? prevQty.plus(qtyDecimal) : prevQty.minus(qtyDecimal);

        if (newQty.lt(0)) {
          throw new Error(`Adjustment would result in negative stock (${newQty})`);
        }

        const reason = `${APPLY_REASON_PREFIX}; cutoff=${manifest.cutoff.toISOString().slice(0, 10)}; parent=${row.parentKode}; excel_size=${row.excelSizeQty}; sales_alloc=${row.salesAllocatedQty}; fake_buy_credit=${row.fakeBuyCreditQty}; other_ded=${row.otherDeductionQty}`;

        const adjustment = await tx.stockAdjustment.create({
          data: {
            docNumber: idempotencyDoc,
            itemId,
            type,
            qtyChange,
            reason,
            prevQty: prevQty.toNumber(),
            newQty: newQty.toNumber(),
            prevAvgCost: prevAvgCost.toNumber(),
            newAvgCost: prevAvgCost.toNumber(),
            approvedById: userId,
            createdById: userId,
            source: "ERP",
          },
        });

        const newTotalValue = newQty.mul(prevAvgCost);
        await tx.inventoryValue.update({
          where: compositeWhere,
          data: {
            qtyOnHand: newQty.toNumber(),
            totalValue: newTotalValue.toNumber(),
            lastUpdated: new Date(),
          },
        });

        const adjQty = type === "POSITIVE" ? qtyChange : -qtyChange;
        const totalCostAdj =
          type === "POSITIVE"
            ? qtyDecimal.mul(prevAvgCost).toNumber()
            : qtyDecimal.mul(prevAvgCost).neg().toNumber();

        await tx.stockMovement.create({
          data: {
            itemId,
            variantSku: variantKey,
            type: "ADJUSTMENT",
            refType: "ADJUSTMENT",
            refId: adjustment.id,
            refDocNumber: idempotencyDoc,
            qty: adjQty,
            unitCost: prevAvgCost.toNumber(),
            totalCost: totalCostAdj,
            balanceQty: newQty.toNumber(),
            balanceValue: newTotalValue.toNumber(),
            notes: reason,
          },
        });

        await tx.auditLog.create({
          data: {
            userId,
            action: "STOCK_ADJUSTMENT",
            entityType: "StockAdjustment",
            entityId: adjustment.id,
            changes: {
              parentKode: row.parentKode,
              erpVariantSku: variantSku,
              excelSizeQty: row.excelSizeQty,
              salesAllocatedQty: row.salesAllocatedQty,
              fakeBuyCreditQty: row.fakeBuyCreditQty,
              otherDeductionQty: row.otherDeductionQty,
              impliedOnHand: row.impliedOnHand,
              delta: row.delta,
              cutoff: manifest.cutoff.toISOString(),
            },
          },
        });
      });

      applied += 1;
    } catch (err) {
      errors.push({
        kodeBarang: row.erpVariantSku,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { applied, skipped, errors };
}

export async function resolveScriptUserId(prisma: PrismaClient): Promise<string> {
  const admin = await prisma.user.findFirst({
    where: { role: Role.ADMIN },
    orderBy: { createdAt: "asc" },
    select: { id: true, email: true },
  });
  if (!admin) {
    throw new Error("No active ADMIN user found. Pass --user-id explicitly.");
  }
  return admin.id;
}
