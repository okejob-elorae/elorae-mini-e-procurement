import type {
  AbcClass,
  DemandRow,
  ForecastArticle,
  ForecastParams,
  MonthlyDemand,
  XyzClass,
} from "./types";

const ABC_ORDER: Record<AbcClass, number> = { A: 0, B: 1, C: 2 };
const MIN_SEASONAL_MONTHS = 12;
const SEASONAL_FLOOR = 0.1;

export function aggregateMonthlyDemand(rows: DemandRow[]): MonthlyDemand[] {
  const map = new Map<string, MonthlyDemand>();

  for (const row of rows) {
    const key = `${row.parentSku}|${row.year}|${row.month}`;
    const existing = map.get(key);
    if (existing) {
      existing.totalQty += row.netQuantity;
      existing.totalRevenue += row.lineTotal;
    } else {
      map.set(key, {
        parentSku: row.parentSku,
        productName: row.productName,
        year: row.year,
        month: row.month,
        totalQty: row.netQuantity,
        totalRevenue: row.lineTotal,
      });
    }
  }

  return [...map.values()].sort((a, b) => {
    if (a.parentSku !== b.parentSku) return a.parentSku.localeCompare(b.parentSku);
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });
}

export function computeBaseRate(
  monthlyDemand: MonthlyDemand[],
  lookbackMonths: number,
  weightDecay: number
): number {
  if (monthlyDemand.length === 0) return 0;

  const sorted = [...monthlyDemand].sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    return b.month - a.month;
  });

  const slice = sorted.slice(0, lookbackMonths);
  let weightedSum = 0;
  let weightTotal = 0;

  slice.forEach((entry, index) => {
    const weight = Math.pow(weightDecay, index);
    weightedSum += entry.totalQty * weight;
    weightTotal += weight;
  });

  if (weightTotal === 0) return 0;
  return Math.round(weightedSum / weightTotal);
}

export function computeSeasonalIndices(monthlyDemand: MonthlyDemand[]): number[] {
  const distinctMonths = new Set(
    monthlyDemand.map((d) => `${d.year}-${d.month}`)
  );
  if (distinctMonths.size < MIN_SEASONAL_MONTHS) {
    return Array(12).fill(1);
  }

  const overallAvg =
    monthlyDemand.reduce((sum, d) => sum + d.totalQty, 0) / monthlyDemand.length;
  if (overallAvg === 0) return Array(12).fill(1);

  const byCalendarMonth = new Map<number, number[]>();
  for (const d of monthlyDemand) {
    const list = byCalendarMonth.get(d.month) ?? [];
    list.push(d.totalQty);
    byCalendarMonth.set(d.month, list);
  }

  const rawIndices: number[] = [];
  for (let m = 1; m <= 12; m++) {
    const values = byCalendarMonth.get(m) ?? [];
    const monthAvg =
      values.length > 0
        ? values.reduce((a, b) => a + b, 0) / values.length
        : overallAvg;
    rawIndices.push(Math.max(SEASONAL_FLOOR, monthAvg / overallAvg));
  }

  const rawSum = rawIndices.reduce((a, b) => a + b, 0);
  const scale = rawSum > 0 ? 12 / rawSum : 1;
  return rawIndices.map((idx) => Math.max(SEASONAL_FLOOR, idx * scale));
}

export function generateForecast(
  baseRate: number,
  seasonalIndices: number[],
  growthFactorPercent: number
): { monthly: number[]; annual: number } {
  const growth = 1 + growthFactorPercent / 100;
  const monthly = seasonalIndices.map((si) =>
    Math.round(baseRate * si * growth)
  );
  const annual = monthly.reduce((a, b) => a + b, 0);
  return { monthly, annual };
}

export function classifyABC(
  articleRevenues: { parentSku: string; totalRevenue: number }[]
): Map<string, AbcClass> {
  const result = new Map<string, AbcClass>();
  if (articleRevenues.length === 0) return result;

  const sorted = [...articleRevenues].sort(
    (a, b) => b.totalRevenue - a.totalRevenue
  );
  if (sorted.length === 1) {
    result.set(sorted[0]!.parentSku, "A");
    return result;
  }
  const total = sorted.reduce((sum, a) => sum + a.totalRevenue, 0);
  if (total === 0) {
    for (const a of sorted) result.set(a.parentSku, "C");
    return result;
  }

  let cumulative = 0;
  for (const article of sorted) {
    cumulative += article.totalRevenue;
    const pct = (cumulative / total) * 100;
    if (pct <= 80) result.set(article.parentSku, "A");
    else if (pct <= 95) result.set(article.parentSku, "B");
    else result.set(article.parentSku, "C");
  }

  return result;
}

