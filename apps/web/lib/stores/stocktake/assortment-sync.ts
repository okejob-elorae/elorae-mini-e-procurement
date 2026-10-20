import { prisma } from "@elorae/db";
import { buildStocktakeLines } from "./queries";

/**
 * Puts a newly added assortment SKU on the store's open DRAFT stocktake, as the draft line it
 * would have had if the line existed when the count opened. Without it the SKU shows on the SPG
 * sheet (the assortment prefill) but has no row on the document, so a save folds it in as an
 * added line and the backoffice shows an "Added" badge on a SKU the store was always meant to
 * stock.
 *
 * Only a DRAFT is touched. A document at PENDING_VERIFICATION was already submitted; a new
 * uncounted line there would turn a full count into a partial one. A SKU already on the document
 * is left alone. Returns whether a line was added.
 */
export async function addAssortmentSkuToOpenDraft(input: {
  storeId: string;
  itemId: string;
  variantSku: string;
}): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const draft = await tx.storeStocktake.findFirst({
      where: { storeId: input.storeId, openKey: { not: null }, status: "DRAFT" },
      select: { id: true, periodFrom: true, countedAt: true },
    });
    if (!draft) return false;

    const onDoc = await tx.storeStocktakeLine.findFirst({
      where: { stocktakeId: draft.id, itemId: input.itemId, variantSku: input.variantSku },
      select: { id: true },
    });
    if (onDoc) return false;

    const lines = await buildStocktakeLines(tx, input.storeId, draft.periodFrom, draft.countedAt);
    const line = lines.find((l) => l.itemId === input.itemId && l.variantSku === input.variantSku);
    if (!line) return false;

    await tx.storeStocktakeLine.create({
      data: {
        stocktakeId: draft.id,
        itemId: line.itemId,
        variantSku: line.variantSku,
        productName: line.productName,
        expectedQty: line.expectedQty,
        soldInPeriodQty: line.soldInPeriodQty,
        countedQty: null,
      },
    });
    return true;
  });
}
