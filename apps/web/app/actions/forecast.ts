"use server";

import { revalidatePath } from "next/cache";
import {
  ABCClass,
  SalesChannel,
  SalesHistoryStatus,
  XYZClass,
} from "@elorae/db";
import { prisma } from "@elorae/db";
import { auth } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import {
  buildUnifiedDemandRows,
  runForecastPipeline,
} from "@/lib/forecast/calculations";
import { parseShopeeExcel } from "@/lib/forecast/shopee-parser";
import { parseTikTokExcel } from "@/lib/forecast/tiktok-parser";
import type { DemandRow, SalesHistoryRow } from "@/lib/forecast/types";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";
import { createPlanCategory, updatePlanCategory } from "@/app/actions/planning";

const FORECAST_PATH = "/backoffice/forecast";
const FORECAST_IMPORT_PATH = "/backoffice/forecast/import";
const PLANNING_PATH = "/backoffice/production/planning";

const PLAN_TOLERANCE_PERCENT = 5;

function toNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (typeof value === "object" && value && "toString" in value) {
    return Number(String(value));
  }
  return 0;
}

async function requireForecastView() {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.FORECAST_VIEW);
  return session;
}

async function requireForecastManage() {
  const session = await auth();
  if (!session) throw new Error("Unauthorized");
  requirePermission(session.user.permissions, PERMISSIONS.FORECAST_MANAGE);
  return session;
}

async function requirePlanBridgeManage() {
  const session = await requireForecastManage();
  requirePermission(
    session.user.permissions,
    PERMISSIONS.PRODUCTION_PLANNING_MANAGE
  );
  return session;
}

function channelLabel(channel: SalesChannel): string {
  return channel === "SHOPEE" ? "Shopee" : "TikTok";
}

function periodLabel(month: number, year: number): string {
  return `${month}/${year}`;
}

async function enrichParentSkus(
  rows: SalesHistoryRow[]
): Promise<SalesHistoryRow[]> {
  const variantSkus = [...new Set(rows.map((r) => r.variantSku))];
  if (variantSkus.length === 0) return rows;

  const mappings = await prisma.jubelioProductMapping.findMany({
    where: { erpVariantSku: { in: variantSkus } },
    include: { item: { select: { sku: true } } },
  });
  const skuToParent = new Map(
    mappings.map((m) => [m.erpVariantSku, m.item.sku])
  );

  return rows.map((row) => {
    const mapped = skuToParent.get(row.variantSku);
    if (mapped) {
      return { ...row, parentSku: mapped };
    }
    return row;
  });
}

