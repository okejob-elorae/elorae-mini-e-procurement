import { prisma } from "@elorae/db";
import {
  marketplaceFamilyFor,
  type MarketplaceDemandInput,
  type MarketplaceFamily,
  type MarketplaceOrderInput,
  type SettlementPeriod,
} from "./marketplace-demand";
import type { KonsiReportInput } from "./konsi-demand";

/**
 * Loads the inputs of `buildMarketplaceDemand` and `buildKonsiDemand` for one date window.
 * Kept free of auth so a spec can call it; the `app/actions/forecast.ts` wrappers gate it.
 */

const MARKETPLACE_CHANNELS = ["SHOPEE", "TIKTOK", "TOKOPEDIA"] as const;
const IN_CHUNK = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const PAYOUT_DELAY_SETTING_KEY: Record<MarketplaceFamily, string> = {
  SHOPEE: "forecast.payoutDelayDays.SHOPEE",
  TIKTOK: "forecast.payoutDelayDays.TIKTOK",
};
export const DEFAULT_PAYOUT_DELAY_DAYS = 14;
export const MAX_PAYOUT_DELAY_DAYS = 120;

export type DemandWindow = { start: Date; end: Date };

function chunk<T>(list: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += IN_CHUNK) out.push(list.slice(i, i + IN_CHUNK));
  return out;
}

function settlementFamily(marketplace: string): MarketplaceFamily | null {
  if (marketplace === "SHOPEE") return "SHOPEE";
  if (marketplace === "TIKTOK" || marketplace === "TOKOPEDIA") return "TIKTOK";
  return null;
}

export function parsePayoutDelayDays(value: string | null | undefined): number {
  if (value == null || value.trim() === "") return DEFAULT_PAYOUT_DELAY_DAYS;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > MAX_PAYOUT_DELAY_DAYS) return DEFAULT_PAYOUT_DELAY_DAYS;
  return n;
}

