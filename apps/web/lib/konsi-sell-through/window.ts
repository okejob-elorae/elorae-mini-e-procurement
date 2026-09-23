import type { Prisma } from "@elorae/db";
import { roundQty, type CountedFigure, type LedgerRow, type OpeningFigure } from "./derive";

/**
 * The boundary for a store stocktake's own approval transaction: the max `createdAt` of the
 * `StockLedgerEntry` rows it wrote (refType `StoreStocktake`, refId the stocktake id). A
 * stocktake whose approval changed nothing writes no ledger rows at all (`setStoreStock`
 * short-circuits on an unchanged count), so it falls back to the stocktake's own `approvedAt`.
 */
export async function stocktakeBoundary(
  client: Prisma.TransactionClient,
  storeId: string,
  stocktakeId: string,
): Promise<Date> {
  const latest = await client.stockLedgerEntry.findFirst({
    where: { locationType: "STORE", locationId: storeId, refType: "StoreStocktake", refId: stocktakeId },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (latest) return latest.createdAt;

  const stocktake = await client.storeStocktake.findUnique({ where: { id: stocktakeId }, select: { approvedAt: true } });
  if (!stocktake?.approvedAt) {
    throw new Error(`StoreStocktake ${stocktakeId} has no ledger rows and no approvedAt to anchor a boundary`);
  }
  return stocktake.approvedAt;
}

/**
 * Loads every input `deriveSellThroughLines` (Task 3) needs for one report's period: the store
 * ledger rows in the window, the previous report's closing figures as openings, and the closing
 * stocktake's own counted lines. See the design doc's "Period and contiguity" for the window
 * invariant this implements.
 */
export async function loadSellThroughInputs(
  client: Prisma.TransactionClient,
  input: {
    storeId: string;
    closingStocktakeId: string;
    previous: { id: string; closingStocktakeId: string } | null;
  },
): Promise<{ periodEnd: Date; periodStart: Date | null; rows: LedgerRow[]; openings: OpeningFigure[]; counted: CountedFigure[] }> {
  const boundary = await stocktakeBoundary(client, input.storeId, input.closingStocktakeId);
  const previousBoundary = input.previous
    ? await stocktakeBoundary(client, input.storeId, input.previous.closingStocktakeId)
    : null;

  const dateWindow: Prisma.StockLedgerEntryWhereInput = previousBoundary
    ? { createdAt: { gt: previousBoundary, lte: boundary } }
    : { createdAt: { lte: boundary } };

  const entries = await client.stockLedgerEntry.findMany({
    where: {
      locationType: "STORE",
      locationId: input.storeId,
      OR: [dateWindow, { refType: "StoreStocktake", refId: input.closingStocktakeId }],
      NOT: input.previous ? { refType: "StoreStocktake", refId: input.previous.closingStocktakeId } : undefined,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { itemId: true, variantSku: true, qty: true, refType: true, refId: true },
  });

  const rows: LedgerRow[] = entries.map((e) => ({
    itemId: e.itemId,
    variantSku: e.variantSku,
    qty: roundQty(e.qty.toNumber()),
    refType: e.refType,
    refId: e.refId,
  }));

  const openings: OpeningFigure[] = input.previous
    ? (
        await client.konsiSellThroughLine.findMany({
          where: { sellThroughId: input.previous.id },
          select: { itemId: true, variantSku: true, closingQty: true },
        })
      ).map((l) => ({ itemId: l.itemId, variantSku: l.variantSku, qty: roundQty(l.closingQty.toNumber()) }))
    : [];

  const stocktakeLines = await client.storeStocktakeLine.findMany({
    where: { stocktakeId: input.closingStocktakeId },
    select: { itemId: true, variantSku: true, countedQty: true, cause: true },
  });
  const counted: CountedFigure[] = stocktakeLines.map((l) => ({
    itemId: l.itemId,
    variantSku: l.variantSku,
    countedQty: l.countedQty === null ? null : roundQty(l.countedQty.toNumber()),
    cause: l.cause,
  }));

  return { periodEnd: boundary, periodStart: previousBoundary, rows, openings, counted };
}
