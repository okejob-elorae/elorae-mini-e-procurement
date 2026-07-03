/**
 * Gate 1 empirical counts for sales reconciliation readiness.
 * Run: pnpm -F @elorae/web exec tsx scripts/sales-reconciliation-gate1.ts
 */
import "dotenv/config";
import { prisma } from "@elorae/db";

async function main() {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const [
    salesOrder30d,
    salesOrderTotal,
    salesOrderItemMapped,
    salesOrderItemTotal,
    webhookProcessed30d,
    salesHistoryTotal,
    salesHistoryMapped,
  ] = await Promise.all([
    prisma.salesOrder.count({
      where: { transactionDate: { gte: thirtyDaysAgo } },
    }),
    prisma.salesOrder.count(),
    prisma.salesOrderItem.count({ where: { itemId: { not: null } } }),
    prisma.salesOrderItem.count(),
    prisma.jubelioWebhookEvent.count({
      where: {
        status: "PROCESSED",
        receivedAt: { gte: thirtyDaysAgo },
      },
    }),
    prisma.salesHistory.count({
      where: { orderStatus: "COMPLETED" },
    }),
    prisma.salesHistory.count({
      where: {
        orderStatus: "COMPLETED",
        resolutionStatus: "MAPPED",
      },
    }),
  ]);

  const itemIdFillRate =
    salesOrderItemTotal > 0 ?
      Math.round((salesOrderItemMapped / salesOrderItemTotal) * 100)
    : 0;

  const mappingFillRate =
    salesHistoryTotal > 0 ?
      Math.round((salesHistoryMapped / salesHistoryTotal) * 100)
    : 0;

  console.log(JSON.stringify({
    capturedAt: new Date().toISOString(),
    gate1: {
      salesOrderLast30Days: salesOrder30d,
      salesOrderTotal,
      salesOrderItemTotal,
      salesOrderItemWithItemId: salesOrderItemMapped,
      salesOrderItemIdFillRatePercent: itemIdFillRate,
      jubelioWebhookProcessedLast30Days: webhookProcessed30d,
    },
    salesHistory: {
      completedRows: salesHistoryTotal,
      mappedRows: salesHistoryMapped,
      mappingFillRatePercent: mappingFillRate,
    },
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