export async function loadPayoutDelayDays(): Promise<Record<MarketplaceFamily, number>> {
  const rows = await prisma.systemSetting.findMany({
    where: { key: { in: Object.values(PAYOUT_DELAY_SETTING_KEY) } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return {
    SHOPEE: parsePayoutDelayDays(byKey.get(PAYOUT_DELAY_SETTING_KEY.SHOPEE)),
    TIKTOK: parsePayoutDelayDays(byKey.get(PAYOUT_DELAY_SETTING_KEY.TIKTOK)),
  };
}

/**
 * Marketplace order numbers an order may appear under in a Shopee/TikTok Excel export:
 * `channelOrderNo` is Jubelio's `ref_no`, and a Shopee `salesorderNo` is that number behind `SP-`.
 */
export function orderNumbersFor(salesorderNo: string, channelOrderNo: string | null): string[] {
  const numbers = new Set<string>();
  const ref = channelOrderNo?.trim();
  if (ref) numbers.add(ref);
  const so = salesorderNo.trim();
  if (so.startsWith("SP-") && so.length > 3) numbers.add(so.slice(3));
  return [...numbers];
}

export async function loadMarketplaceDemandInput(window: DemandWindow): Promise<MarketplaceDemandInput> {
  const orders = await prisma.salesOrder.findMany({
    where: {
      channel: { in: [...MARKETPLACE_CHANNELS] },
      transactionDate: { gte: window.start, lte: window.end },
    },
    select: {
      id: true,
      channel: true,
      status: true,
      transactionDate: true,
      salesorderNo: true,
      channelOrderNo: true,
      items: {
        select: {
          itemId: true,
          productName: true,
          qty: true,
          returnedQty: true,
          isCanceledItem: true,
          lineTotal: true,
        },
      },
    },
  });

  const itemIds = [
    ...new Set(orders.flatMap((o) => o.items.map((i) => i.itemId)).filter((id): id is string => !!id)),
  ];
  const skuByItemId = new Map<string, string>();
  for (const ids of chunk(itemIds)) {
    const items = await prisma.item.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true } });
    for (const it of items) skuByItemId.set(it.id, it.sku);
  }

  // A settlement line matched against a key several SalesOrder rows share is a guess, never proof.
  // Shopee settlements match on `salesorderNo`, TikTok/Tokopedia on `channelOrderNo` (see match.ts).
  const shopeeKeys = [
    ...new Set(orders.filter((o) => marketplaceFamilyFor(o.channel) === "SHOPEE").map((o) => o.salesorderNo)),
  ];
  const tiktokKeys = [
    ...new Set(
      orders
        .filter((o) => marketplaceFamilyFor(o.channel) === "TIKTOK")
        .map((o) => o.channelOrderNo)
        .filter((k): k is string => !!k)
    ),
  ];
  const duplicateShopeeKeys = new Set<string>();
  for (const keys of chunk(shopeeKeys)) {
    const groups = await prisma.salesOrder.groupBy({
      by: ["salesorderNo"],
      where: { salesorderNo: { in: keys } },
      _count: { _all: true },
    });
    for (const g of groups) if (g._count._all > 1) duplicateShopeeKeys.add(g.salesorderNo);
  }
  const duplicateTiktokKeys = new Set<string>();
  for (const keys of chunk(tiktokKeys)) {
    const groups = await prisma.salesOrder.groupBy({
      by: ["channelOrderNo"],
      where: { channelOrderNo: { in: keys } },
      _count: { _all: true },
    });
    for (const g of groups) if (g.channelOrderNo && g._count._all > 1) duplicateTiktokKeys.add(g.channelOrderNo);
  }

  const settlementNetByOrderId = new Map<string, number>();
  for (const ids of chunk(orders.map((o) => o.id))) {
    const sums = await prisma.settlementLine.groupBy({
      by: ["matchedSalesOrderId"],
      where: { matchStatus: "MATCHED", matchedSalesOrderId: { in: ids } },
      _sum: { netIncome: true },
    });
    for (const s of sums) {
      if (s.matchedSalesOrderId) settlementNetByOrderId.set(s.matchedSalesOrderId, Number(s._sum.netIncome ?? 0));
    }
  }

  const settlements = await prisma.settlement.findMany({
    select: { marketplace: true, periodFrom: true, periodTo: true },
  });
  const settlementPeriods: Record<MarketplaceFamily, SettlementPeriod[]> = { SHOPEE: [], TIKTOK: [] };
  for (const s of settlements) {
    const family = settlementFamily(s.marketplace);
    if (family) settlementPeriods[family].push({ periodFrom: s.periodFrom, periodTo: s.periodTo });
  }

  // Excel exports date an order slightly differently from Jubelio, so read a month either side.
  const imported = await prisma.salesHistory.findMany({
    where: {
      channel: { in: ["SHOPEE", "TIKTOK"] },
      importBatchId: { not: null },
      orderDate: {
        gte: new Date(window.start.getTime() - 31 * DAY_MS),
        lte: new Date(window.end.getTime() + 31 * DAY_MS),
      },
    },
    select: { channel: true, orderId: true },
    distinct: ["channel", "orderId"],
  });
  const importedOrderNumbers: Record<MarketplaceFamily, Set<string>> = { SHOPEE: new Set(), TIKTOK: new Set() };
  for (const r of imported) {
    const family = marketplaceFamilyFor(r.channel);
    if (family) importedOrderNumbers[family].add(r.orderId.trim());
  }

  const orderInputs: MarketplaceOrderInput[] = orders.map((o) => {
    const family = marketplaceFamilyFor(o.channel);
    const matchKeyUnique =
      family === "SHOPEE"
        ? !duplicateShopeeKeys.has(o.salesorderNo)
        : !(o.channelOrderNo && duplicateTiktokKeys.has(o.channelOrderNo));
    return {
      id: o.id,
      channel: o.channel,
      status: o.status,
      transactionDate: o.transactionDate,
      matchKeyUnique,
      orderNumbers: orderNumbersFor(o.salesorderNo, o.channelOrderNo),
      lines: o.items.map((i) => ({
        itemId: i.itemId,
        itemSku: i.itemId ? skuByItemId.get(i.itemId) ?? null : null,
        productName: i.productName,
        qty: Number(i.qty),
        returnedQty: Number(i.returnedQty),
        isCanceledItem: i.isCanceledItem,
        lineTotal: Number(i.lineTotal),
      })),
    };
  });

  return {
    orders: orderInputs,
    settlementNetByOrderId,
    settlementPeriods,
    payoutDelayDays: await loadPayoutDelayDays(),
    importedOrderNumbers,
  };
}

export async function loadKonsiReports(window: DemandWindow): Promise<KonsiReportInput[]> {
  const reports = await prisma.konsiSellThrough.findMany({
    where: {
      status: "APPROVED",
      baseline: false,
      periodEnd: { gte: window.start, lte: window.end },
    },
    select: {
      periodEnd: true,
      lines: {
        select: {
          itemId: true,
          productName: true,
          billedQty: true,
          posSoldQty: true,
          unitPrice: true,
          item: { select: { sku: true } },
        },
      },
    },
  });
  return reports.map((r) => ({
    periodEnd: r.periodEnd,
    lines: r.lines.map((l) => ({
      itemId: l.itemId,
      itemSku: l.item.sku,
      productName: l.productName,
      billedQty: Number(l.billedQty),
      posSoldQty: Number(l.posSoldQty),
      unitPrice: l.unitPrice === null ? null : Number(l.unitPrice),
    })),
  }));
}