function lookbackWindow(targetYear: number, lookbackMonths: number) {
  const end = new Date(targetYear, 0, 1);
  end.setMilliseconds(end.getMilliseconds() - 1);
  const start = new Date(end);
  start.setMonth(start.getMonth() - lookbackMonths + 1);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function salesHistoryToDemandRows(
  records: Array<{
    parentSku: string;
    productName: string;
    netQuantity: number;
    lineTotal: unknown;
    orderDate: Date;
  }>
): DemandRow[] {
  return records.map((r) => ({
    parentSku: r.parentSku,
    productName: r.productName,
    netQuantity: r.netQuantity,
    lineTotal: toNumber(r.lineTotal),
    orderDate: r.orderDate,
    month: r.orderDate.getMonth() + 1,
    year: r.orderDate.getFullYear(),
  }));
}

const resolvedItemSelect = {
  id: true,
  sku: true,
  categoryId: true,
  category: { select: { id: true, code: true, name: true } },
} as const;

type ResolvedItem = {
  id: string;
  sku: string;
  categoryId: string | null;
  category: { id: string; code: string | null; name: string } | null;
};

async function buildItemByParentSkuMap(
  parentSkus: string[]
): Promise<Map<string, ResolvedItem | null>> {
  const unique = [...new Set(parentSkus)];
  const map = new Map<string, ResolvedItem | null>();
  if (unique.length === 0) return map;

  const [mappings, items] = await Promise.all([
    prisma.jubelioProductMapping.findMany({
      where: {
        OR: [
          { erpVariantSku: { in: unique } },
          { item: { sku: { in: unique } } },
        ],
      },
      include: { item: { select: resolvedItemSelect } },
    }),
    prisma.item.findMany({
      where: { sku: { in: unique } },
      select: resolvedItemSelect,
    }),
  ]);

  const itemBySku = new Map(items.map((i) => [i.sku, i]));
  const mappingByVariantSku = new Map<string, (typeof mappings)[number]>();
  const mappingByItemSku = new Map<string, (typeof mappings)[number]>();
  for (const m of mappings) {
    mappingByVariantSku.set(m.erpVariantSku, m);
    mappingByItemSku.set(m.item.sku, m);
  }

  for (const parentSku of unique) {
    const mapping =
      mappingByVariantSku.get(parentSku) ?? mappingByItemSku.get(parentSku);
    if (mapping) {
      const bySku = itemBySku.get(parentSku);
      if (bySku && bySku.id !== mapping.itemId) {
        console.warn(
          `[forecast] Jubelio mapping overrides Item.sku for ${parentSku}`
        );
      }
      map.set(parentSku, mapping.item);
    } else {
      map.set(parentSku, itemBySku.get(parentSku) ?? null);
    }
  }

  return map;
}

async function buildPlanRootByItemCategoryId(
  planYearId: string,
  itemCategoryIds: string[]
): Promise<Map<string, { id: string; targetQty: number | null }>> {
  const unique = [...new Set(itemCategoryIds)];
  const map = new Map<string, { id: string; targetQty: number | null }>();
  if (unique.length === 0) return map;

  const categories = await prisma.planCategory.findMany({
    where: {
      planYearId,
      parentId: null,
      itemCategoryId: { in: unique },
    },
    select: { id: true, targetQty: true, itemCategoryId: true },
  });

  for (const cat of categories) {
    if (cat.itemCategoryId) {
      map.set(cat.itemCategoryId, {
        id: cat.id,
        targetQty: cat.targetQty,
      });
    }
  }

  return map;
}

async function resolveItemForParentSku(parentSku: string) {
  const map = await buildItemByParentSkuMap([parentSku]);
  return map.get(parentSku) ?? null;
}

function planAction(
  forecastAnnual: number,
  existingTarget: number | null
): "CREATE" | "UPDATE" | "SKIP" {
  if (existingTarget == null) return "CREATE";
  if (existingTarget === 0) return "UPDATE";
  const deltaPct =
    (Math.abs(forecastAnnual - existingTarget) / existingTarget) * 100;
  return deltaPct <= PLAN_TOLERANCE_PERCENT ? "SKIP" : "UPDATE";
}

export interface SalesHistoryImportSummary {
  id: string;
  channel: SalesChannel;
  periodMonth: number;
  periodYear: number;
  fileName: string;
  importedRows: number;
  skippedRows: number;
  errorRows: number;
  createdAt: Date;
}

export async function importSalesHistory(data: {
  base64: string;
  fileName: string;
  channel: SalesChannel;
  periodMonth: number;
  periodYear: number;
}): Promise<{
  success: boolean;
  imported?: number;
  skipped?: number;
  errors?: { row: number; message: string }[];
  error?: string;
}> {
  try {
    const session = await requireForecastManage();

    const existing = await prisma.salesHistoryImport.findUnique({
      where: {
        channel_periodYear_periodMonth: {
          channel: data.channel,
          periodYear: data.periodYear,
          periodMonth: data.periodMonth,
        },
      },
    });
    if (existing) {
      return {
        success: false,
        error: `Data untuk ${channelLabel(data.channel)} ${periodLabel(data.periodMonth, data.periodYear)} sudah diimport. Hapus import sebelumnya jika ingin re-import.`,
      };
    }

    const buffer = Buffer.from(data.base64, "base64");
    const parsed =
      data.channel === "SHOPEE"
        ? parseShopeeExcel(buffer)
        : parseTikTokExcel(buffer);

    const completed = parsed.rows.filter((r) => r.status === "COMPLETED");
    const enriched = await enrichParentSkus(completed);

    const importRecord = await prisma.salesHistoryImport.create({
      data: {
        channel: data.channel,
        fileName: data.fileName,
        periodMonth: data.periodMonth,
        periodYear: data.periodYear,
        totalRows: parsed.totalParsed + parsed.totalErrors,
        importedRows: 0,
        skippedRows: 0,
        errorRows: parsed.totalErrors,
        errors: parsed.errors.length > 0 ? parsed.errors : undefined,
        uploadedById: session.user.id,
      },
    });

    const createPayload = enriched.map((row) => ({
      channel: data.channel,
      orderId: row.orderId,
      orderStatus: SalesHistoryStatus.COMPLETED,
      variantSku: row.variantSku,
      parentSku: row.parentSku,
      productName: row.productName,
      color: row.color,
      size: row.size,
      quantity: row.quantity,
      returnedQuantity: row.returnedQuantity,
      netQuantity: row.netQuantity,
      unitPrice: row.unitPrice,
      unitPriceAfterDiscount: row.unitPriceAfterDiscount,
      lineTotal: row.lineTotal,
      orderTotal: row.orderTotal,
      orderDate: row.orderDate,
      completedDate: row.completedDate,
      province: row.province,
      city: row.city,
      productCategory: row.productCategory,
      importBatchId: importRecord.id,
    }));

    const beforeCount = await prisma.salesHistory.count({
      where: { importBatchId: importRecord.id },
    });

    await prisma.salesHistory.createMany({
      data: createPayload,
      skipDuplicates: true,
    });

    const afterCount = await prisma.salesHistory.count({
      where: { importBatchId: importRecord.id },
    });
    const imported = afterCount - beforeCount;
    const skipped = Math.max(0, createPayload.length - imported);

    await prisma.salesHistoryImport.update({
      where: { id: importRecord.id },
      data: {
        importedRows: imported,
        skippedRows: skipped,
      },
    });

    await logAudit({
      userId: session.user.id,
      action: "CREATE",
      entityType: "SalesHistoryImport",
      entityId: importRecord.id,
      metadata: {
        channel: data.channel,
        periodMonth: data.periodMonth,
        periodYear: data.periodYear,
        imported,
        skipped,
      },
    });

    revalidatePath(FORECAST_PATH);
    revalidatePath(FORECAST_IMPORT_PATH);

    return {
      success: true,
      imported,
      skipped,
      errors: parsed.errors,
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Import failed",
    };
  }
}

export async function deleteSalesHistoryImport(
  importId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const session = await requireForecastManage();
    const record = await prisma.salesHistoryImport.findUnique({
      where: { id: importId },
    });
    if (!record) return { success: false, error: "Import not found" };

    await prisma.salesHistoryImport.delete({ where: { id: importId } });

    await logAudit({
      userId: session.user.id,
      action: "DELETE",
      entityType: "SalesHistoryImport",
      entityId: importId,
    });

    revalidatePath(FORECAST_PATH);
    revalidatePath(FORECAST_IMPORT_PATH);
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Delete failed",
    };
  }
}

