import type { SalesChannel } from "@elorae/db";

export type SkippedSalesHistoryRow = {
  orderId: string;
  variantSku: string;
  productName: string;
  reason: "DUPLICATE_IN_BATCH" | "ALREADY_EXISTS";
};

export function salesHistoryRowKey(
  channel: SalesChannel,
  orderId: string,
  variantSku: string,
): string {
  return `${channel}:${orderId}:${variantSku}`;
}

export function partitionSalesHistoryImportRows<
  T extends { orderId: string; variantSku: string; productName: string },
>(
  channel: SalesChannel,
  rows: T[],
  existingKeys: ReadonlySet<string>,
): { toInsert: T[]; skipped: SkippedSalesHistoryRow[] } {
  const batchSeen = new Set<string>();
  const toInsert: T[] = [];
  const skipped: SkippedSalesHistoryRow[] = [];
  const occupiedKeys = new Set(existingKeys);

  for (const row of rows) {
    const key = salesHistoryRowKey(channel, row.orderId, row.variantSku);
    if (batchSeen.has(key)) {
      skipped.push({
        orderId: row.orderId,
        variantSku: row.variantSku,
        productName: row.productName,
        reason: "DUPLICATE_IN_BATCH",
      });
      continue;
    }
    batchSeen.add(key);

    if (occupiedKeys.has(key)) {
      skipped.push({
        orderId: row.orderId,
        variantSku: row.variantSku,
        productName: row.productName,
        reason: "ALREADY_EXISTS",
      });
      continue;
    }

    toInsert.push(row);
    occupiedKeys.add(key);
  }

  return { toInsert, skipped };
}