export function classifyXYZ(
  articleMonthlyDemands: Map<string, number[]>
): Map<string, { class: XyzClass; cv: number }> {
  const result = new Map<string, { class: XyzClass; cv: number }>();

  for (const [parentSku, values] of articleMonthlyDemands) {
    if (values.length < 3) {
      result.set(parentSku, { class: "Z", cv: 0 });
      continue;
    }

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    if (mean === 0) {
      result.set(parentSku, { class: "Z", cv: 0 });
      continue;
    }

    const variance =
      values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / mean;

    let cls: XyzClass = "X";
    if (cv >= 1) cls = "Z";
    else if (cv >= 0.5) cls = "Y";

    result.set(parentSku, { class: cls, cv });
  }

  return result;
}

export function runForecastPipeline(
  demandRows: DemandRow[],
  params: ForecastParams
): ForecastArticle[] {
  const monthlyAll = aggregateMonthlyDemand(demandRows);
  const bySku = new Map<string, MonthlyDemand[]>();

  for (const row of monthlyAll) {
    const list = bySku.get(row.parentSku) ?? [];
    list.push(row);
    bySku.set(row.parentSku, list);
  }

  const articleRevenues: { parentSku: string; totalRevenue: number }[] = [];
  const articleMonthlyQty = new Map<string, number[]>();
  const articles: ForecastArticle[] = [];

  for (const [parentSku, demands] of bySku) {
    const productName = demands[0]?.productName ?? parentSku;
    const totalHistoricalQty = demands.reduce((s, d) => s + d.totalQty, 0);
    const totalHistoricalRevenue = demands.reduce((s, d) => s + d.totalRevenue, 0);

    articleRevenues.push({ parentSku, totalRevenue: totalHistoricalRevenue });
    articleMonthlyQty.set(
      parentSku,
      demands.map((d) => d.totalQty)
    );

    const baseRate = computeBaseRate(
      demands,
      params.lookbackMonths,
      params.weightDecay
    );
    const seasonalIndices = computeSeasonalIndices(demands);
    const { monthly, annual } = generateForecast(
      baseRate,
      seasonalIndices,
      params.growthFactorPercent
    );

    const mean =
      demands.length > 0
        ? demands.reduce((s, d) => s + d.totalQty, 0) / demands.length
        : 0;
    const variance =
      demands.length > 0
        ? demands.reduce((s, d) => s + (d.totalQty - mean) ** 2, 0) / demands.length
        : 0;
    const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;

    articles.push({
      parentSku,
      productName,
      abcClass: "C",
      xyzClass: "Z",
      totalHistoricalQty,
      totalHistoricalRevenue,
      avgMonthlyDemand: baseRate,
      coefficientOfVariation: cv,
      seasonalIndices,
      monthlyForecast: monthly,
      annualForecast: annual,
    });
  }

  const abcMap = classifyABC(articleRevenues);
  const xyzMap = classifyXYZ(articleMonthlyQty);

  for (const article of articles) {
    article.abcClass = abcMap.get(article.parentSku) ?? "C";
    const xyz = xyzMap.get(article.parentSku);
    article.xyzClass = xyz?.class ?? "Z";
    article.coefficientOfVariation = xyz?.cv ?? article.coefficientOfVariation;
  }

  articles.sort((a, b) => {
    const abcDiff = ABC_ORDER[a.abcClass] - ABC_ORDER[b.abcClass];
    if (abcDiff !== 0) return abcDiff;
    return b.annualForecast - a.annualForecast;
  });

  return articles;
}

/** V2 hook: merge SalesOrder when model exists. V1 returns sales history only. */
export function buildUnifiedDemandRows(
  salesHistoryRows: DemandRow[],
  _salesOrderRows: DemandRow[] = []
): DemandRow[] {
  return salesHistoryRows;
}