export async function getSalesHistoryImports(): Promise<
  SalesHistoryImportSummary[]
> {
  await requireForecastView();
  const rows = await prisma.salesHistoryImport.findMany({
    orderBy: [
      { periodYear: "desc" },
      { periodMonth: "desc" },
      { channel: "asc" },
    ],
  });
  return rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    periodMonth: r.periodMonth,
    periodYear: r.periodYear,
    fileName: r.fileName,
    importedRows: r.importedRows,
    skippedRows: r.skippedRows,
    errorRows: r.errorRows,
    createdAt: r.createdAt,
  }));
}

export interface DataCoverage {
  channels: {
    channel: SalesChannel;
    months: { year: number; month: number; rowCount: number }[];
    totalRows: number;
    earliestDate: Date | null;
    latestDate: Date | null;
  }[];
  totalArticles: number;
  totalMonthsCovered: number;
  hasMinimumForSeasonal: boolean;
}

export async function getDataCoverage(): Promise<DataCoverage> {
  await requireForecastView();

  const channels: SalesChannel[] = ["SHOPEE", "TIKTOK"];
  const result: DataCoverage["channels"] = [];

  for (const channel of channels) {
    const imports = await prisma.salesHistoryImport.findMany({
      where: { channel },
      select: { periodYear: true, periodMonth: true, importedRows: true },
    });
    const agg = await prisma.salesHistory.aggregate({
      where: { channel, orderStatus: SalesHistoryStatus.COMPLETED },
      _count: { id: true },
      _min: { orderDate: true },
      _max: { orderDate: true },
    });

    result.push({
      channel,
      months: imports.map((i) => ({
        year: i.periodYear,
        month: i.periodMonth,
        rowCount: i.importedRows,
      })),
      totalRows: agg._count.id,
      earliestDate: agg._min.orderDate,
      latestDate: agg._max.orderDate,
    });
  }

  const articles = await prisma.salesHistory.groupBy({
    by: ["parentSku"],
    where: { orderStatus: SalesHistoryStatus.COMPLETED },
  });

  const monthKeys = new Set<string>();
  const historyMonths = await prisma.salesHistory.findMany({
    where: { orderStatus: SalesHistoryStatus.COMPLETED },
    select: { orderDate: true },
    distinct: ["orderDate"],
  });
  for (const h of historyMonths) {
    monthKeys.add(`${h.orderDate.getFullYear()}-${h.orderDate.getMonth() + 1}`);
  }

  return {
    channels: result,
    totalArticles: articles.length,
    totalMonthsCovered: monthKeys.size,
    hasMinimumForSeasonal: monthKeys.size >= 12,
  };
}

