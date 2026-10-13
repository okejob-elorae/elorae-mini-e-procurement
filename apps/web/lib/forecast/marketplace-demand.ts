import type { SalesOrderStatus } from "@/lib/constants/enums";
import type { DemandRow } from "./types";

/**
 * Marketplace demand for the forecast, read from Jubelio-synced `SalesOrder` rows.
 *
 * An order counts only once a marketplace settlement proves it final: its WIB month must be
 * settled for its marketplace (see `isMonthSettled`), at least one MATCHED settlement line must
 * point at it with a positive net, and its match key must belong to exactly one `SalesOrder`.
 * Jubelio status is never consulted for counting: a settled order counts even if Jubelio later
 * marks it RETURNED (returned units still come off through `returnedQty`). Orders in an unsettled
 * month are left out and the month is reported as provisional. Settlement lines only prove
 * finality — quantities and revenue always come from `SalesOrderItem`.
 */

export type MarketplaceFamily = "SHOPEE" | "TIKTOK";
export const MARKETPLACE_FAMILIES: readonly MarketplaceFamily[] = ["SHOPEE", "TIKTOK"];

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Settlement uploads exist for SHOPEE and TIKTOK only; TikTok Shop absorbed Tokopedia. */
export function marketplaceFamilyFor(channel: string): MarketplaceFamily | null {
  switch (channel) {
    case "SHOPEE":
      return "SHOPEE";
    case "TIKTOK":
    case "TOKOPEDIA":
      return "TIKTOK";
    default:
      return null;
  }
}

/** Calendar year/month in Asia/Jakarta (UTC+7, no DST). */
export function wibYearMonth(date: Date): { year: number; month: number } {
  const shifted = new Date(date.getTime() + WIB_OFFSET_MS);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
}

/** UTC instant of WIB midnight on the first day of the month. */
export function wibMonthStart(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1) - WIB_OFFSET_MS);
}

export type SettlementPeriod = { periodFrom: Date; periodTo: Date };

/**
 * True when the uploaded settlements of one marketplace cover, without a gap, the WIB month
 * start through the month's end plus `delayDays` — the window in which that month's orders are
 * paid out. `periodTo` is stored as the WIB start of the period's last day, so each period
 * covers up to one day after it.
 */
export function isMonthSettled(
  year: number,
  month: number,
  periods: readonly SettlementPeriod[],
  delayDays: number
): boolean {
  const needFrom = wibMonthStart(year, month).getTime();
  const nextMonth = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
  const needTo = wibMonthStart(nextMonth.y, nextMonth.m).getTime() + delayDays * DAY_MS;

  // Periods that end before the month cannot cover it, and a gap between them is irrelevant.
  const intervals = periods
    .map((p) => ({ from: p.periodFrom.getTime(), to: p.periodTo.getTime() + DAY_MS }))
    .filter((i) => i.to > i.from && i.to > needFrom)
    .sort((a, b) => a.from - b.from);

  let coveredTo: number | null = null;
  for (const i of intervals) {
    if (coveredTo === null) {
      if (i.from > needFrom) return false;
      coveredTo = i.to;
    } else if (i.from <= coveredTo) {
      coveredTo = Math.max(coveredTo, i.to);
    } else if (coveredTo < needTo) {
      // A gap opened before the window was fully covered.
      return false;
    }
    if (coveredTo >= needTo) return true;
  }
  return coveredTo !== null && coveredTo >= needTo;
}

export type MarketplaceOrderLineInput = {
  itemId: string | null;
  itemSku: string | null;
  productName: string;
  qty: number;
  returnedQty: number;
  isCanceledItem: boolean;
  lineTotal: number;
};

export type MarketplaceOrderInput = {
  id: string;
  /** `SalesChannel` as stored; the web enum copy lacks OFFLINE, so the raw string is taken. */
  channel: string;
  status: SalesOrderStatus;
  transactionDate: Date;
  /** False when another SalesOrder shares this order's settlement match key — never proof. */
  matchKeyUnique: boolean;
  /** Marketplace order numbers to dedupe against imported `SalesHistory.orderId`. */
  orderNumbers: string[];
  lines: MarketplaceOrderLineInput[];
};

