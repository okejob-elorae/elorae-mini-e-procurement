"use server";

import { revalidatePath } from "next/cache";
import {
  ABCClass,
  ResolutionStatus,
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
import { salesHistoryToDemandRows } from "@/lib/forecast/history-demand";
import {
  buildMarketplaceDemand,
  wibMonthStart,
  wibYearMonth,
  type MarketplaceFamily,
  type MarketplaceMonthDiagnostics,
} from "@/lib/forecast/marketplace-demand";
import { buildKonsiDemand } from "@/lib/forecast/konsi-demand";
import {
  MAX_PAYOUT_DELAY_DAYS,
  PAYOUT_DELAY_SETTING_KEY,
  loadKonsiReports,
  loadMarketplaceDemandInput,
  loadPayoutDelayDays,
} from "@/lib/forecast/demand-sources";
import { PERMISSIONS, requirePermission } from "@/lib/rbac";
import { createPlanCategory, updatePlanCategory } from "@/app/actions/planning";
import { getEffectiveTarget } from "@/lib/planning/calculations";
import {
  buildCategoryApplyPlan,
  groupSuggestionsByCategory,
  suggestItemAction,
  type PlanBridgeChild,
} from "@/lib/forecast/plan-bridge";
import {
  loadResolverIndex,
  resolveMarketplaceSku,
} from "@/lib/sales/marketplace-sku-resolver";
import { countUnmappedSkusByImportBatch } from "@/lib/forecast/import-unmapped-count";

const FORECAST_PATH = "/backoffice/forecast";
const FORECAST_IMPORT_PATH = "/backoffice/forecast/import";
const PLANNING_PATH = "/backoffice/production/planning";
const UNMAPPED_DEMAND_WARN_THRESHOLD = 0.1;

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

/** The `lookbackMonths` WIB calendar months before `targetYear`, as a closed UTC range. */
function lookbackWindow(targetYear: number, lookbackMonths: number) {
  const startIndex = targetYear * 12 - lookbackMonths;
  const start = wibMonthStart(Math.floor(startIndex / 12), (startIndex % 12) + 1);
  const end = new Date(wibMonthStart(targetYear, 1).getTime() - 1);
  return { start, end };
}

const resolvedItemSelect = {
  id: true,
  sku: true,
  nameId: true,
  categoryId: true,
  category: { select: { id: true, code: true, name: true } },
} as const;

type ResolvedItem = {
  id: string;
  sku: string;
  nameId: string;
  categoryId: string | null;
  category: { id: string; code: string | null; name: string } | null;
};

async function buildItemByParentSkuMap(
  parentSkus: string[],
  itemIds: string[] = []
): Promise<Map<string, ResolvedItem | null>> {
  const uniqueSkus = [...new Set(parentSkus)];
  const uniqueItemIds = [...new Set(itemIds.filter(Boolean))];
  const map = new Map<string, ResolvedItem | null>();
  if (uniqueSkus.length === 0 && uniqueItemIds.length === 0) return map;

  const index = await loadResolverIndex(prisma);

  const resolvedItemIds = new Set<string>(uniqueItemIds);
  for (const parentSku of uniqueSkus) {
    const resolved = resolveMarketplaceSku(
      { variantSku: parentSku, size: "" },
      index
    );
    if (resolved.itemId) resolvedItemIds.add(resolved.itemId);
  }

  const items = await prisma.item.findMany({
    where: {
      OR: [
        { sku: { in: uniqueSkus } },
        { id: { in: [...resolvedItemIds] } },
      ],
    },
    select: resolvedItemSelect,
  });

  const itemById = new Map(items.map((i) => [i.id, i]));
  const itemBySku = new Map(items.map((i) => [i.sku, i]));

  for (const parentSku of uniqueSkus) {
    const directItem = itemBySku.get(parentSku);
    if (directItem) {
      map.set(parentSku, directItem);
      continue;
    }

    const resolved = resolveMarketplaceSku(
      { variantSku: parentSku, size: "" },
      index
    );
    if (resolved.itemId) {
      const fromResolve = itemById.get(resolved.itemId);
      map.set(parentSku, fromResolve ?? null);
      continue;
    }

    map.set(parentSku, null);
  }

  return map;
}

type PlanRootWithChildren = {
  id: string;
  targetQty: number | null;
  children: Array<{
    id: string;
    itemId: string | null;
    parentSharePercent: unknown;
    code: string | null;
  }>;
};

async function buildPlanRootByItemCategoryId(
  planYearId: string,
  itemCategoryIds: string[]
): Promise<Map<string, PlanRootWithChildren>> {
  const unique = [...new Set(itemCategoryIds)];
  const map = new Map<string, PlanRootWithChildren>();
  if (unique.length === 0) return map;

  const categories = await prisma.planCategory.findMany({
    where: {
      planYearId,
      parentId: null,
      itemCategoryId: { in: unique },
    },
    select: {
      id: true,
      targetQty: true,
      itemCategoryId: true,
      children: {
        select: {
          id: true,
          itemId: true,
          parentSharePercent: true,
          code: true,
        },
      },
    },
  });

  for (const cat of categories) {
    if (cat.itemCategoryId) {
      map.set(cat.itemCategoryId, {
        id: cat.id,
        targetQty: cat.targetQty,
        children: cat.children,
      });
    }
  }

  return map;
}

function toSharePercent(value: unknown): number {
  return toNumber(value);
}

function childEffectiveTarget(
  root: PlanRootWithChildren,
  child: PlanRootWithChildren["children"][number]
): number {
  return getEffectiveTarget({
    id: child.id,
    parentId: root.id,
    targetQty: null,
    parentSharePercent: toSharePercent(child.parentSharePercent),
    itemId: child.itemId,
    parent: { targetQty: root.targetQty },
  });
}

function mapPlanBridgeChildren(
  children: PlanRootWithChildren["children"]
): PlanBridgeChild[] {
  return children.map((child) => ({
    id: child.id,
    itemId: child.itemId,
    parentSharePercent: toSharePercent(child.parentSharePercent),
    code: child.code,
  }));
}

export interface SalesHistoryImportSummary {
  id: string;
  channel: SalesChannel;
  periodMonth: number;
  periodYear: number;
  fileName: string;
  importedRows: number;
  skippedRows: number;
  unmappedSkuCount: number;
  errorRows: number;
  createdAt: Date;
}

export type SalesHistorySkippedRowDetail = {
  orderId: string;
  variantSku: string;
  productName: string;
  reason: "DUPLICATE_IN_BATCH" | "ALREADY_EXISTS";
};

export type SalesHistorySkippedRowsResult = {
  rows: SalesHistorySkippedRowDetail[];
  detailAvailable: boolean;
};

export async function getSalesHistoryImportSkippedRows(
  importId: string,
): Promise<SalesHistorySkippedRowsResult> {
  await requireForecastView();
  const record = await prisma.salesHistoryImport.findUnique({
    where: { id: importId },
    select: { skippedDetails: true },
  });
  if (!record) {
    throw new Error("Import not found");
  }

  const details = record.skippedDetails as SalesHistorySkippedRowDetail[] | null;
  return {
    rows: details ?? [],
    detailAvailable: details !== null,
  };
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
  const unmappedSkuCounts = await countUnmappedSkusByImportBatch(
    rows.map((row) => row.id),
  );
  return rows.map((r) => ({
    id: r.id,
    channel: r.channel,
    periodMonth: r.periodMonth,
    periodYear: r.periodYear,
    fileName: r.fileName,
    importedRows: r.importedRows,
    skippedRows: r.skippedRows,
    unmappedSkuCount: unmappedSkuCounts.get(r.id) ?? 0,
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
  mappingCoveragePercent: number;
  unmappedDemandPercent: number;
  unmappedDemandWarn: boolean;
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

  const mappingAgg = await prisma.salesHistory.aggregate({
    where: { orderStatus: SalesHistoryStatus.COMPLETED },
    _count: { id: true },
    _sum: { netQuantity: true },
  });
  const mappedAgg = await prisma.salesHistory.aggregate({
    where: {
      orderStatus: SalesHistoryStatus.COMPLETED,
      resolutionStatus: ResolutionStatus.MAPPED,
    },
    _count: { id: true },
    _sum: { netQuantity: true },
  });
  const totalRows = mappingAgg._count.id;
  const mappedRows = mappedAgg._count.id;
  const totalQty = mappingAgg._sum.netQuantity ?? 0;
  const mappedQty = mappedAgg._sum.netQuantity ?? 0;
  const mappingCoveragePercent =
    totalRows > 0 ? Math.round((mappedRows / totalRows) * 100) : 0;
  const unmappedDemandPercent =
    totalQty > 0 ? (totalQty - mappedQty) / totalQty : 0;

  return {
    channels: result,
    totalArticles: articles.length,
    totalMonthsCovered: monthKeys.size,
    hasMinimumForSeasonal: monthKeys.size >= 12,
    mappingCoveragePercent,
    unmappedDemandPercent,
    unmappedDemandWarn:
      unmappedDemandPercent > UNMAPPED_DEMAND_WARN_THRESHOLD,
  };
}

const SOURCE_COVERAGE_MONTHS = 12;

export interface DemandSourceMonth {
  year: number;
  month: number;
  /** Units from Shopee/TikTok Excel imports (`SalesHistory` with an import batch). */
  importedQty: Record<MarketplaceFamily, number>;
  /** Units from offline sales: putus deliveries, SPG POS and van sales (`SalesHistory` OFFLINE). */
  offlineQty: number;
  /** Units from approved konsi sell-through reports, net of SPG POS units. */
  konsiQty: number;
  /** Synced marketplace orders; null when the month has no order of that marketplace. */
  marketplace: Record<MarketplaceFamily, MarketplaceMonthDiagnostics | null>;
}

export interface DemandSourceCoverage {
  months: DemandSourceMonth[];
  payoutDelayDays: Record<MarketplaceFamily, number>;
}

/** Demand per source for the last 12 WIB months (current month included), oldest first. */
export async function getDemandSourceCoverage(): Promise<DemandSourceCoverage> {
  await requireForecastView();

  const now = new Date();
  const current = wibYearMonth(now);
  const nowIndex = current.year * 12 + current.month - 1;
  const firstIndex = nowIndex - (SOURCE_COVERAGE_MONTHS - 1);
  const window = {
    start: wibMonthStart(Math.floor(firstIndex / 12), (firstIndex % 12) + 1),
    end: now,
  };

  const months: DemandSourceMonth[] = [];
  const byKey = new Map<string, DemandSourceMonth>();
  for (let i = firstIndex; i <= nowIndex; i++) {
    const m: DemandSourceMonth = {
      year: Math.floor(i / 12),
      month: (i % 12) + 1,
      importedQty: { SHOPEE: 0, TIKTOK: 0 },
      offlineQty: 0,
      konsiQty: 0,
      marketplace: { SHOPEE: null, TIKTOK: null },
    };
    months.push(m);
    byKey.set(`${m.year}-${m.month}`, m);
  }

  const [marketplaceInput, konsiReports, history] = await Promise.all([
    loadMarketplaceDemandInput(window),
    loadKonsiReports(window),
    prisma.salesHistory.findMany({
      where: {
        orderStatus: SalesHistoryStatus.COMPLETED,
        orderDate: { gte: window.start, lte: window.end },
      },
      select: { channel: true, orderDate: true, netQuantity: true, importBatchId: true },
    }),
  ]);

  for (const d of buildMarketplaceDemand(marketplaceInput).diagnostics) {
    const m = byKey.get(`${d.year}-${d.month}`);
    if (m) m.marketplace[d.family] = d;
  }
  for (const k of buildKonsiDemand(konsiReports).monthly) {
    const m = byKey.get(`${k.year}-${k.month}`);
    if (m) m.konsiQty += k.qty;
  }
  for (const h of history) {
    const { year, month } = wibYearMonth(h.orderDate);
    const m = byKey.get(`${year}-${month}`);
    if (!m) continue;
    if (h.channel === "OFFLINE") m.offlineQty += h.netQuantity;
    else if (h.importBatchId && (h.channel === "SHOPEE" || h.channel === "TIKTOK")) {
      m.importedQty[h.channel] += h.netQuantity;
    }
  }

  return { months, payoutDelayDays: marketplaceInput.payoutDelayDays };
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
  /** Global, not per year: days a marketplace takes to pay an order out after its month ends. */
  payoutDelayDays?: Partial<Record<MarketplaceFamily, number>>;
}) {
  try {
    const session = await requireForecastManage();

    const delays = Object.entries(data.payoutDelayDays ?? {}) as [MarketplaceFamily, number][];
    for (const [family, days] of delays) {
      if (!(family in PAYOUT_DELAY_SETTING_KEY)) throw new Error(`Unknown marketplace ${family}`);
      if (!Number.isInteger(days) || days < 0 || days > MAX_PAYOUT_DELAY_DAYS) {
        throw new Error(`Payout delay must be a whole number of days from 0 to ${MAX_PAYOUT_DELAY_DAYS}`);
      }
    }
    const before = delays.length > 0 ? await loadPayoutDelayDays() : null;
    const changed = before ? delays.filter(([family, days]) => before[family] !== days) : [];
    if (before && changed.length > 0) {
      for (const [family, days] of changed) {
        const key = PAYOUT_DELAY_SETTING_KEY[family];
        await prisma.systemSetting.upsert({
          where: { key },
          create: { key, value: String(days) },
          update: { value: String(days) },
        });
      }
      await logAudit({
        userId: session.user.id,
        action: "UPDATE",
        entityType: "SystemSetting",
        entityId: "forecast.payoutDelayDays",
        metadata: { before, after: Object.fromEntries(changed) },
      });
    }
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
        itemId: true,
        resolutionStatus: true,
      },
    });

    const itemIds = [
      ...new Set(
        history
          .filter(
            (r) =>
              r.itemId && r.resolutionStatus === ResolutionStatus.MAPPED
          )
          .map((r) => r.itemId as string)
      ),
    ];
    const itemsById =
      itemIds.length > 0 ?
        await prisma.item.findMany({
          where: { id: { in: itemIds } },
          select: { id: true, sku: true },
        })
      : [];
    const skuByItemId = new Map(itemsById.map((i) => [i.id, i.sku]));

    const normalizedHistory = history.map((r) => {
      if (r.itemId && r.resolutionStatus === ResolutionStatus.MAPPED) {
        const itemSku = skuByItemId.get(r.itemId);
        return {
          ...r,
          parentSku: itemSku ?? r.parentSku,
        };
      }
      return r;
    });

    const historyRows = salesHistoryToDemandRows(
      normalizedHistory.map((r) => ({
        parentSku: r.parentSku,
        productName: r.productName,
        netQuantity: r.netQuantity,
        lineTotal: toNumber(r.lineTotal),
        orderDate: r.orderDate,
        itemId: r.itemId,
        mapped: r.resolutionStatus === ResolutionStatus.MAPPED,
      }))
    );
    const marketplace = buildMarketplaceDemand(
      await loadMarketplaceDemandInput({ start, end })
    );
    const konsi = buildKonsiDemand(await loadKonsiReports({ start, end }));
    const demandRows = buildUnifiedDemandRows(
      historyRows,
      marketplace.rows,
      konsi.rows
    );

    const itemIdByParentSku = new Map<string, string | null>();
    for (const r of demandRows) {
      if (r.itemId) {
        itemIdByParentSku.set(r.parentSku, r.itemId);
      } else if (!itemIdByParentSku.has(r.parentSku)) {
        itemIdByParentSku.set(r.parentSku, null);
      }
    }

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
          itemId: itemIdByParentSku.get(a.parentSku) ?? null,
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
      metadata: {
        year: data.targetYear,
        count: articles.length,
        historyRows: historyRows.length,
        marketplaceRows: marketplace.rows.length,
        konsiRows: konsi.rows.length,
      },
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
  itemId: string | null;
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
    const children = await prisma.planCategory.findMany({
      where: {
        planYearId: planYear.id,
        parentId: { not: null },
        itemId: { not: null },
      },
      select: {
        id: true,
        parentId: true,
        targetQty: true,
        parentSharePercent: true,
        itemId: true,
        item: { select: { sku: true } },
        parent: { select: { targetQty: true } },
      },
    });
    for (const child of children) {
      if (!child.item?.sku) continue;
      planTargets.set(
        child.item.sku,
        getEffectiveTarget({
          id: child.id,
          parentId: child.parentId,
          targetQty: child.targetQty,
          parentSharePercent: child.parentSharePercent,
          itemId: child.itemId,
          parent: child.parent,
        })
      );
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
      itemId: r.itemId,
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
  existingChildId: string | null;
  existingParentId: string | null;
  categoryForecastTotal: number | null;
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
    const itemIds = results.map((r) => r.itemId).filter((id): id is string => id != null);
    const itemByParentSku = await buildItemByParentSkuMap(parentSkus, itemIds);

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

    const categoryForecastTotals = new Map<string, number>();
    for (const row of results) {
      const item = itemByParentSku.get(row.parentSku);
      const catId = item?.categoryId;
      if (!catId) continue;
      categoryForecastTotals.set(
        catId,
        (categoryForecastTotals.get(catId) ?? 0) + row.forecastAnnual
      );
    }

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

      const item =
        row.itemId ?
          (itemByParentSku.get(row.parentSku) ??
            [...itemByParentSku.values()].find((i) => i?.id === row.itemId) ??
            null)
        : (itemByParentSku.get(row.parentSku) ?? null);
      const itemCategoryId = item?.categoryId ?? null;
      const itemCategory = item?.category ?? null;

      const rootPlan =
        itemCategoryId ?
          (planRootByCategoryId.get(itemCategoryId) ?? null)
        : null;

      const existingChild =
        rootPlan && item?.id ?
          (rootPlan.children.find((child) => child.itemId === item.id) ?? null)
        : null;

      const existingChildId = existingChild?.id ?? null;
      const existingParentId = rootPlan?.id ?? null;
      const existingPlanTarget =
        rootPlan && existingChild ?
          childEffectiveTarget(rootPlan, existingChild)
        : null;
      const action = suggestItemAction(row.forecastAnnual, existingPlanTarget);
      const canCreate = Boolean(itemCategoryId);

      return {
        parentSku: row.parentSku,
        productName: row.productName,
        abcClass: row.abcClass,
        forecastAnnual: row.forecastAnnual,
        forecastMonthly: monthly,
        existingPlanTarget,
        existingChildId,
        existingParentId,
        categoryForecastTotal:
          itemCategoryId ?
            (categoryForecastTotals.get(itemCategoryId) ?? null)
          : null,
        itemId: row.itemId ?? item?.id ?? null,
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
    adjustedQty: number;
    itemCategoryId: string;
    itemId: string;
    action?: "CREATE" | "UPDATE" | "SKIP";
  }[];
}): Promise<{
  success: boolean;
  created?: number;
  updated?: number;
  skipped?: number;
  errors?: Array<{ categoryId: string; message: string }>;
  error?: string;
}> {
  try {
    await requirePlanBridgeManage();

    const validRows = data.suggestions.filter(
      (row) =>
        row.itemCategoryId &&
        row.itemId &&
        row.action !== "SKIP" &&
        row.adjustedQty > 0
    );

    if (validRows.length === 0) {
      return { success: false, error: "No valid suggestions to apply" };
    }

    const grouped = groupSuggestionsByCategory(validRows);
    const parentSkus = [...new Set(validRows.map((row) => row.parentSku))];
    const itemByParentSku = await buildItemByParentSkuMap(parentSkus);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ categoryId: string; message: string }> = [];

    for (const [itemCategoryId, rows] of grouped) {
      const freshRoot = await prisma.planCategory.findFirst({
        where: {
          planYearId: data.planYearId,
          parentId: null,
          itemCategoryId,
        },
        select: {
          id: true,
          targetQty: true,
          children: {
            select: {
              id: true,
              itemId: true,
              parentSharePercent: true,
              code: true,
            },
          },
        },
      });

      const selectedItems = rows.map((row) => {
        const item = itemByParentSku.get(row.parentSku);
        const code = item?.sku ?? row.parentSku;
        const name = item?.nameId ?? row.parentSku;
        return {
          itemId: row.itemId,
          parentSku: row.parentSku,
          adjustedQty: row.adjustedQty,
          action: (row.action ?? "UPDATE") as "CREATE" | "UPDATE" | "SKIP",
          code: code.slice(0, 50),
          name: name.slice(0, 200),
        };
      });

      const plan = buildCategoryApplyPlan({
        itemCategoryId,
        selectedItems,
        existingRoot:
          freshRoot ?
            { id: freshRoot.id, targetQty: freshRoot.targetQty }
          : null,
        existingChildren: mapPlanBridgeChildren(freshRoot?.children ?? []),
      });

      if (plan.skipped) {
        skipped++;
        if (plan.error) {
          errors.push({ categoryId: itemCategoryId, message: plan.error });
        }
        continue;
      }

      try {
        let rootId = plan.existingParentId;

        if (plan.parentAction === "CREATE") {
          const root = await createPlanCategory({
            planYearId: data.planYearId,
            itemCategoryId,
            targetQty: plan.parentTargetQty,
            itemId: null,
          });
          rootId = root.id;
          created++;
        } else if (rootId) {
          await updatePlanCategory(rootId, {
            targetQty: plan.parentTargetQty,
            itemId: null,
          });
          updated++;
        }

        if (!rootId) {
          errors.push({
            categoryId: itemCategoryId,
            message: "Failed to resolve parent category",
          });
          skipped++;
          continue;
        }

        for (const child of plan.childUpserts) {
          if (child.parentSharePercent <= 0) continue;

          if (child.action === "CREATE") {
            await createPlanCategory({
              planYearId: data.planYearId,
              parentId: rootId,
              code: child.code,
              name: child.name,
              itemId: child.itemId,
              parentSharePercent: child.parentSharePercent,
            });
            created++;
          } else if (child.existingChildId) {
            await updatePlanCategory(child.existingChildId, {
              parentSharePercent: child.parentSharePercent,
            });
            updated++;
          }
        }
      } catch (categoryError) {
        skipped++;
        errors.push({
          categoryId: itemCategoryId,
          message:
            categoryError instanceof Error ?
              categoryError.message
            : "Category apply failed",
        });
      }
    }

    revalidatePath(PLANNING_PATH);
    revalidatePath(FORECAST_PATH);

    return {
      success: errors.length === 0 || created > 0 || updated > 0,
      created,
      updated,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    };
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
    select: { id: true, year: true, isLocked: true, status: true },
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
