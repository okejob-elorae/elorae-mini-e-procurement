import {
  ResolutionStatus,
  SalesChannel,
  SalesHistoryStatus,
  SalesOrderStatus,
} from "@elorae/db";
import { prisma } from "@elorae/db";
import {
  buildReconciliationReport,
  type ReconciliationReport,
} from "@/lib/sales/sales-reconciliation";

function periodBounds(month: number, year: number) {
  const start = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

function toQty(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "object" && value && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return Number(value);
}

export async function loadReconciliationReport(input: {
  channel: SalesChannel;
  periodMonth: number;
  periodYear: number;
}): Promise<ReconciliationReport> {
  const { start, end } = periodBounds(input.periodMonth, input.periodYear);

  const excelRows = await prisma.salesHistory.findMany({
    where: {
      channel: input.channel,
      orderStatus: SalesHistoryStatus.COMPLETED,
      orderDate: { gte: start, lte: end },
    },
    select: {
      parentSku: true,
      productName: true,
      netQuantity: true,
      itemId: true,
      resolutionStatus: true,
      variantSku: true,
    },
  });

  const jubelioOrders = await prisma.salesOrder.findMany({
    where: {
      channel: input.channel,
      isCanceled: false,
      markedAsComplete: true,
      transactionDate: { gte: start, lte: end },
      status: { in: [SalesOrderStatus.COMPLETED, SalesOrderStatus.SHIPPED] },
    },
    select: {
      items: {
        where: { isCanceledItem: false },
        select: {
          itemId: true,
          jubelioItemCode: true,
          productName: true,
          qty: true,
        },
      },
    },
  });

  const jubelioItemIds = [
    ...new Set(
      jubelioOrders.flatMap((order) =>
        order.items.map((line) => line.itemId).filter((id): id is string => id != null)
      )
    ),
  ];
  const itemSkus =
    jubelioItemIds.length > 0
      ? await prisma.item.findMany({
          where: { id: { in: jubelioItemIds } },
          select: { id: true, sku: true },
        })
      : [];
  const skuByItemId = new Map(itemSkus.map((row) => [row.id, row.sku]));

  const jubelioLines = jubelioOrders.flatMap((order) =>
    order.items.map((line) => ({
      itemId: line.itemId,
      parentSku:
        (line.itemId ? skuByItemId.get(line.itemId) : null) ?? line.jubelioItemCode,
      productName: line.productName,
      qty: toQty(line.qty),
    }))
  );

  const unmappedSkus = [
    ...new Set(
      excelRows
        .filter((r) => r.resolutionStatus === ResolutionStatus.UNMAPPED)
        .map((r) => r.variantSku)
    ),
  ].sort();

  return buildReconciliationReport({
    channel: input.channel,
    periodMonth: input.periodMonth,
    periodYear: input.periodYear,
    excelRows: excelRows.map((r) => ({
      parentSku: r.parentSku,
      productName: r.productName,
      netQuantity: r.netQuantity,
      itemId: r.itemId,
      resolutionStatus: r.resolutionStatus,
    })),
    jubelioLines,
    unmappedSkus,
  });
}