export interface ForecastConfigDetail {
  id: string;
  year: number;
  growthFactorPercent: number;
  lookbackMonths: number;
  weightDecay: number;
  notes: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

function serializeForecastConfig(
  config: NonNullable<
    Awaited<ReturnType<typeof prisma.forecastConfig.findUnique>>
  >
): ForecastConfigDetail {
  return {
    id: config.id,
    year: config.year,
    growthFactorPercent: toNumber(config.growthFactorPercent),
    lookbackMonths: config.lookbackMonths,
    weightDecay: toNumber(config.weightDecay),
    notes: config.notes,
    createdById: config.createdById,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

export async function getForecastConfig(
  year: number
): Promise<ForecastConfigDetail | null> {
  await requireForecastView();
  const config = await prisma.forecastConfig.findUnique({ where: { year } });
  if (!config) return null;
  return serializeForecastConfig(config);
}

export async function updateForecastConfig(data: {
  year: number;
  growthFactorPercent?: number;
  lookbackMonths?: number;
  weightDecay?: number;
  notes?: string;
}) {
  try {
    const session = await requireForecastManage();
    const existing = await prisma.forecastConfig.findUnique({
      where: { year: data.year },
    });

    const payload = {
      growthFactorPercent: data.growthFactorPercent,
      lookbackMonths: data.lookbackMonths,
      weightDecay: data.weightDecay,
      notes: data.notes,
    };

    const config = existing
      ? await prisma.forecastConfig.update({
          where: { year: data.year },
          data: {
            ...(payload.growthFactorPercent !== undefined
              ? { growthFactorPercent: payload.growthFactorPercent }
              : {}),
            ...(payload.lookbackMonths !== undefined
              ? { lookbackMonths: payload.lookbackMonths }
              : {}),
            ...(payload.weightDecay !== undefined
              ? { weightDecay: payload.weightDecay }
              : {}),
            ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
          },
        })
      : await prisma.forecastConfig.create({
          data: {
            year: data.year,
            growthFactorPercent: data.growthFactorPercent ?? 0,
            lookbackMonths: data.lookbackMonths ?? 12,
            weightDecay: data.weightDecay ?? 0.9,
            notes: data.notes ?? null,
            createdById: session.user.id,
          },
        });

    await logAudit({
      userId: session.user.id,
      action: existing ? "UPDATE" : "CREATE",
      entityType: "ForecastConfig",
      entityId: config.id,
    });

    revalidatePath(FORECAST_PATH);
    return { success: true };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Update failed",
    };
  }
}

export async function runForecast(data: { targetYear: number }) {
  try {
    const session = await requireForecastManage();

    let config = await prisma.forecastConfig.findUnique({
      where: { year: data.targetYear },
    });
    if (!config) {
      config = await prisma.forecastConfig.create({
        data: {
          year: data.targetYear,
          createdById: session.user.id,
        },
      });
    }

    const lookback = config.lookbackMonths;
    const { start, end } = lookbackWindow(data.targetYear, lookback);

    const history = await prisma.salesHistory.findMany({
      where: {
        orderStatus: SalesHistoryStatus.COMPLETED,
        orderDate: { gte: start, lte: end },
      },
      select: {
        parentSku: true,
        productName: true,
        netQuantity: true,
        lineTotal: true,
        orderDate: true,
      },
    });

    const demandRows = buildUnifiedDemandRows(
      salesHistoryToDemandRows(history)
    );

    const articles = runForecastPipeline(demandRows, {
      targetYear: data.targetYear,
      growthFactorPercent: toNumber(config.growthFactorPercent),
      lookbackMonths: lookback,
      weightDecay: toNumber(config.weightDecay),
    });

    await prisma.forecastResult.deleteMany({
      where: { year: data.targetYear },
    });

    if (articles.length > 0) {
      await prisma.forecastResult.createMany({
        data: articles.map((a) => ({
          year: data.targetYear,
          parentSku: a.parentSku,
          productName: a.productName,
          abcClass: a.abcClass as ABCClass,
          xyzClass: a.xyzClass as XYZClass,
          totalHistoricalQty: a.totalHistoricalQty,
          totalHistoricalRevenue: a.totalHistoricalRevenue,
          avgMonthlyDemand: a.avgMonthlyDemand,
          coefficientOfVariation: a.coefficientOfVariation,
          forecastMonth1: a.monthlyForecast[0] ?? 0,
          forecastMonth2: a.monthlyForecast[1] ?? 0,
          forecastMonth3: a.monthlyForecast[2] ?? 0,
          forecastMonth4: a.monthlyForecast[3] ?? 0,
          forecastMonth5: a.monthlyForecast[4] ?? 0,
          forecastMonth6: a.monthlyForecast[5] ?? 0,
          forecastMonth7: a.monthlyForecast[6] ?? 0,
          forecastMonth8: a.monthlyForecast[7] ?? 0,
          forecastMonth9: a.monthlyForecast[8] ?? 0,
          forecastMonth10: a.monthlyForecast[9] ?? 0,
          forecastMonth11: a.monthlyForecast[10] ?? 0,
          forecastMonth12: a.monthlyForecast[11] ?? 0,
          forecastAnnual: a.annualForecast,
          seasonalIndex1: a.seasonalIndices[0] ?? 1,
          seasonalIndex2: a.seasonalIndices[1] ?? 1,
          seasonalIndex3: a.seasonalIndices[2] ?? 1,
          seasonalIndex4: a.seasonalIndices[3] ?? 1,
          seasonalIndex5: a.seasonalIndices[4] ?? 1,
          seasonalIndex6: a.seasonalIndices[5] ?? 1,
          seasonalIndex7: a.seasonalIndices[6] ?? 1,
          seasonalIndex8: a.seasonalIndices[7] ?? 1,
          seasonalIndex9: a.seasonalIndices[8] ?? 1,
          seasonalIndex10: a.seasonalIndices[9] ?? 1,
          seasonalIndex11: a.seasonalIndices[10] ?? 1,
          seasonalIndex12: a.seasonalIndices[11] ?? 1,
        })),
      });
    }

    await logAudit({
      userId: session.user.id,
      action: "CREATE",
      entityType: "ForecastResult",
      entityId: `year-${data.targetYear}`,
      metadata: { year: data.targetYear, count: articles.length },
    });

    revalidatePath(FORECAST_PATH);
    return { success: true, articleCount: articles.length };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Forecast failed",
    };
  }
}

export interface ForecastResultDetail {
  id: string;
  parentSku: string;
  productName: string;
  abcClass: ABCClass;
  xyzClass: XYZClass;
  abcXyz: string;
  totalHistoricalQty: number;
  totalHistoricalRevenue: number;
  avgMonthlyDemand: number;
  coefficientOfVariation: number;
  monthlyForecast: number[];
  seasonalIndices: number[];
  annualForecast: number;
  planTarget: number | null;
  planVsForecastDelta: number | null;
}

export async function getForecastResults(
  year: number
): Promise<ForecastResultDetail[]> {
  await requireForecastView();

  const results = await prisma.forecastResult.findMany({
    where: { year },
    orderBy: [{ abcClass: "asc" }, { forecastAnnual: "desc" }],
  });

  const planYear = await prisma.planYear.findUnique({
    where: { year },
    select: { id: true },
  });

  const planTargets = new Map<string, number>();
  if (planYear) {
    const categories = await prisma.planCategory.findMany({
      where: {
        planYearId: planYear.id,
        parentId: null,
        itemCategoryId: { not: null },
      },
      select: {
        targetQty: true,
        itemCategoryId: true,
        item: { select: { sku: true } },
      },
    });
    for (const cat of categories) {
      if (cat.item?.sku && cat.targetQty != null) {
        planTargets.set(cat.item.sku, cat.targetQty);
      }
    }
  }

  return results.map((r) => {
    const monthlyForecast = [
      r.forecastMonth1,
      r.forecastMonth2,
      r.forecastMonth3,
      r.forecastMonth4,
      r.forecastMonth5,
      r.forecastMonth6,
      r.forecastMonth7,
      r.forecastMonth8,
      r.forecastMonth9,
      r.forecastMonth10,
      r.forecastMonth11,
      r.forecastMonth12,
    ];
    const seasonalIndices = [
      toNumber(r.seasonalIndex1),
      toNumber(r.seasonalIndex2),
      toNumber(r.seasonalIndex3),
      toNumber(r.seasonalIndex4),
      toNumber(r.seasonalIndex5),
      toNumber(r.seasonalIndex6),
      toNumber(r.seasonalIndex7),
      toNumber(r.seasonalIndex8),
      toNumber(r.seasonalIndex9),
      toNumber(r.seasonalIndex10),
      toNumber(r.seasonalIndex11),
      toNumber(r.seasonalIndex12),
    ];
    const planTarget = planTargets.get(r.parentSku) ?? null;
    return {
      id: r.id,
      parentSku: r.parentSku,
      productName: r.productName,
      abcClass: r.abcClass,
      xyzClass: r.xyzClass,
      abcXyz: `${r.abcClass}${r.xyzClass}`,
      totalHistoricalQty: r.totalHistoricalQty,
      totalHistoricalRevenue: toNumber(r.totalHistoricalRevenue),
      avgMonthlyDemand: toNumber(r.avgMonthlyDemand),
      coefficientOfVariation: toNumber(r.coefficientOfVariation),
      monthlyForecast,
      seasonalIndices,
      annualForecast: r.forecastAnnual,
      planTarget,
      planVsForecastDelta:
        planTarget != null ? r.forecastAnnual - planTarget : null,
    };
  });
}

export interface PlanTargetSuggestion {
  parentSku: string;
  productName: string;
  abcClass: ABCClass;
  forecastAnnual: number;
  forecastMonthly: number[];
  existingPlanTarget: number | null;
  existingCategoryId: string | null;
  itemId: string | null;
  itemCategoryId: string | null;
  itemCategoryCode: string | null;
  itemCategoryName: string | null;
  canCreate: boolean;
  action: "CREATE" | "UPDATE" | "SKIP";
}

export async function suggestPlanTargets(data: {
  forecastYear: number;
  planYearId: string;
}): Promise<{
  success: boolean;
  suggestions?: PlanTargetSuggestion[];
  error?: string;
}> {
  try {
    await requirePlanBridgeManage();

    const results = await prisma.forecastResult.findMany({
      where: { year: data.forecastYear },
      orderBy: [{ abcClass: "asc" }, { forecastAnnual: "desc" }],
    });

    const parentSkus = results.map((r) => r.parentSku);
    const itemByParentSku = await buildItemByParentSkuMap(parentSkus);

    const categoryIds = [
      ...new Set(
        [...itemByParentSku.values()]
          .map((item) => item?.categoryId)
          .filter((id): id is string => id != null)
      ),
    ];
    const planRootByCategoryId = await buildPlanRootByItemCategoryId(
      data.planYearId,
      categoryIds
    );

    const suggestions: PlanTargetSuggestion[] = results.map((row) => {
      const monthly = [
        row.forecastMonth1,
        row.forecastMonth2,
        row.forecastMonth3,
        row.forecastMonth4,
        row.forecastMonth5,
        row.forecastMonth6,
        row.forecastMonth7,
        row.forecastMonth8,
        row.forecastMonth9,
        row.forecastMonth10,
        row.forecastMonth11,
        row.forecastMonth12,
      ];

      const item = itemByParentSku.get(row.parentSku) ?? null;
      const itemCategoryId = item?.categoryId ?? null;
      const itemCategory = item?.category ?? null;

      const rootPlan =
        itemCategoryId ?
          (planRootByCategoryId.get(itemCategoryId) ?? null)
        : null;

      const existingCategoryId = rootPlan?.id ?? null;
      const existingPlanTarget = rootPlan?.targetQty ?? null;
      const action = planAction(row.forecastAnnual, existingPlanTarget);
      const canCreate = Boolean(itemCategoryId);

      return {
        parentSku: row.parentSku,
        productName: row.productName,
        abcClass: row.abcClass,
        forecastAnnual: row.forecastAnnual,
        forecastMonthly: monthly,
        existingPlanTarget,
        existingCategoryId,
        itemId: item?.id ?? null,
        itemCategoryId,
        itemCategoryCode: itemCategory?.code ?? null,
        itemCategoryName: itemCategory?.name ?? null,
        canCreate,
        action,
      };
    });

    return { success: true, suggestions };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Suggest failed",
    };
  }
}