export type MarketplaceDemandInput = {
  orders: readonly MarketplaceOrderInput[];
  /** Sum of `netIncome` over MATCHED settlement lines, per matched `SalesOrder.id`. */
  settlementNetByOrderId: ReadonlyMap<string, number>;
  settlementPeriods: Record<MarketplaceFamily, readonly SettlementPeriod[]>;
  payoutDelayDays: Record<MarketplaceFamily, number>;
  importedOrderNumbers: Record<MarketplaceFamily, ReadonlySet<string>>;
};

export type MarketplaceMonthDiagnostics = {
  family: MarketplaceFamily;
  year: number;
  month: number;
  settled: boolean;
  countedOrders: number;
  countedQty: number;
  provisionalOrders: number;
  provisionalQty: number;
  missingPayoutOrders: number;
  refundedOrders: number;
  ambiguousOrders: number;
  dedupedOrders: number;
  unmappedLines: number;
  unmappedQty: number;
};

export type MarketplaceDemandResult = {
  rows: DemandRow[];
  diagnostics: MarketplaceMonthDiagnostics[];
};

const FINISHED_STATUSES: ReadonlySet<SalesOrderStatus> = new Set(["SHIPPED", "COMPLETED"]);

function netLineQty(line: MarketplaceOrderLineInput): number {
  if (line.isCanceledItem) return 0;
  return Math.max(0, line.qty - line.returnedQty);
}

export function buildMarketplaceDemand(input: MarketplaceDemandInput): MarketplaceDemandResult {
  const rows: DemandRow[] = [];
  const diagnostics = new Map<string, MarketplaceMonthDiagnostics>();
  const settledCache = new Map<string, boolean>();

  for (const order of input.orders) {
    const family = marketplaceFamilyFor(order.channel);
    if (!family) continue;

    const { year, month } = wibYearMonth(order.transactionDate);
    const key = `${family}:${year}-${month}`;
    let settled = settledCache.get(key);
    if (settled === undefined) {
      settled = isMonthSettled(year, month, input.settlementPeriods[family], input.payoutDelayDays[family]);
      settledCache.set(key, settled);
    }
    let d = diagnostics.get(key);
    if (!d) {
      d = {
        family, year, month, settled,
        countedOrders: 0, countedQty: 0, provisionalOrders: 0, provisionalQty: 0,
        missingPayoutOrders: 0, refundedOrders: 0, ambiguousOrders: 0, dedupedOrders: 0,
        unmappedLines: 0, unmappedQty: 0,
      };
      diagnostics.set(key, d);
    }

    const imported = input.importedOrderNumbers[family];
    if (order.orderNumbers.some((n) => imported.has(n))) {
      d.dedupedOrders += 1;
      continue;
    }

    const orderQty = order.lines.reduce((s, l) => s + netLineQty(l), 0);
    if (!settled) {
      if (order.status !== "CANCELLED") {
        d.provisionalOrders += 1;
        d.provisionalQty += orderQty;
      }
      continue;
    }

    const net = input.settlementNetByOrderId.get(order.id);
    if (net === undefined) {
      if (FINISHED_STATUSES.has(order.status)) d.missingPayoutOrders += 1;
      continue;
    }
    if (!order.matchKeyUnique) {
      d.ambiguousOrders += 1;
      continue;
    }
    if (net <= 0) {
      d.refundedOrders += 1;
      continue;
    }

    d.countedOrders += 1;
    for (const line of order.lines) {
      const qty = netLineQty(line);
      if (qty <= 0) continue;
      if (!line.itemId || !line.itemSku) {
        d.unmappedLines += 1;
        d.unmappedQty += qty;
        continue;
      }
      d.countedQty += qty;
      rows.push({
        parentSku: line.itemSku,
        productName: line.productName,
        netQuantity: qty,
        lineTotal: line.qty > 0 ? (line.lineTotal * qty) / line.qty : 0,
        orderDate: order.transactionDate,
        year,
        month,
        itemId: line.itemId,
      });
    }
  }

  return {
    rows,
    diagnostics: [...diagnostics.values()].sort(
      (a, b) => a.year - b.year || a.month - b.month || a.family.localeCompare(b.family)
    ),
  };
}