export async function applyPlanSuggestions(data: {
  planYearId: string;
  suggestions: {
    parentSku: string;
    action: "CREATE" | "UPDATE";
    targetQty: number;
    itemCategoryId?: string;
    itemId?: string | null;
    existingCategoryId?: string | null;
  }[];
}): Promise<{
  success: boolean;
  created?: number;
  updated?: number;
  error?: string;
}> {
  try {
    await requirePlanBridgeManage();

    let created = 0;
    let updated = 0;

    for (const suggestion of data.suggestions) {
      if (suggestion.action === "CREATE") {
        const item = await resolveItemForParentSku(suggestion.parentSku);
        const itemCategoryId =
          suggestion.itemCategoryId ?? item?.categoryId ?? null;
        if (!itemCategoryId) {
          throw new Error(
            `Item category required for ${suggestion.parentSku}. Pilih kategori item terlebih dahulu.`
          );
        }

        await createPlanCategory({
          planYearId: data.planYearId,
          itemCategoryId,
          targetQty: suggestion.targetQty,
          itemId: suggestion.itemId ?? item?.id ?? null,
        });
        created++;
      } else if (suggestion.action === "UPDATE") {
        const categoryId = suggestion.existingCategoryId;
        if (!categoryId) {
          throw new Error(`No plan category for ${suggestion.parentSku}`);
        }
        await updatePlanCategory(categoryId, {
          targetQty: suggestion.targetQty,
        });
        updated++;
      }
    }

    revalidatePath(PLANNING_PATH);
    revalidatePath(FORECAST_PATH);

    return { success: true, created, updated };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Apply failed",
    };
  }
}

export async function getPlanYearsForForecast() {
  return getPlanYearsForBridge();
}

export async function getPlanYearsForBridge() {
  await requireForecastView();
  return prisma.planYear.findMany({
    orderBy: { year: "desc" },
    select: { id: true, year: true, isLocked: true },
  });
}

export async function getItemCategoriesForForecast() {
  await requireForecastView();
  return prisma.itemCategory.findMany({
    where: { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, code: true, name: true },
  });
}
